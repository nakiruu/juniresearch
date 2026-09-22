/**
 * facts-enrich.ts — forward-path capture: stamp goodwill (SEC) and peer multiples
 * (Yahoo) onto a freshly-built FactPack. Run after facts:build:
 *
 *   npm run facts:enrich -- <TICKER> <ACCESSION>
 *
 * Idempotent; re-running refreshes the values. The one-off backfill scripts did
 * this for the existing packs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { enrichPack } from "../lib/facts/enrich";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) {
  console.error("usage: npm run facts:enrich -- <TICKER> <ACCESSION>");
  process.exit(2);
}
const ticker = tickerArg.toUpperCase();
const path = join("data", "facts", ticker, `${accession}.json`);
if (!existsSync(path)) {
  console.error(`Missing ${path} — run facts:build first`);
  process.exit(2);
}

const pack = JSON.parse(readFileSync(path, "utf8"));
await enrichPack(pack, requireContact());

// Reposition goodwill right after sicDescription to match the built/backfilled shape.
const { schemaVersion, ticker: tk, cik, company, exchange, sic, sicDescription, goodwill, ...rest } = pack;
const out = {
  schemaVersion, ticker: tk, cik, company, exchange,
  ...(sic != null ? { sic } : {}), ...(sicDescription != null ? { sicDescription } : {}),
  ...(goodwill != null ? { goodwill } : {}),
  ...rest,
};
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");

const filledPeers = (pack.peers ?? []).filter((p: { pe: number | null }) => p.pe != null).length;
console.log(`Enriched ${path}\n  goodwill ${goodwill ? "captured" : "none"} · ${filledPeers}/${pack.peers?.length ?? 0} peers populated`);
