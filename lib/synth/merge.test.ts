import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk } from "@/lib/synth/desk.schema";
import { Judgment } from "@/lib/synth/judgment.schema";
import type { HighlightKey } from "@/lib/synth/highlights";
import { mergeReport, toneFor, longDate, shortDate } from "@/lib/synth/merge";
import { Report, SCHEMA_VERSION } from "@/lib/report.schema";
import { validateReport } from "@/lib/validate";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const judgment = Judgment.parse(goldenJudgment);

describe("mergeReport with the golden judgment and the AVGO facts", () => {
  const report = mergeReport(facts, judgment, desk, "2026-09-13");
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
    expect(report.rating).toEqual({ label: "BUY", tone: "bull", targetLow: 440, targetHigh: 525 });
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
