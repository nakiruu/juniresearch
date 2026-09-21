import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateGates, applyGateCeiling, type GateFacts } from "./gates";

/**
 * Known-answer fixtures come from a real, published FactPack (AMD) and from 5.md's
 * hand-worked example, so a wrong formula fails against numbers a human already checked.
 * Synthetic packs prove the *caps* actually fire — the whole point of the gate layer.
 */

const AMD: GateFacts = JSON.parse(
  readFileSync("data/facts/AMD/0000002488-26-000123.json", "utf8"),
);

// A minimal well-formed pack we can mutate per test.
function pack(over: {
  income?: Partial<Record<string, number[]>>;
  balance?: Partial<Record<string, number[]>>;
  cashflow?: Partial<Record<string, number[]>>;
  ttm?: Partial<GateFacts["ttm"]>;
} = {}): GateFacts {
  const row = (key: string, values: (number | null)[]) => ({ key, label: key, values });
  const base = {
    income: {
      revenue: [100, 110, 120, 130, 140],
      grossProfit: [40, 45, 50, 56, 63],
      operatingIncome: [10, 12, 14, 16, 18],
      ebitda: [15, 17, 19, 21, 23],
      netIncome: [8, 9, 10, 11, 12],
      epsDiluted: [0.8, 0.9, 1.0, 1.1, 1.2],
    },
    balance: {
      cashAndInvestments: [20, 22, 24, 26, 28],
      totalDebt: [30, 29, 28, 27, 26],
      netDebt: [10, 7, 4, 1, -2],
      totalEquity: [50, 55, 60, 66, 73],
      currentRatio: [1.5, 1.6, 1.7, 1.8, 1.9],
    },
    cashflow: {
      operatingCashFlow: [12, 13, 14, 15, 16],
      capex: [-2, -2, -3, -3, -4],
      buybacks: [-1, -1, -1, -1, -1],
      dividends: [0, 0, 0, 0, 0],
      freeCashFlow: [10, 11, 11, 12, 12],
    },
  };
  const merge = (b: Record<string, number[]>, o?: Partial<Record<string, number[]>>) =>
    Object.entries({ ...b, ...o }).map(([k, v]) => row(k, v));
  return {
    statements: {
      fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25"],
      income: merge(base.income, over.income),
      balance: merge(base.balance, over.balance),
      cashflow: merge(base.cashflow, over.cashflow),
    },
    ttm: {
      interestCoverage: 20,
      netDebtToEbitda: -0.1,
      currentRatio: 1.9,
      ...over.ttm,
    },
  };
}

describe("Piotroski F-Score", () => {
  it("scores AMD's latest fiscal transition at 8/9 (only the leverage signal misses)", () => {
    const g = evaluateGates(AMD);
    expect(g.piotroski.score).toBe(8);
    expect(g.piotroski.signals.deLevering).toBe(false); // AMD raised debt for the AI build-out
  });
});

describe("distress zone", () => {
  it("reads AMD as SAFE (44x coverage, net cash, positive FCF)", () => {
    expect(evaluateGates(AMD).distress.zone).toBe("SAFE");
  });

  it("flags DISTRESS when interest coverage is below 1x", () => {
    const g = evaluateGates(pack({ ttm: { interestCoverage: 0.5 } }));
    expect(g.distress.zone).toBe("DISTRESS");
  });

  it("flags DISTRESS when net debt / EBITDA exceeds 5x", () => {
    const g = evaluateGates(pack({ ttm: { netDebtToEbitda: 6 } }));
    expect(g.distress.zone).toBe("DISTRESS");
  });
});

describe("Sloan accruals", () => {
  it("reads AMD accruals as LOW / cash-backed (~ -5.3%)", () => {
    const g = evaluateGates(AMD);
    expect(g.accruals.flag).toBe("LOW");
    expect(g.accruals.ratio).toBeCloseTo(-0.053, 2);
  });

  it("flags HIGH accruals when net income far exceeds operating cash flow", () => {
    const g = evaluateGates(
      pack({ income: { netIncome: [8, 9, 10, 11, 40] }, cashflow: { operatingCashFlow: [12, 13, 14, 15, 16] } }),
    );
    expect(g.accruals.flag).toBe("HIGH");
  });
});

describe("gate ceiling", () => {
  it("does not cap a healthy name — AMD's ceiling stays STRONG BUY (no restriction)", () => {
    expect(evaluateGates(AMD).ceiling).toBe("STRONG BUY");
  });

  it("caps at SELL under distress", () => {
    const g = evaluateGates(pack({ ttm: { interestCoverage: 0.5 } }));
    expect(g.ceiling).toBe("SELL");
    expect(g.flags).toContain("distress");
  });

  it("caps at HOLD when the Piotroski score is very weak", () => {
    // Everything deteriorating year over year -> F <= 2.
    const weak = pack({
      income: {
        netIncome: [12, 11, 10, 9, -5],
        revenue: [140, 135, 130, 125, 120],
        grossProfit: [63, 58, 52, 46, 40],
      },
      cashflow: { operatingCashFlow: [16, 14, 12, 10, -8], freeCashFlow: [12, 10, 6, 2, -9] },
      balance: { totalDebt: [26, 27, 28, 29, 30], currentRatio: [1.9, 1.8, 1.7, 1.6, 1.5] },
    });
    const g = evaluateGates(weak);
    expect(g.piotroski.score).toBeLessThanOrEqual(2);
    expect(g.ceiling).toBe("HOLD");
    expect(g.flags).toContain("low-piotroski");
  });
});

describe("applyGateCeiling", () => {
  it("lowers a label to the ceiling but never raises it", () => {
    expect(applyGateCeiling("STRONG BUY", "HOLD")).toBe("HOLD");
    expect(applyGateCeiling("BUY", "SELL")).toBe("SELL");
    expect(applyGateCeiling("SELL", "HOLD")).toBe("SELL"); // already below the ceiling — unchanged
    expect(applyGateCeiling("BUY", "STRONG BUY")).toBe("BUY"); // no cap
  });
});
