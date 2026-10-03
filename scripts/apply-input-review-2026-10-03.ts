/**
 * apply-input-review-2026-10-03.ts — one-off: apply the FactPack corrections from
 * docs/superpowers/specs/2026-10-03-crosscheck-input-review.md that SEC tags alone can't supply.
 *   - FOUR: capitalized software is untagged in XBRL; capex/FCF FY23–FY25 and TTM FCF ($311M, which matches
 *     the company's own FCF reconciliation) come from the 10-K/10-Q cash-flow statements.
 *   - BAM: actuals moved from fee revenue to the GAAP revenue basis the consensus estimates use.
 * Run after scripts/backfill-capex-extras.ts. Idempotent; mtimes and format preserved.
 *
 *   node --import tsx scripts/apply-input-review-2026-10-03.ts
 */
import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";

const at = "2026-10-03T00:00:00.000Z";
type Row = { key: string; values: (number | null)[] };
type Pack = { statements: { fiscalYears: string[]; cashflow: Row[]; income: Row[] }; ttm: Record<string, number | null>; latestQuarter: Record<string, unknown>; quote: { marketCap: number }; provenance: { field: string; source: string; endpoint: string; capturedAt: string }[] };

function edit(path: string, fn: (p: Pack) => void) {
  const { atime, mtime } = statSync(path);
  const pack = JSON.parse(readFileSync(path, "utf8")) as Pack;
  fn(pack);
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  utimesSync(path, atime, mtime);
  console.log(`corrected ${path}`);
}
const setYears = (p: Pack, section: "cashflow" | "income", key: string, byYear: Record<string, number>) => {
  const row = p.statements[section].find((r) => r.key === key)!;
  for (const [fy, v] of Object.entries(byYear)) {
    const i = p.statements.fiscalYears.indexOf(fy);
    if (i < 0) throw new Error(`${key}: no ${fy}`);
    row.values[i] = v;
  }
};
const replaceProv = (p: Pack, field: string, entry: { source: string; endpoint: string }) => {
  p.provenance = p.provenance.filter((x) => x.field !== field);
  p.provenance.push({ field, ...entry, capturedAt: at });
};

edit("data/facts/FOUR/0001794669-26-000045.json", (p) => {
  setYears(p, "cashflow", "capex", { FY23: -136e6, FY24: -173e6, FY25: -234e6 });
  setYears(p, "cashflow", "freeCashFlow", { FY23: 210e6, FY24: 327e6, FY25: 400e6 });
  p.ttm.fcfYield = 311e6 / p.quote.marketCap;
  replaceProv(p, "ttm.fcfYield", { source: "edgar", endpoint: "companyfacts TTM to 2026-06-30 (FY25 + H1'26 − H1'25): NetCashProvidedByUsedInOperatingActivities 593 − (PaymentsToAcquirePropertyPlantAndEquipment 20 + PaymentsToAcquireEquipmentOnLease 140 + capitalized software 122 [untagged; 10-K 0001794669-26-000010 and 10-Q 0001794669-26-000045 cash-flow statements]) = $311M ÷ quote.marketCap; matches the company's FCF reconciliation (8-K ex. 99.1, Q2'26). Replaces OCF − PP&E only." });
  replaceProv(p, "statements.cashflow.capex", { source: "edgar", endpoint: "10-K 0001794669-26-000010 cash-flow statement: PP&E + equipment to be leased + capitalized software development costs (FY23–FY25); FY21–FY22 include the tagged equipment-on-lease and software lines only (capitalized software for those years unverified)" });
});

edit("data/facts/BAM/0001628280-26-054933.json", (p) => {
  p.latestQuarter.revenue = 1_753_000_000;
  p.latestQuarter.revenueYoY = 0.608256880733945;
  setYears(p, "income", "revenue", { FY23: 4_062e6, FY24: 3_980e6, FY25: 4_817e6 });
  p.ttm.ps = p.quote.marketCap / 5_737e6;
  p.ttm.netMargin = 3_065 / 5_737;
  replaceProv(p, "latestQuarter.revenue", { source: "edgar", endpoint: "companyfacts us-gaap:Revenues 2026-04-01→2026-06-30 = $1,753M (10-Q 0001628280-26-054933). Vendor value $1,047M was base management & advisory fees ($919M) + incentive fees ($128M) only; replaced so actuals share the GAAP basis of consensus estimates. Annual revenue FY23–FY25 from 10-K 0001628280-26-013098; ttm.ps and ttm.netMargin recomputed on GAAP TTM revenue $5,737M." });
  replaceProv(p, "ttm.fcfYield", { source: "edgar", endpoint: "verified vs companyfacts TTM to 2026-06-30: NetCashProvidedByUsedInOperatingActivities 2,341 − PaymentsToAcquireOtherPropertyPlantAndEquipment 22 = $2,319M. Shibui fcfTtm −232 sums net cash from INVESTING activities — Shibui mapping error, not adopted." });
});
