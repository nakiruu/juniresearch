import { describe, it, expect } from "vitest";
import { assembleSnapshot, PortfolioSnapshot, toCSV } from "./snapshot";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const sig = (o: Partial<Signal>): Signal => ({
  ticker: "A", company: "A Co", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.7,
  quality: 1, ageDays: 0, staleness: 1, ...o,
});

describe("snapshot", () => {
  const input = {
    asOf: "2026-09-22",
    signals: [sig({ ticker: "A" }), sig({ ticker: "B", label: "HOLD" })],
    sized: { holdings: [{ ticker: "A", sector: "36", weight: 0.6 }], cash: 0.4,
             excluded: [{ ticker: "B", reasons: ["label HOLD not buy-side"] }] },
    active: [{ ticker: "A", portfolioWeight: 0.6, benchmarkWeight: 0.5, activeWeight: 0.1 },
             { ticker: "B", portfolioWeight: 0, benchmarkWeight: 0.5, activeWeight: -0.5 }],
    spyPrice: 640, config: DEFAULT_CONFIG,
  };
  it("assembles a schema-valid snapshot with holdings, cash, exclusions and N_eff", () => {
    const snap = assembleSnapshot(input);
    expect(() => PortfolioSnapshot.parse(snap)).not.toThrow();
    expect(snap.holdings[0].ticker).toBe("A");
    expect(snap.holdings[0].activeWeight).toBeCloseTo(0.1, 6);
    expect(snap.cash).toBeCloseTo(0.4, 6);
    expect(snap.meta.nEff).toBeCloseTo(1 / (0.6 ** 2), 4);
    expect(snap.excluded[0].ticker).toBe("B");
  });
  it("renders a CSV with a header, a holding row, and a CASH row", () => {
    const csv = toCSV(assembleSnapshot(input));
    expect(csv.split("\n")[0]).toContain("ticker,weight");
    expect(csv).toMatch(/^A,/m);
    expect(csv).toMatch(/^CASH,0?\.4/m);
  });
});
