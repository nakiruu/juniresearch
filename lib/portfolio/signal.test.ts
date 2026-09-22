import { describe, it, expect } from "vitest";
import { buildSignal } from "./signal";
import { DEFAULT_CONFIG } from "./config";
import type { Report } from "@/lib/report.schema";

// Minimal report stub with the fields buildSignal reads.
const base = {
  meta: { ticker: "TST", company: "Test Co", reportDate: "September 1, 2026" },
  rating: {
    label: "BUY",
    conviction: { expectedUpside: 0.2, bearDownside: 0.2, rewardRisk: 1.0, derivedLabel: "BUY" },
    gate: { sector: "industrial", gatedLabel: "BUY" },
    decision: { conviction: 70, moat: { width: "WIDE", trend: "STABLE" }, composite: { percentile: 60 } },
  },
  sections: { valuation: { scenarios: [
    { name: "Bull", impliedPrice: 150, probability: 0.3 },
    { name: "Base", impliedPrice: 120, probability: 0.5 },
    { name: "Bear", impliedPrice: 80,  probability: 0.2 },
  ] } },
} as unknown as Report;

describe("buildSignal", () => {
  it("re-marks mu and sigma to the live price, not the report's price", () => {
    const s = buildSignal(base, 100, 3674, new Date("2026-09-01T00:00:00Z"), DEFAULT_CONFIG);
    // returns vs 100: +0.5, +0.2, -0.2 ; mu = .3*.5 + .5*.2 + .2*(-.2) = 0.21
    expect(s.mu).toBeCloseTo(0.21, 6);
    // var = .3*(.29)^2 + .5*(-.01)^2 + .2*(-.41)^2 = 0.02523+0.00005+0.03362 = 0.0589 ; sigma = sqrt(0.0589) ~ 0.24269
    // (brief's comment computed variance correctly but the sqrt in the comment/assertion was a typo — see task-2-9-report.md)
    expect(s.sigma).toBeCloseTo(0.24269, 4);
    expect(s.D).toBeCloseTo(0.2, 6);       // (100-80)/100
    expect(s.R).toBeCloseTo(1.05, 4);      // 0.21 / 0.2
    expect(s.kappa).toBe(0.7);
    expect(s.sector).toBe("36");           // SIC 3674 -> "36"
    expect(s.quality).toBeGreaterThan(1);  // WIDE moat + 60th pct -> mild positive tilt
    expect(s.ageDays).toBe(0);
  });
  it("halves mu when the name has already rallied above the re-mark price", () => {
    const s = buildSignal(base, 130, 3674, new Date("2026-09-01T00:00:00Z"), DEFAULT_CONFIG);
    // vs 130 the base case (120) is now BELOW price -> much lower mu
    expect(s.mu).toBeLessThan(0.05);
  });
});
