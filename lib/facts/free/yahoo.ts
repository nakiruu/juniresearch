/**
 * Yahoo Finance `quoteSummary` client + parser.
 *
 * Fetches via the crumb flow (fc.yahoo.com cookie → getcrumb → query2
 * quoteSummary) and parses the six requested modules into a `YahooData`
 * object: price, market cap, 52-week range, description, analyst targets,
 * rating breakdown, and forward estimates.
 *
 * See docs/superpowers/specs/2026-09-16-sec-yahoo-free-factsource-design.md
 * ("Yahoo quoteSummary map") for the field map this file implements.
 */
import type { FetchLike } from "../../edgar/client";

export interface YahooEstimate {
  fiscal_year: number;
  sales: number | null;
  eps: number | null;
}

export interface YahooData {
  price: number;
  marketCap: number;
  companyName: string;
  exchange: string;
  description: string;
  week52Low: number;
  week52High: number;
  dividendYield: number;
  targets: { consensus: number; median: number; high: number; low: number };
  ratings: {
    strong_buy: number;
    buy: number;
    hold: number;
    sell: number;
    strong_sell: number;
    consensus: string;
  };
  estimates: YahooEstimate[];
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MODULES = "price,summaryDetail,financialData,earningsTrend,recommendationTrend,assetProfile";

const YAHOO_CRUMB_FAILED_MESSAGE =
  "Yahoo quoteSummary unavailable (crumb step failed); retry later or top up Bigdata.";
const YAHOO_QUOTE_FAILED_MESSAGE =
  "Yahoo quoteSummary unavailable (quoteSummary request failed); retry later or top up Bigdata.";

/** Fetches quoteSummary for `ticker` via the crumb flow. Returns the parsed JSON body. */
export async function fetchQuoteSummary(ticker: string, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const cookieRes = await fetchImpl("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
  const cookie = (cookieRes.headers.get("set-cookie") || "").split(";")[0];

  const crumbRes = await fetchImpl("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, Cookie: cookie },
  });
  const crumb = await crumbRes.text();

  if (crumbRes.status !== 200 || crumb.includes("<") || crumb.trim().length === 0) {
    throw new Error(YAHOO_CRUMB_FAILED_MESSAGE);
  }

  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}` +
    `?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
  const quoteRes = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Cookie: cookie } });

  if (!quoteRes.ok) {
    throw new Error(YAHOO_QUOTE_FAILED_MESSAGE);
  }

  return quoteRes.json();
}

// --- quoteSummary JSON shape (loose; only the fields we read) ---------

interface RawValue {
  raw?: number;
}

interface QuoteSummaryResult {
  price?: {
    regularMarketPrice?: RawValue;
    marketCap?: RawValue;
    longName?: string;
    shortName?: string;
    exchangeName?: string;
  };
  summaryDetail?: {
    fiftyTwoWeekLow?: RawValue;
    fiftyTwoWeekHigh?: RawValue;
    dividendYield?: RawValue;
    trailingAnnualDividendYield?: RawValue;
  };
  financialData?: {
    targetMeanPrice?: RawValue;
    targetMedianPrice?: RawValue;
    targetHighPrice?: RawValue;
    targetLowPrice?: RawValue;
    recommendationKey?: string;
  };
  recommendationTrend?: {
    trend?: Array<{ strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number }>;
  };
  earningsTrend?: {
    trend?: Array<{
      period?: string;
      endDate?: string;
      revenueEstimate?: { avg?: RawValue };
      earningsEstimate?: { avg?: RawValue };
    }>;
  };
  assetProfile?: {
    longBusinessSummary?: string;
  };
}

interface QuoteSummaryShape {
  quoteSummary?: { result?: QuoteSummaryResult[] };
}

// --- helpers ------------------------------------------------------------

function rawVal(x: RawValue | undefined): number | null {
  return x?.raw ?? null;
}

// Yahoo's exchange codes ("NMS", "NGM", "NYQ", ...) alongside already-spelled-out names
// ("NYSE") observed in real quoteSummary responses. Normalize the codes; pass through
// (uppercased) anything else so an unmapped exchange still renders sensibly.
function normalizeExchange(exchangeName: string | undefined): string {
  const v = (exchangeName || "").toUpperCase();
  if (v === "NMS" || v === "NGM") return "NASDAQ";
  if (v === "NYQ") return "NYSE";
  return v;
}

function titleCase(recommendationKey: string | undefined): string {
  if (!recommendationKey) return "";
  return recommendationKey
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function endDateYear(endDate: string | undefined): number | null {
  if (!endDate) return null;
  const year = new Date(endDate).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

// earningsTrend.trend[] mixes quarterly entries (period "0q", "+1q", ...) and annual
// entries (period "0y", "+1y", ...) that can share the same calendar-year endDate as a
// quarterly entry (e.g. a Q4 quarter and the full fiscal year both ending 2026-12-31).
// Filtering by endDate year alone would let a single quarter's figures masquerade as the
// full-year estimate, so only "*y" periods are eligible for fiscal-year estimates.
const ANNUAL_PERIOD = /^[-+]?\d+y$/;

// --- parser ---------------------------------------------------------------

export function parseQuoteSummary(raw: unknown, opts: { latestFY: number }): YahooData {
  const result = (raw as QuoteSummaryShape)?.quoteSummary?.result?.[0] ?? {};
  const price = result.price ?? {};
  const summaryDetail = result.summaryDetail ?? {};
  const financialData = result.financialData ?? {};
  const assetProfile = result.assetProfile ?? {};

  const priceValue = rawVal(price.regularMarketPrice);
  const marketCap = rawVal(price.marketCap);
  const week52Low = rawVal(summaryDetail.fiftyTwoWeekLow);
  const week52High = rawVal(summaryDetail.fiftyTwoWeekHigh);
  const targets = {
    consensus: rawVal(financialData.targetMeanPrice),
    median: rawVal(financialData.targetMedianPrice),
    high: rawVal(financialData.targetHighPrice),
    low: rawVal(financialData.targetLowPrice),
  };

  if (
    priceValue === null ||
    marketCap === null ||
    week52Low === null ||
    week52High === null ||
    targets.consensus === null ||
    targets.median === null ||
    targets.high === null ||
    targets.low === null
  ) {
    throw new Error(
      "Yahoo quoteSummary missing required fields (price, marketCap, 52-week range, or analyst targets); refusing to fabricate them.",
    );
  }

  const trend = result.recommendationTrend?.trend?.[0] ?? {};
  const ratings = {
    strong_buy: trend.strongBuy ?? 0,
    buy: trend.buy ?? 0,
    hold: trend.hold ?? 0,
    sell: trend.sell ?? 0,
    strong_sell: trend.strongSell ?? 0,
    consensus: titleCase(financialData.recommendationKey),
  };

  const wantedYears = new Set([opts.latestFY + 1, opts.latestFY + 2]);
  const estimates: YahooEstimate[] = [];
  const seenYears = new Set<number>();
  for (const entry of result.earningsTrend?.trend ?? []) {
    if (!entry.period || !ANNUAL_PERIOD.test(entry.period)) continue;
    const year = endDateYear(entry.endDate);
    if (year === null || !wantedYears.has(year) || seenYears.has(year)) continue;
    seenYears.add(year);
    estimates.push({
      fiscal_year: year,
      sales: rawVal(entry.revenueEstimate?.avg),
      eps: rawVal(entry.earningsEstimate?.avg),
    });
  }

  return {
    price: priceValue,
    marketCap,
    companyName: price.longName ?? price.shortName ?? "",
    exchange: normalizeExchange(price.exchangeName),
    description: assetProfile.longBusinessSummary ?? "",
    week52Low,
    week52High,
    dividendYield: rawVal(summaryDetail.dividendYield) ?? rawVal(summaryDetail.trailingAnnualDividendYield) ?? 0,
    targets: {
      consensus: targets.consensus,
      median: targets.median,
      high: targets.high,
      low: targets.low,
    },
    ratings,
    estimates,
  };
}
