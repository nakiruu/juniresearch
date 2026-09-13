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

type Source = "fmp" | "bigdata" | "edgar" | "yahoo";

export function buildFactPack(dir: string): FactPack {
  const meta = readRawJson(dir, RAW_CAPTURE_META) as { capturedAt: string };
  const filing = readRawJson(dir, "edgar-filing.json") as {
    form: "10-Q" | "10-K"; accession: string; filedDate: string; periodEnd: string; url: string; ticker: string; cik: number; company: string };
  if (filing.accession !== basename(dir)) throw new Error(`edgar-filing.json accession ${filing.accession} ≠ directory ${basename(dir)}`);

  const q = quote.mapQuote(dir);
  const s = statements.mapStatements(dir);
  const latestFY = Number("20" + s.statements.fiscalYears[4].slice(2));
  const g = segments.mapSegments(dir);
  const a = analysts.mapAnalysts(dir, latestFY);
  const h = history.mapHistory(dir, meta.capturedAt);
  const c = context.mapContext(dir, filing, meta.capturedAt, q.description);

  const stamp = (source: Source, rows: { field: string; endpoint: string }[]) => rows.map((r) => ({ ...r, source, capturedAt: meta.capturedAt }));
  const peersProv = analysts.PROVENANCE.filter((r) => r.field === "peers");
  const bigdataProv = analysts.PROVENANCE.filter((r) => r.field !== "peers");

  const pack: FactPack = {
    schemaVersion: FACTPACK_SCHEMA_VERSION,
    ticker: filing.ticker, cik: filing.cik, company: q.company, exchange: q.exchange,
    filing: { form: filing.form, accession: filing.accession, filedDate: filing.filedDate, periodEnd: filing.periodEnd, url: filing.url },
    capturedAt: meta.capturedAt,
    quote: q.quote, statements: s.statements, latestQuarter: s.latestQuarter, ttm: s.ttm,
    estimates: a.estimates, analysts: a.analysts, segments: g.segments, geoMix: g.geoMix, peers: a.peers,
    history: h, context: c,
    provenance: [
      ...stamp("bigdata", quote.PROVENANCE), ...stamp("bigdata", statements.PROVENANCE), ...stamp("bigdata", segments.PROVENANCE),
      ...stamp("bigdata", bigdataProv), ...stamp("fmp", peersProv), ...stamp("yahoo", history.PROVENANCE),
      ...stamp("edgar", context.PROVENANCE.slice(0, 2)), ...stamp("bigdata", context.PROVENANCE.slice(2)),
    ],
  };
  FactPack.parse(pack);
  assertValidFactPack(pack, `${filing.ticker}/${filing.accession}`);
  return pack;
}
