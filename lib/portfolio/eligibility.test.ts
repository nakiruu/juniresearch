import { describe, it, expect } from "vitest";
import { assessEligibility } from "./eligibility";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const ok: Signal = {
  ticker: "TST", company: "Test", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1.0, kappa: 0.7,
  quality: 1.05, ageDays: 10, staleness: 0.9,
};

describe("assessEligibility", () => {
  it("passes a fresh, high-conviction, asymmetric BUY", () => {
    expect(assessEligibility(ok, DEFAULT_CONFIG).eligible).toBe(true);
  });
  it("excludes a HOLD", () => {
    const r = assessEligibility({ ...ok, label: "HOLD" }, DEFAULT_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("label HOLD not buy-side");
  });
  it("excludes a BUY the fundamental gate caps to HOLD", () => {
    const r = assessEligibility({ ...ok, gatedLabel: "HOLD" }, DEFAULT_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("gate ceiling HOLD");
  });
  it("excludes a stale report and a rallied-out (low mu) name", () => {
    expect(assessEligibility({ ...ok, ageDays: 200 }, DEFAULT_CONFIG).eligible).toBe(false);
    expect(assessEligibility({ ...ok, mu: 0.02 }, DEFAULT_CONFIG).eligible).toBe(false);
  });
});
