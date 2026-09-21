/**
 * backfill-goodwill.ts — one-off: stamp per-fiscal-year Goodwill onto FactPacks so
 * the moat engine can read an ex-goodwill ROIC for asset-heavy acquirers (3.md §8).
 * Reads each pack's CIK, pulls the small us-gaap/Goodwill companyconcept feed, aligns
 * the annual (10-K, FY) values to the pack's fiscalYears, and writes `goodwill` after
 * `sicDescription`. Companies that tag no goodwill are left untouched.
 *
 *   node --import tsx scripts/backfill-goodwill.ts
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FACTS = "data/facts";
const UA = "juniper-research goodwill-backfill nzubulidis@gmail.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dirs = readdirSync(FACTS).filter((d) => statSync(join(FACTS, d)).isDirectory());
let updated = 0;

for (const t of dirs) {
  for (const file of readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json"))) {
    const path = join(FACTS, t, file);
    const pack = JSON.parse(readFileSync(path, "utf8"));
    const cik = String(pack.cik).padStart(10, "0");
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/Goodwill.json`, { headers: { "User-Agent": UA } });
    await sleep(120);
    if (!res.ok) {
      console.log(`  ${t}/${file}: no Goodwill concept (${res.status}) — left as is`);
      continue;
    }
    const body = (await res.json()) as { units?: Record<string, { fy?: number; val: number; form: string; fp: string }[]> };
    const usd = Array.isArray(body.units?.USD) ? body.units!.USD : [];
    const byFy: Record<number, number> = {};
    for (const u of usd) if (u.form === "10-K" && u.fp === "FY" && u.fy != null) byFy[u.fy] = u.val; // last (latest amendment) wins

    const goodwill = (pack.statements.fiscalYears as string[]).map((fy) => byFy[2000 + Number(fy.slice(2))] ?? null);
    if (goodwill.every((g) => g == null)) {
      console.log(`  ${t}/${file}: no annual goodwill in the covered years — left as is`);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit/reposition
    const { schemaVersion, ticker, cik: c, company, exchange, sic, sicDescription, goodwill: _old, ...rest } = pack;
    const out = {
      schemaVersion, ticker, cik: c, company, exchange,
      ...(sic != null ? { sic } : {}), ...(sicDescription != null ? { sicDescription } : {}),
      goodwill, ...rest,
    };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    updated++;
    console.log(`  ${t}/${file}: goodwill ${goodwill.map((g) => (g == null ? "—" : `$${(g / 1e9).toFixed(1)}B`)).join(" ")}`);
  }
}

console.log(`\nBackfilled goodwill on ${updated} FactPack(s).`);
