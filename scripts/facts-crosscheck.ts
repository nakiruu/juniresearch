/**
 * facts-crosscheck.ts — cross-check one filing's FactPack against Shibui Finance (lib/facts/shibui-check.ts).
 *
 *   npm run facts:crosscheck -- <TICKER> <ACCESSION>            # print the Shibui call to make
 *   npm run facts:crosscheck -- <TICKER> <ACCESSION> --apply    # stamp the saved response onto the pack
 *
 * Shibui Finance is a Claude connector, not an HTTP API, so the capture is two steps: this prints the
 * `stock_data_query` call (point-in-time at the pack's quote date and latest quarter end); the capturer
 * saves the response verbatim to data/raw/<T>/<ACC>/shibui-crosscheck.json; `--apply` compares and
 * writes `shibuiCheck` (diffs + Shibui's TTM SBC) onto data/facts/<T>/<ACC>.json.
 */
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CROSSCHECK_FILE, CROSSCHECK_USER_PROMPT, buildShibuiCheck, crossCheckKey, crossCheckQuery, crossCheckTarget,
  parseCrossCheckResponse, stampShibuiCheck,
} from "../lib/facts/shibui-check";

const [tickerArg, accession, flag] = process.argv.slice(2);
if (!tickerArg || !accession) {
  console.error("usage: npm run facts:crosscheck -- <TICKER> <ACCESSION> [--apply]");
  process.exit(2);
}
const ticker = tickerArg.toUpperCase();
const packPath = join("data", "facts", ticker, `${accession}.json`);
const rawPath = join("data", "raw", ticker, accession, CROSSCHECK_FILE);
if (!existsSync(packPath)) {
  console.error(`Missing ${packPath} — run facts:build first`);
  process.exit(2);
}
const pack = JSON.parse(readFileSync(packPath, "utf8"));
const target = crossCheckTarget(pack);

if (flag !== "--apply") {
  console.log(JSON.stringify({
    file: rawPath, server: "shibui", tool: "stock_data_query",
    params: { query: crossCheckQuery([target]), user_prompt: CROSSCHECK_USER_PROMPT },
  }, null, 2));
  process.exit(0);
}

if (!existsSync(rawPath)) {
  console.error(`Missing ${rawPath} — make the Shibui call printed without --apply and save its response there`);
  process.exit(2);
}
const key = crossCheckKey(target.ticker, target.asOf, target.periodEnd);
const row = parseCrossCheckResponse(readFileSync(rawPath, "utf8")).find((r) => crossCheckKey(r.ticker, r.asOf, r.periodEnd) === key);
if (!row) {
  console.error(`${rawPath} has no row for ${key} (the pack's quote date / quarter end) — re-run the query`);
  process.exit(1);
}
const check = buildShibuiCheck(pack, row);
const { atime, mtime } = statSync(packPath); // latestFactPack picks by mtime — a re-stamp must not reorder packs
stampShibuiCheck(pack, check, new Date().toISOString());
writeFileSync(packPath, JSON.stringify(pack, null, 2) + "\n");
utimesSync(packPath, atime, mtime);
const flagged = check.diffs.filter((d) => d.level !== "ok");
console.log(`${packPath}: ${check.diffs.length} field(s) compared, SBC TTM ${check.sbcTtm ?? "n/a"}`);
for (const d of flagged) console.log(`  ${d.level.toUpperCase()} ${d.field}: pack ${d.pack} vs Shibui ${d.shibui} (${(d.relDiff * 100).toFixed(1)}%)`);
