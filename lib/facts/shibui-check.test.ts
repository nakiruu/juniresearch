import { describe, it, expect } from "vitest";
import {
  CROSSCHECK_OK, CROSSCHECK_WARN, buildShibuiCheck, crossCheckLevel, crossCheckQuery, parseCrossCheckResponse,
  stampShibuiCheck, type CrossCheckable,
} from "./shibui-check";

// INTU's row as Shibui returned it (quote date 2026-10-01, quarter ending 2026-07-31).
const INTU_ROW = {
  ticker: "INTU", as_of: "2026-10-01", period_end: "2026-07-31", symbol: "INTU.NASDAQ",
  price_date: "2026-10-01", close: 282.78, mcap_date: "2026-10-01", market_cap: 77350792860,
  quarter_end: "2026-07-31", shares_outstanding: 273537000, ttm_start: "2025-10-31", n_quarters: 4,
  n_fcf: 4, fcf_ttm: 8617000000, n_sbc: 4, sbc_ttm: 2056000000, rev_quarter_end: "2026-07-31", revenue_quarter: 4354000000,
};
const INTU_PACK: CrossCheckable = {
  quote: { asOf: "2026-10-01", price: 282.78, marketCap: 75568996352, sharesOutstanding: 267236000.96 },
  latestQuarter: { periodEnd: "2026-07-31", revenue: 4354000000 },
  ttm: { fcfYield: 0.11463695984061757 },
};
const row = (over: Record<string, unknown> = {}) => parseCrossCheckResponse({ result: [{ ...INTU_ROW, ...over }] })[0];

describe("crossCheckQuery", () => {
  it("renders one universe row per distinct (ticker, asOf, periodEnd) with literal pre-filter bounds", () => {
    const q = crossCheckQuery([
      { ticker: "four", asOf: "2026-10-02", periodEnd: "2026-06-30" },
      { ticker: "INTU", asOf: "2026-10-01", periodEnd: "2026-07-31" },
      { ticker: "FOUR", asOf: "2026-10-02", periodEnd: "2026-06-30" }, // a duplicate collapses
    ]);
    expect(q).toContain("VALUES ('FOUR', DATE '2026-10-02', DATE '2026-06-30'), ('INTU', DATE '2026-10-01', DATE '2026-07-31'))");
    expect(q).toContain("sq.date >= DATE '2026-09-21' AND sq.date <= DATE '2026-10-02'"); // earliest asOf − 10d … latest asOf
    expect(q).toContain("f.date >= DATE '2025-05-26' AND f.date <= DATE '2026-08-10'"); // 400d before … latest end + 10d
    expect(q).toContain("FROM base b\nLEFT JOIN px"); // driven from the list: a ticker Shibui lacks still gets a row
    expect(q).toMatch(/LIMIT 200$/);
  });
  it("refuses anything that is not a plain ticker or date (the SQL is built by interpolation)", () => {
    expect(() => crossCheckQuery([{ ticker: "X'); DROP", asOf: "2026-09-24", periodEnd: "2026-06-30" }])).toThrow(/refusing/);
    expect(() => crossCheckQuery([{ ticker: "ZBRA", asOf: "Sept 24", periodEnd: "2026-06-30" }])).toThrow(/bad asOf/);
    expect(() => crossCheckQuery([{ ticker: "ZBRA", asOf: "2026-09-24", periodEnd: "6/30" }])).toThrow(/bad periodEnd/);
    expect(() => crossCheckQuery([])).toThrow();
  });
});

describe("parseCrossCheckResponse", () => {
  it("accepts the tool's {result:[…]} body as an object or saved text; nulls stay null", () => {
    const body = { result: [INTU_ROW, { ticker: "NVT", as_of: "2026-09-24", period_end: "2026-06-30", symbol: null, n_quarters: 0 }, { foo: 1 }] };
    const rows = parseCrossCheckResponse(JSON.stringify(body));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ticker: "INTU", quarterEnd: "2026-07-31", fcfTtm: 8617000000, nFcf: 4 });
    expect(rows[1]).toMatchObject({ ticker: "NVT", symbol: null, close: null, nQuarters: 0, fcfTtm: null });
    expect(() => parseCrossCheckResponse({ error: "timeout" })).toThrow(/no result rows/);
  });
});

describe("buildShibuiCheck", () => {
  it("passes a clean pack (INTU): every field present and ok", () => {
    const c = buildShibuiCheck(INTU_PACK, row());
    expect(c).toMatchObject({ asOf: "2026-10-01", quarterEnd: "2026-07-31", fcfTtm: 8617000000, sbcTtm: 2056000000, source: "shibui" });
    expect(c.diffs.map((d) => d.field)).toEqual(["price", "marketCap", "sharesOutstanding", "revenueQuarter", "fcfTtm"]);
    expect(c.diffs.every((d) => d.level === "ok")).toBe(true);
    expect(c.diffs.find((d) => d.field === "marketCap")!.relDiff).toBeCloseTo(Math.abs(75568996352 - 77350792860) / 77350792860, 4);
  });
  it("flags a FOUR-like pack: Class-A-only shares warn, double-counted FCF fails", () => {
    const pack: CrossCheckable = {
      quote: { asOf: "2026-10-02", price: 36.31, marketCap: 2867042048, sharesOutstanding: 78960122.5 },
      latestQuarter: { periodEnd: "2026-06-30", revenue: 1295000000 },
      ttm: { fcfYield: 0.1998575501882559 }, // × mcap ≈ $0.573B
    };
    const c = buildShibuiCheck(pack, row({
      ticker: "FOUR", as_of: "2026-10-02", period_end: "2026-06-30", close: 35.58, market_cap: 3152000000,
      quarter_end: "2026-06-30", ttm_start: "2025-09-30", shares_outstanding: 88600000,
      fcf_ttm: 311300000, sbc_ttm: 87800000, rev_quarter_end: "2026-06-30", revenue_quarter: 1295000000,
    }));
    const by = Object.fromEntries(c.diffs.map((d) => [d.field, d]));
    expect(by.sharesOutstanding.level).toBe("warn"); // 79.0M vs 88.6M → 10.9%
    expect(by.fcfTtm.level).toBe("fail"); // 0.573B vs 0.311B → 84%
    expect(by.fcfTtm.relDiff).toBeGreaterThan(0.8);
    expect(by.price.level).toBe("ok");
    expect(by.revenueQuarter.relDiff).toBe(0);
    expect(c.sbcTtm).toBe(87800000);
  });
  it("matches a 52/53-week quarter within ±10 days, but not a different quarter", () => {
    expect(buildShibuiCheck(INTU_PACK, row({ rev_quarter_end: "2026-08-02" })).revenueQuarter).toBe(4354000000);
    expect(buildShibuiCheck(INTU_PACK, row({ rev_quarter_end: null, revenue_quarter: null })).revenueQuarter).toBeNull();
  });
  it("nulls an incomplete TTM (fewer than 4 quarters, a missing value, or a gap) and skips the FCF diff for a stale TTM", () => {
    const short = buildShibuiCheck(INTU_PACK, row({ n_quarters: 2, n_fcf: 2, n_sbc: 2, ttm_start: "2026-04-30" }));
    expect(short.fcfTtm).toBeNull();
    expect(short.sbcTtm).toBeNull();
    expect(short.diffs.some((d) => d.field === "fcfTtm")).toBe(false);
    const noSbc = buildShibuiCheck(INTU_PACK, row({ n_sbc: 3 }));
    expect(noSbc.fcfTtm).toBe(8617000000);
    expect(noSbc.sbcTtm).toBeNull();
    expect(buildShibuiCheck(INTU_PACK, row({ ttm_start: "2025-04-30" })).fcfTtm).toBeNull(); // spans 15 months: a gap
    expect(buildShibuiCheck(INTU_PACK, row({ sbc_ttm: 0 })).sbcTtm).toBeNull(); // Shibui's 0 = untagged (CAT, XOM)
    const stale = buildShibuiCheck(INTU_PACK, row({ quarter_end: "2026-04-30", ttm_start: "2025-07-31" }));
    expect(stale.fcfTtm).toBe(8617000000); // kept (Shibui's latest TTM) …
    expect(stale.diffs.some((d) => d.field === "fcfTtm")).toBe(false); // … but not compared with a different window
  });
  it("skips a diff when either side is null or Shibui's is zero; a missing row gives all nulls", () => {
    const c = buildShibuiCheck({ ...INTU_PACK, ttm: { fcfYield: null } }, row({ close: 0 }));
    expect(c.diffs.map((d) => d.field)).toEqual(["marketCap", "sharesOutstanding", "revenueQuarter"]);
    const none = buildShibuiCheck(INTU_PACK, undefined);
    expect(none).toMatchObject({ quarterEnd: null, price: null, marketCap: null, fcfTtm: null, sbcTtm: null, diffs: [] });
  });
  it("levels at the exported thresholds", () => {
    expect(crossCheckLevel(CROSSCHECK_OK)).toBe("ok");
    expect(crossCheckLevel(CROSSCHECK_OK + 1e-6)).toBe("warn");
    expect(crossCheckLevel(CROSSCHECK_WARN)).toBe("warn");
    expect(crossCheckLevel(CROSSCHECK_WARN + 1e-6)).toBe("fail");
  });
});

describe("stampShibuiCheck", () => {
  it("writes the check + one provenance line, replacing an earlier stamp", () => {
    const pack: Parameters<typeof stampShibuiCheck>[0] = { provenance: [{ field: "quote", source: "yahoo", endpoint: "x", capturedAt: "t" }] };
    const check = buildShibuiCheck(INTU_PACK, row());
    stampShibuiCheck(pack, check, "t1");
    stampShibuiCheck(pack, check, "t2");
    expect(pack.shibuiCheck).toBe(check);
    expect(pack.provenance!.filter((p) => p.field === "shibuiCheck")).toEqual([
      expect.objectContaining({ source: "shibui", capturedAt: "t2" }),
    ]);
    expect(pack.provenance).toHaveLength(2);
  });
});
