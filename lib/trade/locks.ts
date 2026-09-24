/**
 * locks.ts — the owner's 5-business-day no-round-trip rule as data (spec §6.2).
 * A buy fill on T forbids selling that ticker before addTradingDays(T, n); a sell fill forbids
 * buying it before the same. Whole-ticker, both directions; the latest fill per side wins.
 * `lockUntil` IS the first legal day: locked iff today < lockUntil.
 */
import { addTradingDays, type TradingDay } from "./calendar";
import type { Fill } from "./fills";

export interface Locks {
  buyLockUntil: Record<string, TradingDay>;
  sellLockUntil: Record<string, TradingDay>;
}

export function locksFor(fills: Fill[], calendar: TradingDay[], lockBusinessDays: number): Locks {
  const locks: Locks = { buyLockUntil: {}, sellLockUntil: {} };
  for (const f of fills) {
    const until = addTradingDays(calendar, f.tradingDate, lockBusinessDays); // throws if tradingDate is not a trading day
    const table = f.side === "buy" ? locks.sellLockUntil : locks.buyLockUntil;
    const prev = table[f.ticker];
    if (prev == null || until > prev) table[f.ticker] = until;
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
