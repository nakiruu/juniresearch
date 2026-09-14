/**
 * pointer-length / source-disagreement — two shapes the reviewers keep flagging.
 * -----------------------------------------------------------------------------
 * Executive-summary catalysts and risks point; the sections behind them argue.
 * Three sentences in a pointer means the argument moved forward, and the reader
 * meets it twice. Separately, two figures of the same kind set against each other
 * usually means two sources disagreed — which is fine, said once, with the figure
 * the report used named. Both are warnings: the rubric's items 7 and 8 carry the
 * judgment, the lint only raises a hand.
 */
import { numericTokens } from "../../grounding";
import type { LintIssue } from "../index";
import type { SectionUnit } from "../units";
import { splitSentences } from "../sentences";

export const MAX_POINTER_SENTENCES = 2;

const POINTER = /^sections\.executiveSummary\.catalysts\[\d+\]$/;
const OPPOSED = /\b(?:against|versus|vs\.?)\b/gi;   // global: every connector in the sentence is tried
const RESOLVED = /\b(?:we use|we used|the statement figure|the filing's number)\b/i;

export function structure(units: SectionUnit[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const unit of units)
    for (const leaf of unit.leaves) {
      const sentences = splitSentences(leaf.text);

      if (POINTER.test(leaf.path) && sentences.length >= MAX_POINTER_SENTENCES)
        issues.push({
          rule: "pointer-length",
          severity: "warning",
          field: leaf.path,
          message: `this pointer runs to ${sentences.length} sentences — executive-summary catalysts and risks are one- or two-sentence pointers; the section behind carries the argument`,
          value: sentences.length,
        });

      for (const sentence of sentences) {
        if (RESOLVED.test(sentence)) continue;
        // "Joined by" is literal: the connector must sit between the two differing keys.
        // Accepting the connector anywhere in the sentence fires 17–22 times per corpus
        // fixture, every one of them false.
        OPPOSED.lastIndex = 0;
        let joiner: RegExpExecArray | null;
        let joined = false;
        while (!joined && (joiner = OPPOSED.exec(sentence))) {
          const before = numericTokens(sentence.slice(0, joiner.index));
          const after = numericTokens(sentence.slice(joiner.index + joiner[0].length));
          joined = before.some((b) => after.some((a) => a.kind === b.kind && a.raw !== b.raw));
        }
        if (!joined) continue;
        issues.push({
          rule: "source-disagreement",
          severity: "warning",
          field: leaf.path,
          message: "two figures of the same kind are set against each other — if two sources disagree, say so once and name which figure the report uses",
          value: sentence.slice(0, 200),
        });
      }
    }
  return issues;
}
