import { describe, it, expect } from "vitest";
import type { Report } from "@/lib/report.schema";
import { rawQuality, qualityScores, DEFAULT_QUALITY_WEIGHTS } from "./quality";

// A minimal report carrying just the financial tables + moat that rawQuality reads.
// values align with FY21..FY25 (the columns after "Metric"); null is a "—" cell.
type Row = [string, (number | null)[]];
function rep(o: { ticker: string; moat?: string; trend?: string; income?: Row[]; balance?: Row[]; cashflow?: Row[] }): Report {
  const table = (rows: Row[]) => ({
    columns: ["Metric", "FY21", "FY22", "FY23", "FY24", "FY25"],
    rows: rows.map(([label, values]) => ({ label, values, format: "num" })),
  });
  return {
    meta: { ticker: o.ticker, company: `${o.ticker} Co`, reportDate: "September 1, 2026" },
    rating: { decision: { conviction: 60, moat: { width: o.moat ?? "NARROW", trend: o.trend ?? "STABLE" } } },
    sections: { financials: { income: table(o.income ?? []), balance: table(o.balance ?? []), cashflow: table(o.cashflow ?? []) } },
  } as unknown as Report;
}

// A fully-populated name: ROIC = 2.0*(1-0.21)/(3+10-1) = 0.13167; ROE = NI/Eq = .10..18 (mean .14, pop-std .02828) -> stability .11172;
// FCF conv = 1.62/1.8 = 0.9; balance = 1.5 - 2/10 = 1.3; moat WIDE = 1.0.
const full = rep({
  ticker: "AAA", moat: "WIDE",
  income: [["Operating Income ($B)", [1, 1, 1, 1, 2.0]], ["Net Income ($B)", [1.0, 1.2, 1.4, 1.6, 1.8]]],
  balance: [["Total Debt", [3, 3, 3, 3, 3]], ["Total Equity", [10, 10, 10, 10, 10]], ["Cash & ST Investments", [1, 1, 1, 1, 1]], ["Net Debt", [2, 2, 2, 2, 2]], ["Current Ratio", [1.5, 1.5, 1.5, 1.5, 1.5]]],
  cashflow: [["Free Cash Flow", [0.9, 0.9, 0.9, 0.9, 1.62]]],
});

describe("rawQuality", () => {
  const q = rawQuality(full);
  it("computes ROIC from the latest FY operating income and invested capital, after tax", () => {
    expect(q.roic).toBeCloseTo(0.13167, 4);
  });
  it("scores ROE stability as mean minus volatility of the ROE series", () => {
    expect(q.roeStability).toBeCloseTo(0.11172, 4);
  });
  it("computes FCF conversion as FCF over net income", () => {
    expect(q.fcfConversion).toBeCloseTo(0.9, 6);
  });
  it("scores balance-sheet strength as current ratio minus net-debt/equity", () => {
    expect(q.balanceStrength).toBeCloseTo(1.3, 6);
  });
  it("maps a WIDE stable moat to 1.0 and an eroding one lower", () => {
    expect(q.moat).toBeCloseTo(1.0, 6);
    expect(rawQuality(rep({ ticker: "E", moat: "WIDE", trend: "ERODING" })).moat).toBeCloseTo(0.75, 6);
    expect(rawQuality(rep({ ticker: "N", moat: "NONE" })).moat).toBeCloseTo(0.0, 6);
  });
  it("returns null for a metric whose inputs are missing or degenerate", () => {
    const bare = rawQuality(rep({ ticker: "B" }));
    expect(bare.roic).toBeNull();
    expect(bare.fcfConversion).toBeNull();
    expect(bare.roeStability).toBeNull();
    expect(bare.balanceStrength).toBeNull();
    // a loss-making name: net income <= 0 makes FCF conversion undefined; a negative operating
    // income yields a NEGATIVE ROIC (a real low score that ranks it at the bottom, not excluded).
    const loss = rawQuality(rep({ ticker: "L", income: [["Operating Income ($B)", [0, 0, 0, 0, -1]], ["Net Income ($B)", [-1, -1, -1, -1, -1]]], balance: [["Total Debt", [1, 1, 1, 1, 1]], ["Total Equity", [1, 1, 1, 1, 0.5]], ["Cash & ST Investments", [0, 0, 0, 0, 0]]], cashflow: [["Free Cash Flow", [-1, -1, -1, -1, -1]]] }));
    expect(loss.fcfConversion).toBeNull();     // net income negative → conversion undefined
    expect(loss.roic).toBeCloseTo(-0.52667, 4); // -1 · 0.79 / (1 + 0.5 - 0 = 1.5): a real negative, not null
  });
});

describe("qualityScores", () => {
  it("ranks each metric cross-sectionally and blends to 0-100, best name highest", () => {
    const strong = full; // top on every metric
    const mid = rep({ ticker: "BBB", moat: "NARROW", income: [["Operating Income ($B)", [1, 1, 1, 1, 1]], ["Net Income ($B)", [1, 1, 1, 0.9, 1.1]]], balance: [["Total Debt", [5, 5, 5, 5, 5]], ["Total Equity", [10, 10, 10, 10, 10]], ["Cash & ST Investments", [0.5, 0.5, 0.5, 0.5, 0.5]], ["Net Debt", [4.5, 4.5, 4.5, 4.5, 4.5]], ["Current Ratio", [1.1, 1.1, 1.1, 1.1, 1.1]]], cashflow: [["Free Cash Flow", [0.6, 0.6, 0.6, 0.6, 0.6]]] });
    const weak = rep({ ticker: "CCC", moat: "NONE", income: [["Operating Income ($B)", [0.2, 0.2, 0.2, 0.2, 0.2]], ["Net Income ($B)", [0.5, 0.1, 0.4, 0.05, 0.3]]], balance: [["Total Debt", [8, 8, 8, 8, 8]], ["Total Equity", [10, 10, 10, 10, 10]], ["Cash & ST Investments", [0.1, 0.1, 0.1, 0.1, 0.1]], ["Net Debt", [7.9, 7.9, 7.9, 7.9, 7.9]], ["Current Ratio", [0.7, 0.7, 0.7, 0.7, 0.7]]], cashflow: [["Free Cash Flow", [0.1, 0.1, 0.1, 0.1, 0.1]]] });
    const Q = qualityScores([strong, mid, weak]);
    expect(Q.get("AAA")!).toBeGreaterThan(Q.get("BBB")!);
    expect(Q.get("BBB")!).toBeGreaterThan(Q.get("CCC")!);
    expect(Q.get("AAA")!).toBeGreaterThan(80);   // best on all five
    expect(Q.get("CCC")!).toBeLessThan(20);
  });
  it("gives a neutral 50 to a name with no computable metric, and renormalizes weights over present metrics", () => {
    const Q = qualityScores([rep({ ticker: "X" }), rep({ ticker: "Y" })]);  // neither has financials or a real moat…
    // moat defaults to NARROW=0.5 for both, so it IS present and equal -> percentile 0.5 -> Q 50
    expect(Q.get("X")!).toBeCloseTo(50, 6);
  });
  it("uses the configured weights", () => {
    expect(DEFAULT_QUALITY_WEIGHTS).toEqual({ roic: 0.4, roeStability: 0.2, fcfConversion: 0.15, balanceStrength: 0.15, moat: 0.1 });
  });
});
