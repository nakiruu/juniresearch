/**
 * figure-repeat / figure-repeat-unit — introduce a figure once, then refer back in words.
 * -----------------------------------------------------------------------------
 * The key is the token as written, not its value: "$5.2B" and "$5,207,393" are
 * two different things for the reader, and the desk's rule is about what the eye
 * meets twice. The tokeniser is grounding.ts's, so the allow-list (bare integers
 * up to twelve, years, Q3'26, 10-Q, 52-week) is the same one the grounding check
 * already trusts.
 *
 * Two tiers, because measurement showed one tier was wrong: the same figure twice
 * in one paragraph is a drafting slip nobody defends, and the executive summary's
 * catalysts and risks exist to point at the thesis rather than restate its
 * numbers — both block the build. A figure that appears in a segment paragraph
 * and again in a moat factor is usually the same fact doing two jobs, which the
 * desk's own reviewers have waved through on every report so far; that is a
 * warning the author fixes if a rewrite can absorb it.
 */
import { numericTokens } from "../../grounding";
import type { LintIssue } from "../index";
import type { SectionUnit } from "../units";

export function figureRepeat(units: SectionUnit[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const unit of units) {
    const firstSeenIn = new Map<string, string>();
    const reported = new Set<string>();
    for (const leaf of unit.leaves)
      for (const token of numericTokens(leaf.text)) {
        const key = token.raw;
        const first = firstSeenIn.get(key);
        if (first === undefined) {
          firstSeenIn.set(key, leaf.path);
          continue;
        }
        if (reported.has(key)) continue;
        reported.add(key);
        const sameField = first === leaf.path;
        const blocks = sameField || unit.name === "executiveSummary";
        const where = sameField
          ? `twice in ${leaf.path}`
          : `twice in ${unit.name} (first in ${first})`;
        issues.push(
          blocks
            ? {
                rule: "figure-repeat",
                severity: "error",
                field: leaf.path,
                message: `"${key}" is introduced ${where} — introduce a figure once${unit.name === "executiveSummary" && !sameField ? " in the executive summary; a catalyst or risk points at the thesis rather than restating its figures" : " and refer back in words"}`,
                value: key,
              }
            : {
                rule: "figure-repeat-unit",
                severity: "warning",
                field: leaf.path,
                message: `"${key}" is introduced ${where} — consider referring back in words instead of restating it`,
                value: key,
              },
        );
      }
  }
  return issues;
}
