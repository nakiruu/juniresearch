/**
 * breach.ts — why a held name fell through its bear case, and what that predicts (docs/engine.md §4.2).
 * Pure: prices, SPY closes and beta are inputs; fetching them is pipeline.ts's job.
 *
 * At or below the bear implied price D = 0 and R is null, which the exit gate reads as a bear breach. Split
 * the fall since the report into the part the market explains and the rest:
 *
 *   total    = P / P0 − 1                     the stock's move since the report price (< 0 in a breach)
 *   market   = β · (SPY / SPY0 − 1)           what its beta to SPY explains
 *   residual = total − market                 the stock-specific move
 *   share    = residual / total               stock-specific share of the fall
 *
 * share > 1 when the market rose while the stock fell (all of it, and more, is the stock's own); share < 0
 * when the market fell further than beta needs to explain the drop (the stock held up — market-driven).
 *
 * Evidence: 7,237 US-stock bear breaches 2010–2025 (≥ $2B, bear ≈ 0.6σ below a quarterly report price).
 * Over the next 6 months vs a typical stock: share < 0.5 ("market") +3.5pp (+5pp from day 6), 0.5–0.9
 * ("mixed") −0.8pp, ≥ 0.9 ("stock") −3.3pp (−3.8pp from day 6), with or without earnings news — the same
 * sign in 2010–15, 2016–20 and 2021–25. So: hold a market-driven breach, freeze a mixed one, exit a
 * stock-specific one (hysteresis.ts applies it; breachPolicy "exit" turns it off).
 */
import type { TradeConfig } from "./config";

export type BreachCause = "market" | "mixed" | "stock";
export interface BreachInfo { cause: BreachCause; share: number; total: number; residual: number; beta: number; spyReturn: number }

const pos = (x: number) => Number.isFinite(x) && x > 0;

/**
 * The cause of a fall from the report price P0 to the decision mark P, net of the market. null — and so
 * the plain bear-breach exit — on any non-finite or non-positive input, or when the price has not fallen.
 */
export function classifyBreach(
  i: { price: number; p0: number; spyNow: number; spy0: number; beta: number },
  cfg: Pick<TradeConfig, "breachMarketShareMax" | "breachStockShareMin">,
): BreachInfo | null {
  if (!pos(i.price) || !pos(i.p0) || !pos(i.spyNow) || !pos(i.spy0) || !pos(i.beta)) return null;
  const total = i.price / i.p0 - 1;
  if (!(total < 0)) return null;
  const spyReturn = i.spyNow / i.spy0 - 1;
  const residual = total - i.beta * spyReturn;
  const share = residual / total;
  if (![total, spyReturn, residual, share].every(Number.isFinite)) return null;
  const cause: BreachCause = share < cfg.breachMarketShareMax ? "market" : share >= cfg.breachStockShareMin ? "stock" : "mixed";
  return { cause, share, total, residual, beta: i.beta, spyReturn };
}
