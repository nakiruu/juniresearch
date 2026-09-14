/**
 * hype-word / superlative / judgment-superlative / tic — the vocabulary rules.
 * -----------------------------------------------------------------------------
 * The desk owns the lists; this module owns the exceptions, because they are
 * grammar rather than style. "Record" is a noun at least as often as it is a
 * superlative ("the governance record", "track record", "we record as claims",
 * "record date"), and a superlative the company said is quotable — so a sentence
 * that attributes it, or puts it in quotation marks, passes. "First" and "only"
 * are too often innocent ("first quarter", "the only other holder") to block, so
 * they are a warning the author checks.
 */
import type { Desk } from "../../desk.schema";
import type { LintIssue } from "../index";
import type { SectionUnit } from "../units";
import { splitSentences } from "../sentences";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const whole = (phrase: string) => new RegExp(`\\b${escape(phrase)}\\b`, "gi");

/** "record" is a superlative only when none of these hold. */
const RECORD_BEFORE = ["the", "its", "this", "that", "in", "on", "reported", "governance", "track"];
const RECORD_AFTER = ["date", "as"];
const JUDGMENT_SUPERLATIVE = /\b(?:the|its|their)\s+(first|only)\b/gi;

const priorWords = (sentence: string, index: number): string[] =>
  sentence.slice(0, index).trim().split(/\s+/).slice(-2).map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
const nextWord = (sentence: string, end: number): string =>
  (sentence.slice(end).trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Straight or curly quotes: an odd number of quote characters before the match means it sits inside one. */
const insideQuotes = (sentence: string, index: number): boolean =>
  ((sentence.slice(0, index).match(/["""“”]/g) ?? []).length % 2) === 1;

const attributed = (sentence: string, desk: Desk): boolean => {
  const lower = sentence.toLowerCase();
  return desk.lint.attributionPhrases.some((phrase) => lower.includes(phrase.toLowerCase()));
};

const excludedRecord = (sentence: string, index: number, end: number): boolean =>
  priorWords(sentence, index).some((w) => RECORD_BEFORE.includes(w)) || RECORD_AFTER.includes(nextWord(sentence, end));

export function words(units: SectionUnit[], desk: Desk): LintIssue[] {
  const issues: LintIssue[] = [];
  const ticCounts = new Map<string, { count: number; field: string }>();

  for (const unit of units)
    for (const leaf of unit.leaves) {
      for (const sentence of splitSentences(leaf.text)) {
        for (const word of desk.lint.hypeWords) {
          const re = whole(word);
          let match: RegExpExecArray | null;
          while ((match = re.exec(sentence)))
            issues.push({
              rule: "hype-word",
              severity: "error",
              field: leaf.path,
              message: `"${match[0]}" is hype — let the figure carry the weight`,
              value: match[0],
            });
        }

        // Collect all superlative matches with their positions to maintain sentence order
        const superlativeMatches: Array<{
          index: number;
          match: RegExpExecArray;
          word: string;
        }> = [];
        for (const word of desk.lint.superlatives) {
          const re = whole(word);
          let match: RegExpExecArray | null;
          while ((match = re.exec(sentence))) {
            superlativeMatches.push({ index: match.index, match, word });
          }
        }
        // Sort by position in sentence to maintain order
        superlativeMatches.sort((a, b) => a.index - b.index);

        for (const { match } of superlativeMatches) {
          const end = match.index + match[0].length;
          if (/^record$/i.test(match[0]) && excludedRecord(sentence, match.index, end)) continue;
          if (attributed(sentence, desk) || insideQuotes(sentence, match.index)) continue;
          issues.push({
            rule: "superlative",
            severity: "error",
            field: leaf.path,
            message: `"${match[0]}" is an unearned superlative — check the series, attribute it to the source, or state the figure without it`,
            value: match[0],
          });
        }

        JUDGMENT_SUPERLATIVE.lastIndex = 0;
        let judgment: RegExpExecArray | null;
        while ((judgment = JUDGMENT_SUPERLATIVE.exec(sentence))) {
          // Skip if at the start of the sentence (likely a noun modifier, not a superlative claim)
          const beforeMatch = sentence.slice(0, judgment.index).trim();
          if (beforeMatch.length === 0) continue;

          if (attributed(sentence, desk) || insideQuotes(sentence, judgment.index)) continue;
          issues.push({
            rule: "judgment-superlative",
            severity: "warning",
            field: leaf.path,
            message: `"${judgment[0]}" reads as a superlative — check the source says so, or drop the article`,
            value: judgment[0].toLowerCase().replace(/\s+/g, " "),
          });
        }
      }
      for (const phrase of desk.lint.tics) {
        const hits = (leaf.text.match(whole(phrase)) ?? []).length;
        if (hits === 0) continue;
        const seen = ticCounts.get(phrase);
        if (seen) seen.count += hits;
        else ticCounts.set(phrase, { count: hits, field: leaf.path });
      }
    }

  for (const [phrase, { count, field }] of ticCounts)
    if (count > desk.lint.ticLimit)
      issues.push({
        rule: "tic",
        severity: "warning",
        field,
        message: `"${phrase}" appears ${count} times across the judgment, over the desk's limit of ${desk.lint.ticLimit} — vary it`,
        value: phrase,
      });

  return issues;
}
