import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEarningsFile, earningsBatches, earningsQuery, parseEarningsResponse, readEarnings } from "./earnings";

const row = (o: Record<string, unknown>) => ({ ticker: "AIP", report_date: "2026-08-06", eps_actual: -0.24, eps_estimate: -0.16, eps_difference: -0.08, surprise_percent: -50, ...o });

describe("earningsQuery", () => {
  it("asks for the latest reported quarter on/before asOf, one row per ticker, deduped and upper-cased", () => {
    const q = earningsQuery(["xom", "AIP", "XOM"], "2026-10-03");
    expect(q).toContain("VALUES ('AIP'), ('XOM')");
    expect(q).toContain("DATE '2026-10-03' - INTERVAL 400 DAY AND DATE '2026-10-03'");
    expect(q).toContain("e.eps_actual IS NOT NULL");
    expect(q).toMatch(/LIMIT 200$/);
  });
  it("refuses unsafe tickers, a bad date, no tickers, or more than 200", () => {
    expect(() => earningsQuery(["X'; DROP"], "2026-10-03")).toThrow(/refusing/);
    expect(() => earningsQuery(["XOM"], "Oct 3")).toThrow(/bad asOf/);
    expect(() => earningsQuery([], "2026-10-03")).toThrow(/at least one/);
    expect(() => earningsQuery(Array.from({ length: 201 }, (_, i) => `T${i}`), "2026-10-03")).toThrow(/200/);
    expect(earningsBatches(Array.from({ length: 201 }, (_, i) => `T${i}`)).map((b) => b.length)).toEqual([200, 1]);
  });
});

describe("parseEarningsResponse / buildEarningsFile", () => {
  it("reads one response, an array of responses, or bare rows", () => {
    const one = { result: [row({})] };
    for (const body of [one, [one], [row({})], JSON.stringify(one)]) {
      expect(parseEarningsResponse(body).byTicker.AIP).toEqual({ reportDate: "2026-08-06", surprisePct: -50, epsActual: -0.24, epsEstimate: -0.16 });
    }
    expect(() => parseEarningsResponse({ nope: 1 })).toThrow(/not a Shibui/);
  });
  it("derives the surprise from the EPS pair when Shibui gives none, and drops rows it can't date or score", () => {
    const p = parseEarningsResponse({ result: [
      row({ ticker: "A", surprise_percent: null }),                            // (−0.24 − −0.16) / 0.16 = −50%
      row({ ticker: "B", report_date: null }),
      row({ ticker: "C", surprise_percent: null, eps_estimate: 0, eps_difference: null }),
    ] });
    expect(p.byTicker.A.surprisePct).toBeCloseTo(-50, 9);
    expect(Object.keys(p.byTicker)).toEqual(["A"]);
    expect(p.asked).toEqual(["A", "B", "C"]);
  });
  it("lists the tickers with no usable quarter as missing", () => {
    const f = buildEarningsFile([{ result: [row({}), row({ ticker: "NVT", report_date: null, surprise_percent: null })] }], "2026-10-03");
    expect(f).toMatchObject({ asOf: "2026-10-03", source: "shibui", missing: ["NVT"] });
    expect(Object.keys(f.byTicker)).toEqual(["AIP"]);
  });
});

describe("readEarnings (fail-open)", () => {
  const dir = mkdtempSync(join(tmpdir(), "earn-"));
  it("absent file → no earnings, no warning", () => {
    expect(readEarnings(join(dir, "none.json"))).toEqual({ byTicker: {}, asOf: null });
  });
  it("a valid file round-trips", () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, JSON.stringify(buildEarningsFile([{ result: [row({})] }], "2026-10-03")));
    expect(readEarnings(p)).toMatchObject({ asOf: "2026-10-03", byTicker: { AIP: { surprisePct: -50 } } });
  });
  it("a corrupt file → no earnings plus a warning (the gate is off, trading is not stopped)", () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, "{not json");
    const r = readEarnings(p);
    expect(r.byTicker).toEqual({});
    expect(r.warning).toMatch(/stale-entry gate off this run/);
  });
});

describe("the committed capture", () => {
  it("data/earnings/latest.json parses", () => {
    const r = readEarnings();
    expect(r.warning).toBeUndefined();
    expect(Object.keys(r.byTicker).length).toBeGreaterThan(0);
  });
});
