import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";
import { assessEligibility } from "./eligibility";

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

export function finalizeCash(items: Weighted[], config: PortfolioConfig): { holdings: Weighted[]; cash: number } {
  const held = items.filter((w) => w.weight > 0);
  const invested = held.reduce((a, w) => a + w.weight, 0);
  const scale = (target: number) => held.map((w) => ({ ...w, weight: w.weight * (target / invested) }));

  // Over-invested: scale down to (1 - cashFloor), no leverage.
  if (invested > 1 - config.cashFloor) {
    return { holdings: scale(1 - config.cashFloor), cash: config.cashFloor };
  }
  let holdings = held;
  let cash = 1 - invested;
  // Cash ceiling binds only with enough names — never a stealth market-timing bet.
  if (cash > config.cashCeiling && held.length >= config.minNamesForCeiling) {
    const target = 1 - config.cashCeiling;
    holdings = scale(target);
    cash = config.cashCeiling;
  }
  return { holdings, cash };
}

export interface Sized {
  holdings: Weighted[]; cash: number; excluded: { ticker: string; reasons: string[] }[];
}

export function sizePortfolio(signals: Signal[], config: PortfolioConfig): Sized {
  const eligible: Signal[] = [];
  const excluded: { ticker: string; reasons: string[] }[] = [];
  for (const s of signals) {
    const e = assessEligibility(s, config);
    if (e.eligible) eligible.push(s);
    else excluded.push({ ticker: s.ticker, reasons: e.reasons });
  }
  const raw: Weighted[] = eligible.map((s) => ({ ticker: s.ticker, sector: s.sector, weight: rawWeight(s, config) }));
  const constrained = applyConstraints(raw, config);
  const { holdings, cash } = finalizeCash(constrained, config);
  return { holdings, cash, excluded };
}
