import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { resolveCik } from "../lib/edgar/tickers";
import { fetchCompanyFacts, parseCompanyFacts } from "../lib/facts/free/sec";
import { parseFilingXbrl, mergeFilingFacts, type CompanyFactsLike } from "../lib/facts/free/filing-xbrl";
import { ANNUAL_PRIMARY_FILE } from "../lib/facts/manifest";
import { fetchQuoteSummary, parseQuoteSummary } from "../lib/facts/free/yahoo";
import { computeTtm } from "../lib/facts/free/ttm";
import { buildTearsheetFiles, writeTearsheetFiles } from "../lib/facts/free/emit";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:free -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();

// Prefer the curated watchlist CIK over SEC's ticker map. After a corporate
// reorganization the ticker map can point at a brand-new holding-company CIK whose
// companyfacts history is empty (e.g. XOM → "ExxonMobil Holdings Corp" CIK 2115436 in
// mid-2026), while the operating company's full XBRL history — and the cross-filed
// current 10-Q — still sit under the legacy CIK (34088). facts:prepare and the pack's
// downstream enrich already key off the watchlist CIK; align facts:free with them so a
// single curated watchlist entry fixes the whole pipeline. resolveCik stays the fallback
// for a ticker not (yet) on the watchlist.
const watch = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as { ticker: string; cik: number }[]).find((w) => w.ticker === ticker);
const cik = watch?.cik ?? (await resolveCik(ticker, contact)).cik;

let sec: ReturnType<typeof parseCompanyFacts>;
try {
  const facts = (await fetchCompanyFacts(cik, contact)) as CompanyFactsLike;

  // SEC's aggregated companyfacts API can lag a just-filed 10-Q/10-K by days or weeks. The
  // filing's own PRIMARY document (captured by facts:prepare as edgar-primary.html) is itself
  // inline XBRL, so when it's present we parse its consolidated us-gaap facts and merge them in
  // — a graceful no-op when the file or its filing metadata is absent, or has no iXBRL facts.
  const captureDir = join("data", "raw", ticker, accession);
  let merged = facts;
  try {
    const html = readFileSync(join(captureDir, "edgar-primary.html"), "utf8");
    const filingMeta = JSON.parse(readFileSync(join(captureDir, "edgar-filing.json"), "utf8")) as { form: string; filedDate: string };
    const filingFacts = parseFilingXbrl(html, { form: filingMeta.form, filed: filingMeta.filedDate });
    merged = mergeFilingFacts(facts, filingFacts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }

  // The companyfacts API can omit a concept a filer nonetheless tags: Visa's EarningsPerShareDiluted
  // is absent from companyfacts entirely, though every 10-K tags it (non-dimensioned), because Visa's
  // per-share facts sit only under class-of-stock contexts the API drops. The prior 10-K's own primary
  // document (captured by facts:prepare as edgar-10k-primary.html) carries the annual EPS series, so we
  // parse and merge it too. It is stamped with the 10-K's own period-end date, older than the
  // companyfacts filings, so it only FILLS concepts companyfacts lacks (EPS) and never overrides live
  // values. Missing file / no iXBRL facts is a graceful no-op.
  try {
    const annualHtml = readFileSync(join(captureDir, ANNUAL_PRIMARY_FILE), "utf8");
    const periodEnd = annualHtml.match(/name="dei:DocumentPeriodEndDate"[^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
    const annualFacts = parseFilingXbrl(annualHtml, { form: "10-K", filed: periodEnd ?? "2000-01-01" });
    merged = mergeFilingFacts(merged, annualFacts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }

  sec = parseCompanyFacts(merged);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`SEC data for ${ticker}: ${message}`);
}

if (sec.annual.length < 3) { console.error(`Only ${sec.annual.length} annual periods from SEC for ${ticker}; need ≥3.`); process.exit(1); }
const latestFY = sec.annual.at(-1)!.fiscal_year;

const yraw = await fetchQuoteSummary(ticker);          // throws loudly on crumb/HTTP failure
const yahoo = parseQuoteSummary(yraw, { latestFY });
const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield, trailingPe: yahoo.trailingPe });

const dir = join("data", "raw", ticker, accession);
const files = buildTearsheetFiles({ cik, sec, yahoo, ttm, capturedAt: new Date().toISOString() });
mkdirSync(dir, { recursive: true });
writeTearsheetFiles(dir, files);
console.log(`Wrote 3 free tearsheet files to ${dir}\n  ${yahoo.companyName} · price ${yahoo.price} · ${sec.annual.length} FY · ${sec.quarter.length} quarters · target ${yahoo.targets.consensus}`);
