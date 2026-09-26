/**
 * nyse-calendar.ts — a local NYSE trading calendar (weekends + observed US market holidays).
 * Schwab has no bulk trading-calendar endpoint, and the calendar is broker-agnostic and
 * correctness-critical for the lock-date math, so it is computed locally rather than by ±135 per-day
 * broker calls. The holiday table is hand-maintained: extend HOLIDAYS and COVERAGE_END each year — a
 * request beyond coverage THROWS rather than return a silently-wrong calendar. Early-close days (e.g.
 * the half day after Thanksgiving) are still full trading days here, which is correct for lock
 * counting; the intraday open/closed decision uses the broker's live clock, not this.
 */
import type { BrokerCalendarDay } from "../broker/adapter";

export const COVERAGE_START = "2025-01-01";
export const COVERAGE_END = "2028-12-31";

/** Observed NYSE full-closure dates (regular session). Maintained by hand; keep in sync with the published NYSE calendar. */
const HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  // 2028 (Jan 1 is a Saturday — NYSE does not observe it, so it is intentionally absent)
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);

/** Trading days in [from, to] inclusive, as BrokerCalendarDay[] — weekends and observed holidays removed. */
export function nyseTradingDays(from: string, to: string): BrokerCalendarDay[] {
  if (from < COVERAGE_START || to > COVERAGE_END) {
    throw new Error(`nyseTradingDays: [${from}, ${to}] is outside the maintained holiday table [${COVERAGE_START}, ${COVERAGE_END}] — extend HOLIDAYS`);
  }
  const out: BrokerCalendarDay[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86_400_000)) {
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekend
    if (HOLIDAYS.has(date)) continue;     // observed holiday
    out.push({ date, open: "09:30", close: "16:00" });
  }
  return out;
}
