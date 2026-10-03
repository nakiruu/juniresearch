/**
 * facts-beta.ts — capture a measured beta for one filing's FactPack (lib/facts/beta.ts).
 *
 *   npm run facts:beta -- <TICKER> <ACCESSION>            # print the Shibui call to make
 *   npm run facts:beta -- <TICKER> <ACCESSION> --apply    # stamp the saved response onto the pack
 *
 * Shibui Finance is a Claude connector, not an HTTP API, so the capture is two steps: this prints
 * the `stock_data_query` call (window ending at the pack's quote date); the capturer saves the
 * response verbatim to data/raw/<T>/<ACC>/shibui-beta.json; `--apply` does the arithmetic and writes
 * `beta` onto data/facts/<T>/<ACC>.json. Without a beta the cost of equity uses the SIC proxy.
 */
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BETA_FILE, betaQuery, betaUserPrompt, measureBeta, parseBetaResponse, stampBeta } from "../lib/facts/beta";

const [tickerArg, accession, flag] = process.argv.slice(2);
if (!tickerArg || !accession) {
  console.error("usage: npm run facts:beta -- <TICKER> <ACCESSION> [--apply]");
  process.exit(2);
}
const ticker = tickerArg.toUpperCase();
const packPath = join("data", "facts", ticker, `${accession}.json`);
const rawPath = join("data", "raw", ticker, accession, BETA_FILE);
if (!existsSync(packPath)) {
  console.error(`Missing ${packPath} — run facts:build first`);
  process.exit(2);
}
const pack = JSON.parse(readFileSync(packPath, "utf8"));
const endDate: string = pack.quote.asOf;

if (flag !== "--apply") {
  console.log(JSON.stringify({
    file: rawPath, server: "shibui", tool: "stock_data_query",
    params: { query: betaQuery([{ ticker, endDate }]), user_prompt: betaUserPrompt([ticker]) },
  }, null, 2));
  process.exit(0);
}

if (!existsSync(rawPath)) {
  console.error(`Missing ${rawPath} — make the Shibui call printed without --apply and save its response there`);
  process.exit(2);
}
const stats = parseBetaResponse(readFileSync(rawPath, "utf8")).find((s) => s.ticker === ticker && s.endDate === endDate);
if (!stats) {
  console.error(`${rawPath} has no row for ${ticker} ending ${endDate} (the pack's quote date) — re-run the query`);
  process.exit(1);
}
const beta = measureBeta(stats);
const { atime, mtime } = statSync(packPath); // latestFactPack picks by mtime — a re-stamp must not reorder packs
stampBeta(pack, beta, new Date().toISOString());
writeFileSync(packPath, JSON.stringify(pack, null, 2) + "\n");
utimesSync(packPath, atime, mtime);
console.log(beta
  ? `${packPath}: β ${beta.value} (raw ${beta.raw} ± ${beta.standardError}, R² ${beta.r2}, ${beta.observations} weeks)`
  : `${packPath}: only ${stats.nWeeks} weekly returns — no measured beta; the SIC proxy applies`);
