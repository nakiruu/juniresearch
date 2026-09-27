/**
 * reports.ts — the only place the report archive is read from disk.
 * -----------------------------------------------------------------------------
 * Every read passes through Report.parse() and assertValidReport(), so a
 * malformed or internally inconsistent report fails the build rather than
 * rendering a broken page.
 *
 * Memoization: a report page calls loadReport() from both generateMetadata and
 * the page, and the index loads every report, so without a memo each file was
 * read, parsed and validated several times per build worker. During
 * `next build` the archive is immutable, so results are memoized per process,
 * keyed by slug. Anywhere else the files may change underneath a long-lived
 * process — next dev, and `next start`, where the in-process trade scheduler
 * (lib/trade/runtime.ts) must see newly published reports — so only React's
 * per-request `cache()` dedupes (the metadata + page pair within one render)
 * and every call re-reads the disk. Failed loads are never memoized.
 */
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { Report } from "./report.schema";
import { assertValidReport } from "./validate";

const DATA_DIR = path.join(process.cwd(), "data");
const TICKER_PATTERN = /^[a-z0-9.-]+$/;

export interface ReportSummary {
  ticker: string;
  company: string;
  exchange: string;
  subtitle: string;
  reportDate: string;
  rating: Report["rating"];
  currentPrice: number;
}

/** Process-lifetime memo, on only during `next build`, where the data directory cannot change. */
const memoize = () => process.env.NEXT_PHASE === "phase-production-build";
const reportMemo = new Map<string, Promise<Report | null>>();
let tickersMemo: Promise<string[]> | null = null;

/** Drops every memoized result (for tests that toggle NEXT_PHASE). */
export function resetReportCache(): void {
  reportMemo.clear();
  tickersMemo = null;
}

async function readTickers(): Promise<string[]> {
  const entries = await fsPromises.readdir(DATA_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "").toLowerCase())
    .sort();
}

export function listReportTickers(): Promise<string[]> {
  if (!memoize()) return readTickers();
  if (!tickersMemo) {
    const p = readTickers();
    tickersMemo = p;
    p.catch(() => { if (tickersMemo === p) tickersMemo = null; });
  }
  return tickersMemo;
}

async function readReport(slug: string): Promise<Report | null> {
  let raw: string;
  try {
    raw = await fsPromises.readFile(path.join(DATA_DIR, `${slug}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const report = Report.parse(JSON.parse(raw));
  const declared = report.meta.ticker.toLowerCase();
  if (declared !== slug) {
    throw new Error(
      `Report file "${slug}.json" declares meta.ticker "${report.meta.ticker}" — ` +
      `the filename must be the lower-cased ticker so routes and index links agree`,
    );
  }
  assertValidReport(report, report.meta.ticker);
  return report;
}

/** Per-request dedupe (React server render only; a passthrough elsewhere). */
const readReportOncePerRequest = cache(readReport);

export function loadReport(ticker: string): Promise<Report | null> {
  const slug = ticker.toLowerCase();
  if (!TICKER_PATTERN.test(slug)) return Promise.resolve(null);
  if (!memoize()) return readReportOncePerRequest(slug);
  let p = reportMemo.get(slug);
  if (!p) {
    p = readReport(slug);
    reportMemo.set(slug, p);
    const pending = p;
    pending.catch(() => { if (reportMemo.get(slug) === pending) reportMemo.delete(slug); });
  }
  return p;
}

export async function listReports(): Promise<ReportSummary[]> {
  const tickers = await listReportTickers();
  const reports = await Promise.all(tickers.map((t) => loadReport(t)));
  return reports
    .filter((r): r is Report => r !== null)
    .map((r) => ({
      ticker: r.meta.ticker,
      company: r.meta.company,
      exchange: r.meta.exchange,
      subtitle: r.meta.subtitle,
      reportDate: r.meta.reportDate,
      rating: r.rating,
      currentPrice: r.quote.currentPrice,
    }))
    .sort((a, b) => Date.parse(b.reportDate) - Date.parse(a.reportDate));
}
