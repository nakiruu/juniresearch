import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFactPack } from "../lib/facts/build";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:build -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const pack = buildFactPack(join("data", "raw", ticker, accession));
const outDir = join("data", "facts", ticker);
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${accession}.json`);
writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
console.log(`Wrote ${out}\n  ${pack.company} · ${pack.filing.form} ${pack.filing.periodEnd} · price ${pack.quote.price} · ${pack.history.length} closes · ${pack.provenance.length} provenance rows`);
