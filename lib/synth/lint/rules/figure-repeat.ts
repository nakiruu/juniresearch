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
 *
 * A key repeated inside one sentence — "not all 30 gigawatts", "up from $5B to
 * $5B" — is one introduction read once, not two; the rule only fires once the
 * second occurrence lands in a later sentence of the field, or in another field.
 */
import { numericTokens } from "../../grounding";
import { splitSentences } from "../sentences";
import type { LintIssue } from "../index";
import type { SectionUnit } from "../units";

/** Each token's key alongside which sentence of `text` it falls in, located by character offset. */
function locateTokens(text: string): { key: string; sentence: number }[] {
  const sentences = splitSentences(text);
  const ranges: [number, number][] = [];
  let cursor = 0;
  for (const s of sentences) {
    const start = text.indexOf(s, cursor);
    const at = start === -1 ? cursor : start;
    ranges.push([at, at + s.length]);
    cursor = at + s.length;
  }
  const sentenceAt = (offset: number): number => {
    for (let i = 0; i < ranges.length; i++) {
      const [start, end] = ranges[i];
      if (offset < end) return offset >= start ? i : Math.max(0, i - 1);
    }
    return Math.max(0, ranges.length - 1);
  };

  const out: { key: string; sentence: number }[] = [];
  let cursor2 = 0;
  for (const token of numericTokens(text)) {
    const idx = text.indexOf(token.raw, cursor2);
    const at = idx === -1 ? cursor2 : idx;
    cursor2 = at + token.raw.length;
    out.push({ key: token.raw, sentence: sentenceAt(at) });
  }
  return out;
}

export function figureRepeat(units: SectionUnit[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const unit of units) {
    const firstSeenIn = new Map<string, { leaf: string; sentence: number }>();
    const reported = new Set<string>();
    for (const leaf of unit.leaves)
      for (const { key, sentence } of locateTokens(leaf.text)) {
        const first = firstSeenIn.get(key);
        if (first === undefined) {
          firstSeenIn.set(key, { leaf: leaf.path, sentence });
          continue;
        }
        const sameSentence = first.leaf === leaf.path && first.sentence === sentence;
        if (sameSentence) continue;   // one introduction, read once
        if (reported.has(key)) continue;
        reported.add(key);
        const sameField = first.leaf === leaf.path;
        const blocks = sameField || unit.name === "executiveSummary";
        const where = sameField
          ? `twice in ${leaf.path}`
          : `twice in ${unit.name} (first in ${first.leaf})`;
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
