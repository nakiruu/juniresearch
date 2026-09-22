import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";

export function rawWeight(s: Signal, config: PortfolioConfig): number {
  const sigma = Math.max(s.sigma, config.sigmaMin);
  const kelly = s.mu / (sigma * sigma);
  return Math.max(0, config.alpha * s.kappa * kelly * s.quality * s.staleness);
}
