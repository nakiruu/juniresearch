/**
 * report.schema.ts — the canonical data contract for a Juniper equity report.
 * -----------------------------------------------------------------------------
 * This is the SINGLE source of truth the pipeline emits and the page renders.
 * Two halves:
 *   FACTS      — numbers pulled deterministically from Bigdata.com/FMP. Raw values
 *                only (no "$", no "%", no formatting). Percentages are ratios.
 *   JUDGMENT   — the analyst's interpretation, authored by the model as plain
 *                Markdown strings. No HTML, no inline styling.
 *
 * Anything derived (upside %, weighted fair value, target lines, the chart) is
 * computed by the project from these fields — NEVER stored here.
 *
 * Validate every model output with `Report.parse(json)` before rendering; on
 * failure, re-prompt the model with the Zod error and let it self-heal.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.1.0";

/* ------------------------------- primitives ------------------------------- */
const md = z.string(); // Markdown: **bold**, "- " lists, and {+ bull +}/{- bear -} spans
const ratio = z.number(); // a decimal ratio: 0.408 === 40.8%

const cell = z.union([z.number(), z.string(), z.null()]); // number | "~40x" | null(—)

const financialTable = z.object({
  columns: z.array(z.string()).min(2), // first entry is the row-label header
  rows: z.array(
    z.object({
      label: z.string(),
      values: z.array(cell),
      format: z
        .enum(["usdB", "usdT", "pct", "pctSigned", "mult", "eps", "num1", "num2", "usd0", "usd2"])
        .default("num1"),
      emphasize: z.boolean().optional(),
    })
  ),
  note: md.optional(), // the small "Source: …" caption under the table
});

const snapshotCell = z.object({
  label: z.string(),
  value: z.number().optional(),
  unit: z.enum(["usd", "usdLarge", "mult", "pct", "shares"]).optional(),
  approx: z.boolean().optional(),
  dp: z.number().optional(),
  change: ratio.optional(),
  changeDp: z.number().optional(),
  note: z.string().optional(),
  raw: z.string().optional(),
});

/* --------------------------------- meta ----------------------------------- */
const meta = z.object({
  company: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  subtitle: z.string(),
  reportDate: z.string(), // display string, e.g. "September 12, 2026"
  asOf: z.string(),       // price/chart as-of, e.g. "Sep 11, 2026"
  analyst: z.string(),
  analystName: z.string(),
  fiscalYearEnd: z.string(),
  currency: z.string().default("USD"),
  filing: z.object({
    form: z.string(),          // "10-Q" | "10-K"
    fiscalPeriod: z.string(),  // "fiscal Q3 2026"
    filedDate: z.string(),     // "Sep 10, 2026"
    accession: z.string(),
  }),
});

/* -------------------------------- facts ----------------------------------- */
const quote = z.object({
  currentPrice: z.number(),
  marketCap: z.number(),
  sharesOutstanding: z.number(),
  week52Low: z.number(),
  week52High: z.number(),
  dividendYield: ratio,
  history: z.array(z.object({ date: z.string(), close: z.number() })).optional(),
});

const ratingLabel = z.enum(["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"]);

/** Computed by mergeReport from the scenarios and the quote; optional so reports built before it parse. */
const conviction = z.object({
  expectedUpside: z.number(),
  bearDownside: z.number(),
  rewardRisk: z.number().nullable(),
  derivedLabel: ratingLabel,
});

const rating = z.object({
  label: ratingLabel,
  tone: z.enum(["bull", "accent", "secondary", "bear"]).default("bull"),
  targetLow: z.number(),
  targetHigh: z.number(),
  conviction: conviction.optional(),
});

const analystSentiment = z.object({
  numAnalysts: z.number(),
  buy: z.number(),
  hold: z.number(),
  sell: z.number(),
  consensusRating: z.string(), // provider fact, not recomputed
  consensusTarget: z.number(),
  medianTarget: z.number(),
  highTarget: z.number(),
  lowTarget: z.number(),
  commentary: md,
});

/* ------------------------------- sections --------------------------------- */
const sections = z.object({
  executiveSummary: z.object({
    companyOverview: md,
    thesis: z.object({ label: z.string(), body: md }), // rendered in the callout
    catalysts: z.array(md),
    risks: z.array(md),
  }),

  financials: z.object({
    income: financialTable,
    incomeCommentary: md,
    balance: financialTable,
    balanceCommentary: md,
    cashflow: financialTable,
    cashflowCommentary: md,
  }),

  valuation: z.object({
    multiples: financialTable,
    multiplesCommentary: md,
    scenarios: z.array(
      z.object({
        name: z.string(),
        driver: md,
        impliedPrice: z.number(),
        probability: ratio,
      })
    ),
    scenarioCommentary: md,
  }),

  businessMoat: z.object({
    segments: z.array(
      z.object({
        name: z.string(),
        sharePct: ratio,
        revenue: z.number(),
        body: md,
      })
    ),
    segmentsBasis: z.string().optional(), // e.g. "FY2025 mix"
    geographyBasis: z.string().optional(), // e.g. "FY2025"
    geoMix: z.array(z.object({ region: z.string(), sharePct: ratio })),
    moatRating: z.string(), // "WIDE" | "NARROW" | "NONE"
    moatFactors: z.array(
      z.object({ name: z.string(), strength: z.string(), body: md })
    ),
    durability: md,
  }),

  growth: z.object({ points: z.array(md) }),

  management: z.object({
    leadership: md,
    capitalAllocation: md,
    governance: md,
    insiderOwnership: md.optional(),
  }),

  risks: z.object({
    idiosyncratic: z.array(md), // rendered as separate paragraphs
    systemic: md,               // one block
  }),

  finalRecommendation: z.object({ body: z.array(md) }),
});

/* -------------------------------- report ---------------------------------- */
export const Report = z.object({
  schemaVersion: z.string().default(SCHEMA_VERSION),
  meta,
  quote,
  rating,
  snapshot: z.array(snapshotCell),
  analystSentiment,
  sections,
  disclaimer: md.optional(), // falls back to the project default when omitted
});

export type Report = z.infer<typeof Report>;
export type FinancialTable = z.infer<typeof financialTable>;
export type SnapshotCellData = z.infer<typeof snapshotCell>;
