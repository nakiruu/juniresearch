/**
 * enrich.ts — forward-path capture of the two data items the moat/composite layers
 * need but the vendor tearsheet does not carry: per-year goodwill (SEC companyfacts)
 * and peer multiples (Yahoo quoteSummary). Run after facts:build via facts:enrich;
 * the one-off backfill scripts stamped the existing packs with the same logic.
 *
 * Contact discipline: the SEC contact (EDGAR_CONTACT) is used ONLY for the SEC
 * request; Yahoo gets a generic browser UA, never the SEC contact.
 */
type FetchLike = typeof fetch;

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) juniper-research";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const rawVal = (x: { raw?: unknown } | undefined): number | null => (x && num(x.raw) ? x.raw : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PeerMultiples {
  pe: number | null;
  ps: number | null;
  evToEbitda: number | null;
}

// --- pure helpers (unit-tested) ---------------------------------------------

interface GoodwillEntry {
  fy?: number;
  val: number;
  form: string;
  fp: string;
}

/** Align annual (10-K / FY) goodwill values to a pack's fiscal-year labels; null where absent. */
export function alignGoodwill(usd: GoodwillEntry[], fiscalYears: string[]): (number | null)[] {
  const byFy: Record<number, number> = {};
  for (const u of usd) if (u.form === "10-K" && u.fp === "FY" && u.fy != null) byFy[u.fy] = u.val; // last (latest amendment) wins
  return fiscalYears.map((fy) => byFy[2000 + Number(fy.slice(2))] ?? null);
}

interface QuoteSummaryResult {
  summaryDetail?: { trailingPE?: { raw?: unknown }; priceToSalesTrailing12Months?: { raw?: unknown } };
  defaultKeyStatistics?: { enterpriseToEbitda?: { raw?: unknown } };
}

/** Extract the three peer multiples from a Yahoo quoteSummary result object. */
export function parsePeerMultiples(result: QuoteSummaryResult | undefined): PeerMultiples {
  return {
    pe: rawVal(result?.summaryDetail?.trailingPE),
    ps: rawVal(result?.summaryDetail?.priceToSalesTrailing12Months),
    evToEbitda: rawVal(result?.defaultKeyStatistics?.enterpriseToEbitda),
  };
}

// --- network fetchers (fetch injectable for tests) --------------------------

/** SEC companyconcept us-gaap/Goodwill → a per-fiscal-year series aligned to `fiscalYears`. */
export async function fetchGoodwillSeries(cik: number, fiscalYears: string[], contact: string, fetchImpl: FetchLike = fetch): Promise<(number | null)[]> {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/Goodwill.json`;
  const res = await fetchImpl(url, { headers: { "User-Agent": contact } });
  if (!res.ok) return fiscalYears.map(() => null);
  const body = (await res.json()) as { units?: Record<string, GoodwillEntry[]> };
  const usd = Array.isArray(body.units?.USD) ? body.units!.USD : [];
  return alignGoodwill(usd, fiscalYears);
}

/** Yahoo quoteSummary (summaryDetail + defaultKeyStatistics) for each ticker, via the crumb flow. */
export async function fetchPeerMultiples(tickers: string[], fetchImpl: FetchLike = fetch): Promise<Record<string, PeerMultiples>> {
  const out: Record<string, PeerMultiples> = {};
  const unique = [...new Set(tickers)];
  if (!unique.length) return out;

  const ck = await fetchImpl("https://fc.yahoo.com", { headers: { "User-Agent": YAHOO_UA } });
  const cookie = (ck.headers.get("set-cookie") || "").split(";")[0];
  const cr = await fetchImpl("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": YAHOO_UA, Cookie: cookie } });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Yahoo crumb step failed");

  for (const t of unique) {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}` +
      `?modules=summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": YAHOO_UA, Cookie: cookie } });
      const result = (await res.json())?.quoteSummary?.result?.[0];
      out[t] = parsePeerMultiples(result);
    } catch {
      out[t] = { pe: null, ps: null, evToEbitda: null };
    }
    await sleep(300);
  }
  return out;
}

interface EnrichablePack {
  cik: number;
  statements: { fiscalYears: string[] };
  peers?: { ticker: string; pe: number | null; ps: number | null; evToEbitda: number | null }[];
  goodwill?: (number | null)[];
}

/** Stamp goodwill + peer multiples onto a freshly-built pack (mutates and returns it). */
export async function enrichPack<T extends EnrichablePack>(pack: T, contact: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const goodwill = await fetchGoodwillSeries(pack.cik, pack.statements.fiscalYears, contact, fetchImpl);
  if (goodwill.some((g) => g != null)) pack.goodwill = goodwill;

  if (pack.peers?.length) {
    const multiples = await fetchPeerMultiples(pack.peers.map((p) => p.ticker), fetchImpl);
    for (const p of pack.peers) {
      const m = multiples[p.ticker];
      if (m) Object.assign(p, m);
    }
  }
  return pack;
}
