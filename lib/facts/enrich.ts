/**
 * enrich.ts — forward-path capture of the two data items the moat/composite layers
 * need but the vendor tearsheet does not carry: per-year goodwill (SEC companyfacts)
 * and peer multiples (Yahoo quoteSummary). Run after facts:build via facts:enrich;
 * the one-off backfill scripts stamped the existing packs with the same logic.
 *
 * Contact discipline: the SEC contact (EDGAR_CONTACT) is used ONLY for the SEC
 * request; Yahoo gets a generic browser UA, never the SEC contact.
 */
import { sleep, type FetchLike } from "../edgar/client";
import { padCik } from "../edgar/submissions";
import { fetchCompanyFacts, parseCompanyFacts, type SecPeriod } from "./free/sec";

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) juniper-research";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const rawVal = (x: { raw?: unknown } | undefined): number | null => (x && num(x.raw) ? x.raw : null);

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

/** SEC companyconcept for a us-gaap concept → a per-fiscal-year annual series aligned to `fiscalYears`. */
async function fetchConceptSeries(cik: number, concept: string, fiscalYears: string[], contact: string, fetchImpl: FetchLike): Promise<(number | null)[]> {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${padCik(cik)}/us-gaap/${concept}.json`;
  const res = await fetchImpl(url, { headers: { "User-Agent": contact } });
  if (!res.ok) return fiscalYears.map(() => null);
  const body = (await res.json()) as { units?: Record<string, GoodwillEntry[]> };
  const usd = Array.isArray(body.units?.USD) ? body.units!.USD : [];
  return alignGoodwill(usd, fiscalYears);
}

/** SEC companyconcept us-gaap/Goodwill → a per-fiscal-year series aligned to `fiscalYears`. */
export const fetchGoodwillSeries = (cik: number, fiscalYears: string[], contact: string, fetchImpl: FetchLike = fetch) =>
  fetchConceptSeries(cik, "Goodwill", fiscalYears, contact, fetchImpl);

/** SEC companyconcept us-gaap/ShareBasedCompensation → a per-fiscal-year series aligned to `fiscalYears`. */
export const fetchSbcSeries = (cik: number, fiscalYears: string[], contact: string, fetchImpl: FetchLike = fetch) =>
  fetchConceptSeries(cik, "ShareBasedCompensation", fiscalYears, contact, fetchImpl);

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

/**
 * TTM EV/EBITDA from SEC companyfacts, as of a pack's latest quarter: (the pack's capture-time market cap +
 * that quarter's net debt) ÷ the sum of the four discrete quarters' EBITDA ending at it. null when the latest
 * quarter isn't in the SEC series, any of the four EBITDA values or the net debt is missing, or TTM EBITDA is
 * not positive (a multiple on negative EBITDA means nothing). Pure.
 */
export function secEvToEbitda(quarters: Pick<SecPeriod, "report_date" | "ebitda" | "net_debt">[], periodEnd: string, marketCap: number | null): number | null {
  if (!(marketCap != null && marketCap > 0)) return null;
  const last4 = quarters.filter((q) => q.report_date <= periodEnd).sort((a, b) => (a.report_date < b.report_date ? -1 : 1)).slice(-4);
  if (last4.length < 4 || last4[3].report_date !== periodEnd) return null;
  if (last4.some((q) => q.ebitda == null) || last4[3].net_debt == null) return null;
  const ebitda = last4.reduce((a, q) => a + (q.ebitda as number), 0);
  if (!(ebitda > 0)) return null;
  return (marketCap + (last4[3].net_debt as number)) / ebitda;
}

/** SIC 6000–6199 (banks, savings institutions, credit and lending) and 6300–6411 (insurance): EV/EBITDA is left blank. */
export function evToEbitdaNotMeaningful(sic: number | null | undefined): boolean {
  return sic != null && ((sic >= 6000 && sic <= 6199) || (sic >= 6300 && sic <= 6411));
}

type Provenance = { field: string; source: "fmp" | "bigdata" | "edgar" | "yahoo"; endpoint: string; capturedAt: string };

/**
 * Fill a pack's missing TTM EV/EBITDA. First choice: calculated from SEC data (secEvToEbitda). Fallback:
 * Yahoo's enterpriseToEbitda for the subject, fetched now — so it is only as current as this run. Leaves
 * the field null when neither source has a positive value. Records the source in provenance.
 */
export async function fillEvToEbitda(
  pack: { ticker: string; cik: number; sic?: number | null; quote?: { marketCap: number | null }; latestQuarter?: { periodEnd: string } | null; ttm?: { evToEbitda: number | null }; provenance?: Provenance[] },
  contact: string, fetchImpl: FetchLike = fetch, now: () => Date = () => new Date(),
): Promise<"sec" | "yahoo" | null> {
  if (!pack.ttm || pack.ttm.evToEbitda != null) return null;
  if (evToEbitdaNotMeaningful(pack.sic)) return null; // banks, lenders, insurers: debt is operating inventory, so EV/EBITDA is not a valid multiple
  const stamp = (source: Provenance["source"], endpoint: string) => {
    pack.provenance?.push({ field: "ttm.evToEbitda", source, endpoint, capturedAt: now().toISOString() });
  };
  try {
    const periodEnd = pack.latestQuarter?.periodEnd;
    if (periodEnd) {
      const { quarter } = parseCompanyFacts(await fetchCompanyFacts(pack.cik, contact, fetchImpl));
      const v = secEvToEbitda(quarter, periodEnd, pack.quote?.marketCap ?? null);
      if (v != null) {
        pack.ttm.evToEbitda = v;
        stamp("edgar", "derived: (market cap + net debt) / TTM EBITDA (operating income + D&A), SEC companyfacts");
        return "sec";
      }
    }
  } catch { /* fall through to Yahoo */ }
  const y = (await fetchPeerMultiples([pack.ticker], fetchImpl))[pack.ticker]?.evToEbitda ?? null;
  if (y != null && y > 0) {
    pack.ttm.evToEbitda = y;
    stamp("yahoo", "quoteSummary.defaultKeyStatistics.enterpriseToEbitda");
    return "yahoo";
  }
  return null;
}

interface EnrichablePack {
  cik: number;
  statements: { fiscalYears: string[] };
  peers?: { ticker: string; pe: number | null; ps: number | null; evToEbitda: number | null }[];
  goodwill?: (number | null)[];
  sbc?: (number | null)[];
}

/** Stamp goodwill, SBC + peer multiples onto a freshly-built pack (mutates and returns it). */
export async function enrichPack<T extends EnrichablePack>(pack: T, contact: string, fetchImpl: FetchLike = fetch): Promise<T> {
  // The three fetches are independent (two SEC requests — well under its 10 req/s — and Yahoo's
  // peer loop), so they run concurrently; results are applied in the original order, keeping the
  // pack's key order (goodwill before sbc) and therefore the written JSON unchanged.
  const [goodwill, sbc, multiples] = await Promise.all([
    fetchGoodwillSeries(pack.cik, pack.statements.fiscalYears, contact, fetchImpl),
    fetchSbcSeries(pack.cik, pack.statements.fiscalYears, contact, fetchImpl),
    pack.peers?.length ? fetchPeerMultiples(pack.peers.map((p) => p.ticker), fetchImpl) : null,
  ]);
  if (goodwill.some((g) => g != null)) pack.goodwill = goodwill;
  if (sbc.some((s) => s != null)) pack.sbc = sbc;

  if (pack.peers?.length && multiples) {
    for (const p of pack.peers) {
      const m = multiples[p.ticker];
      if (m) Object.assign(p, m);
    }
  }
  return pack;
}
