import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSubmissions, parseRecent, findEarningsRelease, findLatestAnnual,
  fetchFilingIndex, exhibit99Url, fetchEdgarDocument, filingUrl, submissionsUrl, type RecentFiling, type RecentBody,
} from "../lib/edgar/submissions";
import { fetchPrimaryDocument } from "../lib/edgar/filing-text";
import { edgarJson, sleep, EDGAR_MIN_INTERVAL_MS } from "../lib/edgar/client";
import type { WatchEntry } from "../lib/edgar/detect";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { isoMinusDays, PRESS_RELEASE_FILE, PRESS_RELEASE_MISSING_FILE, ANNUAL_PRIMARY_FILE } from "../lib/facts/manifest";
import { requireContact } from "./_env";

interface DocRef { accession: string; filedDate: string; url: string }

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:prepare -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();
const watch = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as WatchEntry[]).find((w) => w.ticker === ticker);
if (!watch) { console.error(`${ticker} is not in data/edgar/watchlist.json — run npm run watchlist:add -- ${ticker}`); process.exit(2); }
const cik = watch.cik;

// One fetch of the submissions feed (both shapes are parsed from the same body): the Filing list
// (10-Q/10-K only, for the target filing) and the RecentFiling list (every form, with items[], for
// the earnings-release and prior-10-K lookups below).
const submissionsBody = await edgarJson<RecentBody>(submissionsUrl(cik), contact);
const filing = parseSubmissions(cik, submissionsBody).find((f) => f.accession === accession);
if (!filing) { console.error(`Accession ${accession} not found among ${ticker}'s 10-Q/10-K filings`); process.exit(1); }
const recent: RecentFiling[] = parseRecent(submissionsBody);

const dir = join("data", "raw", ticker, accession);
mkdirSync(dir, { recursive: true });
const company = watch.name ?? ticker;
const notes: string[] = [];

if (!existsSync(join(dir, "edgar-primary.html"))) {
  writeFileSync(join(dir, "edgar-primary.html"), await fetchPrimaryDocument(filing.url, contact));
  notes.push("edgar-primary.html");
} else {
  notes.push("edgar-primary.html (already present)");
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
  await sleep(EDGAR_MIN_INTERVAL_MS);
  const items = await fetchFilingIndex(cik, pr.accession, contact);
  const url = exhibit99Url(cik, pr.accession, items);
  if (!url) return { record: null, missingReason: `no exhibit 99 in ${pr.accession}` };
  return { record: { accession: pr.accession, filedDate: pr.filedDate, url }, missingReason: null };
}

let pressRelease: DocRef | null;
if (existsSync(prPath)) {
  // The html is already captured: reuse its record from edgar-filing.json rather than re-deriving it
  // (a re-run must never downgrade a present record to null) — the filing-index fetch only runs when
  // that record is absent (e.g. a capture from before this field existed).
  pressRelease = existingPressRelease ?? (await derivePressRelease()).record;
  notes.push("edgar-press-release.html (already present)");
  rmSync(prMissingPath, { force: true });
} else {
  const { record, missingReason } = await derivePressRelease();
  pressRelease = record;
  if (record) {
    await sleep(EDGAR_MIN_INTERVAL_MS);
    writeFileSync(prPath, await fetchEdgarDocument(record.url, contact));
    notes.push("edgar-press-release.html");
    rmSync(prMissingPath, { force: true });
  } else if (!existsSync(prMissingPath)) {
    writeFileSync(prMissingPath, missingReason!);
    notes.push("edgar-press-release.missing");
  } else {
    notes.push("edgar-press-release.missing (already present)");
  }
}

// Latest 10-K primary document, only relevant alongside a 10-Q.
let annualReport: DocRef | null = null;
if (filing.form === "10-Q") {
  const ar = findLatestAnnual(recent, filing.filedDate);
  if (ar) {
    const arUrl = filingUrl(cik, ar.accession, ar.primaryDocument);
    annualReport = { accession: ar.accession, filedDate: ar.filedDate, url: arUrl };
    const arPath = join(dir, ANNUAL_PRIMARY_FILE);
    if (!existsSync(arPath)) {
      await sleep(EDGAR_MIN_INTERVAL_MS);
      writeFileSync(arPath, await fetchPrimaryDocument(arUrl, contact));
      notes.push(ANNUAL_PRIMARY_FILE);
    } else {
      notes.push(`${ANNUAL_PRIMARY_FILE} (already present)`);
    }
  } else {
    notes.push("no prior 10-K found");
  }
}

writeFileSync(
  join(dir, "edgar-filing.json"),
  JSON.stringify({ ...filing, ticker, cik, company, pressRelease, annualReport }, null, 2) + "\n",
);

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dir, "yahoo-history.json"), await fetchDailyCloses(ticker, isoMinusDays(filing.periodEnd, 45), today));
if (!existsSync(join(dir, "capture.json"))) writeFileSync(join(dir, "capture.json"), `{ "capturedAt": "${new Date().toISOString()}" }\n`);

console.log(`Prepared ${dir}:`);
console.log(`  edgar-filing.json, ${notes.join(", ")}, yahoo-history.json, capture.json (${isoMinusDays(filing.periodEnd, 45)} → ${today})`);
