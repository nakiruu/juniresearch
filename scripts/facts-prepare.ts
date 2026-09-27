import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSubmissions, parseRecent, findEarningsRelease, findLatestAnnual, findLatestProxy,
  fetchFilingIndex, exhibit99Url, fetchEdgarDocument, filingUrl, submissionsUrl, type RecentFiling, type RecentBody,
} from "../lib/edgar/submissions";
import { fetchPrimaryDocument } from "../lib/edgar/filing-text";
import { edgarJson, EDGAR_MIN_INTERVAL_MS } from "../lib/edgar/client";
import { createRateLimiter } from "../lib/edgar/throttle";
import type { WatchEntry } from "../lib/edgar/detect";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { isoMinusDays, PRESS_RELEASE_FILE, PRESS_RELEASE_MISSING_FILE, ANNUAL_PRIMARY_FILE, PROXY_FILE } from "../lib/facts/manifest";
import { requireContact } from "./_env";

interface DocRef { accession: string; filedDate: string; url: string }

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:prepare -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();
const watch = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as WatchEntry[]).find((w) => w.ticker === ticker);
if (!watch) { console.error(`${ticker} is not in data/edgar/watchlist.json — run npm run watchlist:add -- ${ticker}`); process.exit(2); }
const cik = watch.cik;

// Every SEC request goes through one limiter: starts stay ≥ EDGAR_MIN_INTERVAL_MS apart (SEC fair
// access) while the independent document downloads below overlap their response latency.
const sec = createRateLimiter(EDGAR_MIN_INTERVAL_MS);

// One fetch of the submissions feed (both shapes are parsed from the same body): the Filing list
// (10-Q/10-K only, for the target filing) and the RecentFiling list (every form, with items[], for
// the earnings-release and prior-10-K lookups below).
const submissionsBody = await sec(() => edgarJson<RecentBody>(submissionsUrl(cik), contact));
const filing = parseSubmissions(cik, submissionsBody).find((f) => f.accession === accession);
if (!filing) { console.error(`Accession ${accession} not found among ${ticker}'s 10-Q/10-K filings`); process.exit(1); }
const recent: RecentFiling[] = parseRecent(submissionsBody);

const dir = join("data", "raw", ticker, accession);
mkdirSync(dir, { recursive: true });
const company = watch.name ?? ticker;
const today = new Date().toISOString().slice(0, 10);

// Yahoo is not SEC: start the price-history download now, alongside the EDGAR documents. It is only
// written after edgar-filing.json (as before), and discarded if an EDGAR step fails — a re-run must
// not find a price history captured ahead of the filing record.
const yahooPath = join(dir, "yahoo-history.json");
const yahooFrom = isoMinusDays(filing.periodEnd, 45);
const yahooBody = existsSync(yahooPath) ? null : fetchDailyCloses(ticker, yahooFrom, today);
yahooBody?.catch(() => {}); // surfaced by the await below; never an unhandled rejection meanwhile

// The four EDGAR steps are independent; each returns its own notes so the summary keeps its order.
async function capturePrimary(): Promise<string[]> {
  if (existsSync(join(dir, "edgar-primary.html"))) return ["edgar-primary.html (already present)"];
  writeFileSync(join(dir, "edgar-primary.html"), await sec(() => fetchPrimaryDocument(filing!.url, contact)));
  return ["edgar-primary.html"];
}

// Earnings press release: the exhibit 99.1 of the newest item-2.02 8-K filed on or before this filing.
const prPath = join(dir, PRESS_RELEASE_FILE);
const prMissingPath = join(dir, PRESS_RELEASE_MISSING_FILE);
const filingJsonPath = join(dir, "edgar-filing.json");
const existingPressRelease: DocRef | null = existsSync(filingJsonPath)
  ? ((JSON.parse(readFileSync(filingJsonPath, "utf8")) as { pressRelease?: DocRef | null }).pressRelease ?? null)
  : null;

const filedDate = filing.filedDate;
async function derivePressRelease(): Promise<{ record: DocRef | null; missingReason: string | null }> {
  const pr = findEarningsRelease(recent, filedDate);
  if (!pr) return { record: null, missingReason: `no item-2.02 8-K on or before ${filedDate}` };
  const items = await sec(() => fetchFilingIndex(cik, pr.accession, contact));
  const url = exhibit99Url(cik, pr.accession, items);
  if (!url) return { record: null, missingReason: `no exhibit 99 in ${pr.accession}` };
  return { record: { accession: pr.accession, filedDate: pr.filedDate, url }, missingReason: null };
}

async function capturePressRelease(): Promise<{ pressRelease: DocRef | null; notes: string[] }> {
  if (existsSync(prPath)) {
    // The html is already captured: reuse its record from edgar-filing.json rather than re-deriving it
    // (a re-run must never downgrade a present record to null) — the filing-index fetch only runs when
    // that record is absent (e.g. a capture from before this field existed).
    const pressRelease = existingPressRelease ?? (await derivePressRelease()).record;
    rmSync(prMissingPath, { force: true });
    return { pressRelease, notes: ["edgar-press-release.html (already present)"] };
  }
  const { record, missingReason } = await derivePressRelease();
  if (record) {
    writeFileSync(prPath, await sec(() => fetchEdgarDocument(record.url, contact)));
    rmSync(prMissingPath, { force: true });
    return { pressRelease: record, notes: ["edgar-press-release.html"] };
  }
  if (!existsSync(prMissingPath)) {
    writeFileSync(prMissingPath, missingReason!);
    return { pressRelease: record, notes: ["edgar-press-release.missing"] };
  }
  return { pressRelease: record, notes: ["edgar-press-release.missing (already present)"] };
}

// Latest 10-K primary document, only relevant alongside a 10-Q.
async function captureAnnualReport(): Promise<{ annualReport: DocRef | null; notes: string[] }> {
  if (filing!.form !== "10-Q") return { annualReport: null, notes: [] };
  const ar = findLatestAnnual(recent, filedDate);
  if (!ar) return { annualReport: null, notes: ["no prior 10-K found"] };
  const arUrl = filingUrl(cik, ar.accession, ar.primaryDocument);
  const annualReport = { accession: ar.accession, filedDate: ar.filedDate, url: arUrl };
  const arPath = join(dir, ANNUAL_PRIMARY_FILE);
  if (existsSync(arPath)) return { annualReport, notes: [`${ANNUAL_PRIMARY_FILE} (already present)`] };
  writeFileSync(arPath, await sec(() => fetchPrimaryDocument(arUrl, contact)));
  return { annualReport, notes: [ANNUAL_PRIMARY_FILE] };
}

// Latest definitive proxy statement (DEF 14A) filed on or before this filing: the governance source.
async function captureProxy(): Promise<{ proxyStatement: DocRef | null; notes: string[] }> {
  const px = findLatestProxy(recent, filedDate);
  if (!px) return { proxyStatement: null, notes: ["no proxy statement found"] };
  const pxUrl = filingUrl(cik, px.accession, px.primaryDocument);
  const proxyStatement = { accession: px.accession, filedDate: px.filedDate, url: pxUrl };
  const pxPath = join(dir, PROXY_FILE);
  if (existsSync(pxPath)) return { proxyStatement, notes: [`${PROXY_FILE} (already present)`] };
  writeFileSync(pxPath, await sec(() => fetchPrimaryDocument(pxUrl, contact)));
  return { proxyStatement, notes: [PROXY_FILE] };
}

const [primaryNotes, pr, ar, px] = await Promise.all([capturePrimary(), capturePressRelease(), captureAnnualReport(), captureProxy()]);
const { pressRelease } = pr, { annualReport } = ar, { proxyStatement } = px;
const notes: string[] = [...primaryNotes, ...pr.notes, ...ar.notes, ...px.notes];

// SEC serves SIC on the submissions feed we already fetched; persist it for sector-aware downstream logic.
const sic = submissionsBody.sic != null && submissionsBody.sic !== "" ? Number(submissionsBody.sic) : null;
const sicDescription = submissionsBody.sicDescription ?? null;

writeFileSync(
  join(dir, "edgar-filing.json"),
  JSON.stringify({ ...filing, ticker, cik, company, sic, sicDescription, pressRelease, annualReport, proxyStatement }, null, 2) + "\n",
);

// A re-run adds what is missing; it must not move the captured price history under a built report.
if (yahooBody) {
  writeFileSync(yahooPath, await yahooBody);
  notes.push(`yahoo-history.json (${yahooFrom} → ${today})`);
} else {
  notes.push("yahoo-history.json (already present)");
}
if (!existsSync(join(dir, "capture.json"))) writeFileSync(join(dir, "capture.json"), `{ "capturedAt": "${new Date().toISOString()}" }\n`);

console.log(`Prepared ${dir}:`);
console.log(`  edgar-filing.json, ${notes.join(", ")}, capture.json`);
