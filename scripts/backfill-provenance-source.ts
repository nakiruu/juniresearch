/**
 * backfill-provenance-source.ts — one-off: correct the provenance of FactPacks whose tearsheet-shaped
 * raw files were written by `npm run facts:free` (SEC XBRL + Yahoo) but were labelled as Bigdata.com
 * by the mappers. Only `provenance` entries change (source + endpoint of the tearsheet rows, via
 * lib/facts/capture-source.ts); every other field, the JSON format and the file mtime are preserved
 * (latestFactPack picks a ticker's newest pack by mtime).
 *
 *   node --import tsx scripts/backfill-provenance-source.ts [--dry-run] [TICKER ...]
 *
 * The producer of each pack's capture is read from data/raw/<TICKER>/<ACCESSION>/ (the facts:free
 * marker, else the emitter's fixed shape). A pack whose raw capture is missing, ambiguous, or does
 * not match the pack (company name) is left unchanged and listed.
 */
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectCaptureSource, provenanceFor } from "../lib/facts/capture-source";
import { FactPack } from "../lib/facts/schema";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = new Set(args.filter((a) => !a.startsWith("--")).map((t) => t.toUpperCase()));

type Row = { field: string; source: string; endpoint: string; capturedAt: string };
const tally = { relabelled: 0, alreadyFree: 0, bigdata: 0, unresolved: [] as string[] };

for (const ticker of readdirSync(join("data", "facts")).sort()) {
  if (only.size && !only.has(ticker)) continue;
  for (const file of readdirSync(join("data", "facts", ticker)).filter((f) => f.endsWith(".json")).sort()) {
    const accession = file.replace(/\.json$/, "");
    const label = `${ticker}/${accession}`;
    const path = join("data", "facts", ticker, file);
    const raw = join("data", "raw", ticker, accession);
    const leave = (why: string) => { tally.unresolved.push(`${label}: ${why}`); console.log(`${label.padEnd(30)} UNCHANGED — ${why}`); };

    if (!existsSync(raw)) { leave(`no raw capture at ${raw}`); continue; }
    let source: "bigdata" | "free";
    try { source = detectCaptureSource(raw); } catch (e) { leave((e as Error).message); continue; }

    const text = readFileSync(path, "utf8");
    const pack = JSON.parse(text) as { company: string; provenance: Row[] };
    const overview = (JSON.parse(readFileSync(join(raw, "bigdata-tearsheet-annual.json"), "utf8")) as { company_overview?: { company_name?: string } }).company_overview;
    if (overview?.company_name !== pack.company) { leave(`pack company "${pack.company}" ≠ raw tearsheet "${overview?.company_name}"`); continue; }

    if (source === "bigdata") { tally.bigdata++; console.log(`${label.padEnd(30)} bigdata  — kept`); continue; }

    const next = provenanceFor(pack.provenance, "free");
    const changed = next.filter((r, i) => r !== pack.provenance[i]);
    if (!changed.length) { tally.alreadyFree++; console.log(`${label.padEnd(30)} free     — already labelled`); continue; }
    const out = { ...pack, provenance: next };
    if (!FactPack.safeParse(out).success) { leave("relabelled pack fails FactPack.safeParse"); continue; }

    const counts = changed.reduce<Record<string, number>>((m, r) => ({ ...m, [r.source]: (m[r.source] ?? 0) + 1 }), {});
    console.log(`${label.padEnd(30)} free     — relabelled ${changed.length} rows (${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")}): ${changed.map((r) => r.field).join(", ")}`);
    tally.relabelled++;
    if (dryRun) continue;
    const { atime, mtime } = statSync(path);
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    utimesSync(path, atime, mtime);
  }
}

console.log(`\n${dryRun ? "[dry run] " : ""}${tally.relabelled} relabelled (facts:free → edgar/yahoo), ${tally.alreadyFree} free already labelled, ${tally.bigdata} Bigdata kept, ${tally.unresolved.length} unchanged (undetermined)`);
for (const u of tally.unresolved) console.log(`  - ${u}`);
