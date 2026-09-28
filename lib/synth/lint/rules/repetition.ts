/**
 * sentence-repeat / sentence-similar — no sentence appears in two sections.
 * -----------------------------------------------------------------------------
 * Sentences are collected in render order, so the earlier occurrence is always
 * the one named and the later one is always the one flagged. Each later sentence
 * yields at most one issue: its closest earlier match. A verbatim repeat after
 * normalisation and a trigram match at or above the desk's error threshold are
 * both errors, within a unit as well as across units; a cross-unit match between
 * the warning and error thresholds is a warning, because inside one section the
 * desk expects parallel phrasing (two segment paragraphs, three scenario drivers).
 */
import type { Desk } from "../../desk.schema";
import type { LintIssue } from "../index";
import type { SectionUnit, UnitName } from "../units";
import { normalizeSentence, normalizedTrigrams, splitSentences } from "../sentences";

export const MIN_SENTENCE_WORDS = 8;

interface Sentence {
  unit: UnitName;
  path: string;
  text: string;
  norm: string;
  grams: Set<string>;
}

function collect(units: SectionUnit[]): Sentence[] {
  const out: Sentence[] = [];
  for (const unit of units)
    for (const leaf of unit.leaves)
      for (const text of splitSentences(leaf.text)) {
        const norm = normalizeSentence(text);
        const words = norm.split(" ").filter(Boolean);
        if (words.length < MIN_SENTENCE_WORDS) continue;
        out.push({ unit: unit.name, path: leaf.path, text, norm, grams: normalizedTrigrams(norm) });
      }
  return out;
}

/**
 * 1 for a verbatim repeat after normalisation, else trigram Jaccard given the shared-trigram count —
 * the same division `jaccard` (sentences.ts) performs, so scores are bit-identical to intersecting
 * every pair. `shared` comes from an inverted index, so only overlapping pairs cost anything.
 */
const score = (a: Sentence, b: Sentence, shared: number) =>
  a.norm === b.norm ? 1 : a.grams.size === 0 || b.grams.size === 0 ? 0 : shared / (a.grams.size + b.grams.size - shared);
const where = (a: Sentence, b: Sentence) => (a.unit === b.unit ? `${a.path} (same section)` : `${a.path} (${a.unit} → ${b.unit})`);

export function repetition(units: SectionUnit[], desk: Desk): LintIssue[] {
  const { error, warning } = desk.lint.similarity;
  const sentences = collect(units);
  const issues: LintIssue[] = [];

  // trigram → indices of the sentences (in order) that contain it; filled as each sentence becomes "earlier".
  const postings = new Map<string, number[]>();
  const shared = new Int32Array(sentences.length);
  const index = (i: number) => {
    for (const g of sentences[i].grams) {
      const list = postings.get(g);
      if (list) list.push(i);
      else postings.set(g, [i]);
    }
  };
  if (sentences.length) index(0);

  for (let i = 1; i < sentences.length; i++) {
    const later = sentences[i];
    shared.fill(0, 0, i);
    for (const g of later.grams) for (const k of postings.get(g) ?? []) shared[k] += 1;
    index(i);
    let best: Sentence | null = null;
    let bestScore = 0;
    let bestOther: Sentence | null = null;
    let bestOtherScore = 0;
    for (let k = 0; k < i; k++) {
      const earlier = sentences[k];
      const s = score(earlier, later, shared[k]);
      if (s > bestScore) { best = earlier; bestScore = s; }
      if (earlier.unit !== later.unit && s > bestOtherScore) { bestOther = earlier; bestOtherScore = s; }
    }
    if (best && bestScore >= error) {
      issues.push({
        rule: "sentence-repeat",
        severity: "error",
        field: later.path,
        message: `this sentence repeats ${where(best, later)} at trigram similarity ${bestScore.toFixed(2)} — no sentence appears in two sections`,
        value: later.text.slice(0, 200),
      });
      continue;
    }
    if (bestOther && bestOtherScore >= warning)
      issues.push({
        rule: "sentence-similar",
        severity: "warning",
        field: later.path,
        message: `this sentence is close to ${where(bestOther, later)} at trigram similarity ${bestOtherScore.toFixed(2)} — consider pointing back instead of restating`,
        value: later.text.slice(0, 200),
      });
  }
  return issues;
}
