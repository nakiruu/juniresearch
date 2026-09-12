import { describe, it, expect } from "vitest";
import { validateReport, assertValidReport } from "@/lib/validate";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const base = () => Report.parse(structuredClone(avgo));

describe("validateReport", () => {
  it("accepts the reference fixture", () => {
    expect(validateReport(base())).toEqual([]);
  });

  it("rejects scenario probabilities that do not sum to 1", () => {
    const r = base();
    r.sections.valuation.scenarios[0].probability = 0.4;
    const issues = validateReport(r);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("sections.valuation.scenarios[].probability");
    expect(issues[0].value).toBeCloseTo(1.1, 10);
  });

  it("tolerates floating point drift within 0.001", () => {
    const r = base();
    r.sections.valuation.scenarios[0].probability = 0.3005;
    r.sections.valuation.scenarios[2].probability = 0.1995;
    expect(validateReport(r)).toEqual([]);
  });

  it("rejects an inverted rating band", () => {
    const r = base();
    r.rating.targetLow = 600;
    const issues = validateReport(r);
    expect(issues.some((i) => i.field === "rating.targetLow")).toBe(true);
  });

  it("rejects analyst counts that do not sum to numAnalysts", () => {
    const r = base();
    r.analystSentiment.hold = 9;
    const issues = validateReport(r);
    expect(issues.some((i) => i.field === "analystSentiment.numAnalysts")).toBe(true);
  });

  it("rejects a ratio outside [0,1] where one is required", () => {
    const r = base();
    r.sections.businessMoat.geoMix[0].sharePct = 1.4;
    const issues = validateReport(r);
    expect(issues.some((i) => i.field.includes("geoMix"))).toBe(true);
  });

  it("flags a rating band that does not bracket the base case", () => {
    const r = base();
    r.rating.targetHigh = 460; // base case is 490
    const issues = validateReport(r);
    expect(issues.some((i) => i.field === "rating")).toBe(true);
  });

  it("skips the bracket check when no scenario is named base", () => {
    const r = base();
    r.sections.valuation.scenarios[1].name = "Central";
    r.rating.targetHigh = 460;
    expect(validateReport(r).some((i) => i.field === "rating")).toBe(false);
  });
});

describe("assertValidReport", () => {
  it("does not throw on the reference fixture", () => {
    expect(() => assertValidReport(base(), "AVGO")).not.toThrow();
  });

  it("throws naming the ticker and every offending field", () => {
    const r = base();
    r.rating.targetLow = 600;
    r.analystSentiment.sell = 3;
    expect(() => assertValidReport(r, "AVGO")).toThrow(/AVGO/);
    expect(() => assertValidReport(r, "AVGO")).toThrow(/rating\.targetLow/);
    expect(() => assertValidReport(r, "AVGO")).toThrow(/numAnalysts/);
  });
});
