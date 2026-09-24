/**
 * quality.ts — a composite fundamental-quality score Q ∈ [0,100] per name, PROTOTYPE.
 * ---------------------------------------------------------------------------------
 * Q = 100 · Σ_k w_k · pct_k / Σ_k w_k(present), where each sub-metric k is ranked
 * CROSS-SECTIONALLY (percentile across the covered universe) — robust to outliers and
 * to the fact that a raw ROIC and a raw current ratio are not on the same scale. This
 * replaces the old "quality = moat + a small percentile nudge" with the blend Nico
 * proposed (ROIC−WACC, ROE stability, FCF conversion, balance-sheet strength, moat).
 *
 * Every input comes from the Report the portfolio build already loads — the FY tables in
 * `sections.financials` and `rating.decision.moat` — so nothing new is fetched. A metric
 * whose inputs are missing or degenerate is null and drops out of that name's blend.
 *
 * "−WACC" is intentionally omitted from the ROIC term: Q ranks cross-sectionally, and a
 * constant WACC hurdle subtracted from every name does not change the ranking. If an
 * absolute pass/fail were ever needed, the hurdle would matter; for a sizing tilt it does not.
 */
import type { Report } from "@/lib/report.schema";

export interface QualityWeights {
  roic: number; roeStability: number; fcfConversion: number; balanceStrength: number; moat: number;
}
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  roic: 0.4, roeStability: 0.2, fcfConversion: 0.15, balanceStrength: 0.15, moat: 0.1,
};

export interface RawQuality {
  roic: number | null; roeStability: number | null; fcfConversion: number | null;
  balanceStrength: number | null; moat: number | null;
}
const METRICS = ["roic", "roeStability", "fcfConversion", "balanceStrength", "moat"] as const;

interface Table { columns: string[]; rows: { label: string; values: (number | null)[] }[] }
const rowSeries = (t: Table | undefined, label: string): (number | null)[] =>
  t?.rows.find((r) => r.label === label)?.values ?? [];
const lastVal = (t: Table | undefined, label: string): number | null => {
  const vals = rowSeries(t, label).filter((v): v is number => v != null);
  return vals.length ? vals[vals.length - 1] : null;
};
const moatScore = (width?: string, trend?: string): number | null => {
  if (width == null) return null;
  const base = width === "WIDE" ? 1 : width === "NARROW" ? 0.5 : width === "NONE" ? 0 : 0.25;
  return Math.max(0, base - (trend === "ERODING" ? 0.25 : 0));
};

export function rawQuality(report: Report, opts: { taxRate?: number } = {}): RawQuality {
  const tax = opts.taxRate ?? 0.21;
  const fin = (report as unknown as { sections?: { financials?: { income?: Table; balance?: Table; cashflow?: Table } } }).sections?.financials;
  const income = fin?.income, balance = fin?.balance, cashflow = fin?.cashflow;

  // ROIC = NOPAT / invested capital, latest FY. NOPAT ≈ operating income · (1 − tax).
  const op = lastVal(income, "Operating Income ($B)");
  const debt = lastVal(balance, "Total Debt"), eq = lastVal(balance, "Total Equity"), cash = lastVal(balance, "Cash & ST Investments");
  const investedCapital = debt != null && eq != null && cash != null ? debt + eq - cash : null;
  const roic = op != null && investedCapital != null && investedCapital > 0 ? (op * (1 - tax)) / investedCapital : null;

  // ROE stability = mean − volatility of ROE = NetIncome/Equity over the FY columns (≥3 points).
  const ni = rowSeries(income, "Net Income ($B)"), eqSeries = rowSeries(balance, "Total Equity");
  const roe: number[] = [];
  for (let i = 0; i < Math.max(ni.length, eqSeries.length); i++) {
    const n = ni[i], e = eqSeries[i];
    if (n != null && e != null && e > 0) roe.push(n / e);
  }
  const roeStability = roe.length >= 3 ? mean(roe) - std(roe) : null;

  // FCF conversion = free cash flow / net income (latest FY), only when net income is positive.
  const fcf = lastVal(cashflow, "Free Cash Flow"), niLast = lastVal(income, "Net Income ($B)");
  const fcfConversion = fcf != null && niLast != null && niLast > 0 ? clamp(fcf / niLast, -1, 3) : null;

  // Balance-sheet strength = current ratio − net-debt/equity (latest FY). Higher is safer.
  const cr = lastVal(balance, "Current Ratio"), nd = lastVal(balance, "Net Debt");
  const balanceStrength = cr != null && eq != null && eq > 0 && nd != null ? cr - Math.max(0, nd / eq) : null;

  const dec = (report as unknown as { rating?: { decision?: { moat?: { width?: string; trend?: string } } } }).rating?.decision?.moat;
  return { roic, roeStability, fcfConversion, balanceStrength, moat: moatScore(dec?.width, dec?.trend) };
}

/** Cross-sectional percentile of each value among the non-null values (fraction below + half the ties). */
function percentiles(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v != null);
  const n = present.length;
  return values.map((v) => {
    if (v == null) return null;
    if (n <= 1) return 0.5;
    let below = 0, equal = 0;
    for (const u of present) { if (u < v) below++; else if (u === v) equal++; }
    return (below + 0.5 * equal) / n;
  });
}

export function qualityScores(reports: Report[], weights: QualityWeights = DEFAULT_QUALITY_WEIGHTS, opts?: { taxRate?: number }): Map<string, number> {
  const raws = reports.map((r) => ({ ticker: r.meta.ticker, q: rawQuality(r, opts) }));
  const pct = Object.fromEntries(METRICS.map((k) => [k, percentiles(raws.map((x) => x.q[k]))])) as Record<(typeof METRICS)[number], (number | null)[]>;
  const out = new Map<string, number>();
  raws.forEach((x, i) => {
    let num = 0, den = 0;
    for (const k of METRICS) { const p = pct[k][i]; if (p != null) { num += weights[k] * p; den += weights[k]; } }
    out.set(x.ticker, den > 0 ? (100 * num) / den : 50);
  });
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const std = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
