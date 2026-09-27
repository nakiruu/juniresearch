/**
 * orders.ts — weights to slippage-capped IOC limit broker orders (spec §9, Phase 2 §7). Pure.
 * Every order is a whole-share limit order priced by computeLimit (Task 2); a computeLimit halt
 * (no price / gap) skips the trade into skippedHalt rather than emitting an order. An EXIT sells the
 * exact broker qty so no dust is left; a TRIM sells whole shares. clientOrderId is deterministic per
 * (run, ticker, side, day) so a re-run cannot double-submit.
 */
import { createHash } from "node:crypto";
import type { TradePlan, TradeReason } from "./rebalance";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { bucketFor, estimateCostUsd, type LiquidityBucket } from "./costs";
import { computeLimit, type LimitDiagnostics, type Mkt } from "./limit";

export interface OrderRequest {
  ticker: string; sector: string; side: "buy" | "sell"; kind: "qty"; qty: number;
  limitPrice: number; timeInForce: "ioc"; tier: 1 | 2 | 3; capBound: boolean; anchorReason: string;
  /** Market snapshot + the τ the spread wanted vs what the cap allowed (spec #9 — the data a τ_max decision needs). */
  pRef?: number; tau?: number; diag?: LimitDiagnostics;
  /** When this ticker's market data was captured (epoch ms) — the freshness reference and the start of decision→submit latency. */
  anchorAtMs?: number;
  clientOrderId: string; reason: TradeReason; deltaUsd: number; estCostUsd: number; bucket: LiquidityBucket;
}
export interface SizedOrders {
  orders: OrderRequest[];
  skippedDust: { ticker: string; deltaUsd: number }[];
  skippedHalt: { ticker: string; reason: string }[];
}

export function clientOrderId(runId: string, ticker: string, side: "buy" | "sell", today: TradingDay): string {
  return createHash("sha256").update(`${runId}|${ticker}|${side}|${today}`).digest("hex").slice(0, 32);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function tradesToOrders(input: {
  plan: TradePlan; nav: number; marks: Record<string, number>;
  positions: Record<string, { qty: number; marketValue: number }>;
  marketCapUsd: Record<string, number | null>; mkts: Record<string, Mkt>; nowMs: number;
  runId: string; cfg: TradeConfig;
  /** Per-ticker capture time of `mkts`; freshness is judged at that instant (falls back to nowMs). */
  anchorAtMs?: Record<string, number>;
}): SizedOrders {
  const { plan, nav, marks, positions, marketCapUsd, mkts, nowMs, runId, cfg, anchorAtMs = {} } = input;
  const orders: OrderRequest[] = [];
  const skippedDust: { ticker: string; deltaUsd: number }[] = [];
  const skippedHalt: { ticker: string; reason: string }[] = [];
  for (const t of plan.trades) {
    const mark = marks[t.ticker];
    if (!(mark > 0)) throw new Error(`tradesToOrders: no mark for ${t.ticker}`);
    const mkt = mkts[t.ticker];
    if (!mkt) { skippedHalt.push({ ticker: t.ticker, reason: "no_market_data" }); continue; }
    const at = anchorAtMs[t.ticker] ?? nowMs;
    const r = computeLimit({ side: t.side, marketCapUsd: marketCapUsd[t.ticker] ?? null, nowMs: at, mkt, cfg });
    if (r.action === "halt") { skippedHalt.push({ ticker: t.ticker, reason: r.reason }); continue; }
    const deltaUsd = round2(t.deltaWeight * nav);
    const bucket = bucketFor(marketCapUsd[t.ticker] ?? null);
    const common = { ticker: t.ticker, sector: t.sector, clientOrderId: clientOrderId(runId, t.ticker, t.side, plan.today), reason: t.reason, deltaUsd, estCostUsd: estimateCostUsd(deltaUsd, bucket), bucket };
    const limitFields = { limitPrice: r.L!, timeInForce: "ioc" as const, tier: r.tier!, capBound: r.capBound!, anchorReason: r.reason, pRef: r.pRef, tau: r.tau, diag: r.diag, anchorAtMs: at };
    if (t.side === "sell") {
      const pos = positions[t.ticker];
      if (!pos || pos.qty <= 0) throw new Error(`tradesToOrders: sell of ${t.ticker} with no position`);
      // sizeMult is a BUY-only multiplier (computeLimit sets it to 1 for every sell, tier 3 included) —
      // a sell's qty is never scaled by it. Key off r.sizeMult (not r.reason) if that ever changes.
      if (t.reason === "EXIT") { orders.push({ ...common, side: "sell", kind: "qty", qty: pos.qty, ...limitFields }); continue; }
      const qty = Math.min(pos.qty, Math.round(-deltaUsd / mark));
      if (qty <= 0 || Math.abs(deltaUsd) < cfg.minOrderUsd) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
      orders.push({ ...common, side: "sell", kind: "qty", qty, ...limitFields });
      continue;
    }
    // Buys always carry deltaUsd >= 0 (emitTrades' ENTER/ADD deltas are positive and buyScale keeps
    // them non-negative), so this bare `<` is exactly the |deltaUsd| the TRIM branch above spells out.
    // Do NOT "symmetrize" this to Math.abs: that would let a malformed negative-delta buy PASS the dust
    // gate and emit a negative-notional order — dropping it here is the safe behavior.
    const qty = Math.floor((deltaUsd * (r.sizeMult ?? 1)) / r.L!);
    if (deltaUsd < cfg.minOrderUsd || qty <= 0) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
    orders.push({ ...common, side: "buy", kind: "qty", qty, ...limitFields });
  }
  return { orders, skippedDust, skippedHalt };
}
