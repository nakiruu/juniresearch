/**
 * moat.ts — the economic-moat & capital-returns durability engine.
 * -----------------------------------------------------------------------------
 * A moat is the persistence of excess returns on capital, not a checkbox: how
 * far and how steadily ROIC clears the cost of capital, and whether that is
 * widening or eroding. This reads the five-year statements a filing carries and
 * returns a two-part verdict — Width (NONE/NARROW/WIDE) and Trend (WIDENING/
 * STABLE/ERODING) — plus the one modulation lever it feeds the rating: the
 * minimum bear depth a moat of that quality justifies (which moves R through D
 * in conviction.ts). See docs/scoreconcepts/3.md.
 *
 * Prototype scope: WACC is a flagged proxy — a documented sector-hurdle by SIC
 * (3.md §1.2's fallback) unless an explicit rate is supplied — and the effective
 * tax rate is assumed. A large stock-funded acquisition distorts invested
 * capital, so a structural-break test drops pre-break years and leans on
 * incremental ROIC, resolving to a "contingent" Narrow when the average spread
 * and the incremental economics disagree (3.md §3.3).
 */
import { classifySector } from "./gates";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

export interface MoatFacts {
  ticker?: string;
  sector?: string;
  sic?: number | null;
  quote: { marketCap: number };
  ttm: { interestCoverage: number | null };
  statements: { fiscalYears: string[]; income: Row[]; balance: Row[]; cashflow: Row[] };
}

export type MoatWidth = "WIDE" | "NARROW" | "NONE";
export type MoatTrend = "WIDENING" | "STABLE" | "ERODING";

export interface MoatConfig {
  taxRate?: number; // effective tax for NOPAT (assumed; flagged)
  wacc?: number; // explicit cost of capital; else the sector hurdle by SIC
}

export interface MoatResult {
  width: MoatWidth;
  trend: MoatTrend;
  contingent: boolean; // width rests on incremental economics, not the reported average spread
  roic: number[];
  spread: number[]; // ROIC − WACC per year
  wacc: number;
  comparableFrom: number; // first comparable fiscal-year index (after any structural break)
  incrementalRoic: number | null;
  bearFloor: number; // modulation: minimum bear depth this moat justifies
  flags: string[];
}

const num = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const val = (section: Row[], key: string, i: number): number => {
  const v = section.find((r) => r.key === key)?.values[i];
  return num(v) ? v : 0;
};

/** NOPAT / invested capital per fiscal year; invested capital = debt + equity − cash. */
export function roicSeries(f: MoatFacts, taxRate: number): number[] {
  return f.statements.fiscalYears.map((_, i) => {
    const nopat = val(f.statements.income, "operatingIncome", i) * (1 - taxRate);
    const ic = val(f.statements.balance, "totalDebt", i) + val(f.statements.balance, "totalEquity", i) - val(f.statements.balance, "cashAndInvestments", i);
    return ic !== 0 ? nopat / ic : 0;
  });
}

function investedCapitalSeries(f: MoatFacts): number[] {
  return f.statements.fiscalYears.map(
    (_, i) => val(f.statements.balance, "totalDebt", i) + val(f.statements.balance, "totalEquity", i) - val(f.statements.balance, "cashAndInvestments", i),
  );
}

/** Documented sector-default WACC by SIC (3.md §1.2). A proxy, reported with every verdict. */
export function sectorHurdle(sic: number | null | undefined): number {
  if (num(sic)) {
    if (sic >= 4900 && sic <= 4999) return 0.065; // utilities
    if (sic === 2834) return 0.08; // pharma
    if (sic === 4813) return 0.07; // telecom
    if (sic === 3674) return 0.12; // semiconductors
    if (sic === 7372) return 0.1; // software
    if (sic === 7389) return 0.1; // business services
    if (sic === 3559) return 0.1; // industrial machinery
    if (sic === 3724 || sic === 3760) return 0.09; // aerospace / defense
    if (sic === 1090) return 0.12; // metal ores / miners
    if (sic === 6200) return 0.09; // exchanges
  }
  return 0.1; // industrial default
}

/** First comparable index: a year whose invested capital jumped > 50% marks a break; drop what precedes it. */
export function comparableWindow(ic: number[]): number {
  let start = 0;
  for (let i = 1; i < ic.length; i++) {
    if (ic[i - 1] !== 0 && Math.abs(ic[i] - ic[i - 1]) / Math.abs(ic[i - 1]) > 0.5) start = i;
  }
  return start;
}

/** ΔNOPAT / ΔInvested-Capital from `from` to the latest year — the economics of newly deployed capital. */
export function incrementalRoic(f: MoatFacts, taxRate: number, from: number): number | null {
  const n = f.statements.fiscalYears.length - 1;
  if (from >= n) return null;
  const nopat = (i: number) => val(f.statements.income, "operatingIncome", i) * (1 - taxRate);
  const ic = investedCapitalSeries(f);
  const dIc = ic[n] - ic[from];
  return dIc !== 0 ? (nopat(n) - nopat(from)) / dIc : null;
}

/** A reverse ROIC-based moat read only fits operating companies; banks need ROTCE vs cost of equity. */
export function moatApplicable(f: MoatFacts): { ok: boolean; reason: string | null } {
  const sector = classifySector(f);
  if (sector === "financial") return { ok: false, reason: "financial: ROIC / invested capital not meaningful (use ROTCE − cost of equity)" };
  return { ok: true, reason: null };
}

/** Minimum bear depth a moat of this quality justifies (3.md §5, Lever 1). */
export function moatBearFloor(width: MoatWidth, trend: MoatTrend): number {
  if (trend === "ERODING") return 0.35;
  if (width === "WIDE") return 0.15;
  if (width === "NARROW") return 0.2;
  return 0.3;
}

const RANK: Record<MoatWidth, number> = { NONE: 0, NARROW: 1, WIDE: 2 };
const slopePerYear = (xs: number[]): number => (xs.length < 2 ? 0 : (xs[xs.length - 1] - xs[0]) / (xs.length - 1));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function moatRead(f: MoatFacts, cfg: MoatConfig = {}): MoatResult {
  const taxRate = cfg.taxRate ?? 0.21;
  const wacc = cfg.wacc ?? sectorHurdle(f.sic);
  const flags: string[] = [`WACC proxy ${(wacc * 100).toFixed(1)}%`, `tax rate assumed ${(taxRate * 100).toFixed(0)}%`];

  const roic = roicSeries(f, taxRate);
  const spread = roic.map((r) => r - wacc);
  const ic = investedCapitalSeries(f);
  const from = comparableWindow(ic);
  if (from > 0) flags.push(`structural break at ${f.statements.fiscalYears[from]} — pre-break years dropped`);
  const inc = incrementalRoic(f, taxRate, from);

  const cmpRoic = roic.slice(from);
  const cmpSpread = spread.slice(from);

  // Gross-margin level and slope (pricing power).
  const gm = f.statements.fiscalYears.map((_, i) => {
    const rev = val(f.statements.income, "revenue", i);
    return rev ? val(f.statements.income, "grossProfit", i) / rev : 0;
  });
  const om = f.statements.fiscalYears.map((_, i) => {
    const rev = val(f.statements.income, "revenue", i);
    return rev ? val(f.statements.income, "operatingIncome", i) / rev : 0;
  });
  const gmCmp = gm.slice(from);

  // --- Width: five evidence tests, resolved by rule (3.md §3) ---
  const A: MoatWidth = median(cmpSpread) >= 0.08 ? "WIDE" : median(cmpSpread) >= 0 ? "NARROW" : "NONE";
  const posShare = cmpSpread.filter((s) => s > 0).length / Math.max(1, cmpSpread.length);
  const mean = cmpRoic.reduce((a, b) => a + b, 0) / Math.max(1, cmpRoic.length);
  const cov = mean !== 0 ? Math.sqrt(cmpRoic.reduce((a, b) => a + (b - mean) ** 2, 0) / cmpRoic.length) / Math.abs(mean) : Infinity;
  const B: MoatWidth = posShare >= 0.8 && cov < 0.35 ? "WIDE" : posShare >= 0.4 ? "NARROW" : "NONE";
  const C: MoatWidth = inc == null ? "NONE" : inc >= wacc + 0.1 ? "WIDE" : inc >= wacc ? "NARROW" : "NONE";
  const gmSlope = slopePerYear(gmCmp);
  const gmLevel = gmCmp[gmCmp.length - 1] ?? 0;
  const D: MoatWidth = gmLevel >= 0.4 && gmSlope >= 0 ? "WIDE" : gmLevel >= 0.25 || gmSlope >= 0 ? "NARROW" : "NONE";

  let width: MoatWidth;
  if (RANK[A] === 2 && RANK[B] === 2 && RANK[D] >= 1) width = "WIDE";
  else if (RANK[A] >= 1 || C === "WIDE" || D === "WIDE") width = "NARROW";
  else width = "NONE";

  // Conflict clause: a structural break where the average spread says NONE but the
  // incremental economics and pricing power say WIDE → Narrow, flagged contingent.
  let contingent = false;
  if (from > 0 && A === "NONE" && C === "WIDE" && D === "WIDE") {
    width = "NARROW";
    contingent = true;
    flags.push("width contingent on incremental capital earning its cost, not the reported average spread");
  }

  // --- Trend: sign and size of the slopes over the last up-to-3 comparable years (3.md §4) ---
  const tail = <T,>(xs: T[]) => xs.slice(Math.max(0, xs.length - 3));
  const spreadSlope = slopePerYear(tail(cmpSpread));
  const gmSlopeT = slopePerYear(tail(gmCmp));
  const omSlopeT = slopePerYear(tail(om.slice(from)));
  const signals = [
    spreadSlope >= 0.01 ? 1 : spreadSlope <= -0.01 ? -1 : 0,
    gmSlopeT >= 0.005 ? 1 : gmSlopeT <= -0.005 ? -1 : 0,
    omSlopeT > 0 ? 1 : omSlopeT < 0 ? -1 : 0,
    inc != null && inc > mean ? 1 : inc != null && inc < mean ? -1 : 0,
  ];
  const ups = signals.filter((s) => s === 1).length;
  const downs = signals.filter((s) => s === -1).length + (spreadSlope <= -0.01 ? 1 : 0); // spread-down counts double
  let trend: MoatTrend;
  if (ups >= 3 && spreadSlope > -0.01) trend = "WIDENING";
  else if (downs >= 2) trend = "ERODING";
  else trend = "STABLE";

  return {
    width, trend, contingent, roic, spread, wacc, comparableFrom: from,
    incrementalRoic: inc, bearFloor: moatBearFloor(width, trend), flags,
  };
}
