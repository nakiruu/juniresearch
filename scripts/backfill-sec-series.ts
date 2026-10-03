/**
 * backfill-sec-series.ts — re-stamp the SEC-derived per-fiscal-year series (`goodwill`, `sbc`) on every
 * FactPack with the period-end alignment in lib/facts/enrich.ts (alignAnnualSeries). Replaces the
 * one-off backfill-goodwill / backfill-sbc scripts, which keyed on the companyfacts `fy` (the filing's
 * fiscal year, not the period's) and so dropped or shifted years for January filers.
 *
 *   EDGAR_CONTACT="name email" node --import tsx scripts/backfill-sec-series.ts [--dry]
 *
 * Touches nothing else in a pack (no peer multiples, no enrichPack). A series that comes back all null is
 * removed; a pack whose SEC request fails is left as is. Key order and file mtimes are preserved
 * (latestFactPack picks a ticker's newest pack by mtime). SEC: ≤ 8 requests/second, contact UA only to sec.gov.
 */
import { readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { alignAnnualSeries, restatedYears, fetchConceptEntries, mergeConceptSeries, stampSbcProvenance, SBC_CONCEPT, SBC_FALLBACK_CONCEPT, type ConceptEntry } from "../lib/facts/enrich";

const FACTS = "data/facts";
const dry = process.argv.includes("--dry");
const contact = requireContact();
const MIN_INTERVAL_MS = 130; // ≤ 8 req/s

let last = 0;
const cache = new Map<string, Promise<ConceptEntry[]>>();
const entries = (cik: number, concept: string) => {
  const key = `${cik}|${concept}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const wait = last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fetchConceptEntries(cik, concept, contact);
    })());
  }
  return cache.get(key)!;
};

type Series = (number | null)[];
type Pack = Record<string, unknown> & { ticker: string; cik: number; filing: { periodEnd: string }; statements: { fiscalYears: string[] }; goodwill?: Series; goodwillRestated?: string[]; sbc?: Series; provenance?: { field: string; source: "edgar"; endpoint: string; capturedAt: string }[] };

/** Set (or delete, when null) `key`, keeping its position if present, else inserting it after the first present `after` key. */
function place(pack: Pack, key: string, value: Series | string[] | null, after: string[]): Pack {
  if (value == null) { delete pack[key]; return pack; }
  if (key in pack) { pack[key] = value; return pack; }
  const anchorKey = after.find((k) => k in pack);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pack)) {
    out[k] = v;
    if (k === anchorKey) out[key] = value;
  }
  if (!anchorKey) out[key] = value;
  return out as Pack;
}

const fmt = (s: Series | undefined | null) => (s ? s.map((v) => (v == null ? "—" : (v / 1e9).toFixed(3))).join(" ") : "absent");
const same = (a: Series | undefined | null, b: Series | undefined | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const packs = readdirSync(FACTS)
  .filter((d) => statSync(join(FACTS, d)).isDirectory())
  .flatMap((t) => readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json")).map((f) => join(FACTS, t, f)))
  .sort();

const capturedAt = new Date().toISOString();
let changed = 0, failed = 0;
for (const path of packs) {
  let pack = JSON.parse(readFileSync(path, "utf8")) as Pack;
  const { fiscalYears } = pack.statements;
  const anchor = pack.filing.periodEnd;
  let goodwill: Series, restated: string[], sbc: Series, concepts: (string | null)[];
  try {
    goodwill = alignAnnualSeries(await entries(pack.cik, "Goodwill"), fiscalYears, anchor);
    restated = restatedYears(await entries(pack.cik, "Goodwill"), fiscalYears, anchor);
    const primary = alignAnnualSeries(await entries(pack.cik, SBC_CONCEPT), fiscalYears, anchor);
    const fallback = primary.some((v) => v == null) ? alignAnnualSeries(await entries(pack.cik, SBC_FALLBACK_CONCEPT), fiscalYears, anchor) : primary.map(() => null);
    ({ values: sbc, concepts } = mergeConceptSeries({ concept: SBC_CONCEPT, values: primary }, { concept: SBC_FALLBACK_CONCEPT, values: fallback }));
  } catch (e) {
    failed++;
    console.log(`  ${path}: SEC request failed — left as is (${(e as Error).message})`);
    continue;
  }
  const newGw = goodwill.some((v) => v != null) ? goodwill : null;
  const newSbc = sbc.some((v) => v != null) ? sbc : null;
  const fallbackYears = fiscalYears.filter((_, i) => concepts[i] === SBC_FALLBACK_CONCEPT);
  const provBefore = JSON.stringify(pack.provenance?.filter((p) => p.field === "sbc").map((p) => p.endpoint) ?? []);

  const oldGw = pack.goodwill, oldSbc = pack.sbc, oldRestated = pack.goodwillRestated;
  pack = place(pack, "goodwill", newGw, ["sicDescription", "sic", "exchange"]);
  const newRestated = newGw && restated.length ? restated : null;
  pack = place(pack, "goodwillRestated", newRestated, ["goodwill"]);
  pack = place(pack, "sbc", newSbc, ["goodwill", "sicDescription", "sic", "exchange"]);
  stampSbcProvenance(pack, newSbc ? concepts : fiscalYears.map(() => null), capturedAt);
  const provAfter = JSON.stringify(pack.provenance?.filter((p) => p.field === "sbc").map((p) => p.endpoint) ?? []);

  const restatedChanged = JSON.stringify(oldRestated ?? null) !== JSON.stringify(newRestated);
  const diff = !same(oldGw, newGw) || !same(oldSbc, newSbc) || provBefore !== provAfter || restatedChanged;
  console.log(`${path}  [${fiscalYears.join(" ")}] anchor ${anchor}`);
  if (!same(oldGw, newGw)) console.log(`    goodwill  ${fmt(oldGw)}  →  ${fmt(newGw)}`);
  if (restatedChanged) console.log(`    goodwillRestated  ${oldRestated?.join(" ") ?? "absent"}  →  ${newRestated?.join(" ") ?? "absent"}`);
  if (!same(oldSbc, newSbc)) console.log(`    sbc       ${fmt(oldSbc)}  →  ${fmt(newSbc)}${fallbackYears.length ? `  (Allocated… for ${fallbackYears.join(", ")})` : ""}`);
  if (!diff) continue;
  changed++;
  if (dry) continue;
  const { atime, mtime } = statSync(path);
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  utimesSync(path, atime, mtime);
}

console.log(`\n${dry ? "[dry run] would change" : "Re-stamped"} ${changed} of ${packs.length} FactPack(s); ${failed} left as is after a failed SEC request.`);
