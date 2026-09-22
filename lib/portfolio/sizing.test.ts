import { describe, it, expect } from "vitest";
import { rawWeight } from "./sizing";
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
