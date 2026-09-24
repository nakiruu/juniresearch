/**
 * config.ts — the trade layer's knobs, layered on the portfolio config.
 * Spec §12. `rMin`/`muMin` stay for the analytical snapshot; trading uses the band pair.
 */
import { DEFAULT_CONFIG, type PortfolioConfig } from "../portfolio/config";

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
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  ...DEFAULT_CONFIG,
  muEnter: 0.08, muExit: 0.03, rEnter: 0.6, rExit: 0.35,
  tradeBand: 0.025, lockBusinessDays: 5, markMode: "settled",
  minOrderUsd: 25, maxOrdersPerRun: 40, maxNotionalFrac: 1.0,
  useQualityTilt: true,
};

export function resolveTradeConfig(overrides: Partial<TradeConfig> = {}): TradeConfig {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...overrides };
  if (!(cfg.rExit < cfg.rEnter)) throw new Error(`rExit (${cfg.rExit}) must be below rEnter (${cfg.rEnter})`);
  if (!(cfg.muExit < cfg.muEnter)) throw new Error(`muExit (${cfg.muExit}) must be below muEnter (${cfg.muEnter})`);
  if (!Number.isInteger(cfg.lockBusinessDays) || cfg.lockBusinessDays < 1) throw new Error("lockBusinessDays must be a positive integer");
  return cfg;
}
