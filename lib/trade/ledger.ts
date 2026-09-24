/**
 * ledger.ts — the current book as the broker reports it (spec §3). The broker is the source of
 * truth; this is a derived cache. reconcile() refuses to guess: a position the fills log cannot
 * explain halts the run so the operator appends the missing fill.
 */
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fill } from "./fills";

export const LedgerPosition = z.object({ ticker: z.string(), qty: z.number().positive(), marketValue: z.number(), avgCost: z.number() });
export const Ledger = z.object({ asOf: z.string(), nav: z.number().positive(), cash: z.number(), positions: z.array(LedgerPosition) });
export type Ledger = z.infer<typeof Ledger>;

export class ReconcileError extends Error { constructor(msg: string) { super(msg); this.name = "ReconcileError"; } }

export function reconcile(input: {
  asOf: string; account: { equity: number; cash: number };
  positions: { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }[]; fills: Fill[];
}): Ledger {
  const { asOf, account, positions, fills } = input;
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
