import { describe, it, expect } from "vitest";
import { stringLeaves } from "@/lib/synth/walk";
import { UNIT_NAMES, unitFor, sectionUnits } from "@/lib/synth/lint/units";
import { loadCorpus } from "@/lib/synth/lint/__fixtures__/corpus";

const TABLE: [string, string | null][] = [
  ["meta.subtitle", null],
  ["meta.fiscalYearEnd", null],
  ["rating.label", null],
  ["highlights[0]", null],
  ["analystCommentary", "analystCommentary"],
  ["sections.executiveSummary.companyOverview", "companyOverview"],
  ["sections.executiveSummary.thesis.body", "executiveSummary"],
  ["sections.executiveSummary.catalysts[2]", "executiveSummary"],
  ["sections.executiveSummary.risks[0]", "executiveSummary"],
  ["sections.financials.incomeCommentary", "financials"],
  ["sections.financials.balanceCommentary", "financials"],
  ["sections.financials.cashflowCommentary", "financials"],
  ["sections.valuation.multiplesCommentary", "valuation"],
  ["sections.valuation.scenarioCommentary", "valuation"],
  ["sections.valuation.scenarios[1].driver", "scenarioDrivers"],
  ["sections.valuation.scenarios[1].name", null],
  ["sections.businessMoat.segments[0].name", "businessMoat"],
  ["sections.businessMoat.segments[0].body", "businessMoat"],
  ["sections.businessMoat.moatFactors[0].body", "businessMoat"],
  ["sections.businessMoat.moatFactors[0].name", null],
  ["sections.businessMoat.moatFactors[0].strength", null],
  ["sections.businessMoat.moatRating", null],
  ["sections.businessMoat.durability", "businessMoat"],
  ["sections.growth.points[3]", "growth"],
  ["sections.management.leadership", "management"],
  ["sections.management.capitalAllocation", "management"],
  ["sections.management.governance", "management"],
  ["sections.management.insiderOwnership", "management"],
  ["sections.risks.idiosyncratic[1]", "risks"],
  ["sections.risks.systemic", "risks"],
  ["sections.finalRecommendation.body[0]", "finalRecommendation"],
];

describe("unitFor", () => {
  for (const [path, want] of TABLE)
    it(`${path} → ${want ?? "excluded"}`, () => expect(unitFor(path)).toBe(want));
});

describe("sectionUnits", () => {
  const j = loadCorpus("avgo-final");
  const units = sectionUnits(j);

  it("returns the eleven units in render order", () => {
    expect(units.map((u) => u.name)).toEqual([...UNIT_NAMES]);
    expect(UNIT_NAMES).toHaveLength(11);
  });

  it("puts every judgment leaf in exactly one unit or excludes it", () => {
    const inUnits = units.flatMap((u) => u.leaves.map((l) => l.path));
    expect(new Set(inUnits).size).toBe(inUnits.length);
    const excluded = stringLeaves(j).map((l) => l.path).filter((p) => !inUnits.includes(p));
    expect(excluded.sort()).toEqual([
      "meta.fiscalYearEnd", "meta.subtitle",
      "rating.label",
      "sections.businessMoat.moatFactors[0].name", "sections.businessMoat.moatFactors[0].strength",
      "sections.businessMoat.moatFactors[1].name", "sections.businessMoat.moatFactors[1].strength",
      "sections.businessMoat.moatFactors[2].name", "sections.businessMoat.moatFactors[2].strength",
      "sections.businessMoat.moatFactors[3].name", "sections.businessMoat.moatFactors[3].strength",
      "sections.businessMoat.moatRating",
      "sections.valuation.scenarios[0].name", "sections.valuation.scenarios[1].name", "sections.valuation.scenarios[2].name",
    ].sort());
  });

  it("keeps the company overview out of the executive summary unit", () => {
    const overview = units.find((u) => u.name === "companyOverview")!;
    const summary = units.find((u) => u.name === "executiveSummary")!;
    expect(overview.leaves.map((l) => l.path)).toEqual(["sections.executiveSummary.companyOverview"]);
    expect(summary.leaves.map((l) => l.path)).not.toContain("sections.executiveSummary.companyOverview");
  });

  it("keeps the scenario drivers out of the valuation unit", () => {
    const valuation = units.find((u) => u.name === "valuation")!;
    const drivers = units.find((u) => u.name === "scenarioDrivers")!;
    expect(valuation.leaves.map((l) => l.path)).toEqual([
      "sections.valuation.multiplesCommentary", "sections.valuation.scenarioCommentary",
    ]);
    expect(drivers.leaves).toHaveLength(3);
    expect(drivers.leaves[0].text).toBe(j.sections.valuation.scenarios[0].driver);
  });

  it("carries each leaf's text verbatim", () => {
    const fin = units.find((u) => u.name === "financials")!;
    expect(fin.leaves.find((l) => l.path === "sections.financials.incomeCommentary")!.text)
      .toBe(j.sections.financials.incomeCommentary);
  });
});
