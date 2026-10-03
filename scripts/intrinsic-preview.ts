/**
 * intrinsic-preview.ts — run the reverse-DCF engine (lib/synth/intrinsic.ts) over
 * every published FactPack and show the market-implied vs achievable growth gap,
 * the base-case fair value, the margin of safety, and the mechanical expected
 * upside E it would hand conviction.ts. Read-only. Demonstrator for 4.md.
 *
 *   node --import tsx scripts/intrinsic-preview.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { latestFactPack } from "../lib/synth/latest-factpack";
import { intrinsicRead, dcfApplicable, inputCheckStatus, type IntrinsicFacts } from "../lib/synth/intrinsic";
import { costOfEquity } from "../lib/synth/moat";
import { MACRO } from "../lib/synth/macro";

const DATA = "data";

const g = (x: number) => `${x * 100 >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
const usd = (x: number) => `$${x.toFixed(0)}`;
const rows: string[][] = [];

for (const file of readdirSync(DATA).filter((f) => f.endsWith(".json")).sort()) {
  const ticker = file.replace(/\.json$/, "").toUpperCase();
  const fp = latestFactPack(DATA, ticker)?.path;
  if (!fp) continue;
  const report = JSON.parse(readFileSync(join(DATA, file), "utf8")) as { rating?: { label?: string } };
  if (!report.rating?.label) continue;

  const facts = JSON.parse(readFileSync(fp, "utf8")) as IntrinsicFacts;
  const applicable = dcfApplicable(facts);
  if (!applicable.ok) {
    rows.push([ticker, usd(facts.quote.price), "—", "—", "—", "—", "—", "—", "—", "—", "—", inputCheckStatus(facts), report.rating.label, `abstained: ${applicable.reason}`]);
    continue;
  }
  const r = intrinsicRead(facts, { r: costOfEquity(facts, MACRO), terminalGrowth: 0.03, horizon: 10 });
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
    `${g(r.mosRange.min)}..${g(r.mosRange.max)}`,
    `${(r.discountRate * 100).toFixed(1)}%`,
    g(mechE),
    inputCheckStatus(facts),
    report.rating.label,
    r.flags.filter((x) => x.startsWith("input check")).join("; "),
  ]);
}

const head = ["TICKER", "PRICE", "OWN-ERN", "IMPL g", "ACH g", "GAP", "BASE FV", "MoS", "MoS RANGE", "r", "MECH E", "CHECK", "PUBLISHED", "NOTE"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");

console.log("\nIntrinsic-value / reverse-DCF preview (r = cost of equity per name, gt=3%, N=10, growth faded to gt) — read-only\n");
console.log(fmt(head));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log("\nGAP = market-implied minus achievable owner-earnings growth (large + = priced for a lot).");
console.log("MoS = base-case fair value vs price. MoS RANGE = min..max over r ± 1pt × base growth ± 2pt.");
console.log("CHECK = pack inputs vs Shibui (— none, ok ≤10%, warn ≤25%, FAIL >25%; a FAIL on cap/shares/fcf abstains).");
console.log("IMPL g / ACH g are STARTING growth rates, faded linearly to gt by year 10. MECH E = prob-weighted mechanical fair value vs price.\n");
