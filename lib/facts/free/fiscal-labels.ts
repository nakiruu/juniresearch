/**
 * Per-filer exceptions to the fiscal labels lib/facts/free/sec.ts puts on every statement row.
 *
 * By default a row carries the filer's own fiscal labels: a quarter is numbered by its position in the fiscal
 * year, and a fiscal year is named by the calendar year it ends in (fiscalYearKey: a 52/53-week year ending in
 * the first days of January takes the year before). That reproduces the filer's own DEI period and year for
 * every published name the 2026-11 audit measured, except the two below. An entry here is an owner decision or a
 * measured exception; a test pins the table, so a new entry is a deliberate change.
 */

export interface FiscalLabelOverride {
  /**
   * "calendar": label each period by the calendar quarter and year of its end (the labels before 2026-11). As
   * before, the fourth quarter derived from the annual figure is still called Q4 of that year, so an off-calendar
   * filer under this override carries two "Q4" rows a year (LQDT: September and December). Rows pair by date.
   */
  labels?: "calendar";
  /** Added to every fiscal-year label: −1 for a filer that names a fiscal year by the calendar year it starts in. */
  yearOffset?: number;
}

export const FISCAL_LABEL_OVERRIDES: Readonly<Record<string, FiscalLabelOverride>> = {
  // Owner decision 2026-10-03 (learnings §3): LQDT's quarter label stays as it was (calendar), not its fiscal Q3.
  LQDT: { labels: "calendar" },
  // 2026-11-13: CHWY's DEI and prose name a fiscal year by the year it starts (fiscal 2025 ended 2026-02-01).
  CHWY: { yearOffset: -1 },
};

/** The override for a ticker, or none (fiscal labels, no offset). */
export const fiscalLabelOverride = (ticker: string): FiscalLabelOverride => FISCAL_LABEL_OVERRIDES[ticker.toUpperCase()] ?? {};
