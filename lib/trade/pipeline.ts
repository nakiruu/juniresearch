/**
 * pipeline.ts — one run, end to end, with the broker used only for reads in planRun (spec §7, §9, §10).
 * executeOrders is the only writer of fills.jsonl.
 */
import type { Report } from "../report.schema";
import { buildSignal, type Signal } from "../portfolio/signal";
import type { BrokerAdapter, BrokerOrderStatus } from "../broker/adapter";
import { TERMINAL_STATUSES } from "../broker/adapter";
import { guardedSubmit, type GuardContext } from "../broker/guards";
import type { TradeConfig } from "./config";
import { assertCalendar, prevTradingDay, isTradingDay, type TradingDay } from "./calendar";
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
  const ledger = reconcile({ asOf: today, account: await adapter.getAccount(), positions, fills });
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
  clientOrderId: string; brokerId: string; status: BrokerOrderStatus;
  filledQty: number; filledAvgPrice: number | null; submittedAt: string | null;
}

export async function executeOrders(input: { adapter: BrokerAdapter; sized: SizedOrders; ctx: GuardContext; runId: string; fillsPath: string; pollMs?: number }): Promise<{ fills: Fill[]; executed: ExecutedOrder[] }> {
  const { adapter, sized, ctx, runId, fillsPath, pollMs = 1000 } = input;
  const fills: Fill[] = [];
  const executed: ExecutedOrder[] = [];
  for (const o of sized.orders) {
    let order = await guardedSubmit(adapter, { symbol: o.ticker, side: o.side, qty: o.qty, limitPrice: o.limitPrice, timeInForce: o.timeInForce, clientOrderId: o.clientOrderId, estNotionalUsd: o.deltaUsd }, ctx);
    for (let i = 0; i < 60 && !TERMINAL_STATUSES.has(order.status); i++) {
      await sleep(pollMs);
      order = (await adapter.getOrders("all")).find((x) => x.clientOrderId === o.clientOrderId) ?? order;
    }
    executed.push({ clientOrderId: o.clientOrderId, brokerId: order.id, status: order.status, filledQty: order.filledQty, filledAvgPrice: order.filledAvgPrice, submittedAt: order.submittedAt });
    if (order.filledQty > 0 && order.filledAvgPrice != null && order.filledAt) {
      const fill: Fill = { ticker: o.ticker, side: o.side, qty: order.filledQty, price: order.filledAvgPrice, filledAt: order.filledAt, tradingDate: fillTradingDate(order.filledAt), orderId: order.id, runId };
      appendFill(fillsPath, fill);
      fills.push(fill);
    }
  }
  return { fills, executed };
}

/** Merge each order's terminal broker status/id/submittedAt onto the loose run-record orders, by clientOrderId (spec §2). */
export function mergeExecution(orders: Record<string, unknown>[], executed: ExecutedOrder[]): Record<string, unknown>[] {
  const byCid = new Map(executed.map((e) => [e.clientOrderId, e]));
  return orders.map((o) => {
    const e = byCid.get(o.clientOrderId as string);
    return e ? { ...o, brokerId: e.brokerId, status: e.status, submittedAt: e.submittedAt } : o;
  });
}
