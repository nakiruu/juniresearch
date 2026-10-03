/**
 * earnings.ts — each covered name's latest earnings result, the input the stale-on-bad-news entry gate needs
 * (stale-entry.ts). Shibui is a Claude connector, not an HTTP API, so the trader never queries it:
 *
 *   scripts/trade-earnings.ts --query   prints the Shibui call for every report ticker;
 *   the capturer runs it (mcp__Shibui_Finance__stock_data_query) and saves the response verbatim
 *   under data/raw/_shibui/;
 *   scripts/trade-earnings.ts --apply   writes data/earnings/latest.json.
 *
 * The file is committed and baked into the image with the reports, so a refresh reaches the trader on the next
 * rebuild. Reading is fail-open: an absent or unreadable file means no earnings, and with no earnings the gate
 * never bars an entry.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const EARNINGS_PATH = join("data", "earnings", "latest.json");
export const EARNINGS_USER_PROMPT = "Capture each covered name's latest earnings surprise for the Juniper stale-on-bad-news entry gate";
/** Shibui returns at most 200 rows per query; one row per ticker. */
export const MAX_TICKERS_PER_QUERY = 200;
/** How far back the query looks for a reported quarter. */
const LOOKBACK_DAYS = 400;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const LastEarnings = z.object({
  reportDate: ymd,
  /** (actual − estimate) / |estimate| × 100, as Shibui reports it; negative = a miss. */
  surprisePct: z.number(),
  epsActual: z.number().nullable(),
  epsEstimate: z.number().nullable(),
});
export type LastEarnings = z.infer<typeof LastEarnings>;
export const EarningsFile = z.object({
  asOf: ymd,
  source: z.literal("shibui"),
  /** Tickers the query asked for that had no reported quarter with a surprise (no entry → the gate never applies). */
  missing: z.array(z.string()),
  byTicker: z.record(z.string(), LastEarnings),
});
export type EarningsFile = z.infer<typeof EarningsFile>;

const sqlTicker = (t: string) => {
  if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) throw new Error(`refusing to put ticker ${JSON.stringify(t)} into SQL`);
  return `'${t}'`;
};

/** The Shibui SQL (DuckDB): the latest reported quarter on or before `asOf` per ticker, one row per ticker. */
export function earningsQuery(tickers: string[], asOf: string): string {
  if (!ymd.safeParse(asOf).success) throw new Error(`bad asOf ${asOf}`);
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))].sort();
  if (!list.length) throw new Error("earningsQuery needs at least one ticker");
  if (list.length > MAX_TICKERS_PER_QUERY) throw new Error(`Shibui returns at most ${MAX_TICKERS_PER_QUERY} rows — split the batch`);
  const values = list.map((t) => `(${sqlTicker(t)})`).join(", ");
  const inList = list.map(sqlTicker).join(", ");
  return `WITH universe(ticker) AS (VALUES ${values}),
e AS (
  SELECT e.ticker, e.report_date, e.eps_actual, e.eps_estimate, e.eps_difference, e.surprise_percent,
    ROW_NUMBER() OVER (PARTITION BY e.ticker ORDER BY e.report_date DESC) AS rn
  FROM shibui.earnings_quarterly e
  WHERE e.ticker IN (${inList})
    AND e.report_date BETWEEN DATE '${asOf}' - INTERVAL ${LOOKBACK_DAYS} DAY AND DATE '${asOf}'
    AND e.eps_actual IS NOT NULL
    AND (e.surprise_percent IS NOT NULL OR (e.eps_estimate IS NOT NULL AND e.eps_estimate <> 0))
)
SELECT u.ticker, strftime(e.report_date, '%Y-%m-%d') AS report_date,
  e.eps_actual, e.eps_estimate, e.eps_difference, e.surprise_percent
FROM universe u LEFT JOIN e ON e.ticker = u.ticker AND e.rn = 1
ORDER BY u.ticker
LIMIT ${MAX_TICKERS_PER_QUERY}`;
}

/** Splits tickers into query-sized batches. */
export function earningsBatches(tickers: string[], size = MAX_TICKERS_PER_QUERY): string[][] {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))].sort();
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/**
 * One saved `stock_data_query` response (or a JSON array of them) → the latest result per ticker. A row with no
 * report date, or no surprise Shibui gives or the EPS pair implies, is left out. Throws on a body that is not a
 * Shibui response at all.
 */
export function parseEarningsResponse(raw: unknown): { byTicker: Record<string, LastEarnings>; asked: string[] } {
  const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const isResponse = (x: unknown): x is { result: unknown[] } =>
    !!x && typeof x === "object" && !Array.isArray(x) && Array.isArray((x as { result?: unknown }).result);
  // One response, an array of responses (several batches), or a bare array of rows.
  const rowSets: unknown[][] = isResponse(body) ? [body.result]
    : Array.isArray(body) && body.every(isResponse) ? body.map((b) => b.result)
    : Array.isArray(body) ? [body]
    : [];
  if (!isResponse(body) && !Array.isArray(body)) throw new Error("not a Shibui stock_data_query response (no result rows)");
  const byTicker: Record<string, LastEarnings> = {};
  const asked: string[] = [];
  for (const rows of rowSets) {
    for (const r of rows as Record<string, unknown>[]) {
      const ticker = str(r.ticker)?.toUpperCase();
      if (!ticker) continue;
      asked.push(ticker);
      const reportDate = str(r.report_date);
      const actual = num(r.eps_actual), estimate = num(r.eps_estimate), diff = num(r.eps_difference);
      const surprise = num(r.surprise_percent)
        ?? (actual != null && estimate != null && estimate !== 0 ? ((diff ?? actual - estimate) / Math.abs(estimate)) * 100 : null);
      if (!reportDate || !ymd.safeParse(reportDate).success || surprise == null) continue;
      byTicker[ticker] = { reportDate, surprisePct: surprise, epsActual: actual, epsEstimate: estimate };
    }
  }
  return { byTicker, asked };
}

/** Saved responses → the file --apply writes. */
export function buildEarningsFile(responses: unknown[], asOf: string): EarningsFile {
  const byTicker: Record<string, LastEarnings> = {};
  const asked = new Set<string>();
  for (const r of responses) {
    const p = parseEarningsResponse(r);
    Object.assign(byTicker, p.byTicker);
    p.asked.forEach((t) => asked.add(t));
  }
  const missing = [...asked].filter((t) => !byTicker[t]).sort();
  const sorted = Object.fromEntries(Object.keys(byTicker).sort().map((t) => [t, byTicker[t]]));
  return EarningsFile.parse({ asOf, source: "shibui", missing, byTicker: sorted });
}

/**
 * The latest result per ticker from data/earnings/latest.json. Fail-open: an absent file is {} (silently), an
 * unreadable or invalid one is {} with `warning` set — the gate then bars nothing, so trading is never
 * stopped by this input.
 */
export function readEarnings(path = EARNINGS_PATH): { byTicker: Record<string, LastEarnings>; asOf: string | null; warning?: string } {
  if (!existsSync(path)) return { byTicker: {}, asOf: null };
  try {
    const f = EarningsFile.parse(JSON.parse(readFileSync(path, "utf8")));
    return { byTicker: f.byTicker, asOf: f.asOf };
  } catch (e) {
    return { byTicker: {}, asOf: null, warning: `${path} unreadable (${e instanceof Error ? e.message : String(e)}) — stale-entry gate off this run` };
  }
}
