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
import type { TradeConfig } from "./config";
import { assertCalendar, prevTradingDay, isTradingDay, indexOnOrBefore, type TradingDay } from "./calendar";
import { appendFill, type Fill } from "./fills";
import { locksFor, type Locks } from "./locks";
import { reconcile, weightsOf, positionsOf, type Ledger } from "./ledger";
import { emitTrades, type TradePlan } from "./rebalance";
import { tradesToOrders, type SizedOrders } from "./orders";
import type { Mkt } from "./limit";
import type { RunRecord } from "./run-record";
import { todayET } from "./clock";
import { classifyBreach, type BreachInfo } from "./breach";
import { betaFromSic } from "../synth/moat";
import { toYmd } from "../calibration/realized";

export interface PlanRunInput {
  adapter: BrokerAdapter; reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null>;
  fills: Fill[]; today: TradingDay; cfg: TradeConfig; runId: string;
  /** Execution-only freshness gate for computeLimit; never feeds the decision path. Default Date.now(). */
  nowMs?: number;
  /**
   * Wall clock read per ticker as its market data is captured, so freshness is judged when the quote was
   * fetched, not at run start (it is read right after THAT ticker's trade+quote land; tickers are
   * fetched a few at a time). Default: a clock frozen at nowMs.
   */
  clock?: () => number;
  /** Equity beta by ticker (FactPack: measured, else the SIC proxy; null = no pack) — prices a bear breach's market part. */
  betas?: Record<string, number | null>;
}
export interface PlanRunOutput {
  ledger: Ledger; calendar: TradingDay[]; markDate: TradingDay; marks: Record<string, number>; signals: Signal[];
  locks: Locks; plan: TradePlan; sized: SizedOrders; record: RunRecord;
  /** The cause of each held bear breach that could be priced (breach.ts); a breach missing here took the plain exit. */
  breaches: Record<string, BreachInfo>;
}

/** The fill's ET trading date — the lock clock starts here. Broker timestamps are UTC ("…Z" or "+0000"). */
export function fillTradingDate(filledAt: string): TradingDay {
  const ms = Date.parse(filledAt);
  return Number.isFinite(ms) ? todayET(ms) : filledAt.slice(0, 10);
}

// Pure date arithmetic on YYYY-MM-DD labels — UTC is correct here (no wall clock involved).
const shiftDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Max tickers whose execution market data is fetched at once (each is 2 reads) — bounded for broker rate limits. */
const MARKET_DATA_CONCURRENCY = 4;

export async function planRun(input: PlanRunInput): Promise<PlanRunOutput> {
  const { adapter, reports, sics, marketCapUsd, fills, today, cfg, runId, nowMs = Date.now() } = input;
  const clock = input.clock ?? (() => nowMs);
  // Independent reads run concurrently, but the BOOK reads keep their order: positions → orders →
  // account, each strictly after the previous returns. Reading orders after positions guarantees any
  // fill already reflected in the positions snapshot is visible to the orders check in reconcile.
  // The calendar (static) and the marks (prior closes) carry no book state, so they overlap freely.
  const [calendarDays, positions] = await allInOrder([adapter.getCalendar(shiftDays(today, -90), shiftDays(today, 45)), adapter.getPositions()]);
  const calendar = calendarDays.map((d) => d.date);
  assertCalendar(calendar);
  const markDate = cfg.markMode === "settled" || !isTradingDay(calendar, today) ? prevTradingDay(calendar, today) : today;
  const tickers = reports.map((r) => r.meta.ticker);
  const held = positions.map((p) => p.symbol);
  // Orders check (spec #7): look back over the lock window (+1 trading day of slack) — an older
  // execution cannot set a lock that is still active today.
  const lockWindowStart = calendar[Math.max(0, indexOnOrBefore(calendar, today) - (cfg.lockBusinessDays + 1))];
  const [marks, { brokerOrders, account }] = await allInOrder([
    adapter.getLastClose([...new Set([...tickers, ...held])], markDate),
    (async () => {
      const brokerOrders = cfg.reconcileOrders ? await adapter.getOrders("all", `${lockWindowStart}T00:00:00Z`) : undefined;
      return { brokerOrders, account: await adapter.getAccount() };
    })(),
  ]);
  const ledger = reconcile({ asOf: today, account, positions, fills, brokerOrders, lockWindowStart });
  const todayDate = new Date(today + "T00:00:00Z");
  const signals = reports.map((r) => buildSignal(r, marks[r.meta.ticker], sics[r.meta.ticker] ?? null, todayDate, cfg));
  const locks = locksFor(fills, calendar, cfg.lockBusinessDays);
  // Bear breaches (docs/engine.md §4.2): a held name past its bear case is held, frozen or exited by the cause of
  // its fall. spyDecisionMark MUST read SPY from the same source and date as the decision marks above — the market
  // move has to be measured on the stock's own clock. If the decision marks change (e.g. to live prices), change it with them.
  const spyDecisionMark = async (): Promise<number> => (await adapter.getLastClose(["SPY"], markDate)).SPY;
  const breach = await bearBreaches({ adapter, reports, signals, weights: weightsOf(ledger), markDate, calendar, sics, betas: input.betas ?? {}, cfg, spyDecisionMark });
  const plan = emitTrades({ signals, currentWeights: weightsOf(ledger), locks, today, cfg, breaches: breach.info });
  const mkts: Record<string, Mkt> = {};
  const anchorAtMs: Record<string, number> = {};
  // Execution market data: one trade + one quote read per traded ticker, independent reads, so a few
  // tickers are fetched at once (and each ticker's trade and quote together). anchorAtMs is read the
  // moment THAT ticker's data lands, so freshness is still judged at capture time.
  const mktTickers = [...new Set(plan.trades.map((t) => t.ticker))];
  const captured = await mapWithConcurrency(mktTickers, MARKET_DATA_CONCURRENCY, async (ticker) => {
    const [lastTrade, quote] = await allInOrder([adapter.getLatestTrade(ticker), adapter.getLatestQuote(ticker)]);
    return { mkt: { lastTrade, quote, close: marks[ticker] } as Mkt, at: clock() };
  });
  mktTickers.forEach((ticker, i) => { mkts[ticker] = captured[i].mkt; anchorAtMs[ticker] = captured[i].at; });
  const sized = tradesToOrders({ plan, nav: ledger.nav, marks, positions: positionsOf(ledger), marketCapUsd, mkts, nowMs, runId, cfg, anchorAtMs });
  const scenariosByTicker = new Map(reports.map((r) => [r.meta.ticker, r.sections.valuation.scenarios.map((x) => ({ name: x.name, impliedPrice: x.impliedPrice, probability: x.probability }))]));
  const record: RunRecord = {
    runId, today, markMode: cfg.markMode, broker: adapter.kind, marks,
    signals: signals.map((s) => ({
      ticker: s.ticker, label: s.label, gatedLabel: s.gatedLabel, mu: s.mu, R: s.R, kappa: s.kappa, quality: s.quality, ageDays: s.ageDays,
      price: s.price, sigma: s.sigma, sigmaDown: s.sigmaDown, D: s.D, staleness: s.staleness,
      scenarios: scenariosByTicker.get(s.ticker),
    })),
    classifications: plan.classifications, locks, breaches: breach.info,
    plan: { frozenWeight: plan.frozenWeight, sizingTarget: plan.sizingTarget, plannedInvested: plan.plannedInvested, plannedCash: plan.plannedCash, buyScale: plan.buyScale, trades: plan.trades, skipped: plan.skipped },
    orders: sized.orders as unknown as Record<string, unknown>[], fills: [],
    notes: [
      ...sized.skippedDust.map((d) => `dust skipped: ${d.ticker} $${d.deltaUsd.toFixed(2)}`),
      ...sized.skippedHalt.map((h) => `halt skipped: ${h.ticker} — ${h.reason}`),
      ...breach.unknown.map((u) => `bear breach ${u.ticker}: cause unknown (${u.why}) — plain bear-breach exit`),
    ],
  };
  return { ledger, calendar, markDate, marks, signals, locks, plan, sized, record, breaches: breach.info };
}

/**
 * The cause of each held bear breach (breach.ts). Reads SPY only under breachPolicy "byCause" and only when a held
 * name's signal is past its bear (R null, D ≤ 0) — no other run touches SPY. Every miss (no report price or price
 * date, no beta, a SPY close the broker can't supply, a non-finite number) leaves the name out of `info`, and a
 * name left out takes the plain bear-breach exit: missing data never holds a name. Never throws.
 */
export async function bearBreaches(i: {
  adapter: BrokerAdapter; reports: Report[]; signals: Signal[]; weights: Record<string, number>; markDate: TradingDay;
  calendar: TradingDay[]; sics: Record<string, number | null>; betas: Record<string, number | null>; cfg: TradeConfig;
  /** SPY at the decision mark — the same source and date as the stock's mark (see planRun). */
  spyDecisionMark: () => Promise<number>;
}): Promise<{ info: Record<string, BreachInfo>; unknown: { ticker: string; why: string }[] }> {
  const info: Record<string, BreachInfo> = {}, unknown: { ticker: string; why: string }[] = [];
  if (i.cfg.breachPolicy !== "byCause") return { info, unknown };
  const breached = i.signals.filter((s) => (i.weights[s.ticker] ?? 0) > 0 && s.R == null && s.D <= 0);
  if (!breached.length) return { info, unknown };
  const reportOf = new Map(i.reports.map((r) => [r.meta.ticker, r]));
  // One read per distinct SPY date in the run; a failed read (or a non-positive close) is null, never a throw.
  const spy = new Map<string, Promise<number | null>>();
  const spyOnce = (key: string, read: () => Promise<number>) => {
    if (!spy.has(key)) spy.set(key, Promise.resolve().then(read).then((x) => (Number.isFinite(x) && x > 0 ? x : null), () => null));
    return spy.get(key)!;
  };
  for (const s of breached) {
    try {
      const r = reportOf.get(s.ticker);
      const p0 = r?.quote?.currentPrice;
      const asOf = toYmd(r?.meta?.asOf); // the report price's date ("Sep 11, 2026")
      if (!(typeof p0 === "number" && p0 > 0) || !asOf) { unknown.push({ ticker: s.ticker, why: "no report price/date" }); continue; }
      if (asOf > i.markDate) { unknown.push({ ticker: s.ticker, why: `report priced ${asOf}, after the ${i.markDate} mark` }); continue; }
      // Measured beta (or the SIC proxy the FactPack implies); with neither a beta nor a SIC there is no beta to use.
      const measured = i.betas[s.ticker];
      const sic = i.sics[s.ticker];
      const beta = typeof measured === "number" && Number.isFinite(measured) && measured > 0 ? measured : sic != null ? betaFromSic(sic) : null;
      if (beta == null) { unknown.push({ ticker: s.ticker, why: "no beta" }); continue; }
      // SPY on the report's price date — the trading day on/before it when the loaded calendar covers it (a
      // weekend/holiday asOf), else the broker's own on/before lookup.
      const k = indexOnOrBefore(i.calendar, asOf);
      const spyDate = k >= 0 ? i.calendar[k] : asOf;
      const [spyNow, spy0] = await Promise.all([
        spyOnce("decision-mark", i.spyDecisionMark),
        spyOnce(spyDate, async () => (await i.adapter.getLastClose(["SPY"], spyDate)).SPY),
      ]);
      if (spyNow == null || spy0 == null) { unknown.push({ ticker: s.ticker, why: `no SPY close for ${spyNow == null ? `the ${i.markDate} mark` : spyDate}` }); continue; }
      // s.price is the decision mark the signal (and so the breach) was judged on.
      const b = classifyBreach({ price: s.price, p0, spyNow, spy0, beta }, i.cfg);
      if (b) info[s.ticker] = b; else unknown.push({ ticker: s.ticker, why: "inputs out of range" });
    } catch (e) {
      unknown.push({ ticker: s.ticker, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { info, unknown };
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
}): Promise<{ fills: Fill[]; executed: ExecutedOrder[]; aborted?: SubmitAbort; skippedCash: SkippedCash[]; rejected: RejectedOrder[]; skippedLegs: SkippedLeg[] }> {
  const { adapter, sized, ctx, runId, fillsPath, pollMs = 1000, now = Date.now, resolveDelaysMs = [2_000, 5_000, 10_000], iocPolls = 8, marketPolls = 30 } = input;
  const fills: Fill[] = [];
  const executed: ExecutedOrder[] = [];
  const skippedCash: SkippedCash[] = [];
  const rejected: RejectedOrder[] = [];
  const skippedLegs: SkippedLeg[] = [];
  /** Filled qty of each ticker's whole-share limit leg this run, by side — gates its market remainder. */
  const wholeFilled = new Map<string, number>();
  // Sells first: buys may be funded by sell proceeds, and the cash backstop only credits proceeds that
  // actually filled. Order within each side is the plan's.
  const ordered = [...sized.orders.filter((o) => o.side === "sell"), ...sized.orders.filter((o) => o.side === "buy")];
  for (const o of ordered) {
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
        return { fills, executed, skippedCash, rejected, skippedLegs, aborted: { ticker: o.ticker, clientOrderId: o.clientOrderId, detail: `${e.message}; lookup: ${found.detail}` } };
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
  return { fills, executed, skippedCash, rejected, skippedLegs };
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
