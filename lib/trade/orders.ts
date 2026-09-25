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
import { computeLimit, type Mkt } from "./limit";

export interface OrderRequest {
  ticker: string; side: "buy" | "sell"; kind: "qty"; qty: number;
  limitPrice: number; timeInForce: "ioc"; tier: 1 | 2 | 3; capBound: boolean; anchorReason: string;
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
}): SizedOrders {
  const { plan, nav, marks, positions, marketCapUsd, mkts, nowMs, runId, cfg } = input;
  const orders: OrderRequest[] = [];
  const skippedDust: { ticker: string; deltaUsd: number }[] = [];
  const skippedHalt: { ticker: string; reason: string }[] = [];
  for (const t of plan.trades) {
    const mark = marks[t.ticker];
    if (!(mark > 0)) throw new Error(`tradesToOrders: no mark for ${t.ticker}`);
    const mkt = mkts[t.ticker];
    if (!mkt) { skippedHalt.push({ ticker: t.ticker, reason: "no_market_data" }); continue; }
    const r = computeLimit({ side: t.side, marketCapUsd: marketCapUsd[t.ticker] ?? null, nowMs, mkt, cfg });
    if (r.action === "halt") { skippedHalt.push({ ticker: t.ticker, reason: r.reason }); continue; }
    const deltaUsd = round2(t.deltaWeight * nav);
    const bucket = bucketFor(marketCapUsd[t.ticker] ?? null);
    const common = { ticker: t.ticker, clientOrderId: clientOrderId(runId, t.ticker, t.side, plan.today), reason: t.reason, deltaUsd, estCostUsd: estimateCostUsd(deltaUsd, bucket), bucket };
    const limitFields = { limitPrice: r.L!, timeInForce: "ioc" as const, tier: r.tier!, capBound: r.capBound!, anchorReason: r.reason };
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
