/** build.ts — raw directory in, FactPack out. Refuses to write on any failure. */
import { basename } from "node:path";
import { readRawJson, readRawText } from "./raw";
import { htmlToText } from "../edgar/filing-text";
import { FactPack, FACTPACK_SCHEMA_VERSION } from "./schema";
import { assertValidFactPack } from "./validate";
import { RAW_CAPTURE_META } from "./manifest";
import { detectCaptureSource, provenanceFor } from "./capture-source";
import * as quote from "./map/quote";
import * as statements from "./map/statements";
import * as segments from "./map/segments";
import * as analysts from "./map/analysts";
import * as history from "./map/history";
import * as context from "./map/context";
import * as cover from "./map/cover";

const EDGAR_FILING_FILE = "edgar-filing.json";
const EDGAR_PRIMARY_FILE = "edgar-primary.html";
export const READS = [RAW_CAPTURE_META, EDGAR_FILING_FILE, EDGAR_PRIMARY_FILE] as const;

export function buildFactPack(dir: string): FactPack {
  const meta = readRawJson(dir, RAW_CAPTURE_META) as { capturedAt: string };
  const filing = readRawJson(dir, EDGAR_FILING_FILE) as {
    form: "10-Q" | "10-K"; accession: string; filedDate: string; periodEnd: string; url: string; ticker: string; cik: number; company: string;
    sic?: number | null; sicDescription?: string | null;
    pressRelease?: { url: string; filedDate: string } | null; annualReport?: { url: string; filedDate: string } | null;
    proxyStatement?: { url: string; filedDate: string } | null };
  if (filing.accession !== basename(dir)) throw new Error(`edgar-filing.json accession ${filing.accession} ≠ directory ${basename(dir)}`);

  const q = quote.mapQuote(dir);
  if (q.cik !== filing.cik) throw new Error(`CIK mismatch: tearsheet ${q.cik} vs EDGAR ${filing.cik}`);
  const s = statements.mapStatements(dir);
  const latestFY = Number("20" + s.statements.fiscalYears.at(-1)!.slice(2));
  const g = segments.mapSegments(dir);
  const a = analysts.mapAnalysts(dir, latestFY);
  const h = history.mapHistory(dir, meta.capturedAt);
  // edgar-primary.html (often several MB) feeds both the excerpts and the cover-page share count:
  // convert it to text once.
  const primaryText = htmlToText(readRawText(dir, EDGAR_PRIMARY_FILE));
  const c = context.mapContext(dir, filing, meta.capturedAt, q.description, primaryText);
  const cov = cover.mapCover(dir, primaryText);

  const usesCover = cov.sharesOutstanding != null;
  const quoteFacts: FactPack["quote"] = {
    ...q.quote,
    sharesOutstanding: cov.sharesOutstanding ?? q.quote.sharesOutstanding,
    sharesSource: usesCover ? "cover" : "derived",
  };

  // The tearsheet-shaped files are written either by the fetch-facts skill (Bigdata.com responses) or by
  // facts:free (SEC XBRL + Yahoo); the mappers' rows name the Bigdata endpoints, so relabel for the latter.
  const captureSource = detectCaptureSource(dir);
  const stamp = (rows: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[]) =>
    provenanceFor(rows, captureSource).map((r) => ({ ...r, capturedAt: meta.capturedAt }));

  const quoteProvenance = usesCover ? quote.PROVENANCE.filter((r) => r.field !== "quote.sharesOutstanding") : quote.PROVENANCE;
  const sharesProvenance = usesCover ? cover.PROVENANCE : [];

  const pack: FactPack = {
    schemaVersion: FACTPACK_SCHEMA_VERSION,
    ticker: filing.ticker, cik: filing.cik, company: q.company, exchange: q.exchange,
    ...(filing.sic != null ? { sic: filing.sic } : {}),
    ...(filing.sicDescription != null ? { sicDescription: filing.sicDescription } : {}),
    filing: { form: filing.form, accession: filing.accession, filedDate: filing.filedDate, periodEnd: filing.periodEnd, url: filing.url },
    capturedAt: meta.capturedAt,
    quote: quoteFacts, statements: s.statements, latestQuarter: s.latestQuarter, ttm: s.ttm,
    estimates: a.estimates, analysts: a.analysts, segments: g.segments, geoMix: g.geoMix, peers: a.peers,
    history: h, context: c,
    provenance: [
      ...stamp(quoteProvenance), ...stamp(sharesProvenance), ...stamp(statements.PROVENANCE), ...stamp(segments.PROVENANCE),
      ...stamp(analysts.PROVENANCE), ...stamp(history.PROVENANCE), ...stamp(context.PROVENANCE),
    ],
  };
  FactPack.parse(pack);
  assertValidFactPack(pack, `${filing.ticker}/${filing.accession}`);
  return pack;
}
