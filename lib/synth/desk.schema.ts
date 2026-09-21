/**
 * desk.schema.ts — the research desk's identity and house style.
 * -----------------------------------------------------------------------------
 * Config, not judgment: the model never authors these. Loaded from
 * data/desk/desk.json by the synth CLIs (one level below data/, because
 * lib/reports.ts treats every data/*.json as a report).
 */
import { z } from "zod";

const text = (max: number) => z.string().regex(/\S/, "must not be blank").max(max);

/** Not `as const`: the arrays must infer as string[] so they satisfy the schema's output type. */
export const DESK_LINT_DEFAULTS = {
  hypeWords: ["massive", "incredible", "game-changing", "skyrocket", "skyrocketing", "revolutionary", "explosive"],
  superlatives: ["record", "fastest", "largest", "biggest", "highest", "unprecedented", "best-ever"],
  attributionPhrases: [
    "what it calls", "what management calls", "its word", "the release's word", "the company's word",
    "described as", "describes as", "calls it", "calls its", "reported as", "management's phrase",
  ],
  tics: ["this pack", "worth naming", "worth stating", "worth noticing", "is where", "leg"],
  ticLimit: 4,
  similarity: { error: 0.8, warning: 0.6 },
};

const Similarity = z
  .strictObject({
    error: z.number().gt(0).lte(1).default(DESK_LINT_DEFAULTS.similarity.error),
    warning: z.number().gt(0).lte(1).default(DESK_LINT_DEFAULTS.similarity.warning),
  })
  .refine((s) => s.warning < s.error, { message: "similarity.warning must be below similarity.error" })
  .default(() => ({ ...DESK_LINT_DEFAULTS.similarity }));

/** Style, not code: the desk edits these. Severities are not here — a rule's severity is fixed in its module. */
export const DeskLint = z
  .strictObject({
    hypeWords: z.array(text(40)).default(() => [...DESK_LINT_DEFAULTS.hypeWords]),
    superlatives: z.array(text(40)).default(() => [...DESK_LINT_DEFAULTS.superlatives]),
    attributionPhrases: z.array(text(60)).default(() => [...DESK_LINT_DEFAULTS.attributionPhrases]),
    tics: z.array(text(60)).default(() => [...DESK_LINT_DEFAULTS.tics]),
    ticLimit: z.number().int().min(1).max(100).default(DESK_LINT_DEFAULTS.ticLimit),
    similarity: Similarity,
  })
  .default(() => structuredClone(DESK_LINT_DEFAULTS));
export type DeskLint = z.infer<typeof DeskLint>;

export const DeskReview = z.strictObject({ model: text(40).default("opus") }).default(() => ({ model: "opus" }));
export type DeskReview = z.infer<typeof DeskReview>;

/** Rating thresholds: the prompt renders them and validate-judgment enforces them from this one source. */
export const DESK_RATING_DEFAULTS = {
  bearFloor: 0.15,
  strongBuy: { minUpside: 0.2, minRewardRisk: 1.0 },
  buy: { minUpside: 0.1, minRewardRisk: 0.5 },
  sell: { maxUpside: -0.05 },
  strongSell: { maxUpside: -0.2 },
};

const BuyBand = (d: { minUpside: number; minRewardRisk: number }) =>
  z.strictObject({
    minUpside: z.number().gt(0).lt(1).default(d.minUpside),
    minRewardRisk: z.number().gt(0).default(d.minRewardRisk),
  }).default(() => ({ ...d }));
const SellBand = (d: { maxUpside: number }) =>
  z.strictObject({ maxUpside: z.number().lt(0).gt(-1).default(d.maxUpside) }).default(() => ({ ...d }));

export const DeskRating = z
  .strictObject({
    bearFloor: z.number().gt(0).lt(1).default(DESK_RATING_DEFAULTS.bearFloor),
    strongBuy: BuyBand(DESK_RATING_DEFAULTS.strongBuy),
    buy: BuyBand(DESK_RATING_DEFAULTS.buy),
    sell: SellBand(DESK_RATING_DEFAULTS.sell),
    strongSell: SellBand(DESK_RATING_DEFAULTS.strongSell),
  })
  .refine((r) => r.buy.minUpside < r.strongBuy.minUpside, { message: "buy.minUpside must be below strongBuy.minUpside" })
  .refine((r) => r.buy.minRewardRisk <= r.strongBuy.minRewardRisk, { message: "buy.minRewardRisk must not exceed strongBuy.minRewardRisk" })
  .refine((r) => r.strongSell.maxUpside < r.sell.maxUpside, { message: "strongSell.maxUpside must be below sell.maxUpside" })
  .default(() => structuredClone(DESK_RATING_DEFAULTS));
export type DeskRating = z.infer<typeof DeskRating>;

export const Desk = z.strictObject({
  analyst: text(80),
  analystName: text(80),
  disclaimer: text(1200),
  styleRules: z.array(text(200)).min(3).max(10),
  lint: DeskLint,
  review: DeskReview,
  rating: DeskRating,
});
export type Desk = z.infer<typeof Desk>;
