/**
 * pipeline.ts — one run, end to end, with the broker used only for reads in planRun (spec §7, §9, §10).
 * executeOrders is the only writer of fills.jsonl.
 */
import type { Report } from "../report.schema";
import { buildSignal, type Signal } from "../portfolio/signal";
import type { BrokerAdapter, BrokerOrderStatus } from "../broker/adapter";
import { TERMINAL_STATUSES } from "../broker/adapter";
import { CashBackstopError, guardedSubmit, type GuardContext } from "../broker/guards";
import { OrderRejectedError, SubmitOutcomeUnknownError } from "../broker/http";
import { allInOrder, mapWithConcurrency } from "../concurrency";
import type { BrokerOrder, SubmitOrderRequest } from "../broker/adapter";
import { bucketFor, type TradeConfig } from "./config";
import { assertCalendar, prevTradingDay, isTradingDay, indexOnOrBefore, type TradingDay } from "./calendar";
import { appendFill, type Fill } from "./fills";
import { locksFor, type Locks } from "./locks";
import { reconcile, weightsOf, positionsOf, type Ledger } from "./ledger";
import { emitTrades, type TradePlan } from "./rebalance";
import { tradesToOrders, type SizedOrders } from "./orders";
import type { Mkt } from "./limit";
import type { RunRecord } from "./run-record";
import { etHHMM, etMinutesOfDay, todayET } from "./clock";

export interface PlanRunInput {
  adapter: BrokerAdapter; reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null>;
  fills: Fill[]; today: TradingDay; cfg: TradeConfig; runId: string;
  /**
   * The run's wall clock (default Date.now()). Execution's freshness gate for computeLimit, and — in
   * markMode "live" only — what decides whether this run IS today's session (todayET(nowMs) === today,
   * inside regular hours), the one case where decisions use live prices.
   */
  nowMs?: number;
  /**
   * Wall clock read per ticker as its market data is captured, so freshness is judged when the quote was
   * fetched, not at run start (it is read right after THAT ticker's trade+quote land; tickers are
   * fetched a few at a time). Default: a clock frozen at nowMs.
   */
  clock?: () => number;
}
export interface PlanRunOutput {
  /** markDate: the settled reference close's date (prevTradingDay(today)); marks: the decision marks (live in a live run). */
  ledger: Ledger; calendar: TradingDay[]; markDate: TradingDay; marks: Record<string, number>; signals: Signal[];
  locks: Locks; plan: TradePlan; sized: SizedOrders; record: RunRecord;
}

/** The fill's ET trading date — the lock clock starts here. Broker timestamps are UTC ("…Z" or "+0000"). */
export function fillTradingDate(filledAt: string): TradingDay {
  const ms = Date.parse(filledAt);
  return Number.isFinite(ms) ? todayET(ms) : filledAt.slice(0, 10);
}

// Pure date arithmetic on YYYY-MM-DD labels — UTC is correct here (no wall clock involved).
const shiftDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Max tickers whose live market data is fetched at once (each is 2 reads) — bounded for broker rate limits. */
const MARKET_DATA_CONCURRENCY = 4;

/** The regular session, ET minutes (09:30–16:00). Outside it a "live" print is extended-hours or yesterday's. */
const SESSION_OPEN_MIN = 9 * 60 + 30, SESSION_CLOSE_MIN = 16 * 60;

/** Where a decision mark came from (run record markSources): a fresh trade, a fresh quote mid, or the settled prior close. */
export type MarkSource = "trade" | "quote" | "close";

/**
 * The live decision mark for one ticker (markMode "live"). Pure. The same freshness rule as the
 * execution anchor (limit.ts): the last trade if fresh, else the quote MID if the quote is fresh and sane
 * (bid > 0, ask ≥ bid), else the settled prior close. Fresh = within maxStaleMin of `nowMs`, the moment
 * that ticker's data was captured — on either side, so a timestamp far in the future is no fresher than
 * one far in the past. Two rules keep a bad print out of the book:
 *   - live data is trusted only against a valid (> 0) reference close;
 *   - a live price more than `maxGap` (the bucket's gapHalt) from that close is set aside for the close.
 *     Execution would halt that ticker on the same print (gap-halt measures it against the same settled
 *     close), so deciding on it could only re-size the rest of the book around a trade that can't happen.
 *     Its decision is then exactly the settled-mode one, as it would have been before live marks.
 */
export function liveMark(
  trade: { price: number; tsMs: number } | null, quote: { bid: number; ask: number; tsMs: number } | null,
  close: number, nowMs: number, maxStaleMin: number, maxGap = Infinity,
): { price: number; source: MarkSource; setAside?: string } {
  const staleMs = maxStaleMin * 60_000;
  const fresh = (tsMs: number) => Number.isFinite(tsMs) && Math.abs(nowMs - tsMs) <= staleMs;
  const live = trade && Number.isFinite(trade.price) && trade.price > 0 && fresh(trade.tsMs) ? { price: trade.price, source: "trade" as const }
    : quote && Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.bid > 0 && quote.ask >= quote.bid && fresh(quote.tsMs)
      ? { price: (quote.bid + quote.ask) / 2, source: "quote" as const }
      : null;
  if (!live || !(close > 0)) return { price: close, source: "close" };
  const gap = Math.abs(live.price - close) / close;
  if (gap > maxGap) return { price: close, source: "close", setAside: `${live.source} $${live.price} is ${(gap * 100).toFixed(1)}% from the $${close} settled close (over the ${(maxGap * 100).toFixed(0)}% gap-halt)` };
  return live;
}

/** One ticker's live read: the trade and quote as the adapter returned them, when they landed, and why the read failed (if it did). */
interface LiveCapture { lastTrade: Mkt["lastTrade"]; quote: Mkt["quote"]; at: number; error?: string }

/**
 * One trade + one quote read per ticker, a few tickers at once (Schwab serves both from one /quotes
 * call), each stamped with the clock the moment ITS data lands. A failed read is not fatal: that ticker
 * decides on the settled close (recorded) and execution re-reads it if it trades — so live marks never
 * fail a run that settled marks would have completed.
 */
async function captureLive(adapter: BrokerAdapter, tickers: string[], clock: () => number): Promise<Map<string, LiveCapture>> {
  const caps = await mapWithConcurrency(tickers, MARKET_DATA_CONCURRENCY, async (ticker): Promise<LiveCapture> => {
    try {
      const [lastTrade, quote] = await allInOrder([adapter.getLatestTrade(ticker), adapter.getLatestQuote(ticker)]);
      return { lastTrade, quote, at: clock() };
    } catch (e) {
      return { lastTrade: null, quote: null, at: clock(), error: e instanceof Error ? e.message : String(e) };
    }
  });
  return new Map(tickers.map((t, i) => [t, caps[i]]));
}

export async function planRun(input: PlanRunInput): Promise<PlanRunOutput> {
  const { adapter, reports, sics, marketCapUsd, fills, today, cfg, runId, nowMs = Date.now() } = input;
  const clock = input.clock ?? (() => nowMs);
  // Independent reads run concurrently, but the BOOK reads keep their order: positions → orders →
  // account, each strictly after the previous returns. Reading orders after positions guarantees any
  // fill already reflected in the positions snapshot is visible to the orders check in reconcile.
  // The calendar (static) and the market data (closes, live prints) carry no book state, so they overlap freely.
  const [calendarDays, positions] = await allInOrder([adapter.getCalendar(shiftDays(today, -90), shiftDays(today, 45)), adapter.getPositions()]);
  const calendar = calendarDays.map((d) => d.date);
  assertCalendar(calendar);
  // The settled reference close is ALWAYS the prior trading day's — never getLastClose(today), whose daily
  // bar is partial (or missing: Alpaca throws "no bar") while the session is open.
  const markDate = prevTradingDay(calendar, today);
  const tickers = reports.map((r) => r.meta.ticker);
  const held = positions.map((p) => p.symbol);
  const decisionTickers = [...new Set([...tickers, ...held])];
  // Live decision marks only when this run IS today's session: markMode "live", `today` is the ET date
  // of nowMs (not a trade:plan --date replay), a trading day, inside regular hours. Anything else marks
  // settled, exactly as before live marks existed.
  const etMin = etMinutesOfDay(nowMs);
  const live = cfg.markMode === "live" && today === todayET(nowMs) && isTradingDay(calendar, today) && etMin >= SESSION_OPEN_MIN && etMin < SESSION_CLOSE_MIN;
  // Orders check (spec #7): look back over the lock window (+1 trading day of slack) — an older
  // execution cannot set a lock that is still active today.
  const lockWindowStart = calendar[Math.max(0, indexOnOrBefore(calendar, today) - (cfg.lockBusinessDays + 1))];
  const [{ refCloses, captures }, { brokerOrders, account }] = await allInOrder([
    (async () => {
      const refCloses = await adapter.getLastClose(decisionTickers, markDate);
      // Live reads go AFTER the settled closes, so they never compete with them for the broker's rate
      // limit: the reference fetch (which still fails the run on error, as before) is no likelier to fail.
      return { refCloses, captures: live ? await captureLive(adapter, decisionTickers, clock) : new Map<string, LiveCapture>() };
    })(),
    (async () => {
      const brokerOrders = cfg.reconcileOrders ? await adapter.getOrders("all", `${lockWindowStart}T00:00:00Z`) : undefined;
      return { brokerOrders, account: await adapter.getAccount() };
    })(),
  ]);
  // Decision marks: in a live run each ticker's live mark (or its recorded settled fallback); otherwise
  // the settled close itself.
  const marks: Record<string, number> = {};
  const markSources: Record<string, MarkSource> = {};
  const markNotes: string[] = [];
  for (const t of decisionTickers) {
    // No reference close → no mark, exactly as before (adapters return every symbol or throw; a gap here
    // must not become a present-but-undefined key that fails the run record after orders went out).
    if (refCloses[t] === undefined) continue;
    const cap = captures.get(t);
    if (!cap) { marks[t] = refCloses[t]; markSources[t] = "close"; continue; }
    const bucket = bucketFor(marketCapUsd[t] ?? null);
    const m = liveMark(cap.lastTrade, cap.quote, refCloses[t], cap.at, cfg.maxStaleMin[bucket], cfg.gapHalt[bucket]);
    marks[t] = m.price; markSources[t] = m.source;
    if (cap.error) markNotes.push(`live mark: ${t} read failed (${cap.error}) — settled close used`);
    else if (m.setAside) markNotes.push(`live mark: ${t} ${m.setAside} — settled close used`);
  }
  if (live) {
    const by = (s: MarkSource) => decisionTickers.filter((t) => markSources[t] === s);
    const fallback = by("close");
    markNotes.unshift(`live marks (${etHHMM(nowMs)}): ${by("trade").length} trade, ${by("quote").length} quote mid, ${fallback.length} settled ${markDate} close${fallback.length ? ` (${fallback.join(", ")})` : ""}`);
  } else if (cfg.markMode === "live") {
    markNotes.unshift(`markMode live, but this run is not inside today's ET session (today ${today}, now ${todayET(nowMs)} ${etHHMM(nowMs)}) — decided on the settled ${markDate} close`);
  }
  const ledger = reconcile({ asOf: today, account, positions, fills, brokerOrders, lockWindowStart });
  const todayDate = new Date(today + "T00:00:00Z");
  const signals = reports.map((r) => buildSignal(r, marks[r.meta.ticker], sics[r.meta.ticker] ?? null, todayDate, cfg));
  const locks = locksFor(fills, calendar, cfg.lockBusinessDays);
  const plan = emitTrades({ signals, currentWeights: weightsOf(ledger), locks, today, cfg });
  const mkts: Record<string, Mkt> = {};
  const anchorAtMs: Record<string, number> = {};
  // Execution market data: one trade + one quote per traded ticker. A live run reuses the decision's
  // own snapshot — one read per ticker per run, and the anchor is the very print the decision saw, so
  // execution's gap-halt and the decision's gap rule judge the same number. A settled run (or a ticker
  // whose live read failed) reads now: independent reads, a few tickers at once (each ticker's trade and
  // quote together). Either way anchorAtMs is when THAT ticker's data landed, so freshness is judged at
  // capture time.
  const mktTickers = [...new Set(plan.trades.map((t) => t.ticker))];
  const captured = await mapWithConcurrency(mktTickers, MARKET_DATA_CONCURRENCY, async (ticker) => {
    const cap = captures.get(ticker);
    if (cap && !cap.error) return { lastTrade: cap.lastTrade, quote: cap.quote, at: cap.at };
    const [lastTrade, quote] = await allInOrder([adapter.getLatestTrade(ticker), adapter.getLatestQuote(ticker)]);
    return { lastTrade, quote, at: clock() };
  });
  mktTickers.forEach((ticker, i) => {
    // close is the SETTLED prior close, never the live mark: gap-halt and the tier-3 anchor measure
    // today's price against it, so it must not move with the print it is checking.
    mkts[ticker] = { lastTrade: captured[i].lastTrade, quote: captured[i].quote, close: refCloses[ticker] };
    anchorAtMs[ticker] = captured[i].at;
  });
  const sized = tradesToOrders({ plan, nav: ledger.nav, marks, positions: positionsOf(ledger), marketCapUsd, mkts, nowMs, runId, cfg, anchorAtMs });
  const scenariosByTicker = new Map(reports.map((r) => [r.meta.ticker, r.sections.valuation.scenarios.map((x) => ({ name: x.name, impliedPrice: x.impliedPrice, probability: x.probability }))]));
  const record: RunRecord = {
    runId, today, markMode: live ? "live" : "settled", broker: adapter.kind, marks, refCloses, markSources,
    signals: signals.map((s) => ({
      ticker: s.ticker, label: s.label, gatedLabel: s.gatedLabel, mu: s.mu, R: s.R, kappa: s.kappa, quality: s.quality, ageDays: s.ageDays,
      price: s.price, sigma: s.sigma, sigmaDown: s.sigmaDown, D: s.D, staleness: s.staleness,
      scenarios: scenariosByTicker.get(s.ticker),
    })),
    classifications: plan.classifications, locks,
    plan: { frozenWeight: plan.frozenWeight, sizingTarget: plan.sizingTarget, plannedInvested: plan.plannedInvested, plannedCash: plan.plannedCash, buyScale: plan.buyScale, trades: plan.trades, skipped: plan.skipped },
    orders: sized.orders as unknown as Record<string, unknown>[], fills: [],
    notes: [
      ...markNotes,
      ...sized.skippedDust.map((d) => `dust skipped: ${d.ticker} $${d.deltaUsd.toFixed(2)}`),
      ...sized.skippedHalt.map((h) => `halt skipped: ${h.ticker} — ${h.reason}`),
    ],
  };
  return { ledger, calendar, markDate, marks, signals, locks, plan, sized, record };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The terminal broker outcome of one submitted order — the observability the run record persists (spec §2). */
export interface ExecutedOrder {
  /** "unknown": the submit's outcome could not be established — the order may exist at the broker. */
  clientOrderId: string; brokerId: string; status: BrokerOrderStatus | "unknown";
  filledQty: number; filledAvgPrice: number | null; submittedAt: string | null;
  /** Local timestamps (ISO): just before the submit request, when it returned, when the order was seen terminal. */
  submitStartAt?: string; submitAckAt?: string; terminalAt?: string | null;
}

/** A buy the broker's cash could not cover at submit time — never sent. */
export interface SkippedCash { ticker: string; clientOrderId: string; detail: string }

/** An order the broker (or the adapter, before sending) definitively refused — nothing was placed. */
export interface RejectedOrder { ticker: string; clientOrderId: string; detail: string }
/** A hybrid market remainder not sent because its whole-share limit leg filled nothing (the price ran past the cap). */
export interface SkippedLeg { ticker: string; clientOrderId: string; detail: string }

/** Why a run stopped submitting: a submit whose outcome could not be established. */
export interface SubmitAbort { ticker: string; clientOrderId: string; detail: string }

/** An order not sent because the submit cutoff (submitCutoffET) had passed — nothing was placed. */
export interface SkippedCutoff { ticker: string; clientOrderId: string; detail: string }

/**
 * Look for the order a lost submit may have placed — read-only, a few times, since a just-accepted
 * order can take seconds to appear in the broker's listing. Never resubmits.
 */
async function resolveUnknownSubmit(adapter: BrokerAdapter, req: SubmitOrderRequest, since: string, delaysMs: readonly number[]): Promise<{ order: BrokerOrder | null; detail: string }> {
  let detail = "not found at the broker";
  for (const ms of delaysMs) {
    await sleep(ms);
    try {
      const order = await adapter.findSubmitted(req, since);
      if (order) return { order, detail: "found" };
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === "AmbiguousOrderError") break; // more lookups won't disambiguate
    }
  }
  return { order: null, detail };
}

export async function executeOrders(input: {
  adapter: BrokerAdapter; sized: SizedOrders; ctx: GuardContext; runId: string; fillsPath: string; pollMs?: number; now?: () => number;
  /** Lookup schedule for a submit with an unknown outcome (default 2s, 5s, 10s). */
  resolveDelaysMs?: readonly number[];
  /**
   * Emulated IOC: polls (× pollMs) an IOC order may stay working before it is cancelled. Schwab has no
   * IOC duration, so its "IOC" limits go in as DAY orders and are cancelled here; a native IOC (Alpaca)
   * is terminal on the first poll. A market order gets marketPolls before the same cancel.
   */
  iocPolls?: number; marketPolls?: number;
  /**
   * Submit cutoff, absolute epoch ms (callers: today's cfg.submitCutoffET via etInstantOn). Checked
   * against now() before EVERY submit; once reached nothing more is sent and every remaining order comes
   * back in skippedCutoff. A late-starting run with many orders (an emulated IOC polls ~8 s, a market
   * order up to 30 s) therefore never submits into the close. Sells go first, so a cutoff can only leave
   * cash, never leverage. Unset → no cutoff (tests, the Phase-0 fake loop).
   */
  cutoffMs?: number;
}): Promise<{ fills: Fill[]; executed: ExecutedOrder[]; aborted?: SubmitAbort; skippedCash: SkippedCash[]; rejected: RejectedOrder[]; skippedLegs: SkippedLeg[]; skippedCutoff: SkippedCutoff[] }> {
  const { adapter, sized, ctx, runId, fillsPath, pollMs = 1000, now = Date.now, resolveDelaysMs = [2_000, 5_000, 10_000], iocPolls = 8, marketPolls = 30, cutoffMs } = input;
  // A cutoff that is NaN would never trip — refuse it before anything is sent.
  if (cutoffMs !== undefined && !Number.isFinite(cutoffMs)) throw new Error(`executeOrders: cutoffMs must be a finite epoch ms, got ${cutoffMs}`);
  const fills: Fill[] = [];
  const executed: ExecutedOrder[] = [];
  const skippedCash: SkippedCash[] = [];
  const rejected: RejectedOrder[] = [];
  const skippedLegs: SkippedLeg[] = [];
  const skippedCutoff: SkippedCutoff[] = [];
  /** Filled qty of each ticker's whole-share limit leg this run, by side — gates its market remainder. */
  const wholeFilled = new Map<string, number>();
  // Sells first: buys may be funded by sell proceeds, and the cash backstop only credits proceeds that
  // actually filled. Order within each side is the plan's.
  const ordered = [...sized.orders.filter((o) => o.side === "sell"), ...sized.orders.filter((o) => o.side === "buy")];
  for (let i = 0; i < ordered.length; i++) {
    const o = ordered[i];
    // Submit cutoff: first, before anything else about this order — past it, nothing more goes out.
    if (cutoffMs !== undefined && now() >= cutoffMs) {
      const detail = `submit cutoff ${etHHMM(cutoffMs)} passed — not sent`;
      for (const r of ordered.slice(i)) skippedCutoff.push({ ticker: r.ticker, clientOrderId: r.clientOrderId, detail });
      break;
    }
    if (o.leg === "frac" && (wholeFilled.get(`${o.side}|${o.ticker}`) ?? 0) <= 0) {
      skippedLegs.push({ ticker: o.ticker, clientOrderId: o.clientOrderId, detail: "whole-share limit leg filled nothing — not chasing the remainder at market" });
      continue;
    }
    // Poll window: bounded to just before this submit (60s slack for clock skew) so the broker listing
    // always contains the new order, however long the account's order history grows.
    const pollAfter = new Date(now() - 60_000).toISOString();
    const req: SubmitOrderRequest = { symbol: o.ticker, side: o.side, qty: o.qty, ...(o.type === "limit" ? { limitPrice: o.limitPrice } : {}), timeInForce: o.timeInForce, clientOrderId: o.clientOrderId,
      // The most an IOC limit order can spend or raise — the same measure as the turnover breaker (a market
      // leg is measured at the same τ-capped price). deltaUsd is the pre-sizing weight delta (about 2x a
      // tier-3 order after closeAnchorSizeMult).
      estNotionalUsd: o.qty * o.limitPrice };
    let order: BrokerOrder;
    const submitStartAt = new Date(now()).toISOString();
    try {
      order = await guardedSubmit(adapter, req, ctx);
    } catch (e) {
      if (e instanceof CashBackstopError) { skippedCash.push({ ticker: o.ticker, clientOrderId: o.clientOrderId, detail: e.message }); continue; } // never sent
      if (e instanceof OrderRejectedError) { // definitively refused — nothing placed; record it and carry on
        rejected.push({ ticker: o.ticker, clientOrderId: o.clientOrderId, detail: e.detail });
        executed.push({ clientOrderId: o.clientOrderId, brokerId: "", status: "rejected", filledQty: 0, filledAvgPrice: null, submittedAt: null, submitStartAt });
        continue;
      }
      if (!(e instanceof SubmitOutcomeUnknownError)) throw e;
      // The order may exist. Find it; NEVER resend it (a double fill, or a fill we can't record, is worse than a miss).
      const found = await resolveUnknownSubmit(adapter, req, e.submitStartAt, resolveDelaysMs);
      if (!found.order) {
        executed.push({ clientOrderId: o.clientOrderId, brokerId: "", status: "unknown", filledQty: 0, filledAvgPrice: null, submittedAt: e.submitStartAt, submitStartAt });
        // Stop the run: every later order would be planned against a book we can't vouch for.
        return { fills, executed, skippedCash, rejected, skippedLegs, skippedCutoff, aborted: { ticker: o.ticker, clientOrderId: o.clientOrderId, detail: `${e.message}; lookup: ${found.detail}` } };
      }
      order = found.order;
      ctx.counters.orders += 1; // it did go out — count it against the run caps as guardedSubmit would have
      ctx.counters.notionalUsd += Math.abs(req.estNotionalUsd);
      if (o.side === "buy") ctx.counters.buyNotionalUsd += Math.abs(req.estNotionalUsd);
    }
    const submitAckAt = new Date(now()).toISOString();
    const poll = async () => {
      await sleep(pollMs);
      const id = order.id;
      order = (await adapter.getOrders("all", pollAfter)).find((x) => x.id === id || x.clientOrderId === o.clientOrderId) ?? order;
    };
    const window = o.type === "limit" && o.timeInForce === "ioc" ? iocPolls : marketPolls;
    for (let i = 0; i < window && !TERMINAL_STATUSES.has(order.status); i++) await poll();
    if (!TERMINAL_STATUSES.has(order.status)) {
      // Emulated IOC / stuck market order: cancel whatever is still working, then wait for the broker to
      // settle it (a partial fill before the cancel is kept and recorded). A cancel that fails is not fatal:
      // an order still working at the next run makes reconcile halt, so it cannot be traded past silently.
      try { await adapter.cancelOrder(order.id); } catch { /* reported via the non-terminal status below */ }
      for (let i = 0; i < 30 && !TERMINAL_STATUSES.has(order.status); i++) await poll();
    }
    const terminalAt = TERMINAL_STATUSES.has(order.status) ? new Date(now()).toISOString() : null;
    executed.push({ clientOrderId: o.clientOrderId, brokerId: order.id, status: order.status, filledQty: order.filledQty, filledAvgPrice: order.filledAvgPrice, submittedAt: order.submittedAt, submitStartAt, submitAckAt, terminalAt });
    // True up the cash backstop: a buy reserved qty × limit at submit; it actually spent filledQty × avg
    // (an IOC that didn't fill releases its reservation). A sell raises cash only for what filled. A
    // working order that never went terminal keeps its full reservation (conservative).
    const spent = order.filledQty * (order.filledAvgPrice ?? 0);
    if (o.side === "buy" && TERMINAL_STATUSES.has(order.status)) ctx.counters.buyNotionalUsd += spent - Math.abs(req.estNotionalUsd);
    if (o.side === "sell") ctx.counters.sellProceedsUsd += spent;
    if (order.filledQty > 0 && order.filledAvgPrice != null && order.filledAt) {
      const fill: Fill = { ticker: o.ticker, side: o.side, qty: order.filledQty, price: order.filledAvgPrice, filledAt: order.filledAt, tradingDate: fillTradingDate(order.filledAt), orderId: order.id, runId };
      appendFill(fillsPath, fill);
      fills.push(fill);
    }
    if (o.leg === "whole") wholeFilled.set(`${o.side}|${o.ticker}`, order.filledQty);
  }
  return { fills, executed, skippedCash, rejected, skippedLegs, skippedCutoff };
}

/** Merge each order's terminal broker status/id/submittedAt onto the loose run-record orders, by clientOrderId (spec §2). */
export function mergeExecution(orders: Record<string, unknown>[], executed: ExecutedOrder[]): Record<string, unknown>[] {
  const byCid = new Map(executed.map((e) => [e.clientOrderId, e]));
  return orders.map((o) => {
    const e = byCid.get(o.clientOrderId as string);
    return e ? {
      ...o, brokerId: e.brokerId, status: e.status, submittedAt: e.submittedAt,
      filledQty: e.filledQty, filledAvgPrice: e.filledAvgPrice,
      submitStartAt: e.submitStartAt ?? null, submitAckAt: e.submitAckAt ?? null, terminalAt: e.terminalAt ?? null,
    } : o;
  });
}
