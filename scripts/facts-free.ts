import { join } from "node:path";
import { requireContact } from "./_env";
import { resolveCik } from "../lib/edgar/tickers";
import { fetchCompanyFacts, parseCompanyFacts } from "../lib/facts/free/sec";
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
  const facts = await fetchCompanyFacts(cik, contact);
  sec = parseCompanyFacts(facts);
} catch (err: any) {
  throw new Error(`SEC data for ${ticker}: ${err.message}`);
}

if (sec.annual.length < 3) { console.error(`Only ${sec.annual.length} annual periods from SEC for ${ticker}; need ≥3.`); process.exit(1); }
const latestFY = sec.annual.at(-1)!.fiscal_year;

const yraw = await fetchQuoteSummary(ticker);          // throws loudly on crumb/HTTP failure
const yahoo = parseQuoteSummary(yraw, { latestFY });
const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield });

const dir = join("data", "raw", ticker, accession);
const files = buildTearsheetFiles({ cik, sec, yahoo, ttm, capturedAt: new Date().toISOString() });
writeTearsheetFiles(dir, files);
console.log(`Wrote 3 free tearsheet files to ${dir}\n  ${yahoo.companyName} · price ${yahoo.price} · ${sec.annual.length} FY · ${sec.quarter.length} quarters · target ${yahoo.targets.consensus}`);
