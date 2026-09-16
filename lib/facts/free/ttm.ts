/**
 * TTM (trailing-twelve-month) `key_metrics` and `ratios` rows.
 *
 * Sums the last four SEC quarters (flow fields) and combines them with the
 * latest quarter's balance-sheet fields plus the Yahoo price/market cap/
 * dividend yield to produce the tearsheet's TTM multiples and ratios.
 *
 * See docs/superpowers/specs/2026-09-16-sec-yahoo-free-factsource-design.md
 * ("TTM computation") for the formulas this file implements.
 */
import type { SecPeriod } from "./sec";

export interface TtmRows {
  keyMetrics: Record<string, unknown>;
  ratios: Record<string, unknown>;
}

type FlowField =
  | "revenue"
  | "gross_profit"
  | "operating_income"
  | "net_income"
  | "eps_diluted"
  | "interest_expense"
  | "ebitda"
  | "operating_cash_flow"
  | "capex";

/** null when a or b is null or b === 0 — never NaN or Infinity. */
function safeDiv(a: number | null, b: number | null): number | null {
  return a == null || b == null || b === 0 ? null : a / b;
}

/**
 * Sums `field` across all four quarters. A partial TTM is misleading, so any
 * single missing quarter value nulls the whole sum (no treating null as 0).
 */
function sum(quarters: SecPeriod[], field: FlowField): number | null {
  let total = 0;
  for (const q of quarters) {
    const v = q[field];
    if (v == null) return null;
    total += v;
  }
  return total;
}

export function computeTtm(
  quarters: SecPeriod[],
  yh: { price: number; marketCap: number; dividendYield: number },
): TtmRows {
  const last4 = [...quarters].sort((a, b) => (a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : 0)).slice(-4);
  const latest = last4[last4.length - 1];

  const ttmRevenue = sum(last4, "revenue");
  const ttmGrossProfit = sum(last4, "gross_profit");
  const ttmOperatingIncome = sum(last4, "operating_income");
  const ttmNetIncome = sum(last4, "net_income");
  const ttmEps = sum(last4, "eps_diluted");
  const ttmInterest = sum(last4, "interest_expense");
  const ttmEbitda = sum(last4, "ebitda");
  const ttmOcf = sum(last4, "operating_cash_flow");
  const ttmCapex = sum(last4, "capex");
  const ttmFcf = ttmOcf != null && ttmCapex != null ? ttmOcf + ttmCapex : null;

  const ratios: Record<string, unknown> = {
    fiscal_period: "TTM",
    gross_margin: safeDiv(ttmGrossProfit, ttmRevenue),
    operating_margin: safeDiv(ttmOperatingIncome, ttmRevenue),
    net_margin: safeDiv(ttmNetIncome, ttmRevenue),
    net_debt_to_ebitda: safeDiv(latest.net_debt, ttmEbitda),
    interest_coverage: safeDiv(ttmOperatingIncome, ttmInterest),
    current_ratio: safeDiv(latest.total_current_assets, latest.total_current_liabilities),
    dividend_yield: yh.dividendYield,
  };

  const keyMetrics: Record<string, unknown> = {
    fiscal_period: "TTM",
    pe_ratio: safeDiv(yh.price, ttmEps),
    price_to_sales: safeDiv(yh.marketCap, ttmRevenue),
    ev_to_ebitda: safeDiv(yh.marketCap + (latest.net_debt ?? 0), ttmEbitda),
    free_cash_flow_yield: safeDiv(ttmFcf, yh.marketCap),
  };

  return { keyMetrics, ratios };
}
