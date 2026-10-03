/**
 * realized.ts — log each report's predicted upside against the return that actually followed.
 * -----------------------------------------------------------------------------
 * Audit finding S3 (docs/superpowers/specs/2026-09-28-pipeline-audit.md): sizing is μ·κ·R and μ is
 * the report's own expected upside, which nothing has ever checked against outcomes. This module
 * builds the evidence log so a later recalibration has data: every published prediction point
 * (ticker, quote date) with its E, D, R, label and κ, next to the realized return at +21 / +63 /
 * +126 / +252 trading days and to date, SPY over the same dates (excess return), and the trailing
 * 252-day realized volatility at the quote date (stored for later; wired nowhere).
 *
 * Prediction points: the current data/<t>.json plus every earlier git revision of it (the script
 * reads git; this module only sees parsed objects). Each distinct (ticker, asOf) is one point; when
 * several revisions share it, the newest revision's numbers are kept and every sha is recorded.
 *
 * Outcomes: Shibui Finance is reachable only as a Claude connector, so code renders the SQL
 * (`outcomeQuery`), the capture step saves the response verbatim under data/raw/_shibui/, and every
 * piece of arithmetic happens here. The SQL returns raw closes (entry on/before asOf, the closes
 * 21/63/126/252 sessions later, the latest close, SPY on each of those dates) and the variance of
 * the trailing 252 daily log returns. Entry and exit both use Shibui's split-adjusted close, so a
 * split cannot fake a return; the report's own price is compared with Shibui's entry close and a
 * gap above PRICE_MISMATCH flags a possible split or data problem. Shibui closes are NOT
 * dividend-adjusted, so returns here are price returns (a dividend payer's total return is a little
 * higher, and SPY's ~1.3% yield is missing from the benchmark too).
 *
 * Honesty about sample size: every aggregate cell carries n (points) and nNames (distinct tickers —
 * points of one name overlap in time and are not independent) and is null below MIN_N names, with
 * the reason. The reports are weeks old; most cells read "insufficient data", which is correct.
 */
import { computeConviction } from "../synth/conviction";

export const CALIBRATION_USER_PROMPT = "Log Juniper report upside against realized returns (calibration)";
export const CALIBRATION_BENCHMARK = "SPY";
/** Forward horizons in trading sessions (~1, 3, 6, 12 months). */
export const HORIZONS = { d21: 21, d63: 63, d126: 126, d252: 252 } as const;
export type HorizonKey = keyof typeof HORIZONS | "latest";
export const HORIZON_KEYS: HorizonKey[] = ["d21", "d63", "d126", "d252", "latest"];
/** Aggregate cells need at least this many distinct names, else null + "insufficient data". */
export const MIN_N = 10;
/** |report price / Shibui entry close − 1| above this flags a possible split / data issue. */
export const PRICE_MISMATCH = 0.05;
/**
 * Above this gap the point leaves the aggregates: no intraday move or one-day offset explains it, so
 * the ticker mapping or the report's price is suspect. (A split alone would not distort the return —
 * both closes are split-adjusted and E is a ratio — but it cannot be told apart from a bad mapping.)
 */
export const PRICE_MISMATCH_SEVERE = 0.25;
/** A Shibui entry close more than this many calendar days before asOf is too stale to use. */
export const ENTRY_STALE_DAYS = 10;
/** Trailing window for realized volatility (daily log returns), and the minimum count to report it. */
export const VOL_WINDOW = 252;
export const VOL_MIN_OBS = 200;
/** The latest close is flagged stale when older than this many calendar days before `today`. */
export const LATEST_STALE_DAYS = 7;
/** Shibui returns at most 200 rows per query; one row per point. */
export const MAX_POINTS_PER_QUERY = 200;

const LABELS = ["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"] as const;
export type Label = (typeof LABELS)[number];

/* ------------------------------------------------------------------------------------------------ */
/* prediction points                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

/** One version of a report: the working-tree file (sha null) or a git revision of it. */
export interface ReportRevision {
  sha: string | null; // null = the working-tree file (newest)
  committedAt: string | null; // ISO commit time; null for the working tree
  report: unknown; // parsed JSON
}

export interface PredictionPoint {
  ticker: string;
  asOf: string; // YYYY-MM-DD — the quote date E was computed against
  reportDate: string | null; // YYYY-MM-DD
  label: Label;
  E: number;
  D: number;
  R: number | null;
  kappa: number | null; // decision.conviction / 100
  reportPrice: number;
  scenarios: { name: string; impliedPrice: number; probability: number }[];
  /** Newest revision whose numbers are kept, and every revision that carried this (ticker, asOf). */
  sha: string | null;
  shas: (string | null)[];
  source: "current" | "git";
  /** Labels seen across the revisions of this point, when they differ (a later re-rating). */
  revisedLabels?: Label[];
  eRecomputed?: boolean; // the revision predates rating.conviction; E/D/R re-derived from scenarios
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "Sep 11, 2026" / "September 11, 2026" / "2026-09-11" → "2026-09-11" (no timezone involved). */
export function toYmd(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (isYmd(t)) return t;
  const m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(t);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  const d = Number(m[2]);
  if (!mo || d < 1 || d > 31) return null;
  return `${m[3]}-${pad(mo)}-${pad(d)}`;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const obj = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

type ParsedRevision = Omit<PredictionPoint, "sha" | "shas" | "source" | "revisedLabels">;

/**
 * The fields a prediction point needs, read leniently (old revisions predate later schema fields).
 * Null when the revision lacks a ticker, a parseable quote date, a positive price, a known label
 * or usable scenarios — "skip a revision that fails to parse".
 */
export function readRevision(report: unknown): ParsedRevision | null {
  const r = obj(report);
  const meta = obj(r?.meta), quote = obj(r?.quote), rating = obj(r?.rating);
  const valuation = obj(obj(r?.sections)?.valuation);
  if (!meta || !quote || !rating || !valuation) return null;
  const ticker = typeof meta.ticker === "string" ? meta.ticker.trim().toUpperCase() : "";
  const asOf = toYmd(meta.asOf);
  const price = quote.currentPrice;
  const label = rating.label;
  if (!ticker || !asOf || !finite(price) || !(price > 0)) return null;
  if (typeof label !== "string" || !(LABELS as readonly string[]).includes(label)) return null;
  const rawScen = Array.isArray(valuation.scenarios) ? valuation.scenarios : [];
  const scenarios = rawScen
    .map((s) => obj(s))
    .filter((s): s is Record<string, unknown> => !!s && finite(s.impliedPrice) && finite(s.probability))
    .map((s) => ({ name: String(s.name ?? ""), impliedPrice: s.impliedPrice as number, probability: s.probability as number }));
  if (!scenarios.length || scenarios.length !== rawScen.length) return null;
  const conv = obj(rating.conviction);
  let E: number, D: number, R: number | null, eRecomputed = false;
  if (conv && finite(conv.expectedUpside) && finite(conv.bearDownside)) {
    E = conv.expectedUpside;
    D = conv.bearDownside;
    R = finite(conv.rewardRisk) ? conv.rewardRisk : null;
  } else {
    ({ expectedUpside: E, bearDownside: D, rewardRisk: R } = computeConviction(scenarios.map((s) => ({ ...s, driver: "" })), price));
    eRecomputed = true;
  }
  const dec = obj(rating.decision);
  const kappa = dec && finite(dec.conviction) ? dec.conviction / 100 : null;
  return {
    ticker, asOf, reportDate: toYmd(meta.reportDate), label: label as Label, E, D, R, kappa,
    reportPrice: price, scenarios, ...(eRecomputed ? { eRecomputed } : {}),
  };
}

export const pointKey = (ticker: string, asOf: string) => `${ticker.toUpperCase()}|${asOf}`;

/** Newest first: the working tree, then commits by time (ties keep input order). */
const newestFirst = (a: ReportRevision, b: ReportRevision) => {
  if (a.sha === null && b.sha !== null) return -1;
  if (b.sha === null && a.sha !== null) return 1;
  return (b.committedAt ?? "").localeCompare(a.committedAt ?? "");
};

/**
 * Every distinct (ticker, asOf) across the current reports and their git revisions. The newest
 * revision of a point supplies its numbers; all shas are kept for traceability. Unparseable
 * revisions are counted in `skipped`, not thrown.
 */
export function predictionPoints(revisions: ReportRevision[]): { points: PredictionPoint[]; skipped: { sha: string | null; reason: string }[] } {
  const sorted = [...revisions].sort(newestFirst);
  const byKey = new Map<string, PredictionPoint>();
  const labels = new Map<string, Set<Label>>();
  const skipped: { sha: string | null; reason: string }[] = [];
  for (const rev of sorted) {
    const p = readRevision(rev.report);
    if (!p) {
      skipped.push({ sha: rev.sha, reason: "missing ticker / asOf / price / label / scenarios" });
      continue;
    }
    const key = pointKey(p.ticker, p.asOf);
    const seen = byKey.get(key);
    labels.set(key, (labels.get(key) ?? new Set<Label>()).add(p.label));
    if (seen) {
      seen.shas.push(rev.sha);
      continue;
    }
    byKey.set(key, { ...p, sha: rev.sha, shas: [rev.sha], source: rev.sha === null ? "current" : "git" });
  }
  const points = [...byKey.values()].sort((a, b) => a.ticker.localeCompare(b.ticker) || a.asOf.localeCompare(b.asOf));
  for (const p of points) {
    const ls = labels.get(pointKey(p.ticker, p.asOf))!;
    if (ls.size > 1) p.revisedLabels = [...ls];
  }
  return { points, skipped };
}

/* ------------------------------------------------------------------------------------------------ */
/* the Shibui query                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

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

/**
 * The Shibui SQL (DuckDB) for up to 200 (ticker, asOf) points — one result row per point, driven
 * FROM the list so a ticker Shibui lacks still returns a row of nulls. `today` is the literal upper
 * date bound; the lower bound reaches far enough back for VOL_WINDOW sessions before the earliest
 * asOf. Forward closes are LEADs over one window (never offset self-joins); the trailing
 * volatility is a rolling VAR_SAMP over a second CTE (window functions cannot nest).
 */
export function outcomeQuery(points: { ticker: string; asOf: string }[], today: string): string {
  if (!isYmd(today)) throw new Error(`bad today ${today}`);
  const uniq = new Map<string, { ticker: string; asOf: string }>();
  for (const p of points) {
    if (!isYmd(p.asOf)) throw new Error(`bad asOf ${p.asOf} for ${p.ticker}`);
    uniq.set(pointKey(p.ticker, p.asOf), { ticker: p.ticker.toUpperCase(), asOf: p.asOf });
  }
  if (!uniq.size) throw new Error("outcomeQuery needs at least one (ticker, asOf)");
  if (uniq.size > MAX_POINTS_PER_QUERY) throw new Error("Shibui returns at most 200 rows — split the batch");
  const list = [...uniq.values()];
  const asOfs = list.map((p) => p.asOf).sort();
  const lo = shiftYmd(asOfs[0], -(Math.ceil(VOL_WINDOW * 1.5) + ENTRY_STALE_DAYS + 7)); // 252 sessions ≈ 366 days
  const tickers = [...new Set(list.map((p) => p.ticker))].sort();
  const values = list.map((p) => `(${sqlTicker(p.ticker)}, DATE '${p.asOf}')`).join(", ");
  const tickerList = tickers.map(sqlTicker).join(", ");
  const B = CALIBRATION_BENCHMARK;
  const leads = Object.values(HORIZONS)
    .map((h) => `LEAD(sq.date, ${h}) OVER w AS d${h}_date, LEAD(sq.close, ${h}) OVER w AS d${h}_close`)
    .join(",\n    ");
  const outCols = Object.values(HORIZONS)
    .map((h) => `strftime(e.d${h}_date, '%Y-%m-%d') AS d${h}_date, e.d${h}_close AS d${h}_close, s${h}.close AS spy_d${h}_close`)
    .join(",\n  ");
  const spyJoins = Object.values(HORIZONS)
    .map((h) => `LEFT JOIN spy_px s${h} ON s${h}.date = e.d${h}_date`)
    .join("\n");
  return `WITH universe(ticker, as_of) AS (VALUES ${values}),
sym_rank AS (
  SELECT u.ticker, g.symbol,
    ROW_NUMBER() OVER (PARTITION BY u.ticker ORDER BY (g.type = 'Common Stock') DESC, g.has_company_details DESC, g.symbol) AS pick
  FROM (SELECT DISTINCT ticker FROM universe) u JOIN shibui.general_info g ON g.ticker = u.ticker AND g.type <> 'ETF'
),
sym AS (SELECT s.ticker, s.symbol FROM sym_rank s WHERE s.pick = 1),
spy_px AS (
  SELECT sq.date, sq.close FROM shibui.stock_quotes sq
  JOIN shibui.general_info g ON g.symbol = sq.symbol AND g.ticker = '${B}' AND g.type = 'ETF'
  WHERE sq.ticker = '${B}' AND sq.date >= DATE '${lo}' AND sq.date <= DATE '${today}'
),
px1 AS (
  SELECT s.ticker, sq.date, sq.close,
    LN(sq.close / NULLIF(LAG(sq.close) OVER w, 0)) AS lr,
    ${leads}
  FROM sym s JOIN shibui.stock_quotes sq ON sq.symbol = s.symbol
  WHERE sq.ticker IN (${tickerList}) AND sq.date >= DATE '${lo}' AND sq.date <= DATE '${today}'
  WINDOW w AS (PARTITION BY s.ticker ORDER BY sq.date)
),
px AS (
  SELECT p.*,
    COUNT(p.lr) OVER v AS vol_n, VAR_SAMP(p.lr) OVER v AS vol_var
  FROM px1 p
  WINDOW v AS (PARTITION BY p.ticker ORDER BY p.date ROWS BETWEEN ${VOL_WINDOW - 1} PRECEDING AND CURRENT ROW)
),
entry AS (
  SELECT u.ticker, u.as_of, p.date, p.close, p.vol_n, p.vol_var,
    ${Object.values(HORIZONS).map((h) => `p.d${h}_date, p.d${h}_close`).join(", ")},
    ROW_NUMBER() OVER (PARTITION BY u.ticker, u.as_of ORDER BY p.date DESC) AS rn
  FROM universe u JOIN px p ON p.ticker = u.ticker
    AND p.date <= u.as_of AND p.date >= u.as_of - INTERVAL '${ENTRY_STALE_DAYS} days'
),
last_px AS (
  SELECT p.ticker, MAX(p.date) AS last_date, arg_max(p.close, p.date) AS last_close FROM px p GROUP BY p.ticker
)
SELECT u.ticker, strftime(u.as_of, '%Y-%m-%d') AS as_of, s.symbol,
  strftime(e.date, '%Y-%m-%d') AS entry_date, e.close AS entry_close, s0.close AS spy_entry_close,
  ${outCols},
  strftime(l.last_date, '%Y-%m-%d') AS latest_date, l.last_close AS latest_close, sl.close AS spy_latest_close,
  e.vol_n, e.vol_var
FROM universe u
LEFT JOIN sym s ON s.ticker = u.ticker
LEFT JOIN entry e ON e.ticker = u.ticker AND e.as_of = u.as_of AND e.rn = 1
LEFT JOIN last_px l ON l.ticker = u.ticker
LEFT JOIN spy_px s0 ON s0.date = e.date
${spyJoins}
LEFT JOIN spy_px sl ON sl.date = l.last_date
ORDER BY u.ticker, u.as_of
LIMIT 200`;
}

/** Split points into query-sized batches (deduped, stable order). */
export function outcomeBatches<T extends { ticker: string; asOf: string }>(points: T[], size = 100): T[][] {
  if (size < 1 || size > MAX_POINTS_PER_QUERY) throw new Error(`batch size must be 1..${MAX_POINTS_PER_QUERY}`);
  const uniq = [...new Map(points.map((p) => [pointKey(p.ticker, p.asOf), p])).values()];
  const out: T[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* parsing                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export interface Close { date: string; close: number; spyClose: number | null }

/** One result row of `outcomeQuery`, as parsed. */
export interface OutcomeRow {
  ticker: string;
  asOf: string;
  symbol: string | null;
  entry: Close | null;
  horizons: Record<keyof typeof HORIZONS, Close | null>;
  latest: Close | null;
  volN: number;
  volVar: number | null;
}

const num = (x: unknown): number | null => (finite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const close = (date: unknown, c: unknown, spy: unknown): Close | null => {
  const d = str(date), v = num(c);
  return d && v != null && v > 0 ? { date: d, close: v, spyClose: num(spy) } : null;
};

/**
 * Parse a saved stock_data_query response: `{"result":[...rows]}`, a bare row array, or the same as
 * a JSON string. Rows without ticker / as_of are dropped; missing closes become null.
 */
export function parseOutcomeResponse(raw: unknown): OutcomeRow[] {
  const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const rows = Array.isArray(body) ? body : (body as { result?: unknown })?.result;
  if (!Array.isArray(rows)) throw new Error("not a Shibui stock_data_query response (no result rows)");
  const out: OutcomeRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const ticker = str(r.ticker), asOf = str(r.as_of);
    if (!ticker || !asOf) continue;
    const horizons = {} as OutcomeRow["horizons"];
    for (const [k, h] of Object.entries(HORIZONS) as [keyof typeof HORIZONS, number][]) {
      horizons[k] = close(r[`d${h}_date`], r[`d${h}_close`], r[`spy_d${h}_close`]);
    }
    out.push({
      ticker: ticker.toUpperCase(), asOf, symbol: str(r.symbol),
      entry: close(r.entry_date, r.entry_close, r.spy_entry_close),
      horizons,
      latest: close(r.latest_date, r.latest_close, r.spy_latest_close),
      volN: num(r.vol_n) ?? 0,
      volVar: num(r.vol_var),
    });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* scoring                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export interface HorizonOutcome {
  date: string;
  sessions: number | null; // trading sessions after entry (null for `latest`, unknown without a count)
  days: number; // calendar days after the entry close
  ret: number; // close / entry close − 1 (price return, split-adjusted, not dividend-adjusted)
  spyRet: number | null;
  excess: number | null; // ret − spyRet
}

export type PointFlag =
  | "not-in-shibui" // no Shibui symbol for the ticker
  | "no-entry-close" // no Shibui close within ENTRY_STALE_DAYS on/before asOf
  | "entry-pending" // Shibui's latest close is before asOf: the quote day is not loaded yet (re-run later)
  | "price-mismatch" // report price vs Shibui entry close > PRICE_MISMATCH (possible split / data issue)
  | "price-mismatch-severe" // … > PRICE_MISMATCH_SEVERE: excluded from the aggregates
  | "latest-stale" // latest Shibui close older than LATEST_STALE_DAYS before today
  | "no-spy" // SPY close missing on the entry date
  | "short-vol-window" // fewer than VOL_MIN_OBS daily returns before asOf
  | "e-recomputed" // E/D/R re-derived from the revision's scenarios (pre-conviction revision)
  | "label-revised"; // the label changed across revisions sharing this asOf

export interface ScoredPoint {
  ticker: string;
  asOf: string;
  reportDate: string | null;
  label: Label;
  E: number;
  D: number;
  R: number | null;
  kappa: number | null;
  reportPrice: number;
  entry: { date: string; close: number; spyClose: number | null; priceGap: number } | null;
  horizons: Record<HorizonKey, HorizonOutcome | null>;
  realizedVol252: number | null; // annualized σ of daily log returns, VOL_WINDOW sessions to the entry date
  volObservations: number;
  flags: PointFlag[];
  sha: string | null;
  shas: (string | null)[];
  source: "current" | "git";
}

export type LabelGroup = "ALL" | "BUY+" | "HOLD" | "SELL-side";
export const LABEL_GROUPS: LabelGroup[] = ["ALL", "BUY+", "HOLD", "SELL-side"];
export const labelGroup = (l: Label): Exclude<LabelGroup, "ALL"> =>
  l === "BUY" || l === "STRONG BUY" ? "BUY+" : l === "HOLD" ? "HOLD" : "SELL-side";

/** A gated statistic: value null below MIN_N distinct names, with the reason. */
export interface Cell {
  n: number; // points
  nNames: number; // distinct tickers (the gating count)
  value: number | null;
  reason?: string;
}

export interface GroupHorizonStats {
  meanRet: Cell;
  medianRet: Cell;
  meanExcess: Cell;
  medianExcess: Cell;
  meanE: Cell;
  /** Median calendar days from entry to the horizon close (ungated; says how long "latest" really is). */
  medianDays: number | null;
  /** Share of points where sign(realized excess) == sign(E). */
  hitRate: Cell;
  /** Spearman rank correlation of E vs realized excess. */
  spearmanEvsExcess: Cell;
  /** mean realized return / mean E. E is a ~12-month expectation, so only d252 is like-for-like. */
  calibrationRatio: Cell;
  /** mean realized return / mean (E · sessions/252): assumes the upside accrues linearly over a year. */
  calibrationRatioProRata: Cell;
}

export interface CalibrationSummary {
  today: string;
  minN: number;
  points: number;
  names: number;
  /** Points left out of every aggregate, and why (still listed in `points`). */
  excluded: { ticker: string; asOf: string; reason: PointFlag }[];
  groups: Record<LabelGroup, Record<HorizonKey, GroupHorizonStats>>;
  notes: string[];
}

const round = (x: number, dp = 6) => Math.round(x * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ranks 1..n with ties sharing their average rank. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman's ρ: Pearson correlation of the (tie-averaged) ranks. Null when undefined (n < 2 or a constant series). */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rx = ranks(xs), ry = ranks(ys);
  const mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Join each point to its Shibui row and compute returns, excess, volatility and flags. */
export function scorePoint(p: PredictionPoint, row: OutcomeRow | undefined, today: string): ScoredPoint {
  const flags: PointFlag[] = [];
  if (p.eRecomputed) flags.push("e-recomputed");
  if (p.revisedLabels) flags.push("label-revised");
  const horizons = Object.fromEntries(HORIZON_KEYS.map((k) => [k, null])) as Record<HorizonKey, HorizonOutcome | null>;
  let entry: ScoredPoint["entry"] = null;
  let realizedVol252: number | null = null;
  if (!row?.symbol) flags.push("not-in-shibui");
  else if (!row.entry) flags.push("no-entry-close");
  else {
    const e = row.entry;
    const priceGap = p.reportPrice / e.close - 1;
    entry = { date: e.date, close: e.close, spyClose: e.spyClose, priceGap: round(priceGap) };
    if (row.latest && row.latest.date < p.asOf) flags.push("entry-pending");
    if (Math.abs(priceGap) > PRICE_MISMATCH) flags.push(Math.abs(priceGap) > PRICE_MISMATCH_SEVERE ? "price-mismatch-severe" : "price-mismatch");
    if (e.spyClose == null) flags.push("no-spy");
    const outcome = (c: Close | null, sessions: number | null): HorizonOutcome | null => {
      if (!c || c.date <= e.date) return null; // a horizon not yet reached, or "latest" is the entry day itself
      const ret = c.close / e.close - 1;
      const spyRet = e.spyClose != null && c.spyClose != null ? c.spyClose / e.spyClose - 1 : null;
      return { date: c.date, sessions, days: daysBetween(e.date, c.date), ret: round(ret), spyRet: spyRet == null ? null : round(spyRet), excess: spyRet == null ? null : round(ret - spyRet) };
    };
    for (const [k, h] of Object.entries(HORIZONS) as [keyof typeof HORIZONS, number][]) horizons[k] = outcome(row.horizons[k], h);
    horizons.latest = outcome(row.latest, null);
    if (row.latest && daysBetween(row.latest.date, today) > LATEST_STALE_DAYS) flags.push("latest-stale");
    if (row.volVar != null && row.volVar >= 0 && row.volN >= VOL_MIN_OBS) realizedVol252 = round(Math.sqrt(row.volVar * 252), 4);
    else flags.push("short-vol-window");
  }
  return {
    ticker: p.ticker, asOf: p.asOf, reportDate: p.reportDate, label: p.label,
    E: round(p.E), D: round(p.D), R: p.R == null ? null : round(p.R), kappa: p.kappa, reportPrice: p.reportPrice,
    entry, horizons, realizedVol252, volObservations: row?.volN ?? 0, flags,
    sha: p.sha, shas: p.shas, source: p.source,
  };
}

/** Flags that keep a point out of the aggregates (its numbers are not trustworthy). */
const EXCLUDING: PointFlag[] = ["not-in-shibui", "no-entry-close", "entry-pending", "price-mismatch-severe"];

function gate(values: number[], names: Set<string>, f: (xs: number[]) => number | null, what: string): Cell {
  const n = values.length, nNames = names.size;
  if (nNames < MIN_N) return { n, nNames, value: null, reason: `insufficient data: ${nNames} name(s) < MIN_N ${MIN_N}` };
  const v = f(values);
  return v == null || !Number.isFinite(v) ? { n, nNames, value: null, reason: `${what} undefined on this sample` } : { n, nNames, value: round(v, 4) };
}

function groupStats(pts: ScoredPoint[], k: HorizonKey): GroupHorizonStats {
  const withRet = pts.filter((p) => p.horizons[k]);
  const withEx = withRet.filter((p) => p.horizons[k]!.excess != null);
  const namesOf = (ps: ScoredPoint[]) => new Set(ps.map((p) => p.ticker));
  const ret = withRet.map((p) => p.horizons[k]!.ret);
  const ex = withEx.map((p) => p.horizons[k]!.excess!);
  const cr = (prorate: boolean) => (xs: number[]) => {
    const denom = mean(withRet.map((p) => {
      const sessions = p.horizons[k]!.sessions;
      return prorate ? (sessions == null ? NaN : p.E * (sessions / 252)) : p.E;
    }));
    return Number.isFinite(denom) && Math.abs(denom) > 1e-9 ? mean(xs) / denom : null;
  };
  return {
    meanRet: gate(ret, namesOf(withRet), mean, "mean"),
    medianRet: gate(ret, namesOf(withRet), median, "median"),
    meanExcess: gate(ex, namesOf(withEx), mean, "mean"),
    medianExcess: gate(ex, namesOf(withEx), median, "median"),
    meanE: gate(withRet.map((p) => p.E), namesOf(withRet), mean, "mean"),
    medianDays: withRet.length ? median(withRet.map((p) => p.horizons[k]!.days)) : null,
    hitRate: gate(ex, namesOf(withEx), (xs) => mean(xs.map((x, i) => (sign(x) === sign(withEx[i].E) ? 1 : 0))), "hit rate"),
    spearmanEvsExcess: gate(ex, namesOf(withEx), (xs) => spearman(withEx.map((p) => p.E), xs), "Spearman"),
    calibrationRatio: gate(ret, namesOf(withRet), cr(false), "ratio (mean E ≈ 0)"),
    calibrationRatioProRata: k === "latest"
      ? { n: ret.length, nNames: namesOf(withRet).size, value: null, reason: "no session count for the to-date horizon" }
      : gate(ret, namesOf(withRet), cr(true), "ratio (mean E ≈ 0)"),
  };
}

/**
 * Score every point against its Shibui row and aggregate by label group and horizon. Pure:
 * `today` (YYYY-MM-DD) is passed in. Points with an excluding flag stay in the per-point log but
 * not in the aggregates.
 */
export function scorePoints(points: PredictionPoint[], outcomes: OutcomeRow[], today: string): { points: ScoredPoint[]; summary: CalibrationSummary } {
  if (!isYmd(today)) throw new Error(`bad today ${today}`);
  const rows = new Map(outcomes.map((r) => [pointKey(r.ticker, r.asOf), r]));
  const scored = points.map((p) => scorePoint(p, rows.get(pointKey(p.ticker, p.asOf)), today));
  const excluded: CalibrationSummary["excluded"] = [];
  const usable = scored.filter((p) => {
    const bad = EXCLUDING.find((f) => p.flags.includes(f));
    if (bad) excluded.push({ ticker: p.ticker, asOf: p.asOf, reason: bad });
    return !bad;
  });
  const groups = {} as CalibrationSummary["groups"];
  for (const g of LABEL_GROUPS) {
    const pts = g === "ALL" ? usable : usable.filter((p) => labelGroup(p.label) === g);
    groups[g] = Object.fromEntries(HORIZON_KEYS.map((k) => [k, groupStats(pts, k)])) as Record<HorizonKey, GroupHorizonStats>;
  }
  return {
    points: scored,
    summary: {
      today, minN: MIN_N, points: scored.length, names: new Set(scored.map((p) => p.ticker)).size, excluded, groups,
      notes: [
        `Cells are null below MIN_N = ${MIN_N} distinct names; n counts points, nNames distinct tickers (overlapping points of one name are not independent).`,
        "Returns are Shibui price returns: split-adjusted, NOT dividend-adjusted (dividend payers and SPY understate total return).",
        "Entry = Shibui close on/before the report's quote date (asOf); horizons are trading sessions after that close. Points whose quote day Shibui has not loaded yet (entry-pending) wait for the next run.",
        `price-mismatch (> ${PRICE_MISMATCH * 100}%) is flagged but kept (mostly an intraday report price vs the close); > ${PRICE_MISMATCH_SEVERE * 100}% is excluded.`,
        "The to-date (latest) horizon mixes holding periods (see medianDays); a few weeks of returns is noise, not evidence.",
        "E is the report's expected upside vs its own price (a ~12-month fair-value gap); only d252 compares like-for-like. calibrationRatioProRata assumes linear accrual.",
        "hitRate = share of points where sign(excess vs SPY) == sign(E). Survivor-only data: a delisted name would drop out.",
      ],
    },
  };
}
