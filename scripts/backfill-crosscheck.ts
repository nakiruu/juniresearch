/**
 * backfill-crosscheck.ts — one-off: stamp a Shibui cross-check (lib/facts/shibui-check.ts) onto every FactPack.
 *
 *   node --import tsx scripts/backfill-crosscheck.ts --query           # print one batched Shibui query
 *   node --import tsx scripts/backfill-crosscheck.ts --apply <file>    # stamp from the saved response
 *
 * Each pack is checked at its own quote date and latest quarter end (point-in-time).
 * File mtimes are preserved: latestFactPack picks a ticker's newest pack by mtime.
 */
import { readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CROSSCHECK_USER_PROMPT, buildShibuiCheck, crossCheckKey, crossCheckQuery, crossCheckTarget,
  parseCrossCheckResponse, stampShibuiCheck,
} from "../lib/facts/shibui-check";

const FACTS = "data/facts";
const [flag, file] = process.argv.slice(2);

const packs = readdirSync(FACTS)
  .filter((d) => statSync(join(FACTS, d)).isDirectory())
  .flatMap((t) => readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json")).map((f) => join(FACTS, t, f)))
  .sort();

if (flag === "--query") {
  const targets = packs.map((p) => crossCheckTarget(JSON.parse(readFileSync(p, "utf8"))));
  console.log(JSON.stringify({ tool: "stock_data_query", params: { query: crossCheckQuery(targets), user_prompt: CROSSCHECK_USER_PROMPT } }, null, 2));
} else if (flag === "--apply" && file) {
  const rows = new Map(parseCrossCheckResponse(readFileSync(file, "utf8")).map((r) => [crossCheckKey(r.ticker, r.asOf, r.periodEnd), r]));
  const capturedAt = statSync(file).mtime.toISOString();
  let flagged = 0, sbc = 0;
  for (const p of packs) {
    const pack = JSON.parse(readFileSync(p, "utf8"));
    const t = crossCheckTarget(pack);
    const row = rows.get(crossCheckKey(t.ticker, t.asOf, t.periodEnd));
    const check = buildShibuiCheck(pack, row);
    const { atime, mtime } = statSync(p);
    stampShibuiCheck(pack, check, capturedAt);
    writeFileSync(p, JSON.stringify(pack, null, 2) + "\n");
    utimesSync(p, atime, mtime);
    const bad = check.diffs.filter((d) => d.level !== "ok");
    if (bad.length) flagged++;
    if (check.sbcTtm != null) sbc++;
    const note = !row?.symbol ? "not in Shibui" : bad.map((d) => `${d.level} ${d.field} ${d.pack.toPrecision(4)} vs ${d.shibui.toPrecision(4)} (${(d.relDiff * 100).toFixed(1)}%)`).join("; ") || "ok";
    console.log(`  ${p}: ${check.diffs.length} compared, sbcTtm ${check.sbcTtm ?? "n/a"} — ${note}`);
  }
  console.log(`\nCross-checked ${packs.length} FactPack(s): ${flagged} with a warn/fail diff, ${sbc} with Shibui TTM SBC.`);
} else {
  console.error("usage: backfill-crosscheck.ts --query | --apply <saved-response.json>");
  process.exit(2);
}
