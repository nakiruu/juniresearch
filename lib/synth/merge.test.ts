import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk } from "@/lib/synth/desk.schema";
import { Judgment } from "@/lib/synth/judgment.schema";
import type { HighlightKey } from "@/lib/facts/highlights";
import { mergeReport, toneFor, longDate, shortDate } from "@/lib/synth/merge";
import { evaluateGates, applyGateCeiling } from "@/lib/synth/gates";
import { computeConviction, deriveLabel } from "@/lib/synth/conviction";
import { Report, SCHEMA_VERSION } from "@/lib/report.schema";
import { validateReport } from "@/lib/validate";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const judgment = Judgment.parse(goldenJudgment);

describe("mergeReport persists the fundamental gate when one is supplied", () => {
  it("omits rating.gate when no gate is passed (backward compatible)", () => {
    expect(mergeReport(facts, judgment, desk, "2026-09-13").rating.gate).toBeUndefined();
  });
  it("persists the gate block with a gatedLabel derived from ceiling + derivedLabel", () => {
    const gate = evaluateGates(pack);
    const report = mergeReport(facts, judgment, desk, "2026-09-13", gate);
    const derived = deriveLabel(computeConviction(judgment.sections.valuation.scenarios, facts.quote.currentPrice), desk.rating);
    expect(report.rating.gate).toBeDefined();
    expect(report.rating.gate!.sector).toBe("industrial"); // AVGO is semiconductors
    expect(report.rating.gate!.gatedLabel).toBe(applyGateCeiling(derived, gate.ceiling));
    expect(() => Report.parse(report)).not.toThrow();
  });
  it("persists the composed decision block when supplied", () => {
    const decision = { conviction: 80, tier: "high" as const, proposed: "BUY" as const, reasons: ["E/R proposed BUY"], advisories: [], moat: { width: "WIDE" as const, trend: "STABLE" as const, contingent: false }, intrinsic: null, composite: { percentile: 62, confidence: "high" as const } };
    const report = mergeReport(facts, judgment, desk, "2026-09-13", evaluateGates(pack), decision);
    expect(report.rating.decision).toEqual(decision);
    expect(() => Report.parse(report)).not.toThrow();
  });
});

describe("mergeReport with the golden judgment and the AVGO facts", () => {
  const report = mergeReport(facts, judgment, desk, "2026-09-13");
  const c = computeConviction(judgment.sections.valuation.scenarios, facts.quote.currentPrice);
  it("produces a Report that parses and passes validateReport", () => {
    expect(() => Report.parse(report)).not.toThrow();
    expect(validateReport(report)).toEqual([]);
    expect(report.schemaVersion).toBe(SCHEMA_VERSION);
  });
  it("sets identity, dates and disclaimer from facts and desk, not from the judgment", () => {
    expect(report.meta).toMatchObject({ company: "Broadcom Inc.", ticker: "AVGO", exchange: "NASDAQ", analyst: desk.analyst, analystName: desk.analystName,
      reportDate: "September 13, 2026", asOf: "Sep 11, 2026", currency: "USD", subtitle: judgment.meta.subtitle, fiscalYearEnd: judgment.meta.fiscalYearEnd });
    expect(report.meta.filing).toEqual(facts.meta.filing);
    expect(report.disclaimer).toBe(desk.disclaimer);
  });
  it("derives tone and the thesis label from the rating", () => {
    expect(report.rating).toEqual({ label: "BUY", tone: "bull", targetLow: 440, targetHigh: 525,
      conviction: { ...c, derivedLabel: deriveLabel(c, desk.rating) } });
    expect(report.sections.executiveSummary.thesis.label).toBe("BUY");
  });
  it("passes facts through untouched: snapshot, quote with history, tables, analyst numbers", () => {
    expect(report.snapshot).toEqual(facts.snapshot);
    expect(report.quote).toEqual(facts.quote);
    expect(report.quote.history).toHaveLength(30);
    expect(report.sections.financials.income.rows).toEqual(facts.sections.financials.income.rows);
    expect(report.analystSentiment).toEqual({ ...facts.analystSentiment, commentary: judgment.analystCommentary });
  });
  it("sets code-owned table notes and a company-only multiples table", () => {
    expect(report.sections.financials.income.note).toBe("Source: Bigdata.com company tearsheet (FMP); fiscal years ended early November.");
    const m = report.sections.valuation.multiples;
    expect(m.columns).toEqual(["Multiple (TTM)", "AVGO"]);
    expect(m.rows.map((r) => r.label)).toEqual(["P/E", "P/S", "EV/EBITDA", "Fwd P/E (NTM)"]);
    expect(m.rows.every((r) => r.values.length === 1 && r.format === "mult")).toBe(true);
    expect(m.note).toBe("Peer multiples pending a peer data source.");
  });
  it("joins segment bodies to the fact segments by name, largest segment first, and copies the rest of the moat section", () => {
    const seg = report.sections.businessMoat.segments;
    expect(seg.map((s) => s.name)).toEqual(["Semiconductor Solutions", "Infrastructure Software"]); // the FactPack lists them the other way; merge orders by share
    const factSeg = facts.sections.businessMoat.segments.find((s) => s.name === "Semiconductor Solutions")!;
    expect(seg[0]).toMatchObject({ sharePct: factSeg.sharePct, revenue: factSeg.revenue, body: judgment.sections.businessMoat.segments[0].body });
    expect(report.sections.businessMoat.segmentsBasis).toBe("FY25 mix");
    expect(report.sections.businessMoat.moatRating).toBe("WIDE");
  });
  it("sets rating.conviction from the scenarios, the quote price and the desk thresholds", () => {
    expect(report.rating.conviction).toEqual({ ...c, derivedLabel: deriveLabel(c, desk.rating) });
    expect(report.rating.conviction?.expectedUpside).toBeCloseTo(0.34, 2);
    expect(report.rating.conviction?.bearDownside).toBeCloseTo(0.171, 3); // bear $300 vs $361.99
    expect(report.rating.conviction?.rewardRisk).toBeCloseTo(1.98, 2);
    expect(report.rating.conviction?.derivedLabel).toBe("STRONG BUY");
    expect(report.rating.label).toBe("BUY"); // the author's one-notch-conservative choice is preserved
  });
});

describe("mergeReport snapshot with chosen highlight cells", () => {
  it("leaves the sixteen fact cells in place when the judgment chooses none (the golden judgment)", () => {
    const report = mergeReport(facts, judgment, desk, "2026-09-13");
    expect(report.snapshot).toHaveLength(16);
    expect(report.snapshot).toEqual(facts.snapshot);
  });
  it("appends the chosen highlight cells after the sixteen, in the order chosen", () => {
    const highlights: HighlightKey[] = ["capexLatestFY", "netDebtToEbitda"];
    const withHighlights: Judgment = { ...judgment, highlights };
    const report = mergeReport(facts, withHighlights, desk, "2026-09-13");
    expect(report.snapshot).toHaveLength(facts.snapshot.length + 2);
    expect(report.snapshot.slice(0, facts.snapshot.length)).toEqual(facts.snapshot);
    expect(report.snapshot[facts.snapshot.length]).toEqual(facts.highlightCells.capexLatestFY);
    expect(report.snapshot[facts.snapshot.length + 1]).toEqual(facts.highlightCells.netDebtToEbitda);
  });
});

describe("helpers", () => {
  it("maps labels to tones", () => {
    expect(["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"].map((l) => toneFor(l as never))).toEqual(["bull", "bull", "secondary", "bear", "bear"]);
  });
  it("formats dates in UTC", () => {
    expect(longDate("2026-09-13")).toBe("September 13, 2026");
    expect(shortDate("2026-09-11")).toBe("Sep 11, 2026");
  });
});
