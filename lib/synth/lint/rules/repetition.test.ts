import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "@/lib/synth/desk.schema";
import { repetition, MIN_SENTENCE_WORDS } from "@/lib/synth/lint/rules/repetition";
import { unit } from "@/lib/synth/lint/__fixtures__/units";

const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const SENTENCE = "Management raised the full-year outlook to at least ninety billion of total revenues.";

describe("sentence-repeat", () => {
  it("flags the same sentence in two units, at the later unit, naming the earlier field", () => {
    const issues = repetition([
      unit("growth", [["sections.growth.points[1]", SENTENCE]]),
      unit("finalRecommendation", [["sections.finalRecommendation.body[0]", SENTENCE]]),
    ], desk);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: "sentence-repeat", severity: "error", field: "sections.finalRecommendation.body[0]" });
    expect(issues[0].message).toContain("sections.growth.points[1]");
  });

  it("flags a repeat that differs only in markers, case, punctuation and digits", () => {
    const issues = repetition([
      unit("growth", [["sections.growth.points[1]", "Management raised the full-year outlook to at least $90 billion of total revenues."]]),
      unit("management", [["sections.management.leadership", "**Management raised the full-year outlook to at least $90.0 billion of total revenues!**"]]),
    ], desk);
    expect(issues.map((i) => i.rule)).toEqual(["sentence-repeat"]);
  });

  it("flags a repeated paragraph inside one unit", () => {
    const issues = repetition([unit("financials", [
      ["sections.financials.incomeCommentary", SENTENCE],
      ["sections.financials.cashflowCommentary", SENTENCE],
    ])], desk);
    expect(issues.map((i) => [i.rule, i.field])).toEqual([["sentence-repeat", "sections.financials.cashflowCommentary"]]);
  });

  it("flags a near-repeat at or above the error threshold", () => {
    const issues = repetition([
      unit("growth", [["sections.growth.points[0]", "Management raised the full-year outlook to at least ninety billion of total revenues."]]),
      unit("risks", [["sections.risks.systemic", "Management raised the full-year outlook to at least ninety billion of total revenues today."]]),
    ], desk);
    expect(issues.map((i) => i.rule)).toEqual(["sentence-repeat"]);   // jaccard 0.90
  });

  it("ignores sentences below the eight-word floor", () => {
    expect(MIN_SENTENCE_WORDS).toBe(8);
    expect(repetition([
      unit("growth", [["sections.growth.points[0]", "Margins held."]]),
      unit("risks", [["sections.risks.systemic", "Margins held."]]),
    ], desk)).toEqual([]);
  });

  it("says nothing about two unrelated sentences", () => {
    expect(repetition([
      unit("growth", [["sections.growth.points[0]", "Cloud infrastructure carried the quarter and the backlog behind it."]]),
      unit("risks", [["sections.risks.systemic", "Rates and refinancing are the exposures the desk is watching now."]]),
    ], desk)).toEqual([]);
  });
});

describe("sentence-similar", () => {
  it("warns on a cross-unit pair between the warning and error thresholds", () => {
    // 6 shared trigrams of 8 / 8 → jaccard 0.60 exactly, at the warning boundary.
    const a = "the desk read the filing and the proxy before the call";
    const b = "the desk read the filing and the proxy before lunch today";
    const issues = repetition([
      unit("growth", [["sections.growth.points[0]", a]]),
      unit("risks", [["sections.risks.systemic", b]]),
    ], desk);
    expect(issues.map((i) => [i.rule, i.severity, i.field]))
      .toEqual([["sentence-similar", "warning", "sections.risks.systemic"]]);
    expect(issues[0].message).toContain("sections.growth.points[0]");
  });

  it("does not warn inside one unit — the warning is a cross-section rule", () => {
    const a = "the desk read the filing and the proxy before the call";
    const b = "the desk read the filing and the proxy before lunch today";
    expect(repetition([unit("businessMoat", [
      ["sections.businessMoat.segments[1].body", a],
      ["sections.businessMoat.segments[2].body", b],
    ])], desk)).toEqual([]);
  });

  it("takes both thresholds from the desk config", () => {
    const strict = Desk.parse({ ...desk, lint: { ...desk.lint, similarity: { error: 0.5, warning: 0.2 } } });
    const a = "the desk read the filing and the proxy before the call";
    const b = "the desk read the filing and the proxy before lunch today";
    const issues = repetition([
      unit("growth", [["sections.growth.points[0]", a]]),
      unit("risks", [["sections.risks.systemic", b]]),
    ], strict);
    expect(issues.map((i) => i.rule)).toEqual(["sentence-repeat"]);   // 0.60 is now an error
  });

  it("reports at most one issue per later sentence", () => {
    const issues = repetition([
      unit("analystCommentary", [["analystCommentary", SENTENCE]]),
      unit("growth", [["sections.growth.points[0]", SENTENCE]]),
      unit("risks", [["sections.risks.systemic", SENTENCE]]),
    ], desk);
    expect(issues.map((i) => i.field)).toEqual(["sections.growth.points[0]", "sections.risks.systemic"]);
  });
});
