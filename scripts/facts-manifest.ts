import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderManifest, requiredRawFiles, PHASE_INPUT_FILES, type CaptureContext } from "../lib/facts/manifest";

const [ticker, accession, flag] = process.argv.slice(2);
if (!ticker || !accession) { console.error("usage: npm run facts:manifest -- <TICKER> <ACCESSION> [--check]"); process.exit(2); }
const dir = join("data", "raw", ticker.toUpperCase(), accession);
const filing = JSON.parse(readFileSync(join(dir, "edgar-filing.json"), "utf8")) as { periodEnd: string; company: string };

const ctx: CaptureContext = { ticker: ticker.toUpperCase(), company: filing.company, periodEnd: filing.periodEnd,
  today: new Date().toISOString().slice(0, 10) };
const entityFile = join(dir, PHASE_INPUT_FILES[0]);
if (existsSync(entityFile)) {
  const raw = JSON.parse(readFileSync(entityFile, "utf8")) as unknown;
  const top = Array.isArray(raw) ? raw[0] : raw;
  const list = ((top as { results?: unknown[]; data?: unknown[] })?.results
    ?? (top as { data?: unknown[] })?.data
    ?? (Array.isArray(raw) ? raw : [])) as { id?: string; listing_type?: string }[];
  const first = list[0];
  if (first?.id) { ctx.rpEntityId = first.id; ctx.companyType = first.listing_type === "PRIVATE" ? "Private" : "Public"; }
}

if (flag === "--check") {
  const phase2Ready = Boolean(ctx.rpEntityId && ctx.companyType);
  if (!phase2Ready) { console.error(`Phase 2 unresolved for ${dir}: ${PHASE_INPUT_FILES[0]} is missing or yields no id — cannot check the full raw file set.`); process.exit(1); }
  const PRESS_FILE = "edgar-press-release.html";
  const PRESS_MISSING_FILE = "edgar-press-release.missing";
  const missing = requiredRawFiles(ctx).filter((f) => {
    if (existsSync(join(dir, f))) return false;
    if (f === PRESS_FILE && existsSync(join(dir, PRESS_MISSING_FILE))) return false;
    return true;
  });
  if (missing.length) { console.error("Missing raw files:\n  " + missing.join("\n  ")); process.exit(1); }
  const notes: string[] = [];
  if (!existsSync(join(dir, PRESS_FILE)) && existsSync(join(dir, PRESS_MISSING_FILE))) {
    const reason = readFileSync(join(dir, PRESS_MISSING_FILE), "utf8").trim();
    notes.push(`press release: missing (${reason})`);
  }
  console.log(`All ${requiredRawFiles(ctx).length} raw files present in ${dir}` + (notes.length ? "\n  " + notes.join("\n  ") : ""));
} else {
  console.log(JSON.stringify({ dir, phase2Ready: Boolean(ctx.rpEntityId && ctx.companyType), calls: renderManifest(ctx) }, null, 2));
}
