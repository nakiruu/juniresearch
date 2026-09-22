import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { percentileRank, valueSleeve, compositeScore, type CompositeFacts } from "./composite";

const load = (t: string, acc: string): CompositeFacts => JSON.parse(readFileSync(`lib/synth/__fixtures__/packs/${t}/${acc}.json`, "utf8"));
const AMD = load("AMD", "0000002488-26-000123");
const BAC = load("BAC", "0000070858-26-000394");

describe("percentileRank", () => {
  it("ranks a value against a comparison set, higher-is-better", () => {
    expect(percentileRank(10, [1, 2, 3], true)).toBeCloseTo((3 + 0.5) / 4, 5); // best of 4
    expect(percentileRank(0, [1, 2, 3], true)).toBeCloseTo(0.5 / 4, 5); // worst of 4
  });
  it("is robust to an extreme peer outlier (rank, not magnitude)", () => {
    expect(percentileRank(5, [1, 2, 1e9], true)).toBeCloseTo((2 + 0.5) / 4, 5); // 1e9 outlier barely matters
  });
});

describe("valueSleeve — peer-relative valuation (the newly-enabled capability)", () => {
  it("ranks AMD cheap-to-expensive against its now-populated peers", () => {
    const s = valueSleeve(AMD);
    expect(s.rank).not.toBeNull();
    expect(s.rank!).toBeGreaterThanOrEqual(0);
    expect(s.rank!).toBeLessThanOrEqual(1);
    expect(s.validPeers).toBeGreaterThanOrEqual(3); // peers are populated now
  });
});

describe("compositeScore", () => {
  it("produces a 0-100 percentile with a confidence for an industrial (AMD)", () => {
    const c = compositeScore(AMD);
    expect(c.percentile).not.toBeNull();
    expect(c.percentile!).toBeGreaterThanOrEqual(0);
    expect(c.percentile!).toBeLessThanOrEqual(100);
    expect(["high", "medium", "low"]).toContain(c.confidence);
  });
  it("abstains on a financial (BAC): margins / EV-EBITDA not comparable", () => {
    const c = compositeScore(BAC);
    expect(c.percentile).toBeNull();
    expect(c.reason).toMatch(/financial/i);
  });
  it("ranks a cheap, high-margin, fast-growing synthetic near the top", () => {
    const cheap: CompositeFacts = {
      ticker: "CHEAP",
      sic: 3674,
      quote: { price: 50, week52Low: 30, week52High: 55, dividendYield: 0 },
      ttm: { pe: 8, ps: 1.5, evToEbitda: 6, grossMargin: 0.6, operatingMargin: 0.35, netMargin: 0.3, interestCoverage: 40, fcfYield: 0.09 },
      latestQuarter: { revenueYoY: 0.3 },
      estimates: { nextFY: { revenue: 1300, eps: 6 }, followingFY: { revenue: 1600, eps: 8 } },
      statements: {
        fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25"],
        income: [
          { key: "revenue", label: "Revenue", values: [600, 700, 820, 950, 1000] },
          { key: "grossProfit", label: "GP", values: [300, 360, 440, 540, 600] },
          { key: "operatingIncome", label: "OI", values: [120, 160, 220, 300, 350] },
          { key: "netIncome", label: "NI", values: [100, 140, 190, 260, 300] },
        ],
      },
      peers: [
        { ticker: "P1", pe: 40, ps: 10, evToEbitda: 30 },
        { ticker: "P2", pe: 35, ps: 8, evToEbitda: 25 },
        { ticker: "P3", pe: 50, ps: 12, evToEbitda: 35 },
      ],
    };
    expect(compositeScore(cheap).percentile!).toBeGreaterThan(70);
  });
});
