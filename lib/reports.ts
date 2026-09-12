/**
 * reports.ts — the only place the report archive is read from disk.
 * -----------------------------------------------------------------------------
 * Every read passes through Report.parse() and assertValidReport(), so a
 * malformed or internally inconsistent report fails the build rather than
 * rendering a broken page.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
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

export async function listReportTickers(): Promise<string[]> {
  const entries = await readdir(DATA_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "").toLowerCase())
    .sort();
}

export async function loadReport(ticker: string): Promise<Report | null> {
  const slug = ticker.toLowerCase();
  if (!TICKER_PATTERN.test(slug)) return null;

  let raw: string;
  try {
    raw = await readFile(path.join(DATA_DIR, `${slug}.json`), "utf8");
  } catch {
    return null;
  }

  const report = Report.parse(JSON.parse(raw));
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
