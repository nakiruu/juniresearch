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
import type { FactPack } from "./schema";
import type { SnapshotCellData } from "../report.schema";
import { num } from "../format";
import { latestStatementValue, safeDiv } from "./statement-values";

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

export function buildHighlightCells(p: FactPack): Partial<Record<HighlightKey, SnapshotCellData>> {
  const fy = p.statements.fiscalYears.at(-1)!;
  const revenue = latestStatementValue(p, "income", "revenue");
  const grossProfit = latestStatementValue(p, "income", "grossProfit");
  const grossMarginLatestFY = safeDiv(grossProfit, revenue);

  const source: Record<HighlightKey, { value: number | null; cell: (value: number) => SnapshotCellData }> = {
    fcfLatestFY: { value: latestStatementValue(p, "cashflow", "freeCashFlow"), cell: (value) => ({ label: `${fy} Free Cash Flow`, value, unit: "usdLarge" }) },
    capexLatestFY: { value: latestStatementValue(p, "cashflow", "capex"), cell: (value) => ({ label: `${fy} Capital Expenditure`, value, unit: "usdLarge" }) },
    netDebtLatestFY: { value: latestStatementValue(p, "balance", "netDebt"), cell: (value) => ({ label: `${fy} Net Debt`, value, unit: "usdLarge" }) },
    totalDebtLatestFY: { value: latestStatementValue(p, "balance", "totalDebt"), cell: (value) => ({ label: `${fy} Total Debt`, value, unit: "usdLarge" }) },
    netDebtToEbitda: { value: p.ttm.netDebtToEbitda, cell: (value) => ({ label: "Net Debt / EBITDA (TTM)", value, unit: "mult" }) },
    interestCoverage: { value: p.ttm.interestCoverage, cell: (value) => ({ label: "Interest Coverage (TTM)", value, unit: "mult" }) },
    fcfYield: { value: p.ttm.fcfYield, cell: (value) => ({ label: "FCF Yield (TTM)", value, unit: "pct", dp: 1 }) },
    buybacksLatestFY: { value: latestStatementValue(p, "cashflow", "buybacks"), cell: (value) => ({ label: `${fy} Share Repurchases`, value, unit: "usdLarge" }) },
    dividendsLatestFY: { value: latestStatementValue(p, "cashflow", "dividends"), cell: (value) => ({ label: `${fy} Dividends Paid`, value, unit: "usdLarge" }) },
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
