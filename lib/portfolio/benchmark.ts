export interface ActiveRow { ticker: string; portfolioWeight: number; benchmarkWeight: number; activeWeight: number }

export function equalWeightCoverage(coveredTickers: string[]): Map<string, number> {
  const w = coveredTickers.length ? 1 / coveredTickers.length : 0;
  return new Map(coveredTickers.map((t) => [t, w]));
}

export function activeWeights(coveredTickers: string[], holdings: { ticker: string; weight: number }[]): ActiveRow[] {
  const ew = equalWeightCoverage(coveredTickers);
  const held = new Map(holdings.map((h) => [h.ticker, h.weight]));
  return coveredTickers.map((t) => {
    const portfolioWeight = held.get(t) ?? 0;
    const benchmarkWeight = ew.get(t) ?? 0;
    return { ticker: t, portfolioWeight, benchmarkWeight, activeWeight: portfolioWeight - benchmarkWeight };
  });
}
