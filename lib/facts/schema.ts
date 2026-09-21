/**
 * schema.ts — the FactPack: everything subsystem 3 needs to write a report.
 * -----------------------------------------------------------------------------
 * Numbers are raw, ratios are ratios, nothing is pre-formatted. Every field a
 * Report fact derives from has a provenance entry. Statement cells may be null
 * where a vendor lacks a year; the Report's own cell contract renders null as —.
 */
import { z } from "zod";

export const FACTPACK_SCHEMA_VERSION = "1.2.0";

const ratio = z.number();
const nullableNum = z.number().nullable();

export const Excerpt = z.object({
  text: z.string(),
  source: z.string(),
  url: z.string().optional(),
  asOf: z.string(),
  truncated: z.boolean().optional(),
});

export const StatementRow = z.object({
  key: z.string(),
  label: z.string(),
  values: z.array(nullableNum).min(3).max(5), // one cell per fiscal year; a recently listed company may have as few as 3
});

export const HistoryPoint = z.object({ date: z.string(), close: z.number() });

const estimate = z.object({ label: z.string(), revenue: nullableNum, eps: nullableNum });

export const FactPack = z.object({
  schemaVersion: z.literal(FACTPACK_SCHEMA_VERSION),
  ticker: z.string(),
  cik: z.number().int(),
  company: z.string(),
  exchange: z.string(),
  // SEC Standard Industrial Classification, for sector-aware downstream logic
  // (e.g. the rating gates). Optional: FactPacks captured before it was persisted omit it.
  sic: z.number().int().optional(),
  sicDescription: z.string().optional(),
  // Goodwill per fiscal year (aligned to statements.fiscalYears) for ex-goodwill ROIC in the
  // moat engine. Optional: FactPacks captured before it was persisted omit it.
  goodwill: z.array(nullableNum).optional(),
  filing: z.object({
    form: z.enum(["10-Q", "10-K"]),
    accession: z.string(),
    filedDate: z.string(),
    periodEnd: z.string(),
    url: z.string(),
  }),
  capturedAt: z.string(),
  quote: z.object({
    price: z.number(), marketCap: z.number(), sharesOutstanding: z.number(), sharesSource: z.enum(["cover", "derived"]),
    week52Low: z.number(), week52High: z.number(), dividendYield: ratio, asOf: z.string(),
  }),
  statements: z.object({
    fiscalYears: z.array(z.string()).min(3).max(5), // 3-5: a company public for under five years has a shorter series
    income: z.array(StatementRow),
    balance: z.array(StatementRow),
    cashflow: z.array(StatementRow),
  }),
  latestQuarter: z.object({
    label: z.string(), periodEnd: z.string(), revenue: z.number(),
    operatingMargin: nullableNum, revenueYoY: nullableNum, // both null for a quarter with no revenue (a miner between sales)
  }),
  ttm: z.object({
    pe: nullableNum, ps: nullableNum, evToEbitda: nullableNum,
    grossMargin: nullableNum, operatingMargin: nullableNum, netMargin: nullableNum,
    netDebtToEbitda: nullableNum, interestCoverage: nullableNum, fcfYield: nullableNum, currentRatio: nullableNum,
  }),
  estimates: z.object({ nextFY: estimate, followingFY: estimate }),
  analysts: z.object({
    count: z.number().int(), buy: z.number().int(), hold: z.number().int(), sell: z.number().int(),
    consensusRating: z.string(), consensusTarget: z.number(), medianTarget: z.number(),
    highTarget: z.number(), lowTarget: z.number(), asOf: z.string(),
  }),
  segments: z.object({
    basis: z.string(),
    items: z.array(z.object({ name: z.string(), revenue: z.number(), share: ratio })),
  }),
  geoMix: z.object({
    basis: z.string(),
    items: z.array(z.object({ region: z.string(), share: ratio })),
  }),
  peers: z.array(z.object({ ticker: z.string(), pe: nullableNum, ps: nullableNum, evToEbitda: nullableNum })),
  history: z.array(HistoryPoint),
  context: z.object({
    description: Excerpt,
    mdaExcerpt: Excerpt.nullable(),
    riskFactorsExcerpt: Excerpt.nullable(),
    riskFactorsSource: z.enum(["10-Q", "10-K"]).nullable(),
    pressRelease: Excerpt.nullable(),
    proxyStatement: Excerpt.nullable(),
    transcriptHighlights: Excerpt.nullable(),
    headlines: z.array(Excerpt).max(10),
  }),
  provenance: z.array(z.object({
    field: z.string(),
    source: z.enum(["fmp", "bigdata", "edgar", "yahoo"]),
    endpoint: z.string(),
    capturedAt: z.string(),
  })),
});

export type FactPack = z.infer<typeof FactPack>;
export type StatementRow = z.infer<typeof StatementRow>;
export type Excerpt = z.infer<typeof Excerpt>;
export type HistoryPoint = z.infer<typeof HistoryPoint>;
