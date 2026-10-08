/**
 * review-rekey.ts — carry review stamps across a desk.rating change, only where the review still covers the new rule.
 * -----------------------------------------------------------------------------
 * A desk.rating change moves every review's `calls` hash (decision D1). The re-key restamps `calls` (source
 * `rekey:<sha>`) only when the derived label is unchanged and the judgment still passes validate's rating checks and
 * Calls grounding under the new rule; a label alone is not enough (a raised bear floor keeps every label but fails 23
 * published judgments). Every other report goes to re-review. A stamp from another rule, or one already stale on facts
 * or context, is left alone. Plan: 2026-10-08-review-fingerprint.md, Task 6.
 */
import type { FactPack } from "../facts/schema";
import type { ReportFacts } from "../facts/project";
import type { Desk, DeskRating } from "./desk.schema";
import type { Judgment } from "./judgment.schema";
import type { ReviewInputsStamp } from "./editorial.schema";
import { computeConviction, deriveLabel } from "./conviction";
import { ratingIssues, groundJudgment, groundingSurface } from "./validate-judgment";
import { reviewInputs, inputsLine } from "./review-inputs";

export type RekeyResult =
  | { action: "restamp"; stamp: ReviewInputsStamp }
  | { action: "reReview"; reason: string }
  | { action: "untouched"; reason: string };

export function rekeyCalls(input: {
  stamp: ReviewInputsStamp;
  judgment: Judgment;
  pack: FactPack;
  facts: ReportFacts;
  desk: Desk;
  oldRating: DeskRating;
  newRating: DeskRating;
  rekeySha: string;
}): RekeyResult {
  const { stamp, judgment, pack, facts, desk, oldRating, newRating, rekeySha } = input;
  const before = reviewInputs(pack, { rating: oldRating }, facts), after = reviewInputs(pack, { rating: newRating }, facts);
  if (stamp.calls !== before.calls) return { action: "untouched", reason: "not this change" };
  if (stamp.facts !== before.facts || stamp.context !== before.context) return { action: "untouched", reason: "already stale on facts or context" };
  const price = pack.quote.price;
  const c = computeConviction(judgment.sections.valuation.scenarios, price);
  const [was, now] = [deriveLabel(c, oldRating), deriveLabel(c, newRating)];
  if (was !== now) return { action: "reReview", reason: `label ${was}→${now}` };
  const issues = ratingIssues(judgment, price, newRating);
  if (issues.length) return { action: "reReview", reason: `rating issue: ${issues.map((i) => i.message).join("; ")}` };
  // A figure that grounded under the old Calls block and does not under the new one: the prose quotes a moved threshold.
  const missKey = (m: { field: string; token: { raw: string } }) => `${m.field}|${m.token.raw}`;
  const missesUnder = (rating: DeskRating) => groundJudgment(judgment, groundingSurface(judgment, facts, pack, { ...desk, rating })).errors;
  const old = new Set(missesUnder(oldRating).map(missKey));
  const lost = missesUnder(newRating).filter((m) => !old.has(missKey(m)));
  if (lost.length) return { action: "reReview", reason: `grounding: ${lost.map((m) => `${m.field} "${m.token.raw}"`).join("; ")}` };
  return { action: "restamp", stamp: { ...stamp, calls: after.calls, source: `rekey:${rekeySha}` } };
}

const INPUTS_OBJECT = /"inputs"\s*:\s*\{[^{}]*\}/g;

/**
 * Replace the one `inputs` object in a findings file's text, one-line or pretty-printed, with the stamp on one line.
 * Everything else (layout, escapes, EOL) is kept; the result must parse to the original with only `inputs` changed.
 */
export function replaceInputsText(text: string, stamp: ReviewInputsStamp): string {
  const hits = text.match(INPUTS_OBJECT) ?? [];
  if (hits.length !== 1) throw new Error(`expected exactly one "inputs" object, found ${hits.length}`);
  const line = stamp.source ? JSON.stringify({ ...JSON.parse(inputsLine(stamp)), source: stamp.source }) : inputsLine(stamp);
  const out = text.replace(INPUTS_OBJECT, () => `"inputs": ${line}`);
  const want = JSON.stringify({ ...JSON.parse(text), inputs: stamp });
  if (JSON.stringify(JSON.parse(out)) !== want) throw new Error("the replaced text does not parse to the original with the new inputs");
  return out;
}
