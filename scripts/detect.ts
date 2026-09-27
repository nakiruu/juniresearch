import { readFileSync, writeFileSync } from "node:fs";
import { fetchSubmissions, type Filing } from "../lib/edgar/submissions";
import { detectNew, markSeen, flattenFilings, type SeenState, type WatchEntry } from "../lib/edgar/detect";
import { EDGAR_MIN_INTERVAL_MS } from "../lib/edgar/client";
import { createRateLimiter, mapConcurrent } from "../lib/edgar/throttle";
import { requireContact } from "./_env";

const contact = requireContact();
const watchlist = JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as WatchEntry[];
const seen = JSON.parse(readFileSync("data/edgar/seen.json", "utf8")) as SeenState;

// Overlap the per-ticker submissions fetches: request starts stay ≥ EDGAR_MIN_INTERVAL_MS apart
// (SEC fair access), but one slow response no longer holds up the rest of the watchlist.
const limit = createRateLimiter(EDGAR_MIN_INTERVAL_MS);
const fetched = await mapConcurrent(watchlist, 4, (w) => limit(() => fetchSubmissions(w.cik, contact)));
const byTicker: Record<string, Filing[]> = {};
watchlist.forEach((w, i) => { byTicker[w.ticker] = fetched[i]; }); // watchlist order, as before
const fresh = detectNew(byTicker, seen);
for (const f of fresh) console.log(`${f.ticker}  ${f.form}  ${f.accession}  filed ${f.filedDate}  period ${f.periodEnd}\n  ${f.url}`);
writeFileSync("data/edgar/seen.json", JSON.stringify(markSeen(seen, flattenFilings(byTicker)), null, 2) + "\n");
if (fresh.length === 0) { console.log("No new 10-Q/10-K filings."); process.exit(0); }
console.log(`\nMarked ${flattenFilings(byTicker).length} filing(s) seen across ${watchlist.length} ticker(s). Next: /fetch-facts <TICKER> <ACCESSION>`);
