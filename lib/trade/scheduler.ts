/**
 * scheduler.ts — pure section: ET time math + arm/catch-up decisions.
 * No I/O, no clock reads inside these functions; callers pass `nowMs`/env explicitly.
 */
import { nyseTradingDays, COVERAGE_START, COVERAGE_END } from "./nyse-calendar";
import { isTradingDay } from "./calendar";

const TZ = "America/New_York";
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function partsInTZ(ms: number) {
  const p = Object.fromEntries(FMT.formatToParts(ms).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
/** offset (ms) such that etWallClockAsUTC - actualUTC. */
function tzOffsetMs(ms: number): number {
  const p = partsInTZ(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms;
}
/** The UTC instant whose America/New_York wall clock is exactly Y-M-D h:mi (DST-correct). */
function etWallToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - tzOffsetMs(naive);      // first correction
  utc = naive - tzOffsetMs(utc);            // refine at the candidate instant (handles DST edges)
  return utc;
}

export function etDateString(ms: number): string {
  const p = partsInTZ(ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

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
let _armed = false;
let _nextRunISO: string | null = null;
let _lastFire: { at: string; status: string; orders?: number; fills?: number } | null = null;

export function getSchedulerStatus(env: NodeJS.ProcessEnv = process.env): SchedulerStatus {
  const rec = latestRunRecord();
  const lastRun = _lastFire || rec
    ? {
        id: rec?.runId ?? null, day: rec?.today ?? null, at: _lastFire?.at ?? null,
        status: _lastFire?.status ?? "unknown",
        orders: _lastFire?.orders ?? rec?.orders.length, fills: _lastFire?.fills ?? rec?.fills.length,
      }
    : null;
  return {
    armed: _armed, broker: env.BROKER ?? "alpaca-paper", tradeDisabled: env.TRADE_DISABLED === "1",
    nextRunISO: _nextRunISO, lastRun,
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

  const fire = async () => {
    if (stopped) return; // stop() requested before we got here — do not trade after shutdown
    const result = await deps.runOnce();
    if (stopped) return; // stop() requested while runOnce() was in flight — do not stamp/re-arm
    _lastFire = { at: new Date(deps.now()).toISOString(), status: result.status, orders: result.orders, fills: result.fills };
    writeSchedulerState({ lastFiredDay: etDateString(deps.now()) }, dir);
    arm(); // re-arm for the next day
  };
  const arm = () => {
    if (stopped) return;
    const at = nextRunAtET(deps.now(), deps.cfg.cronTimeET);
    _nextRunISO = new Date(at).toISOString();
    handle = deps.setTimer(() => { void fire(); }, Math.max(0, at - deps.now()));
  };

  _armed = true;
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
      handle?.clear(); handle = null; _armed = false; _nextRunISO = null;
    },
  };
}
