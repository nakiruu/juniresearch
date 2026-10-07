/**
 * facts-carry-forward.ts — copy enrichment stamps from a previous build of the SAME pack onto a freshly rebuilt one,
 * for a same-quote re-capture (facts:free --keep-quote → facts:build). facts:build writes a pack without the fields
 * facts:enrich / facts:beta / facts:crosscheck add later; re-running those would call SEC and Yahoo again and let peer
 * multiples drift. Carried: goodwill, goodwillRestated, sbc, beta, peer multiples, shibuiCheck, crosscheckOverrides
 * (an owner-accepted Shibui fail survives the rebuild), and the enrich-filled ttm.fcfYield / ttm.evToEbitda — those
 * two ONLY when the rebuilt value is null (the rebuilt SEC figure wins when it exists). Each carried provenance row
 * comes with it. Prints the path each TTM value came from.
 *
 *   node --import tsx scripts/facts-carry-forward.ts <from.json> <data/facts/T/ACC.json>
 *
 * Refuses unless the two packs share ticker, accession, quote date and fiscal-year columns (goodwill and sbc are
 * aligned to those columns).
 */
import { readFileSync, writeFileSync } from "node:fs";

type Prov = { field: string };
const [from, to] = process.argv.slice(2);
if (!from || !to) { console.error("usage: node --import tsx scripts/facts-carry-forward.ts <from.json> <data/facts/T/ACC.json>"); process.exit(2); }
const src = JSON.parse(readFileSync(from, "utf8")), dst = JSON.parse(readFileSync(to, "utf8"));
if (src.ticker !== dst.ticker || src.filing.accession !== dst.filing.accession || src.quote.asOf !== dst.quote.asOf)
  throw new Error("carry-forward needs the same ticker, accession and quote date");
if (JSON.stringify(src.statements.fiscalYears) !== JSON.stringify(dst.statements.fiscalYears))
  throw new Error(`fiscal-year columns changed (${src.statements.fiscalYears} → ${dst.statements.fiscalYears}): goodwill/sbc would misalign — stop and ask`);

// sic drives the gate sector (CME and V carry no SIC in edgar-filing.json; theirs was stamped after the build), so a
// rebuild that lost it keeps the previous one.
const { schemaVersion, ticker, cik, company, exchange, sic: dstSic, sicDescription: dstSicDesc, ...rest } = dst;
const sic = dstSic ?? src.sic, sicDescription = dstSicDesc ?? src.sicDescription;
if (dstSic == null && src.sic != null) console.log(`  sic: rebuilt none → carried ${src.sic}`);
const out: Record<string, unknown> = { schemaVersion, ticker, cik, company, exchange, ...(sic != null ? { sic } : {}), ...(sicDescription != null ? { sicDescription } : {}) };
if (src.goodwill != null) out.goodwill = src.goodwill;
if (src.goodwillRestated != null) out.goodwillRestated = src.goodwillRestated;
if (src.sbc != null) out.sbc = src.sbc;
Object.assign(out, rest);
out.peers = dst.peers.map((p: { ticker: string }) => src.peers.find((q: { ticker: string }) => q.ticker === p.ticker) ?? p);
for (const f of ["beta", "shibuiCheck", "crosscheckOverrides"]) if (src[f] != null) out[f] = src[f];

const carriedProv = new Set(["goodwill", "sbc", "beta", "shibuiCheck", "peers"]);
const ttmCarried: string[] = [];
const ttm = out.ttm as Record<string, number | null>;
for (const f of ["fcfYield", "evToEbitda"] as const) {
  const rebuilt = ttm[f], old = src.ttm[f];
  if (rebuilt == null && old != null) { ttm[f] = old; ttmCarried.push(`ttm.${f}`); console.log(`  ttm.${f}: rebuilt null → carried enrich value ${old}`); }
  else console.log(`  ttm.${f}: rebuilt ${rebuilt} (old ${old})${rebuilt == null ? " — null on both" : " — SEC rebuild wins"}`);
}
// The rebuilt pack's own rows win; a carried row replaces any rebuilt row for the same field (peers, shibuiCheck).
const carried = (src.provenance as Prov[]).filter((p) => carriedProv.has(p.field) || ttmCarried.includes(p.field) || p.field.startsWith("crosscheckOverrides."));
const carriedFields = new Set(carried.map((p) => p.field));
// Keep the previous pack's row order (rows it did not have go last) so the git diff shows only real changes.
const srcOrder = new Map((src.provenance as Prov[]).map((p, i) => [p.field, i] as const));
const rank = (p: Prov) => srcOrder.get(p.field) ?? Number.MAX_SAFE_INTEGER;
out.provenance = [...(dst.provenance as Prov[]).filter((p) => !carriedFields.has(p.field)), ...carried]
  .map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
writeFileSync(to, JSON.stringify(out, null, 2) + "\n");
console.log(`carried ${["goodwill", "goodwillRestated", "sbc", "beta", "shibuiCheck", "crosscheckOverrides"].filter((f) => src[f] != null).join(", ")} + peer multiples${ttmCarried.length ? " + " + ttmCarried.join(", ") : ""} onto ${to}`);
