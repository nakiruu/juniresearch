/**
 * errors-file.ts — the one place that knows what data/judgment/<T>/<acc>.errors.txt looks like.
 * -----------------------------------------------------------------------------
 * synth:build writes it, synth:prompt reads it back into the next prompt, so the
 * format is a contract between two CLIs and belongs in a tested module rather
 * than in either script. Errors keep the line format the loop has always used;
 * warnings follow under a "# warnings" heading, and a file with warnings but no
 * errors is what a passing build with warnings leaves behind. Weakly grounded
 * figures follow under "# weak"; they are for the reviewer, not the author.
 */
import { writeFileSync } from "node:fs";
import type { ValidationIssue } from "../validate";
import { lintLine, type LintIssue } from "./lint";

export const WARNINGS_HEADING = "# warnings";
/** Weakly grounded figures, for the review brief; synth:prompt never passes them to the author. */
export const WEAK_HEADING = "# weak";

const isLint = (issue: ValidationIssue | LintIssue): issue is LintIssue => "rule" in issue;

export function issueLine(issue: ValidationIssue | LintIssue): string {
  return isLint(issue) ? lintLine(issue) : `${issue.field}: ${issue.message} (received ${JSON.stringify(issue.value)})`;
}

export function renderErrorsFile(errors: string[], warnings: string[], weak: string[] = []): string {
  const blocks: string[] = [];
  if (errors.length) blocks.push(errors.join("\n"));
  if (warnings.length) blocks.push([WARNINGS_HEADING, ...warnings].join("\n"));
  if (weak.length) blocks.push([WEAK_HEADING, ...weak].join("\n"));
  return blocks.length ? blocks.join("\n\n") + "\n" : "";
}

export function parseErrorsFile(text: string): { errors: string[]; warnings: string[]; weak: string[] } {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const out = { errors: [] as string[], warnings: [] as string[], weak: [] as string[] };
  let block = out.errors;
  for (const l of lines) {
    if (l === WARNINGS_HEADING) block = out.warnings;
    else if (l === WEAK_HEADING) block = out.weak;
    else if (l) block.push(l);
  }
  return out;
}

export function writeErrorsFile(path: string, errors: string[], warnings: string[], weak: string[] = []): void {
  writeFileSync(path, renderErrorsFile(errors, warnings, weak));
}
