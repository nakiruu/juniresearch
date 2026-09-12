import { edgarJson, type FetchLike } from "./client";

export const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;

/** One-time lookup at watchlist:add time; detection never needs the 800KB map. */
export async function resolveCik(ticker: string, contact: string, fetchImpl: FetchLike = fetch): Promise<{ cik: number; title: string }> {
  const map = await edgarJson<TickerMap>(TICKER_MAP_URL, contact, fetchImpl);
  const want = ticker.toUpperCase();
  const hit = Object.values(map).find((e) => e.ticker.toUpperCase() === want);
  if (!hit) throw new Error(`Ticker ${ticker} not found in ${TICKER_MAP_URL}`);
  return { cik: hit.cik_str, title: hit.title };
}
