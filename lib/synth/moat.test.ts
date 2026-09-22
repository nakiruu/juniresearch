import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  roicSeries,
  sectorHurdle,
  betaFromSic,
  buildWacc,
  costOfEquity,
  comparableWindow,
  incrementalRoic,
  moatApplicable,
  moatBearFloor,
  moatRead,
  type MoatFacts,
} from "./moat";

/**
 * Known answers from docs/scoreconcepts/3.md §7 (AMD): ROIC 68% -> 2.1% -> 0.6% ->
 * 3.0% -> 5.5% on t_eff 15%; the FY21->FY22 Xilinx stock deal is a structural break
 * so the comparable window is FY22-FY25; incremental ROIC ~40%; the spread is
 * negative every comparable year but narrowing; verdict Narrow (contingent), Widening.
 */
const load = (t: string, acc: string): MoatFacts =>
  JSON.parse(readFileSync(`data/facts/${t}/${acc}.json`, "utf8"));

const AMD = load("AMD", "0000002488-26-000123");
const BAC = load("BAC", "0000070858-26-000394");
const LLY = load("LLY", "0000059478-26-000081");

describe("WACC build-up (replaces the sector-hurdle proxy)", () => {
  it("maps SIC to a sector beta", () => {
    expect(betaFromSic(3674)).toBeCloseTo(1.7, 5); // semiconductors
    expect(betaFromSic(2834)).toBeCloseTo(0.8, 5); // pharma
    expect(betaFromSic(4911)).toBeCloseTo(0.5, 5); // utility
    expect(betaFromSic(999999)).toBeGreaterThan(0); // default
  });
  it("builds AMD's ~11.9% WACC from rf/ERP/beta and the equity weight (matches 3.md §7.2)", () => {
    expect(buildWacc(AMD, { riskFree: 0.043, erp: 0.045, taxRate: 0.15 })).toBeCloseTo(0.119, 2);
  });
  it("gives a low-beta pharma a much lower cost of equity than a semi", () => {
    expect(costOfEquity(LLY, { riskFree: 0.043, erp: 0.045 })).toBeCloseTo(0.079, 3); // 4.3% + 0.8*4.5%
    expect(costOfEquity(AMD, { riskFree: 0.043, erp: 0.045 })).toBeGreaterThan(costOfEquity(LLY, { riskFree: 0.043, erp: 0.045 }));
  });
  it("moatRead uses the build-up by default and still reads AMD Narrow(contingent)/Widening", () => {
    const m = moatRead(AMD, { taxRate: 0.15 }); // no explicit wacc -> build-up
    expect(m.wacc).toBeCloseTo(0.119, 2);
    expect(m.width).toBe("NARROW");
    expect(m.trend).toBe("WIDENING");
  });
});

describe("roicSeries", () => {
  it("reproduces AMD's five-year ROIC on t_eff 15% (68% pre-Xilinx, 5.5% latest)", () => {
    const r = roicSeries(AMD, 0.15);
    expect(r[0]).toBeCloseTo(0.681, 2);
    expect(r[4]).toBeCloseTo(0.055, 2);
  });
});

describe("sectorHurdle", () => {
  it("returns a documented sector-default WACC by SIC", () => {
    expect(sectorHurdle(3674)).toBeCloseTo(0.12, 5); // semiconductors
    expect(sectorHurdle(4911)).toBeCloseTo(0.065, 5); // electric utility
    expect(sectorHurdle(999999)).toBeGreaterThan(0); // unknown → industrial default
  });
});

describe("comparableWindow / incrementalRoic", () => {
  it("flags the Xilinx stock-deal structural break — comparable window starts at FY22 (index 1)", () => {
    const ic = AMD.statements.balance; // computed inside; check the returned start index
    expect(comparableWindow(roicSeries(AMD, 0.15).map((_, i) => investedCapital(AMD, i)))).toBe(1);
    void ic;
  });
  it("computes ~40% incremental ROIC over the comparable window", () => {
    const inc = incrementalRoic(AMD, 0.15, 1);
    expect(inc).not.toBeNull();
    expect(inc!).toBeGreaterThan(0.3);
    expect(inc!).toBeLessThan(0.5);
  });
});

describe("moatRead — the whole engine on AMD", () => {
  const m = moatRead(AMD, { taxRate: 0.15, wacc: 0.119 });
  it("returns Narrow (contingent), Widening — improving economics, reported ROIC still below WACC", () => {
    expect(m.width).toBe("NARROW");
    expect(m.contingent).toBe(true);
    expect(m.trend).toBe("WIDENING");
  });
  it("reports the WACC used and a negative-every-comparable-year spread", () => {
    expect(m.wacc).toBeCloseTo(0.119, 3);
    expect(m.spread.slice(m.comparableFrom).every((s) => s < 0)).toBe(true);
  });
});

describe("goodwill-adjusted width (ex-goodwill ROIC for asset-heavy acquirers)", () => {
  // An acquirer: modest operating income on a big goodwill-laden capital base — as-reported
  // ROIC below WACC, but the operating business earns well ex-goodwill.
  const rows = (key: string, values: number[]) => ({ key, label: key, values });
  const acquirer = (goodwill: number[] | undefined): MoatFacts => ({
    ticker: "ACQ",
    sic: 6200,
    goodwill,
    quote: { marketCap: 20000 },
    ttm: { interestCoverage: 20 },
    statements: {
      fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25"],
      income: [
        rows("operatingIncome", [60, 65, 70, 75, 80]),
        rows("revenue", [1000, 1100, 1200, 1300, 1400]),
        rows("grossProfit", [600, 665, 735, 810, 890]),
        rows("ebitda", [90, 100, 110, 120, 130]),
      ],
      balance: [
        rows("totalEquity", [900, 950, 1000, 1050, 1100]),
        rows("totalDebt", [100, 100, 100, 100, 100]),
        rows("cashAndInvestments", [50, 50, 50, 50, 50]),
      ],
      cashflow: [rows("freeCashFlow", [50, 55, 60, 65, 70])],
    },
  });

  it("reads a big-goodwill acquirer as WIDE ex-goodwill, but not WIDE on the reported base", () => {
    const withGw = moatRead(acquirer([800, 800, 800, 800, 800]), { wacc: 0.1 });
    const withoutGw = moatRead(acquirer(undefined), { wacc: 0.1 });
    expect(withGw.width).toBe("WIDE");
    expect(withGw.flags.some((f) => /goodwill/i.test(f))).toBe(true);
    expect(withoutGw.width).not.toBe("WIDE");
  });
});

describe("insufficient comparable history (I1)", () => {
  const CRWV = load("CRWV", "0001769628-26-000366");
  const NVDA = load("NVDA", "0001045810-26-000075");
  it("withholds the width for a genuine young issuer (<4 fiscal years): CRWV -> NONE", () => {
    const m = moatRead(CRWV);
    expect(m.width).toBe("NONE");
    expect(m.contingent).toBe(false);
    expect(m.flags.some((f) => /young issuer|width withheld/i.test(f))).toBe(true);
  });
  it("keeps the width but withholds the trend for a mature name with a recent acquisition (NVDA)", () => {
    const m = moatRead(NVDA); // 5 FY of ~90%+ ROIC; the recent deal only shortened the post-break window
    expect(m.width).toBe("WIDE");
    expect(m.trend).toBe("STABLE");
    expect(m.flags.some((f) => /trend withheld/i.test(f))).toBe(true);
  });
});

describe("moatApplicable", () => {
  it("applies to an industrial (AMD) and abstains on a financial (BAC: ROIC/invested capital not meaningful)", () => {
    expect(moatApplicable(AMD).ok).toBe(true);
    expect(moatApplicable(BAC).ok).toBe(false);
  });
});

describe("moatBearFloor — the modulation lever", () => {
  it("a wide durable moat permits the shallowest bear; an eroding one forces the deepest", () => {
    expect(moatBearFloor("WIDE", "WIDENING")).toBeCloseTo(0.15, 5);
    expect(moatBearFloor("NARROW", "STABLE")).toBeCloseTo(0.2, 5);
    expect(moatBearFloor("NONE", "STABLE")).toBeCloseTo(0.3, 5);
    expect(moatBearFloor("WIDE", "ERODING")).toBeCloseTo(0.35, 5);
  });
});

// helper mirrored from the module for the window test above
function investedCapital(f: MoatFacts, i: number): number {
  const g = (k: string) => f.statements.balance.find((r) => r.key === k)?.values[i] ?? 0;
  return (g("totalDebt") as number) + (g("totalEquity") as number) - (g("cashAndInvestments") as number);
}
