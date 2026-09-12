/**
 * reports.ts — the only place the report archive is read from disk.
 * -----------------------------------------------------------------------------
 * Every read passes through Report.parse() and assertValidReport(), so a
 * malformed or internally inconsistent report fails the build rather than
 * rendering a broken page.
 */
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { Report } from "./report.schema";
import { assertValidReport } from "./validate";

const DATA_DIR = path.join(process.cwd(), "data");
const TICKER_PATTERN = /^[a-z0-9.-]+$/;
/** Pipeline state files that live alongside reports in data/ but are not reports. */
const NON_REPORT_FILES = new Set(["watchlist.json"]);

export interface ReportSummary {
  ticker: string;
  company: string;
  exchange: string;
  subtitle: string;
  reportDate: string;
  rating: Report["rating"];
  currentPrice: number;
}

export async function listReportTickers(): Promise<string[]> {
  const entries = await fsPromises.readdir(DATA_DIR);
  return entries
    .filter((f) => f.endsWith(".json") && !NON_REPORT_FILES.has(f))
    .map((f) => f.replace(/\.json$/, "").toLowerCase())
    .sort();
}

export async function loadReport(ticker: string): Promise<Report | null> {
  const slug = ticker.toLowerCase();
  if (!TICKER_PATTERN.test(slug)) return null;

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
