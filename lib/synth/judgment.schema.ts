/**
 * judgment.schema.ts — the contract the synthesis model targets.
 * -----------------------------------------------------------------------------
 * The judgment half of a Report: calls and prose only. Everything derivable
 * (tone, thesis label, snapshot, tables, notes, identity, disclaimer) is set by
 * merge.ts. Strict objects everywhere: an extra key is an error, so a model that
 * "helpfully" returns facts fails fast. Bounds are the page's shape.
 */
import { z } from "zod";
import { HIGHLIGHT_KEYS } from "./highlights";

export const RatingLabel = z.enum(["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"]);
export type RatingLabel = z.infer<typeof RatingLabel>;

/** Markdown prose: non-blank, capped. `.regex` (not `.trim`) keeps the JSON Schema export lossless. */
const md = (max: number) => z.string().regex(/\S/, "must not be blank").max(max);

const scenario = z.strictObject({
  name: md(20),
  driver: md(600),
  impliedPrice: z.number().positive(),
  probability: z.number().gt(0, "probability must be within (0, 1)").lt(1, "probability must be within (0, 1)"),
});

export const Judgment = z.strictObject({
  meta: z.strictObject({ subtitle: md(160), fiscalYearEnd: md(40) }),
  rating: z.strictObject({ label: RatingLabel, targetLow: z.number().positive(), targetHigh: z.number().positive() }),
  analystCommentary: md(2500),
  sections: z.strictObject({
    executiveSummary: z.strictObject({
      companyOverview: md(2500),
      thesis: z.strictObject({ body: md(1500) }),
      catalysts: z.array(md(600)).min(3).max(6),
      risks: z.array(md(600)).min(3).max(6),
    }),
    financials: z.strictObject({ incomeCommentary: md(2500), balanceCommentary: md(2500), cashflowCommentary: md(2500) }),
    valuation: z.strictObject({
      multiplesCommentary: md(2500),
      scenarios: z.array(scenario).length(3, "exactly three scenarios"),
      scenarioCommentary: md(2500),
    }),
    businessMoat: z.strictObject({
      segments: z.array(z.strictObject({ name: md(80), body: md(1200) })).min(1),
      moatRating: z.enum(["WIDE", "NARROW", "NONE"]),
      moatFactors: z.array(z.strictObject({ name: md(60), strength: md(30), body: md(800) })).min(2).max(5),
      durability: md(1500),
    }),
    growth: z.strictObject({ points: z.array(md(600)).min(3).max(6) }),
    management: z.strictObject({ leadership: md(1500), capitalAllocation: md(1500), governance: md(1500), insiderOwnership: md(1500).optional() }),
    risks: z.strictObject({ idiosyncratic: z.array(md(800)).min(2).max(5), systemic: md(1500) }),
    finalRecommendation: z.strictObject({ body: z.array(md(1200)).min(1).max(3) }),
  }),
  // Up to four fact-derived cells (highlights.ts) to append to the snapshot; uniqueness is a
  // validateJudgment concern (validate-judgment.ts), not the schema, so the JSON Schema export stays a
  // plain enum array.
  highlights: z.array(z.enum(HIGHLIGHT_KEYS)).max(4).optional(),
});
export type Judgment = z.infer<typeof Judgment>;

/** The same contract as JSON Schema, embedded in the prompt. */
export function judgmentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(Judgment) as Record<string, unknown>;
}
