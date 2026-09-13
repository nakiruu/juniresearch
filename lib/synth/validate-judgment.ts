/**
 * validate-judgment.ts — the checks Zod cannot express on a judgment.
 * -----------------------------------------------------------------------------
 * Rating envelope (conviction may differ from arithmetic; contradiction may
 * not), grounding (every figure in the prose exists in the facts or context),
 * the Markdown subset, and segment/moat naming. Every issue names field and
 * value; the list is the re-prompt payload.
 */
import type { FactPack } from "../facts/schema";
import type { ReportFacts } from "../facts/project";
import type { ValidationIssue } from "../validate";
import { computeScenarios, pct, usd, upside, upsideRangeText } from "../format";
import type { Judgment, RatingLabel } from "./judgment.schema";
import { buildAllowedIndex, checkGrounding } from "./grounding";
import { renderFactsBlock } from "./prompt";
import { stringLeaves } from "./walk";

/** Upside envelopes overlap so a conservative label passes; only a contradiction fails. */
export const ENVELOPES: Record<RatingLabel, { min?: number; max?: number }> = {
  "STRONG BUY": { min: 0.25 },
  BUY: { min: 0.10 },
  HOLD: { min: -0.10, max: 0.15 },
  SELL: { max: -0.05 },
  "STRONG SELL": { max: -0.20 },
};

export function ratingIssues(j: Judgment, currentPrice: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { fairValue } = computeScenarios(j.sections.valuation.scenarios);
  const upside = fairValue / currentPrice - 1;
  const env = ENVELOPES[j.rating.label];
  if ((env.min != null && upside < env.min) || (env.max != null && upside > env.max))
    issues.push({ field: "rating.label", message: `${j.rating.label} is inconsistent with an upside of ${pct(upside, { signed: true })} (probability-weighted fair value ${fairValue.toFixed(2)} vs price ${currentPrice})`, value: j.rating.label });
  const byName = (re: RegExp) => j.sections.valuation.scenarios.find((s) => re.test(s.name))?.impliedPrice;
  const bull = byName(/bull/i), base = byName(/base/i), bear = byName(/bear/i);
  if (bull != null && base != null && bear != null && !(bull >= base && base >= bear))
    issues.push({ field: "sections.valuation.scenarios", message: "implied prices must satisfy bull ≥ base ≥ bear", value: [bull, base, bear] });
  return issues;
}

const HTML = /<\/?[a-zA-Z][^>]*>/;
const NESTED = /\*\*\s*\{[+-]|[+-]\}\s*\*\*|\{[+-][^}]*\*\*/;
const LINK = /\]\(|!\[/;
export function markdownIssues(j: Judgment): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, text } of stringLeaves(j)) {
    const bad = (why: string) => issues.push({ field: path, message: why, value: text.slice(0, 80) });
    if (HTML.test(text)) bad("contains HTML; only the Markdown subset is allowed");
    if (NESTED.test(text)) bad("nests emphasis markers; pick **bold** or {+ +}/{- -}, never both");
    if (LINK.test(text)) bad("contains a link or image; not allowed in report prose");
    if (/^\s*\|/m.test(text)) bad("contains a table; not allowed in report prose");
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n");
      if (lines.slice(1).some((l) => /^#{1,6}\s/.test(l))) bad("has a heading that is not at the start of a block");
    }
  }
  return issues;
}

export function segmentIssues(j: Judgment, facts: ReportFacts): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const want = facts.sections.businessMoat.segments.map((s) => s.name);
  const got = j.sections.businessMoat.segments.map((s) => s.name);
  const missing = want.filter((n) => !got.includes(n)), extra = got.filter((n) => !want.includes(n));
  if (missing.length || extra.length)
    issues.push({ field: "sections.businessMoat.segments", message: `segment bodies must cover exactly the fact segments; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`, value: got });
  const names = j.sections.businessMoat.moatFactors.map((f) => f.name);
  if (new Set(names).size !== names.length)
    issues.push({ field: "sections.businessMoat.moatFactors", message: "moat factor names must be unique", value: names });
  return issues;
}

/** The judgment's own calls and the values the page derives from them — quotable because the reader sees them. */
export function renderJudgmentBlock(j: Judgment, currentPrice: number): string {
  const { rows, fairValue } = computeScenarios(j.sections.valuation.scenarios);
  return [
    `Target range ${usd(j.rating.targetLow)}–${usd(j.rating.targetHigh)} (${upsideRangeText(j.rating.targetLow, j.rating.targetHigh, currentPrice)})`,
    ...rows.map((r) => `${r.name}: ${usd(r.impliedPrice)} × ${pct(r.probability, { dp: 0 })} = ${usd(r.weighted)}`),
    `Probability-weighted fair value ${usd(fairValue)} (${pct(upside(fairValue, currentPrice), { signed: true })})`,
  ].join("\n");
}

export function validateJudgment(j: Judgment, facts: ReportFacts, pack: FactPack): ValidationIssue[] {
  const index = buildAllowedIndex(pack, [renderFactsBlock(facts, pack), renderJudgmentBlock(j, pack.quote.price)]);
  return [
    ...ratingIssues(j, pack.quote.price),
    ...segmentIssues(j, facts),
    ...markdownIssues(j),
    ...checkGrounding(j, index),
  ];
}
