import { describe, it, expect } from "vitest";
import {
  MIN_N, PRICE_MISMATCH_SEVERE, outcomeBatches, outcomeQuery, parseOutcomeResponse, predictionPoints, readRevision,
  scorePoints, spearman, toYmd, type PredictionPoint, type ReportRevision,
} from "./realized";

/** A minimal report revision: only the fields readRevision reads. */
const report = (o: { ticker?: string; asOf?: string; price?: number; label?: string; E?: number | null; kappa?: number } = {}) => ({
  meta: { ticker: o.ticker ?? "ZBRA", asOf: o.asOf ?? "Sep 24, 2026", reportDate: "September 25, 2026" },
  quote: { currentPrice: o.price ?? 100 },
  rating: {
    label: o.label ?? "BUY",
    ...(o.E === null ? {} : { conviction: { expectedUpside: o.E ?? 0.2, bearDownside: 0.3, rewardRisk: (o.E ?? 0.2) / 0.3, derivedLabel: "BUY" } }),
    decision: { conviction: o.kappa ?? 60 },
  },
  sections: { valuation: { scenarios: [
    { name: "Bull", impliedPrice: 150, probability: 0.25 },
    { name: "Base", impliedPrice: 120, probability: 0.5 },
    { name: "Bear", impliedPrice: 70, probability: 0.25 },
  ] } },
});

/** A Shibui result row as stock_data_query returns it. */
const row = (o: Record<string, unknown> = {}) => ({
  ticker: "ZBRA", as_of: "2026-09-24", symbol: "ZBRA.NASDAQ",
  entry_date: "2026-09-24", entry_close: 100, spy_entry_close: 500,
  d21_date: null, d21_close: null, spy_d21_close: null,
  d63_date: null, d63_close: null, spy_d63_close: null,
  d126_date: null, d126_close: null, spy_d126_close: null,
  d252_date: null, d252_close: null, spy_d252_close: null,
  latest_date: "2026-10-01", latest_close: 110, spy_latest_close: 505,
  vol_n: 252, vol_var: 0.0004,
  ...o,
});

const point = (o: Partial<PredictionPoint> = {}): PredictionPoint => ({
  ticker: "ZBRA", asOf: "2026-09-24", reportDate: "2026-09-25", label: "BUY", E: 0.2, D: 0.3, R: 0.667, kappa: 0.6,
  reportPrice: 100, scenarios: [], sha: null, shas: [null], source: "current", ...o,
});

describe("toYmd", () => {
  it("reads the report's display dates without a timezone shift", () => {
    expect(toYmd("Sep 11, 2026")).toBe("2026-09-11");
    expect(toYmd("September 1, 2026")).toBe("2026-09-01");
    expect(toYmd("2026-09-11")).toBe("2026-09-11");
    expect(toYmd("soon")).toBeNull();
  });
});

describe("readRevision / predictionPoints", () => {
  it("re-derives E/D/R from the scenarios when a revision predates rating.conviction", () => {
    const p = readRevision(report({ E: null }))!;
    expect(p.eRecomputed).toBe(true);
    expect(p.E).toBeCloseTo(0.25 * 1.5 + 0.5 * 1.2 + 0.25 * 0.7 - 1, 9); // fair value 115 vs 100
    expect(p.D).toBeCloseTo(0.3, 9);
    expect(readRevision({ meta: { ticker: "X" } })).toBeNull();
  });

  it("dedupes git revisions by (ticker, asOf): the newest revision's numbers win, every sha is kept", () => {
    const revs: ReportRevision[] = [
      { sha: "aaa", committedAt: "2026-09-25T10:00:00Z", report: report({ label: "HOLD", E: 0.1 }) },
      { sha: "bbb", committedAt: "2026-09-26T10:00:00Z", report: report({ label: "BUY", E: 0.2 }) }, // same asOf, re-rated
      { sha: null, committedAt: null, report: report({ asOf: "Oct 1, 2026", E: 0.15 }) }, // working tree, a new quote date
      { sha: "ccc", committedAt: "2026-09-20T10:00:00Z", report: { not: "a report" } },
    ];
    const { points, skipped } = predictionPoints(revs);
    expect(points.map((p) => [p.asOf, p.source])).toEqual([["2026-09-24", "git"], ["2026-10-01", "current"]]);
    expect(points[0]).toMatchObject({ sha: "bbb", shas: ["bbb", "aaa"], label: "BUY", E: 0.2 });
    expect(points[0].revisedLabels?.sort()).toEqual(["BUY", "HOLD"]);
    expect(skipped).toEqual([{ sha: "ccc", reason: expect.any(String) }]);
  });
});

describe("outcomeQuery", () => {
  it("renders one universe row per point, literal date bounds, SPY, LEADs for each horizon and LIMIT 200", () => {
    const q = outcomeQuery([{ ticker: "zbra", asOf: "2026-09-24" }, { ticker: "ZBRA", asOf: "2026-09-24" }, { ticker: "T", asOf: "2026-09-14" }], "2026-10-03");
    expect(q).toContain("VALUES ('ZBRA', DATE '2026-09-24'), ('T', DATE '2026-09-14')");
    expect(q).toMatch(/sq\.date >= DATE '2025-\d\d-\d\d' AND sq\.date <= DATE '2026-10-03'/);
    expect(q).toContain("g.ticker = 'SPY'");
    expect(q).toContain("LEAD(sq.close, 252) OVER w");
    expect(q).toMatch(/LIMIT 200$/);
  });
  it("refuses unsafe input and oversized batches; batches split the list", () => {
    expect(() => outcomeQuery([{ ticker: "X'); DROP", asOf: "2026-09-24" }], "2026-10-03")).toThrow(/refusing/);
    expect(() => outcomeQuery([{ ticker: "ZBRA", asOf: "Sept 24" }], "2026-10-03")).toThrow(/bad asOf/);
    const many = Array.from({ length: 201 }, (_, i) => ({ ticker: `T${i}`, asOf: "2026-09-24" }));
    expect(() => outcomeQuery(many, "2026-10-03")).toThrow(/200/);
    expect(outcomeBatches(many, 100).map((b) => b.length)).toEqual([100, 100, 1]);
  });
});

describe("parseOutcomeResponse", () => {
  it("accepts {result:[…]} as an object or saved text; null closes stay null", () => {
    const rows = parseOutcomeResponse(JSON.stringify({ result: [row(), { as_of: "x" }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: "ZBRA", entry: { date: "2026-09-24", close: 100, spyClose: 500 }, volN: 252 });
    expect(rows[0].horizons.d21).toBeNull();
    expect(() => parseOutcomeResponse({ error: "timeout" })).toThrow(/no result rows/);
  });
});

describe("scorePoints — per point", () => {
  it("a horizon not yet reached is null; reached horizons carry return, SPY return and excess", () => {
    const rows = parseOutcomeResponse({ result: [row({ d21_date: "2026-10-23", d21_close: 112, spy_d21_close: 510, latest_date: "2026-10-23", latest_close: 112, spy_latest_close: 510 })] });
    const { points } = scorePoints([point()], rows, "2026-10-24");
    const p = points[0];
    expect(p.horizons.d63).toBeNull();
    expect(p.horizons.d252).toBeNull();
    expect(p.horizons.d21).toMatchObject({ sessions: 21, ret: 0.12, spyRet: 0.02, excess: 0.1 });
    expect(p.horizons.latest).toMatchObject({ sessions: null, ret: 0.12, excess: 0.1, days: 29 });
    expect(p.realizedVol252).toBeCloseTo(Math.sqrt(0.0004 * 252), 4);
    expect(p.flags).toEqual([]);
  });

  it("flags a report price > 5% off Shibui's split-adjusted entry close; the return still uses Shibui on both ends", () => {
    // a 2-for-1 split after the report: the report says 200, Shibui's adjusted close is 100
    const { points, summary } = scorePoints([point({ reportPrice: 200 })], parseOutcomeResponse({ result: [row()] }), "2026-10-02");
    expect(points[0].flags).toContain("price-mismatch-severe");
    expect(points[0].entry?.priceGap).toBeCloseTo(1, 6);
    expect(points[0].horizons.latest?.ret).toBeCloseTo(0.1, 6); // 110 / 100, not 110 / 200
    expect(summary.excluded).toEqual([{ ticker: "ZBRA", asOf: "2026-09-24", reason: "price-mismatch-severe" }]);
    const mild = scorePoints([point({ reportPrice: 106 })], parseOutcomeResponse({ result: [row()] }), "2026-10-02");
    expect(mild.points[0].flags).toEqual(["price-mismatch"]); // flagged, kept (an intraday quote)
    expect(1.06 - 1).toBeLessThan(PRICE_MISMATCH_SEVERE);
  });

  it("marks a ticker Shibui lacks, a quote day Shibui has not loaded yet, and a short volatility window", () => {
    const rows = parseOutcomeResponse({ result: [
      row({ ticker: "NVT", symbol: null, entry_date: null, entry_close: null, latest_date: null, latest_close: null, vol_n: null, vol_var: null }),
      row({ ticker: "GE", as_of: "2026-10-02", entry_date: "2026-10-01", latest_date: "2026-10-01" }),
      row({ ticker: "CBRS", vol_n: 84 }),
    ] });
    const { points } = scorePoints(
      [point({ ticker: "NVT" }), point({ ticker: "GE", asOf: "2026-10-02" }), point({ ticker: "CBRS" })], rows, "2026-10-03");
    expect(points.find((p) => p.ticker === "NVT")!.flags).toEqual(["not-in-shibui"]);
    expect(points.find((p) => p.ticker === "GE")!.flags).toContain("entry-pending");
    expect(points.find((p) => p.ticker === "GE")!.horizons.latest).toBeNull(); // latest == entry day
    const cbrs = points.find((p) => p.ticker === "CBRS")!;
    expect(cbrs.realizedVol252).toBeNull();
    expect(cbrs.flags).toContain("short-vol-window");
  });
});

describe("scorePoints — aggregates", () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `N${String.fromCharCode(65 + i)}`);
  const build = (n: number) => {
    const tickers = names(n);
    const pts = tickers.map((t, i) => point({ ticker: t, E: 0.05 * (i + 1), label: i % 2 ? "HOLD" : "BUY" }));
    // realized = 1%·(i+1) and SPY +1% → excess = 1%·i, increasing with E
    const rows = parseOutcomeResponse({ result: tickers.map((t, i) => row({ ticker: t, latest_close: 100 * (1 + 0.01 * (i + 1)), spy_latest_close: 505 })) });
    return scorePoints(pts, rows, "2026-10-02").summary;
  };

  it("every cell is null with a reason below MIN_N distinct names, and carries n either way", () => {
    const s = build(MIN_N - 1);
    const c = s.groups.ALL.latest;
    expect(c.meanRet).toMatchObject({ n: MIN_N - 1, nNames: MIN_N - 1, value: null, reason: expect.stringMatching(/insufficient data/) });
    expect(c.spearmanEvsExcess.value).toBeNull();
    expect(c.hitRate.value).toBeNull();
    expect(s.groups.ALL.d252.meanRet).toMatchObject({ n: 0, value: null });
  });

  it("at MIN_N names: mean/median, SPY excess, hit rate, Spearman and the realized/E ratio", () => {
    const n = MIN_N;
    const c = build(n).groups.ALL.latest;
    expect(c.meanRet.value).toBeCloseTo((0.01 * (n + 1)) / 2, 4);
    expect(c.meanExcess.value).toBeCloseTo((0.01 * (n - 1)) / 2, 4);
    expect(c.medianExcess.value).toBeCloseTo((0.01 * (n - 1)) / 2, 4);
    expect(c.hitRate.value).toBeCloseTo((n - 1) / n, 4); // the first name's excess is exactly 0
    expect(c.spearmanEvsExcess.value).toBeCloseTo(1, 6); // monotone in E
    expect(c.calibrationRatio.value).toBeCloseTo((0.01 * (n + 1)) / 2 / ((0.05 * (n + 1)) / 2), 4); // = 0.2
    expect(c.calibrationRatioProRata.value).toBeNull(); // no session count for "latest"
  });

  it("gates on distinct names, not points: two quote dates of one ticker count once", () => {
    const pts = [...names(MIN_N - 1).map((t) => point({ ticker: t })), point({ ticker: "NA", asOf: "2026-09-25" })];
    const rows = parseOutcomeResponse({ result: pts.map((p) => row({ ticker: p.ticker, as_of: p.asOf, entry_date: p.asOf })) });
    const c = scorePoints(pts, rows, "2026-10-02").summary.groups.ALL.latest.meanRet;
    expect(c).toMatchObject({ n: MIN_N, nNames: MIN_N - 1, value: null });
  });
});

describe("spearman", () => {
  it("matches hand-computed values, averages ties, and is undefined for a constant series", () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(0.8207826817, 8); // ranks y: 1,2,3.5,5,3.5
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman([1, 2, 3, 4], [10, 30, 20, 40])).toBeCloseTo(0.8, 12); // 1 − 6·2/(4·15)
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNull();
    expect(spearman([1], [2])).toBeNull();
  });
});
