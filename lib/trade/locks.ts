/**
 * locks.ts — the owner's 5-business-day no-round-trip rule as data (spec §6.2).
 * A buy fill on T forbids selling that ticker before addTradingDays(T, n); a sell fill forbids
 * buying it before the same. Whole-ticker, both directions; the latest fill per side wins.
 * `lockUntil` IS the first legal day: locked iff today < lockUntil.
 *
 * Fills dated before the loaded calendar are skipped, because their lock has provably expired.
 * ASSUMPTION: the calendar has no gaps — getCalendar returns every trading day in its range
 * (nyseTradingDays, Alpaca /calendar); assertCalendar checks order, not completeness. Then for a
 * fill F < calendar[0], the days calendar[0..n-1] are n trading days after F, so F's lockUntil is at
 * or before calendar[n-1]. Locks are only read as `today < lockUntil`, so once today ≥ calendar[n-1]
 * the skipped lock is inactive. That condition is checked, not assumed: skipping while today is fewer
 * than n trading days into the calendar throws (fail closed). fills.jsonl is append-only, so without
 * the skip every run would throw once the first fill falls out of planRun's 90-day calendar.
 */
import { addTradingDays, indexOnOrBefore, type TradingDay } from "./calendar";
import type { Fill } from "./fills";

export interface Locks {
  buyLockUntil: Record<string, TradingDay>;
  sellLockUntil: Record<string, TradingDay>;
}

export function locksFor(fills: Fill[], calendar: TradingDay[], lockBusinessDays: number, today: TradingDay): Locks {
  const locks: Locks = { buyLockUntil: {}, sellLockUntil: {} };
  const first = calendar[0];
  let skipped = 0;
  for (const f of fills) {
    if (first !== undefined && f.tradingDate < first) { skipped++; continue; } // expired — see the header
    const until = addTradingDays(calendar, f.tradingDate, lockBusinessDays); // throws if tradingDate is not a trading day
    const table = f.side === "buy" ? locks.sellLockUntil : locks.buyLockUntil;
    const prev = table[f.ticker];
    if (prev == null || until > prev) table[f.ticker] = until;
  }
  if (skipped > 0 && indexOnOrBefore(calendar, today) < lockBusinessDays - 1) {
    throw new Error(`locksFor: ${skipped} fill(s) predate the loaded calendar (${first}) and today ${today} is fewer than ${lockBusinessDays} trading days into it — load a longer calendar`);
  }
  return locks;
}

export function isBuyLocked(locks: Locks, ticker: string, today: TradingDay): boolean {
  const until = locks.buyLockUntil[ticker];
  return until != null && today < until;
}

export function isSellLocked(locks: Locks, ticker: string, today: TradingDay): boolean {
  const until = locks.sellLockUntil[ticker];
  return until != null && today < until;
}
