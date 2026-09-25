/**
 * breakers.ts — run-level circuit breakers (spec §7/§5): a turnover cap, a consecutive-halt
 * counter that blocks further runs, and an exclusive run-lock so cron can't overlap itself.
 * fs-state style matches fills.ts/ledger.ts: reads try/catch to a safe default for an absent
 * file, writes mkdir the parent first (state dirs are created on demand, same as ledger.ts).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TradeConfig } from "./config";

/**
 * Sums |qty * limitPrice| across orders as the run's traded notional and trips when that
 * notional exceeds maxRunTurnoverFrac × NAV. Takes the minimal order shape (qty, limitPrice)
 * rather than the full OrderRequest — the real OrderRequest (orders.ts) satisfies this
 * structurally, so callers can pass OrderRequest[] directly.
 */
export function turnoverBreaker(orders: { qty: number; limitPrice: number }[], nav: number, cfg: TradeConfig): { tripped: boolean; frac: number } {
  const notional = orders.reduce((a, o) => a + Math.abs(o.qty * o.limitPrice), 0);
  const frac = nav > 0 ? notional / nav : 0;
  return { tripped: frac > cfg.maxRunTurnoverFrac, frac };
}

export interface HaltState { consecutive: number }

export function readHaltState(path: string): HaltState {
  try { return JSON.parse(readFileSync(path, "utf8")) as HaltState; } catch { return { consecutive: 0 }; }
}

export function bumpHalt(path: string): HaltState {
  const s: HaltState = { consecutive: readHaltState(path).consecutive + 1 };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s));
  return s;
}

export function clearHalt(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ consecutive: 0 } satisfies HaltState));
}

export function haltBlocked(state: HaltState, cfg: TradeConfig): boolean {
  return state.consecutive >= cfg.consecutiveHaltLimit;
}

/**
 * Exclusive run-lock: the presence of the lock file IS the lock. Uses the "wx" flag (create,
 * fail if it exists) so the check-and-create is one atomic syscall rather than an
 * existsSync + writeFileSync race between two cron invocations starting at once.
 */
export function acquireLock(path: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

export function releaseLock(path: string): void {
  try { rmSync(path); } catch { /* already gone */ }
}
