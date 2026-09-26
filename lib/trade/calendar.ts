/**
 * calendar.ts — "business day" means an NYSE trading day (spec §6.1).
 * Pure: every function takes the sorted trading-day list; nothing here reads the clock.
 */
export type TradingDay = string; // YYYY-MM-DD

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function assertCalendar(days: TradingDay[]): void {
  for (let i = 0; i < days.length; i++) {
    if (!DAY.test(days[i])) throw new Error(`calendar: bad date ${JSON.stringify(days[i])}`);
    if (i > 0 && !(days[i - 1] < days[i])) throw new Error(`calendar: not strictly sorted at ${days[i - 1]} -> ${days[i]}`);
  }
}

export function isTradingDay(days: TradingDay[], d: string): boolean {
  const i = indexOnOrBefore(days, d);
  return i >= 0 && days[i] === d;
}

/** Index of the last trading day <= d, or -1 if d precedes the calendar. Binary search. */
export function indexOnOrBefore(days: TradingDay[], d: string): number {
  let lo = 0, hi = days.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The trading day n steps after `from` (which must itself be a trading day). */
export function addTradingDays(days: TradingDay[], from: TradingDay, n: number): TradingDay {
  const i = indexOnOrBefore(days, from);
  if (i < 0 || days[i] !== from) throw new Error(`addTradingDays: ${from} is not a trading day`);
  const j = i + n;
  if (j < 0 || j >= days.length) throw new Error(`addTradingDays: ${from} + ${n} is beyond the loaded calendar`);
  return days[j];
}

/** The last trading day strictly before d (d need not be a trading day). */
export function prevTradingDay(days: TradingDay[], d: string): TradingDay {
  const i = indexOnOrBefore(days, d);
  const j = i >= 0 && days[i] === d ? i - 1 : i;
  if (j < 0) throw new Error(`prevTradingDay: no trading day before ${d} in the loaded calendar`);
  return days[j];
}
