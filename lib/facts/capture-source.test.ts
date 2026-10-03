import { describe, it, expect } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCaptureSource, provenanceFor, FREE_CAPTURE_MARKER, FREE_PROVENANCE } from "./capture-source";
import { buildFactPack } from "./build";
import { FactPack } from "./schema";
import * as quote from "./map/quote";
import * as statements from "./map/statements";
import * as segments from "./map/segments";
import * as analysts from "./map/analysts";
import { parseCompanyFacts } from "./free/sec";
import { parseQuoteSummary } from "./free/yahoo";
import { computeTtm } from "./free/ttm";
import { buildTearsheetFiles, writeTearsheetFiles } from "./free/emit";

const AVGO = "data/raw/AVGO/0001730168-26-000080";
const LLY_CIK = 59478;

/** A facts:free capture: the LLY fixtures run through the real emitter, plus a minimal fmp-peers.json. */
function freeCapture(dir: string) {
  const sec = parseCompanyFacts(JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", "utf8")));
  const yahoo = parseQuoteSummary(JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-quotesummary.json", "utf8")), { latestFY: sec.annual.at(-1)!.fiscal_year });
  const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield });
  writeTearsheetFiles(dir, buildTearsheetFiles({ cik: LLY_CIK, sec, yahoo, ttm, capturedAt: "2026-09-16T12:00:00Z" }));
  writeFileSync(join(dir, "fmp-peers.json"), JSON.stringify([{ symbol: "MRK" }, { symbol: "PFE" }]));
  return sec;
}

const MAPPER_ROWS = [...quote.PROVENANCE, ...statements.PROVENANCE, ...segments.PROVENANCE, ...analysts.PROVENANCE];

describe("detectCaptureSource", () => {
  it("reads a verbatim Bigdata.com capture as bigdata", () => {
    expect(detectCaptureSource(AVGO)).toBe("bigdata");
  });
  it("reads a facts:free capture as free from its marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "free-src-"));
    freeCapture(dir);
    expect(JSON.parse(readFileSync(join(dir, FREE_CAPTURE_MARKER), "utf8"))).toMatchObject({ producer: "facts:free" });
    expect(detectCaptureSource(dir)).toBe("free");
  });
  it("reads an unmarked facts:free capture (written before the marker existed) as free from the emitter's shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "free-src-"));
    freeCapture(dir);
    rmSync(join(dir, FREE_CAPTURE_MARKER));
    expect(detectCaptureSource(dir)).toBe("free");
  });
  it("refuses a capture whose files disagree about who wrote them", () => {
    const dir = mkdtempSync(join(tmpdir(), "free-src-"));
    freeCapture(dir);
    rmSync(join(dir, FREE_CAPTURE_MARKER));
    copyFileSync(join(AVGO, "bigdata-statements-quarter.json"), join(dir, "bigdata-statements-quarter.json"));
    expect(() => detectCaptureSource(dir)).toThrow(/Cannot tell who wrote/);
  });
});

describe("provenanceFor", () => {
  it("passes a Bigdata capture's rows through unchanged", () => {
    expect(provenanceFor(MAPPER_ROWS, "bigdata")).toEqual(MAPPER_ROWS);
  });
  it("relabels every Bigdata tearsheet row of a free capture to edgar (SEC) or yahoo, leaving fmp peers alone", () => {
    const rows = provenanceFor(MAPPER_ROWS, "free");
    const by = (f: string) => rows.find((r) => r.field === f)!;
    for (const f of ["statements", "latestQuarter", "ttm", "segments", "geoMix"]) expect(by(f).source).toBe("edgar");
    for (const f of ["quote", "quote.sharesOutstanding", "quote.dividendYield", "company", "context.description", "analysts", "estimates"]) expect(by(f).source).toBe("yahoo");
    expect(by("peers")).toEqual({ field: "peers", endpoint: "fmp company/peers (tickers only)", source: "fmp" });
    expect(rows.filter((r) => r.source === "bigdata")).toEqual([]);
    expect(rows.every((r) => !r.endpoint.startsWith("bigdata_"))).toBe(true);
    expect(by("statements").endpoint).toMatch(/SEC companyfacts/);
  });
  it("is idempotent and leaves rows it does not own (enrichment, EDGAR, bigdata_search) untouched", () => {
    const other = [
      { field: "context.headlines", endpoint: "bigdata_search", source: "bigdata" as const },
      { field: "quote.sharesOutstanding", endpoint: "edgar primary document (cover page)", source: "edgar" as const },
      { field: "ttm.evToEbitda", endpoint: "quoteSummary.defaultKeyStatistics.enterpriseToEbitda", source: "yahoo" as const },
    ];
    expect(provenanceFor(other, "free")).toEqual(other);
    const once = provenanceFor(MAPPER_ROWS, "free");
    expect(provenanceFor(once, "free")).toEqual(once);
  });
  it("covers exactly the tearsheet fields the mappers label bigdata", () => {
    const bigdataTearsheet = MAPPER_ROWS.filter((r) => r.source === "bigdata").map((r) => r.field).sort();
    expect(Object.keys(FREE_PROVENANCE).sort()).toEqual(bigdataTearsheet);
  });
});

describe("buildFactPack on a facts:free capture", () => {
  // The free emitter's files for LLY, alongside the EDGAR/Yahoo-history files of a real capture
  // re-pointed at LLY so the identity checks pass.
  const root = mkdtempSync(join(tmpdir(), "free-build-"));
  const dir = join(root, "0000059478-26-000001");
  mkdirSync(dir);
  for (const f of ["capture.json", "edgar-primary.html", "yahoo-history.json"]) copyFileSync(join(AVGO, f), join(dir, f));
  const sec = freeCapture(dir);
  const filing = JSON.parse(readFileSync(join(AVGO, "edgar-filing.json"), "utf8"));
  const latestQ = [...sec.quarter].sort((a, b) => (a.report_date < b.report_date ? -1 : 1)).at(-1)!.report_date;
  writeFileSync(join(dir, "edgar-filing.json"), JSON.stringify({ ...filing, ticker: "LLY", cik: LLY_CIK, accession: "0000059478-26-000001", periodEnd: latestQ, pressRelease: null, annualReport: null, proxyStatement: null }));

  const pack = buildFactPack(dir);
  const src = (f: string) => pack.provenance.filter((p) => p.field === f).map((p) => p.source);
  it("produces a pack that parses", () => { expect(FactPack.safeParse(pack).success).toBe(true); });
  it("labels SEC-derived fields edgar and Yahoo-derived fields yahoo, never bigdata for tearsheet fields", () => {
    for (const f of ["statements", "latestQuarter", "ttm", "segments", "geoMix"]) expect(src(f)).toEqual(["edgar"]);
    for (const f of ["quote", "quote.dividendYield", "company", "context.description", "analysts", "estimates", "history"]) expect(src(f)).toEqual(["yahoo"]);
    expect(src("peers")).toEqual(["fmp"]);
    expect(pack.provenance.filter((p) => p.endpoint.startsWith("bigdata_company_tearsheet"))).toEqual([]);
  });
  it("keeps the Bigdata labels for a Bigdata capture", () => {
    const avgo = buildFactPack(AVGO);
    expect(avgo.provenance.find((p) => p.field === "statements")).toMatchObject({ source: "bigdata", endpoint: "bigdata_company_tearsheet.financial_statements (annual)" });
    expect(avgo.provenance.find((p) => p.field === "analysts")?.source).toBe("bigdata");
  });
});
