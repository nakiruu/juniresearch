/**
 * backfill-beta.ts — one-off: stamp a measured beta (lib/facts/beta.ts) onto every FactPack.
 *
 *   node --import tsx scripts/backfill-beta.ts --query           # print one batched Shibui query
 *   node --import tsx scripts/backfill-beta.ts --apply <file>    # stamp from the saved response
 *
 * Each pack's window ends at its own quote date (point-in-time with the market cap the WACC uses).
 * File mtimes are preserved: latestFactPack picks a ticker's newest pack by mtime.
 */
import { readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { betaQuery, betaUserPrompt, measureBeta, parseBetaResponse, stampBeta } from "../lib/facts/beta";

const FACTS = "data/facts";
const [flag, file] = process.argv.slice(2);

const packs = readdirSync(FACTS)
  .filter((d) => statSync(join(FACTS, d)).isDirectory())
  .flatMap((t) => readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json")).map((f) => join(FACTS, t, f)))
  .sort();
const keyOf = (ticker: string, end: string) => `${ticker}|${end}`;

if (flag === "--query") {
  const rows = new Map<string, { ticker: string; endDate: string }>();
  for (const p of packs) {
    const pack = JSON.parse(readFileSync(p, "utf8"));
    rows.set(keyOf(pack.ticker, pack.quote.asOf), { ticker: pack.ticker, endDate: pack.quote.asOf });
  }
  const list = [...rows.values()];
  console.log(JSON.stringify({ tool: "stock_data_query", params: { query: betaQuery(list), user_prompt: betaUserPrompt(list.map((r) => r.ticker)) } }, null, 2));
} else if (flag === "--apply" && file) {
  const stats = new Map(parseBetaResponse(readFileSync(file, "utf8")).map((s) => [keyOf(s.ticker, s.endDate), s]));
  const capturedAt = statSync(file).mtime.toISOString();
  let measured = 0;
  for (const p of packs) {
    const pack = JSON.parse(readFileSync(p, "utf8"));
    const s = stats.get(keyOf(pack.ticker, pack.quote.asOf));
    const beta = s ? measureBeta(s) : null;
    const { atime, mtime } = statSync(p);
    stampBeta(pack, beta, capturedAt);
    writeFileSync(p, JSON.stringify(pack, null, 2) + "\n");
    utimesSync(p, atime, mtime);
    if (beta) measured++;
    console.log(`  ${p}: ${beta ? `β ${beta.value} (raw ${beta.raw} ± ${beta.standardError}, ${beta.observations}w)` : s ? `only ${s.nWeeks} weeks — SIC proxy` : "no Shibui row — SIC proxy"}`);
  }
  console.log(`\nMeasured beta on ${measured} of ${packs.length} FactPack(s).`);
} else {
  console.error("usage: backfill-beta.ts --query | --apply <saved-response.json>");
  process.exit(2);
}
