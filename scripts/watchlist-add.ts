import { readFileSync, writeFileSync } from "node:fs";
import { resolveCik } from "../lib/edgar/tickers";
import type { WatchEntry } from "../lib/edgar/detect";
import { requireContact } from "./_env";

const ticker = (process.argv[2] ?? "").toUpperCase();
if (!ticker) { console.error("usage: npm run watchlist:add -- <TICKER>"); process.exit(2); }
const list = JSON.parse(readFileSync("data/watchlist.json", "utf8")) as WatchEntry[];
if (list.some((w) => w.ticker === ticker)) { console.log(`${ticker} already watched.`); process.exit(0); }
const { cik, title } = await resolveCik(ticker, requireContact());
list.push({ ticker, cik });
writeFileSync("data/watchlist.json", JSON.stringify(list, null, 2) + "\n");
console.log(`Added ${ticker} (${title}, CIK ${cik}).`);
