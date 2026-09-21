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
import { computeScenarios, pct, usd, upside, upsideRangeText, rewardRiskText } from "../format";
import type { Judgment } from "./judgment.schema";
import type { Desk, DeskRating } from "./desk.schema";
import { computeConviction, deriveLabel, conservativeNotch } from "./conviction";
import { buildAllowedIndex, checkGrounding } from "./grounding";
import { renderFactsBlock } from "./prompt";
import { stringLeaves } from "./walk";

/** The label must be the derived label or one notch more conservative; the bear must sit below the desk floor. */
export function ratingIssues(j: Judgment, currentPrice: number, cfg: DeskRating): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scenarios = j.sections.valuation.scenarios;
  const c = computeConviction(scenarios, currentPrice);
  const derived = deriveLabel(c, cfg);
  const alt = conservativeNotch(derived);
  if (j.rating.label !== derived && j.rating.label !== alt)
    issues.push({
      field: "rating.label",
      message: `${j.rating.label} is inconsistent with the derived ${derived} (expected upside ${pct(c.expectedUpside, { signed: true })}, reward/risk ${rewardRiskText(c.rewardRisk)}); allowed: ${derived}${alt ? ` or ${alt}` : ""}`,
      value: j.rating.label,
    });
  const bear = scenarios.find((s) => /bear/i.test(s.name));
  if (bear && bear.impliedPrice > currentPrice * (1 - cfg.bearFloor))
    issues.push({
      field: "sections.valuation.scenarios[bear].impliedPrice",
      message: `bear case ${usd(bear.impliedPrice)} is only ${pct(c.bearDownside)} below the price; the desk floor is ${pct(cfg.bearFloor)} — a bear scenario is a real scenario, not a formality`,
      value: bear.impliedPrice,
    });
  const names = scenarios.map((s) => s.name.trim());
  const WANT_NAMES = ["Bull", "Base", "Bear"];
  if (names.length !== WANT_NAMES.length || !WANT_NAMES.every((w) => names.includes(w)))
    issues.push({ field: "sections.valuation.scenarios[].name", message: "scenarios must be named exactly Bull, Base and Bear", value: names });
  const byName = (re: RegExp) => scenarios.find((s) => re.test(s.name))?.impliedPrice;
  const bull = byName(/bull/i), base = byName(/base/i), bearPrice = byName(/bear/i);
  if (bull != null && base != null && bearPrice != null && !(bull >= base && base >= bearPrice))
    issues.push({ field: "sections.valuation.scenarios", message: "implied prices must satisfy bull ≥ base ≥ bear", value: [bull, base, bearPrice] });
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
      const first = lines[0];
      if (/^#{1,6}\s/.test(first) && !/^#{3,4}\s/.test(first)) bad("uses a heading level other than ### or ####");
      if (lines.slice(1).some((l) => /^#{1,6}\s/.test(l))) bad("has a heading that is not at the start of a block");
    }
  }
  return issues;
}

/** Duplicate highlight keys, or a chosen key whose cell this FactPack does not have (highlights.ts omits a null fact). */
export function highlightIssues(j: Judgment, facts: ReportFacts): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keys = j.highlights ?? [];
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dupes.length)
    issues.push({ field: "highlights", message: `highlight keys must be unique; repeated: ${dupes.join(", ")}`, value: keys });
  const unavailable = keys.filter((k) => facts.highlightCells[k] == null);
  if (unavailable.length)
    issues.push({ field: "highlights", message: `highlight key(s) not available in this FactPack: ${unavailable.join(", ")}`, value: unavailable });
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
    ...(() => {
      const c = computeConviction(j.sections.valuation.scenarios, currentPrice);
      return [
        `Expected upside ${pct(c.expectedUpside, { signed: true })}`,
        `Bear-case downside ${pct(-c.bearDownside, { signed: true })}`,
        `Reward/risk ${rewardRiskText(c.rewardRisk)}`,
      ];
    })(),
  ].join("\n");
}

export function validateJudgment(j: Judgment, facts: ReportFacts, pack: FactPack, desk: Desk): ValidationIssue[] {
  const index = buildAllowedIndex(pack, [renderFactsBlock(facts, pack), renderJudgmentBlock(j, pack.quote.price)]);
  return [
    ...ratingIssues(j, pack.quote.price, desk.rating),
    ...segmentIssues(j, facts),
    ...highlightIssues(j, facts),
    ...markdownIssues(j),
    ...checkGrounding(j, index),
  ];
}
