/**
 * intrinsic-preview.ts — run the reverse-DCF engine (lib/synth/intrinsic.ts) over
 * every published FactPack and show the market-implied vs achievable growth gap,
 * the base-case fair value, the margin of safety, and the mechanical expected
 * upside E it would hand conviction.ts. Read-only. Demonstrator for 4.md.
 *
 *   node --import tsx scripts/intrinsic-preview.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { intrinsicRead, dcfApplicable, type IntrinsicFacts } from "../lib/synth/intrinsic";

const DATA = "data";
const CFG = { r: 0.11, terminalGrowth: 0.03, horizon: 10 };

function latestFactPack(ticker: string): string | null {
  const dir = join(DATA, "facts", ticker);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  return join(dir, files.map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f);
}

const g = (x: number) => `${x * 100 >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
const usd = (x: number) => `$${x.toFixed(0)}`;
const rows: string[][] = [];

for (const file of readdirSync(DATA).filter((f) => f.endsWith(".json")).sort()) {
  const ticker = file.replace(/\.json$/, "").toUpperCase();
  const fp = latestFactPack(ticker);
  if (!fp) continue;
  const report = JSON.parse(readFileSync(join(DATA, file), "utf8")) as { rating?: { label?: string } };
  if (!report.rating?.label) continue;

  const facts = JSON.parse(readFileSync(fp, "utf8")) as IntrinsicFacts;
  const applicable = dcfApplicable(facts);
  if (!applicable.ok) {
    rows.push([ticker, usd(facts.quote.price), "—", "—", "—", "—", "—", "—", "—", report.rating.label, `abstained: ${applicable.reason}`]);
    continue;
  }
  const r = intrinsicRead(facts, CFG);
  const mechFv = r.scenarios.reduce((a, s) => a + s.probability * s.impliedPrice, 0);
  const mechE = mechFv / facts.quote.price - 1;

  rows.push([
    ticker,
    usd(facts.quote.price),
    `$${(r.ownerEarnings / 1e9).toFixed(1)}B`,
    g(r.impliedGrowth),
    g(r.achievableGrowth),
    `${r.gap * 100 >= 0 ? "+" : ""}${(r.gap * 100).toFixed(0)}pt`,
    usd(r.fairValue.base),
    g(r.marginOfSafety),
    g(mechE),
    report.rating.label,
    "",
  ]);
}

const head = ["TICKER", "PRICE", "OWN-ERN", "IMPL g", "ACH g", "GAP", "BASE FV", "MoS", "MECH E", "PUBLISHED", "NOTE"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");

console.log("\nIntrinsic-value / reverse-DCF preview (r=11%, gt=3%, N=10) — read-only\n");
console.log(fmt(head));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log("\nGAP = market-implied minus achievable owner-earnings growth (large + = priced for a lot).");
console.log("MoS = base-case fair value vs price. MECH E = prob-weighted mechanical fair value vs price.\n");
