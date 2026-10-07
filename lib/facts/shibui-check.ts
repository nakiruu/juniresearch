/**
 * shibui-check.ts — an independent cross-check of a FactPack's vendor inputs against Shibui Finance.
 * -----------------------------------------------------------------------------
 * The worst reverse-DCF outputs in the audit came from bad vendor inputs, not from the model: FOUR's
 * pack counted only Class A shares (79M vs ~88.6M total), so its market cap was low, and its TTM FCF
 * (fcfYield × marketCap ≈ $0.58B) was about double the independent figure (≈ $0.31B). This compares
 * price, market cap, shares, the latest quarter's revenue and TTM FCF with Shibui's, records each
 * relative difference with an ok / warn / fail level, and carries Shibui's TTM stock-based
 * compensation for the DCF's owner-earnings adjustment.
 *
 * Point-in-time: the price and market cap are Shibui's last values on or before the pack's quote
 * date (at most QUOTE_STALE_DAYS old); the quarters are Shibui's fiscal quarters ending on or before
 * the pack's latest quarter end — with QUARTER_MATCH_DAYS of slack, because 52/53-week filers' period
 * ends can differ by a few days between vendors (a quarter is ~91 days, so the slack never admits the
 * next quarter). TTM = the four most recent such quarters, nulled in code if fewer than four exist,
 * any value is missing, or they do not span one year. A TTM SBC of exactly 0 is treated as missing.
 *
 * Capture: Shibui is reachable only as a Claude connector, so code renders the SQL (`crossCheckQuery`)
 * and the capture step saves the tool's response verbatim (data/raw/<T>/<ACC>/shibui-crosscheck.json,
 * or one batched file under data/raw/_shibui/). The SQL returns raw values; every comparison lives here.
 */

export const CROSSCHECK_FILE = "shibui-crosscheck.json";
/** relDiff ≤ this → ok. */
export const CROSSCHECK_OK = 0.1;
/** relDiff ≤ this → warn; above → fail. */
export const CROSSCHECK_WARN = 0.25;
/** A Shibui fiscal quarter end within this many days of the pack's counts as the same quarter. */
export const QUARTER_MATCH_DAYS = 10;
/** A Shibui close / market cap older than this (calendar days before the quote date) is ignored. */
export const QUOTE_STALE_DAYS = 10;
/** Four consecutive quarter ends span ~273 days (3 quarters); outside this range the TTM has a gap. */
const TTM_SPAN_DAYS = { lo: 250, hi: 300 } as const;

export type CrossCheckField = "price" | "marketCap" | "sharesOutstanding" | "revenueQuarter" | "fcfTtm";
export type CrossCheckLevel = "ok" | "warn" | "fail";

export interface ShibuiCheck {
  asOf: string; // the pack's quote.asOf the check was run against
  quarterEnd: string | null; // Shibui's latest fiscal quarter end used for the TTM sums
  price: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  revenueQuarter: number | null;
  fcfTtm: number | null;
  sbcTtm: number | null;
  diffs: { field: CrossCheckField; pack: number; shibui: number; relDiff: number; level: CrossCheckLevel }[];
  source: "shibui";
}

/** One result row of `crossCheckQuery`, as parsed. */
export interface CrossCheckRow {
  ticker: string;
  asOf: string;
  periodEnd: string;
  symbol: string | null;
  priceDate: string | null;
  close: number | null;
  mcapDate: string | null;
  marketCap: number | null;
  quarterEnd: string | null;
  sharesOutstanding: number | null;
  ttmStart: string | null;
  nQuarters: number;
  nFcf: number;
  fcfTtm: number | null;
  nSbc: number;
  sbcTtm: number | null;
  revQuarterEnd: string | null;
  revenueQuarter: number | null;
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const sqlTicker = (t: string) => {
  if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) throw new Error(`refusing to put ticker ${JSON.stringify(t)} into SQL`);
  return `'${t}'`;
};
const shiftYmd = (ymd: string, days: number) => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

export const crossCheckKey = (ticker: string, asOf: string, periodEnd: string) => `${ticker.toUpperCase()}|${asOf}|${periodEnd}`;

/**
 * The Shibui SQL (DuckDB) for one or more (ticker, asOf, periodEnd) triples — one result row per
 * distinct triple, driven FROM the list so a ticker Shibui lacks still returns a row of nulls.
 * Literal date bounds pre-filter the daily tables before any window function.
 */
export function crossCheckQuery(rows: { ticker: string; asOf: string; periodEnd: string }[]): string {
  if (!rows.length) throw new Error("crossCheckQuery needs at least one (ticker, asOf, periodEnd)");
  for (const r of rows) {
    if (!isYmd(r.asOf)) throw new Error(`bad asOf ${r.asOf} for ${r.ticker}`);
    if (!isYmd(r.periodEnd)) throw new Error(`bad periodEnd ${r.periodEnd} for ${r.ticker}`);
  }
  const uniq = new Map(rows.map((r) => [crossCheckKey(r.ticker, r.asOf, r.periodEnd), r]));
  if (uniq.size > 200) throw new Error("Shibui returns at most 200 rows — split the batch");
  const list = [...uniq.values()];
  const asOfs = list.map((r) => r.asOf).sort();
  const ends = list.map((r) => r.periodEnd).sort();
  const dLo = shiftYmd(asOfs[0], -QUOTE_STALE_DAYS);
  const dHi = asOfs[asOfs.length - 1];
  const qLo = shiftYmd(ends[0], -400); // four quarters back from the earliest quarter end, with room
  const qHi = shiftYmd(ends[ends.length - 1], QUARTER_MATCH_DAYS);
  const values = list
    .map((r) => `(${sqlTicker(r.ticker.toUpperCase())}, DATE '${r.asOf}', DATE '${r.periodEnd}')`)
    .join(", ");
  return `WITH universe(ticker, as_of, period_end) AS (VALUES ${values}),
sym_rank AS (
  SELECT u.ticker, g.symbol,
    ROW_NUMBER() OVER (PARTITION BY u.ticker ORDER BY (g.type = 'Common Stock') DESC, g.has_company_details DESC, g.symbol) AS pick
  FROM (SELECT DISTINCT ticker FROM universe) u JOIN shibui.general_info g ON g.ticker = u.ticker AND g.type <> 'ETF'
),
sym AS (SELECT s.ticker, s.symbol FROM sym_rank s WHERE s.pick = 1),
base AS (
  SELECT u.ticker, u.as_of, u.period_end, s.symbol
  FROM universe u LEFT JOIN sym s ON s.ticker = u.ticker
),
px AS (
  SELECT b.ticker, b.as_of, b.period_end, sq.date AS px_date, sq.close,
    ROW_NUMBER() OVER (PARTITION BY b.ticker, b.as_of, b.period_end ORDER BY sq.date DESC) AS rn
  FROM base b JOIN shibui.stock_quotes sq ON sq.symbol = b.symbol
    AND sq.date <= b.as_of AND sq.date >= b.as_of - INTERVAL '${QUOTE_STALE_DAYS} days'
  WHERE sq.date >= DATE '${dLo}' AND sq.date <= DATE '${dHi}'
),
val AS (
  SELECT b.ticker, b.as_of, b.period_end, v.date AS mcap_date, v.market_cap,
    ROW_NUMBER() OVER (PARTITION BY b.ticker, b.as_of, b.period_end ORDER BY v.date DESC) AS rn
  FROM base b JOIN shibui.valuation v ON v.symbol = b.symbol
    AND v.date <= b.as_of AND v.date >= b.as_of - INTERVAL '${QUOTE_STALE_DAYS} days'
  WHERE v.date >= DATE '${dLo}' AND v.date <= DATE '${dHi}' AND v.market_cap IS NOT NULL
),
fq AS (
  SELECT b.ticker, b.as_of, b.period_end, f.date AS q_end, f.revenue, f.free_cash_flow,
    f.stock_based_compensation, f.shares_outstanding,
    ROW_NUMBER() OVER (PARTITION BY b.ticker, b.as_of, b.period_end ORDER BY f.date DESC) AS rn
  FROM base b JOIN shibui.fundamentals_quarterly f ON f.symbol = b.symbol
    AND f.date <= b.period_end + INTERVAL '${QUARTER_MATCH_DAYS} days'
  WHERE f.date >= DATE '${qLo}' AND f.date <= DATE '${qHi}'
),
ttm AS (
  SELECT q.ticker, q.as_of, q.period_end,
    MAX(q.q_end) AS quarter_end, MIN(q.q_end) AS ttm_start, COUNT(*) AS n_q,
    arg_max(q.shares_outstanding, q.q_end) AS shares_outstanding,
    COUNT(q.free_cash_flow) AS n_fcf, SUM(q.free_cash_flow) AS fcf_ttm,
    COUNT(q.stock_based_compensation) AS n_sbc, SUM(q.stock_based_compensation) AS sbc_ttm
  FROM fq q WHERE q.rn <= 4
  GROUP BY q.ticker, q.as_of, q.period_end
),
rq AS (
  SELECT q.ticker, q.as_of, q.period_end, q.q_end AS rev_q_end, q.revenue,
    ROW_NUMBER() OVER (PARTITION BY q.ticker, q.as_of, q.period_end ORDER BY ABS(date_diff('day', q.q_end, q.period_end)), q.q_end DESC) AS rn
  FROM fq q
  WHERE ABS(date_diff('day', q.q_end, q.period_end)) <= ${QUARTER_MATCH_DAYS}
)
SELECT b.ticker, strftime(b.as_of, '%Y-%m-%d') AS as_of, strftime(b.period_end, '%Y-%m-%d') AS period_end, b.symbol,
  strftime(p.px_date, '%Y-%m-%d') AS price_date, p.close,
  strftime(v.mcap_date, '%Y-%m-%d') AS mcap_date, v.market_cap,
  strftime(t.quarter_end, '%Y-%m-%d') AS quarter_end, t.shares_outstanding,
  strftime(t.ttm_start, '%Y-%m-%d') AS ttm_start, COALESCE(t.n_q, 0) AS n_quarters,
  COALESCE(t.n_fcf, 0) AS n_fcf, t.fcf_ttm, COALESCE(t.n_sbc, 0) AS n_sbc, t.sbc_ttm,
  strftime(r.rev_q_end, '%Y-%m-%d') AS rev_quarter_end, r.revenue AS revenue_quarter
FROM base b
LEFT JOIN px p ON p.ticker = b.ticker AND p.as_of = b.as_of AND p.period_end = b.period_end AND p.rn = 1
LEFT JOIN val v ON v.ticker = b.ticker AND v.as_of = b.as_of AND v.period_end = b.period_end AND v.rn = 1
LEFT JOIN ttm t ON t.ticker = b.ticker AND t.as_of = b.as_of AND t.period_end = b.period_end
LEFT JOIN rq r ON r.ticker = b.ticker AND r.as_of = b.as_of AND r.period_end = b.period_end AND r.rn = 1
ORDER BY b.ticker, b.as_of, b.period_end
LIMIT 200`;
}

/** The `user_prompt` Shibui requires on every query (observability only). */
export const CROSSCHECK_USER_PROMPT = "Cross-check Juniper FactPack inputs against Shibui Finance (start with 1 and add 4)";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const num = (x: unknown): number | null => (finite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/**
 * Parse a saved stock_data_query response: `{"result":[...rows]}`, a bare row array, or the same as
 * a JSON string. Rows without ticker / dates are dropped; missing values become null.
 */
export function parseCrossCheckResponse(raw: unknown): CrossCheckRow[] {
  const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const rows = Array.isArray(body) ? body : (body as { result?: unknown })?.result;
  if (!Array.isArray(rows)) throw new Error("not a Shibui stock_data_query response (no result rows)");
  const out: CrossCheckRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const ticker = str(r.ticker), asOf = str(r.as_of), periodEnd = str(r.period_end);
    if (!ticker || !asOf || !periodEnd) continue;
    out.push({
      ticker: ticker.toUpperCase(), asOf, periodEnd, symbol: str(r.symbol),
      priceDate: str(r.price_date), close: num(r.close),
      mcapDate: str(r.mcap_date), marketCap: num(r.market_cap),
      quarterEnd: str(r.quarter_end), sharesOutstanding: num(r.shares_outstanding),
      ttmStart: str(r.ttm_start), nQuarters: num(r.n_quarters) ?? 0,
      nFcf: num(r.n_fcf) ?? 0, fcfTtm: num(r.fcf_ttm),
      nSbc: num(r.n_sbc) ?? 0, sbcTtm: num(r.sbc_ttm),
      revQuarterEnd: str(r.rev_quarter_end), revenueQuarter: num(r.revenue_quarter),
    });
  }
  return out;
}

export const crossCheckLevel = (relDiff: number): CrossCheckLevel =>
  relDiff <= CROSSCHECK_OK ? "ok" : relDiff <= CROSSCHECK_WARN ? "warn" : "fail";

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;

/** The pack fields the check reads (a FactPack satisfies this). */
export interface CrossCheckable {
  quote: { asOf: string; price: number; marketCap: number; sharesOutstanding: number };
  latestQuarter?: { periodEnd: string; revenue: number } | null;
  ttm: { fcfYield: number | null };
}

/** The (ticker, asOf, periodEnd) a pack is checked at: its quote date and its latest quarter end. */
export const crossCheckTarget = (pack: CrossCheckable & { ticker: string }) => ({
  ticker: pack.ticker.toUpperCase(),
  asOf: pack.quote.asOf,
  periodEnd: pack.latestQuarter?.periodEnd ?? pack.quote.asOf,
});

/**
 * A pack + its Shibui row → the check. A missing row (ticker not in Shibui) yields all-null values
 * and no diffs. The TTM sums are nulled unless four quarters spanning one year all carry the value;
 * the FCF diff is taken only when Shibui's TTM ends at the pack's quarter (same window).
 */
export function buildShibuiCheck(pack: CrossCheckable, row: CrossCheckRow | null | undefined): ShibuiCheck {
  const periodEnd = pack.latestQuarter?.periodEnd ?? pack.quote.asOf;
  const fullYear = !!row && row.nQuarters === 4 && !!row.ttmStart && !!row.quarterEnd &&
    daysBetween(row.ttmStart, row.quarterEnd) >= TTM_SPAN_DAYS.lo && daysBetween(row.ttmStart, row.quarterEnd) <= TTM_SPAN_DAYS.hi;
  const fcfTtm = fullYear && row!.nFcf === 4 ? row!.fcfTtm : null;
  // Shibui stores an untagged SBC line as 0 (CAT, GE, XOM, the big banks all sum to exactly 0), so a zero
  // TTM is "unknown", not "none" — null keeps the DCF from reading it as SBC-free owner earnings.
  const sbcTtm = fullYear && row!.nSbc === 4 && row!.sbcTtm !== 0 ? row!.sbcTtm : null;
  const sameQuarter = (d: string | null) => !!d && Math.abs(daysBetween(d, periodEnd)) <= QUARTER_MATCH_DAYS;
  const check: ShibuiCheck = {
    asOf: pack.quote.asOf,
    quarterEnd: row?.quarterEnd ?? null,
    price: row?.close ?? null,
    marketCap: row?.marketCap ?? null,
    sharesOutstanding: row?.sharesOutstanding ?? null,
    revenueQuarter: row && sameQuarter(row.revQuarterEnd) ? row.revenueQuarter : null,
    fcfTtm,
    sbcTtm,
    diffs: [],
    source: "shibui",
  };
  const packFcf = pack.ttm.fcfYield == null ? null : pack.ttm.fcfYield * pack.quote.marketCap;
  const pairs: [CrossCheckField, number | null | undefined, number | null][] = [
    ["price", pack.quote.price, check.price],
    ["marketCap", pack.quote.marketCap, check.marketCap],
    ["sharesOutstanding", pack.quote.sharesOutstanding, check.sharesOutstanding],
    ["revenueQuarter", pack.latestQuarter?.revenue, check.revenueQuarter],
    ["fcfTtm", packFcf, sameQuarter(check.quarterEnd) ? check.fcfTtm : null],
  ];
  for (const [field, p, s] of pairs) {
    if (!finite(p) || !finite(s) || s === 0) continue;
    const relDiff = round(Math.abs(p - s) / Math.abs(s), 4);
    check.diffs.push({ field, pack: p, shibui: s, relDiff, level: crossCheckLevel(relDiff) });
  }
  return check;
}

interface CheckStampable {
  shibuiCheck?: ShibuiCheck;
  provenance?: { field: string; source: string; endpoint: string; capturedAt: string }[];
}

/** Stamp the check onto a pack (mutates and returns it), replacing an earlier check and its provenance line. */
export function stampShibuiCheck<T extends CheckStampable>(pack: T, check: ShibuiCheck, capturedAt: string): T {
  if (pack.provenance) pack.provenance = pack.provenance.filter((p) => p.field !== "shibuiCheck");
  pack.shibuiCheck = check;
  pack.provenance?.push({
    field: "shibuiCheck", source: "shibui", capturedAt,
    endpoint: `stock_data_query: close + valuation.market_cap on/before ${check.asOf}; fundamentals_quarterly (4 quarters to ${check.quarterEnd ?? "n/a"}): shares_outstanding, revenue, Σfree_cash_flow, Σstock_based_compensation`,
  });
  return pack;
}

/** An owner-accepted `fail`: the pack was verified against the filing and kept. Stamped by facts:crosscheck --accept. */
export interface CrosscheckOverride { field: CrossCheckField; reason: string; verifiedAgainst: string; capturedAt: string }

/** Add or replace the override for one field (mutates and returns the pack); provenance carries a matching row. */
export function stampCrosscheckOverride<T extends CheckStampable & { crosscheckOverrides?: CrosscheckOverride[] }>(pack: T, o: CrosscheckOverride): T {
  if (!o.reason.trim() || !o.verifiedAgainst.trim()) throw new Error("an override needs a non-empty --reason and --verified-against");
  pack.crosscheckOverrides = [...(pack.crosscheckOverrides ?? []).filter((x) => x.field !== o.field), o];
  const field = `crosscheckOverrides.${o.field}`;
  if (pack.provenance) pack.provenance = pack.provenance.filter((p) => p.field !== field);
  pack.provenance?.push({ field, source: "edgar", capturedAt: o.capturedAt, endpoint: `accepted Shibui fail on ${o.field}: ${o.reason} (verified against ${o.verifiedAgainst})` });
  return pack;
}
