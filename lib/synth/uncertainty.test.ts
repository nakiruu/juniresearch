import { describe, it, expect } from "vitest";
import { segmentHHI, uncertaintyTier, uncertaintyMultiplier, type UncertaintyInputs } from "./uncertainty";

const base: UncertaintyInputs = {
  dispersion: 0.2, sic: 3559, netDebtToEbitda: 1, netDebtor: true, fiscalYears: 5, abstentions: 0, segmentHHI: 0.2, sector: "industrial",
};

describe("segmentHHI", () => {
  it("is the sum of squared shares over TWO OR MORE segments; a single reported segment is uninformative (null)", () => {
    expect(segmentHHI([{ share: 1 }])).toBeNull(); // one reported segment tells you nothing about diversification
    expect(segmentHHI([{ share: 0.5 }, { share: 0.3 }, { share: 0.2 }])).toBeCloseTo(0.38, 5);
    expect(segmentHHI([])).toBeNull();
  });
});

describe("uncertaintyTier", () => {
  it("rates a fortress name (well covered, defensive/steady, single-segment) Low", () => {
    expect(uncertaintyTier({ ...base, dispersion: 0.3, sic: 7389, segmentHHI: null }).tier).toBe("low");
    expect(uncertaintyTier({ ...base, sic: 4911, sector: "utility", netDebtToEbitda: 6 }).tier).toBe("low"); // utility leverage is not uncertainty
  });
  it("rates a contested, cyclical, concentrated name (AMD-like) High", () => {
    const u = uncertaintyTier({ ...base, dispersion: 1.58, sic: 3674, netDebtor: false, segmentHHI: 0.42 });
    expect(u.tier).toBe("high"); // dispersion 3 + cyclical 2 + concentration 1 = 6
    expect(u.points).toBeGreaterThanOrEqual(5);
  });
  it("rates a thin, distressed young issuer Very High", () => {
    const u = uncertaintyTier({ ...base, dispersion: 1.2, sic: 3674, netDebtToEbitda: 6, fiscalYears: 3, abstentions: 1, segmentHHI: 0.9 });
    expect(u.tier).toBe("veryHigh"); // dispersion 3 + leverage 2 + cyclical 2 + <5FY 1 + abstain 1 + concentration 2 = 11
  });
  it("does not charge leverage, concentration, or structural abstentions to a bank/utility", () => {
    const u = uncertaintyTier({ ...base, dispersion: 0.25, sic: 6021, sector: "financial", netDebtToEbitda: 15, segmentHHI: 0.9, abstentions: 3 });
    expect(u.tier).toBe("low");
  });
});

describe("uncertaintyMultiplier — widens the bullish minimum-upside band", () => {
  it("is 1.0 at Low (today's thresholds) and rises with the tier", () => {
    expect(uncertaintyMultiplier("low")).toBe(1);
    expect(uncertaintyMultiplier("high")).toBeGreaterThan(uncertaintyMultiplier("medium"));
    expect(uncertaintyMultiplier("veryHigh")).toBeGreaterThan(uncertaintyMultiplier("high"));
  });
});
