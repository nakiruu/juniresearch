import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderManifest, requiredRawFiles, type CaptureContext } from "../lib/facts/manifest";

const [ticker, accession, flag] = process.argv.slice(2);
if (!ticker || !accession) { console.error("usage: npm run facts:manifest -- <TICKER> <ACCESSION> [--check]"); process.exit(2); }
const dir = join("data", "raw", ticker.toUpperCase(), accession);
const filing = JSON.parse(readFileSync(join(dir, "edgar-filing.json"), "utf8")) as { periodEnd: string; company: string };

const ctx: CaptureContext = { ticker: ticker.toUpperCase(), company: filing.company, periodEnd: filing.periodEnd,
  today: new Date().toISOString().slice(0, 10) };
const peersFile = join(dir, "fmp-peers.json"), entityFile = join(dir, "bigdata-entity.json");
if (existsSync(peersFile)) {
  const raw = JSON.parse(readFileSync(peersFile, "utf8"));
  const list: unknown[] = Array.isArray(raw) ? raw : raw.data ?? raw.peersList ?? [];
  ctx.peers = list.map((p) => (typeof p === "string" ? p : (p as { symbol: string }).symbol)).filter(Boolean);
}
if (existsSync(entityFile)) {
  const raw = JSON.parse(readFileSync(entityFile, "utf8"));
  const first = (Array.isArray(raw) ? raw : raw.results ?? raw.data ?? [])[0] as { id?: string; listing_type?: string } | undefined;
  if (first?.id) { ctx.rpEntityId = first.id; ctx.companyType = first.listing_type === "PRIVATE" ? "Private" : "Public"; }
}

if (flag === "--check") {
  const missing = requiredRawFiles(ctx).filter((f) => !existsSync(join(dir, f)));
  if (missing.length) { console.error("Missing raw files:\n  " + missing.join("\n  ")); process.exit(1); }
  console.log(`All ${requiredRawFiles(ctx).length} raw files present in ${dir}`);
} else {
  console.log(JSON.stringify({ dir, phase2Ready: Boolean(ctx.peers && ctx.rpEntityId), calls: renderManifest(ctx) }, null, 2));
}
