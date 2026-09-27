/**
 * clock.ts — the one America/New_York clock for the trade layer. Every trading-date and session-time
 * decision (today, lock checks, the fire window, the market-hours check) reads ET through here; a
 * UTC date (`toISOString().slice(0,10)`) is the wrong trading day from 20:00 EDT / 19:00 EST onward.
 * Pure: callers pass `ms` explicitly (todayET defaults to Date.now() for script entry points only).
 */
import { isTradingDay, type TradingDay } from "./calendar";
import { nyseTradingDays, COVERAGE_START, COVERAGE_END } from "./nyse-calendar";

const TZ = "America/New_York";
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
export function partsInTZ(ms: number) {
  const p = Object.fromEntries(FMT.formatToParts(ms).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
/** offset (ms) such that etWallClockAsUTC - actualUTC. */
function tzOffsetMs(ms: number): number {
  const p = partsInTZ(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms;
}
/** The UTC instant whose America/New_York wall clock is exactly Y-M-D h:mi (DST-correct). */
export function etWallToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - tzOffsetMs(naive);      // first correction
  utc = naive - tzOffsetMs(utc);            // refine at the candidate instant (handles DST edges)
  return utc;
}

export function etDateString(ms: number): TradingDay {
  const p = partsInTZ(ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Today's trading-calendar date in ET. */
export function todayET(nowMs: number = Date.now()): TradingDay {
  return etDateString(nowMs);
}

/** Minutes since ET midnight, 0..1439 (seconds truncated). */
export function etMinutesOfDay(ms: number): number {
  const p = partsInTZ(ms);
  return p.h * 60 + p.mi;
}

/** "HH:MM" → minutes since midnight. Throws on a malformed value so a bad config can't silently shift a window. */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`expected "HH:MM", got "${hhmm}"`);
  return +m[1] * 60 + +m[2];
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

/**
 * The daily fire slot in force at `nowMs`: the latest "HH:MM" slot at or before the ET wall clock, or
 * null before the first slot of the day. `slots` must be sorted ascending.
 */
export function currentSlot(nowMs: number, slots: readonly string[]): string | null {
  const m = etMinutesOfDay(nowMs);
  let cur: string | null = null;
  for (const s of slots) if (hhmmToMinutes(s) <= m) cur = s;
  return cur;
}

/** The next fire instant across all daily slots (each on trading days only). */
export function nextSlotRunAtET(nowMs: number, slots: readonly string[]): number {
  return Math.min(...slots.map((s) => nextRunAtET(nowMs, s)));
}
