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
 * Prototype scope: WACC is a build-up whose beta is measured when the pack carries
 * one (lib/facts/beta.ts) and a flagged sector proxy by SIC otherwise — and the effective
 * tax rate is assumed. A large stock-funded acquisition distorts invested
 * capital, so a structural-break test drops pre-break years and leans on
 * incremental ROIC, resolving to a "contingent" Narrow when the average spread
 * and the incremental economics disagree (3.md §3.3).
 */
import { classifySector } from "./gates";
import { MACRO } from "./macro";
import { portfolioBreakIndex } from "./intrinsic";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

export interface MoatFacts {
  ticker?: string;
  sector?: string;
  sic?: number | null;
  goodwill?: (number | null)[]; // per fiscal year, aligned to statements.fiscalYears
  goodwillRestated?: string[]; // fiscal years whose goodwill a later 10-K restated (lib/facts/enrich.ts restatedYears)
  beta?: { value: number } | null; // measured beta (lib/facts/beta.ts); else the SIC proxy
  quote: { marketCap: number };
  ttm: { interestCoverage: number | null };
  statements: { fiscalYears: string[]; income: Row[]; balance: Row[]; cashflow: Row[] };
}

export type MoatWidth = "WIDE" | "NARROW" | "NONE";
export type MoatTrend = "WIDENING" | "STABLE" | "ERODING";

export interface MoatConfig {
  taxRate?: number; // effective tax for NOPAT (assumed; flagged)
  wacc?: number; // explicit cost of capital; else the build-up below
  riskFree?: number; // desk macro input for the WACC build-up
  erp?: number; // equity risk premium
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
  goodwillAdjusted: boolean; // width judged on ex-goodwill ROIC (asset-heavy acquirer)
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

/** Sector beta by SIC — the fallback when a pack carries no measured beta (see betaFor). */
export function betaFromSic(sic: number | null | undefined): number {
  if (num(sic)) {
    if (sic >= 4900 && sic <= 4999) return 0.5; // utilities
    if (sic === 2834) return 0.8; // pharma
    if (sic === 4813) return 0.9; // telecom
    if (sic === 3674) return 1.7; // semiconductors
    if (sic === 7372) return 1.3; // software
    if (sic === 3559) return 1.3; // industrial machinery
    if (sic === 1090) return 1.4; // metal ores / miners
    if (sic === 3724 || sic === 3760) return 1.1; // aerospace / defense
    if (sic === 6200) return 1.0; // exchanges
    if (sic === 7389) return 1.1; // business services
  }
  return 1.1; // default
}

const creditSpread = (interestCoverage: number | null): number =>
  !num(interestCoverage) ? 0.025 : interestCoverage > 15 ? 0.01 : interestCoverage >= 8 ? 0.015 : interestCoverage >= 4 ? 0.025 : 0.04;

/** The beta the build-up uses: the pack's measured beta when captured, else the SIC proxy. */
export function betaFor(f: { sic?: number | null; beta?: { value: number } | null }): { beta: number; source: "measured" | "sic" } {
  const b = f.beta?.value;
  return num(b) && b > 0 ? { beta: b, source: "measured" } : { beta: betaFromSic(f.sic), source: "sic" };
}

/** Cost of equity: rf + β·ERP. The right discount rate for an equity/FCFE model (feeds 4.md too). */
export function costOfEquity(f: { sic?: number | null; beta?: { value: number } | null }, macro: { riskFree: number; erp: number }): number {
  return macro.riskFree + betaFor(f).beta * macro.erp;
}

/** WACC build-up (3.md §1.2): equity-weighted cost of equity + debt-weighted after-tax cost of debt. */
export function buildWacc(f: MoatFacts, macro: { riskFree: number; erp: number; taxRate: number }): number {
  const mc = f.quote.marketCap;
  const debt = val(f.statements.balance, "totalDebt", f.statements.fiscalYears.length - 1);
  const total = mc + debt;
  if (total <= 0) return costOfEquity(f, macro);
  const wE = mc / total;
  const wD = debt / total;
  const ke = costOfEquity(f, macro);
  const kd = macro.riskFree + creditSpread(f.ttm.interestCoverage);
  return wE * ke + wD * kd * (1 - macro.taxRate);
}

/** Documented sector-default WACC by SIC (3.md §1.2). A cruder fallback than the build-up. */
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
  // A rate-regulated utility earns its ALLOWED return by design (ROIC ≈ cost of capital), so an
  // ROIC−WACC spread reads NONE/eroding when the reality is a stable regulatory monopoly. The
  // ROIC−WACC method measures COMPETITIVE excess returns, which a regulated utility does not have.
  if (sector === "utility") return { ok: false, reason: "utility: regulated returns are not competitive excess returns (ROIC ≈ allowed return)" };
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
  const macro = { riskFree: cfg.riskFree ?? MACRO.riskFree, erp: cfg.erp ?? MACRO.erp, taxRate };
  const wacc = cfg.wacc ?? buildWacc(f, macro);
  const b = betaFor(f);
  const flags: string[] = [`WACC ${(wacc * 100).toFixed(1)}% (build-up, β≈${b.beta}${b.source === "sic" ? " sector proxy" : " measured"})`, `tax rate assumed ${(taxRate * 100).toFixed(0)}%`];

  const roic = roicSeries(f, taxRate);
  const spread = roic.map((r) => r - wacc);
  const ic = investedCapitalSeries(f);
  // Two break tests, the later one wins: an invested-capital jump (a large stock-funded deal) and a spin-off
  // (a > 20% revenue drop in a pack whose history a later 10-K restated — portfolioBreakIndex, the reverse
  // DCF's own test, so both engines drop the same pre-spin years; DD's Qnity spin halved revenue but moved
  // invested capital < 50%). A cyclical revenue collapse with no restatement is evidence, not a break.
  const icBreak = comparableWindow(ic);
  const revBreak = Math.max(0, portfolioBreakIndex(f));
  const from = Math.max(icBreak, revBreak);
  if (from > 0)
    flags.push(`structural break at ${f.statements.fiscalYears[from]} (${from === revBreak && revBreak > icBreak ? "spin-off: revenue drop > 20%, history restated" : "invested-capital jump > 50%"}) — pre-break years dropped`);
  const inc = incrementalRoic(f, taxRate, from);

  const cmpRoic = roic.slice(from);
  const cmpSpread = spread.slice(from);

  // Ex-goodwill excess return: for an acquirer, acquisition goodwill inflates invested
  // capital and drags reported ROIC below its operating reality. When goodwill is a
  // material share of the base, the level/stability tests read the ex-goodwill spread.
  const gw = f.goodwill;
  const goodwillMaterial =
    !!gw && f.statements.fiscalYears.some((_, i) => num(gw[i]) && ic[i] > 0 && (gw[i] as number) / ic[i] > 0.15);
  const roicForLevel = goodwillMaterial
    ? roic.map((r, i) => {
        const g = gw && num(gw[i]) ? (gw[i] as number) : 0;
        const exIc = ic[i] - g;
        return exIc > 0 ? (val(f.statements.income, "operatingIncome", i) * (1 - taxRate)) / exIc : r;
      })
    : roic;
  const spreadForLevel = roicForLevel.map((r) => r - wacc);
  const cmpRoicLevel = roicForLevel.slice(from);
  const cmpSpreadLevel = spreadForLevel.slice(from);
  if (goodwillMaterial) flags.push("width goodwill-adjusted (ex-goodwill ROIC)");
  // Deferred (docs/engine.md): goodwill is on the latest-filed (restated) basis, the statement columns may
  // be on the original one; flag the years where that can mix bases instead of guessing which to use.
  const restatedCmp = (f.goodwillRestated ?? []).filter((fy) => f.statements.fiscalYears.indexOf(fy) >= from);
  if (goodwillMaterial && restatedCmp.length)
    flags.push(`goodwill restated by a later filing for ${restatedCmp.join(", ")} — ex-goodwill ROIC for those years may mix restated goodwill with as-reported statements`);

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
  const A: MoatWidth = median(cmpSpreadLevel) >= 0.08 ? "WIDE" : median(cmpSpreadLevel) >= 0 ? "NARROW" : "NONE";
  const posShare = cmpSpreadLevel.filter((s) => s > 0).length / Math.max(1, cmpSpreadLevel.length);
  const meanLevel = cmpRoicLevel.reduce((a, b) => a + b, 0) / Math.max(1, cmpRoicLevel.length);
  const cov = meanLevel !== 0 ? Math.sqrt(cmpRoicLevel.reduce((a, b) => a + (b - meanLevel) ** 2, 0) / cmpRoicLevel.length) / Math.abs(meanLevel) : Infinity;
  const B: MoatWidth = posShare >= 0.8 && cov < 0.35 ? "WIDE" : posShare >= 0.4 ? "NARROW" : "NONE";
  const mean = cmpRoic.reduce((a, b) => a + b, 0) / Math.max(1, cmpRoic.length); // as-reported, for the trend
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

  // Insufficient history (3.md §8): a trend needs >=3 comparable years, so withhold it below that;
  // and a genuine young issuer (<4 total fiscal years) has too little to support any width verdict.
  const nComparable = f.statements.fiscalYears.length - from;
  if (nComparable < 3) {
    trend = "STABLE";
    flags.push(`trend withheld (${nComparable} comparable yr < 3)`);
    if (f.statements.fiscalYears.length < 4) {
      width = "NONE";
      contingent = false;
      flags.push("width withheld (young issuer, < 4 fiscal years)");
    }
  }

  return {
    width, trend, contingent, roic, spread, wacc, comparableFrom: from,
    incrementalRoic: inc, goodwillAdjusted: goodwillMaterial, bearFloor: moatBearFloor(width, trend), flags,
  };
}
