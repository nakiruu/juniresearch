/**
 * facts-backfill-fcf-yield.ts — fill the TTM FCF yield on already-published FactPacks that were built with
 * it empty, then nothing else (price, peers and every other field stay as captured).
 *
 *   npm run facts:backfill-fcf -- [TICKER ...]      # default: every published report's pack
 *
 * Calculated from SEC data as the four discrete quarters to the pack's latest quarter over its capture-time
 * market cap. Without it the reverse DCF reads the last fiscal year's FCF. File mtimes are preserved
 * (latestFactPack picks a ticker's newest pack by mtime). Re-render each report afterwards with synth:build.
 */
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { fillFcfYield } from "../lib/facts/enrich";

const contact = requireContact();
const only = new Set(process.argv.slice(2).map((t) => t.toUpperCase()));
const reports = readdirSync("data").filter((f) => /^[a-z0-9.-]+\.json$/.test(f));
const tally = { filled: 0, none: 0, had: 0 };
for (const f of reports) {
  const r = JSON.parse(readFileSync(join("data", f), "utf8"));
  const ticker: string | undefined = r?.meta?.ticker; const accession: string | undefined = r?.meta?.filing?.accession;
  if (!ticker || !accession || (only.size && !only.has(ticker))) continue;
  const path = join("data", "facts", ticker, `${accession}.json`);
  if (!existsSync(path)) { console.warn(`skip ${ticker}: no pack at ${path}`); continue; }
  const pack = JSON.parse(readFileSync(path, "utf8"));
  if (pack.ttm?.fcfYield != null) { tally.had++; continue; }
  const ok = await fillFcfYield(pack, contact).catch((e) => { console.warn(`${ticker}: ${(e as Error).message}`); return false; });
  if (!ok) { tally.none++; console.log(`${ticker.padEnd(6)} — no SEC TTM FCF`); continue; }
  const { atime, mtime } = statSync(path);
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  utimesSync(path, atime, mtime);
  tally.filled++;
  console.log(`${ticker.padEnd(6)} ${(pack.ttm.fcfYield * 100).toFixed(2)}%`);
  await new Promise((res) => setTimeout(res, 150));
}
console.log(`\nfilled ${tally.filled} · already had ${tally.had} · no source ${tally.none}`);
