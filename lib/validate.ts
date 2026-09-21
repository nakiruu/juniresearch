/**
 * validate.ts — the sanity checks the Zod schema cannot express.
 * -----------------------------------------------------------------------------
 * Zod proves the SHAPE of a report. These functions prove it is internally
 * CONSISTENT: that probabilities sum, bands are ordered, and counts agree.
 *
 * Failures name the ticker, the field and the offending value, because these
 * messages become the re-prompt payload for the synthesis subsystem.
 */
import type { Report } from "./report.schema";
import { computeConviction, type Conviction } from "./synth/conviction";

export interface ValidationIssue {
  field: string;
  message: string;
  value: unknown;
}

const EPSILON = 0.001;

export function validateReport(report: Report): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { rating, analystSentiment: a, sections } = report;
  const scenarios = sections.valuation.scenarios;

  const probSum = scenarios.reduce((sum, s) => sum + s.probability, 0);
  if (Math.abs(probSum - 1) > EPSILON) {
    issues.push({
      field: "sections.valuation.scenarios[].probability",
      message: `scenario probabilities must sum to 1, got ${probSum}`,
      value: probSum,
    });
  }

  if (rating.targetLow >= rating.targetHigh) {
    issues.push({
      field: "rating.targetLow",
      message: `targetLow must be below targetHigh (${rating.targetHigh})`,
      value: rating.targetLow,
    });
  }

  const ratingCount = a.buy + a.hold + a.sell;
  if (ratingCount !== a.numAnalysts) {
    issues.push({
      field: "analystSentiment.numAnalysts",
      message: `buy + hold + sell (${ratingCount}) must equal numAnalysts`,
      value: a.numAnalysts,
    });
  }

  const ratios: [string, number][] = [
    ...scenarios.map((s, i): [string, number] =>
      [`sections.valuation.scenarios[${i}].probability`, s.probability]),
    ...sections.businessMoat.segments.map((s, i): [string, number] =>
      [`sections.businessMoat.segments[${i}].sharePct`, s.sharePct]),
    ...sections.businessMoat.geoMix.map((g, i): [string, number] =>
      [`sections.businessMoat.geoMix[${i}].sharePct`, g.sharePct]),
  ];
  for (const [field, value] of ratios) {
    if (value < 0 || value > 1) {
      issues.push({ field, message: "ratio must fall within [0,1]", value });
    }
  }

  // The schema leaves scenario.name freeform, so the base case is identified by
  // a case-insensitive match. No match means the check is skipped, never failed:
  // this rule must not fire on a naming choice.
  const baseCase = scenarios.find((s) => s.name.trim().toLowerCase() === "base");
  if (baseCase) {
    const { impliedPrice } = baseCase;
    if (impliedPrice < rating.targetLow || impliedPrice > rating.targetHigh) {
      issues.push({
        field: "rating",
        message:
          `rating band ${rating.targetLow}–${rating.targetHigh} must bracket ` +
          `the base case implied price`,
        value: impliedPrice,
      });
    }
  }

  // conviction is a snapshot of the scenarios and the quote; a later hand-edit to
  // either must not leave the row silently stale. derivedLabel needs desk.rating,
  // which this function does not receive — the three measures catch the drift.
  if (rating.conviction) {
    const want = computeConviction(scenarios, report.quote.currentPrice);
    const drift = (a: number | null, b: number | null) =>
      a == null || b == null ? a !== b : Math.abs(a - b) > EPSILON;
    const checks: [keyof Conviction, number | null, number | null][] = [
      ["expectedUpside", rating.conviction.expectedUpside, want.expectedUpside],
      ["bearDownside", rating.conviction.bearDownside, want.bearDownside],
      ["rewardRisk", rating.conviction.rewardRisk, want.rewardRisk],
    ];
    for (const [key, have, expected] of checks)
      if (drift(have, expected))
        issues.push({
          field: `rating.conviction.${key}`,
          message: `conviction ${key} ${have} disagrees with the scenarios and quote (${expected})`,
          value: have,
        });
  }

  return issues;
}

export function assertValidReport(report: Report, ticker: string): void {
  const issues = validateReport(report);
  if (issues.length === 0) return;
  const detail = issues
    .map((i) => `  - ${i.field}: ${i.message} (received ${JSON.stringify(i.value)})`)
    .join("\n");
  throw new Error(`Invalid report for ${ticker}:\n${detail}`);
}
