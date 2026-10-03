import { describe, it, expect } from "vitest";
import {
  LIKELY_HOLD_UPSIDE, calibrate, median, parseScreenResponse, pendingFilings, rankCandidates, screenQueries,
  screenQuery, streetUpside, type ScreenRow,
} from "./screen";

// Rows as Shibui returned them on 2026-10-03 (trimmed to the fields under test).
const AVGO = {
  ticker: "AVGO", symbol: "AVGO.NASDAQ", price_date: "2026-10-01", close: 343.64, street_target: 531.8468,
  forward_pe: 29.48, forward_peg: 0.445, market_cap: 1634894859240.72, fcf_yield: 0.0241, eq_flags: "", piotroski: 8, piotroski_quarter: "2026-08-02",
};
const GOOGL = { ...AVGO, ticker: "GOOGL", symbol: "GOOGL.NASDAQ", close: 338.24, street_target: 429.4556, eq_flags: "LOW_EARNINGS_QUALITY,LARGE_NON_OPERATING" };
const CRWD = { ...AVGO, ticker: "CRWD", symbol: "CRWD.NASDAQ", close: 266.09, street_target: 235.67 };
const NVT = {
  ticker: "NVT", symbol: null, price_date: null, close: null, street_target: null, forward_pe: null, forward_peg: null,
  market_cap: null, fcf_yield: null, eq_flags: null, piotroski: null, piotroski_quarter: null,
};

const row = (ticker: string, close: number | null, streetTarget: number | null, symbol: string | null = `${ticker}.NYSE`): ScreenRow => ({
  ticker, symbol, priceDate: "2026-10-01", close, streetTarget, forwardPe: null, forwardPeg: null, marketCap: null,
  fcfYield: null, earningsQualityFlags: [], piotroski: null, piotroskiQuarter: null,
});

describe("screenQuery", () => {
  it("drives FROM the ticker list (one row per ticker) with literal date pre-filters ending at asOf", () => {
    const q = screenQuery(["avgo", "T", "AVGO"], "2026-10-03");
    expect(q).toContain("WITH universe(ticker) AS (VALUES ('AVGO'), ('T'))");
    expect(q).toContain("sq.date >= DATE '2026-09-19' AND sq.date <= DATE '2026-10-03'");
    expect(q).toContain("v.date >= DATE '2026-09-19' AND v.date <= DATE '2026-10-03'");
    expect(q).toContain("ae.wall_street_target_price AS street_target");
    expect(q).toContain("FROM universe u\nLEFT JOIN sym s");
    expect(q).toMatch(/LIMIT 200$/);
  });
  it("refuses anything that is not a plain ticker or date, an empty list, or more than 200 tickers", () => {
    expect(() => screenQuery(["X'); DROP"], "2026-10-03")).toThrow(/refusing/);
    expect(() => screenQuery(["AVGO"], "Oct 3")).toThrow(/bad asOf/);
    expect(() => screenQuery([], "2026-10-03")).toThrow();
    const many = Array.from({ length: 201 }, (_, i) => `T${i}`);
    expect(() => screenQuery(many, "2026-10-03")).toThrow(/200/);
  });
  it("screenQueries splits a long list into ≤ 200-ticker batches", () => {
    const many = Array.from({ length: 450 }, (_, i) => `T${i}`);
    const qs = screenQueries(many, "2026-10-03");
    expect(qs).toHaveLength(3);
    expect(qs[2]).toContain("('T449')");
    expect(qs[0]).not.toContain("('T200')");
  });
});

describe("parseScreenResponse", () => {
  it("accepts {result:[…]}, saved text, and a list of batch responses; first row per ticker wins", () => {
    const one = parseScreenResponse(JSON.stringify({ result: [AVGO, NVT] }));
    expect(one).toHaveLength(2);
    expect(one[0]).toMatchObject({ ticker: "AVGO", close: 343.64, streetTarget: 531.8468, earningsQualityFlags: [], piotroski: 8 });
    expect(one[1]).toMatchObject({ ticker: "NVT", symbol: null, close: null, streetTarget: null, earningsQualityFlags: null });
    const many = parseScreenResponse([{ result: [AVGO] }, { result: [{ ...AVGO, close: 1 }, GOOGL] }]);
    expect(many.map((r) => r.ticker)).toEqual(["AVGO", "GOOGL"]);
    expect(many[0].close).toBe(343.64);
    expect(many[1].earningsQualityFlags).toEqual(["LOW_EARNINGS_QUALITY", "LARGE_NON_OPERATING"]);
    expect(parseScreenResponse([AVGO])).toHaveLength(1); // a bare row array
    expect(() => parseScreenResponse({ error: "timeout" })).toThrow(/no result rows/);
  });
  it("treats a non-positive target as missing", () => {
    expect(parseScreenResponse({ result: [{ ...AVGO, street_target: 0 }] })[0].streetTarget).toBeNull();
  });
});

describe("rankCandidates", () => {
  it("ranks by Street upside, flags < 10% as likely HOLD, and keeps no-target rows at the end", () => {
    const ranked = rankCandidates(parseScreenResponse({ result: [CRWD, NVT, GOOGL, AVGO] }));
    expect(ranked.map((r) => r.ticker)).toEqual(["AVGO", "GOOGL", "CRWD", "NVT"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(ranked[0].streetUpside).toBeCloseTo(531.8468 / 343.64 - 1, 9);
    expect(ranked[0]).toMatchObject({ likelyHold: false, reason: "Street upside +55%" });
    expect(ranked[2]).toMatchObject({ likelyHold: true });
    expect(ranked[2].reason).toMatch(/-11% < \+10% — likely HOLD/);
    expect(ranked[3]).toMatchObject({ streetUpside: null, priority: null, likelyHold: false, reason: "not in Shibui" });
  });
  it("labels the missing-data cases distinctly and orders them by ticker", () => {
    const ranked = rankCandidates([row("ZZ", 10, null), row("AA", null, 12), row("MM", 10, 10.5), row("BB", 10, 13)]);
    expect(ranked.map((r) => [r.ticker, r.reason])).toEqual([
      ["BB", "Street upside +30%"],
      ["MM", "Street upside +5% < +10% — likely HOLD"],
      ["AA", "no recent Shibui close"],
      ["ZZ", "no Street target"],
    ]);
  });
  it("the threshold is exported and overridable; exactly at the threshold is not flagged", () => {
    expect(LIKELY_HOLD_UPSIDE).toBe(0.1);
    expect(rankCandidates([row("X", 100, 110)])[0].likelyHold).toBe(false);
    expect(rankCandidates([row("X", 100, 109.99)])[0].likelyHold).toBe(true);
    expect(rankCandidates([row("X", 100, 114)], { holdThreshold: 0.15 })[0].likelyHold).toBe(true);
  });
  it("breaks equal upside by ticker so the order is deterministic", () => {
    expect(rankCandidates([row("B", 10, 12), row("A", 20, 24)]).map((r) => r.ticker)).toEqual(["A", "B"]);
  });
});

describe("streetUpside / median", () => {
  it("needs a positive target and close", () => {
    expect(streetUpside(12, 10)).toBeCloseTo(0.2, 12);
    expect(streetUpside(null, 10)).toBeNull();
    expect(streetUpside(12, 0)).toBeNull();
  });
  it("median of odd / even / empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("calibrate", () => {
  it("counts flagged HOLDs vs BUYs per threshold, ignoring samples without an upside", () => {
    const samples = [
      { ticker: "H1", label: "HOLD", upside: 0.03 },
      { ticker: "H2", label: "HOLD", upside: 0.12 },
      { ticker: "H3", label: "HOLD", upside: null },
      { ticker: "B1", label: "BUY", upside: 0.08 },
      { ticker: "B2", label: "STRONG BUY", upside: 0.4 },
      { ticker: "S1", label: "SELL", upside: -0.1 },
    ];
    const [t5, t10, t15] = calibrate(samples, [0.05, 0.1, 0.15]);
    expect(t5).toMatchObject({ threshold: 0.05, holds: 2, holdFlagged: 1, buys: 2, buyFlagged: 0, deferred: 2, buysDeferred: 0 });
    expect(t10).toMatchObject({ holdFlagged: 1, buyFlagged: 1, deferred: 3, buysDeferred: 1 });
    expect(t15).toMatchObject({ holdFlagged: 2, buyFlagged: 1, deferred: 4, buysDeferred: 1 });
  });
});

describe("pendingFilings", () => {
  const published = [
    { ticker: "ORCL", accession: "0001193125-26-389274", filedDate: "2026-09-11" },
    { ticker: "UEC", accession: "0001437749-26-031414", filedDate: "2026-09-29" },
  ];
  it("keeps captures newer than the published report, or with no report; newest per ticker", () => {
    const captured = [
      { ticker: "ORCL", accession: "0001193125-26-277521", filedDate: "2026-06-20" }, // older than the report — history
      { ticker: "ORCL", accession: "0001193125-26-389274", filedDate: "2026-09-11" }, // the published one
      { ticker: "UEC", accession: "NEW-1", filedDate: "2026-12-10" },
      { ticker: "ambq", accession: "A-1", filedDate: "2026-05-11" },
      { ticker: "AMBQ", accession: "A-2", filedDate: "2026-08-11" },
    ];
    expect(pendingFilings(captured, published)).toEqual([
      { ticker: "AMBQ", accession: "A-2", filedDate: "2026-08-11" },
      { ticker: "UEC", accession: "NEW-1", filedDate: "2026-12-10" },
    ]);
  });
});
