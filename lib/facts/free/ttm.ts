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

/** Four consecutive quarter ends span ~273 days; outside this range the window has a gap (see shibui-check.ts). */
export const TTM_SPAN_DAYS = { lo: 250, hi: 300 } as const;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

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
  yh: { price: number; marketCap: number; dividendYield: number; trailingPe?: number | null },
): TtmRows {
  if (quarters.length < 4) {
    throw new Error(`computeTtm needs 4 quarters for a trailing-twelve-month period, got ${quarters.length}`);
  }
  const last4 = [...quarters].sort((a, b) => (a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : 0)).slice(-4);
  const latest = last4[last4.length - 1];

  // D-7: the last four rows are a trailing twelve months only when they are consecutive quarters. V's
  // 2026-09-21 capture had no September quarter, so Jun-25 + Dec-25 + Mar-26 + Jun-26 were summed as
  // a year. A gapped window nulls every summed metric; balance-sheet ratios and the Yahoo P/E stand.
  const span = daysBetween(last4[0].report_date, latest.report_date);
  const consecutive = span >= TTM_SPAN_DAYS.lo && span <= TTM_SPAN_DAYS.hi;
  const sum4 = (field: FlowField) => (consecutive ? sum(last4, field) : null);

  const ttmRevenue = sum4("revenue");
  const ttmGrossProfit = sum4("gross_profit");
  const ttmOperatingIncome = sum4("operating_income");
  const ttmNetIncome = sum4("net_income");
  const ttmEps = sum4("eps_diluted");
  const ttmInterest = sum4("interest_expense");
  const ttmEbitda = sum4("ebitda");
  const ttmOcf = sum4("operating_cash_flow");
  const ttmCapex = sum4("capex");
  const ttmFcf = ttmOcf != null && ttmCapex != null ? ttmOcf + ttmCapex : null;
  // Explicit null guard: `marketCap + null` would coerce null to 0 in JS and silently
  // understate EV, so enterprise value is null whenever net_debt is null — symmetric
  // with net_debt_to_ebitda below (no `?? 0` fallback; the design spec states both
  // formulas the same way, and this pipeline never fabricates a number for a missing input).
  const ev = latest.net_debt == null || yh.marketCap == null ? null : yh.marketCap + latest.net_debt;

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
    // Prefer the SEC-derived P/E (price ÷ summed discrete-quarter EPS); fall back to Yahoo's own
    // trailing P/E when the quarterly EPS can't be summed (a multi-share-class filer whose EPS the
    // companyfacts API omits — see yahoo.trailingPe).
    pe_ratio: ttmEps != null ? safeDiv(yh.price, ttmEps) : (yh.trailingPe ?? null),
    price_to_sales: safeDiv(yh.marketCap, ttmRevenue),
    ev_to_ebitda: safeDiv(ev, ttmEbitda),
    free_cash_flow_yield: safeDiv(ttmFcf, yh.marketCap),
  };

  return { keyMetrics, ratios };
}
