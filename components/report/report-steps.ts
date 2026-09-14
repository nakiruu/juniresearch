/**
 * report-steps.ts — the eight numbered sections every report renders, in order.
 * -----------------------------------------------------------------------------
 * One list drives both the section headings (SectionN.tsx) and the stepper, so
 * the two cannot drift. `id` is the scroll anchor; `label` is the short rail
 * caption; `title` is the numbered heading as printed.
 */
export interface ReportStep {
  n: number;
  id: string;
  title: string;
  label: string;
}

const DEFS: ReadonlyArray<readonly [title: string, label: string]> = [
  ["Executive Summary", "Summary"],
  ["Financial Performance & Health", "Financials"],
  ["Valuation", "Valuation"],
  ["Business Model & Competitive Moat", "Moat"],
  ["Growth Strategy & Future Outlook", "Growth"],
  ["Management & Governance", "Management"],
  ["Risk Analysis", "Risks"],
  ["Final Recommendation", "Recommendation"],
];

export const REPORT_STEPS: readonly ReportStep[] = DEFS.map(([title, label], i) => ({
  n: i + 1,
  id: `sec-${i + 1}`,
  title: `${i + 1}. ${title}`,
  label,
}));

export function stepFor(n: number): ReportStep {
  const step = REPORT_STEPS[n - 1];
  if (!step) throw new Error(`No report step ${n}; sections are numbered 1–${REPORT_STEPS.length}`);
  return step;
}
