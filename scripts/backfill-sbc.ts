/**
 * backfill-sbc.ts — one-off: stamp per-fiscal-year stock-based compensation onto
 * FactPacks so the intrinsic engine can charge it to owner earnings (8.md). Same
 * pattern as backfill-goodwill; facts:enrich captures it going forward. Filers
 * that tag no SBC (e.g. AT&T) are left untouched.
 *
 *   node --import tsx scripts/backfill-sbc.ts
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fetchSbcSeries } from "../lib/facts/enrich";

const FACTS = "data/facts";
const UA = "juniper-research sbc-backfill nzubulidis@gmail.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dirs = readdirSync(FACTS).filter((d) => statSync(join(FACTS, d)).isDirectory());
let updated = 0;

for (const t of dirs) {
  for (const file of readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json"))) {
    const path = join(FACTS, t, file);
    const pack = JSON.parse(readFileSync(path, "utf8"));
    const sbc = await fetchSbcSeries(pack.cik, pack.statements.fiscalYears, UA);
    await sleep(120);
    if (!sbc.some((s) => s != null)) {
      console.log(`  ${t}/${file}: no ShareBasedCompensation tagged — left as is`);
      continue;
    }
    // Place sbc right after goodwill (or after sicDescription/exchange) to match the built shape.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit/reposition
    const { schemaVersion, ticker, cik, company, exchange, sic, sicDescription, goodwill, sbc: _old, ...rest } = pack;
    const out = {
      schemaVersion, ticker, cik, company, exchange,
      ...(sic != null ? { sic } : {}), ...(sicDescription != null ? { sicDescription } : {}),
      ...(goodwill != null ? { goodwill } : {}), sbc,
      ...rest,
    };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    updated++;
    console.log(`  ${t}/${file}: sbc ${sbc.map((s) => (s == null ? "—" : `$${(s / 1e9).toFixed(1)}B`)).join(" ")}`);
  }
}

console.log(`\nBackfilled SBC on ${updated} FactPack(s).`);
