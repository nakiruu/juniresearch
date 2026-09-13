import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSubmissions } from "../lib/edgar/submissions";
import { fetchPrimaryDocument } from "../lib/edgar/filing-text";
import type { WatchEntry } from "../lib/edgar/detect";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { isoMinusDays } from "../lib/facts/manifest";
import { requireContact } from "./_env";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:prepare -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();
const watch = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as WatchEntry[]).find((w) => w.ticker === ticker);
if (!watch) { console.error(`${ticker} is not in data/edgar/watchlist.json — run npm run watchlist:add -- ${ticker}`); process.exit(2); }

const filing = (await fetchSubmissions(watch.cik, contact)).find((f) => f.accession === accession);
if (!filing) { console.error(`Accession ${accession} not found among ${ticker}'s 10-Q/10-K filings`); process.exit(1); }

const dir = join("data", "raw", ticker, accession);
mkdirSync(dir, { recursive: true });
const slice = JSON.parse(readFileSync("lib/edgar/__fixtures__/company-tickers-slice.json", "utf8")) as Record<string, { ticker: string; title: string }>;
const company = Object.values(slice).find((c) => c.ticker === ticker)?.title ?? ticker;

writeFileSync(join(dir, "edgar-filing.json"), JSON.stringify({ ...filing, ticker, cik: watch.cik, company }, null, 2) + "\n");
if (!existsSync(join(dir, "edgar-primary.html"))) writeFileSync(join(dir, "edgar-primary.html"), await fetchPrimaryDocument(filing.url, contact));
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dir, "yahoo-history.json"), await fetchDailyCloses(ticker, isoMinusDays(filing.periodEnd, 45), today));
console.log(`Prepared ${dir}: edgar-filing.json, edgar-primary.html, yahoo-history.json (${isoMinusDays(filing.periodEnd, 45)} → ${today})`);
