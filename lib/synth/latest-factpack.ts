/**
 * latest-factpack.ts — the newest captured FactPack for a ticker, by file mtime.
 * -----------------------------------------------------------------------------
 * Some tickers carry more than one accession under data/facts/<TICKER>/; the preview
 * scripts (gates / moat / intrinsic / decide) each read the most recently written one.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Newest `*.json` in `<dataDir>/facts/<ticker>`, and whether there was more than one; null when none. */
export function latestFactPack(dataDir: string, ticker: string): { path: string; multi: boolean } | null {
  const dir = join(dataDir, "facts", ticker);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  const newest = files
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0].f;
  return { path: join(dir, newest), multi: files.length > 1 };
}
