import { readFileSync, writeFileSync } from "node:fs";
import { fetchSubmissions, type Filing } from "../lib/edgar/submissions";
import { detectNew, markSeen, type SeenState, type WatchEntry } from "../lib/edgar/detect";
import { sleep, EDGAR_MIN_INTERVAL_MS } from "../lib/edgar/client";
import { requireContact } from "./_env";

const contact = requireContact();
const watchlist = JSON.parse(readFileSync("data/watchlist.json", "utf8")) as WatchEntry[];
const seen = JSON.parse(readFileSync("data/edgar/seen.json", "utf8")) as SeenState;

const byTicker: Record<string, Filing[]> = {};
for (const w of watchlist) {
  byTicker[w.ticker] = await fetchSubmissions(w.cik, contact);
  await sleep(EDGAR_MIN_INTERVAL_MS);
}
const fresh = detectNew(byTicker, seen);
if (fresh.length === 0) { console.log("No new 10-Q/10-K filings."); process.exit(0); }
for (const f of fresh) console.log(`${f.ticker}  ${f.form}  ${f.accession}  filed ${f.filedDate}  period ${f.periodEnd}\n  ${f.url}`);
writeFileSync("data/edgar/seen.json", JSON.stringify(markSeen(seen, fresh), null, 2) + "\n");
console.log(`\nMarked ${fresh.length} filing(s) seen. Next: /fetch-facts <TICKER> <ACCESSION>`);
