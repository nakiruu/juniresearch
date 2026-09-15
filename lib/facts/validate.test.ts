import { describe, it, expect } from "vitest";
import { validateFactPack, assertValidFactPack } from "@/lib/facts/validate";
import { minimalPack } from "@/lib/facts/__fixtures__/minimal-pack";

describe("validateFactPack", () => {
  it("accepts the minimal pack", () => { expect(validateFactPack(minimalPack())).toEqual([]); });
  it("rejects non-consecutive fiscal years", () => {
    const p = minimalPack(); p.statements.fiscalYears = ["FY20", "FY22", "FY23", "FY24", "FY25"];
    expect(validateFactPack(p).map((i) => i.field)).toContain("statements.fiscalYears");
  });
  it("accepts an empty geographic mix but still checks a non-empty one", () => {
    const p = minimalPack(); p.geoMix = { basis: "FY25", items: [] };
    expect(validateFactPack(p)).toEqual([]);
    p.geoMix = { basis: "FY25", items: [{ region: "Americas", share: 0.5 }] };
    expect(validateFactPack(p).some((i) => i.field === "geoMix.items[].share")).toBe(true);
  });
  it("rejects segment shares that do not sum to one", () => {
    const p = minimalPack(); p.segments.items[0].share = 0.7;
    expect(validateFactPack(p).map((i) => i.field)).toContain("segments.items[].share");
  });
  it("rejects analyst counts that disagree", () => {
    const p = minimalPack(); p.analysts.count = 61;
    expect(validateFactPack(p).map((i) => i.field)).toContain("analysts.count");
  });
  it("rejects unsorted, short, or future history", () => {
    const p = minimalPack(); p.history = [{ date: "2026-09-13", close: 1 }, { date: "2026-09-12", close: 1 }];
    expect(validateFactPack(p).map((i) => i.field)).toContain("history");
  });
  it("rejects a quarter that does not end on the filing period", () => {
    const p = minimalPack(); p.latestQuarter.periodEnd = "2026-05-03";
    expect(validateFactPack(p).map((i) => i.field)).toContain("latestQuarter.periodEnd");
  });
  it("accepts a quarter that ends after the filing period", () => {
    const p = minimalPack(); p.latestQuarter.periodEnd = "2026-11-01";
    expect(validateFactPack(p).map((i) => i.field)).not.toContain("latestQuarter.periodEnd");
  });
  it("assert throws naming the label and every field", () => {
    const p = minimalPack(); p.analysts.count = 61; p.segments.items[0].share = 0.7;
    expect(() => assertValidFactPack(p, "AVGO/x")).toThrow(/AVGO\/x[\s\S]*analysts\.count[\s\S]*segments/);
  });
});
