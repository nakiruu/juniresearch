import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateGates, applyGateCeiling, classifySector, sectorFromSic, gateAdvisory, type GateFacts } from "./gates";

/**
 * Known-answer fixtures come from real, published FactPacks so a wrong formula
 * fails against numbers a human already checked. The sector-aware cases are the
 * point of this iteration: industrial solvency ratios must NOT misfire on banks
 * (BAC), utilities (NEE), net-cash pre-profit names (UEC), or hypergrowth (NVDA),
 * while a genuinely leveraged cash-burner (CRWV) must still cap severely.
 */
const load = (t: string, acc: string): GateFacts & { ticker?: string } =>
  JSON.parse(readFileSync(`data/facts/${t}/${acc}.json`, "utf8"));

const AMD = load("AMD", "0000002488-26-000123");
const BAC = load("BAC", "0000070858-26-000394");
const NEE = load("NEE", "0000753308-26-000060");
const UEC = load("UEC", "0001437749-26-019889");
const CRWV = load("CRWV", "0001769628-26-000366");
const INTC = load("INTC", "0000050863-26-000157");
const NVDA = load("NVDA", "0001045810-26-000075");

/** A minimal, healthy, net-cash INDUSTRIAL pack (no ticker → industrial) we can mutate. */
function pack(over: {
  ticker?: string;
  sector?: string;
  income?: Partial<Record<string, number[]>>;
  balance?: Partial<Record<string, number[]>>;
  cashflow?: Partial<Record<string, number[]>>;
  ttm?: Partial<GateFacts["ttm"]>;
} = {}): GateFacts & { ticker?: string; sector?: string } {
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
    Object.entries({ ...b, ...o }).map(([k, v]) => row(k, v as number[]));
  return {
    ticker: over.ticker,
    sector: over.sector,
    statements: {
      fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25"],
      income: merge(base.income, over.income),
      balance: merge(base.balance, over.balance),
      cashflow: merge(base.cashflow, over.cashflow),
    },
    ttm: { interestCoverage: 20, netDebtToEbitda: -0.1, currentRatio: 1.9, ...over.ttm },
  };
}

describe("sectorFromSic", () => {
  it("maps SEC SIC ranges to the coarse gate sectors", () => {
    expect(sectorFromSic(6021)).toBe("financial"); // national commercial banks (BAC/JPM/WFC)
    expect(sectorFromSic(6022)).toBe("financial"); // state commercial banks (EWBC)
    expect(sectorFromSic(6311)).toBe("financial"); // life insurance
    expect(sectorFromSic(6211)).toBe("financial"); // security brokers / investment banks
    expect(sectorFromSic(4911)).toBe("utility"); // electric services (NEE)
    expect(sectorFromSic(3674)).toBe("industrial"); // semiconductors
    expect(sectorFromSic(6200)).toBe("industrial"); // exchanges (ICE/CME): capital-light, ratios apply
    expect(sectorFromSic(7389)).toBe("industrial"); // business services (V)
    expect(sectorFromSic(null)).toBeNull();
    expect(sectorFromSic(undefined)).toBeNull();
  });
});

describe("classifySector", () => {
  it("prefers a persisted SIC over the curated ticker map", () => {
    expect(classifySector({ ticker: "AMD", sic: 6021 })).toBe("financial"); // SIC wins
    expect(classifySector({ ticker: "BAC", sic: 3674 })).toBe("industrial"); // SIC wins
  });
  it("falls back to the ticker map when no SIC is present, then to industrial", () => {
    expect(classifySector({ ticker: "BAC" })).toBe("financial"); // curated fallback
    expect(classifySector({ ticker: "ZZZZ" })).toBe("industrial");
    expect(classifySector({ ticker: "ZZZZ", sector: "Financial Services" })).toBe("financial");
  });
  it("classes the real packs from their data (BAC financial, NEE utility, AMD industrial)", () => {
    expect(classifySector(BAC)).toBe("financial");
    expect(classifySector(NEE)).toBe("utility");
    expect(classifySector(AMD)).toBe("industrial");
  });
});

describe("Piotroski F-Score", () => {
  it("scores AMD's latest fiscal transition at 8/9 (only the leverage signal misses)", () => {
    const g = evaluateGates(AMD);
    expect(g.piotroski.score).toBe(8);
    expect(g.piotroski.signals.deLevering).toBe(false);
  });
});

describe("Sloan accruals", () => {
  it("reads AMD accruals as LOW / cash-backed (~ -5.3%)", () => {
    const g = evaluateGates(AMD);
    expect(g.accruals.flag).toBe("LOW");
    expect(g.accruals.ratio).toBeCloseTo(-0.053, 2);
  });
});

describe("sector-aware gating — no false positives", () => {
  it("does not cap a healthy industrial (AMD): ceiling stays STRONG BUY", () => {
    const g = evaluateGates(AMD);
    expect(g.distress.zone).toBe("SAFE");
    expect(g.ceiling).toBe("STRONG BUY");
  });

  it("never caps a bank on industrial ratios (BAC): distress N/A, no cap", () => {
    const g = evaluateGates(BAC);
    expect(g.sector).toBe("financial");
    expect(g.distress.zone).toBe("NA");
    expect(g.ceiling).toBe("STRONG BUY");
  });

  it("does not cap a utility for normal high leverage (NEE)", () => {
    const g = evaluateGates(NEE);
    expect(g.sector).toBe("utility");
    expect(g.distress.zone).not.toBe("DISTRESS");
    expect(g.ceiling).toBe("STRONG BUY");
  });

  it("does not read a net-cash pre-profit name as distressed (UEC)", () => {
    const g = evaluateGates(UEC);
    expect(g.ceiling).toBe("STRONG BUY"); // negative interest coverage, but net cash — nothing to cover
  });

  it("does not cap hypergrowth for a HIGH accruals reading alone (NVDA)", () => {
    const g = evaluateGates(NVDA);
    expect(g.accruals.flag).toBe("HIGH");
    expect(g.piotroski.score).toBeGreaterThan(3); // not weak, so accruals does not corroborate a cap
    expect(g.ceiling).toBe("STRONG BUY");
  });
});

describe("sector-aware gating — genuine distress still caps", () => {
  it("caps a leveraged cash-burner at SELL (CRWV: net debt $25.9B, negative FCF, <1yr cash)", () => {
    const g = evaluateGates(CRWV);
    expect(g.distress.zone).toBe("DISTRESS");
    expect(g.ceiling).toBe("SELL");
    expect(g.flags).toContain("distress");
  });

  it("gives a loss-making but liquid name a HOLD ceiling, not SELL (INTC: $37B cash, 7yr runway)", () => {
    const g = evaluateGates(INTC);
    expect(g.distress.zone).toBe("WEAK");
    expect(g.ceiling).toBe("HOLD");
  });
});

describe("severity tiers — synthetic", () => {
  it("DISTRESS (SELL) on a liquidity crunch: net debtor, current ratio < 1, negative FCF, under a year of cash", () => {
    const g = evaluateGates(
      pack({
        ttm: { interestCoverage: 0.5, currentRatio: 0.8, netDebtToEbitda: 6 },
        balance: { netDebt: [1, 2, 3, 4, 5], currentRatio: [1.2, 1.1, 1.0, 0.9, 0.8], cashAndInvestments: [8, 6, 5, 4, 3] },
        cashflow: { freeCashFlow: [2, 0, -3, -6, -10] },
      }),
    );
    expect(g.distress.zone).toBe("DISTRESS");
    expect(g.ceiling).toBe("SELL");
  });

  it("WEAK (HOLD) on an uncovered but liquid net debtor", () => {
    const g = evaluateGates(
      pack({
        ttm: { interestCoverage: 0.5, currentRatio: 2.0, netDebtToEbitda: 4 },
        balance: { netDebt: [1, 2, 3, 4, 5], currentRatio: [2, 2, 2, 2, 2], cashAndInvestments: [40, 40, 40, 40, 40] },
        cashflow: { freeCashFlow: [2, 1, 0, -1, -2] }, // burning, but 20yr of cash
      }),
    );
    expect(g.distress.zone).toBe("WEAK");
    expect(g.ceiling).toBe("HOLD");
  });

  it("caps at HOLD when an industrial Piotroski score is very weak", () => {
    const g = evaluateGates(
      pack({
        income: { netIncome: [12, 11, 10, 9, -5], revenue: [140, 135, 130, 125, 120], grossProfit: [63, 58, 52, 46, 40] },
        cashflow: { operatingCashFlow: [16, 14, 12, 10, -8], freeCashFlow: [12, 10, 6, 2, 1] },
        balance: { totalDebt: [26, 27, 28, 29, 30], currentRatio: [1.9, 1.8, 1.7, 1.6, 1.5], netDebt: [-8, -8, -8, -8, -8] },
      }),
    );
    expect(g.piotroski.score).toBeLessThanOrEqual(2);
    expect(g.ceiling).toBe("HOLD");
    expect(g.flags).toContain("low-piotroski");
  });

  it("caps at HOLD when HIGH accruals corroborate a middling Piotroski (F=3, below the F<=2 cap)", () => {
    // NI far exceeds OCF (HIGH accruals) while margins, turnover, current ratio and
    // share count all deteriorate -> F=3: Piotroski alone would not cap, accruals corroborates.
    const g = evaluateGates(
      pack({
        income: {
          netIncome: [8, 9, 10, 60, 40],
          revenue: [140, 135, 130, 125, 120],
          grossProfit: [63, 58, 52, 46, 40],
          epsDiluted: [0.8, 0.9, 1.0, 1.1, 0.5],
        },
        cashflow: { operatingCashFlow: [16, 14, 12, 10, 8], freeCashFlow: [12, 10, 6, 2, 1], buybacks: [-1, -1, -1, -1, 3] },
        balance: { totalDebt: [26, 27, 28, 29, 25], totalEquity: [50, 55, 60, 66, 73], currentRatio: [1.9, 1.8, 1.7, 1.6, 1.5], netDebt: [-8, -8, -8, -8, -8] },
      }),
    );
    expect(g.accruals.flag).toBe("HIGH");
    expect(g.piotroski.score).toBe(3);
    expect(g.ceiling).toBe("HOLD");
    expect(g.flags).toContain("earnings-quality");
    expect(g.flags).not.toContain("low-piotroski");
  });
});

describe("applyGateCeiling", () => {
  it("lowers a label to the ceiling but never raises it", () => {
    expect(applyGateCeiling("STRONG BUY", "HOLD")).toBe("HOLD");
    expect(applyGateCeiling("BUY", "SELL")).toBe("SELL");
    expect(applyGateCeiling("SELL", "HOLD")).toBe("SELL");
    expect(applyGateCeiling("BUY", "STRONG BUY")).toBe("BUY");
  });
});

describe("gateAdvisory", () => {
  it("returns null when the author's label is at or below the gate ceiling", () => {
    expect(gateAdvisory("BUY", evaluateGates(AMD))).toBeNull(); // AMD ceiling STRONG BUY
    expect(gateAdvisory("HOLD", evaluateGates(INTC))).toBeNull(); // INTC ceiling HOLD == label
  });
  it("returns a message when the author's label sits above the ceiling", () => {
    const msg = gateAdvisory("HOLD", evaluateGates(CRWV)); // CRWV ceiling SELL
    expect(msg).not.toBeNull();
    expect(msg).toContain("SELL");
    expect(msg).toContain("distress");
  });
});
