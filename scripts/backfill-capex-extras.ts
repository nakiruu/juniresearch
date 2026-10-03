/**
 * backfill-capex-extras.ts — add the capex a filer tags apart from PP&E (CAPEX_EXTRA in lib/facts/free/sec.ts:
 * capitalized software, equipment bought to lease out) to SEC-built FactPacks, which were captured when the
 * free path counted PP&E only. For each pack whose statements came from SEC (provenance "statements" source
 * edgar):
 *   - statements.cashflow capex −= the year's extras, freeCashFlow −= the same (aligned by period end);
 *   - ttm.fcfYield = SEC TTM (OCF − all capex) / quote.marketCap when SEC carries the pack's latest quarter.
 * Vendor-built packs are left alone (their capex definition is the vendor's). Idempotent: a pack carrying the
 * "statements.cashflow.capex" provenance line written here is skipped. mtimes and format are preserved.
 *
 *   EDGAR_CONTACT="name email" node --import tsx scripts/backfill-capex-extras.ts [--dry]
 */
import { readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireContact } from "./_env";
import { alignAnnualSeries, secTtmFcf, type ConceptEntry } from "../lib/facts/enrich";
import { CAPEX_ALL_IN, CAPEX_EXTRA, CAPEX_RAW, fetchCompanyFacts } from "../lib/facts/free/sec";

const FACTS = "data/facts";
const MARK = "capex incl. CAPEX_EXTRA";
const dry = process.argv.includes("--dry");
const contact = requireContact();
const now = new Date().toISOString();
type Row = { key: string; values: (number | null)[] };
type Prov = { field: string; source: string; endpoint: string; capturedAt: string };

const packs = readdirSync(FACTS).filter((d) => statSync(join(FACTS, d)).isDirectory())
  .flatMap((t) => readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json")).map((f) => join(FACTS, t, f))).sort();
let changed = 0;
for (const path of packs) {
  const pack = JSON.parse(readFileSync(path, "utf8"));
  const prov: Prov[] = pack.provenance ?? [];
  if (prov.find((p) => p.field === "statements")?.source !== "edgar") continue;
  if (prov.some((p) => p.field === "statements.cashflow.capex" && p.endpoint.includes(MARK))) continue;
  const facts = (await fetchCompanyFacts(pack.cik, contact)) as { facts?: { "us-gaap"?: Record<string, { units?: { USD?: ConceptEntry[] } }> } };
  await new Promise((r) => setTimeout(r, 130));
  const g = facts.facts?.["us-gaap"] ?? {};
  const fy: string[] = pack.statements.fiscalYears;
  const align = (c: string) => alignAnnualSeries(g[c]?.units?.USD ?? [], fy, pack.filing.periodEnd);
  const base = CAPEX_RAW.map(align);
  const allInIdx = CAPEX_RAW.indexOf(CAPEX_ALL_IN);
  const extras = fy.map(() => 0);
  const used = new Set<string>();
  for (const c of CAPEX_EXTRA) align(c).forEach((v, i) => {
    const idx = base.findIndex((s) => s[i] != null);
    if (v && idx >= 0 && idx !== allInIdx) { extras[i] += v; used.add(c); }
  });
  const capex = (pack.statements.cashflow as Row[]).find((r) => r.key === "capex");
  const fcf = (pack.statements.cashflow as Row[]).find((r) => r.key === "freeCashFlow");
  const pe = pack.latestQuarter?.periodEnd;
  const ttm = pe ? secTtmFcf(facts, pe) : null;
  const ttmOk = ttm != null && ttm.asOf === pe && pack.quote?.marketCap > 0 && used.size > 0;
  if (!extras.some((x) => x) && !ttmOk) continue;
  const before = { capex: capex?.values.slice(), fcf: fcf?.values.slice(), y: pack.ttm.fcfYield };
  extras.forEach((x, i) => {
    if (!x) return;
    if (capex && capex.values[i] != null) capex.values[i] = (capex.values[i] as number) - x;
    if (fcf && fcf.values[i] != null) fcf.values[i] = (fcf.values[i] as number) - x;
  });
  if (ttmOk) pack.ttm.fcfYield = ttm!.fcf / pack.quote.marketCap;
  pack.provenance = prov.filter((p) => !(p.field === "statements.cashflow.capex" && p.endpoint.includes(MARK)));
  pack.provenance.push({ field: "statements.cashflow.capex", source: "edgar", capturedAt: now,
    endpoint: `${MARK}: companyfacts ${[...used].join(" + ")} added to the PP&E capex (and deducted from freeCashFlow) per fiscal year: ${fy.map((y, i) => `${y} ${(extras[i] / 1e6).toFixed(1)}M`).join(", ")}` });
  if (ttmOk) pack.provenance.push({ field: "ttm.fcfYield", source: "edgar", capturedAt: now,
    endpoint: `TTM to ${pe} (last FY + YTD − prior YTD): operating cash flow − (PP&E + ${[...used].join(" + ")}) / quote.marketCap, SEC companyfacts` });
  changed++;
  const m = (v: number | null | undefined) => (v == null ? "—" : `${(v / 1e6).toFixed(0)}M`);
  console.log(`${path}\n    FCF ${before.fcf?.map(m).join(" ")} → ${fcf?.values.map(m).join(" ")}` +
    (ttmOk ? `\n    fcfYield ${before.y == null ? "—" : (before.y * 100).toFixed(2) + "%"} → ${(pack.ttm.fcfYield * 100).toFixed(2)}%` : ""));
  if (dry) continue;
  const { atime, mtime } = statSync(path);
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  utimesSync(path, atime, mtime);
}
console.log(`\n${dry ? "[dry run] would change" : "Changed"} ${changed} FactPack(s).`);
