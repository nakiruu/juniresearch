import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCompanyFacts } from "./sec";
import { parseQuoteSummary } from "./yahoo";
import { computeTtm } from "./ttm";
import { buildTearsheetFiles, writeTearsheetFiles, yahooFromTearsheet, keepQuoteTearsheet } from "./emit";
import { mapStatements } from "../map/statements";
import { mapQuote } from "../map/quote";
import { mapAnalysts } from "../map/analysts";
import { mapSegments } from "../map/segments";

const facts = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", "utf8"));
const yraw = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-quotesummary.json", "utf8"));

describe("buildTearsheetFiles → real mappers (shape parity)", () => {
  const sec = parseCompanyFacts(facts);
  const yahoo = parseQuoteSummary(yraw, { latestFY: sec.annual.at(-1)!.fiscal_year });
  const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield });
  const files = buildTearsheetFiles({ cik: 59478, sec, yahoo, ttm, capturedAt: "2026-09-16T12:00:00Z" });

  it("writes the three files and mapStatements reads them without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lly-free-"));
    // fmp-peers.json is needed by mapAnalysts; write a minimal one
    writeFileSync(join(dir, "fmp-peers.json"), JSON.stringify([{ symbol: "MRK" }, { symbol: "PFE" }]));
    writeTearsheetFiles(dir, files);
    const s = mapStatements(dir);
    expect(s.statements.fiscalYears.length).toBeGreaterThanOrEqual(3);
    expect(s.latestQuarter.revenue).toBeGreaterThan(0);
    expect(s.ttm.grossMargin === null || s.ttm.grossMargin! > 0).toBe(true);
    // revenue_segmentation is emitted as empty {product:{},geographic:{}} (Task 3 has no vendor
    // segment data), relying on mapSegments' single-"Consolidated" fallback; guard that shape parity.
    expect(() => mapSegments(dir)).not.toThrow();
  });

  it("mapQuote and mapAnalysts read the tearsheet without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lly-free-"));
    writeFileSync(join(dir, "fmp-peers.json"), JSON.stringify([{ symbol: "MRK" }]));
    writeTearsheetFiles(dir, files);
    const q = mapQuote(dir);
    expect(q.quote.price).toBeGreaterThan(0);
    expect(q.quote.week52High).toBeGreaterThan(q.quote.week52Low);
    const a = mapAnalysts(dir, sec.annual.at(-1)!.fiscal_year);
    expect(a.analysts.consensusTarget).toBeGreaterThan(0);
    expect(a.estimates.nextFY.label).toMatch(/^FY\d\dE$/);
  });

  it("yahooFromTearsheet round-trips the Yahoo blocks of the emitted tearsheet (facts:free --keep-quote)", () => {
    const ts = files.tearsheetAnnual as { company_overview: { cik: number; timestamp: string } };
    const back = yahooFromTearsheet(files.tearsheetAnnual);
    expect(back.capturedAt).toBe(ts.company_overview.timestamp);
    expect(back.yahoo.price).toBe(yahoo.price);
    expect(back.yahoo.marketCap).toBe(yahoo.marketCap);
    expect(back.yahoo.targets).toEqual(yahoo.targets);
    expect(back.yahoo.ratings).toEqual(yahoo.ratings);
    expect(back.yahoo.dividendYield).toBe(yahoo.dividendYield);
    // Yahoo's own trailing P/E, not the old run's key_metrics pe_ratio (which is price / ΣEPS when the EPS summed):
    // a re-run whose TTM EPS now nulls (the D-7 span check) must fall back to Yahoo's figure, not the old SEC one.
    expect(yahoo.trailingPe).not.toBeNull();
    expect(back.yahoo.trailingPe).toBe(yahoo.trailingPe);
    // parseQuoteSummary keeps estimate years whose sales and eps are both null; estimateRecords drops them, so the
    // round-trip is exact only after the same filter.
    expect(back.yahoo.estimates).toEqual(yahoo.estimates.filter((e) => e.sales != null || e.eps != null));
    const again = buildTearsheetFiles({ cik: ts.company_overview.cik, sec, yahoo: back.yahoo, ttm, capturedAt: back.capturedAt });
    const strip = (t: unknown) => { const rest = { ...(t as Record<string, unknown>) }; delete rest.fundamentals; return rest; };
    expect(JSON.stringify(strip(again.tearsheetAnnual))).toBe(JSON.stringify(strip(files.tearsheetAnnual)));
  });

  it("keepQuoteTearsheet reads a facts:free capture and refuses a Bigdata one (data/raw is provenance)", () => {
    const free = mkdtempSync(join(tmpdir(), "keep-free-"));
    writeTearsheetFiles(free, files);
    expect((keepQuoteTearsheet(free) as { company_overview: { price: number } }).company_overview.price).toBe(yahoo.price);

    const bigdata = mkdtempSync(join(tmpdir(), "keep-bigdata-"));
    writeFileSync(join(bigdata, "bigdata-tearsheet-annual.json"), JSON.stringify({ company_overview: { company_name: "X", sector: "Tech", ceo: "Y", price: 1, market_cap: 2 } }));
    writeFileSync(join(bigdata, "bigdata-statements-quarter.json"), JSON.stringify({ fundamentals: { income_statement: [], balance_sheet: [], cash_flow: [] } }));
    expect(() => keepQuoteTearsheet(bigdata)).toThrow(/Bigdata/);

    const empty = mkdtempSync(join(tmpdir(), "keep-empty-"));
    expect(() => keepQuoteTearsheet(empty)).toThrow(/needs an existing/);
  });
});
