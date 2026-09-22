import { describe, it, expect } from "vitest";
import { rawWeight, applyConstraints, type Weighted } from "./sizing";
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
