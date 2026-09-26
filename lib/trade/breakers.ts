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

/**
 * Clip-instead-of-halt for a plan that only OPENS positions (every order an ENTER buy): keep whole
 * orders, largest target first, while the run's notional stays within maxRunTurnoverFrac × NAV; the
 * rest wait for later runs. Any sell, ADD or TRIM makes the plan unclippable (null → halt as before),
 * so a runaway rebalance or a wrongly-flat book with trims still trips the breaker. It never raises
 * the cap: every run stays within it, whatever reconcile believed. Orders are never resized.
 */
export function clipToTurnover<T extends { qty: number; limitPrice: number; reason: string; side: "buy" | "sell"; deltaUsd: number }>(
  orders: T[], nav: number, cfg: TradeConfig,
): { kept: T[]; clipped: T[] } | null {
  if (!orders.length || orders.some((o) => o.reason !== "ENTER" || o.side !== "buy")) return null;
  const cap = cfg.maxRunTurnoverFrac * nav;
  const kept: T[] = [], clipped: T[] = [];
  let used = 0;
  // deltaUsd of an ENTER is target weight × NAV, so this is "largest target first".
  for (const o of [...orders].sort((a, b) => b.deltaUsd - a.deltaUsd)) {
    const n = Math.abs(o.qty * o.limitPrice);
    if (used + n <= cap + 1e-9) { kept.push(o); used += n; } else clipped.push(o);
  }
  return { kept, clipped };
}

export interface HaltState { consecutive: number }

/**
 * Absent state file → {consecutive:0} (first run ever). Any other failure — corrupt JSON, wrong
 * shape, a permission error — throws rather than silently reporting "all clear": this counter is
 * what stops automated trading after repeated trouble, so a broken read must fail loud, not fail
 * open. Mirrors lib/reports.ts's ENOENT-only catch (lines 41-44).
 */
export function readHaltState(path: string): HaltState {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { consecutive: 0 };
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed?.consecutive !== "number" || !Number.isFinite(parsed.consecutive) || parsed.consecutive < 0) {
    throw new Error(`halt state file ${path} is corrupt: expected {consecutive: number >= 0}, got ${raw}`);
  }
  return { consecutive: parsed.consecutive };
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
 * Default staleness threshold for acquireLock: comfortably beyond the scheduler's 30-min
 * ExecutionTimeLimit, so a genuinely still-running cron never has its lock reclaimed out from
 * under it, while a hard-killed/hung run (whose `finally` never ran, so the lock file was never
 * released) doesn't silently halt every future run forever.
 */
export const DEFAULT_LOCK_STALE_MS = 60 * 60_000; // 60 min

/**
 * Exclusive run-lock: the presence of the lock file IS the lock. Uses the "wx" flag (create,
 * fail if it exists) so the check-and-create is one atomic syscall rather than an
 * existsSync + writeFileSync race between two cron invocations starting at once.
 *
 * Stale-lock recovery: on EEXIST, read the existing lock's own `${pid} ${ISO timestamp}` body. If
 * its timestamp is older than `staleMs`, the lock is treated as abandoned (the process that held
 * it was killed or hung past the scheduler's time limit, so its `finally`-release never ran) —
 * remove it and re-acquire. A timestamp that is still fresh, or that can't be parsed at all
 * (unexpected/garbage content), is treated conservatively as still held: return false. No
 * PID-liveness check — cross-platform fiddly, and the timestamp threshold is enough.
 */
export function acquireLock(path: string, staleMs: number = DEFAULT_LOCK_STALE_MS): boolean {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    let existing: string;
    try {
      existing = readFileSync(path, "utf8");
    } catch {
      return false; // lock vanished between our EEXIST and this read — report held, don't guess
    }
    const lockMs = Date.parse(existing.split(" ")[1] ?? "");
    if (!Number.isFinite(lockMs) || Date.now() - lockMs <= staleMs) return false;
    try {
      // force:true — a concurrent reclaimer (or the original owner's releaseLock) may have
      // already removed this file; an ENOENT here must not escape as an uncaught throw.
      rmSync(path, { force: true });
      writeFileSync(path, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
      return true;
    } catch (err2) {
      if ((err2 as NodeJS.ErrnoException).code === "EEXIST") return false; // lost the race to reclaim
      throw err2;
    }
  }
}

export function releaseLock(path: string): void {
  try { rmSync(path); } catch { /* already gone */ }
}
