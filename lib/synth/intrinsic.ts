/**
 * intrinsic.ts — the intrinsic-value / market-implied-expectations engine.
 * -----------------------------------------------------------------------------
 * A reverse DCF: instead of asserting a growth rate and comparing the value to
 * price, it takes the price as given and solves for the owner-earnings growth
 * the market is already paying for, then compares that to what five years of
 * statements say is achievable. The gap (implied − achievable) is the signal,
 * and the same model, run forward at a bear/base/bull growth, yields a fair-value
 * range that plugs straight into conviction.ts as mechanical scenarios. This
 * grounds E instead of leaving it to three free-hand analyst numbers.
 * See docs/scoreconcepts/4.md.
 *
 * Prototype scope: the discount rate is exogenous (no WACC field yet — see 3.md);
 * owner earnings uses trailing FCF (fcfYield × marketCap) because SBC is not a
 * separate FactPack row. Both are flagged limitations in 4.md §11.
 */
import type { ScenarioIn } from "../format";
import { classifySector } from "./gates";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

/** The slice of a FactPack the engine reads — any full FactPack satisfies it structurally. */
export interface IntrinsicFacts {
  ticker?: string;
  sector?: string;
  sic?: number | null;
  quote: { price: number; marketCap: number; sharesOutstanding: number };
  ttm: { fcfYield: number | null };
  statements: { fiscalYears: string[]; income: Row[]; cashflow: Row[] };
}

/**
 * A reverse DCF only makes sense for a mature, FCF-generative operating company.
 * It abstains for financials and utilities (no simple FCF stream to value) and for
 * any name with non-positive owner earnings (pre-/negative-FCF), where the model
 * has no meaningful solution. See 4.md §11.
 */
export function dcfApplicable(f: IntrinsicFacts): { ok: boolean; reason: string | null } {
  const sector = classifySector(f);
  if (sector !== "industrial") return { ok: false, reason: `${sector}: no FCF stream to value by DCF` };
  if (ownerEarningsBase(f) <= 0) return { ok: false, reason: "non-positive owner earnings (pre-/negative-FCF)" };
  return { ok: true, reason: null };
}

export interface IntrinsicConfig {
  r: number; // discount rate / cost of equity (exogenous)
  terminalGrowth: number;
  horizon: number; // explicit-stage years
}

export interface IntrinsicResult {
  ownerEarnings: number;
  impliedGrowth: number;
  impliedGrowthBand: [number, number, number]; // at r-2%, r, r+2%
  achievableGrowth: number;
  gap: number; // impliedGrowth − achievableGrowth (the signal)
  fairValue: { bear: number; base: number; bull: number }; // per share
  marginOfSafety: number; // base/price − 1 (negative = paying above the base case)
  scenarios: ScenarioIn[]; // fed into computeConviction()
  discountRate: number; // always reported
  flags: string[];
}

const num = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const series = (section: Row[], key: string) => section.find((r) => r.key === key)?.values;

/** Two-stage FCFE: owner earnings grow at g for N years, then at gt forever, discounted at r. */
export function dcfEquityValue(oe0: number, g: number, r: number, gt: number, N: number): number {
  let v = 0;
  let f = oe0;
  for (let t = 1; t <= N; t++) {
    f *= 1 + g;
    v += f / (1 + r) ** t;
  }
  const terminal = (f * (1 + gt)) / (r - gt) / (1 + r) ** N;
  return v + terminal;
}

export const fairValuePerShare = (oe0: number, g: number, shares: number, r: number, gt: number, N: number): number =>
  dcfEquityValue(oe0, g, r, gt, N) / shares;

/** Solve for the constant growth that makes the model equal the market's equity value. */
export function impliedGrowth(oe0: number, equityValue: number, r: number, gt: number, N: number): number {
  let lo = -0.1;
  let hi = 0.8;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (dcfEquityValue(oe0, mid, r, gt, N) > equityValue) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Trailing owner earnings — fcfYield × marketCap, falling back to the latest FCF statement row. */
export function ownerEarningsBase(f: IntrinsicFacts): number {
  const y = f.ttm.fcfYield;
  if (num(y) && num(f.quote.marketCap)) return y * f.quote.marketCap;
  const fcf = series(f.statements.cashflow, "freeCashFlow");
  const latest = fcf?.[fcf.length - 1];
  return num(latest) ? latest : 0;
}

/** A disciplined achievable growth: the five-year FCF CAGR (revenue CAGR as fallback), clamped. */
export function achievableGrowth(f: IntrinsicFacts): number {
  const cagr = (vals: (number | null)[] | undefined): number | null => {
    if (!vals || vals.length < 2) return null;
    const first = vals[0];
    const last = vals[vals.length - 1];
    if (!num(first) || !num(last) || first <= 0 || last <= 0) return null;
    return (last / first) ** (1 / (vals.length - 1)) - 1;
  };
  const g = cagr(series(f.statements.cashflow, "freeCashFlow")) ?? cagr(series(f.statements.income, "revenue")) ?? 0.03;
  return Math.min(0.35, Math.max(0.03, g));
}

export function intrinsicRead(f: IntrinsicFacts, cfg: IntrinsicConfig): IntrinsicResult {
  const { r, terminalGrowth: gt, horizon: N } = cfg;
  const oe0 = ownerEarningsBase(f);
  const equity = f.quote.marketCap;
  const shares = f.quote.sharesOutstanding;
  const price = f.quote.price;
  const flags: string[] = ["trailing-FCF owner-earnings proxy (SBC not isolated)", "exogenous discount rate"];

  const gImpl = impliedGrowth(oe0, equity, r, gt, N);
  const gAch = achievableGrowth(f);
  const fv = (g: number) => fairValuePerShare(oe0, g, shares, r, gt, N);

  // Bear halves the implied growth, base uses the achievable path, bull sits just under implied.
  // Label by resulting price so a cheap stock (implied < achievable) still orders bull >= base >= bear.
  const candidates = [
    { g: gImpl / 2, price: fv(gImpl / 2) },
    { g: gAch, price: fv(gAch) },
    { g: gImpl * 0.9, price: fv(gImpl * 0.9) },
  ].sort((a, b) => a.price - b.price);
  const [bear, base, bull] = candidates;
  const scenarios: ScenarioIn[] = [
    { name: "Bull", driver: `owner-earnings growth ~${(bull.g * 100).toFixed(0)}%/yr`, impliedPrice: bull.price, probability: 0.25 },
    { name: "Base", driver: `owner-earnings growth ~${(base.g * 100).toFixed(0)}%/yr`, impliedPrice: base.price, probability: 0.5 },
    { name: "Bear", driver: `owner-earnings growth ~${(bear.g * 100).toFixed(0)}%/yr`, impliedPrice: bear.price, probability: 0.25 },
  ];

  return {
    ownerEarnings: oe0,
    impliedGrowth: gImpl,
    impliedGrowthBand: [
      impliedGrowth(oe0, equity, r - 0.02, gt, N),
      gImpl,
      impliedGrowth(oe0, equity, r + 0.02, gt, N),
    ],
    achievableGrowth: gAch,
    gap: gImpl - gAch,
    fairValue: { bear: bear.price, base: base.price, bull: bull.price },
    marginOfSafety: base.price / price - 1,
    scenarios,
    discountRate: r,
    flags,
  };
}
