/** build.ts — raw directory in, FactPack out. Refuses to write on any failure. */
import { basename } from "node:path";
import { readRawJson } from "./raw";
import { FactPack, FACTPACK_SCHEMA_VERSION } from "./schema";
import { assertValidFactPack } from "./validate";
import { RAW_CAPTURE_META } from "./manifest";
import * as quote from "./map/quote";
import * as statements from "./map/statements";
import * as segments from "./map/segments";
import * as analysts from "./map/analysts";
import * as history from "./map/history";
import * as context from "./map/context";
import * as cover from "./map/cover";

const EDGAR_FILING_FILE = "edgar-filing.json";
export const READS = [RAW_CAPTURE_META, EDGAR_FILING_FILE] as const;

export function buildFactPack(dir: string): FactPack {
  const meta = readRawJson(dir, RAW_CAPTURE_META) as { capturedAt: string };
  const filing = readRawJson(dir, EDGAR_FILING_FILE) as {
    form: "10-Q" | "10-K"; accession: string; filedDate: string; periodEnd: string; url: string; ticker: string; cik: number; company: string;
    pressRelease?: { url: string; filedDate: string } | null; annualReport?: { url: string; filedDate: string } | null;
    proxyStatement?: { url: string; filedDate: string } | null };
  if (filing.accession !== basename(dir)) throw new Error(`edgar-filing.json accession ${filing.accession} ≠ directory ${basename(dir)}`);

  const q = quote.mapQuote(dir);
  if (q.cik !== filing.cik) throw new Error(`CIK mismatch: tearsheet ${q.cik} vs EDGAR ${filing.cik}`);
  const s = statements.mapStatements(dir);
  const latestFY = Number("20" + s.statements.fiscalYears[4].slice(2));
  const g = segments.mapSegments(dir);
  const a = analysts.mapAnalysts(dir, latestFY);
  const h = history.mapHistory(dir, meta.capturedAt);
  const c = context.mapContext(dir, filing, meta.capturedAt, q.description);
  const cov = cover.mapCover(dir);

  const usesCover = cov.sharesOutstanding != null;
  const quoteFacts: FactPack["quote"] = {
    ...q.quote,
    sharesOutstanding: cov.sharesOutstanding ?? q.quote.sharesOutstanding,
    sharesSource: usesCover ? "cover" : "derived",
  };

  const stamp = (rows: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[]) =>
    rows.map((r) => ({ ...r, capturedAt: meta.capturedAt }));

  const quoteProvenance = usesCover ? quote.PROVENANCE.filter((r) => r.field !== "quote.sharesOutstanding") : quote.PROVENANCE;
  const sharesProvenance = usesCover ? cover.PROVENANCE : [];

  const pack: FactPack = {
    schemaVersion: FACTPACK_SCHEMA_VERSION,
    ticker: filing.ticker, cik: filing.cik, company: q.company, exchange: q.exchange,
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
