/**
 * enrich.ts — forward-path capture of the two data items the moat/composite layers
 * need but the vendor tearsheet does not carry: per-year goodwill and SBC (SEC
 * companyconcept, aligned by period end) and peer multiples (Yahoo quoteSummary). Run
 * after facts:build via facts:enrich; scripts/backfill-sec-series.ts re-stamps the
 * goodwill/SBC series on existing packs with the same logic.
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

/** One fact from an SEC companyconcept `units.<unit>` array. Duration facts carry `start`; instants only `end`. */
export interface ConceptEntry {
  start?: string;
  end: string;
  val: number;
  accn?: string;
  fy?: number | null;
  fp?: string | null;
  form: string;
  filed?: string;
  frame?: string;
}

const DAY_MS = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;
const shiftYears = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
};
const ANNUAL_MIN_DAYS = 330, ANNUAL_MAX_DAYS = 380;
/** 52/53-week years put a fiscal-year end within a week of its calendar anniversary; 20 days is ample. */
const FYE_TOLERANCE_DAYS = 20;

/**
 * Align a companyconcept series to a pack's fiscal-year labels by the PERIOD END date — not by the
 * `fy` field, which is the fiscal year of the filing that reported the fact (a 10-K re-reports prior
 * years under its own `fy`, and January filers' `fy` lags the period). Pure.
 *
 * - Only annual facts: form 10-K / 10-K/A, fp "FY"; duration facts must span 330–380 days.
 * - Deduped by `end`: the latest `filed` wins (amendments and restatements).
 * - `anchor` is the pack's filing period end (`filing.periodEnd`). The last label is the most recent
 *   fiscal year ending at or before it; each earlier label is one year earlier. A label takes the fact
 *   whose `end` falls within 20 days of that year's expected end (52/53-week drift), so a missing year
 *   leaves a null rather than shifting the series. If the latest fiscal year's 10-K is absent from the
 *   feed, the expected ends are rolled forward so the newest label stays null instead of taking last year's value.
 */
export function alignAnnualSeries(entries: ConceptEntry[], fiscalYears: string[], anchor: string): (number | null)[] {
  const annual = entries.filter((e) =>
    (e.form === "10-K" || e.form === "10-K/A") && e.fp === "FY" && typeof e.end === "string" && num(e.val) &&
    (e.start == null || (days(e.start, e.end) >= ANNUAL_MIN_DAYS && days(e.start, e.end) <= ANNUAL_MAX_DAYS)));
  if (!annual.length || !fiscalYears.length) return fiscalYears.map(() => null);

  // Dedupe by period end — latest filed wins; on a filed-date tie the later entry in the feed wins.
  const byEnd = new Map<string, ConceptEntry>();
  for (const e of annual) {
    const prev = byEnd.get(e.end);
    if (!prev || (e.filed ?? "") >= (prev.filed ?? "")) byEnd.set(e.end, e);
  }

  // Fiscal-year ends: the latest period end each 10-K reports (its balance-sheet date / year end).
  // For an instant concept this excludes comparatives and mid-year instants (e.g. an acquisition date).
  const fyeByFiling = new Map<string, string>();
  for (const e of annual) {
    const key = e.accn ?? `${e.form}|${e.filed ?? ""}|${e.fy ?? ""}`;
    const cur = fyeByFiling.get(key);
    if (!cur || e.end > cur) fyeByFiling.set(key, e.end);
  }
  const fyes = [...new Set(fyeByFiling.values())].filter((d) => d <= anchor).sort();
  if (!fyes.length) return fiscalYears.map(() => null);

  // The latest fiscal year ending at/before the anchor. A 10-K anchor IS a fiscal-year end and a 10-Q
  // anchor is a quarter end ~3–9 months after one, so a gap of 350+ days means a later year has closed
  // whose 10-K the feed lacks: roll the expected end forward so that label stays null.
  let lastEnd = fyes[fyes.length - 1];
  while (days(lastEnd, anchor) >= 350) lastEnd = shiftYears(lastEnd, 1);

  const ends = [...byEnd.keys()];
  const n = fiscalYears.length;
  return fiscalYears.map((_, i) => {
    const expected = shiftYears(lastEnd, i - (n - 1));
    let best: string | null = null;
    for (const end of ends) {
      const gap = Math.abs(days(expected, end));
      if (gap <= FYE_TOLERANCE_DAYS && (best == null || gap < Math.abs(days(expected, best)))) best = end;
    }
    return best == null ? null : byEnd.get(best)!.val;
  });
}

/** Fill the nulls of `primary` from `fallback`, recording which concept supplied each year. Pure. */
export function mergeConceptSeries(
  primary: { concept: string; values: (number | null)[] },
  fallback: { concept: string; values: (number | null)[] },
): { values: (number | null)[]; concepts: (string | null)[] } {
  const values = primary.values.map((v, i) => v ?? fallback.values[i] ?? null);
  const concepts = primary.values.map((v, i) => (v != null ? primary.concept : fallback.values[i] != null ? fallback.concept : null));
  return { values, concepts };
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

/**
 * SEC companyconcept us-gaap/<concept> → its USD facts. [] when the filer never tagged the concept
 * (404); throws on any other failure so a caller can tell "not tagged" from "request failed".
 *
 * The companyconcept endpoint sometimes serves a hollow body (`"units":{"USD":{}}` — seen for Visa)
 * although the same facts are in companyfacts; in that case the concept is read from companyfacts.
 */
export async function fetchConceptEntries(cik: number, concept: string, contact: string, fetchImpl: FetchLike = fetch): Promise<ConceptEntry[]> {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${padCik(cik)}/us-gaap/${concept}.json`;
  const res = await fetchImpl(url, { headers: { "User-Agent": contact } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`SEC companyconcept ${concept} responded ${res.status} for CIK ${cik}`);
  const body = (await res.json()) as { units?: Record<string, unknown> };
  const usd = body.units?.USD;
  if (Array.isArray(usd)) return usd as ConceptEntry[];
  if (usd == null) return [];
  const facts = (await fetchCompanyFacts(cik, contact, fetchImpl)) as { facts?: Record<string, Record<string, { units?: Record<string, unknown> }>> };
  const fromFacts = facts.facts?.["us-gaap"]?.[concept]?.units?.USD;
  return Array.isArray(fromFacts) ? (fromFacts as ConceptEntry[]) : [];
}

/** SEC companyconcept us-gaap/Goodwill → a per-fiscal-year series aligned to `fiscalYears` (see alignAnnualSeries). */
export async function fetchGoodwillSeries(cik: number, fiscalYears: string[], anchor: string, contact: string, fetchImpl: FetchLike = fetch) {
  return alignAnnualSeries(await fetchConceptEntries(cik, "Goodwill", contact, fetchImpl), fiscalYears, anchor);
}

export const SBC_CONCEPT = "ShareBasedCompensation";
export const SBC_FALLBACK_CONCEPT = "AllocatedShareBasedCompensationExpense";

/**
 * Per-fiscal-year SBC aligned to `fiscalYears`: us-gaap/ShareBasedCompensation (the cash-flow add-back),
 * with any year it leaves null filled from AllocatedShareBasedCompensationExpense (the expense note) —
 * fetched only when needed. `concepts[i]` names the concept that supplied year i.
 */
export async function fetchSbcSeries(cik: number, fiscalYears: string[], anchor: string, contact: string, fetchImpl: FetchLike = fetch, pause: () => Promise<unknown> = async () => {}) {
  const primary = { concept: SBC_CONCEPT, values: alignAnnualSeries(await fetchConceptEntries(cik, SBC_CONCEPT, contact, fetchImpl), fiscalYears, anchor) };
  if (primary.values.every((v) => v != null)) return { values: primary.values, concepts: primary.values.map(() => SBC_CONCEPT) as (string | null)[] };
  await pause();
  const fallback = { concept: SBC_FALLBACK_CONCEPT, values: alignAnnualSeries(await fetchConceptEntries(cik, SBC_FALLBACK_CONCEPT, contact, fetchImpl), fiscalYears, anchor) };
  return mergeConceptSeries(primary, fallback);
}

type Provenance = { field: string; source: "fmp" | "bigdata" | "edgar" | "yahoo" | "shibui"; endpoint: string; capturedAt: string };

/**
 * Record on the pack which years' SBC came from the fallback concept: replaces any earlier "sbc"
 * provenance entry, and adds one only when the fallback supplied a value (the primary concept is
 * the default the schema documents). Mutates.
 */
export function stampSbcProvenance(pack: { statements: { fiscalYears: string[] }; provenance?: Provenance[] }, concepts: (string | null)[], capturedAt: string): void {
  if (!pack.provenance) return;
  pack.provenance = pack.provenance.filter((p) => p.field !== "sbc");
  const fallbackYears = pack.statements.fiscalYears.filter((_, i) => concepts[i] === SBC_FALLBACK_CONCEPT);
  if (!fallbackYears.length) return;
  const primaryYears = pack.statements.fiscalYears.filter((_, i) => concepts[i] === SBC_CONCEPT);
  pack.provenance.push({
    field: "sbc", source: "edgar", capturedAt,
    endpoint: `companyconcept us-gaap/${SBC_FALLBACK_CONCEPT} (${fallbackYears.join(", ")})` +
      (primaryYears.length ? `; us-gaap/${SBC_CONCEPT} (${primaryYears.join(", ")})` : ""),
  });
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
  filing: { periodEnd: string };
  statements: { fiscalYears: string[] };
  peers?: { ticker: string; pe: number | null; ps: number | null; evToEbitda: number | null }[];
  goodwill?: (number | null)[];
  sbc?: (number | null)[];
  provenance?: Provenance[];
}

/** Stamp goodwill, SBC + peer multiples onto a freshly-built pack (mutates and returns it). */
export async function enrichPack<T extends EnrichablePack>(pack: T, contact: string, fetchImpl: FetchLike = fetch, now: () => Date = () => new Date()): Promise<T> {
  // The three fetches are independent (two or three SEC requests — well under its 10 req/s — and
  // Yahoo's peer loop), so they run concurrently; results are applied in the original order, keeping
  // the pack's key order (goodwill before sbc) and therefore the written JSON unchanged. A failed SEC
  // request leaves that series unstamped rather than failing the enrichment.
  const { fiscalYears } = pack.statements;
  const anchor = pack.filing.periodEnd;
  const none = () => fiscalYears.map(() => null);
  const [goodwill, sbc, multiples] = await Promise.all([
    fetchGoodwillSeries(pack.cik, fiscalYears, anchor, contact, fetchImpl).catch(none),
    fetchSbcSeries(pack.cik, fiscalYears, anchor, contact, fetchImpl).catch(() => ({ values: none(), concepts: none() })),
    pack.peers?.length ? fetchPeerMultiples(pack.peers.map((p) => p.ticker), fetchImpl) : null,
  ]);
  if (goodwill.some((g) => g != null)) pack.goodwill = goodwill;
  if (sbc.values.some((s) => s != null)) {
    pack.sbc = sbc.values;
    stampSbcProvenance(pack, sbc.concepts, now().toISOString());
  }

  if (pack.peers?.length && multiples) {
    for (const p of pack.peers) {
      const m = multiples[p.ticker];
      if (m) Object.assign(p, m);
    }
  }
  return pack;
}
