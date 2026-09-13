import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Judgment } from "@/lib/synth/judgment.schema";
import { validateJudgment, ratingIssues, markdownIssues, segmentIssues, highlightIssues, renderJudgmentBlock } from "@/lib/synth/validate-judgment";
import type { HighlightKey } from "@/lib/facts/highlights";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const golden = Judgment.parse(goldenJudgment);
const withRating = (label: Judgment["rating"]["label"], prices: [number, number, number]) => {
  const j = structuredClone(golden); j.rating.label = label;
  j.sections.valuation.scenarios = [{ name: "Bull", driver: "x", impliedPrice: prices[0], probability: 0.3 },
    { name: "Base", driver: "x", impliedPrice: prices[1], probability: 0.5 }, { name: "Bear", driver: "x", impliedPrice: prices[2], probability: 0.2 }];
  return j;
};

describe("rating envelope (price 100)", () => {
  // weighted fair value = 0.3·bull + 0.5·base + 0.2·bear
  const table: [Judgment["rating"]["label"], [number, number, number], boolean][] = [
    ["BUY", [150, 140, 100], true],          // +34% — the golden's shape
    ["BUY", [120, 110, 100], true],          // +11%
    ["BUY", [105, 100, 80], false],          // -2.5%
    ["STRONG BUY", [140, 125, 110], true],   // +26.5%
    ["STRONG BUY", [120, 115, 100], false],  // +13.5%
    ["HOLD", [120, 110, 90], true],          // +9%
    ["HOLD", [160, 140, 120], false],        // +42%
    ["SELL", [100, 90, 80], true],           // -11%
    ["SELL", [120, 110, 100], false],        // +11%
    ["STRONG SELL", [95, 85, 70], false],    // -15%
    ["STRONG SELL", [85, 70, 50], true],     // -29.5%
  ];
  for (const [label, prices, ok] of table)
    it(`${label} at ${prices.join("/")} ${ok ? "passes" : "fails"}`, () => {
      const issues = ratingIssues(withRating(label, prices), 100).filter((i) => i.field === "rating.label");
      expect(issues.length === 0).toBe(ok);
      if (!ok) expect(issues[0].message).toMatch(/inconsistent with an upside of/);
    });
  it("requires bull ≥ base ≥ bear when the names say so", () => {
    const j = withRating("BUY", [140, 150, 100]);
    expect(ratingIssues(j, 100).map((i) => i.field)).toContain("sections.valuation.scenarios");
  });
});

describe("scenario names", () => {
  const withNames = (names: [string, string, string]) => {
    const j = structuredClone(golden);
    j.sections.valuation.scenarios = j.sections.valuation.scenarios.map((s, i) => ({ ...s, name: names[i] }));
    return j;
  };
  it("flags scenario names that are not exactly Bull, Base and Bear", () => {
    const issues = ratingIssues(withNames(["Bull case", "Base case", "Bear case"]), 100);
    expect(issues.map((i) => i.field)).toContain("sections.valuation.scenarios[].name");
  });
  it("flags scenarios renamed away from Bull/Base/Bear entirely", () => {
    const issues = ratingIssues(withNames(["Upside", "Mid", "Downside"]), 100);
    expect(issues.map((i) => i.field)).toContain("sections.valuation.scenarios[].name");
  });
  it("accepts the golden's scenario names", () => {
    const issues = ratingIssues(golden, pack.quote.price);
    expect(issues.map((i) => i.field)).not.toContain("sections.valuation.scenarios[].name");
  });
});

describe("markdown lint", () => {
  const withThesis = (body: string) => { const j = structuredClone(golden); j.sections.executiveSummary.thesis.body = body; return j; };
  it("accepts the contract's subset", () => {
    expect(markdownIssues(withThesis("### Heading\n\nA **bold** claim with {+ +21% +} growth.\n\n- one\n- two"))).toEqual([]);
  });
  it("accepts a level-4 heading", () => {
    expect(markdownIssues(withThesis("#### Sub-heading\n\nbody"))).toEqual([]);
  });
  it("accepts a leading '#' immediately followed by a digit", () => {
    expect(markdownIssues(withThesis("#1 in custom silicon by design-win count"))).toEqual([]);
  });
  it("accepts a leading '#' with no whitespace after it (not a heading)", () => {
    expect(markdownIssues(withThesis("#hashtag-style text at block start"))).toEqual([]);
  });
  it.each([
    ["HTML", "A <b>bold</b> claim", /HTML/],
    ["nested markers", "**{+ up +}**", /nests/],
    ["a table", "| a | b |\n| - | - |", /table/],
    ["a link", "see [the filing](https://sec.gov)", /link/],
    ["a heading mid-block", "First line\n### Not at block start", /not at the start of a block/],
    ["a level-2 heading", "## Not allowed", /heading level/],
    ["a level-1 heading", "# Title\n\nbody", /heading level/],
  ])("rejects %s", (_name, body, msg) => {
    const issues = markdownIssues(withThesis(body));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe("sections.executiveSummary.thesis.body");
    expect(issues[0].message).toMatch(msg);
  });
});

describe("segments", () => {
  it("reports a missing and an extra segment body", () => {
    const j = structuredClone(golden); j.sections.businessMoat.segments = [{ name: "Semiconductor Solutions", body: "x" }, { name: "Mainframes", body: "y" }];
    expect(segmentIssues(j, facts).map((i) => i.message).join(" ")).toMatch(/Infrastructure Software.*Mainframes|Mainframes.*Infrastructure Software/);
  });
  it("rejects duplicate moat factor names", () => {
    const j = structuredClone(golden); j.sections.businessMoat.moatFactors[1].name = j.sections.businessMoat.moatFactors[0].name;
    expect(segmentIssues(j, facts).some((i) => i.field === "sections.businessMoat.moatFactors")).toBe(true);
  });
});

describe("highlightIssues", () => {
  const withHighlights = (highlights: HighlightKey[]): Judgment => ({ ...golden, highlights });
  it("passes when the judgment picks no highlights, or unique, available ones", () => {
    expect(highlightIssues(golden, facts)).toEqual([]);
    expect(highlightIssues(withHighlights(["capexLatestFY", "netDebtToEbitda"]), facts)).toEqual([]);
  });
  it("flags a repeated highlight key", () => {
    const issues = highlightIssues(withHighlights(["capexLatestFY", "capexLatestFY"]), facts);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "highlights" });
    expect(issues[0].message).toMatch(/unique/);
  });
  it("flags a highlight key whose cell this FactPack does not have", () => {
    const stripped = structuredClone(facts);
    delete (stripped.highlightCells as Record<string, unknown>).grossMarginLatestFY;
    const issues = highlightIssues(withHighlights(["grossMarginLatestFY"]), stripped);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "highlights", value: ["grossMarginLatestFY"] });
    expect(issues[0].message).toMatch(/not available/);
  });
});

describe("renderJudgmentBlock", () => {
  it("renders the calls and the page's derived values so the prose may quote them", () => {
    const block = renderJudgmentBlock(golden, pack.quote.price);
    expect(block).toContain("Target range $440.00–$525.00 (+21.6% to +45.0%)");
    expect(block).toContain("Probability-weighted fair value $485.00 (+34.0%)");
    expect(block).toMatch(/Base: \$490\.00 × 50% = \$245\.00/);
  });
});

describe("validateJudgment on the golden judgment", () => {
  it("grounds the judgment's own target and fair value", () => {
    const issues = validateJudgment(golden, facts, pack).map((i) => String(i.value));
    for (const own of ["$525", "$485", "+21.6%", "+45.0%"]) expect(issues, own).not.toContain(own);
  });
  it("passes everything except grounding, and reports exactly the hand-written figures the capture cannot support", () => {
    const issues = validateJudgment(golden, facts, pack);
    expect(issues.filter((i) => !/not in the facts/.test(i.message))).toEqual([]);
    const misses = issues.map((i) => `${i.field}: ${i.value}`).sort();
    // Calibration record: re-calibrated 2026-09-13 after the transcript cap rose to 16,000. The AVGO
    // transcript excerpt now reaches the passage "...revenue, which grew 221% year-on-year..." and its
    // surrounding paragraph ("...up over 3.5x year-on-year and represented 73% of AI revenue... AI
    // networking revenue was up over 2.5x year-on-year"), which grounds +221%/221%, 2.5x, 3.5x and 73%
    // (all four occurrences, across catalysts, thesis, risks, and finalRecommendation). Each figure
    // remaining below was confirmed genuinely absent from data/facts/AVGO/0001730168-26-000080.json
    // (its numeric fields and its context excerpts).
    expect(misses).toEqual([
      "sections.financials.balanceCommentary: $1.4B",
      "sections.financials.cashflowCommentary: $1.4B",
    ]);
  });
  it("also runs the highlight checks", () => {
    const withDupes: Judgment = { ...golden, highlights: ["capexLatestFY", "capexLatestFY"] };
    const issues = validateJudgment(withDupes, facts, pack);
    expect(issues.some((i) => i.field === "highlights")).toBe(true);
  });
});
