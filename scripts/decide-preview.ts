/**
 * decide-preview.ts — the full stack (6.md): for every published report, read its
 * persisted E/R conviction, run the gate (5.md), moat (3.md) and intrinsic (4.md)
 * layers from the FactPack, and compose them with decide(). Shows the safe-default
 * label (== today's E/R rule), the conviction tier, and what hard gate-enforcement
 * WOULD change — so the effect of turning the policy on is visible. Read-only.
 *
 *   node --import tsx scripts/decide-preview.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Desk } from "../lib/synth/desk.schema";
import type { Conviction } from "../lib/synth/conviction";
import { evaluateGates, classifySector } from "../lib/synth/gates";
import { moatRead, moatApplicable, costOfEquity } from "../lib/synth/moat";
import { MACRO } from "../lib/synth/macro";
import { intrinsicRead, dcfApplicable } from "../lib/synth/intrinsic";
import { compositeScore } from "../lib/synth/composite";
import { decide, SAFE_DEFAULTS } from "../lib/synth/decide";
import { uncertaintyTier, segmentHHI } from "../lib/synth/uncertainty";

const DATA = "data";
const cfg = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8"))).rating;

function latestFactPack(ticker: string): string | null {
  const dir = join(DATA, "facts", ticker);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  return join(dir, files.map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f);
}

const rows: string[][] = [];
let enforceChanges = 0;

for (const file of readdirSync(DATA).filter((f) => f.endsWith(".json")).sort()) {
  const ticker = file.replace(/\.json$/, "").toUpperCase();
  const fp = latestFactPack(ticker);
  if (!fp) continue;
  const report = JSON.parse(readFileSync(join(DATA, file), "utf8")) as {
    rating?: { label?: string; conviction?: Conviction };
  };
  const conviction = report.rating?.conviction;
  if (!report.rating?.label || !conviction) continue;

  const pack = JSON.parse(readFileSync(fp, "utf8"));
  const gate = evaluateGates(pack);
  const moat = moatApplicable(pack).ok ? moatRead(pack) : null;
  const intrinsic = dcfApplicable(pack).ok
    ? intrinsicRead(pack, { r: costOfEquity(pack, MACRO), terminalGrowth: 0.03, horizon: 10 })
    : null;
  const composite = compositeScore(pack);
  const a = pack.analysts;
  const disp = a && a.highTarget != null && a.lowTarget != null && a.medianTarget ? (a.highTarget - a.lowTarget) / a.medianTarget : null;
  const netDebtRow = pack.statements.balance.find((r: { key: string }) => r.key === "netDebt")?.values;
  const u = uncertaintyTier({
    dispersion: disp, sic: pack.sic ?? null, netDebtToEbitda: pack.ttm.netDebtToEbitda,
    netDebtor: typeof netDebtRow?.at(-1) === "number" && netDebtRow.at(-1) > 0,
    fiscalYears: pack.statements.fiscalYears.length,
    abstentions: (moat ? 0 : 1) + (intrinsic ? 0 : 1) + (composite.percentile == null ? 1 : 0),
    segmentHHI: segmentHHI(pack.segments.items), sector: classifySector(pack),
  });
  const inputs = { conviction, gate, moat, intrinsic, composite, market: { targetDispersion: disp }, uncertainty: { tier: u.tier } };

  const safe = decide(inputs, cfg, SAFE_DEFAULTS);
  const enforced = decide(inputs, cfg, { ...SAFE_DEFAULTS, enforceGate: true, requireCorroboration: true, applyMoatFloor: true, applyUncertaintyBands: true });
  if (enforced.label !== safe.label) enforceChanges++;

  const moatStr = moat ? `${moat.width}${moat.contingent ? "*" : ""}/${moat.trend[0]}` : "—";
  const mos = intrinsic ? `${intrinsic.marginOfSafety * 100 >= 0 ? "+" : ""}${(intrinsic.marginOfSafety * 100).toFixed(0)}%` : "—";
  const comp = composite.percentile != null ? `${composite.percentile.toFixed(0)}pctl` : "—";
  rows.push([
    ticker,
    report.rating.label,
    safe.proposed,
    `${safe.conviction} ${safe.tier}`,
    enforced.label === safe.label ? "(same)" : `${safe.label} → ${enforced.label}`,
    gate.ceiling === "STRONG BUY" ? "—" : gate.ceiling,
    u.tier,
    moatStr,
    mos,
    comp,
  ]);
}

const head = ["TICKER", "PUBLISHED", "E/R", "CONVICTION", "IF ENFORCED", "GATE-CEIL", "UNCERT", "MOAT", "MoS", "COMPOSITE"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");

console.log("\nFull-stack decision preview (6.md) — SAFE DEFAULTS (advisory) — read-only\n");
console.log(fmt(head));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log(
  `\nUnder SAFE DEFAULTS the label always equals the E/R rule (${rows.length} unchanged).`,
);
console.log(`Under FULL enforcement (gates + corroboration + moat floor + uncertainty bands), ${enforceChanges} label(s) would change.`);
console.log("UNCERT = uncertainty tier (low/medium/high/veryHigh). MOAT: WIDE/NARROW/NONE (*=contingent) + trend initial. MoS from the reverse DCF.\n");
