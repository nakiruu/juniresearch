/**
 * capture-source.ts — which producer wrote a capture's three tearsheet-shaped files
 * (bigdata-tearsheet-annual.json, bigdata-statements-annual.json, bigdata-statements-quarter.json),
 * and the provenance rows that follow from it.
 *
 * Two producers write those files under the same names and in the same shape:
 *   - the fetch-facts skill saves Bigdata.com company_tearsheet responses verbatim ("bigdata");
 *   - `npm run facts:free` (lib/facts/free/*) assembles them from SEC companyfacts XBRL (merged with
 *     the filing's and prior 10-K's inline XBRL) and Yahoo quoteSummary ("free").
 * The mappers under lib/facts/map/ read either unchanged, so their PROVENANCE tables describe the
 * Bigdata endpoints; for a free capture build.ts relabels the rows below via provenanceFor().
 *
 * Detection: facts:free writes FREE_CAPTURE_MARKER next to the files. Captures written before the
 * marker existed are recognised by the emitter's fixed shape, which a Bigdata response never has:
 * company_overview carries exactly the seven keys emit.ts writes (Bigdata's carries ~25: sector,
 * ceo, isin, currency, ...), and the quarterly statements' `fundamentals` holds only
 * `income_statement` (Bigdata's also carries balance_sheet, cash_flow, periodicity, source, ...).
 * Both signatures must agree; a capture where they disagree is inconsistent and refused.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readRawJson, type Rec } from "./raw";
import type { FactPack } from "./schema";

export type CaptureSource = "bigdata" | "free";
type ProvenanceSource = FactPack["provenance"][number]["source"];
export type ProvenanceRow = { field: string; endpoint: string; source: ProvenanceSource };

export const FREE_CAPTURE_MARKER = "free-capture.json";
const SHEET = "bigdata-tearsheet-annual.json", QUARTER = "bigdata-statements-quarter.json";

/** The company_overview keys lib/facts/free/emit.ts writes — no more, no fewer. */
export const FREE_OVERVIEW_KEYS = ["cik", "company_name", "description", "exchange", "market_cap", "price", "timestamp"] as const;

const sameKeys = (o: unknown, keys: readonly string[]) =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join(",") === [...keys].sort().join(",");

/** Shape signatures of an unmarked capture: [tearsheet looks free, quarterly statements look free]. */
export function freeShapeSignatures(dir: string): [boolean, boolean] {
  const ts = readRawJson(dir, SHEET) as Rec;
  const q = readRawJson(dir, QUARTER) as Rec;
  return [sameKeys(ts?.company_overview, FREE_OVERVIEW_KEYS), sameKeys(q?.fundamentals, ["income_statement"])];
}

/** Which producer wrote the capture's tearsheet-shaped files. Throws when the shape signatures disagree. */
export function detectCaptureSource(dir: string): CaptureSource {
  if (existsSync(join(dir, FREE_CAPTURE_MARKER))) return "free";
  const [sheet, quarter] = freeShapeSignatures(dir);
  if (sheet !== quarter)
    throw new Error(`Cannot tell who wrote ${dir}: ${SHEET} looks ${sheet ? "facts:free" : "Bigdata"}-shaped but ${QUARTER} looks ${quarter ? "facts:free" : "Bigdata"}-shaped`);
  return sheet ? "free" : "bigdata";
}

const SEC_ANNUAL = "SEC companyfacts XBRL (annual 10-K facts), merged with the filing's and prior 10-K's inline XBRL when captured";
const SEC_QUARTER = "SEC companyfacts XBRL (discrete quarters), merged with the filing's inline XBRL when captured";

/**
 * The true source of each tearsheet-derived field for a facts:free capture. Fields absent here
 * (peers from fmp-peers.json, history from yahoo-history.json, the EDGAR excerpts, the
 * bigdata_search transcript/headlines, the cover-page share count) come from files facts:free does
 * not write, so their mapper rows stand.
 */
export const FREE_PROVENANCE: Readonly<Record<string, { source: ProvenanceSource; endpoint: string }>> = {
  quote: { source: "yahoo", endpoint: "yahoo quoteSummary price.regularMarketPrice + price.marketCap + summaryDetail.fiftyTwoWeekLow/High (facts:free)" },
  "quote.sharesOutstanding": { source: "yahoo", endpoint: "derived: yahoo quoteSummary price.marketCap / price.regularMarketPrice (facts:free)" },
  "quote.dividendYield": { source: "yahoo", endpoint: "yahoo quoteSummary summaryDetail.dividendYield (trailingAnnualDividendYield fallback) (facts:free)" },
  company: { source: "yahoo", endpoint: "yahoo quoteSummary price.longName (shortName fallback) (facts:free)" },
  "context.description": { source: "yahoo", endpoint: "yahoo quoteSummary assetProfile.longBusinessSummary (facts:free)" },
  statements: { source: "edgar", endpoint: `${SEC_ANNUAL} (facts:free)` },
  latestQuarter: { source: "edgar", endpoint: `${SEC_QUARTER} (facts:free)` },
  ttm: { source: "edgar", endpoint: `derived: last four discrete quarters + latest balance sheet from ${SEC_QUARTER}; P/E, P/S, EV/EBITDA and FCF yield priced with yahoo quoteSummary price/market cap (P/E falls back to summaryDetail.trailingPE when quarterly EPS cannot be summed) (facts:free)` },
  segments: { source: "edgar", endpoint: "derived: single 'Consolidated' segment from the latest SEC annual revenue (facts:free emits no product segmentation)" },
  geoMix: { source: "edgar", endpoint: "none: facts:free emits no geographic segmentation (empty mix)" },
  analysts: { source: "yahoo", endpoint: "yahoo quoteSummary financialData target*Price + recommendationKey + recommendationTrend.trend[0] (facts:free)" },
  estimates: { source: "yahoo", endpoint: "yahoo quoteSummary earningsTrend annual periods (revenueEstimate.avg, earningsEstimate.avg) (facts:free)" },
};

/** The bigdata-labelled mapper rows a free capture relabels — exactly these, so a re-run is a no-op. */
export function isTearsheetBigdataRow(row: { field: string; source: string; endpoint: string }): boolean {
  if (!(row.field in FREE_PROVENANCE) || row.source !== "bigdata") return false;
  return row.endpoint.startsWith("bigdata_company_tearsheet") || (row.field === "quote.sharesOutstanding" && row.endpoint === "derived: market_cap / price");
}

/** Relabel mapper provenance rows for the producer that wrote the capture; Bigdata captures pass through. */
export function provenanceFor<T extends { field: string; source: ProvenanceSource | string; endpoint: string }>(rows: T[], source: CaptureSource): T[] {
  if (source === "bigdata") return rows;
  return rows.map((r) => (isTearsheetBigdataRow(r) ? { ...r, ...FREE_PROVENANCE[r.field] } : r));
}
