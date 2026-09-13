import { describe, it, expect } from "vitest";
import { projectReportFacts } from "@/lib/facts/project";
import { buildFactPack } from "@/lib/facts/build";
import { formatCell } from "@/lib/format";
import { Report } from "@/lib/report.schema";
import avgo from "@/lib/__fixtures__/avgo-golden.json";

const pack = buildFactPack("data/raw/AVGO/0001730168-26-000080");
const facts = projectReportFacts(pack);
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
  it("includes Capital Expenditure in the projection's cash-flow table", () => {
    const labels = facts.sections.financials.cashflow.rows.map((r) => r.label);
    expect(labels).toEqual(["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow", "FCF Margin"]);
  });
  it("formats the FY25 capex value correctly", () => {
    const capexRow = facts.sections.financials.cashflow.rows.find((r) => r.label === "Capital Expenditure")!;
    expect(formatCell(capexRow.values[4], capexRow.format)).toBe("-0.6");
  });
  it("projects the company's multiples column, with NTM forward P/E from next-FY EPS", () => {
    const col = facts.sections.valuation.multiplesCompanyColumn;
    expect(col.map((c) => c.label)).toEqual(["P/E", "P/S", "EV/EBITDA", "Fwd P/E (NTM)"]);
    const want = fixture.sections.valuation.multiples.rows;
    for (const row of col) {
      const w = want.find((r) => r.label === row.label)!.values[0];
      const target = typeof w === "number" ? w : Number(String(w).replace(/[^0-9.]/g, ""));
      expect(row.value, row.label).not.toBeNull();
      expect(Math.abs(row.value! / target - 1), row.label).toBeLessThan(0.02);
    }
  });
  it("carries the FactPack's daily closes as quote.history", () => {
    expect(facts.quote.history).toHaveLength(30);
    expect(facts.quote.history![29]).toMatchObject({ date: "2026-09-11" });
  });
});

describe("fiscalPeriod follows the filing, not the latest quarter", () => {
  it("uses the filing's own fiscal year for a 10-K", () => {
    const p = JSON.parse(JSON.stringify(pack));
    p.filing.form = "10-K";
    p.filing.periodEnd = "2025-11-02";
    expect(projectReportFacts(p).meta.filing.fiscalPeriod).toBe("fiscal 2025");
  });
  it("describes the filing's own period once a newer quarter has been reported", () => {
    const p = JSON.parse(JSON.stringify(pack));
    p.latestQuarter.periodEnd = "2026-11-01";
    expect(projectReportFacts(p).meta.filing.fiscalPeriod).toBe("quarter ended Aug 2, 2026");
  });
});
