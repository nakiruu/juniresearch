import { readRawJson, section } from "../raw";
import type { FactPack, HistoryPoint } from "../schema";
const FILE = "yahoo-history.json";
export const READS = [FILE] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] =
  [{ field: "history", endpoint: "yahoo v8 chart (daily close)", source: "yahoo" }];
export const HISTORY_DAYS = 30;

/** Yahoo's shape: chart.result[0].timestamp[] (unix seconds) aligned with indicators.quote[0].close[]. */
export function mapHistory(dir: string, capturedAt: string): HistoryPoint[] {
  const raw = readRawJson(dir, FILE);
  const result = section<unknown[]>(raw, ["chart", "result"], FILE)[0];
  if (!result) throw new Error(`Empty chart.result in ${FILE}`);
  const ts = section<number[]>(result, ["timestamp"], FILE);
  const quote = section<{ close: (number | null)[] }[]>(result, ["indicators", "quote"], FILE)[0];
  const cutoff = capturedAt.slice(0, 10);
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: quote.close[i] }))
    .filter((p): p is HistoryPoint => typeof p.close === "number" && p.date <= cutoff)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-HISTORY_DAYS);
}
