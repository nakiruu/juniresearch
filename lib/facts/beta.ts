/**
 * beta.ts — a measured, per-name equity beta for the cost-of-equity build-up.
 * -----------------------------------------------------------------------------
 * moat.ts's betaFromSic is a sector guess (ZBRA 1.1 vs a measured ~1.65; LRCX 1.3
 * vs ~2.2), and that beta sets the discount rate for both the reverse DCF and the
 * ROIC−WACC moat read — so it moves the intrinsic margin of safety and, through
 * decide(), conviction κ. This replaces the guess with a regression beta whenever
 * the pack carries one.
 *
 * Method (the Bloomberg default): two years of weekly log returns vs SPY, ending at
 * the pack's quote date (point-in-time with the market cap the WACC weights use).
 * Weekly, not daily, so thinly traded names are not biased toward zero by stale
 * closes. The raw OLS slope is then Blume-adjusted (⅔·β + ⅓, shrinking toward the
 * market) and clamped — a two-year sample is noisy (AT&T's raw beta is ~0.0).
 *
 * Capture: Shibui Finance is reachable only as a Claude connector, so code renders
 * the SQL (`betaQuery`) and the capture step saves the tool's response verbatim to
 * `data/raw/<T>/<ACC>/shibui-beta.json`. The SQL returns only sufficient statistics
 * (n, covariance, variances); every piece of arithmetic on them lives here.
 * Shibui closes are split-adjusted but not dividend-adjusted — immaterial to a
 * weekly covariance.
 */

export const BETA_FILE = "shibui-beta.json";
export const BETA_BENCHMARK = "SPY";
export const BETA_WINDOW_YEARS = 2;
/** Fewer weekly returns than this (about a year) → no measured beta; the SIC proxy stands. */
export const BETA_MIN_WEEKS = 52;
/** Blume (1971): adjusted = w·raw + (1 − w)·1. */
export const BLUME_WEIGHT = 2 / 3;
export const BETA_CLAMP = { lo: 0.3, hi: 2.5 } as const;

export interface BetaStats {
  ticker: string;
  endDate: string; // YYYY-MM-DD
  nWeeks: number;
  firstWeek: string | null;
  lastWeek: string | null;
  covIM: number;
  varM: number;
  varI: number;
}

export interface MeasuredBeta {
  value: number; // the beta the engine uses: Blume-adjusted, clamped
  raw: number; // OLS slope of weekly log returns on SPY's
  standardError: number;
  r2: number;
  observations: number; // weekly returns
  benchmark: string;
  window: { start: string | null; end: string };
  source: "shibui";
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

/**
 * The Shibui SQL (DuckDB) for one or more (ticker, endDate) pairs — one result row per pair.
 * Literal date bounds pre-filter the 31.7M-row quotes table before any window function.
 */
export function betaQuery(rows: { ticker: string; endDate: string }[]): string {
  if (!rows.length) throw new Error("betaQuery needs at least one (ticker, endDate)");
  if (rows.length > 200) throw new Error("Shibui returns at most 200 rows — split the batch");
  for (const r of rows) if (!isYmd(r.endDate)) throw new Error(`bad endDate ${r.endDate} for ${r.ticker}`);
  const ends = rows.map((r) => r.endDate).sort();
  const lo = shiftYmd(ends[0], -(366 * BETA_WINDOW_YEARS + 7));
  const hi = ends[ends.length - 1];
  const values = rows.map((r) => `(${sqlTicker(r.ticker.toUpperCase())}, DATE '${r.endDate}')`).join(", ");
  return `WITH universe(ticker, end_date) AS (VALUES ${values}),
sym AS (
  SELECT u.ticker, u.end_date, g.symbol,
    ROW_NUMBER() OVER (PARTITION BY u.ticker, u.end_date ORDER BY (g.type = 'Common Stock') DESC, g.has_company_details DESC, g.symbol) AS pick
  FROM universe u JOIN shibui.general_info g ON g.ticker = u.ticker AND g.type <> 'ETF'
),
mkt AS (SELECT g.symbol FROM shibui.general_info g WHERE g.ticker = '${BETA_BENCHMARK}' AND g.type = 'ETF' LIMIT 1),
daily AS (
  SELECT s.ticker, s.end_date, sq.date, sq.close AS c_i, m.close AS c_m
  FROM sym s
  JOIN shibui.stock_quotes sq ON sq.symbol = s.symbol
    AND sq.date > s.end_date - INTERVAL '${BETA_WINDOW_YEARS} years' AND sq.date <= s.end_date
  JOIN shibui.stock_quotes m ON m.symbol = (SELECT symbol FROM mkt) AND m.date = sq.date
  WHERE s.pick = 1
    AND sq.date >= DATE '${lo}' AND sq.date <= DATE '${hi}'
    AND m.date >= DATE '${lo}' AND m.date <= DATE '${hi}'
),
weekly AS (
  SELECT d.ticker, d.end_date, date_trunc('week', d.date) AS wk,
    arg_max(d.c_i, d.date) AS w_i, arg_max(d.c_m, d.date) AS w_m
  FROM daily d GROUP BY d.ticker, d.end_date, date_trunc('week', d.date)
),
rets AS (
  SELECT w.ticker, w.end_date, w.wk,
    LN(w.w_i / NULLIF(LAG(w.w_i) OVER win, 0)) AS r_i,
    LN(w.w_m / NULLIF(LAG(w.w_m) OVER win, 0)) AS r_m
  FROM weekly w WINDOW win AS (PARTITION BY w.ticker, w.end_date ORDER BY w.wk)
)
SELECT r.ticker, strftime(r.end_date, '%Y-%m-%d') AS end_date, COUNT(*) AS n_weeks,
  strftime(MIN(r.wk), '%Y-%m-%d') AS first_week, strftime(MAX(r.wk), '%Y-%m-%d') AS last_week,
  COVAR_SAMP(r.r_i, r.r_m) AS cov_im, VAR_SAMP(r.r_m) AS var_m, VAR_SAMP(r.r_i) AS var_i
FROM rets r WHERE r.r_i IS NOT NULL AND r.r_m IS NOT NULL
GROUP BY r.ticker, r.end_date ORDER BY r.ticker, r.end_date
LIMIT 200`;
}

/** The `user_prompt` Shibui requires on every query (observability only). */
export const betaUserPrompt = (tickers: string[]) =>
  `Measure the 2-year weekly equity beta vs SPY for ${tickers.join(", ")} (Juniper cost-of-equity input).`;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Parse a saved stock_data_query response: `{"result":[...rows]}`, a bare row array, or the
 * same as a JSON string. Rows with missing or non-finite statistics are dropped.
 */
export function parseBetaResponse(raw: unknown): BetaStats[] {
  const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const rows = Array.isArray(body) ? body : (body as { result?: unknown })?.result;
  if (!Array.isArray(rows)) throw new Error("not a Shibui stock_data_query response (no result rows)");
  const out: BetaStats[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const { ticker, end_date, n_weeks, first_week, last_week, cov_im, var_m, var_i } = r;
    if (typeof ticker !== "string" || typeof end_date !== "string") continue;
    if (!finite(n_weeks) || !finite(cov_im) || !finite(var_m) || !finite(var_i)) continue;
    out.push({
      ticker: ticker.toUpperCase(), endDate: end_date, nWeeks: n_weeks,
      firstWeek: typeof first_week === "string" ? first_week : null,
      lastWeek: typeof last_week === "string" ? last_week : null,
      covIM: cov_im, varM: var_m, varI: var_i,
    });
  }
  return out;
}

export const blumeAdjust = (raw: number) => BLUME_WEIGHT * raw + (1 - BLUME_WEIGHT);
const clamp = (x: number) => Math.min(BETA_CLAMP.hi, Math.max(BETA_CLAMP.lo, x));
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Sufficient statistics → the measured beta, or null when the sample is too short or degenerate. */
export function measureBeta(s: BetaStats): MeasuredBeta | null {
  if (s.nWeeks < BETA_MIN_WEEKS || !(s.varM > 0) || !(s.varI > 0)) return null;
  const raw = s.covIM / s.varM;
  const r2 = Math.min(1, (s.covIM * s.covIM) / (s.varM * s.varI));
  const standardError = Math.sqrt(Math.max(0, 1 - r2) / (s.nWeeks - 2)) * Math.sqrt(s.varI / s.varM);
  return {
    value: round(clamp(blumeAdjust(raw)), 3),
    raw: round(raw, 3),
    standardError: round(standardError, 3),
    r2: round(r2, 3),
    observations: s.nWeeks,
    benchmark: BETA_BENCHMARK,
    window: { start: s.firstWeek, end: s.endDate },
    source: "shibui",
  };
}

interface BetaStampable {
  quote: { asOf: string };
  beta?: MeasuredBeta;
  provenance?: { field: string; source: string; endpoint: string; capturedAt: string }[];
}

/**
 * Stamp a measured beta onto a pack (mutates and returns it), replacing any earlier beta and its
 * provenance line. A null beta (sample too short) removes the field so the SIC proxy applies.
 */
export function stampBeta<T extends BetaStampable>(pack: T, beta: MeasuredBeta | null, capturedAt: string): T {
  delete pack.beta;
  if (pack.provenance) pack.provenance = pack.provenance.filter((p) => p.field !== "beta");
  if (!beta) return pack;
  pack.beta = beta;
  pack.provenance?.push({
    field: "beta", source: "shibui", capturedAt,
    endpoint: `stock_data_query: ${BETA_WINDOW_YEARS}y weekly log returns vs ${BETA_BENCHMARK} (cov/var) → Blume-adjusted, clamped [${BETA_CLAMP.lo}, ${BETA_CLAMP.hi}]`,
  });
  return pack;
}
