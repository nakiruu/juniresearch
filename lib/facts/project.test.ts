import { describe, it, expect } from "vitest";
import { projectReportFacts } from "@/lib/facts/project";
import { buildFactPack } from "@/lib/facts/build";
import { formatCell } from "@/lib/format";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const facts = projectReportFacts(buildFactPack("data/raw/AVGO/0001730168-26-000080"));
const fixture = Report.parse(avgo);

/** Same vendor as the fixture, so every row is asserted — including EBITDA. */
const LABELS: Record<"income" | "balance" | "cashflow", string[]> = {
  income: ["Revenue ($B)", "YoY Growth", "Gross Margin", "Operating Income ($B)", "EBITDA ($B)", "Net Income ($B)", "Diluted EPS ($)*"],
  balance: ["Cash & ST Investments", "Total Debt", "Net Debt", "Total Equity", "Current Ratio"],
  cashflow: ["Operating Cash Flow", "Free Cash Flow", "FCF Margin"],
};

describe("projectReportFacts parity with data/avgo.json", () => {
  for (const table of ["income", "balance", "cashflow"] as const) {
    it(`matches the ${table} table row for row, formatted`, () => {
      const got = facts.sections.financials[table], want = fixture.sections.financials[table];
      expect(got.columns).toEqual(want.columns);
      for (const label of LABELS[table]) {
        const g = got.rows.find((r) => r.label === label)!, w = want.rows.find((r) => r.label === label)!;
        expect(g, label).toBeDefined();
        expect(g.values.map((v) => formatCell(v, g.format)), label).toEqual(w.values.map((v) => formatCell(v, w.format)));
      }
    });
  }
  it("projects the filing metadata exactly", () => { expect(facts.meta.filing).toEqual(fixture.meta.filing); });
  it("projects the sixteen generic snapshot cells in order", () => {
    expect(facts.snapshot.map((c) => c.label)).toEqual([
      "Current Price", "Market Cap", "52-Week Range", "Shares Outstanding", "P/E (TTM)", "Consensus Target",
      "EV/EBITDA (TTM)", "Analyst Consensus", "FY25 Revenue", "FY25 Net Income", "FY25 Diluted EPS",
      "FY26E Revenue", "Q3'26 Revenue", "Q3'26 Operating Margin", "Fwd P/E (FY27E)", "Dividend Yield",
    ]);
  });
  it("projects the analyst numbers the fixture carries", () => {
    expect(facts.analystSentiment).toMatchObject({ numAnalysts: 60, buy: 54, hold: 6, sell: 0, consensusTarget: 509.61, medianTarget: 517.5, highTarget: 600, lowTarget: 350 });
  });
  it("projects segments and geography as ratios", () => {
    expect(facts.sections.businessMoat.segments.map((s) => s.sharePct).reduce((a, b) => a + b)).toBeCloseTo(1, 6);
    expect(facts.sections.businessMoat.geoMix.every((g) => g.sharePct > 0 && g.sharePct < 1)).toBe(true);
  });
});
