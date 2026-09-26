/**
 * pipeline.ts — one run, end to end, with the broker used only for reads in planRun (spec §7, §9, §10).
 * executeOrders is the only writer of fills.jsonl.
 */
import type { Report } from "../report.schema";
import { buildSignal, type Signal } from "../portfolio/signal";
import type { BrokerAdapter, BrokerOrderStatus } from "../broker/adapter";
import { TERMINAL_STATUSES } from "../broker/adapter";
import { CashBackstopError, guardedSubmit, type GuardContext } from "../broker/guards";
import { SubmitOutcomeUnknownError } from "../broker/http";
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

export interface PlanRunInput {
  adapter: BrokerAdapter; reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null>;
  fills: Fill[]; today: TradingDay; cfg: TradeConfig; runId: string;
  /** Execution-only freshness gate for computeLimit; never feeds the decision path. Default Date.now(). */
  nowMs?: number;
}
export interface PlanRunOutput {
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

export async function planRun(input: PlanRunInput): Promise<PlanRunOutput> {
  const { adapter, reports, sics, marketCapUsd, fills, today, cfg, runId, nowMs = Date.now() } = input;
  const calendar = (await adapter.getCalendar(shiftDays(today, -90), shiftDays(today, 45))).map((d) => d.date);
  assertCalendar(calendar);
  const markDate = cfg.markMode === "settled" || !isTradingDay(calendar, today) ? prevTradingDay(calendar, today) : today;
  const tickers = reports.map((r) => r.meta.ticker);
  const positions = await adapter.getPositions();
  const held = positions.map((p) => p.symbol);
  const marks = await adapter.getLastClose([...new Set([...tickers, ...held])], markDate);
  // Orders check (spec #7): look back over the lock window (+1 trading day of slack) — an older
  // execution cannot set a lock that is still active today.
  const lockWindowStart = calendar[Math.max(0, indexOnOrBefore(calendar, today) - (cfg.lockBusinessDays + 1))];
  const brokerOrders = cfg.reconcileOrders ? await adapter.getOrders("all", `${lockWindowStart}T00:00:00Z`) : undefined;
  const ledger = reconcile({ asOf: today, account: await adapter.getAccount(), positions, fills, brokerOrders, lockWindowStart });
  const todayDate = new Date(today + "T00:00:00Z");
  const signals = reports.map((r) => buildSignal(r, marks[r.meta.ticker], sics[r.meta.ticker] ?? null, todayDate, cfg));
  const locks = locksFor(fills, calendar, cfg.lockBusinessDays);
  const plan = emitTrades({ signals, currentWeights: weightsOf(ledger), locks, today, cfg });
  const mkts: Record<string, Mkt> = {};
  for (const t of plan.trades) {
    if (mkts[t.ticker]) continue;
    mkts[t.ticker] = { lastTrade: await adapter.getLatestTrade(t.ticker), quote: await adapter.getLatestQuote(t.ticker), close: marks[t.ticker] };
  }
  const sized = tradesToOrders({ plan, nav: ledger.nav, marks, positions: positionsOf(ledger), marketCapUsd, mkts, nowMs, runId, cfg });
  const record: RunRecord = {
    runId, today, markMode: cfg.markMode, broker: adapter.kind, marks,
    signals: signals.map((s) => ({ ticker: s.ticker, label: s.label, gatedLabel: s.gatedLabel, mu: s.mu, R: s.R, kappa: s.kappa, quality: s.quality, ageDays: s.ageDays })),
    classifications: plan.classifications, locks,
    plan: { frozenWeight: plan.frozenWeight, sizingTarget: plan.sizingTarget, plannedInvested: plan.plannedInvested, plannedCash: plan.plannedCash, buyScale: plan.buyScale, trades: plan.trades, skipped: plan.skipped },
    orders: sized.orders as unknown as Record<string, unknown>[], fills: [],
    notes: [
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
}

/** A buy the broker's cash could not cover at submit time — never sent. */
export interface SkippedCash { ticker: string; clientOrderId: string; detail: string }

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
}): Promise<{ fills: Fill[]; executed: ExecutedOrder[]; aborted?: SubmitAbort; skippedCash: SkippedCash[] }> {
  const { adapter, sized, ctx, runId, fillsPath, pollMs = 1000, now = Date.now, resolveDelaysMs = [2_000, 5_000, 10_000] } = input;
  const fills: Fill[] = [];
  const executed: ExecutedOrder[] = [];
  const skippedCash: SkippedCash[] = [];
  // Sells first: buys may be funded by sell proceeds, and the cash backstop only credits proceeds that
  // actually filled. Order within each side is the plan's.
  const ordered = [...sized.orders.filter((o) => o.side === "sell"), ...sized.orders.filter((o) => o.side === "buy")];
  for (const o of ordered) {
    // Poll window: bounded to just before this submit (60s slack for clock skew) so the broker listing
    // always contains the new order, however long the account's order history grows.
    const pollAfter = new Date(now() - 60_000).toISOString();
    const req: SubmitOrderRequest = { symbol: o.ticker, side: o.side, qty: o.qty, limitPrice: o.limitPrice, timeInForce: o.timeInForce, clientOrderId: o.clientOrderId,
      // The most an IOC limit order can spend or raise — the same measure as the turnover breaker. deltaUsd
      // is the pre-sizing weight delta (about 2x a tier-3 order after closeAnchorSizeMult).
      estNotionalUsd: o.qty * o.limitPrice };
    let order: BrokerOrder;
    try {
      order = await guardedSubmit(adapter, req, ctx);
    } catch (e) {
      if (e instanceof CashBackstopError) { skippedCash.push({ ticker: o.ticker, clientOrderId: o.clientOrderId, detail: e.message }); continue; } // never sent
      if (!(e instanceof SubmitOutcomeUnknownError)) throw e;
      // The order may exist. Find it; NEVER resend it (a double fill, or a fill we can't record, is worse than a miss).
      const found = await resolveUnknownSubmit(adapter, req, e.submitStartAt, resolveDelaysMs);
      if (!found.order) {
        executed.push({ clientOrderId: o.clientOrderId, brokerId: "", status: "unknown", filledQty: 0, filledAvgPrice: null, submittedAt: e.submitStartAt });
        // Stop the run: every later order would be planned against a book we can't vouch for.
        return { fills, executed, skippedCash, aborted: { ticker: o.ticker, clientOrderId: o.clientOrderId, detail: `${e.message}; lookup: ${found.detail}` } };
      }
      order = found.order;
      ctx.counters.orders += 1; // it did go out — count it against the run caps as guardedSubmit would have
      ctx.counters.notionalUsd += Math.abs(req.estNotionalUsd);
      if (o.side === "buy") ctx.counters.buyNotionalUsd += Math.abs(req.estNotionalUsd);
    }
    for (let i = 0; i < 60 && !TERMINAL_STATUSES.has(order.status); i++) {
      await sleep(pollMs);
      const id = order.id;
      order = (await adapter.getOrders("all", pollAfter)).find((x) => x.id === id || x.clientOrderId === o.clientOrderId) ?? order;
    }
    executed.push({ clientOrderId: o.clientOrderId, brokerId: order.id, status: order.status, filledQty: order.filledQty, filledAvgPrice: order.filledAvgPrice, submittedAt: order.submittedAt });
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
  }
  return { fills, executed, skippedCash };
}

/** Merge each order's terminal broker status/id/submittedAt onto the loose run-record orders, by clientOrderId (spec §2). */
export function mergeExecution(orders: Record<string, unknown>[], executed: ExecutedOrder[]): Record<string, unknown>[] {
  const byCid = new Map(executed.map((e) => [e.clientOrderId, e]));
  return orders.map((o) => {
    const e = byCid.get(o.clientOrderId as string);
    return e ? { ...o, brokerId: e.brokerId, status: e.status, submittedAt: e.submittedAt } : o;
  });
}
