import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Judgment } from "@/lib/synth/judgment.schema";
import { validateJudgment, ratingIssues, markdownIssues, segmentIssues, highlightIssues, renderJudgmentBlock } from "@/lib/synth/validate-judgment";
import type { HighlightKey } from "@/lib/facts/highlights";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";
import { Desk, DESK_RATING_DEFAULTS } from "@/lib/synth/desk.schema";
import { pct, rewardRiskText } from "@/lib/format";
import { computeConviction } from "@/lib/synth/conviction";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const golden = Judgment.parse(goldenJudgment);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const cfg = DESK_RATING_DEFAULTS;
const withRating = (label: Judgment["rating"]["label"], prices: [number, number, number]) => {
  const j = structuredClone(golden); j.rating.label = label;
  j.sections.valuation.scenarios = [{ name: "Bull", driver: "x", impliedPrice: prices[0], probability: 0.3 },
    { name: "Base", driver: "x", impliedPrice: prices[1], probability: 0.5 }, { name: "Bear", driver: "x", impliedPrice: prices[2], probability: 0.2 }];
  return j;
};

describe("rating label vs the derived label (price 100, probabilities 0.3/0.5/0.2, bears at least 15% below)", () => {
  // Shapes and their derived labels (E = weighted fair value / 100 − 1; D = (100 − bear) / 100; R = E / D):
  //   A [150,140,80]  E 0.31   D 0.20 R 1.55 → STRONG BUY
  //   B [130,115,80]  E 0.125  D 0.20 R 0.63 → BUY
  //   C [150,110,65]  E 0.13   D 0.35 R 0.37 → HOLD   (the AMD shape: upside bought with a deep bear)
  //   D [100,90,80]   E −0.09           → SELL
  //   E [85,70,50]    E −0.295          → STRONG SELL
  const A: [number, number, number] = [150, 140, 80], B: [number, number, number] = [130, 115, 80],
    C: [number, number, number] = [150, 110, 65], D: [number, number, number] = [100, 90, 80], E: [number, number, number] = [85, 70, 50];
  const table: [Judgment["rating"]["label"], [number, number, number], boolean][] = [
    ["STRONG BUY", A, true], ["BUY", A, true], ["HOLD", A, false],
    ["BUY", B, true], ["HOLD", B, true], ["STRONG BUY", B, false],
    ["HOLD", C, true], ["BUY", C, false], ["STRONG BUY", C, false],
    ["SELL", D, true], ["HOLD", D, true], ["BUY", D, false], ["STRONG SELL", D, false],
    ["STRONG SELL", E, true], ["SELL", E, true], ["HOLD", E, false],
  ];
  for (const [label, prices, ok] of table)
    it(`${label} at ${prices.join("/")} ${ok ? "passes" : "fails"}`, () => {
      const issues = ratingIssues(withRating(label, prices), 100, cfg).filter((i) => i.field === "rating.label");
      expect(issues.length === 0).toBe(ok);
      if (!ok) expect(issues[0].message).toMatch(/is inconsistent with the derived/);
    });
  it("names the derived label and the allowed set in the message", () => {
    const [issue] = ratingIssues(withRating("BUY", C), 100, cfg).filter((i) => i.field === "rating.label");
    expect(issue.message).toBe("BUY is inconsistent with the derived HOLD (expected upside +13.0%, reward/risk 0.37×); allowed: HOLD");
    const [up] = ratingIssues(withRating("HOLD", A), 100, cfg).filter((i) => i.field === "rating.label");
    expect(up.message).toMatch(/allowed: STRONG BUY or BUY$/);
  });
  it("requires bull ≥ base ≥ bear when the names say so", () => {
    const j = withRating("BUY", [140, 150, 80]);
    expect(ratingIssues(j, 100, cfg).map((i) => i.field)).toContain("sections.valuation.scenarios");
  });
});

describe("bear-depth floor (price 100, floor 15%)", () => {
  const bearIssues = (bear: number) =>
    ratingIssues(withRating("HOLD", [150, 140, bear]), 100, cfg).filter((i) => i.field === "sections.valuation.scenarios[bear].impliedPrice");
  it("passes a bear exactly at the floor and below it", () => {
    expect(bearIssues(85)).toEqual([]);
    expect(bearIssues(84)).toEqual([]);
  });
  it("fails a bear inside the floor, naming the shortfall and the floor", () => {
    const [issue] = bearIssues(86);
    expect(issue.message).toBe("bear case $86.00 is only 14.0% below the price; the desk floor is 15.0% — a bear scenario is a real scenario, not a formality");
    expect(issue.value).toBe(86);
  });
  it("fails a bear at or above the price", () => {
    expect(bearIssues(100)).toHaveLength(1);
    expect(bearIssues(110)).toHaveLength(1);
  });
  it("reads the floor from the config", () => {
    expect(ratingIssues(withRating("HOLD", [150, 140, 86]), 100, { ...cfg, bearFloor: 0.1 }).filter((i) => /bear case/.test(i.message))).toEqual([]);
  });
});

describe("scenario names", () => {
  const withNames = (names: [string, string, string]) => {
    const j = structuredClone(golden);
    j.sections.valuation.scenarios = j.sections.valuation.scenarios.map((s, i) => ({ ...s, name: names[i] }));
    return j;
  };
  it("flags scenario names that are not exactly Bull, Base and Bear", () => {
    const issues = ratingIssues(withNames(["Bull case", "Base case", "Bear case"]), 100, cfg);
    expect(issues.map((i) => i.field)).toContain("sections.valuation.scenarios[].name");
  });
  it("flags scenarios renamed away from Bull/Base/Bear entirely", () => {
    const issues = ratingIssues(withNames(["Upside", "Mid", "Downside"]), 100, cfg);
    expect(issues.map((i) => i.field)).toContain("sections.valuation.scenarios[].name");
  });
  it("accepts the golden's scenario names", () => {
    const issues = ratingIssues(golden, pack.quote.price, cfg);
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
  it("ends with expected upside, bear-case downside and reward/risk in the page's format", () => {
    const c = computeConviction(golden.sections.valuation.scenarios, pack.quote.price);
    const lines = renderJudgmentBlock(golden, pack.quote.price).split("\n").slice(-3);
    expect(lines).toEqual([
      `Expected upside ${pct(c.expectedUpside, { signed: true })}`,
      `Bear-case downside ${pct(-c.bearDownside, { signed: true })}`,
      `Reward/risk ${rewardRiskText(c.rewardRisk)}`,
    ]);
    expect(lines[0]).toBe("Expected upside +34.0%");
    expect(lines[1]).toBe("Bear-case downside -17.1%");
    expect(lines[2]).toBe("Reward/risk 1.98×");
  });
});

describe("validateJudgment on the golden judgment", () => {
  it("grounds the judgment's own target and fair value", () => {
    const issues = validateJudgment(golden, facts, pack, desk).map((i) => String(i.value));
    for (const own of ["$525", "$485", "+21.6%", "+45.0%"]) expect(issues, own).not.toContain(own);
  });
  it("passes everything except grounding, and reports exactly the hand-written figures the capture cannot support", () => {
    const issues = validateJudgment(golden, facts, pack, desk);
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
    const issues = validateJudgment(withDupes, facts, pack, desk);
    expect(issues.some((i) => i.field === "highlights")).toBe(true);
  });
  it("derives STRONG BUY for the golden (E +34.0%, D 17.1%, R 1.98; bear $300 clears the $307.69 floor) and accepts its one-notch-conservative BUY", () => {
    expect(validateJudgment(golden, facts, pack, desk).filter((i) => i.field === "rating.label")).toEqual([]);
  });
});
