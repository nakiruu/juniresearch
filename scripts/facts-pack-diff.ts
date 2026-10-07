/**
 * facts-pack-diff.ts — read-only before/after of two FactPack files (the same ticker and accession): balance-sheet
 * rows per fiscal year, the latest quarter, every TTM field, the Shibui diffs, and the fundamental gate on each.
 *
 *   node --import tsx scripts/facts-pack-diff.ts <before.json> <after.json>
 */
import { readFileSync } from "node:fs";
import { evaluateGates, type GateFacts } from "../lib/synth/gates";
import { crosscheckGate } from "../lib/synth/crosscheck-gate";
import type { ShibuiCheck, CrosscheckOverride } from "../lib/facts/shibui-check";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: node --import tsx scripts/facts-pack-diff.ts <before.json> <after.json>"); process.exit(2); }
type Row = { key: string; values: (number | null)[] };
type Pack = GateFacts & {
  quote: { price: number; asOf: string; marketCap: number };
  latestQuarter: Record<string, unknown> | null;
  ttm: Record<string, number | null>;
  statements: { fiscalYears: string[]; balance: Row[]; income: Row[]; cashflow: Row[] };
  shibuiCheck?: ShibuiCheck;
  crosscheckOverrides?: CrosscheckOverride[];
};
const before = JSON.parse(readFileSync(a, "utf8")) as Pack, after = JSON.parse(readFileSync(b, "utf8")) as Pack;
const m = (x: number | null | undefined) => (x == null ? "—" : Math.abs(x) >= 1e6 ? `${(x / 1e6).toFixed(0)}M` : String(Math.round(x * 1000) / 1000));
let changed = 0;
const line = (label: string, x: unknown, y: unknown) => {
  const same = JSON.stringify(x) === JSON.stringify(y);
  if (!same) changed++;
  console.log(`${same ? "  " : "! "}${label.padEnd(40)} ${String(x).padEnd(22)} ${y}`);
};

console.log(`quote: price ${before.quote.price} → ${after.quote.price}; asOf ${before.quote.asOf} → ${after.quote.asOf}  (must be unchanged under --keep-quote)`);
for (const sec of ["balance", "income", "cashflow"] as const)
  for (const key of ["totalDebt", "cashAndInvestments", "netDebt", "totalEquity", "revenue", "ebitda", "capex", "freeCashFlow"]) {
    const r1 = before.statements[sec].find((r) => r.key === key), r2 = after.statements[sec].find((r) => r.key === key);
    if (!r1 && !r2) continue;
    after.statements.fiscalYears.forEach((fy, i) => line(`${sec}.${key}[${fy}]`, m(r1?.values[i]), m(r2?.values[i])));
  }
for (const k of ["periodEnd", "revenue", "revenueYoY", "operatingMargin"]) line(`latestQuarter.${k}`, before.latestQuarter?.[k], after.latestQuarter?.[k]);
for (const k of Object.keys({ ...before.ttm, ...after.ttm })) line(`ttm.${k}`, m(before.ttm[k]), m(after.ttm[k]));
const sc = (p: Pack) => (p.shibuiCheck?.diffs ?? []).map((d) => `${d.level} ${d.field} ${(d.relDiff * 100).toFixed(0)}%`).join("; ") || "(none)";
line("shibuiCheck", sc(before), sc(after));
const g1 = evaluateGates(before), g2 = evaluateGates(after);
line("gate.sector", g1.sector, g2.sector);
line("gate.distress", `${g1.distress.zone} ${g1.distress.reasons.join("; ")}`, `${g2.distress.zone} ${g2.distress.reasons.join("; ")}`);
line("gate.ceiling/confidence", `${g1.ceiling} ${g1.confidence}`, `${g2.ceiling} ${g2.confidence}`);
line("crosscheckGate.blocked", crosscheckGate(before).blocked, crosscheckGate(after).blocked);
console.log(`\n${changed} field(s) differ.`);
