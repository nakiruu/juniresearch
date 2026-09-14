import { describe, it, expect } from "vitest";
import { CORPUS_NAMES, loadCorpus } from "@/lib/synth/lint/__fixtures__/corpus";

describe("the regression corpus", () => {
  it("has five fixtures", () => {
    expect(CORPUS_NAMES).toHaveLength(5);
  });
  for (const name of CORPUS_NAMES)
    it(`${name} parses as a Judgment`, () => {
      const j = loadCorpus(name);
      expect(j.rating.label).toMatch(/BUY|HOLD|SELL/);
      expect(j.sections.valuation.scenarios).toHaveLength(3);
      expect(j.analystCommentary.length).toBeGreaterThan(100);
    });
  it("keeps the two ORCL defect sources distinguishable", () => {
    expect(loadCorpus("orcl-10q-before").sections.growth.points[1]).toContain("raised the full-year outlook");
    expect(loadCorpus("avgo-gov-before").sections.management.governance).toContain("{- Mr. Hartenstein was not standing for re-election -}");
  });
});
