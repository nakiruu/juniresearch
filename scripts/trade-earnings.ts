/**
 * trade-earnings.ts — capture each covered name's latest earnings result for the stale-on-bad-news entry gate
 * (lib/trade/stale-entry.ts, docs/engine.md §4.2).
 *
 *   npm run trade:earnings -- --query [--as-of YYYY-MM-DD]          # print the Shibui call(s) for every report ticker
 *   npm run trade:earnings -- --apply <saved.json> [...] [--as-of D] # → data/earnings/latest.json
 *
 * Shibui is a Claude connector, not an HTTP API: --query prints the `stock_data_query` call(s); the capturer runs
 * each and saves the response verbatim (e.g. data/raw/_shibui/earnings-<date>.json); --apply parses it. Commit
 * data/earnings/latest.json and rebuild — the trader reads the file baked into its image. Refresh it after each
 * earnings season (and whenever a covered name reports): a result older than staleEntryEarningsMaxDays (120) is
 * ignored, and a missing name is never gated.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { listReportTickers, loadReport } from "../lib/reports";
import { EARNINGS_PATH, EARNINGS_USER_PROMPT, buildEarningsFile, earningsBatches, earningsQuery } from "../lib/trade/earnings";
import { todayET } from "../lib/trade/clock";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const asOf = opt("--as-of") ?? todayET();

async function reportTickers(): Promise<string[]> {
  const out: string[] = [];
  for (const t of await listReportTickers()) {
    const r = await loadReport(t);
    if (r) out.push(r.meta.ticker.toUpperCase());
  }
  return out;
}

const mode = args[0];
if (mode === "--query") {
  const batches = earningsBatches(await reportTickers());
  console.log(JSON.stringify(batches.map((b) => ({
    tool: "mcp__Shibui_Finance__stock_data_query",
    tickers: b.length,
    params: { query: earningsQuery(b, asOf), user_prompt: EARNINGS_USER_PROMPT },
  })), null, 2));
} else if (mode === "--apply" && args.length > 1) {
  const files = args.slice(1).filter((a, i, all) => a !== "--as-of" && all[i - 1] !== "--as-of");
  const file = buildEarningsFile(files.map((f) => JSON.parse(readFileSync(f, "utf8")) as unknown), asOf);
  mkdirSync(dirname(EARNINGS_PATH), { recursive: true });
  writeFileSync(EARNINGS_PATH, JSON.stringify(file, null, 2) + "\n");
  const misses = Object.entries(file.byTicker).filter(([, e]) => e.surprisePct < 0);
  console.log(`Wrote ${EARNINGS_PATH}: ${Object.keys(file.byTicker).length} names as of ${asOf}, ${misses.length} with a miss`
    + `${misses.length ? ` (${misses.map(([t, e]) => `${t} ${e.surprisePct.toFixed(1)}% ${e.reportDate}`).join(", ")})` : ""}`);
  if (file.missing.length) console.log(`  no reported quarter in Shibui (never gated): ${file.missing.join(", ")}`);
} else {
  console.error("usage: trade-earnings.ts --query [--as-of YYYY-MM-DD] | --apply <saved-response.json> [...] [--as-of YYYY-MM-DD]");
  process.exit(2);
}
