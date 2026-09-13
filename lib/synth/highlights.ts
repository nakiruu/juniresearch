/**
 * highlights.ts — fact-derived highlight cells for the synthesis layer.
 * -----------------------------------------------------------------------------
 * Pulled straight from the FactPack — never from the model — and rendered
 * with the same SnapshotCellData contract the page's snapshot cells use
 * (lib/format.ts's formatSnapshot). A key is present only when the fact it
 * comes from is non-null; a null underlying figure (e.g. a TTM ratio the
 * vendor couldn't compute) simply omits that key rather than emitting a
 * null-valued cell.
 */
import type { FactPack } from "../facts/schema";
import type { SnapshotCellData } from "../report.schema";
import { num } from "../format";

export const HIGHLIGHT_KEYS = [
  "fcfLatestFY",
  "capexLatestFY",
  "netDebtLatestFY",
  "totalDebtLatestFY",
  "netDebtToEbitda",
  "interestCoverage",
  "fcfYield",
  "buybacksLatestFY",
  "dividendsLatestFY",
  "currentRatioTTM",
  "grossMarginLatestFY",
] as const;

export type HighlightKey = (typeof HIGHLIGHT_KEYS)[number];

/** The latest fiscal year's value for a statement row, or null if the row or year is missing. */
const latest = (p: FactPack, table: "income" | "balance" | "cashflow", key: string): number | null =>
  p.statements[table].find((r) => r.key === key)?.values[4] ?? null;

export function buildHighlightCells(p: FactPack): Partial<Record<HighlightKey, SnapshotCellData>> {
  const fy = p.statements.fiscalYears[4];
  const revenue = latest(p, "income", "revenue");
  const grossProfit = latest(p, "income", "grossProfit");
  const grossMarginLatestFY = revenue == null || grossProfit == null || revenue === 0 ? null : grossProfit / revenue;

  const source: Record<HighlightKey, { value: number | null; cell: (value: number) => SnapshotCellData }> = {
    fcfLatestFY: { value: latest(p, "cashflow", "freeCashFlow"), cell: (value) => ({ label: `${fy} Free Cash Flow`, value, unit: "usdLarge" }) },
    capexLatestFY: { value: latest(p, "cashflow", "capex"), cell: (value) => ({ label: `${fy} Capital Expenditure`, value, unit: "usdLarge" }) },
    netDebtLatestFY: { value: latest(p, "balance", "netDebt"), cell: (value) => ({ label: `${fy} Net Debt`, value, unit: "usdLarge" }) },
    totalDebtLatestFY: { value: latest(p, "balance", "totalDebt"), cell: (value) => ({ label: `${fy} Total Debt`, value, unit: "usdLarge" }) },
    netDebtToEbitda: { value: p.ttm.netDebtToEbitda, cell: (value) => ({ label: "Net Debt / EBITDA (TTM)", value, unit: "mult" }) },
    interestCoverage: { value: p.ttm.interestCoverage, cell: (value) => ({ label: "Interest Coverage (TTM)", value, unit: "mult" }) },
    fcfYield: { value: p.ttm.fcfYield, cell: (value) => ({ label: "FCF Yield (TTM)", value, unit: "pct", dp: 1 }) },
    buybacksLatestFY: { value: latest(p, "cashflow", "buybacks"), cell: (value) => ({ label: `${fy} Share Repurchases`, value, unit: "usdLarge" }) },
    dividendsLatestFY: { value: latest(p, "cashflow", "dividends"), cell: (value) => ({ label: `${fy} Dividends Paid`, value, unit: "usdLarge" }) },
    currentRatioTTM: { value: p.ttm.currentRatio, cell: (value) => ({ label: "Current Ratio (TTM)", raw: num(value, 2) }) },
    grossMarginLatestFY: { value: grossMarginLatestFY, cell: (value) => ({ label: `${fy} Gross Margin`, value, unit: "pct" }) },
  };

  const cells: Partial<Record<HighlightKey, SnapshotCellData>> = {};
  for (const key of HIGHLIGHT_KEYS) {
    const { value, cell } = source[key];
    if (value != null) cells[key] = cell(value);
  }
  return cells;
}
