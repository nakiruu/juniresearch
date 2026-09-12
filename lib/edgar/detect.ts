import type { Filing } from "./submissions";

export interface WatchEntry { ticker: string; cik: number }
export type SeenState = Record<string, string[]>;
export type NewFiling = Filing & { ticker: string };

/** Pure: which of each ticker's filings has not been seen. Newest first, capped. */
export function detectNew(filingsByTicker: Record<string, Filing[]>, seen: SeenState, limit = 4): NewFiling[] {
  const out: NewFiling[] = [];
  for (const [ticker, filings] of Object.entries(filingsByTicker)) {
    const done = new Set(seen[ticker] ?? []);
    for (const f of filings.filter((x) => !done.has(x.accession)).slice(0, limit)) out.push({ ...f, ticker });
  }
  return out;
}

export function markSeen(seen: SeenState, filings: NewFiling[]): SeenState {
  const next: SeenState = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]]));
  for (const f of filings) (next[f.ticker] ??= []).push(f.accession);
  return next;
}
