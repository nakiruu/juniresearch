import { z } from "zod";
import type { Signal } from "./signal";
import type { Sized } from "./sizing";
import type { ActiveRow } from "./benchmark";
import type { PortfolioConfig } from "./config";

const holding = z.object({
  ticker: z.string(), company: z.string(), sector: z.string(),
  weight: z.number(), activeWeight: z.number(), label: z.string(),
  mu: z.number(), sigma: z.number(), R: z.number().nullable(), conviction: z.number(),
});
export const PortfolioSnapshot = z.object({
  meta: z.object({
    asOf: z.string(), universeSize: z.number().int(), eligibleCount: z.number().int(),
    invested: z.number(), cash: z.number(), nEff: z.number(), spyPrice: z.number(),
    config: z.record(z.string(), z.number()),
  }),
  holdings: z.array(holding),
  cash: z.number(),
  excluded: z.array(z.object({ ticker: z.string(), label: z.string(), reasons: z.array(z.string()) })),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshot>;

export function assembleSnapshot(input: {
  asOf: string; signals: Signal[]; sized: Sized; active: ActiveRow[];
  spyPrice: number; config: PortfolioConfig;
}): PortfolioSnapshot {
  const { asOf, signals, sized, active, spyPrice, config } = input;
  const byTicker = new Map(signals.map((s) => [s.ticker, s]));
  const activeByTicker = new Map(active.map((a) => [a.ticker, a.activeWeight]));
  const holdings = sized.holdings
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((h) => {
      const s = byTicker.get(h.ticker)!;
      return {
        ticker: h.ticker, company: s.company, sector: h.sector, weight: h.weight,
        activeWeight: activeByTicker.get(h.ticker) ?? h.weight,
        label: s.label, mu: s.mu, sigma: s.sigma, R: s.R, conviction: Math.round(s.kappa * 100),
      };
    });
  const invested = holdings.reduce((a, h) => a + h.weight, 0);
  // Effective number of HOLDINGS: inverse Herfindahl over weights normalized to sum to 1
  // (i.e. cash-independent). Without normalizing by `invested`, a high-cash book with N
  // equal-weight names inflates nEff toward 1/w^2 instead of reporting N.
  const sumSquares = holdings.reduce((a, h) => a + h.weight ** 2, 0);
  const nEff = invested > 0 ? (invested * invested) / sumSquares : 0;
  const excluded = sized.excluded.map((e) => ({
    ticker: e.ticker, label: byTicker.get(e.ticker)?.label ?? "?", reasons: e.reasons,
  }));
  return {
    meta: {
      asOf, universeSize: signals.length, eligibleCount: holdings.length,
      invested, cash: sized.cash, nEff, spyPrice,
      config: config as unknown as Record<string, number>,
    },
    holdings, cash: sized.cash, excluded,
  };
}

export function toCSV(snap: PortfolioSnapshot): string {
  const header = "ticker,weight,activeWeight,sector,label,mu,sigma,R,conviction";
  const rows = snap.holdings.map((h) =>
    [h.ticker, h.weight.toFixed(4), h.activeWeight.toFixed(4), h.sector, h.label,
     h.mu.toFixed(4), h.sigma.toFixed(4), h.R == null ? "" : h.R.toFixed(2), h.conviction].join(","));
  return [header, ...rows, `CASH,${snap.cash.toFixed(4)},,,,,,,`].join("\n") + "\n";
}
