/**
 * config.ts — the trade layer's knobs, layered on the portfolio config.
 * Spec §12. `rMin`/`muMin` stay for the analytical snapshot; trading uses the band pair.
 */
import { DEFAULT_CONFIG, type PortfolioConfig } from "../portfolio/config";
import { hhmmToMinutes } from "./clock";

export type LiquidityBucket = "large" | "mid" | "small";

export interface TradeConfig extends PortfolioConfig {
  muEnter: number;          // enter only if re-marked expected upside >= this (0.08)
  muExit: number;           // exit a held name only if upside < this (0.03 — rallied to target)
  rEnter: number;           // enter only if reward/risk >= this (0.60)
  rExit: number;            // exit only if reward/risk < this (0.35 — asymmetry genuinely gone)
  tradeBand: number;        // no-trade band on held names, absolute weight (0.025)
  lockBusinessDays: number; // trading days from a fill to the first legal opposite-side trade (5 = ICE rule: 5 business days counting the transaction day → first legal on the 6th trading day; symmetric, whole-ticker)
  markMode: "settled" | "live";
  minOrderUsd: number;      // skip dust trades below this notional
  maxOrdersPerRun: number;  // run-level sanity cap on order count
  maxNotionalFrac: number;  // run-level cap on total submitted notional as a fraction of NAV
  useQualityTilt: boolean;  // spec §5.4 — multiply scoreWeight by Signal.quality
  // Phase 2 (spec §7) — slippage-capped limit pricing, gap-halt, freshness, and run breakers.
  cronTimeET: string;                            // scheduled trigger, ET wall-clock ("09:45")
  limitTol: Record<LiquidityBucket, number>;     // entry τ floor, by bucket
  limitTolMax: Record<LiquidityBucket, number>;  // per-bucket hard cap on τ
  limitTolBeta: number;                          // spread-widening coefficient on τ
  limitTolMin: number;                           // absolute floor under every bucket's τ
  exitTolMult: number;                           // exits widen τ by this multiple (easier fills)
  gapHalt: Record<LiquidityBucket, number>;      // per-bucket halt threshold vs the clean reference
  maxStaleMin: Record<LiquidityBucket, number>;  // per-bucket freshness window, minutes
  closeAnchorSizeMult: number;                   // size multiplier when anchored to the prior close (tier 3)
  maxRunTurnoverFrac: number;                    // turnover breaker — fraction of NAV per run
  consecutiveHaltLimit: number;                  // consecutive halted runs before blocking further runs
  reconcileOrders: boolean;                      // reconcile also requires every broker order in the lock window to be recorded in fills.jsonl
  maxLateMin: number;                            // fire window: a cron run starting later than cronTimeET + this (ET) is refused as "late"
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  ...DEFAULT_CONFIG,
  muEnter: 0.08, muExit: 0.03, rEnter: 0.6, rExit: 0.35,
  tradeBand: 0.025, lockBusinessDays: 5, markMode: "settled",
  minOrderUsd: 25, maxOrdersPerRun: 40, maxNotionalFrac: 1.0,
  useQualityTilt: true,
  cronTimeET: "09:45",
  limitTol: { large: 0.0015, mid: 0.0035, small: 0.0080 },
  limitTolMax: { large: 0.0040, mid: 0.0100, small: 0.0150 },
  limitTolBeta: 0.5, limitTolMin: 0.0005, exitTolMult: 1.5,
  gapHalt: { large: 0.10, mid: 0.15, small: 0.25 },
  maxStaleMin: { large: 5, mid: 15, small: 60 },
  closeAnchorSizeMult: 0.5, maxRunTurnoverFrac: 0.15, consecutiveHaltLimit: 3,
  maxLateMin: 20, reconcileOrders: true,
};

/**
 * The one shared liquidity-bucket lookup (v1 spec §7.8 cost bucket; Phase 2 spec §7 reuses it for
 * τ, τ_max, gapHalt, and maxStale): market-cap large >= $10B, mid >= $2B, else small;
 * null/non-finite -> mid. Canonical definition — costs.ts re-exports this, never redefine it.
 */
export function bucketFor(marketCapUsd: number | null): LiquidityBucket {
  if (marketCapUsd == null || !Number.isFinite(marketCapUsd)) return "mid";
  if (marketCapUsd >= 10e9) return "large";
  if (marketCapUsd >= 2e9) return "mid";
  return "small";
}

const BUCKETS: LiquidityBucket[] = ["large", "mid", "small"];

export function resolveTradeConfig(overrides: Partial<TradeConfig> = {}): TradeConfig {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...overrides };
  if (!(cfg.rExit < cfg.rEnter)) throw new Error(`rExit (${cfg.rExit}) must be below rEnter (${cfg.rEnter})`);
  if (!(cfg.muExit < cfg.muEnter)) throw new Error(`muExit (${cfg.muExit}) must be below muEnter (${cfg.muEnter})`);
  if (!Number.isInteger(cfg.lockBusinessDays) || cfg.lockBusinessDays < 1) throw new Error("lockBusinessDays must be a positive integer");

  for (const b of BUCKETS) {
    if (!(cfg.limitTol[b] > 0)) throw new Error(`limitTol.${b} (${cfg.limitTol[b]}) must be positive`);
    if (!(cfg.limitTol[b] <= cfg.limitTolMax[b])) throw new Error(`limitTol.${b} (${cfg.limitTol[b]}) must be <= limitTolMax.${b} (${cfg.limitTolMax[b]})`);
    if (!(cfg.limitTolMax[b] <= 0.5)) throw new Error(`limitTolMax.${b} (${cfg.limitTolMax[b]}) must be <= 0.5`);
    if (!(cfg.gapHalt[b] > 0 && cfg.gapHalt[b] < 1)) throw new Error(`gapHalt.${b} (${cfg.gapHalt[b]}) must be in (0, 1)`);
    if (!(cfg.maxStaleMin[b] > 0)) throw new Error(`maxStaleMin.${b} (${cfg.maxStaleMin[b]}) must be positive`);
  }
  const minLimitTol = Math.min(cfg.limitTol.large, cfg.limitTol.mid, cfg.limitTol.small);
  if (!(cfg.limitTolMin > 0 && cfg.limitTolMin <= minLimitTol)) throw new Error(`limitTolMin (${cfg.limitTolMin}) must be in (0, ${minLimitTol}]`);
  if (!(cfg.closeAnchorSizeMult > 0 && cfg.closeAnchorSizeMult <= 1)) throw new Error(`closeAnchorSizeMult (${cfg.closeAnchorSizeMult}) must be in (0, 1]`);
  if (!(cfg.maxRunTurnoverFrac > 0 && cfg.maxRunTurnoverFrac <= 1)) throw new Error(`maxRunTurnoverFrac (${cfg.maxRunTurnoverFrac}) must be in (0, 1]`);
  hhmmToMinutes(cfg.cronTimeET); // throws on a malformed "HH:MM"
  if (!(Number.isInteger(cfg.maxLateMin) && cfg.maxLateMin > 0 && cfg.maxLateMin <= 390)) throw new Error(`maxLateMin (${cfg.maxLateMin}) must be an integer in (0, 390]`);
  if (!(cfg.consecutiveHaltLimit >= 1)) throw new Error(`consecutiveHaltLimit (${cfg.consecutiveHaltLimit}) must be >= 1`);

  return cfg;
}
