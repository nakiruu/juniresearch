/**
 * yahoo.ts — daily closes for the chart's history line.
 * -----------------------------------------------------------------------------
 * Keyless, unofficial. The raw response is saved verbatim as yahoo-history.json;
 * map/history.ts parses it. If this endpoint ever breaks, the chart falls back
 * to its labelled placeholder — nothing else in the pipeline depends on it.
 */
export type FetchLike = typeof fetch;

const toUnix = (ymd: string) => Math.floor(new Date(ymd + "T00:00:00Z").getTime() / 1000);

export function yahooChartUrl(ticker: string, from: string, to: string): string {
  const p1 = toUnix(from), p2 = toUnix(to) + 86400; // period2 is exclusive
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d`;
}

export async function fetchDailyCloses(ticker: string, from: string, to: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const url = yahooChartUrl(ticker, from, to);
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status} for ${url}`);
  return res.text();
}
