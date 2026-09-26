/**
 * scheduler.ts — pure section: ET time math + arm/catch-up decisions.
 * No I/O, no clock reads inside these functions; callers pass `nowMs`/env explicitly.
 */
import { nyseTradingDays, COVERAGE_START, COVERAGE_END } from "./nyse-calendar";
import { isTradingDay } from "./calendar";

import { etDateString, etWallToUtc } from "./clock";

// Re-exported: the ET helpers moved to clock.ts (the one ET clock); scheduler callers keep working.
export { etDateString, etWallToUtc, todayET, etMinutesOfDay } from "./clock";

const TRADING_DAYS = nyseTradingDays(COVERAGE_START, COVERAGE_END).map((d) => d.date);

export function nextRunAtET(nowMs: number, hhmm: string): number {
  const [h, mi] = hhmm.split(":").map(Number);
  // Start from today's ET date, walk forward day by day until the fire instant is strictly future AND a trading day.
  let cursor = etDateString(nowMs);
  for (let i = 0; i < 400; i++) {
    const [y, mo, d] = cursor.split("-").map(Number);
    const fire = etWallToUtc(y, mo, d, h, mi);
    if (fire > nowMs && isTradingDay(TRADING_DAYS, cursor)) return fire;
    // advance one calendar day (ET) — build the next date from a noon-UTC step to avoid DST edges
    cursor = etDateString(Date.parse(`${cursor}T12:00:00Z`) + 86_400_000);
  }
  throw new Error(`nextRunAtET: no trading day found within 400 days of ${cursor}`);
}

export function shouldCatchUp(a: { lastFiredDay: string | null; todayET: string; marketOpen: boolean }): boolean {
  return a.marketOpen && a.lastFiredDay !== a.todayET;
}

export function shouldArm(env: NodeJS.ProcessEnv): boolean {
  return env.NEXT_RUNTIME === "nodejs" && env.TRADE_SCHEDULER_ENABLED === "1";
}

/**
 * scheduler.ts — stateful section: persisted lastFiredDay, the in-memory status singleton read by
 * a later status route, and startScheduler with an injected timer/clock for deterministic tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TradeConfig } from "./config";
import { TRADE_DIR, latestRunRecord } from "./runtime";
import type { CronResult } from "./cron";

const STATE_FILE = (dir: string) => join(dir, "scheduler-state.json");

export function readSchedulerState(dir: string = TRADE_DIR): { lastFiredDay: string | null } {
  const p = STATE_FILE(dir);
  if (!existsSync(p)) return { lastFiredDay: null };
  try { return { lastFiredDay: JSON.parse(readFileSync(p, "utf8")).lastFiredDay ?? null }; }
  catch { return { lastFiredDay: null }; }
}
export function writeSchedulerState(s: { lastFiredDay: string | null }, dir: string = TRADE_DIR): void {
  const p = STATE_FILE(dir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
}

export interface SchedulerStatus {
  armed: boolean; broker: string; tradeDisabled: boolean; nextRunISO: string | null;
  lastRun: { id: string | null; day: string | null; at: string | null; status: string; orders?: number; fills?: number } | null;
}
// Mutable scheduler status lives on a globalThis-keyed singleton, NOT bare module-level `let`s.
// Why: Next may compile instrumentation.ts (which arms the scheduler, via scheduler-wiring) into a
// different module graph than app/api/trade/status/route.ts (which reads the status). Each graph
// would otherwise get its own copy of the module state, so the route could always report armed:false
// even though the scheduler is armed. A globalThis key is shared across every graph in the process.
// (In Vitest it's one graph, so behavior is identical to the old module-level state.)
interface SchedulerState { armed: boolean; nextRunISO: string | null; lastFire: { at: string; status: string; orders?: number; fills?: number } | null }
const g = globalThis as unknown as { __tradeScheduler?: SchedulerState };
g.__tradeScheduler ??= { armed: false, nextRunISO: null, lastFire: null };
const state: SchedulerState = g.__tradeScheduler;

export function getSchedulerStatus(env: NodeJS.ProcessEnv = process.env): SchedulerStatus {
  // A corrupt/mid-write run record must never throw out of the status route — treat it as null.
  let rec: ReturnType<typeof latestRunRecord> = null;
  try { rec = latestRunRecord(); } catch { rec = null; }
  const lastRun = state.lastFire || rec
    ? {
        id: rec?.runId ?? null, day: rec?.today ?? null, at: state.lastFire?.at ?? null,
        status: state.lastFire?.status ?? "unknown",
        orders: state.lastFire?.orders ?? rec?.orders.length, fills: state.lastFire?.fills ?? rec?.fills.length,
      }
    : null;
  return {
    armed: state.armed, broker: env.BROKER ?? "alpaca-paper", tradeDisabled: env.TRADE_DISABLED === "1",
    nextRunISO: state.nextRunISO, lastRun,
  };
}

export interface SchedulerDeps {
  runOnce: () => Promise<CronResult>;
  marketOpenNow: () => Promise<boolean>;
  cfg: Pick<TradeConfig, "cronTimeET">;
  broker: string;
  env: NodeJS.ProcessEnv;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { clear: () => void };
  stateDir?: string;
}

export function startScheduler(deps: SchedulerDeps): { stop: () => void } {
  const dir = deps.stateDir ?? TRADE_DIR;
  let handle: { clear: () => void } | null = null;
  let stopped = false;

  // fire() MUST NEVER reject: deps.runOnce() can reject (a transient broker error re-thrown by
  // runCron, or makeBroker throwing on a missing/corrupt Schwab token). An unguarded rejection here
  // would crash the Node process (there is no unhandledRejection handler → takes /research down) and
  // skip arm() (the scheduler dies silently). The try/catch/finally makes fire() always resolve and
  // always re-arm for the next trading day unless stopped.
  const fire = async () => {
    if (stopped) return; // stop() requested before we got here — do not trade after shutdown
    try {
      // Same-day double-fire guard: a boot in the 09:30–09:45 ET window catch-up-fires, then arm()
      // re-arms for the SAME day's (still strictly-future) fire instant. Consult persisted state and
      // skip runOnce when we've already fired today; the finally below still re-arms.
      const today = etDateString(deps.now());
      if (readSchedulerState(dir).lastFiredDay === today) {
        console.log(`[scheduler] already fired ${today}, skipping`);
        return;
      }
      const result = await deps.runOnce();
      if (stopped) return; // stop() requested while runOnce() was in flight — do not stamp/re-arm
      state.lastFire = { at: new Date(deps.now()).toISOString(), status: result.status, orders: result.orders, fills: result.fills };
      writeSchedulerState({ lastFiredDay: etDateString(deps.now()) }, dir);
    } catch (e) {
      if (stopped) return; // shutdown during runOnce() — do not stamp after shutdown
      state.lastFire = { at: new Date(deps.now()).toISOString(), status: "error" };
      try { console.error(`[scheduler] runOnce failed — re-arming for the next day: ${e instanceof Error ? e.message : String(e)}`); } catch { /* logging must never break re-arm */ }
    } finally {
      arm(); // re-arm for the next day (arm() no-ops when stopped, so a stopped scheduler never re-arms)
    }
  };
  const arm = () => {
    if (stopped) return;
    const at = nextRunAtET(deps.now(), deps.cfg.cronTimeET);
    state.nextRunISO = new Date(at).toISOString();
    handle = deps.setTimer(() => { void fire(); }, Math.max(0, at - deps.now()));
  };

  state.armed = true;
  void (async () => {
    const st = readSchedulerState(dir);
    const todayET = etDateString(deps.now());
    const open = await deps.marketOpenNow();
    if (stopped) return; // stop() requested while marketOpenNow() was in flight — abandon the boot
    if (shouldCatchUp({ lastFiredDay: st.lastFiredDay, todayET, marketOpen: open })) {
      await fire();          // fire() re-arms (and self-guards against a stop() during runOnce())
    } else {
      arm();
    }
  })();

  return {
    stop: () => {
      stopped = true;
      handle?.clear(); handle = null; state.armed = false; state.nextRunISO = null;
    },
  };
}
