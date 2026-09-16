import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCompanyFacts } from "./sec";
import { parseQuoteSummary } from "./yahoo";
import { computeTtm } from "./ttm";
import { buildTearsheetFiles, writeTearsheetFiles } from "./emit";
import { mapStatements } from "../map/statements";
import { mapQuote } from "../map/quote";
import { mapAnalysts } from "../map/analysts";

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
});
