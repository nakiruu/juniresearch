import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "@/lib/synth/desk.schema";
import { lintJudgment, lintLine } from "@/lib/synth/lint";
import { cleanJudgment } from "@/lib/synth/lint/__fixtures__/units";

const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));

describe("lintJudgment", () => {
  it("returns no issue for a judgment with no prose issues", () => {
    expect(lintJudgment(cleanJudgment(), desk)).toEqual([]);
  });
  it("is deterministic", () => {
    const j = cleanJudgment();
    expect(lintJudgment(j, desk)).toEqual(lintJudgment(j, desk));
  });
});

describe("lintLine", () => {
  it("prints an error with its rule, field, message and value", () => {
    expect(lintLine({ rule: "figure-repeat", severity: "error", field: "sections.financials.incomeCommentary", message: '"65.2%" is introduced twice in financials', value: "65.2%" }))
      .toBe('lint/figure-repeat: sections.financials.incomeCommentary: "65.2%" is introduced twice in financials (received "65.2%")');
  });
  it("prefixes a warning with warn:", () => {
    expect(lintLine({ rule: "tic", severity: "warning", field: "analystCommentary", message: '"leg" appears 11 times', value: "leg" }))
      .toBe('warn: lint/tic: analystCommentary: "leg" appears 11 times (received "leg")');
  });
});

import { CORPUS_NAMES, loadCorpus, type CorpusName } from "@/lib/synth/lint/__fixtures__/corpus";

const lintOf = (name: CorpusName) => lintJudgment(loadCorpus(name), desk);
const errorsOf = (name: CorpusName) => lintOf(name).filter((i) => i.severity === "error");
const rulesAt = (name: CorpusName, field: string) => errorsOf(name).filter((i) => i.field === field).map((i) => i.rule);

describe("the regression corpus — the defects the desk found by hand", () => {
  it("orcl-10q-before: the raised-outlook sentence is repeated across three units", () => {
    // 4 sentence-repeat errors in all (per the plan): the raised-outlook sentence pair
    // (analystCommentary → management.leadership, analystCommentary → finalRecommendation.body[0],
    // the latter twice at two similarity bands) plus one unrelated internal repeat within
    // businessMoat — that fourth one does not mention analystCommentary, so the
    // analystCommentary check is scoped to the two named fields, not every repeat.
    const repeats = errorsOf("orcl-10q-before").filter((i) => i.rule === "sentence-repeat");
    expect(repeats).toHaveLength(4);
    const namedFields = ["sections.management.leadership", "sections.finalRecommendation.body[0]"];
    expect(repeats.map((i) => i.field)).toEqual(expect.arrayContaining(namedFields));
    const raisedOutlookRepeats = repeats.filter((i) => namedFields.includes(i.field));
    expect(raisedOutlookRepeats.every((i) => i.message.includes("analystCommentary"))).toBe(true);
  });

  it("orcl-10q-before: the executive summary introduces 850 and 97.9% twice — an error even across fields", () => {
    const keys = errorsOf("orcl-10q-before")
      .filter((i) => i.rule === "figure-repeat" && i.field.startsWith("sections.executiveSummary."))
      .map((i) => i.value);
    expect(keys).toEqual(expect.arrayContaining(["850", "97.9%"]));
  });

  it("orcl-10q-before: a cross-field repeat outside the executive summary is a warning, not an error", () => {
    const warnings = lintOf("orcl-10q-before").filter((i) => i.rule === "figure-repeat-unit");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((i) => i.severity === "warning")).toBe(true);
    expect(warnings.some((i) => i.field.startsWith("sections.executiveSummary."))).toBe(false);
  });

  it("orcl-10q-before: a figure repeated inside one field is an error wherever it is", () => {
    const sameField = errorsOf("orcl-10q-before").filter((i) => i.rule === "figure-repeat" && i.message.includes(`twice in ${i.field}`));
    expect(sameField.length).toBeGreaterThan(0);
  });

  it("orcl-10q-before: no span is mis-scoped", () => {
    expect(errorsOf("orcl-10q-before").filter((i) => i.rule === "span-scope")).toEqual([]);
  });

  it("orcl-10q-after: the editorial round removed errors, it did not remove all of them", () => {
    expect(errorsOf("orcl-10q-after").length).toBeLessThan(errorsOf("orcl-10q-before").length);
  });

  it("orcl-gov-before: the lint has nothing to say about the defects that round fixed", () => {
    // Its defects were attribution and inference — rubric items 1 and 2. This documents the lint's limit.
    expect(rulesAt("orcl-gov-before", "sections.management.governance")).not.toContain("sentence-repeat");
  });

  it("avgo-gov-before: the Hartenstein span wraps a clause with no figure", () => {
    const spans = errorsOf("avgo-gov-before").filter((i) => i.rule === "span-scope");
    expect(spans).toHaveLength(1);
    expect(spans[0].field).toBe("sections.management.governance");
    expect(spans[0].value).toBe("{- Mr. Hartenstein was not standing for re-election -}");
  });

  it("avgo-gov-before: the proxy's record revenue is quoted without attribution", () => {
    expect(rulesAt("avgo-gov-before", "sections.management.governance")).toContain("superlative");
  });

  it("never throws on any fixture", () => {
    for (const name of CORPUS_NAMES) expect(() => lintOf(name)).not.toThrow();
  });
});

describe("the regression corpus — the full lint output, so a rule change is visible", () => {
  // Unrolled rather than looped over CORPUS_NAMES: toMatchInlineSnapshot() writes its
  // recorded literal back into the source at the expect() call site, so every fixture
  // needs its own call site — a shared loop body would have all five writes collide on
  // one line.
  it("orcl-10q-before", () => {
    expect(lintOf("orcl-10q-before").map(lintLine).join("\n")).toMatchInlineSnapshot(`
      "lint/figure-repeat: sections.executiveSummary.catalysts[0]: "$664 billion" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "$664 billion")
      lint/figure-repeat: sections.executiveSummary.catalysts[2]: "850" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "850")
      lint/figure-repeat: sections.executiveSummary.catalysts[2]: "300,000" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "300,000")
      lint/figure-repeat: sections.executiveSummary.catalysts[2]: "97.9%" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "97.9%")
      lint/figure-repeat: sections.executiveSummary.risks[0]: "-$21.2B" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "-$21.2B")
      lint/figure-repeat: sections.executiveSummary.risks[0]: "-$55.7B" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "-$55.7B")
      lint/figure-repeat: sections.executiveSummary.risks[1]: "-$23.7B" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "-$23.7B")
      lint/figure-repeat: sections.executiveSummary.risks[1]: "$156.2B" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "$156.2B")
      lint/figure-repeat: sections.executiveSummary.risks[2]: "4.6x" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "4.6x")
      lint/figure-repeat: sections.executiveSummary.risks[2]: "3.2x" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "3.2x")
      lint/figure-repeat: sections.executiveSummary.risks[4]: "121%" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "121%")
      lint/figure-repeat: sections.financials.incomeCommentary: "30%" is introduced twice in sections.financials.incomeCommentary — introduce a figure once and refer back in words (received "30%")
      warn: lint/figure-repeat-unit: sections.financials.balanceCommentary: "55%" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "55%")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$20.8B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$20.8B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$90 billion" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$90 billion")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "13.6x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "13.6x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "14.7x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "14.7x")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "+57.5%" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "+57.5%")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$236.52" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$236.52")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$664 billion" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$664 billion")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "56" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "56")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "26" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "26")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$95.00" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$95.00")
      warn: lint/figure-repeat-unit: sections.valuation.scenarios[1].driver: "$11.02" is introduced twice in scenarioDrivers (first in sections.valuation.scenarios[0].driver) — consider referring back in words instead of restating it (received "$11.02")
      warn: lint/figure-repeat-unit: sections.valuation.scenarios[2].driver: "$131.2B" is introduced twice in scenarioDrivers (first in sections.valuation.scenarios[0].driver) — consider referring back in words instead of restating it (received "$131.2B")
      warn: lint/figure-repeat-unit: sections.management.capitalAllocation: "$90 billion" is introduced twice in management (first in sections.management.leadership) — consider referring back in words instead of restating it (received "$90 billion")
      lint/sentence-repeat: sections.businessMoat.segments[2].body: this sentence repeats sections.businessMoat.segments[1].body (same section) at trigram similarity 1.00 — no sentence appears in two sections (received "9.1% of the FY25 revenue mix at $5.2B, and 8% of total revenues on a trailing four-quarter basis per the 10-Q.")
      lint/sentence-repeat: sections.management.leadership: this sentence repeats analystCommentary (analystCommentary → management) at trigram similarity 0.88 — no sentence appears in two sections (received "Management also raised the full-year outlook, to at least $90 billion of total revenues and $8.10 of non-GAAP EPS.")
      lint/sentence-repeat: sections.finalRecommendation.body[0]: this sentence repeats analystCommentary (analystCommentary → finalRecommendation) at trigram similarity 1.00 — no sentence appears in two sections (received "Probability-weighted fair value $181.70 against a last price of $150.15.**")
      lint/sentence-repeat: sections.finalRecommendation.body[0]: this sentence repeats analystCommentary (analystCommentary → finalRecommendation) at trigram similarity 0.81 — no sentence appears in two sections (received "Management raised the full-year outlook to at least $90 billion of total revenues and $8.10 of non-GAAP EPS.")
      lint/superlative: sections.executiveSummary.companyOverview: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      warn: lint/judgment-superlative: sections.valuation.multiplesCommentary: "the first" reads as a superlative — check the source says so, or drop the article (received "the first")
      warn: lint/judgment-superlative: sections.valuation.scenarioCommentary: "the only" reads as a superlative — check the source says so, or drop the article (received "the only")
      warn: lint/judgment-superlative: sections.management.capitalAllocation: "the only" reads as a superlative — check the source says so, or drop the article (received "the only")
      warn: lint/judgment-superlative: sections.risks.idiosyncratic[0]: "the first" reads as a superlative — check the source says so, or drop the article (received "the first")
      lint/superlative: sections.finalRecommendation.body[0]: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      warn: lint/tic: analystCommentary: "leg" appears 10 times across the judgment, over the desk's limit of 4 — vary it (received "leg")
      warn: lint/tic: sections.executiveSummary.risks[5]: "this pack" appears 10 times across the judgment, over the desk's limit of 4 — vary it (received "this pack")
      warn: lint/tic: sections.financials.incomeCommentary: "is where" appears 5 times across the judgment, over the desk's limit of 4 — vary it (received "is where")
      warn: lint/source-disagreement: analystCommentary: two figures of the same kind are set against each other — if two sources disagree, say so once and name which figure the report uses (received "The filing puts cloud revenues at 60% of total revenues for the quarter against 48% for the same three months a year earlier, so the mix moved sharply inside one year.")
      warn: lint/source-disagreement: sections.financials.incomeCommentary: two figures of the same kind are set against each other — if two sources disagree, say so once and name which figure the report uses (received "The mix inside that is the story: the filing puts cloud revenues at 60% of total revenues for the quarter against 48% for the same three months a year earlier.")"
    `);
  });
  it("orcl-10q-after", () => {
    expect(lintOf("orcl-10q-after").map(lintLine).join("\n")).toMatchInlineSnapshot(`
      "lint/figure-repeat: sections.financials.incomeCommentary: "30%" is introduced twice in sections.financials.incomeCommentary — introduce a figure once and refer back in words (received "30%")
      warn: lint/figure-repeat-unit: sections.financials.balanceCommentary: "55%" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "55%")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$20.8B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$20.8B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$90 billion" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$90 billion")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "13.6x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "13.6x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "14.7x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "14.7x")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$664 billion" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$664 billion")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "56" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "56")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "26" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "26")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$95.00" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$95.00")
      warn: lint/figure-repeat-unit: sections.valuation.scenarios[1].driver: "$11.02" is introduced twice in scenarioDrivers (first in sections.valuation.scenarios[0].driver) — consider referring back in words instead of restating it (received "$11.02")
      warn: lint/figure-repeat-unit: sections.valuation.scenarios[2].driver: "$131.2B" is introduced twice in scenarioDrivers (first in sections.valuation.scenarios[0].driver) — consider referring back in words instead of restating it (received "$131.2B")
      lint/sentence-repeat: sections.businessMoat.segments[2].body: this sentence repeats sections.businessMoat.segments[1].body (same section) at trigram similarity 1.00 — no sentence appears in two sections (received "9.1% of the FY25 revenue mix at $5.2B, and 8% of total revenues on a trailing four-quarter basis per the 10-Q.")
      lint/sentence-repeat: sections.finalRecommendation.body[0]: this sentence repeats analystCommentary (analystCommentary → finalRecommendation) at trigram similarity 1.00 — no sentence appears in two sections (received "Probability-weighted fair value $181.70 against a last price of $150.15.**")
      lint/superlative: sections.executiveSummary.companyOverview: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      warn: lint/judgment-superlative: sections.valuation.scenarioCommentary: "the only" reads as a superlative — check the source says so, or drop the article (received "the only")
      warn: lint/judgment-superlative: sections.risks.idiosyncratic[0]: "the first" reads as a superlative — check the source says so, or drop the article (received "the first")
      lint/superlative: sections.finalRecommendation.body[0]: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      warn: lint/tic: sections.financials.incomeCommentary: "is where" appears 6 times across the judgment, over the desk's limit of 4 — vary it (received "is where")
      warn: lint/pointer-length: sections.executiveSummary.catalysts[0]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.risks[0]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.risks[2]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.risks[4]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/source-disagreement: sections.financials.incomeCommentary: two figures of the same kind are set against each other — if two sources disagree, say so once and name which figure the report uses (received "The mix inside that is the story: the filing puts cloud revenues at 60% of total revenues for the quarter against 48% for the same three months a year earlier.")"
    `);
  });
  it("orcl-gov-before", () => {
    expect(lintOf("orcl-gov-before").map(lintLine).join("\n")).toMatchInlineSnapshot(`
      "lint/figure-repeat: sections.financials.incomeCommentary: "30%" is introduced twice in sections.financials.incomeCommentary — introduce a figure once and refer back in words (received "30%")
      warn: lint/figure-repeat-unit: sections.financials.balanceCommentary: "55%" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "55%")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$20.8B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$20.8B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$90 billion" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$90 billion")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "13.6x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "13.6x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "14.7x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "14.7x")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$664 billion" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$664 billion")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "56" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "56")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "26" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "26")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "$95.00" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "$95.00")
      warn: lint/figure-repeat-unit: sections.valuation.scenarios[1].driver: "$11.02" is introduced twice in scenarioDrivers (first in sections.valuation.scenarios[0].driver) — consider referring back in words instead of restating it (received "$11.02")
      warn: lint/figure-repeat-unit: sections.valuation.scenarios[2].driver: "$131.2B" is introduced twice in scenarioDrivers (first in sections.valuation.scenarios[0].driver) — consider referring back in words instead of restating it (received "$131.2B")
      lint/sentence-repeat: sections.businessMoat.segments[2].body: this sentence repeats sections.businessMoat.segments[1].body (same section) at trigram similarity 1.00 — no sentence appears in two sections (received "9.1% of the FY25 revenue mix at $5.2B, and 8% of total revenues on a trailing four-quarter basis per the 10-Q.")
      lint/sentence-repeat: sections.finalRecommendation.body[0]: this sentence repeats analystCommentary (analystCommentary → finalRecommendation) at trigram similarity 1.00 — no sentence appears in two sections (received "Probability-weighted fair value $181.70 against a last price of $150.15.**")
      lint/superlative: sections.executiveSummary.companyOverview: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      warn: lint/judgment-superlative: sections.valuation.scenarioCommentary: "the only" reads as a superlative — check the source says so, or drop the article (received "the only")
      lint/superlative: sections.management.leadership: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      lint/superlative: sections.management.insiderOwnership: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      warn: lint/judgment-superlative: sections.risks.idiosyncratic[0]: "the first" reads as a superlative — check the source says so, or drop the article (received "the first")
      lint/superlative: sections.finalRecommendation.body[0]: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      warn: lint/tic: sections.financials.incomeCommentary: "is where" appears 6 times across the judgment, over the desk's limit of 4 — vary it (received "is where")
      warn: lint/pointer-length: sections.executiveSummary.catalysts[0]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.risks[0]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.risks[2]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.risks[4]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/source-disagreement: sections.financials.incomeCommentary: two figures of the same kind are set against each other — if two sources disagree, say so once and name which figure the report uses (received "The mix inside that is the story: the filing puts cloud revenues at 60% of total revenues for the quarter against 48% for the same three months a year earlier.")"
    `);
  });
  it("avgo-gov-before", () => {
    expect(lintOf("avgo-gov-before").map(lintLine).join("\n")).toMatchInlineSnapshot(`
      "lint/figure-repeat: analystCommentary: "$361.99" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "$361.99")
      lint/figure-repeat: analystCommentary: "54" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "54")
      lint/figure-repeat: analystCommentary: "60" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "60")
      lint/figure-repeat: analystCommentary: "$509.61" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "$509.61")
      lint/figure-repeat: sections.executiveSummary.catalysts[0]: "$58 billion" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "$58 billion")
      lint/figure-repeat: sections.executiveSummary.risks[0]: "50%" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "50%")
      lint/figure-repeat: sections.financials.incomeCommentary: "86%" is introduced twice in sections.financials.incomeCommentary — introduce a figure once and refer back in words (received "86%")
      warn: lint/figure-repeat-unit: sections.financials.balanceCommentary: "$25.5B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$25.5B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$27.5B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$27.5B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$5,641 million" is introduced twice in financials (first in sections.financials.balanceCommentary) — consider referring back in words instead of restating it (received "$5,641 million")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "44.9x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "44.9x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "18.8x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "18.8x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "$19.28" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "$19.28")
      lint/figure-repeat: sections.valuation.scenarioCommentary: "25%" is introduced twice in sections.valuation.scenarioCommentary — introduce a figure once and refer back in words (received "25%")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "44.9x" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "44.9x")
      warn: lint/figure-repeat-unit: sections.businessMoat.moatFactors[2].body: "94%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "94%")
      warn: lint/figure-repeat-unit: sections.businessMoat.moatFactors[2].body: "84%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "84%")
      warn: lint/figure-repeat-unit: sections.businessMoat.moatFactors[2].body: "15%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "15%")
      warn: lint/figure-repeat-unit: sections.businessMoat.durability: "13%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "13%")
      lint/figure-repeat: sections.management.insiderOwnership: "13" is introduced twice in sections.management.insiderOwnership — introduce a figure once and refer back in words (received "13")
      warn: lint/figure-repeat-unit: sections.risks.systemic: "50%" is introduced twice in risks (first in sections.risks.idiosyncratic[0]) — consider referring back in words instead of restating it (received "50%")
      warn: lint/figure-repeat-unit: sections.finalRecommendation.body[2]: "$34.8 billion" is introduced twice in finalRecommendation (first in sections.finalRecommendation.body[0]) — consider referring back in words instead of restating it (received "$34.8 billion")
      warn: lint/sentence-similar: sections.growth.points[3]: this sentence is close to sections.executiveSummary.catalysts[0] (executiveSummary → growth) at trigram similarity 0.67 — consider pointing back instead of restating (received "Q4 non-AI semiconductor revenue is guided to approximately $4.3 billion, up 5% sequentially.")
      lint/span-scope: sections.management.governance: this span wraps 7 words and no figure — spans go around signed changes or explicit positives and negatives, never around whole sentences (received "{- Mr. Hartenstein was not standing for re-election -}")
      lint/superlative: sections.financials.cashflowCommentary: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.leadership: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.capitalAllocation: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.capitalAllocation: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.governance: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.insiderOwnership: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      warn: lint/judgment-superlative: sections.management.insiderOwnership: "the only" reads as a superlative — check the source says so, or drop the article (received "the only")
      warn: lint/judgment-superlative: sections.risks.systemic: "the first" reads as a superlative — check the source says so, or drop the article (received "the first")
      lint/superlative: sections.finalRecommendation.body[0]: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      warn: lint/pointer-length: sections.executiveSummary.catalysts[0]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[1]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[2]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[3]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[4]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[0]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[1]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[2]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[3]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[4]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)"
    `);
  });
  it("avgo-final", () => {
    expect(lintOf("avgo-final").map(lintLine).join("\n")).toMatchInlineSnapshot(`
      "lint/figure-repeat: analystCommentary: "$361.99" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "$361.99")
      lint/figure-repeat: analystCommentary: "54" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "54")
      lint/figure-repeat: analystCommentary: "60" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "60")
      lint/figure-repeat: analystCommentary: "$509.61" is introduced twice in analystCommentary — introduce a figure once and refer back in words (received "$509.61")
      lint/figure-repeat: sections.executiveSummary.catalysts[0]: "$58 billion" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "$58 billion")
      lint/figure-repeat: sections.executiveSummary.risks[0]: "50%" is introduced twice in executiveSummary (first in sections.executiveSummary.thesis.body) — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures (received "50%")
      lint/figure-repeat: sections.financials.incomeCommentary: "86%" is introduced twice in sections.financials.incomeCommentary — introduce a figure once and refer back in words (received "86%")
      warn: lint/figure-repeat-unit: sections.financials.balanceCommentary: "$25.5B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$25.5B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$27.5B" is introduced twice in financials (first in sections.financials.incomeCommentary) — consider referring back in words instead of restating it (received "$27.5B")
      warn: lint/figure-repeat-unit: sections.financials.cashflowCommentary: "$5,641 million" is introduced twice in financials (first in sections.financials.balanceCommentary) — consider referring back in words instead of restating it (received "$5,641 million")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "44.9x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "44.9x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "18.8x" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "18.8x")
      lint/figure-repeat: sections.valuation.multiplesCommentary: "$19.28" is introduced twice in sections.valuation.multiplesCommentary — introduce a figure once and refer back in words (received "$19.28")
      lint/figure-repeat: sections.valuation.scenarioCommentary: "25%" is introduced twice in sections.valuation.scenarioCommentary — introduce a figure once and refer back in words (received "25%")
      warn: lint/figure-repeat-unit: sections.valuation.scenarioCommentary: "44.9x" is introduced twice in valuation (first in sections.valuation.multiplesCommentary) — consider referring back in words instead of restating it (received "44.9x")
      warn: lint/figure-repeat-unit: sections.businessMoat.moatFactors[2].body: "94%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "94%")
      warn: lint/figure-repeat-unit: sections.businessMoat.moatFactors[2].body: "84%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "84%")
      warn: lint/figure-repeat-unit: sections.businessMoat.moatFactors[2].body: "15%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "15%")
      warn: lint/figure-repeat-unit: sections.businessMoat.durability: "13%" is introduced twice in businessMoat (first in sections.businessMoat.segments[1].body) — consider referring back in words instead of restating it (received "13%")
      lint/figure-repeat: sections.management.insiderOwnership: "13" is introduced twice in sections.management.insiderOwnership — introduce a figure once and refer back in words (received "13")
      warn: lint/figure-repeat-unit: sections.risks.systemic: "50%" is introduced twice in risks (first in sections.risks.idiosyncratic[0]) — consider referring back in words instead of restating it (received "50%")
      warn: lint/figure-repeat-unit: sections.finalRecommendation.body[2]: "$34.8 billion" is introduced twice in finalRecommendation (first in sections.finalRecommendation.body[0]) — consider referring back in words instead of restating it (received "$34.8 billion")
      warn: lint/sentence-similar: sections.growth.points[3]: this sentence is close to sections.executiveSummary.catalysts[0] (executiveSummary → growth) at trigram similarity 0.67 — consider pointing back instead of restating (received "Q4 non-AI semiconductor revenue is guided to approximately $4.3 billion, up 5% sequentially.")
      lint/superlative: sections.financials.cashflowCommentary: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.leadership: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      lint/superlative: sections.management.capitalAllocation: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      warn: lint/judgment-superlative: sections.management.governance: "the only" reads as a superlative — check the source says so, or drop the article (received "the only")
      lint/superlative: sections.management.insiderOwnership: "largest" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "largest")
      warn: lint/judgment-superlative: sections.risks.systemic: "the first" reads as a superlative — check the source says so, or drop the article (received "the first")
      lint/superlative: sections.finalRecommendation.body[0]: "record" is an unearned superlative — check the series, attribute it to the source, or state the figure without it (received "record")
      warn: lint/pointer-length: sections.executiveSummary.catalysts[0]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[1]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[2]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[3]: this pointer runs to 3 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 3)
      warn: lint/pointer-length: sections.executiveSummary.catalysts[4]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[0]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[1]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[2]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[3]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)
      warn: lint/pointer-length: sections.executiveSummary.risks[4]: this pointer runs to 4 sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument (received 4)"
    `);
  });

  it("covers every corpus fixture", () => {
    expect(CORPUS_NAMES).toEqual(["orcl-10q-before", "orcl-10q-after", "orcl-gov-before", "avgo-gov-before", "avgo-final"]);
  });
});

describe("lintJudgment rating context", () => {
  it("emits the target-low warning only when a current price is supplied", () => {
    const j = cleanJudgment(); j.rating = { label: "BUY", targetLow: 300, targetHigh: 525 };
    expect(lintJudgment(j, desk).filter((i) => i.rule === "target-low")).toEqual([]);
    const withCtx = lintJudgment(j, desk, { currentPrice: 361.99 }).filter((i) => i.rule === "target-low");
    expect(withCtx).toHaveLength(1);
    expect(withCtx[0].severity).toBe("warning");
  });
});
