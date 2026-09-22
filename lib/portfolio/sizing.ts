import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";

export function rawWeight(s: Signal, config: PortfolioConfig): number {
  const sigma = Math.max(s.sigma, config.sigmaMin);
  const kelly = s.mu / (sigma * sigma);
  return Math.max(0, config.alpha * s.kappa * kelly * s.quality * s.staleness);
}

export interface Weighted { ticker: string; sector: string; weight: number }

export function applyConstraints(items: Weighted[], config: PortfolioConfig): Weighted[] {
  // 1. hard per-name cap
  let out = items.map((w) => ({ ...w, weight: Math.min(w.weight, config.wMax) }));
  // 2. sector cap — scale any sector over the cap down proportionally
  const bySector = new Map<string, number>();
  for (const w of out) bySector.set(w.sector, (bySector.get(w.sector) ?? 0) + w.weight);
  out = out.map((w) => {
    const total = bySector.get(w.sector)!;
    return total > config.sectorMax ? { ...w, weight: w.weight * (config.sectorMax / total) } : w;
  });
  // 3. dust floor
  return out.map((w) => (w.weight < config.wMin ? { ...w, weight: 0 } : w));
}
