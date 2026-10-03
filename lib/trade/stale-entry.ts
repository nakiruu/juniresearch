/**
 * stale-entry.ts — the stale-on-bad-news entry gate (docs/engine.md §4.2). Pure: prices, SPY, beta and the
 * latest earnings are inputs; fetching them is pipeline.ts's job.
 *
 * A not-held name whose μ crossed the entry bar because its price FELL is bought on a report written before the
 * fall. If the fall is the stock's own (the breach rule's cause split says "stock") and its latest earnings
 * missed, the report has most likely not absorbed the news: don't buy, re-write the report first.
 *
 *   fall      = P / P0 − 1                ≤ −staleEntryMinFall (5%) — smaller moves are noise for the split
 *   cause     = classifyBreach(P, P0, SPY, SPY0, β).cause = "stock"   (share ≥ breachStockShareMin, 0.9)
 *   earnings  = surprise < 0, reported on/before today and ≤ staleEntryEarningsMaxDays (120) ago
 *
 * Evidence: US stocks ≥ $2B, 8% stock-specific falls after a 10-Q/10-K (Shibui, 2010–25). Over the next 126
 * sessions vs SPY a prior miss trailed a prior beat by −3.1 / −3.2 / −3.2pp in 2010–15 / 2016–20 / 2021–25; the
 * same at 5% and 12% falls; negative in 12 of 16 years, fading in 2024–25
 * (docs/superpowers/specs/2026-10-03-entry-methodology.md). Every missing input lets the entry through.
 */
import type { TradeConfig } from "./config";
import { classifyBreach } from "./breach";
import type { LastEarnings } from "./earnings";

export interface StaleEntryInfo {
  /** P / P0 − 1 (< 0). */ fall: number;
  /** Stock-specific share of the fall (breach.ts). */ share: number;
  beta: number; spyReturn: number;
  surprisePct: number; earningsDate: string;
}

type Cfg = Pick<TradeConfig, "staleEntryGate" | "staleEntryMinFall" | "staleEntryEarningsMaxDays" | "breachMarketShareMax" | "breachStockShareMin">;

const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

/** The earnings result the gate may use today: a miss, reported on/before `today`, recent enough. null otherwise. */
export function usableMiss(e: LastEarnings | null | undefined, today: string, cfg: Pick<TradeConfig, "staleEntryEarningsMaxDays">): LastEarnings | null {
  if (!e || !(e.surprisePct < 0)) return null;
  const age = days(e.reportDate, today);
  return Number.isFinite(age) && age >= 0 && age <= cfg.staleEntryEarningsMaxDays ? e : null;
}

/** Does the price sit far enough below the report price for the gate to look at it? (Cheap pre-check, no SPY.) */
export function fellEnough(price: number, p0: number, cfg: Pick<TradeConfig, "staleEntryMinFall">): boolean {
  return price > 0 && p0 > 0 && price / p0 - 1 <= -cfg.staleEntryMinFall;
}

/** The gate. Info when the entry is to be barred; null (enter as usual) on any miss, out-of-range or absent input. */
export function classifyStaleEntry(
  i: { price: number; p0: number; spyNow: number; spy0: number; beta: number; earnings: LastEarnings | null | undefined; today: string },
  cfg: Cfg,
): StaleEntryInfo | null {
  if (!cfg.staleEntryGate || !fellEnough(i.price, i.p0, cfg)) return null;
  const miss = usableMiss(i.earnings, i.today, cfg);
  if (!miss) return null;
  const b = classifyBreach({ price: i.price, p0: i.p0, spyNow: i.spyNow, spy0: i.spy0, beta: i.beta }, cfg);
  if (!b || b.cause !== "stock") return null;
  return { fall: b.total, share: b.share, beta: b.beta, spyReturn: b.spyReturn, surprisePct: miss.surprisePct, earningsDate: miss.reportDate };
}

/** The classification reason — "down 9% since the report, stock-specific (share 104%), last earnings missed (−12.0% on 2026-08-05) — re-write the report". */
export function staleEntryReason(s: StaleEntryInfo): string {
  return `stale on bad news: down ${(-s.fall * 100).toFixed(0)}% since the report, stock-specific (share ${(s.share * 100).toFixed(0)}%), `
    + `last earnings missed (${s.surprisePct.toFixed(1)}% on ${s.earningsDate}) — re-write the report`;
}
