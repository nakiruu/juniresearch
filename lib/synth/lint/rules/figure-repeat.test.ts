import { describe, it, expect } from "vitest";
import { figureRepeat } from "@/lib/synth/lint/rules/figure-repeat";
import { unit } from "@/lib/synth/lint/__fixtures__/units";

describe("figure-repeat (error)", () => {
  it("flags a display key used twice inside one field", () => {
    const issues = figureRepeat([unit("financials", [
      ["sections.financials.incomeCommentary", "Cloud grew 30% while total revenue grew 12.4%. The 30% is the mix driver."],
    ])]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "figure-repeat",
      severity: "error",
      field: "sections.financials.incomeCommentary",
      value: "30%",
    });
    expect(issues[0].message).toContain("financials");
  });

  it("flags a display key used in two fields of the executive summary — a pointer must not restate the thesis", () => {
    const issues = figureRepeat([unit("executiveSummary", [
      ["sections.executiveSummary.thesis.body", "Utilization ran at 97.9% across the fleet."],
      ["sections.executiveSummary.catalysts[2]", "Utilization of 97.9% is the number to watch."],
    ])]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "figure-repeat",
      severity: "error",
      field: "sections.executiveSummary.catalysts[2]",
      value: "97.9%",
    });
    expect(issues[0].message).toContain("executiveSummary");
    expect(issues[0].message).toContain("sections.executiveSummary.thesis.body");
  });

  it("reports a repeated key once per unit, not once per extra occurrence", () => {
    const issues = figureRepeat([unit("valuation", [
      ["sections.valuation.multiplesCommentary", "At 44.9x trailing earnings the stock is dear. It traded at 44.9x last quarter too. It will likely still be 44.9x next year."],
    ])]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("figure-repeat");
  });
});

describe("figure-repeat — a repeat inside one sentence is one introduction", () => {
  it("does not flag the same key twice in the same sentence", () => {
    expect(figureRepeat([unit("financials", [
      ["sections.financials.incomeCommentary", "Guidance commits all 30 gigawatts of capacity, not all 30 gigawatts of it, by 2027."],
    ])])).toEqual([]);
  });

  it("flags the same key once it reaches a later sentence of the same field", () => {
    const issues = figureRepeat([unit("financials", [
      ["sections.financials.incomeCommentary", "Guidance commits 30 gigawatts of capacity by 2027. A further 30 gigawatts is under negotiation."],
    ])]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "figure-repeat",
      severity: "error",
      field: "sections.financials.incomeCommentary",
      value: "30",
    });
    expect(issues[0].message).toContain("twice in sections.financials.incomeCommentary");
  });
});

describe("figure-repeat-unit (warning)", () => {
  it("warns on a key used in two different fields of a unit that is not the executive summary", () => {
    const issues = figureRepeat([unit("businessMoat", [
      ["sections.businessMoat.segments[1].body", "It held 94% of the mix through the year."],
      ["sections.businessMoat.moatFactors[2].body", "That 94% is what the switching cost protects."],
    ])]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "figure-repeat-unit",
      severity: "warning",
      field: "sections.businessMoat.moatFactors[2].body",
      value: "94%",
    });
    expect(issues[0].message).toContain("sections.businessMoat.segments[1].body");
  });

  it("stays an error, not a warning, when the repeat is inside one field of that same unit", () => {
    expect(figureRepeat([unit("management", [
      ["sections.management.governance", "Pay was $4.2M. The $4.2M is almost all variable."],
    ])]).map((i) => [i.rule, i.severity])).toEqual([["figure-repeat", "error"]]);
  });

  it("separates the two tiers inside one run", () => {
    const issues = figureRepeat([
      unit("executiveSummary", [
        ["sections.executiveSummary.thesis.body", "Backlog reached $664 billion."],
        ["sections.executiveSummary.risks[0]", "That $664 billion has to be financed."],
      ]),
      unit("risks", [
        ["sections.risks.idiosyncratic[0]", "Capex ran to -$55.7B."],
        ["sections.risks.systemic", "The -$55.7B is the exposure."],
      ]),
    ]);
    expect(issues.map((i) => [i.rule, i.severity, i.value])).toEqual([
      ["figure-repeat", "error", "$664 billion"],
      ["figure-repeat-unit", "warning", "-$55.7B"],
    ]);
  });
});

describe("figure-repeat — what neither tier touches", () => {
  it("does not flag the same key in two different units", () => {
    expect(figureRepeat([
      unit("financials", [["sections.financials.incomeCommentary", "Gross margin was 65.2% in FY26."]]),
      unit("growth", [["sections.growth.points[0]", "Gross margin of 65.2% is the constraint."]]),
    ])).toEqual([]);
  });

  it("does not flag a difference in display form — the reader sees two different figures", () => {
    expect(figureRepeat([unit("financials", [
      ["sections.financials.incomeCommentary", "Revenue was $5.2B."],
      ["sections.financials.balanceCommentary", "Revenue was $5,207,393 thousand."],
    ])])).toEqual([]);
  });

  it("honours the tokeniser's allow-list: bare integers up to 12, years, quarters, form names", () => {
    expect(figureRepeat([unit("management", [
      ["sections.management.leadership", "Three of the 8 directors joined in 2024 after the 10-Q for Q3'26."],
      ["sections.management.governance", "Three of the 8 directors joined in 2024 after the 10-Q for Q3'26."],
    ])])).toEqual([]);
  });

  it("counts the rating's own figures like any other figure", () => {
    const issues = figureRepeat([unit("finalRecommendation", [
      ["sections.finalRecommendation.body[0]", "Target band $165 to $205."],
      ["sections.finalRecommendation.body[2]", "We hold the $205 top of the band."],
    ])]);
    expect(issues.map((i) => [i.rule, i.value])).toEqual([["figure-repeat-unit", "$205"]]);
  });

  it("says nothing about a unit with no leaves or no figures", () => {
    expect(figureRepeat([unit("risks", []), unit("growth", [["sections.growth.points[0]", "The mix keeps shifting."]])])).toEqual([]);
  });
});
