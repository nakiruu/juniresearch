import { describe, it, expect } from "vitest";
import { mapStatements } from "@/lib/facts/map/statements";
const DIR = "data/raw/AVGO/0001730168-26-000080";
const near = (a: number | null, b: number, tol = 0.005) => a != null && Math.abs(a - b) / Math.abs(b) <= tol;

describe("mapStatements on the AVGO capture", () => {
  const s = mapStatements(DIR);
  const row = (t: "income" | "balance" | "cashflow", key: string) => s.statements[t].find((r) => r.key === key)!;

  it("labels five consecutive fiscal years oldest first", () => {
    expect(s.statements.fiscalYears).toEqual(["FY21", "FY22", "FY23", "FY24", "FY25"]);
  });
  it("reads FY25 income rows matching the fixture", () => {
    expect(near(row("income", "revenue").values[4], 63.9e9)).toBe(true);
    expect(near(row("income", "operatingIncome").values[4], 25.5e9)).toBe(true);
    expect(near(row("income", "ebitda").values[4], 34.7e9)).toBe(true);
    expect(near(row("income", "netIncome").values[4], 23.1e9)).toBe(true);
    expect(near(row("income", "epsDiluted").values[4], 4.77, 0.003)).toBe(true);
  });
  it("reads FY25 balance rows matching the fixture", () => {
    expect(near(row("balance", "cashAndInvestments").values[4], 16.2e9)).toBe(true);
    expect(near(row("balance", "totalDebt").values[4], 65.1e9)).toBe(true);
    expect(near(row("balance", "netDebt").values[4], 49.0e9)).toBe(true);
    expect(near(row("balance", "totalEquity").values[4], 81.3e9)).toBe(true);
    expect(near(row("balance", "currentRatio").values[4], 1.71, 0.005)).toBe(true);
  });
  it("reads FY25 cash-flow rows matching the fixture", () => {
    expect(near(row("cashflow", "operatingCashFlow").values[4], 27.5e9)).toBe(true);
    expect(near(row("cashflow", "capex").values[4], -623000000, 0.005)).toBe(true);
    expect(near(row("cashflow", "freeCashFlow").values[4], 26.9e9)).toBe(true);
  });
  it("derives the latest quarter with YoY growth from the quarterly statements", () => {
    expect(s.latestQuarter.label).toBe("Q3'26");
    expect(s.latestQuarter.periodEnd).toBe("2026-08-02");
    expect(near(s.latestQuarter.revenue, 29.591e9, 0.001)).toBe(true);
    expect(near(s.latestQuarter.revenueYoY, 29.591 / 15.952 - 1, 0.01)).toBe(true);
    expect(near(s.latestQuarter.operatingMargin, 15.955 / 29.591, 0.01)).toBe(true);
  });
  it("reads TTM multiples and margins", () => {
    expect(near(s.ttm.pe, 44.9, 0.01)).toBe(true);
    expect(near(s.ttm.ps, 19.3, 0.01)).toBe(true);
    expect(near(s.ttm.evToEbitda, 33.6, 0.01)).toBe(true);
    expect(s.ttm.grossMargin).toBeGreaterThan(0.6);
    expect(s.ttm.grossMargin).toBeLessThan(0.7);
  });
});

describe("mapStatements on an empty capture", () => {
  it("throws naming the annual statements file", () => {
    expect(() => mapStatements("lib/facts/map/__fixtures__/empty")).toThrow(/bigdata-statements-annual\.json/);
  });
});

describe("mapStatements without a prior-year quarter", () => {
  it("reports revenueYoY as null rather than a fabricated zero", () => {
    const s = mapStatements("lib/facts/map/__fixtures__/no-prior-quarter");
    expect(s.latestQuarter.label).toBe("Q3'26");
    expect(s.latestQuarter.revenueYoY).toBeNull();
    expect(s.latestQuarter.operatingMargin).toBeCloseTo(0.25, 6);
  });
});
