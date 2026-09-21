/**
 * gates-preview.ts — run the fundamental gates (lib/synth/gates.ts) over every
 * published FactPack and show what the gate layer would do to the standing
 * rating. Read-only: it touches no report and writes nothing. This is the
 * prototype's end-to-end demonstrator for docs/scoreconcepts/5.md.
 *
 *   node --import tsx scripts/gates-preview.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateGates, applyGateCeiling, type GateFacts } from "../lib/synth/gates";
import type { RatingLabel } from "../lib/synth/judgment.schema";

const DATA = "data";
const FACTS = join(DATA, "facts");

interface ReportRating {
  label: RatingLabel;
  conviction?: { expectedUpside: number; rewardRisk: number | null; derivedLabel: RatingLabel };
}

/** Newest FactPack json for a ticker (some tickers carry more than one accession). */
function latestFactPack(ticker: string): { path: string; multi: boolean } | null {
  const dir = join(FACTS, ticker);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  const newest = files
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0].f;
  return { path: join(dir, newest), multi: files.length > 1 };
}

const pct = (x: number | null | undefined) => (x == null ? "  —  " : `${(x * 100 >= 0 ? "+" : "")}${(x * 100).toFixed(0)}%`);
const rr = (x: number | null | undefined) => (x == null ? " — " : x.toFixed(2));

const rows: string[][] = [];
let capped = 0;

const reportFiles = readdirSync(DATA)
  .filter((f) => f.endsWith(".json"))
  .sort();

for (const file of reportFiles) {
  const ticker = file.replace(/\.json$/, "").toUpperCase();
  const fp = latestFactPack(ticker);
  if (!fp) continue; // not a report file (no matching FactPack)

  const report = JSON.parse(readFileSync(join(DATA, file), "utf8")) as { rating?: ReportRating };
  if (!report.rating?.label) continue;

  const facts = JSON.parse(readFileSync(fp.path, "utf8")) as GateFacts;
  const g = evaluateGates(facts);
  const published = report.rating.label;
  const gated = applyGateCeiling(published, g.ceiling);
  const changed = gated !== published;
  if (changed) capped++;

  rows.push([
    ticker + (fp.multi ? "*" : ""),
    published,
    `${pct(report.rating.conviction?.expectedUpside)} / ${rr(report.rating.conviction?.rewardRisk)}`,
    `${g.piotroski.score}/9`,
    g.distress.zone,
    g.accruals.flag ?? "—",
    g.ceiling === "STRONG BUY" ? "—" : g.ceiling,
    changed ? `${published} → ${gated}` : "(no change)",
    g.confidence,
  ]);
}

const head = ["TICKER", "PUBLISHED", "E / R", "PIOTR", "DISTRESS", "ACCR", "GATE CEIL", "GATED RESULT", "CONF"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");

console.log("\nFundamental-gate preview — read-only, over every published FactPack\n");
console.log(fmt(head));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log(
  `\n${rows.length} reports scanned · ${capped} would be capped by a gate · ${rows.length - capped} unchanged.`,
);
console.log("* = ticker has more than one captured FactPack; newest used.\n");
