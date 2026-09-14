/**
 * lint/index.ts — the desk's mechanical rules, run beside validateJudgment.
 * -----------------------------------------------------------------------------
 * Every rule takes the ten section units and the desk config and returns issues;
 * a rule's severity is its own, never the config's. Errors fail the build like a
 * grounding error; warnings ride back to the author as "fix if cheap".
 */
import type { ValidationIssue } from "../../validate";
import type { Desk } from "../desk.schema";
import type { Judgment } from "../judgment.schema";
import { sectionUnits, type SectionUnit } from "./units";
import { figureRepeat } from "./rules/figure-repeat";
import { repetition } from "./rules/repetition";

export interface LintIssue extends ValidationIssue {
  rule: string;
  severity: "error" | "warning";
}

export type LintRule = (units: SectionUnit[], desk: Desk) => LintIssue[];

/** Registered in print order; Tasks 5–9 fill this in. */
export const RULES: LintRule[] = [
  (units) => figureRepeat(units),
  (units, desk) => repetition(units, desk),
];

export function lintJudgment(judgment: Judgment, desk: Desk): LintIssue[] {
  const units = sectionUnits(judgment);
  return RULES.flatMap((rule) => rule(units, desk));
}

export function lintLine(issue: LintIssue): string {
  const body = `lint/${issue.rule}: ${issue.field}: ${issue.message} (received ${JSON.stringify(issue.value)})`;
  return issue.severity === "warning" ? `warn: ${body}` : body;
}
