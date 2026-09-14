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
 *
 * Occurrences are tracked two ways: `firstSeenIn` is the key's first mention
 * anywhere in the unit (for the "(first in X)" message), and `fieldFirstSeen`
 * is its first mention within *each* field. A key introduced in one field and
 * then repeated within a sibling field still owes that sibling field its own
 * same-field error once it repeats there — the cross-field warning for the
 * sibling's first mention does not use up the field's own error. `reported`
 * tracks which rule ids have already fired for a key, not just whether the key
 * has fired at all, so the two tiers don't suppress each other for the same key.
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
    const fieldFirstSeen = new Map<string, Map<string, number>>();   // key -> leaf -> that leaf's first sentence
    const reported = new Map<string, Set<string>>();                 // key -> rule ids already issued for it

    const alreadyReported = (key: string, rule: string) => reported.get(key)?.has(rule) ?? false;
    const markReported = (key: string, rule: string) => {
      const set = reported.get(key) ?? new Set<string>();
      set.add(rule);
      reported.set(key, set);
    };

    for (const leaf of unit.leaves)
      for (const { key, sentence } of locateTokens(leaf.text)) {
        const first = firstSeenIn.get(key);
        if (first === undefined) {
          firstSeenIn.set(key, { leaf: leaf.path, sentence });
          fieldFirstSeen.set(key, new Map([[leaf.path, sentence]]));
          continue;
        }
        const fields = fieldFirstSeen.get(key)!;
        const fieldFirst = fields.get(leaf.path);
        if (fieldFirst === undefined) {
          // First time this key appears in *this* field — it was introduced
          // in a sibling field earlier, so this is a cross-field mention.
          fields.set(leaf.path, sentence);
          const rule = unit.name === "executiveSummary" ? "figure-repeat" : "figure-repeat-unit";
          if (alreadyReported(key, rule)) continue;
          markReported(key, rule);
          const where = `twice in ${unit.name} (first in ${first.leaf})`;
          issues.push(
            rule === "figure-repeat"
              ? {
                  rule: "figure-repeat",
                  severity: "error",
                  field: leaf.path,
                  message: `"${key}" is introduced ${where} — introduce a figure once in the executive summary; a catalyst or risk points at the thesis rather than restating its figures`,
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
          continue;
        }
        // A later occurrence of this key within the same field: a genuine
        // same-field repeat, which is always the error tier, regardless of
        // whether an earlier sibling-field mention already reported a warning.
        if (fieldFirst === sentence) continue;   // one introduction, read once
        if (alreadyReported(key, "figure-repeat")) continue;
        markReported(key, "figure-repeat");
        issues.push({
          rule: "figure-repeat",
          severity: "error",
          field: leaf.path,
          message: `"${key}" is introduced twice in ${leaf.path} — introduce a figure once and refer back in words`,
          value: key,
        });
      }
  }
  return issues;
}
