/**
 * gates.ts — the non-compensatory fundamental floor under the E/R rating.
 * -----------------------------------------------------------------------------
 * The rating spine (conviction.ts) is valuation-only: E and R say nothing about
 * whether the business survives a shock or whether its earnings are real. These
 * gates read the statements a filing already carries and answer that separately,
 * as named constructs — a financial-distress read, the Piotroski F-Score, and
 * Sloan cash-flow accruals. Each can only CAP the label (push it toward a sell);
 * none can raise it. That preserves conviction.ts's invariant — the machinery is
 * never more aggressive than the E/R rule — and adds the fundamental floor the
 * scenario math cannot see. See docs/scoreconcepts/5.md and 6.md.
 *
 * Sector-aware, and deliberately rare-and-severe (6.md §7.1's veto-collapse
 * guard). Industrial solvency ratios are meaningless for banks and normal-when-
 * high for utilities, and interest coverage only signals distress for a company
 * that actually carries net debt — so the gates branch on sector and on whether
 * the name is a net debtor, reserving a SELL ceiling for imminent solvency risk
 * (a liquidity crunch or a short cash runway) and a HOLD ceiling for a weak-but-
 * liquid balance sheet.
 *
 * Prototype scope: sector is classified from a small curated ticker map (with a
 * hook for a persisted `sector`/SIC once the pipeline provides one — the real
 * fix is to persist Yahoo assetProfile.sector); the interim distress read and
 * the invested-capital proxy (equity + debt) stand in for fields the FactPack
 * does not expose (total assets, going-concern text). Every proxy is flagged.
 */
import type { RatingLabel } from "./judgment.schema";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

/** The slice of a FactPack the gates read — any full FactPack satisfies it structurally. */
export interface GateFacts {
  ticker?: string;
  sector?: string;
  sic?: number | null;
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

export type Sector = "financial" | "utility" | "industrial";
export type DistressZone = "SAFE" | "WEAK" | "DISTRESS" | "NA";
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
  sector: Sector;
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

/**
 * A one-line advisory when a proposed label sits ABOVE the gate's fundamental
 * ceiling — i.e. the rating is more bullish than the balance sheet / earnings
 * quality supports. Returns null when the ceiling is not binding. The pipeline
 * surfaces this as a non-blocking warning (hard enforcement is a desk decision).
 */
export function gateAdvisory(label: RatingLabel, gate: GateResult): string | null {
  if (rank(gate.ceiling) >= rank(label)) return null;
  const why = gate.flags.length ? gate.flags.join(", ") : gate.distress.zone.toLowerCase();
  return `${label} sits above the fundamental-gate ceiling ${gate.ceiling} (sector: ${gate.sector}; ${why})`;
}

// --- sector classification ---------------------------------------------------

/**
 * SEC SIC → coarse gate sector. "financial" is the set where industrial solvency
 * ratios are structurally inapplicable: depository/credit institutions (6000-6199),
 * security brokers/investment banks (6211), and insurers (6300-6499). Utilities are
 * electric/gas/water/sanitary (4900-4999). Everything else — including exchanges
 * (SIC 6200: ICE, CME) and networks (7389: V), which are capital-light and net-cash —
 * is industrial, so the ratios still carry meaning. Returns null when SIC is absent.
 */
export function sectorFromSic(sic: number | null | undefined): Sector | null {
  if (sic == null || !Number.isFinite(sic)) return null;
  if ((sic >= 6000 && sic <= 6199) || sic === 6211 || (sic >= 6300 && sic <= 6499)) return "financial";
  if (sic >= 4900 && sic <= 4999) return "utility";
  return "industrial";
}

// Fallback for FactPacks captured before SIC was persisted. Only names where the
// industrial solvency ratios are structurally inapplicable (deposit-funded banks)
// or normal-when-high (regulated utilities) need listing; everything else defaults
// to industrial. Superseded by sectorFromSic whenever a persisted SIC is present.
const SECTOR_BY_TICKER: Record<string, Sector> = {
  BAC: "financial",
  JPM: "financial",
  WFC: "financial",
  EWBC: "financial",
  NEE: "utility",
};

function normalizeSector(s: string | undefined): Sector | null {
  if (!s) return null;
  if (/financ|bank|insur/i.test(s)) return "financial";
  if (/utilit/i.test(s)) return "utility";
  return "industrial";
}

/** SIC (authoritative, persisted) first, then a free-text sector, then the ticker map. */
export function classifySector(f: { ticker?: string; sector?: string; sic?: number | null }): Sector {
  return (
    sectorFromSic(f.sic) ??
    normalizeSector(f.sector) ??
    SECTOR_BY_TICKER[(f.ticker ?? "").toUpperCase()] ??
    "industrial"
  );
}

// --- statement access helpers ------------------------------------------------

function series(section: Row[], key: string): (number | null)[] | undefined {
  return section.find((r) => r.key === key)?.values;
}
const at = (v: (number | null)[] | undefined, i: number): number | null => (v ? v[i] ?? null : null);
const num = (x: number | null): x is number => x != null && Number.isFinite(x);

// --- distress: sector-aware severity tiers -----------------------------------

/**
 * SAFE / WEAK / DISTRESS / NA. DISTRESS (imminent solvency risk) → SELL ceiling;
 * WEAK (uncovered or over-levered but liquid) → HOLD ceiling; SAFE / NA → no cap.
 * A net-cash name is never distressed by low interest coverage — there is nothing
 * to cover — so the coverage tests require the company to be a net debtor.
 */
function assessDistress(f: GateFacts, sector: Sector): DistressResult {
  if (sector === "financial")
    return { zone: "NA", reasons: ["financial: industrial solvency ratios not applicable"] };

  const n = f.statements.fiscalYears.length - 1;
  const nd = at(series(f.statements.balance, "netDebt"), n);
  const cash = at(series(f.statements.balance, "cashAndInvestments"), n);
  const fcf = at(series(f.statements.cashflow, "freeCashFlow"), n);
  const ebitda = at(series(f.statements.income, "ebitda"), n);
  const { interestCoverage: ic, netDebtToEbitda: ndE, currentRatio: cr } = f.ttm;

  const netDebtor = num(nd) ? nd > 0 : num(ndE) ? ndE > 0 : false;
  const runwayYears = num(fcf) && fcf < 0 && num(cash) ? cash / Math.abs(fcf) : Infinity;

  // Imminent solvency risk → SELL ceiling.
  const reasons: string[] = [];
  if (num(cr) && cr < 1 && num(fcf) && fcf < 0 && runwayYears < 1)
    reasons.push(`current ratio ${cr.toFixed(2)} with negative FCF and under a year of cash`);
  if (netDebtor && num(ic) && ic < 1 && runwayYears < 2)
    reasons.push(`interest coverage ${ic.toFixed(1)}x on net debt with under two years of cash`);
  if (reasons.length) return { zone: "DISTRESS", reasons };

  // A utility's high leverage and sub-1 current ratio are normal; nothing else caps it.
  if (sector === "utility") return { zone: "SAFE", reasons: [] };

  // Uncovered or over-levered, but liquid → HOLD ceiling.
  const weak: string[] = [];
  if (netDebtor && num(ic) && ic < 1) weak.push(`interest coverage ${ic.toFixed(1)}x on net debt`);
  if (netDebtor && num(ndE) && ndE > 6 && num(ebitda) && ebitda > 0)
    weak.push(`net debt / EBITDA ${ndE.toFixed(1)}x`);
  if (weak.length) return { zone: "WEAK", reasons: weak };

  return { zone: "SAFE", reasons: [] };
}

// --- Piotroski F-Score (industrials) -----------------------------------------

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
    accrualCfoOverNi:
      num(at(ocf, t)) && num(at(ni, t)) ? (at(ocf, t) as number) > (at(ni, t) as number) : null,
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

// --- Sloan accruals ----------------------------------------------------------

/** Sloan cash-flow accruals: earnings not backed by cash are a low-quality flag. */
function accruals(f: GateFacts): AccrualResult {
  const inc = f.statements.income;
  const bal = f.statements.balance;
  const n = f.statements.fiscalYears.length - 1;
  const niT = at(series(inc, "netIncome"), n);
  const ocfT = at(series(f.statements.cashflow, "operatingCashFlow"), n);
  const equity = series(bal, "totalEquity");
  const debt = series(bal, "totalDebt");
  const ic = (i: number) =>
    num(at(equity, i)) && num(at(debt, i)) ? (at(equity, i) as number) + (at(debt, i) as number) : null;
  const icT = ic(n);
  const icP = ic(n - 1);
  const avgIc = num(icT) && num(icP) ? (icT + icP) / 2 : icT;
  if (!num(niT) || !num(ocfT) || !num(avgIc) || avgIc === 0) return { ratio: null, flag: null };
  const ratio = (niT - ocfT) / avgIc;
  const flag: AccrualFlag = ratio > 0.1 ? "HIGH" : ratio < 0 ? "LOW" : "NEUTRAL";
  return { ratio, flag };
}

// --- the gate: caps only, most conservative wins -----------------------------

export function evaluateGates(f: GateFacts): GateResult {
  const sector = classifySector(f);
  const d = assessDistress(f, sector);
  const pio = piotroski(f);
  const acc = accruals(f);

  const n = f.statements.fiscalYears.length - 1;
  const fcfLatest = at(series(f.statements.cashflow, "freeCashFlow"), n);
  const fcfTrendNegative = num(fcfLatest) && fcfLatest < 0;

  let ceiling: RatingLabel = "STRONG BUY";
  const flags: string[] = [];
  const cap = (c: RatingLabel, flag: string) => {
    if (rank(c) < rank(ceiling)) ceiling = c;
    if (!flags.includes(flag)) flags.push(flag);
  };

  if (d.zone === "DISTRESS") cap("SELL", "distress");
  else if (d.zone === "WEAK") cap("HOLD", "weak-balance-sheet");

  // Piotroski and accruals are non-financial constructs; their components are
  // distorted for banks and utilities, so they gate industrials only.
  if (sector === "industrial") {
    if (pio.score <= 1 && fcfTrendNegative) cap("SELL", "low-piotroski");
    else if (pio.score <= 2) cap("HOLD", "low-piotroski");
    // A single non-cash-earnings year is a soft signal; it caps only when it
    // corroborates a weak Piotroski (earnings not cash-backed AND weak fundamentals).
    if (acc.flag === "HIGH" && pio.score <= 3) cap("HOLD", "earnings-quality");
  }

  const ttmNull =
    !num(f.ttm.interestCoverage) || !num(f.ttm.netDebtToEbitda) || !num(f.ttm.currentRatio);
  const confidence: Confidence =
    f.statements.fiscalYears.length < 2 || d.zone === "WEAK"
      ? "low"
      : sector !== "industrial"
        ? "medium"
        : f.statements.fiscalYears.length >= 5 && d.zone === "SAFE" && !ttmNull
          ? "high"
          : "medium";

  return { ceiling, sector, flags, confidence, distress: d, piotroski: pio, accruals: acc };
}
