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

/** Union per ticker, insertion order kept, no duplicates. Never mutates the input. */
export function markSeen(seen: SeenState, filings: NewFiling[]): SeenState {
  const next: SeenState = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]]));
  for (const f of filings) {
    const list = (next[f.ticker] ??= []);
    if (!list.includes(f.accession)) list.push(f.accession);
  }
  return next;
}

/** Every fetched filing tagged with its ticker — what the CLI marks seen after a run. */
export function flattenFilings(filingsByTicker: Record<string, Filing[]>): NewFiling[] {
  return Object.entries(filingsByTicker).flatMap(([ticker, fs]) => fs.map((f) => ({ ...f, ticker })));
}
