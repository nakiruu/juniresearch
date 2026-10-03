import { describe, it, expect } from "vitest";
import { BETA_MIN_WEEKS, betaQuery, blumeAdjust, measureBeta, parseBetaResponse, stampBeta, type BetaStats } from "./beta";

// ZBRA's row as Shibui returned it (2y weekly vs SPY ending 2026-09-24).
const ZBRA_ROW = {
  ticker: "ZBRA", end_date: "2026-09-24", n_weeks: 104, first_week: "2024-09-30", last_week: "2026-09-21",
  cov_im: 0.0006845243812906305, var_m: 0.0004353508547120851, var_i: 0.003564900336703068,
};
const stats = (over: Partial<BetaStats> = {}): BetaStats => ({ ...parseBetaResponse({ result: [ZBRA_ROW] })[0], ...over });

describe("betaQuery", () => {
  it("renders one universe row per (ticker, endDate); literal bounds span two years (+1 week) before the earliest end to the latest", () => {
    const q = betaQuery([{ ticker: "zbra", endDate: "2026-09-24" }, { ticker: "T", endDate: "2026-09-14" }]);
    expect(q).toContain("('ZBRA', DATE '2026-09-24'), ('T', DATE '2026-09-14')");
    expect(q).toContain("sq.date >= DATE '2024-09-05' AND sq.date <= DATE '2026-09-24'");
    expect(q).toContain("g.ticker = 'SPY'");
    expect(q).toMatch(/LIMIT 200$/);
  });
  it("refuses anything that is not a plain ticker or date (the SQL is built by interpolation)", () => {
    expect(() => betaQuery([{ ticker: "X'); DROP", endDate: "2026-09-24" }])).toThrow(/refusing/);
    expect(() => betaQuery([{ ticker: "ZBRA", endDate: "Sept 24" }])).toThrow(/bad endDate/);
    expect(() => betaQuery([])).toThrow();
  });
});

describe("parseBetaResponse", () => {
  it("accepts the tool's {result:[…]} body as an object or as saved text, and drops incomplete rows", () => {
    const body = { result: [ZBRA_ROW, { ...ZBRA_ROW, ticker: "BAD", cov_im: null }] };
    expect(parseBetaResponse(body)).toHaveLength(1);
    expect(parseBetaResponse(JSON.stringify(body))[0]).toMatchObject({ ticker: "ZBRA", endDate: "2026-09-24", nWeeks: 104 });
    expect(() => parseBetaResponse({ error: "timeout" })).toThrow(/no result rows/);
  });
});

describe("measureBeta", () => {
  it("computes ZBRA's OLS beta from the sufficient statistics, then Blume-adjusts it", () => {
    const b = measureBeta(stats())!;
    expect(b.raw).toBeCloseTo(0.0006845243812906305 / 0.0004353508547120851, 3); // 1.572
    expect(b.value).toBeCloseTo((2 / 3) * 1.5723 + 1 / 3, 2); // 1.382
    expect(b.r2).toBeGreaterThan(0.25);
    expect(b.r2).toBeLessThan(0.35);
    expect(b.standardError).toBeGreaterThan(0.2);
    expect(b.standardError).toBeLessThan(0.3);
    expect(b).toMatchObject({ observations: 104, benchmark: "SPY", source: "shibui", window: { start: "2024-09-30", end: "2026-09-24" } });
  });
  it("shrinks a near-zero raw beta toward the market and clamps the tails", () => {
    expect(blumeAdjust(0)).toBeCloseTo(1 / 3, 6);
    expect(measureBeta(stats({ covIM: -0.0001 }))!.value).toBe(0.3); // WM-like: raw < 0 → floor
    expect(measureBeta(stats({ covIM: 0.0016, varI: 0.02 }))!.value).toBe(2.5); // raw ~3.7 → cap
  });
  it("abstains on a short or degenerate sample, so the SIC proxy stands", () => {
    expect(measureBeta(stats({ nWeeks: BETA_MIN_WEEKS - 1 }))).toBeNull(); // a recent IPO (CBRS: 18 weeks)
    expect(measureBeta(stats({ varM: 0 }))).toBeNull();
  });
});

describe("stampBeta", () => {
  it("writes beta + one provenance line, replacing an earlier stamp, and removes both on null", () => {
    const pack: Parameters<typeof stampBeta>[0] = { quote: { asOf: "2026-09-24" }, provenance: [{ field: "quote", source: "yahoo", endpoint: "x", capturedAt: "t" }] };
    stampBeta(pack, measureBeta(stats()), "t1");
    stampBeta(pack, measureBeta(stats()), "t2");
    expect(pack.beta?.value).toBeCloseTo(1.382, 3);
    expect(pack.provenance!.filter((p) => p.field === "beta")).toEqual([expect.objectContaining({ source: "shibui", capturedAt: "t2" })]);
    stampBeta(pack, null, "t3");
    expect(pack.beta).toBeUndefined();
    expect(pack.provenance!.map((p) => p.field)).toEqual(["quote"]);
  });
});
