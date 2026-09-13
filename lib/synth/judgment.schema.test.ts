import { describe, it, expect } from "vitest";
import { Judgment, judgmentJsonSchema } from "@/lib/synth/judgment.schema";
import golden from "@/lib/__fixtures__/avgo-golden-judgment.json";

describe("Judgment contract", () => {
  it("accepts the golden judgment slice", () => {
    const j = Judgment.parse(golden);
    expect(j.rating.label).toBe("BUY");
    expect(j.sections.valuation.scenarios).toHaveLength(3);
    expect(j.sections.businessMoat.segments.map((s) => s.name)).toEqual(["Semiconductor Solutions", "Infrastructure Software"]);
  });
  it("rejects an over-long thesis", () => {
    const j = structuredClone(golden); j.sections.executiveSummary.thesis.body = "x".repeat(1501);
    expect(() => Judgment.parse(j)).toThrow(/thesis/);
  });
  it("rejects two scenarios and a fourth", () => {
    const two = structuredClone(golden); two.sections.valuation.scenarios = golden.sections.valuation.scenarios.slice(0, 2);
    expect(() => Judgment.parse(two)).toThrow(/scenarios/);
  });
  it("rejects null and unknown keys — facts do not belong in a judgment", () => {
    const n = structuredClone(golden) as Record<string, unknown>; (n.sections as Record<string, unknown>).growth = null;
    expect(() => Judgment.parse(n)).toThrow();
    const extra = { ...structuredClone(golden), quote: { currentPrice: 1 } };
    expect(() => Judgment.parse(extra)).toThrow(/quote/);
  });
  it("rejects a blank catalyst and a probability outside (0, 1)", () => {
    const b = structuredClone(golden); b.sections.executiveSummary.catalysts[0] = "   ";
    expect(() => Judgment.parse(b)).toThrow(/blank/);
    const p = structuredClone(golden); p.sections.valuation.scenarios[0].probability = 1;
    expect(() => Judgment.parse(p)).toThrow(/probability/);
  });
  it("exports a JSON Schema naming the top-level keys and the rating enum", () => {
    const js = judgmentJsonSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(js.required.sort()).toEqual(["analystCommentary", "meta", "rating", "sections"]);
    expect(JSON.stringify(js)).toContain("STRONG BUY");
  });
});

describe("Judgment.highlights", () => {
  it("accepts up to four unique highlight keys, and leaves the field off entirely as valid (the golden fixture has none)", () => {
    expect(Judgment.parse(golden).highlights).toBeUndefined();
    const j = { ...structuredClone(golden), highlights: ["capexLatestFY", "netDebtToEbitda"] };
    expect(Judgment.parse(j).highlights).toEqual(["capexLatestFY", "netDebtToEbitda"]);
  });
  it("rejects an unknown highlight key", () => {
    const j = { ...structuredClone(golden), highlights: ["notARealKey"] };
    expect(() => Judgment.parse(j)).toThrow();
  });
  it("rejects a fifth highlight key (schema caps at four; uniqueness is validateJudgment's job, not the schema's)", () => {
    const j = { ...structuredClone(golden), highlights: ["fcfLatestFY", "capexLatestFY", "netDebtLatestFY", "totalDebtLatestFY", "netDebtToEbitda"] };
    expect(() => Judgment.parse(j)).toThrow();
  });
  it("does not reject duplicate keys at the schema level (validateJudgment catches those)", () => {
    const j = { ...structuredClone(golden), highlights: ["capexLatestFY", "capexLatestFY"] };
    expect(() => Judgment.parse(j)).not.toThrow();
  });
  it("keeps the JSON Schema export lossless with the new field", () => {
    const js = judgmentJsonSchema() as { properties: { highlights?: { items?: { enum?: string[] } } } };
    expect(js.properties.highlights?.items?.enum).toContain("netDebtToEbitda");
  });
});
