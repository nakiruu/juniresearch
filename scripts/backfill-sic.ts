/**
 * backfill-sic.ts — one-off: stamp SEC SIC onto FactPacks captured before SIC
 * was persisted (facts-prepare now writes it going forward). Reads each pack's
 * CIK, fetches the SEC submissions feed, and writes `sic`/`sicDescription` in
 * place, right after `exchange`, matching the build writer's formatting.
 *
 *   node --import tsx scripts/backfill-sic.ts
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FACTS = "data/facts";
const UA = "juniper-research sic-backfill nzubulidis@gmail.com"; // SEC requires a descriptive contact UA
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dirs = readdirSync(FACTS).filter((d) => statSync(join(FACTS, d)).isDirectory());
let updated = 0;

for (const t of dirs) {
  const files = readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const path = join(FACTS, t, file);
    const pack = JSON.parse(readFileSync(path, "utf8"));
    const cik = String(pack.cik).padStart(10, "0");
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`  ${t}/${file}: SEC ${res.status} — skipped`);
      continue;
    }
    const body = (await res.json()) as { sic?: string; sicDescription?: string };
    const sic = body.sic && body.sic !== "" ? Number(body.sic) : null;
    const sicDescription = body.sicDescription || null;
    if (sic == null) {
      console.error(`  ${t}/${file}: no SIC on submissions feed — skipped`);
      continue;
    }

    // Rebuild with sic/sicDescription right after exchange; drop any prior values (idempotent).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit
    const { schemaVersion, ticker, cik: c, company, exchange, sic: _s, sicDescription: _d, ...rest } = pack;
    const out = { schemaVersion, ticker, cik: c, company, exchange, sic, sicDescription, ...rest };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    updated++;
    console.log(`  ${t}/${file}: sic ${sic} (${sicDescription})`);
    await sleep(120); // stay well under SEC's ~10 req/s
  }
}

console.log(`\nBackfilled SIC on ${updated} FactPack(s).`);
