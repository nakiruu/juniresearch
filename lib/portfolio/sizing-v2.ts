/**
 * sizing-v2.ts — EXPERIMENTAL Kelly-tilt sizer, behind a flag (PROTOTYPE).
 * ---------------------------------------------------------------------------------
 * Nico's proposed form was  w ∝ k · (μ/σ²) · (C/50)^α · (Q/50)^β · L.  The μ/σ² Kelly
 * core is deliberately NOT used: on this book every name's raw k·μ/σ² clears the 10%
 * cap (V 239% … KTOS 35%), so it collapses to capped-equal-weight AND ranks low-σ names
 * to the top — the opposite of a high-growth mandate — and it amplifies error in a 3-point
 * scenario σ (Michaud). This variant keeps the centered, tunable (C/50)^α · (Q/50)^β tilt
 * and the composite quality Q, but pairs them with a BOUNDED core so the tilt actually
 * differentiates the book instead of being erased by the cap:
 *
 *     w_raw = core · (C/50)^α · (Q/50)^β · staleness · L,   core ∈ { μ·R, μ/σ }
 *
 * μ·R (default) is the current desk risk unit (reward vs bear-case downside); μ/σ is a
 * Sharpe-style lean, linear in σ — never σ². Everything downstream (eligibility, wMax,
 * sector cap, dust, cash) is shared with the production sizer via the scorer injection in
 * sizePortfolio, so only the ranking changes. This is a candidate to A/B against the
 * production sizer and 1/N in the point-in-time backtest, not a default.
 */
import type { Report } from "@/lib/report.schema";
import type { Signal } from "./signal";
import { qualityScores, DEFAULT_QUALITY_WEIGHTS, type QualityWeights } from "./quality";

export interface LiquidityBuckets { largeMinUsd: number; midMinUsd: number; largeL: number; midL: number; smallL: number }

export interface SizingV2Config {
  riskCore: "R" | "invSigma"; // μ·R (downside-based) or μ/σ (Sharpe-style). Never μ/σ².
  convTiltExp: number;        // α — conviction tilt exponent (default 1.0)
  qualTiltExp: number;        // β — quality tilt exponent (default 0.6)
  sigmaFloor: number;         // floor on σ for the invSigma core, so a tight scenario spread can't blow up
  taxRate: number;            // for the ROIC sub-score
  qualityWeights: QualityWeights;
  liquidityBuckets: LiquidityBuckets;
}

export const DEFAULT_SIZING_V2: SizingV2Config = {
  riskCore: "R",
  convTiltExp: 1.0,
  qualTiltExp: 0.6,
  sigmaFloor: 0.05,
  taxRate: 0.21,
  qualityWeights: DEFAULT_QUALITY_WEIGHTS,
  liquidityBuckets: { largeMinUsd: 10e9, midMinUsd: 2e9, largeL: 1.0, midL: 0.9, smallL: 0.7 },
};

/** L ∈ (0,1]: large-cap 1.0, mid 0.9, small 0.7. Unknown cap → no penalty (1.0) in the prototype. */
export function liquidityFactor(marketCapUsd: number | null, cfg: SizingV2Config): number {
  const b = cfg.liquidityBuckets;
  if (marketCapUsd == null || !Number.isFinite(marketCapUsd)) return b.largeL;
  if (marketCapUsd >= b.largeMinUsd) return b.largeL;
  if (marketCapUsd >= b.midMinUsd) return b.midL;
  return b.smallL;
}

export function scoreWeightV2(s: Signal, quality100: number, liquidity: number, cfg: SizingV2Config): number {
  if (s.R == null) return 0;
  const mu = Math.max(s.mu, 0);
  const core = cfg.riskCore === "invSigma" ? mu / Math.max(s.sigma, cfg.sigmaFloor) : mu * Math.max(s.R, 0);
  const C = Math.max(s.kappa * 100, 1e-9);
  const Q = Math.max(quality100, 1e-9);
  const tilt = Math.pow(C / 50, cfg.convTiltExp) * Math.pow(Q / 50, cfg.qualTiltExp);
  const L = Math.max(0, Math.min(1, liquidity));
  const score = core * tilt * s.staleness * L;
  return Number.isFinite(score) && score > 0 ? score : 0;
}

/**
 * Build the scorer closure. Quality is cross-sectional (computed once over the whole covered
 * universe); liquidity is per-name from market cap. A ticker with no report scores at neutral
 * quality (50). The returned function is drop-in for sizePortfolio's `scorer` argument.
 */
export function makeV2Scorer(reports: Report[], marketCap: Map<string, number | null>, cfg: SizingV2Config): (s: Signal) => number {
  const quality = qualityScores(reports, cfg.qualityWeights, { taxRate: cfg.taxRate });
  return (s) => scoreWeightV2(s, quality.get(s.ticker) ?? 50, liquidityFactor(marketCap.get(s.ticker) ?? null, cfg), cfg);
}
