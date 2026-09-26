/**
 * ledger.ts — the current book as the broker reports it (spec §3). The broker is the source of
 * truth; this is a derived cache. reconcile() refuses to guess: a position the fills log cannot
 * explain halts the run so the operator appends the missing fill.
 */
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fill } from "./fills";
import { TERMINAL_STATUSES, type BrokerOrder } from "../broker/adapter";
import { todayET } from "./clock";
import type { TradingDay } from "./calendar";

const QTY_EPS = 1e-6;

export const LedgerPosition = z.object({ ticker: z.string(), qty: z.number().positive(), marketValue: z.number(), avgCost: z.number() });
export const Ledger = z.object({ asOf: z.string(), nav: z.number().positive(), cash: z.number(), positions: z.array(LedgerPosition) });
export type Ledger = z.infer<typeof Ledger>;

export class ReconcileError extends Error { constructor(msg: string) { super(msg); this.name = "ReconcileError"; } }

/**
 * `brokerOrders` (optional; absent = positions-only, exactly as before) turns reconcile into a full
 * compliance check over the lock window: every broker order that executed on or after
 * `lockWindowStart` must be recorded in fills.jsonl for its full filled quantity, joined on the
 * broker order id — so a missed SELL (which would leave buyLockUntil unset), an extra buy of a name
 * already held, a crash between submit and appendFill, or a manual trade in the account all halt the
 * run until the operator appends the fill. Any non-terminal order also halts: this engine only sends
 * IOC orders, so a working order means something else is trading the account.
 */
export function reconcile(input: {
  asOf: string; account: { equity: number; cash: number };
  positions: { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }[]; fills: Fill[];
  brokerOrders?: BrokerOrder[]; lockWindowStart?: TradingDay;
}): Ledger {
  const { asOf, account, positions, fills } = input;
  if (input.brokerOrders) checkOrdersRecorded(input.brokerOrders, fills, input.lockWindowStart ?? "0000-00-00");
  if (!(account.equity > 0)) throw new ReconcileError(`account equity ${account.equity} is not positive`);
  const live = positions.filter((p) => p.qty > 0);
  const bought = new Set(fills.filter((f) => f.side === "buy").map((f) => f.ticker));
  const unexplained = live.filter((p) => !bought.has(p.symbol)).map((p) => p.symbol);
  if (unexplained.length) {
    throw new ReconcileError(`broker holds ${unexplained.join(", ")} with no buy fill in fills.jsonl — append the missing fill(s) before running`);
  }
  return Ledger.parse({
    asOf, nav: account.equity, cash: account.cash,
    positions: live.map((p) => ({ ticker: p.symbol, qty: p.qty, marketValue: p.marketValue, avgCost: p.avgEntryPrice })),
  });
}

function checkOrdersRecorded(orders: BrokerOrder[], fills: Fill[], windowStart: TradingDay): void {
  const recorded = new Map<string, number>();
  for (const f of fills) recorded.set(f.orderId, (recorded.get(f.orderId) ?? 0) + f.qty);
  const problems: string[] = [];
  for (const o of orders) {
    const stamp = o.filledAt ?? o.submittedAt;
    const ms = stamp ? Date.parse(stamp) : NaN;
    if (Number.isFinite(ms) && todayET(ms) < windowStart) continue; // can't affect a lock that is still active
    if (!TERMINAL_STATUSES.has(o.status)) {
      problems.push(`open broker order ${o.id} ${o.side} ${o.symbol} (${o.status}) — this engine only sends IOC orders; cancel it or let it finish, then append any fill`);
      continue;
    }
    if (o.filledQty <= QTY_EPS) continue;
    const got = recorded.get(o.id) ?? 0;
    if (Math.abs(got - o.filledQty) > QTY_EPS) {
      problems.push(`broker order ${o.id} ${o.side} ${o.symbol} filled ${o.filledQty}, fills.jsonl records ${got} — append the fill (orderId ${o.id}; runId "manual" for a manual trade)`);
    }
  }
  if (problems.length) throw new ReconcileError(`broker orders not explained by fills.jsonl: ${problems.join("; ")}`);
}

export function weightsOf(l: Ledger): Record<string, number> {
  return Object.fromEntries(l.positions.map((p) => [p.ticker, p.marketValue / l.nav]));
}
export function positionsOf(l: Ledger): Record<string, { qty: number; marketValue: number }> {
  return Object.fromEntries(l.positions.map((p) => [p.ticker, { qty: p.qty, marketValue: p.marketValue }]));
}
export function readLedger(path: string): Ledger | null {
  return existsSync(path) ? Ledger.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}
export function writeLedger(path: string, l: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Ledger.parse(l), null, 2) + "\n");
}
