/**
 * moat-preview.ts — run the moat/durability engine (lib/synth/moat.ts) over every
 * published FactPack: the WACC proxy used, the latest ROIC and excess-return
 * spread, incremental ROIC, the Width/Trend verdict, and the bear-depth floor it
 * would feed conviction.ts. Read-only. Demonstrator for 3.md.
 *
 *   node --import tsx scripts/moat-preview.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { moatRead, moatApplicable, type MoatFacts } from "../lib/synth/moat";
import { classifySector } from "../lib/synth/gates";

const DATA = "data";

function latestFactPack(ticker: string): string | null {
  const dir = join(DATA, "facts", ticker);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  return join(dir, files.map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f);
}

const pct = (x: number | null) => (x == null ? "—" : `${x * 100 >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`);
const rows: string[][] = [];

for (const file of readdirSync(DATA).filter((f) => f.endsWith(".json")).sort()) {
  const ticker = file.replace(/\.json$/, "").toUpperCase();
  const fp = latestFactPack(ticker);
  if (!fp) continue;
  const report = JSON.parse(readFileSync(join(DATA, file), "utf8")) as { rating?: { label?: string } };
  if (!report.rating?.label) continue;

  const facts = JSON.parse(readFileSync(fp, "utf8")) as MoatFacts;
  const applicable = moatApplicable(facts);
  if (!applicable.ok) {
    rows.push([ticker, classifySector(facts), "—", "—", "—", "—", "—", "—", "—", report.rating.label, `abstained: ${applicable.reason?.split(":")[0]}`]);
    continue;
  }
  const m = moatRead(facts); // sector-hurdle WACC, tax 21%
  const latest = m.roic.length - 1;
  rows.push([
    ticker,
    classifySector(facts),
    pct(m.wacc),
    pct(m.roic[latest]),
    pct(m.spread[latest]),
    pct(m.incrementalRoic),
    m.width + (m.contingent ? "*" : ""),
    m.trend,
    pct(m.bearFloor),
    report.rating.label,
    "",
  ]);
}

const head = ["TICKER", "SECTOR", "WACC", "ROIC", "SPREAD", "INC-ROIC", "WIDTH", "TREND", "BEAR-FLR", "PUBLISHED", "NOTE"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");

console.log("\nMoat / capital-returns durability preview (sector-hurdle WACC, tax 21%) — read-only\n");
console.log(fmt(head));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log("\nWIDTH* = contingent (rests on incremental economics, not the reported average spread).");
console.log("BEAR-FLR = minimum bear depth this moat justifies, fed to conviction.ts's D.\n");
