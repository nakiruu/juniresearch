/**
 * facts-backfill-ev-ebitda.ts — fill TTM EV/EBITDA on already-published FactPacks that were built with
 * it empty, then nothing else (price, peers and every other field stay as captured).
 *
 *   npm run facts:backfill-ev -- [TICKER ...]      # default: every published report's pack
 *
 * Calculated from SEC data as of the pack's latest quarter and its capture-time market cap; falls back
 * to Yahoo's current enterpriseToEbitda. Re-render each report afterwards with synth:build.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { fillEvToEbitda } from "../lib/facts/enrich";

const contact = requireContact();
const only = new Set(process.argv.slice(2).map((t) => t.toUpperCase()));
const reports = readdirSync("data").filter((f) => /^[a-z0-9.-]+\.json$/.test(f));
const tally = { sec: 0, yahoo: 0, none: 0, had: 0 };
const filled: string[] = [];
for (const f of reports) {
  const r = JSON.parse(readFileSync(join("data", f), "utf8"));
  const ticker: string | undefined = r?.meta?.ticker; const accession: string | undefined = r?.meta?.filing?.accession;
  if (!ticker || !accession || (only.size && !only.has(ticker))) continue;
  const path = join("data", "facts", ticker, `${accession}.json`);
  if (!existsSync(path)) { console.warn(`skip ${ticker}: no pack at ${path}`); continue; }
  const pack = JSON.parse(readFileSync(path, "utf8"));
  if (pack.ttm?.evToEbitda != null) { tally.had++; continue; }
  const src = await fillEvToEbitda(pack, contact);
  if (!src) { tally.none++; console.log(`${ticker.padEnd(6)} — no source`); continue; }
  tally[src]++;
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  filled.push(`${ticker} ${accession}`);
  console.log(`${ticker.padEnd(6)} ${pack.ttm.evToEbitda.toFixed(1)}x (${src})`);
}
console.log(`\nfilled ${tally.sec + tally.yahoo} (SEC ${tally.sec}, Yahoo ${tally.yahoo}) · already had ${tally.had} · no source ${tally.none}`);
if (filled.length) console.log(`Re-render: ${filled.map((x) => `npm run synth:build -- ${x}`).join(" && ")}`);
