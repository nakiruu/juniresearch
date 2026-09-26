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
