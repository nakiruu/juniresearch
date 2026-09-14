/**
 * span-scope / rhetorical-question — the two markup rules of the house style.
 * -----------------------------------------------------------------------------
 * A {+ +} or {- -} span marks a signed change or an explicit positive or
 * negative, so it either carries a figure or it is short. Wrapped around a whole
 * clause it stops being emphasis and becomes editorialising, which is what the
 * desk keeps finding by hand. A question mark in report prose is a rhetorical
 * question by construction: the report answers, it does not ask.
 */
import { numericTokens } from "../../grounding";
import type { LintIssue } from "../index";
import type { SectionUnit } from "../units";
import { splitSentences } from "../sentences";

const SPAN = /\{([+-])([\s\S]*?)\1\}/g;
const MAX_WORDLESS_SPAN_WORDS = 3;

export function markup(units: SectionUnit[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const unit of units)
    for (const leaf of unit.leaves) {
      SPAN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SPAN.exec(leaf.text))) {
        const body = match[2].trim();
        const words = body.split(/\s+/).filter(Boolean).length;
        if (numericTokens(body).length > 0 || words <= MAX_WORDLESS_SPAN_WORDS) continue;
        issues.push({
          rule: "span-scope",
          severity: "error",
          field: leaf.path,
          message: `this span wraps ${words} words and no figure — spans go around signed changes or explicit positives and negatives, never around whole sentences`,
          value: match[0],
        });
      }
      for (const sentence of splitSentences(leaf.text))
        if (sentence.includes("?"))
          issues.push({
            rule: "rhetorical-question",
            severity: "error",
            field: leaf.path,
            message: "report prose asks no questions — state the claim and answer it",
            value: sentence.slice(0, 200),
          });
    }
  return issues;
}
