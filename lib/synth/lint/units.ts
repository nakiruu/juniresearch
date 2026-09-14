/**
 * units.ts — the eleven section units the desk reads a report in.
 * -----------------------------------------------------------------------------
 * "Once per section" and "no sentence in two sections" are rules about what the
 * reader sees on the page, not about the judgment's leaf fields: the executive
 * summary is one section even though it is five fields, and a scenario's driver
 * cell is its own unit because the table introduces figures the commentary
 * introduces again. The overview paragraph is the same story: it restates the
 * filing's headline figures before the thesis, catalysts and risks do their own
 * work with them, so it is graded as a unit of its own rather than folded into
 * executiveSummary. Labels the page renders as badges (scenario names, moat
 * factor names and strengths, the moat rating) and code-owned enums are prose
 * to nobody and belong to no unit.
 */
import type { Judgment } from "../judgment.schema";
import { stringLeaves } from "../walk";

export const UNIT_NAMES = [
  "analystCommentary", "companyOverview", "executiveSummary", "financials", "valuation", "scenarioDrivers",
  "businessMoat", "growth", "management", "risks", "finalRecommendation",
] as const;
export type UnitName = (typeof UNIT_NAMES)[number];

export interface SectionUnit {
  name: UnitName;
  leaves: { path: string; text: string }[];
}

export function unitFor(path: string): UnitName | null {
  if (path === "analystCommentary") return "analystCommentary";
  if (path === "sections.executiveSummary.companyOverview") return "companyOverview";
  if (path.startsWith("sections.executiveSummary.")) return "executiveSummary";
  if (path.startsWith("sections.financials.")) return "financials";
  if (path.startsWith("sections.valuation.scenarios[")) return path.endsWith(".driver") ? "scenarioDrivers" : null;
  if (path.startsWith("sections.valuation.")) return "valuation";
  if (path === "sections.businessMoat.moatRating") return null;
  if (/^sections\.businessMoat\.moatFactors\[\d+\]\.(name|strength)$/.test(path)) return null;
  if (path.startsWith("sections.businessMoat.")) return "businessMoat";
  if (path.startsWith("sections.growth.points")) return "growth";
  if (path.startsWith("sections.management.")) return "management";
  if (path.startsWith("sections.risks.")) return "risks";
  if (path.startsWith("sections.finalRecommendation.body")) return "finalRecommendation";
  return null;
}

export function sectionUnits(judgment: Judgment): SectionUnit[] {
  const units: SectionUnit[] = UNIT_NAMES.map((name) => ({ name, leaves: [] }));
  const byName = new Map(units.map((u) => [u.name, u]));
  for (const leaf of stringLeaves(judgment)) {
    const name = unitFor(leaf.path);
    if (name) byName.get(name)!.leaves.push(leaf);
  }
  return units;
}
