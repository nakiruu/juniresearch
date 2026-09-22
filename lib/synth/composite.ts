/**
 * composite.ts — the cross-sectional multi-factor composite (5.md).
 * -----------------------------------------------------------------------------
 * Scores a name relative to something rather than against absolute cutoffs: the
 * Value sleeve ranks its valuation yields against its now-populated peers (the
 * capability the peer-multiple backfill unblocked); Quality ranks margins against
 * the company's own five-year history; Growth and Momentum map trailing/forward
 * growth and the 52-week range position. The sleeves combine, confidence-weighted,
 * into one 0-100 percentile that feeds decide()'s corroboration and conviction.
 * The named quality/distress GATES half of 5.md already lives in gates.ts.
 *
 * Prototype scope: peers carry only pe/ps/evToEbitda, so only Value is truly
 * peer-relative; Quality is time-series, Growth/Momentum are level maps. Robust
 * by construction — percentile rank ignores outlier magnitude (an ASML EV/EBITDA
 * of 2707x barely moves a rank). Abstains on financials (margins/EV-EBITDA are
 * not comparable for banks). See 5.md.
 */
import { classifySector } from "./gates";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

export interface CompositeFacts {
  ticker?: string;
  sector?: string;
  sic?: number | null;
  quote: { price: number; week52Low: number; week52High: number; dividendYield?: number | null };
  ttm: {
    pe: number | null; ps: number | null; evToEbitda: number | null;
    grossMargin: number | null; operatingMargin: number | null; netMargin: number | null;
    interestCoverage: number | null; fcfYield: number | null;
  };
  latestQuarter: { revenueYoY: number | null };
  estimates: { nextFY: { revenue: number | null; eps: number | null }; followingFY: { revenue: number | null; eps: number | null } };
  statements: { fiscalYears: string[]; income: Row[] };
  peers: { ticker: string; pe: number | null; ps: number | null; evToEbitda: number | null }[];
}

export type Confidence = "high" | "medium" | "low";

export interface CompositeResult {
  percentile: number | null; // 0-100, null if abstained
  confidence: Confidence;
  sleeves: { value: number | null; quality: number | null; growth: number | null; momentum: number | null };
  reason?: string;
}

const num = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const logistic = (z: number) => 1 / (1 + Math.exp(-z));
const normalCdf = (z: number) => logistic(1.702 * z); // logistic approximation of Φ

/** Percentile rank of `x` within {x} ∪ comparison (5.md §3.2). Robust to outlier magnitude. */
export function percentileRank(x: number, comparison: number[], higherBetter: boolean): number {
  const set = [x, ...comparison];
  const le = higherBetter ? set.filter((v) => v <= x).length : set.filter((v) => v >= x).length;
  return (le - 0.5) / set.length;
}

const series = (income: Row[], key: string) => income.find((r) => r.key === key)?.values ?? [];

/** Value: rank the company's earnings/sales/EBITDA yields against its peers (higher yield = cheaper). */
export function valueSleeve(f: CompositeFacts): { rank: number | null; validPeers: number } {
  const yield_ = (mult: number | null) => (num(mult) && mult > 0 ? 1 / mult : null);
  const metrics: { own: number | null; peers: (number | null)[] }[] = [
    { own: yield_(f.ttm.pe), peers: f.peers.map((p) => yield_(p.pe)) },
    { own: yield_(f.ttm.ps), peers: f.peers.map((p) => yield_(p.ps)) },
    { own: yield_(f.ttm.evToEbitda), peers: f.peers.map((p) => yield_(p.evToEbitda)) },
  ];
  const ranks: number[] = [];
  let minValid = Infinity;
  for (const m of metrics) {
    const peerVals = m.peers.filter(num);
    if (!num(m.own) || peerVals.length < 3) continue; // need a real cross-section
    ranks.push(percentileRank(m.own, peerVals, true));
    minValid = Math.min(minValid, peerVals.length);
  }
  if (!ranks.length) return { rank: null, validPeers: 0 };
  return { rank: ranks.reduce((a, b) => a + b, 0) / ranks.length, validPeers: minValid };
}

/** Quality: current margins vs the company's own five-year history (time-series z → percentile). */
function qualitySleeve(f: CompositeFacts): number | null {
  const rev = series(f.statements.income, "revenue");
  const marginHistory = (key: string): number[] =>
    rev.map((r, i) => (num(r) && r !== 0 && num(series(f.statements.income, key)[i]) ? (series(f.statements.income, key)[i] as number) / r : NaN)).filter((x) => !Number.isNaN(x));
  const zPct = (current: number | null, hist: number[]): number | null => {
    if (!num(current) || hist.length < 3) return null;
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
    return sd === 0 ? 0.5 : normalCdf((current - mean) / sd);
  };
  const parts = [
    zPct(f.ttm.grossMargin, marginHistory("grossProfit")),
    zPct(f.ttm.operatingMargin, marginHistory("operatingIncome")),
    zPct(f.ttm.netMargin, marginHistory("netIncome")),
  ].filter(num);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

/** Growth: trailing YoY and forward revenue growth, mapped through a logistic centered on ~8%. */
function growthSleeve(f: CompositeFacts): number | null {
  const rev = series(f.statements.income, "revenue");
  const latestRev = [...rev].reverse().find(num);
  const fwd = num(f.estimates.nextFY.revenue) && num(latestRev) && latestRev !== 0 ? f.estimates.nextFY.revenue! / latestRev - 1 : null;
  const gs = [f.latestQuarter.revenueYoY, fwd].filter(num).map((g) => logistic((g - 0.08) / 0.12));
  return gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null;
}

/** Momentum: position within the 52-week range. */
function momentumSleeve(f: CompositeFacts): number | null {
  const { price, week52Low: lo, week52High: hi } = f.quote;
  if (!num(price) || !num(lo) || !num(hi) || hi <= lo) return null;
  return clamp01((price - lo) / (hi - lo));
}

export function compositeScore(f: CompositeFacts): CompositeResult {
  if (classifySector(f) === "financial")
    return { percentile: null, confidence: "low", sleeves: { value: null, quality: null, growth: null, momentum: null }, reason: "financial: margins / EV-EBITDA not cross-sectionally comparable" };

  const value = valueSleeve(f);
  const quality = qualitySleeve(f);
  const growth = growthSleeve(f);
  const momentum = momentumSleeve(f);

  // Confidence-weighted mean of the available sleeve ranks.
  const weighted: { rank: number; w: number }[] = [];
  if (value.rank != null) weighted.push({ rank: value.rank, w: value.validPeers >= 3 ? 1.0 : 0.5 });
  if (quality != null) weighted.push({ rank: quality, w: 0.7 });
  if (growth != null) weighted.push({ rank: growth, w: 0.7 });
  if (momentum != null) weighted.push({ rank: momentum, w: 0.4 });
  if (!weighted.length) return { percentile: null, confidence: "low", sleeves: { value: value.rank, quality, growth, momentum }, reason: "no sleeve computable" };

  const composite = weighted.reduce((a, s) => a + s.rank * s.w, 0) / weighted.reduce((a, s) => a + s.w, 0);
  const confidence: Confidence = value.rank != null && value.validPeers >= 3 ? "high" : value.rank != null ? "medium" : "low";
  return { percentile: 100 * composite, confidence, sleeves: { value: value.rank, quality, growth, momentum } };
}
