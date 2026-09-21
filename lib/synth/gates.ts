/**
 * gates.ts — the non-compensatory fundamental floor under the E/R rating.
 * -----------------------------------------------------------------------------
 * The rating spine (conviction.ts) is valuation-only: E and R say nothing about
 * whether the business survives a shock or whether its earnings are real. These
 * gates read the statements a filing already carries and answer that separately,
 * as three named constructs — a financial-distress zone, the Piotroski F-Score,
 * and Sloan cash-flow accruals. Each can only CAP the label (push it toward a
 * sell); none can raise it. That preserves conviction.ts's invariant — the
 * machinery is never more aggressive than the E/R rule — and adds the fundamental
 * floor the scenario math cannot see. See docs/scoreconcepts/5.md and 6.md.
 *
 * Prototype scope: the interim distress proxy and the invested-capital proxy
 * (equity + debt) stand in for fields the FactPack does not yet expose (total
 * assets, going-concern text). Every proxy is flagged so a reader never mistakes
 * it for the full construct; the formulas are drop-in once the fields arrive.
 */
import type { RatingLabel } from "./judgment.schema";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

/** The slice of a FactPack the gates read — any full FactPack satisfies it structurally. */
export interface GateFacts {
  statements: {
    fiscalYears: string[];
    income: Row[];
    balance: Row[];
    cashflow: Row[];
  };
  ttm: {
    interestCoverage: number | null;
    netDebtToEbitda: number | null;
    currentRatio: number | null;
  };
}

export type DistressZone = "SAFE" | "GREY" | "DISTRESS";
export type Confidence = "high" | "medium" | "low";
export type AccrualFlag = "HIGH" | "NEUTRAL" | "LOW";

export interface DistressResult {
  zone: DistressZone;
  reasons: string[];
}
export interface PiotroskiResult {
  score: number;
  max: number;
  signals: Record<string, boolean | null>;
}
export interface AccrualResult {
  ratio: number | null;
  flag: AccrualFlag | null;
}
export interface GateResult {
  /** The most conservative bucket the rating may reach; "STRONG BUY" means no cap. */
  ceiling: RatingLabel;
  flags: string[];
  confidence: Confidence;
  distress: DistressResult;
  piotroski: PiotroskiResult;
  accruals: AccrualResult;
}

const ORDER: RatingLabel[] = ["STRONG SELL", "SELL", "HOLD", "BUY", "STRONG BUY"];
const rank = (l: RatingLabel) => ORDER.indexOf(l);

/** Lower a label to the ceiling; already-lower labels pass through unchanged. Never raises. */
export function applyGateCeiling(label: RatingLabel, ceiling: RatingLabel): RatingLabel {
  return ORDER[Math.min(rank(label), rank(ceiling))];
}

// --- statement access helpers ------------------------------------------------

function series(section: Row[], key: string): (number | null)[] | undefined {
  return section.find((r) => r.key === key)?.values;
}
const at = (v: (number | null)[] | undefined, i: number): number | null => (v ? v[i] ?? null : null);
const num = (x: number | null): x is number => x != null && Number.isFinite(x);

// --- the three constructs ----------------------------------------------------

/** Interim distress proxy: a three-zone read built only from ratios the pack carries. */
function distress(f: GateFacts): DistressResult {
  const { interestCoverage: ic, netDebtToEbitda: nd, currentRatio: cr } = f.ttm;
  const fcf = f.statements.cashflow;
  const bal = f.statements.balance;
  const n = f.statements.fiscalYears.length - 1;
  const fcfLatest = at(series(fcf, "freeCashFlow"), n);
  const cash = at(series(bal, "cashAndInvestments"), n);

  const reasons: string[] = [];
  // Hard distress: any single unambiguous solvency failure.
  if (num(ic) && ic < 1) reasons.push(`interest coverage ${ic.toFixed(1)}x < 1x`);
  if (num(nd) && nd > 5) reasons.push(`net debt / EBITDA ${nd.toFixed(1)}x > 5x`);
  if (num(cr) && cr < 1 && num(fcfLatest) && fcfLatest < 0 && num(cash) && cash < Math.abs(fcfLatest))
    reasons.push("current ratio < 1 with negative FCF and under a year of cash");
  if (reasons.length) return { zone: "DISTRESS", reasons };

  // Safe requires every available test to pass; a burning FCF is excused only by >2y of cash.
  const coverageOk = num(ic) ? ic >= 3 : null;
  const leverageOk = num(nd) ? nd <= 3 : null;
  const liquidityOk = num(cr) ? cr >= 1 : null;
  const fcfOk = num(fcfLatest)
    ? fcfLatest > 0 || (num(cash) && cash > 2 * Math.abs(fcfLatest))
    : null;
  const checks = [coverageOk, leverageOk, liquidityOk, fcfOk];
  if (checks.every((c) => c === true)) return { zone: "SAFE", reasons: [] };

  const grey: string[] = [];
  if (coverageOk === false) grey.push("thin interest coverage");
  if (leverageOk === false) grey.push("elevated leverage");
  if (liquidityOk === false) grey.push("current ratio < 1");
  if (fcfOk === false) grey.push("negative free cash flow");
  if (checks.some((c) => c === null)) grey.push("a solvency input is unavailable");
  return { zone: "GREY", reasons: grey };
}

/** Piotroski F-Score over the latest fiscal transition; invested capital proxies total assets. */
function piotroski(f: GateFacts): PiotroskiResult {
  const inc = f.statements.income;
  const bal = f.statements.balance;
  const cf = f.statements.cashflow;
  const n = f.statements.fiscalYears.length - 1;
  const t = n;
  const p = n - 1;

  const ni = series(inc, "netIncome");
  const rev = series(inc, "revenue");
  const gp = series(inc, "grossProfit");
  const eps = series(inc, "epsDiluted");
  const equity = series(bal, "totalEquity");
  const debt = series(bal, "totalDebt");
  const crRow = series(bal, "currentRatio");
  const ocf = series(cf, "operatingCashFlow");
  const buy = series(cf, "buybacks");

  const investedCapital = (i: number): number | null => {
    const e = at(equity, i);
    const d = at(debt, i);
    return num(e) && num(d) ? e + d : null;
  };
  const ratio = (a: number | null, b: number | null): number | null =>
    num(a) && num(b) && b !== 0 ? a / b : null;
  const rising = (a: number | null, b: number | null): boolean | null =>
    num(a) && num(b) ? a > b : null;

  const icT = investedCapital(t);
  const icP = investedCapital(p);
  const shares = (i: number): number | null => {
    const e = at(eps, i);
    const income = at(ni, i);
    return num(e) && e !== 0 && num(income) && income > 0 ? income / e : null;
  };

  const signals: Record<string, boolean | null> = {
    roaPositive: num(at(ni, t)) ? (at(ni, t) as number) > 0 : null,
    ocfPositive: num(at(ocf, t)) ? (at(ocf, t) as number) > 0 : null,
    roaRising: rising(ratio(at(ni, t), icT), ratio(at(ni, p), icP)),
    accrualCfoOverNi: num(at(ocf, t)) && num(at(ni, t)) ? (at(ocf, t) as number) > (at(ni, t) as number) : null,
    // Lower debt/IC year over year — de-levering relative to the capital base.
    deLevering: (() => {
      const a = ratio(at(debt, t), icT);
      const b = ratio(at(debt, p), icP);
      return num(a) && num(b) ? a < b : null;
    })(),
    currentRatioRising: rising(at(crRow, t), at(crRow, p)),
    // No net issuance: a buyback is direct evidence; else fall back to the share proxy.
    noDilution: (() => {
      const b = at(buy, t);
      if (num(b) && b < 0) return true;
      const st = shares(t);
      const sp = shares(p);
      return num(st) && num(sp) ? st <= sp : null;
    })(),
    grossMarginRising: rising(ratio(at(gp, t), at(rev, t)), ratio(at(gp, p), at(rev, p))),
    assetTurnoverRising: rising(ratio(at(rev, t), icT), ratio(at(rev, p), icP)),
  };

  const score = Object.values(signals).filter((s) => s === true).length;
  return { score, max: 9, signals };
}

/** Sloan cash-flow accruals: earnings not backed by cash are a low-quality flag. */
function accruals(f: GateFacts): AccrualResult {
  const inc = f.statements.income;
  const bal = f.statements.balance;
  const n = f.statements.fiscalYears.length - 1;
  const niT = at(series(inc, "netIncome"), n);
  const ocfT = at(series(f.statements.cashflow, "operatingCashFlow"), n);
  const equity = series(bal, "totalEquity");
  const debt = series(bal, "totalDebt");
  const icT = num(at(equity, n)) && num(at(debt, n)) ? (at(equity, n) as number) + (at(debt, n) as number) : null;
  const icP =
    num(at(equity, n - 1)) && num(at(debt, n - 1)) ? (at(equity, n - 1) as number) + (at(debt, n - 1) as number) : null;
  const avgIc = num(icT) && num(icP) ? (icT + icP) / 2 : icT;
  if (!num(niT) || !num(ocfT) || !num(avgIc) || avgIc === 0) return { ratio: null, flag: null };
  const ratio = (niT - ocfT) / avgIc;
  const flag: AccrualFlag = ratio > 0.1 ? "HIGH" : ratio < 0 ? "LOW" : "NEUTRAL";
  return { ratio, flag };
}

// --- the gate: caps only, most conservative wins -----------------------------

export function evaluateGates(f: GateFacts): GateResult {
  const d = distress(f);
  const pio = piotroski(f);
  const acc = accruals(f);

  const n = f.statements.fiscalYears.length - 1;
  const fcfSeries = series(f.statements.cashflow, "freeCashFlow");
  const fcfLatest = at(fcfSeries, n);
  const fcfTrendNegative = num(fcfLatest) && fcfLatest < 0;

  let ceiling: RatingLabel = "STRONG BUY";
  const flags: string[] = [];
  const cap = (c: RatingLabel, flag: string) => {
    if (rank(c) < rank(ceiling)) ceiling = c;
    if (!flags.includes(flag)) flags.push(flag);
  };

  if (d.zone === "DISTRESS") cap("SELL", "distress");
  else if (d.zone === "GREY") cap("HOLD", "grey-distress");

  if (pio.score <= 1 && fcfTrendNegative) cap("SELL", "low-piotroski");
  else if (pio.score <= 2) cap("HOLD", "low-piotroski");

  if (acc.flag === "HIGH" && pio.score < 7) cap("HOLD", "earnings-quality");

  const ttmNull =
    !num(f.ttm.interestCoverage) || !num(f.ttm.netDebtToEbitda) || !num(f.ttm.currentRatio);
  const confidence: Confidence =
    d.zone === "GREY" || ttmNull || f.statements.fiscalYears.length < 2
      ? "low"
      : f.statements.fiscalYears.length >= 5
        ? "high"
        : "medium";

  return { ceiling, flags, confidence, distress: d, piotroski: pio, accruals: acc };
}
