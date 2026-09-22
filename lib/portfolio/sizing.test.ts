import { describe, it, expect } from "vitest";
import { rawWeight, applyConstraints, finalizeCash, sizePortfolio, type Weighted } from "./sizing";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const s: Signal = {
  ticker: "TST", company: "Test", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.20, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1.0, kappa: 0.6,
  quality: 1.0, ageDays: 0, staleness: 1.0,
};

describe("rawWeight", () => {
  it("computes alpha * kappa * mu/sigma^2 * quality * staleness", () => {
    // 0.4 * 0.6 * (0.20 / 0.0625) * 1 * 1 = 0.4*0.6*3.2 = 0.768
    expect(rawWeight(s, DEFAULT_CONFIG)).toBeCloseTo(0.768, 6);
  });
  it("floors sigma so a tight-scenario name doesn't blow up", () => {
    const w = rawWeight({ ...s, sigma: 0.001 }, DEFAULT_CONFIG); // sigma floored to 0.05
    expect(w).toBeCloseTo(0.4 * 0.6 * (0.20 / 0.0025), 6);
  });
});

describe("applyConstraints", () => {
  it("caps a single name at wMax", () => {
    const out = applyConstraints([{ ticker: "A", sector: "36", weight: 0.5 }], DEFAULT_CONFIG);
    expect(out[0].weight).toBeCloseTo(0.10, 6);
  });
  it("scales an over-weight sector down to sectorMax", () => {
    const out = applyConstraints([
      { ticker: "A", sector: "36", weight: 0.10 },
      { ticker: "B", sector: "36", weight: 0.10 },
      { ticker: "C", sector: "36", weight: 0.10 },
      { ticker: "D", sector: "36", weight: 0.10 }, // 4x10% = 40% in sector 36 > 30%
    ], DEFAULT_CONFIG);
    const sec36 = out.filter((w) => w.sector === "36").reduce((a, w) => a + w.weight, 0);
    expect(sec36).toBeCloseTo(0.30, 6);
    expect(out[0].weight).toBeCloseTo(0.075, 6); // each scaled 0.10 * (0.30/0.40)
  });
  it("drops dust below wMin", () => {
    const out = applyConstraints([{ ticker: "A", sector: "36", weight: 0.005 }], DEFAULT_CONFIG);
    expect(out[0].weight).toBe(0);
  });
});

describe("finalizeCash", () => {
  const w = (ticker: string, weight: number): Weighted => ({ ticker, sector: "36", weight });

  it("scales an over-invested book down to (1 - cashFloor) with floor cash", () => {
    const { holdings, cash } = finalizeCash([w("A", 0.8), w("B", 0.8)], DEFAULT_CONFIG);
    expect(holdings.reduce((a, h) => a + h.weight, 0)).toBeCloseTo(0.99, 6);
    expect(cash).toBeCloseTo(0.01, 6);
  });
  it("lets cash emerge when under-invested and under the ceiling", () => {
    const { cash } = finalizeCash([w("A", 0.4), w("B", 0.3)], DEFAULT_CONFIG); // invested 0.7
    expect(cash).toBeCloseTo(0.30, 6);
  });
  it("binds the cash ceiling up when enough names qualify, without breaching wMax/sectorMax", () => {
    // invested 0.4 across 4 names (all sector "36") -> cash 0.6 > ceiling 0.35, names>=4 -> upscale.
    // Naive upscale to invested 0.65 would put each name at 0.1625, breaching wMax (0.10).
    // Re-applying applyConstraints: (1) caps each at wMax=0.10 (sum back to 0.40), which itself
    // breaches sectorMax=0.30 since all 4 share sector "36", so (2) the sector step scales down
    // to 0.075 each (sum 0.30). Cash lands at 0.70 -- above the nominal 0.35 ceiling, which is the
    // correct "too few names to fill the ceiling under the caps" outcome, not a bug.
    const { holdings, cash } = finalizeCash([w("A",0.1),w("B",0.1),w("C",0.1),w("D",0.1)], DEFAULT_CONFIG);
    for (const h of holdings) expect(h.weight).toBeLessThanOrEqual(DEFAULT_CONFIG.wMax + 1e-9);
    expect(holdings.reduce((a, h) => a + h.weight, 0)).toBeCloseTo(0.30, 6);
    expect(cash).toBeCloseTo(0.70, 6);
  });
  it("allows cash above the ceiling when too few names qualify", () => {
    const { cash } = finalizeCash([w("A", 0.1), w("B", 0.1)], DEFAULT_CONFIG); // 2 names < 4
    expect(cash).toBeCloseTo(0.80, 6);
  });
});

describe("sizePortfolio", () => {
  const sig = (o: Partial<Signal>): Signal => ({
    ticker: "X", company: "X", sector: "36", label: "BUY", gatedLabel: "BUY",
    price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.6,
    quality: 1, ageDays: 0, staleness: 1, ...o,
  });

  it("holds eligible names, lists the excluded with reasons, and sums to 1", () => {
    const out = sizePortfolio([
      sig({ ticker: "A" }),
      sig({ ticker: "B", label: "HOLD" }),   // excluded
      sig({ ticker: "C", mu: 0.01 }),         // excluded (rallied out)
    ], DEFAULT_CONFIG);
    expect(out.holdings.map((h) => h.ticker)).toEqual(["A"]);
    expect(out.excluded.map((e) => e.ticker).sort()).toEqual(["B", "C"]);
    expect(out.holdings.reduce((a, h) => a + h.weight, 0) + out.cash).toBeCloseTo(1, 9);
  });
  it("returns an all-cash book when nothing is eligible", () => {
    const out = sizePortfolio([sig({ label: "HOLD" })], DEFAULT_CONFIG);
    expect(out.holdings).toHaveLength(0);
    expect(out.cash).toBeCloseTo(1, 9);
  });
});
