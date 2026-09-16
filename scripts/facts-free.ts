import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { resolveCik } from "../lib/edgar/tickers";
import { fetchCompanyFacts, parseCompanyFacts } from "../lib/facts/free/sec";
import { parseFilingXbrl, mergeFilingFacts, type CompanyFactsLike } from "../lib/facts/free/filing-xbrl";
import { fetchQuoteSummary, parseQuoteSummary } from "../lib/facts/free/yahoo";
import { computeTtm } from "../lib/facts/free/ttm";
import { buildTearsheetFiles, writeTearsheetFiles } from "../lib/facts/free/emit";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:free -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();

const { cik } = await resolveCik(ticker, contact);

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

  sec = parseCompanyFacts(merged);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`SEC data for ${ticker}: ${message}`);
}

if (sec.annual.length < 3) { console.error(`Only ${sec.annual.length} annual periods from SEC for ${ticker}; need ≥3.`); process.exit(1); }
const latestFY = sec.annual.at(-1)!.fiscal_year;

const yraw = await fetchQuoteSummary(ticker);          // throws loudly on crumb/HTTP failure
const yahoo = parseQuoteSummary(yraw, { latestFY });
const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield });

const dir = join("data", "raw", ticker, accession);
const files = buildTearsheetFiles({ cik, sec, yahoo, ttm, capturedAt: new Date().toISOString() });
mkdirSync(dir, { recursive: true });
writeTearsheetFiles(dir, files);
console.log(`Wrote 3 free tearsheet files to ${dir}\n  ${yahoo.companyName} · price ${yahoo.price} · ${sec.annual.length} FY · ${sec.quarter.length} quarters · target ${yahoo.targets.consensus}`);
