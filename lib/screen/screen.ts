/**
 * screen.ts — a pre-synthesis screen: order the /synthesize queue so the likeliest buys are written first.
 * -----------------------------------------------------------------------------
 * Writing a report (author + a fresh editorial reviewer, often two rounds) is the expensive step, and
 * 41 of the first 92 published reports came out HOLD, which the trading engine cannot buy. The sell
 * side's consensus target is a strong prior for where our own rating lands, so this ranks candidate
 * tickers by Street upside (consensus target / last close − 1) and flags `likelyHold` below
 * LIKELY_HOLD_UPSIDE. It ORDERS the queue; it never skips a filing.
 *
 * The signal is partly circular: the author sees the same consensus (analystSentiment in the
 * FactPack), so a low Street target partly *causes* a HOLD rather than merely predicting one. That is
 * fine for queue ordering (we want to predict the outcome, whatever the mechanism), but it is a reason
 * never to treat the flag as a verdict on the company.
 *
 * Calibration (`npm run screen -- --calibrate data/raw/_shibui/screen-calibration-2026-10-03.json`):
 * the 92 published reports (51 BUY, 41 HOLD, no STRONG BUY / SELL). "Flagged" = Street upside below
 * the threshold; "deferred" = runs the flag pushes to the back of the queue (written later, not lost).
 *
 *   Today's Shibui snapshot (target as of 2026-10-03 / close 2026-10-01; NVT not in Shibui):
 *     threshold   HOLD flagged   BUY flagged   runs deferred   of which BUY
 *       5%         7/41  17%      0/50   0%         7               0
 *      10%        17/41  41%      1/50   2%        18               1   (LRCX, +9.9%)
 *      15%        22/41  54%      2/50   4%        24               2
 *      20%        28/41  68%      7/50  14%        35               7
 *     median Street upside: BUY 32%, HOLD 13%. AUC (upside separates BUY from HOLD) 0.82;
 *     top 20 by upside = 15 BUY, top 40 = 32 BUY (base rate 55%).
 *   Point-in-time (each report's own analystSentiment.consensusTarget / quote.currentPrice):
 *       5%         6/41  15%      0/51   0%         6               0
 *      10%        16/41  39%      0/51   0%        16               0
 *      15%        23/41  56%      3/51   6%        26               3
 *      20%        29/41  71%      6/51  12%        35               6
 *     median Street upside: BUY 32%, HOLD 14%.
 *
 * 10% is the knee: it catches ~40% of HOLDs for at most one BUY. Caveats: the snapshot targets are
 * today's while the reports were written on their own dates over the last ~4 weeks (the point-in-time
 * rows avoid that and agree); 92 reports is a small sample; and the screen orders, it never skips.
 * Tie-breakers tested and NOT adopted: Shibui earnings-quality flags (AUC 0.46 overall, 0.48 inside
 * the 5–25% band), FCF yield (0.53 / 0.49), forward P/E (worse than chance in-band), forward PEG (0.71
 * overall but mostly a proxy for upside; 0.66 in-band on 31 names), Piotroski F (0.48 overall, 0.73
 * in the 10–20% band but on 17 names; adding it to the score moved AUC 0.821 → 0.824 and the top 40
 * by one BUY). None clears the bar, so the rank is Street upside alone.
 *
 * Capture: Shibui is a Claude connector, not an HTTP API. Code renders the SQL (`screenQueries`), the
 * capturer runs it and saves the response verbatim, and `parseScreenResponse` + `rankCandidates` do
 * every comparison here.
 */

/** Street upside below this → likely HOLD. The flag only labels; the order is upside alone and nothing is skipped. */
export const LIKELY_HOLD_UPSIDE = 0.1;
/** Thresholds the calibration reports. */
export const CALIBRATION_THRESHOLDS = [0.05, 0.1, 0.15, 0.2] as const;
/** Shibui's latest close / daily metrics must be at most this many calendar days before the as-of date. */
export const SCREEN_STALE_DAYS = 14;
/** Piotroski F comes from the latest fiscal quarter ending within this many days of the as-of date. */
const QUARTER_LOOKBACK_DAYS = 280;
/** Shibui returns at most 200 rows; the query returns one row per ticker. */
export const SCREEN_BATCH = 200;

/** The `user_prompt` Shibui requires on every query (observability only). */
export const SCREEN_USER_PROMPT = "Pre-synthesis screen: rank Juniper candidates by likelihood of a buy-side report";

export const LEGEND =
  "Street upside = Shibui consensus target / last close − 1 (target is today's snapshot). likely-HOLD = upside < " +
  `${LIKELY_HOLD_UPSIDE * 100}%. The screen ORDERS the synthesis queue; it never skips a filing. The signal is partly ` +
  "circular — the author sees the same consensus — so treat the flag as a queue prior, not a verdict on the company.";

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

/**
 * The Shibui SQL (DuckDB) for up to 200 tickers — one result row per ticker, driven FROM the list so
 * a ticker Shibui lacks still returns a row of nulls. `asOf` (YYYY-MM-DD, normally today) bounds the
 * literal date pre-filters on the daily tables. analyst_estimates is a current snapshot.
 */
export function screenQuery(tickers: string[], asOf: string): string {
  if (!isYmd(asOf)) throw new Error(`bad asOf ${asOf}`);
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (!list.length) throw new Error("screenQuery needs at least one ticker");
  if (list.length > SCREEN_BATCH) throw new Error("Shibui returns at most 200 rows — split the batch (screenQueries)");
  const values = list.map((t) => `(${sqlTicker(t)})`).join(", ");
  const dLo = shiftYmd(asOf, -SCREEN_STALE_DAYS);
  const qLo = shiftYmd(asOf, -QUARTER_LOOKBACK_DAYS);
  return `WITH universe(ticker) AS (VALUES ${values}),
sym_rank AS (
  SELECT u.ticker, g.symbol,
    ROW_NUMBER() OVER (PARTITION BY u.ticker ORDER BY (g.type = 'Common Stock') DESC, g.has_company_details DESC, g.symbol) AS pick
  FROM universe u JOIN shibui.general_info g ON g.ticker = u.ticker AND g.type <> 'ETF'
),
sym AS (SELECT s.ticker, s.symbol FROM sym_rank s WHERE s.pick = 1),
px AS (
  SELECT s.ticker, sq.date AS px_date, sq.close,
    ROW_NUMBER() OVER (PARTITION BY s.ticker ORDER BY sq.date DESC) AS rn
  FROM sym s JOIN shibui.stock_quotes sq ON sq.symbol = s.symbol
  WHERE sq.date >= DATE '${dLo}' AND sq.date <= DATE '${asOf}'
),
dd AS (
  SELECT s.ticker, d.free_cash_flow_yield, array_to_string(d.earnings_quality_flags, ',') AS eq_flags,
    ROW_NUMBER() OVER (PARTITION BY s.ticker ORDER BY d.date DESC) AS rn
  FROM sym s JOIN shibui.fundamentals_derived_daily d ON d.symbol = s.symbol
  WHERE d.date >= DATE '${dLo}' AND d.date <= DATE '${asOf}'
),
val AS (
  SELECT s.ticker, v.market_cap,
    ROW_NUMBER() OVER (PARTITION BY s.ticker ORDER BY v.date DESC) AS rn
  FROM sym s JOIN shibui.valuation v ON v.symbol = s.symbol
  WHERE v.date >= DATE '${dLo}' AND v.date <= DATE '${asOf}' AND v.market_cap IS NOT NULL
),
fq AS (
  SELECT s.ticker, f.date AS q_end, f.piotroski_f_score,
    ROW_NUMBER() OVER (PARTITION BY s.ticker ORDER BY f.date DESC) AS rn
  FROM sym s JOIN shibui.fundamentals_quarterly f ON f.symbol = s.symbol
  WHERE f.date >= DATE '${qLo}' AND f.date <= DATE '${asOf}' AND f.piotroski_f_score IS NOT NULL
)
SELECT u.ticker, s.symbol, strftime(p.px_date, '%Y-%m-%d') AS price_date, p.close,
  ae.wall_street_target_price AS street_target, ae.forward_pe, ae.forward_peg,
  v.market_cap, d.free_cash_flow_yield AS fcf_yield,
  CASE WHEN d.ticker IS NULL THEN NULL ELSE COALESCE(d.eq_flags, '') END AS eq_flags,
  q.piotroski_f_score AS piotroski, strftime(q.q_end, '%Y-%m-%d') AS piotroski_quarter
FROM universe u
LEFT JOIN sym s ON s.ticker = u.ticker
LEFT JOIN px p ON p.ticker = u.ticker AND p.rn = 1
LEFT JOIN shibui.analyst_estimates ae ON ae.symbol = s.symbol
LEFT JOIN val v ON v.ticker = u.ticker AND v.rn = 1
LEFT JOIN dd d ON d.ticker = u.ticker AND d.rn = 1
LEFT JOIN fq q ON q.ticker = u.ticker AND q.rn = 1
ORDER BY u.ticker
LIMIT 200`;
}

/** One query per ≤ 200 distinct tickers. */
export function screenQueries(tickers: string[], asOf: string): string[] {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const out: string[] = [];
  for (let i = 0; i < list.length; i += SCREEN_BATCH) out.push(screenQuery(list.slice(i, i + SCREEN_BATCH), asOf));
  return out;
}

/** One parsed result row of `screenQuery`. */
export interface ScreenRow {
  ticker: string;
  symbol: string | null;
  priceDate: string | null;
  close: number | null;
  streetTarget: number | null;
  forwardPe: number | null;
  forwardPeg: number | null;
  marketCap: number | null;
  fcfYield: number | null;
  earningsQualityFlags: string[] | null; // null = no daily row; [] = clean
  piotroski: number | null;
  piotroskiQuarter: string | null;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const num = (x: unknown): number | null => (finite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const flags = (x: unknown): string[] | null =>
  Array.isArray(x) ? x.filter((f): f is string => typeof f === "string" && f.length > 0)
  : typeof x === "string" ? x.split(",").map((f) => f.trim()).filter(Boolean)
  : null;

/**
 * Parse a saved stock_data_query response — `{"result":[...]}`, a bare row array, or the same as a JSON
 * string — or an array of such responses (one per batch). Rows without a ticker are dropped; the
 * first row per ticker wins.
 */
export function parseScreenResponse(raw: unknown): ScreenRow[] {
  const out = new Map<string, ScreenRow>();
  const isRow = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x) && "ticker" in x;
  // Flatten to row arrays: a response {result:[…]}, a bare row array, a JSON string of either, or a list of those.
  const rowSets: unknown[][] = [];
  const collect = (node: unknown): void => {
    const body = typeof node === "string" ? (JSON.parse(node) as unknown) : node;
    if (Array.isArray(body)) {
      if (body.length === 0 || body.every(isRow)) rowSets.push(body);
      else body.forEach(collect);
      return;
    }
    const rows = (body as { result?: unknown })?.result;
    if (!Array.isArray(rows)) throw new Error("not a Shibui stock_data_query response (no result rows)");
    rowSets.push(rows);
  };
  collect(raw);
  for (const rows of rowSets) {
    for (const r of rows as Record<string, unknown>[]) {
      const ticker = str(r?.ticker)?.toUpperCase();
      if (!ticker || out.has(ticker)) continue;
      const target = num(r.street_target);
      out.set(ticker, {
        ticker, symbol: str(r.symbol), priceDate: str(r.price_date), close: num(r.close),
        streetTarget: target != null && target > 0 ? target : null,
        forwardPe: num(r.forward_pe), forwardPeg: num(r.forward_peg), marketCap: num(r.market_cap),
        fcfYield: num(r.fcf_yield), earningsQualityFlags: flags(r.eq_flags),
        piotroski: num(r.piotroski), piotroskiQuarter: str(r.piotroski_quarter),
      });
    }
  }
  return [...out.values()];
}

/** Street upside = target / close − 1, or null when either is missing or non-positive. */
export const streetUpside = (target: number | null, close: number | null): number | null =>
  target != null && close != null && target > 0 && close > 0 ? target / close - 1 : null;

export interface RankedCandidate extends ScreenRow {
  rank: number; // 1 = synthesize first
  streetUpside: number | null;
  /** The sort key: Street upside; null (no target / no close) sorts last. */
  priority: number | null;
  likelyHold: boolean;
  reason: string;
}

export interface RankOptions {
  /** Street upside below this → likelyHold. Default LIKELY_HOLD_UPSIDE. */
  holdThreshold?: number;
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

/**
 * Pure: rank by Street upside, highest first; ties (and the no-target tail) fall back to ticker order so
 * the output is deterministic. Rows with no Street target or no close are kept, at the end, marked.
 */
export function rankCandidates(rows: ScreenRow[], opts: RankOptions = {}): RankedCandidate[] {
  const threshold = opts.holdThreshold ?? LIKELY_HOLD_UPSIDE;
  const scored = rows.map((r) => {
    const up = streetUpside(r.streetTarget, r.close);
    const likelyHold = up != null && up < threshold;
    const reason = !r.symbol ? "not in Shibui"
      : r.close == null ? "no recent Shibui close"
      : r.streetTarget == null ? "no Street target"
      : likelyHold ? `Street upside ${pct(up!)} < ${pct(threshold)} — likely HOLD`
      : `Street upside ${pct(up!)}`;
    return { ...r, streetUpside: up, priority: up, likelyHold, reason };
  });
  scored.sort((a, b) =>
    a.priority == null && b.priority == null ? a.ticker.localeCompare(b.ticker)
    : a.priority == null ? 1
    : b.priority == null ? -1
    : b.priority - a.priority || a.ticker.localeCompare(b.ticker));
  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------------------------------------------------------------- calibration

export type ReportLabel = "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL";
export const isBuyLabel = (l: string) => l === "BUY" || l === "STRONG BUY";

export interface CalibrationSample { ticker: string; label: string; upside: number | null }

export interface CalibrationRow {
  threshold: number;
  holds: number; // HOLD reports with an upside
  holdFlagged: number;
  buys: number; // BUY / STRONG BUY reports with an upside
  buyFlagged: number;
  /** Synthesis runs the flag would push to the back of the queue (every flagged report, any label). */
  deferred: number;
  /** Of those, the buys — written later, not lost: the screen never skips. */
  buysDeferred: number;
}

/** Pure: for each threshold, how many HOLD vs BUY reports Street upside < threshold would have flagged. */
export function calibrate(samples: CalibrationSample[], thresholds: readonly number[] = CALIBRATION_THRESHOLDS): CalibrationRow[] {
  const known = samples.filter((s) => s.upside != null);
  const holds = known.filter((s) => s.label === "HOLD");
  const buys = known.filter((s) => isBuyLabel(s.label));
  return thresholds.map((t) => {
    const flagged = known.filter((s) => s.upside! < t);
    return {
      threshold: t,
      holds: holds.length, holdFlagged: holds.filter((s) => s.upside! < t).length,
      buys: buys.length, buyFlagged: buys.filter((s) => s.upside! < t).length,
      deferred: flagged.length, buysDeferred: flagged.filter((s) => isBuyLabel(s.label)).length,
    };
  });
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- pending filings

export interface CapturedFiling { ticker: string; accession: string; filedDate: string; form?: string }
export interface PublishedFiling { ticker: string; accession: string; filedDate: string | null }

/**
 * Pure: captured filings (data/raw/<T>/<ACC>/edgar-filing.json) that are newer than the ticker's
 * published report — or for a ticker with no report — newest per ticker. A capture older than (or the
 * same as) the published filing is history, not pending.
 */
export function pendingFilings(captured: CapturedFiling[], published: PublishedFiling[]): CapturedFiling[] {
  const pub = new Map(published.map((p) => [p.ticker.toUpperCase(), p]));
  const best = new Map<string, CapturedFiling>();
  for (const c of captured) {
    const t = c.ticker.toUpperCase();
    const p = pub.get(t);
    if (p && (p.accession === c.accession || (p.filedDate != null && c.filedDate <= p.filedDate))) continue;
    const cur = best.get(t);
    if (!cur || c.filedDate > cur.filedDate) best.set(t, { ...c, ticker: t });
  }
  return [...best.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}
