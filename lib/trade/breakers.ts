/**
 * breakers.ts — run-level circuit breakers (spec §7/§5): a turnover cap, a consecutive-halt
 * counter that blocks further runs, and an exclusive run-lock so cron can't overlap itself.
 * fs-state style matches fills.ts/ledger.ts: reads try/catch to a safe default for an absent
 * file, writes mkdir the parent first (state dirs are created on demand, same as ledger.ts).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { writeFileAtomic } from "../atomic-write";
import { dirname, join } from "node:path";
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
 * Clip-instead-of-halt for a BUY-ONLY plan (every order a buy — ENTER or ADD, no sells): keep whole
 * orders, largest target first, while the run's notional stays within maxRunTurnoverFrac × NAV; the
 * rest wait for later runs. This is what lets a first rebalance bring an existing book to target
 * gradually — deploying idle cash into new names AND topping up underweights — a few percent of NAV
 * per run rather than halting on the whole gap. Any SELL (TRIM or EXIT) makes the plan unclippable
 * (null → halt as before): a sell-side rebalance is exactly the churn the breaker exists to gate, and
 * a wrongly-flat book that would re-buy the whole target is capped at the cap here regardless. It
 * never raises the cap: every run stays within it, whatever reconcile believed. Orders are never resized.
 */
export function clipToTurnover<T extends { qty: number; limitPrice: number; reason: string; side: "buy" | "sell"; deltaUsd: number }>(
  orders: T[], nav: number, cfg: TradeConfig, capUsd: number = cfg.maxRunTurnoverFrac * nav,
): { kept: T[]; clipped: T[] } | null {
  if (!orders.length || orders.some((o) => o.side !== "buy")) return null;
  const cap = capUsd;
  const kept: T[] = [], clipped: T[] = [];
  let used = 0;
  // deltaUsd of an ENTER is target weight × NAV, so this is "largest target first".
  for (const o of [...orders].sort((a, b) => b.deltaUsd - a.deltaUsd)) {
    const n = Math.abs(o.qty * o.limitPrice);
    if (used + n <= cap + 1e-9) { kept.push(o); used += n; } else clipped.push(o);
  }
  return { kept, clipped };
}

/**
 * Notional already traded today across earlier runs (Σ filledQty × filledAvgPrice over today's run
 * records) — the daily turnover cap's running total. Run records without fill fields count as 0;
 * an unreadable record throws (a cap that silently under-counts would fail open).
 */
export function dayTurnoverUsd(runsDir: string, today: string): number {
  if (!existsSync(runsDir)) return 0;
  let total = 0;
  for (const f of readdirSync(runsDir).filter((x) => x.endsWith(".json"))) {
    const rec = JSON.parse(readFileSync(join(runsDir, f), "utf8")) as { today?: string; orders?: { filledQty?: number; filledAvgPrice?: number | null }[] };
    if (rec.today !== today) continue;
    for (const o of rec.orders ?? []) total += Math.abs((o.filledQty ?? 0) * (o.filledAvgPrice ?? 0));
  }
  return total;
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
  writeFileAtomic(path, JSON.stringify(s));
  return s;
}

export function clearHalt(path: string): void {
  writeFileAtomic(path, JSON.stringify({ consecutive: 0 } satisfies HaltState));
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
 * remove it and re-acquire. A timestamp that is still fresh is held: return false. A body that can't be
 * parsed at all (garbage, a torn write) is judged by the lock file's mtime against the same threshold.
 * The body carries a random token as a third field (`${pid} ${ISO} ${hex}`) so holdLock can tell its own
 * lock from a reclaimer's. No PID-liveness check — cross-platform fiddly, and the threshold is enough.
 */
const lockBody = () => `${process.pid} ${new Date().toISOString()} ${randomBytes(4).toString("hex")}`;

/** A reclaim takes milliseconds; a `.reclaim` mutex older than this was left by a reclaimer that died mid-way. */
const RECLAIM_MUTEX_STALE_MS = 60_000;

function takeReclaimMutex(mutex: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(mutex, lockBody(), { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let ageMs: number;
      try { ageMs = Date.now() - statSync(mutex).mtimeMs; } catch { continue; } // released meanwhile: try once more
      if (attempt > 0 || ageMs <= RECLAIM_MUTEX_STALE_MS) return false; // another reclaim is in progress
      rmSync(mutex, { force: true }); // abandoned by a crashed reclaimer
    }
  }
  return false;
}

/**
 * acquireLock, returning the exact body written (null = held). Holders keep this body rather than reading the file
 * back, so a lock overwritten in between is never mistaken for their own (review M-1).
 *
 * A stale lock is reclaimed only under a `${path}.reclaim` wx mutex, and only if the lock still holds exactly the
 * body that was judged stale: two reclaimers can no longer both win (one deleting the other's fresh lock).
 */
function acquireLockBody(path: string, staleMs: number): string | null {
  mkdirSync(dirname(path), { recursive: true });
  const body = lockBody();
  try {
    writeFileSync(path, body, { flag: "wx" });
    return body;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    let existing: string;
    try {
      existing = readFileSync(path, "utf8");
    } catch {
      return null; // lock vanished between our EEXIST and this read — report held, don't guess
    }
    let lockMs = Date.parse(existing.split(" ")[1] ?? "");
    // An unparseable body (garbage, a torn write) is judged by the file's age instead of being held forever.
    if (!Number.isFinite(lockMs)) { try { lockMs = statSync(path).mtimeMs; } catch { return null; } }
    if (Date.now() - lockMs <= staleMs) return null;
    const mutex = `${path}.reclaim`;
    if (!takeReclaimMutex(mutex)) return null;
    try {
      let current: string | null = null;
      try { current = readFileSync(path, "utf8"); } catch { /* gone (released): free to take */ }
      if (current !== null && current !== existing) return null; // reclaimed, or released and re-taken, meanwhile
      // force:true — the original owner's release may have already removed this file; an ENOENT here must not
      // escape as an uncaught throw.
      rmSync(path, { force: true });
      const mine = lockBody();
      writeFileSync(path, mine, { flag: "wx" });
      return mine;
    } catch (err2) {
      if ((err2 as NodeJS.ErrnoException).code === "EEXIST") return null; // lost the race to a plain acquire
      throw err2;
    } finally {
      rmSync(mutex, { force: true });
    }
  }
}

export function acquireLock(path: string, staleMs: number = DEFAULT_LOCK_STALE_MS): boolean {
  return acquireLockBody(path, staleMs) !== null;
}

export function releaseLock(path: string): void {
  try { rmSync(path); } catch { /* already gone */ }
}

export interface LockHandle { readonly body: string; stillOurs(): boolean; release(): void }

/**
 * acquireLock plus ownership: remembers the exact body it wrote, so `release` removes the lock only while it is
 * still ours (a run that outlived staleMs may have had it reclaimed), and `stillOurs` lets a long manual run
 * re-check before it submits. null = held by someone else.
 */
export function holdLock(path: string, staleMs: number = DEFAULT_LOCK_STALE_MS): LockHandle | null {
  const body = acquireLockBody(path, staleMs);
  if (body === null) return null;
  const stillOurs = () => { try { return readFileSync(path, "utf8") === body; } catch { return false; } };
  return { body, stillOurs, release: () => { if (stillOurs()) { try { rmSync(path); } catch { /* already gone */ } } } };
}

export type ManualRunGate = { ok: true; release: () => void; stillOurs: () => boolean } | { ok: false; reason: string };

/**
 * The manual `trade:execute` gate: hold the SAME exclusive run-lock as cron from before planning (a plan made before
 * a scheduled run traded and submitted after it would double-trade), then refuse while the consecutive-halt breaker
 * is tripped or unreadable. Read-only on the counter. The caller re-checks `stillOurs()` just before submitting.
 */
export function acquireManualRun(paths: { lock: string; haltState: string }, cfg: TradeConfig, staleMs: number = DEFAULT_LOCK_STALE_MS): ManualRunGate {
  const lock = holdLock(paths.lock, staleMs);
  if (!lock) return { ok: false, reason: `another trade run holds the run lock (${paths.lock}) — wait for it to finish (a lock older than ${Math.round(staleMs / 60_000)} min is reclaimed)` };
  let state: HaltState;
  try {
    state = readHaltState(paths.haltState);
  } catch (e) {
    lock.release();
    return { ok: false, reason: `halt state is unreadable — ${(e as Error).message}` };
  }
  if (haltBlocked(state, cfg)) {
    lock.release();
    return { ok: false, reason: `${state.consecutive} consecutive halted run(s) (limit ${cfg.consecutiveHaltLimit}) — investigate, then clear the halt state to resume` };
  }
  return { ok: true, release: lock.release, stillOurs: lock.stillOurs };
}

/** A manual plan answered later than this is refused: the market and the book have moved on (F-3). */
export const MANUAL_PLAN_MAX_AGE_MS = 10 * 60_000;
export function manualPlanTooOld(plannedAtMs: number, nowMs: number, maxAgeMs: number = MANUAL_PLAN_MAX_AGE_MS): boolean {
  return nowMs - plannedAtMs > maxAgeMs;
}
