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
  // Decision marks. "live" (default): the run's own live price — fresh last trade → fresh quote mid →
  // the settled prior close, chosen per ticker and recorded (run record markSources). "settled": the
  // prior day's settled close (backtest-reproducible; the pre-2026-10 behaviour). Live marks apply only
  // on today's ET trading day inside the regular session; a past/future `today` (trade:plan --date) or a
  // pre/post-market run marks settled. Either way execution's reference close (gap-halt, tier-3 anchor)
  // is the settled prior close.
  markMode: "settled" | "live";
  minOrderUsd: number;      // whole-share mode only (fractionalShares off): skip dust trades below this notional
  // Hybrid execution (audit 2026-09-28): the whole-share part of an order goes as a τ-capped limit, the
  // fractional remainder as a MARKET order (Schwab only takes sub-share quantities at market, ≥ $1, ≤ 4 dp).
  fractionalShares: boolean;                     // false → legacy whole-share limit orders only
  minEnterUsd: number;                           // ENTER floor in fractional mode (the broker's $1 fractional minimum)
  minTradeUsd: number;                           // ADD/TRIM floor, $ …
  minTradeNavFrac: number;                       // …or this fraction of NAV, whichever is larger. Every fill starts a
                                                 // 5-day both-sides lock, so trivial rebalances must not trade. EXIT has no floor.
  marketOnlyBelowUsd: number;                    // an order this small goes entirely at market (not split into two orders)
  marketMaxSpread: Record<LiquidityBucket, number>; // a market leg needs a fresh quote with (ask−bid)/mid ≤ this
  maxOrdersPerRun: number;  // run-level sanity cap on order count
  maxNotionalFrac: number;  // run-level cap on total submitted notional as a fraction of NAV
  useQualityTilt: boolean;  // spec §5.4 — multiply scoreWeight by Signal.quality
  // Phase 2 (spec §7) — slippage-capped limit pricing, gap-halt, freshness, and run breakers.
  cronTimeET: string;                            // scheduled trigger, ET wall-clock ("15:10") — always cronTimesET[0]
  cronTimesET: string[];                         // every daily fire slot, ascending (["15:10"]; every slot must sit before submitCutoffET)
  submitCutoffET: string;                        // no order is submitted at or after this ET wall-clock time ("15:50"); before 16:00 and after every slot
  limitTol: Record<LiquidityBucket, number>;     // entry τ floor, by bucket
  limitTolMax: Record<LiquidityBucket, number>;  // per-bucket hard cap on τ
  limitTolBeta: number;                          // spread-widening coefficient on τ
  limitTolMin: number;                           // absolute floor under every bucket's τ
  exitTolMult: number;                           // exits widen τ by this multiple (easier fills)
  gapHalt: Record<LiquidityBucket, number>;      // per-bucket halt threshold vs the clean reference
  maxStaleMin: Record<LiquidityBucket, number>;  // per-bucket freshness window, minutes
  closeAnchorSizeMult: number;                   // size multiplier when anchored to the prior close (tier 3)
  maxRunTurnoverFrac: number;                    // turnover breaker — fraction of NAV per run
  maxDayTurnoverFrac: number;                    // …and across all of a day's runs (only binds with several cronTimesET slots)
  consecutiveHaltLimit: number;                  // consecutive halted runs before blocking further runs
  schwabRefreshLifetimeDays: number;             // Schwab refresh-token lifetime after trade:auth (7)
  schwabAuthWarnHours: number;                   // warn when fewer hours than this remain (72 covers a weekend)
  topUpRecentBuys: boolean;                      // HOLD adds on a name bought inside the lock window use residualBand, not tradeBand
  residualBand: number;                          // the smaller band for those top-ups (0.005)
  turnoverClipBuyOnly: boolean;                  // a BUY-ONLY plan (ENTER/ADD, no sells) over the turnover cap is clipped to the cap and the rest deferred (not halted), so a first rebalance converges over several runs
  reconcileOrders: boolean;                      // reconcile also requires every broker order in the lock window to be recorded in fills.jsonl
  maxLateMin: number;                            // fire window: a cron run starting later than cronTimeET + this (ET) is refused as "late"
  // Bear breach (docs/engine.md §4.2, breach.ts): a held name at/below its bear price (D = 0, R null).
  breachPolicy: "exit" | "byCause";              // "exit": sell every breach; "byCause": hold / freeze / exit by the stock-specific share of the fall
  breachMarketShareMax: number;                  // share below this → market-driven → HOLD, sized through bearFloor (0.5)
  breachStockShareMin: number;                   // share at/above this → stock-specific → EXIT; between the two → FREEZE (0.9)
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  ...DEFAULT_CONFIG,
  muEnter: 0.08, muExit: 0.03, rEnter: 0.6, rExit: 0.35,
  tradeBand: 0.025, lockBusinessDays: 5, markMode: "live",
  minOrderUsd: 25, maxOrdersPerRun: 40, maxNotionalFrac: 1.0,
  fractionalShares: true, minEnterUsd: 1, minTradeUsd: 1, minTradeNavFrac: 0.005, marketOnlyBelowUsd: 200,
  marketMaxSpread: { large: 0.01, mid: 0.01, small: 0.025 },
  useQualityTilt: true,
  // ONE decision a day, late: 15:10 ET on live prices. Avoids the open (widest spreads 09:30–10:00,
  // attention-inflated opening prints), decides on the same information ~18h sooner than the next
  // morning's settled close, buys down-day names ahead of the last-half-hour reversal, and the fill (so
  // the 5-day lock, counted from the fill date) lands a session earlier. 15:10 + maxLateMin 20 = 15:30,
  // and submitCutoffET 15:50 stops any later submit, so a run never trades into the close.
  // Early-close days (13:00 ET: the day after Thanksgiving, Christmas Eve; ~3 a year): the broker clock
  // reads closed at 15:10, trade:cron exits "closed", and nothing trades that day — accepted.
  // Revert to the morning: set the slot list below to "09:45" and markMode to "settled", then re-run
  // scripts/register-trade-cron.sh/.ps1 — they read the slots by grepping the next line, so keep it one
  // line in exactly this shape (and never write that key-plus-bracket pattern in a comment above it).
  cronTimeET: "15:10", cronTimesET: ["15:10"],
  submitCutoffET: "15:50",
  limitTol: { large: 0.0015, mid: 0.0035, small: 0.0080 },
  limitTolMax: { large: 0.0040, mid: 0.0100, small: 0.0150 },
  limitTolBeta: 0.5, limitTolMin: 0.0005, exitTolMult: 1.5,
  gapHalt: { large: 0.10, mid: 0.15, small: 0.25 },
  maxStaleMin: { large: 5, mid: 15, small: 60 },
  closeAnchorSizeMult: 0.5, maxRunTurnoverFrac: 0.15, maxDayTurnoverFrac: 0.25, consecutiveHaltLimit: 3,
  maxLateMin: 20, reconcileOrders: true, turnoverClipBuyOnly: true, topUpRecentBuys: false, residualBand: 0.005,
  schwabRefreshLifetimeDays: 7, schwabAuthWarnHours: 72,
  breachPolicy: "byCause", breachMarketShareMax: 0.5, breachStockShareMin: 0.9,
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

/**
 * Env overrides for the knobs the owner tunes on the server (applied by the production entry points:
 * trade:cron, the scheduler, trade:execute, trade:plan, trade:review). Unset → the defaults above.
 *   TRADE_MIN_USD       ADD/TRIM floor in dollars (default 1)
 *   TRADE_MIN_NAV_PCT   ADD/TRIM floor as a PERCENT of NAV (default 0.5 = 0.5%); the larger of the two applies
 * Every fill starts a 5-business-day lock, so a lower floor means more tickers locked by small rebalances.
 * A malformed value throws — a floor that silently fell back would trade on a setting the owner didn't choose.
 */
export function tradeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<TradeConfig> {
  const num = (name: string): number | undefined => {
    const raw = env[name]?.trim();
    if (raw == null || raw === "") return undefined;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${name}=${JSON.stringify(env[name])} must be a number >= 0`);
    return v;
  };
  const out: Partial<TradeConfig> = {};
  const usd = num("TRADE_MIN_USD");
  const pct = num("TRADE_MIN_NAV_PCT");
  if (usd != null) out.minTradeUsd = usd;
  if (pct != null) out.minTradeNavFrac = pct / 100;
  return out;
}

export function resolveTradeConfig(overrides: Partial<TradeConfig> = {}): TradeConfig {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...overrides };
  // One source of truth for the fire times: cronTimeET is the first slot. A cronTimeET-only override
  // (older callers) means a single slot.
  cfg.cronTimesET = overrides.cronTimesET ?? (overrides.cronTimeET ? [overrides.cronTimeET] : DEFAULT_TRADE_CONFIG.cronTimesET);
  if (!cfg.cronTimesET.length || cfg.cronTimesET.length > 4) throw new Error(`cronTimesET must hold 1–4 slots, got ${cfg.cronTimesET.length}`);
  cfg.cronTimesET.forEach((s, i) => {
    hhmmToMinutes(s);
    if (i > 0 && !(hhmmToMinutes(s) > hhmmToMinutes(cfg.cronTimesET[i - 1]))) throw new Error(`cronTimesET must be strictly ascending: ${cfg.cronTimesET.join(", ")}`);
  });
  cfg.cronTimeET = cfg.cronTimesET[0];
  if (!(cfg.rExit < cfg.rEnter)) throw new Error(`rExit (${cfg.rExit}) must be below rEnter (${cfg.rEnter})`);
  if (!(cfg.muExit < cfg.muEnter)) throw new Error(`muExit (${cfg.muExit}) must be below muEnter (${cfg.muEnter})`);
  if (!Number.isInteger(cfg.lockBusinessDays) || cfg.lockBusinessDays < 1) throw new Error("lockBusinessDays must be a positive integer");
  if (!(cfg.bearFloor >= 0 && cfg.bearFloor < 1)) throw new Error(`bearFloor (${cfg.bearFloor}) must be in [0, 1)`);
  if (cfg.breachPolicy !== "exit" && cfg.breachPolicy !== "byCause") throw new Error(`breachPolicy (${JSON.stringify(cfg.breachPolicy)}) must be "exit" or "byCause"`);
  if (!(cfg.breachMarketShareMax > 0 && cfg.breachMarketShareMax < cfg.breachStockShareMin && cfg.breachStockShareMin <= 1.5)) {
    throw new Error(`breach thresholds must satisfy 0 < breachMarketShareMax (${cfg.breachMarketShareMax}) < breachStockShareMin (${cfg.breachStockShareMin}) <= 1.5`);
  }
  // A market-driven breach is held with D = 0 and R null; only the bear floor gives it a finite size
  // (sizingRewardRisk). Without the floor its score is 0 and the "hold" would be sold down to nothing.
  if (cfg.breachPolicy === "byCause" && !(cfg.bearFloor > 0)) throw new Error(`breachPolicy "byCause" needs bearFloor > 0 (got ${cfg.bearFloor}) — a market-driven breach is sized through the floor`);

  for (const b of BUCKETS) {
    if (!(cfg.limitTol[b] > 0)) throw new Error(`limitTol.${b} (${cfg.limitTol[b]}) must be positive`);
    if (!(cfg.limitTol[b] <= cfg.limitTolMax[b])) throw new Error(`limitTol.${b} (${cfg.limitTol[b]}) must be <= limitTolMax.${b} (${cfg.limitTolMax[b]})`);
    if (!(cfg.limitTolMax[b] <= 0.5)) throw new Error(`limitTolMax.${b} (${cfg.limitTolMax[b]}) must be <= 0.5`);
    if (!(cfg.gapHalt[b] > 0 && cfg.gapHalt[b] < 1)) throw new Error(`gapHalt.${b} (${cfg.gapHalt[b]}) must be in (0, 1)`);
    if (!(cfg.maxStaleMin[b] > 0)) throw new Error(`maxStaleMin.${b} (${cfg.maxStaleMin[b]}) must be positive`);
  }
  for (const b of BUCKETS) if (!(cfg.marketMaxSpread[b] > 0 && cfg.marketMaxSpread[b] < 0.1)) throw new Error(`marketMaxSpread.${b} (${cfg.marketMaxSpread[b]}) must be in (0, 0.1)`);
  if (!(cfg.minEnterUsd >= 1)) throw new Error(`minEnterUsd (${cfg.minEnterUsd}) must be >= 1 (the broker's fractional minimum)`);
  if (!(cfg.minTradeUsd >= 0 && cfg.minTradeNavFrac >= 0 && cfg.minTradeNavFrac < 0.5)) throw new Error("minTradeUsd must be >= 0 and minTradeNavFrac in [0, 0.5)");
  if (!(cfg.marketOnlyBelowUsd >= 0)) throw new Error(`marketOnlyBelowUsd (${cfg.marketOnlyBelowUsd}) must be >= 0`);
  const minLimitTol = Math.min(cfg.limitTol.large, cfg.limitTol.mid, cfg.limitTol.small);
  if (!(cfg.limitTolMin > 0 && cfg.limitTolMin <= minLimitTol)) throw new Error(`limitTolMin (${cfg.limitTolMin}) must be in (0, ${minLimitTol}]`);
  if (!(cfg.closeAnchorSizeMult > 0 && cfg.closeAnchorSizeMult <= 1)) throw new Error(`closeAnchorSizeMult (${cfg.closeAnchorSizeMult}) must be in (0, 1]`);
  if (!(cfg.maxRunTurnoverFrac > 0 && cfg.maxRunTurnoverFrac <= 1)) throw new Error(`maxRunTurnoverFrac (${cfg.maxRunTurnoverFrac}) must be in (0, 1]`);
  hhmmToMinutes(cfg.cronTimeET); // throws on a malformed "HH:MM"
  // The cutoff bounds every submit of every slot: it must fall inside the session, after the last slot.
  const cutoffMin = hhmmToMinutes(cfg.submitCutoffET);
  const lastSlot = cfg.cronTimesET[cfg.cronTimesET.length - 1];
  if (!(cutoffMin < 16 * 60)) throw new Error(`submitCutoffET (${cfg.submitCutoffET}) must be before the 16:00 ET close`);
  if (!(cutoffMin > hhmmToMinutes(lastSlot))) throw new Error(`submitCutoffET (${cfg.submitCutoffET}) must be after every cronTimesET slot (last: ${lastSlot})`);
  if (!(cfg.residualBand > 0 && cfg.residualBand <= cfg.tradeBand)) throw new Error(`residualBand (${cfg.residualBand}) must be in (0, tradeBand ${cfg.tradeBand}]`);
  if (!(Number.isInteger(cfg.maxLateMin) && cfg.maxLateMin > 0 && cfg.maxLateMin <= 390)) throw new Error(`maxLateMin (${cfg.maxLateMin}) must be an integer in (0, 390]`);
  if (!(cfg.maxDayTurnoverFrac >= cfg.maxRunTurnoverFrac && cfg.maxDayTurnoverFrac <= 1)) throw new Error(`maxDayTurnoverFrac (${cfg.maxDayTurnoverFrac}) must be in [maxRunTurnoverFrac ${cfg.maxRunTurnoverFrac}, 1]`);
  if (!(cfg.consecutiveHaltLimit >= 1)) throw new Error(`consecutiveHaltLimit (${cfg.consecutiveHaltLimit}) must be >= 1`);

  return cfg;
}
