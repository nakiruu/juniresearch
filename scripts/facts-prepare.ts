import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchSubmissions, fetchRecent, findEarningsRelease, findLatestAnnual,
  fetchFilingIndex, exhibit99Url, fetchEdgarDocument, filingUrl, type RecentFiling,
} from "../lib/edgar/submissions";
import { fetchPrimaryDocument } from "../lib/edgar/filing-text";
import { sleep, EDGAR_MIN_INTERVAL_MS } from "../lib/edgar/client";
import type { WatchEntry } from "../lib/edgar/detect";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { isoMinusDays } from "../lib/facts/manifest";
import { requireContact } from "./_env";

interface DocRef { accession: string; filedDate: string; url: string }

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:prepare -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();
const watch = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as WatchEntry[]).find((w) => w.ticker === ticker);
if (!watch) { console.error(`${ticker} is not in data/edgar/watchlist.json — run npm run watchlist:add -- ${ticker}`); process.exit(2); }
const cik = watch.cik;

const filing = (await fetchSubmissions(cik, contact)).find((f) => f.accession === accession);
if (!filing) { console.error(`Accession ${accession} not found among ${ticker}'s 10-Q/10-K filings`); process.exit(1); }

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

await sleep(EDGAR_MIN_INTERVAL_MS);
const recent: RecentFiling[] = await fetchRecent(cik, contact);

// Earnings press release: the exhibit 99.1 of the newest item-2.02 8-K filed on or before this filing.
let pressRelease: DocRef | null = null;
const pr = findEarningsRelease(recent, filing.filedDate);
const prPath = join(dir, "edgar-press-release.html");
const prMissingPath = join(dir, "edgar-press-release.missing");
if (pr) {
  await sleep(EDGAR_MIN_INTERVAL_MS);
  const items = await fetchFilingIndex(cik, pr.accession, contact);
  const url = exhibit99Url(cik, pr.accession, items);
  if (url) {
    pressRelease = { accession: pr.accession, filedDate: pr.filedDate, url };
    if (!existsSync(prPath)) {
      await sleep(EDGAR_MIN_INTERVAL_MS);
      writeFileSync(prPath, await fetchEdgarDocument(url, contact));
      notes.push("edgar-press-release.html");
    } else {
      notes.push("edgar-press-release.html (already present)");
    }
  } else if (!existsSync(prMissingPath)) {
    writeFileSync(prMissingPath, `no exhibit 99 in ${pr.accession}`);
    notes.push("edgar-press-release.missing");
  } else {
    notes.push("edgar-press-release.missing (already present)");
  }
} else if (!existsSync(prMissingPath)) {
  writeFileSync(prMissingPath, `no item-2.02 8-K on or before ${filing.filedDate}`);
  notes.push("edgar-press-release.missing");
} else {
  notes.push("edgar-press-release.missing (already present)");
}

// Latest 10-K primary document, only relevant alongside a 10-Q.
let annualReport: DocRef | null = null;
if (filing.form === "10-Q") {
  const ar = findLatestAnnual(recent, filing.filedDate);
  if (ar) {
    const arUrl = filingUrl(cik, ar.accession, ar.primaryDocument);
    annualReport = { accession: ar.accession, filedDate: ar.filedDate, url: arUrl };
    const arPath = join(dir, "edgar-10k-primary.html");
    if (!existsSync(arPath)) {
      await sleep(EDGAR_MIN_INTERVAL_MS);
      writeFileSync(arPath, await fetchPrimaryDocument(arUrl, contact));
      notes.push("edgar-10k-primary.html");
    } else {
      notes.push("edgar-10k-primary.html (already present)");
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
