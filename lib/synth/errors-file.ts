/**
 * errors-file.ts — the one place that knows what data/judgment/<T>/<acc>.errors.txt looks like.
 * -----------------------------------------------------------------------------
 * synth:build writes it, synth:prompt reads it back into the next prompt, so the
 * format is a contract between two CLIs and belongs in a tested module rather
 * than in either script. Errors keep the line format the loop has always used;
 * warnings follow under a "# warnings" heading, and a file with warnings but no
 * errors is what a passing build with warnings leaves behind.
 */
import { writeFileSync } from "node:fs";
import type { ValidationIssue } from "../validate";
import { lintLine, type LintIssue } from "./lint";

export const WARNINGS_HEADING = "# warnings";

const isLint = (issue: ValidationIssue | LintIssue): issue is LintIssue => "rule" in issue;

export function issueLine(issue: ValidationIssue | LintIssue): string {
  return isLint(issue) ? lintLine(issue) : `${issue.field}: ${issue.message} (received ${JSON.stringify(issue.value)})`;
}

export function renderErrorsFile(errors: string[], warnings: string[]): string {
  const blocks: string[] = [];
  if (errors.length) blocks.push(errors.join("\n"));
  if (warnings.length) blocks.push([WARNINGS_HEADING, ...warnings].join("\n"));
  return blocks.length ? blocks.join("\n\n") + "\n" : "";
}

export function parseErrorsFile(text: string): { errors: string[]; warnings: string[] } {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const at = lines.indexOf(WARNINGS_HEADING);
  const head = at === -1 ? lines : lines.slice(0, at);
  const tail = at === -1 ? [] : lines.slice(at + 1);
  return { errors: head.filter(Boolean), warnings: tail.filter(Boolean) };
}

export function writeErrorsFile(path: string, errors: string[], warnings: string[]): void {
  writeFileSync(path, renderErrorsFile(errors, warnings));
}
