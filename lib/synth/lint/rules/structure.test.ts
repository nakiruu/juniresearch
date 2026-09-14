import { describe, it, expect } from "vitest";
import { structure, MAX_POINTER_SENTENCES } from "@/lib/synth/lint/rules/structure";
import { unit } from "@/lib/synth/lint/__fixtures__/units";

describe("pointer-length", () => {
  it("warns on an executive-summary catalyst of three sentences", () => {
    const issues = structure([unit("executiveSummary", [
      ["sections.executiveSummary.catalysts[0]", "Cloud revenue is the catalyst. It grew fast in the quarter. The backlog says it continues."],
    ])]);
    expect(MAX_POINTER_SENTENCES).toBe(2);
    expect(issues.map((i) => [i.rule, i.severity, i.field, i.value]))
      .toEqual([["pointer-length", "warning", "sections.executiveSummary.catalysts[0]", 3]]);
  });

  it("accepts one or two sentences", () => {
    expect(structure([unit("executiveSummary", [
      ["sections.executiveSummary.risks[0]", "Refinancing is the risk. The maturity wall lands next year."],
      ["sections.executiveSummary.catalysts[1]", "Margins are the catalyst."],
    ])])).toEqual([]);
  });

  it("does not warn on a two-sentence pointer with a bold lead-in", () => {
    expect(structure([unit("executiveSummary", [
      ["sections.executiveSummary.catalysts[2]", "**Utilization.** It ran at 97.9% and the fleet is full."],
    ])])).toEqual([]);
  });

  it("warns on a three-sentence risk", () => {
    const issues = structure([unit("executiveSummary", [
      ["sections.executiveSummary.risks[1]", "Refinancing risk is mounting. The maturity wall hits next year. Covenant flexibility matters."],
    ])]);
    expect(issues.map((i) => [i.rule, i.severity, i.field, i.value]))
      .toEqual([["pointer-length", "warning", "sections.executiveSummary.risks[1]", 3]]);
  });

  it("leaves the body sections alone — only the summary's pointers are capped", () => {
    expect(structure([unit("growth", [
      ["sections.growth.points[0]", "One. Two. Three. Four."],
    ])])).toEqual([]);
  });
});

describe("source-disagreement", () => {
  it("warns when two figures of one kind are set against each other without saying which was used", () => {
    const issues = structure([unit("financials", [
      ["sections.financials.incomeCommentary", "The release reports revenue of $19.3B against the statement's $19.7B for the quarter."],
    ])]);
    expect(issues.map((i) => [i.rule, i.severity, i.field])).toEqual([["source-disagreement", "warning", "sections.financials.incomeCommentary"]]);
    expect(issues[0].message).toMatch(/which figure/);
  });

  it("accepts the same sentence when it says which figure was used", () => {
    for (const s of [
      "The release reports revenue of $19.3B against the statement's $19.7B; we use the statement figure.",
      "Revenue of $19.3B versus $19.7B — we used the filing's number throughout.",
      "Revenue of $19.3B vs $19.7B, and the statement figure is the one on the page.",
    ])
      expect(structure([unit("financials", [["sections.financials.incomeCommentary", s]])]), s).toEqual([]);
  });

  it("says nothing when the two figures are of different kinds", () => {
    expect(structure([unit("valuation", [
      ["sections.valuation.multiplesCommentary", "It trades at 44.9x against $19.28 of FY27 EPS."],
    ])])).toEqual([]);
  });

  it("says nothing when the sentence names one figure, or none", () => {
    expect(structure([unit("valuation", [
      ["sections.valuation.multiplesCommentary", "It trades at 44.9x against the peer set."],
      ["sections.valuation.scenarioCommentary", "Growth against the cycle is the question."],
    ])])).toEqual([]);
  });
});
