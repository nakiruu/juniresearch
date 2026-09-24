/**
 * orders.ts — weights to broker orders (spec §9). Pure. Buys are notional (fractional-eligible) or
 * floor-shares; an EXIT sells the exact broker qty so no dust is left; a TRIM sells whole shares.
 * clientOrderId is deterministic per (run, ticker, side, day) so a re-run cannot double-submit.
 */
import { createHash } from "node:crypto";
import type { TradePlan, TradeReason } from "./rebalance";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { bucketFor, estimateCostUsd, type LiquidityBucket } from "./costs";

export interface OrderRequest {
  ticker: string; side: "buy" | "sell"; kind: "notional" | "qty"; notional?: number; qty?: number;
  clientOrderId: string; reason: TradeReason; deltaUsd: number; estCostUsd: number; bucket: LiquidityBucket;
}
export interface SizedOrders { orders: OrderRequest[]; skippedDust: { ticker: string; deltaUsd: number }[] }

export function clientOrderId(runId: string, ticker: string, side: "buy" | "sell", today: TradingDay): string {
  return createHash("sha256").update(`${runId}|${ticker}|${side}|${today}`).digest("hex").slice(0, 32);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function tradesToOrders(input: {
  plan: TradePlan; nav: number; marks: Record<string, number>;
  positions: Record<string, { qty: number; marketValue: number }>; fractionalOk: (ticker: string) => boolean;
  marketCapUsd: Record<string, number | null>; runId: string; cfg: TradeConfig;
}): SizedOrders {
  const { plan, nav, marks, positions, fractionalOk, marketCapUsd, runId, cfg } = input;
  const orders: OrderRequest[] = [];
  const skippedDust: { ticker: string; deltaUsd: number }[] = [];
  for (const t of plan.trades) {
    const mark = marks[t.ticker];
    if (!(mark > 0)) throw new Error(`tradesToOrders: no mark for ${t.ticker}`);
    const deltaUsd = round2(t.deltaWeight * nav);
    const bucket = bucketFor(marketCapUsd[t.ticker] ?? null);
    const common = { ticker: t.ticker, clientOrderId: clientOrderId(runId, t.ticker, t.side, plan.today), reason: t.reason, deltaUsd, estCostUsd: estimateCostUsd(deltaUsd, bucket), bucket };
    if (t.side === "sell") {
      const pos = positions[t.ticker];
      if (!pos || pos.qty <= 0) throw new Error(`tradesToOrders: sell of ${t.ticker} with no position`);
      if (t.reason === "EXIT") { orders.push({ ...common, side: "sell", kind: "qty", qty: pos.qty }); continue; }
      const qty = Math.min(pos.qty, Math.round(-deltaUsd / mark));
      if (qty <= 0 || Math.abs(deltaUsd) < cfg.minOrderUsd) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
      orders.push({ ...common, side: "sell", kind: "qty", qty });
      continue;
    }
    // Buys always carry deltaUsd >= 0 (emitTrades' ENTER/ADD deltas are positive and buyScale keeps
    // them non-negative), so this bare `<` is exactly the |deltaUsd| the TRIM branch above spells out.
    // Do NOT "symmetrize" this to Math.abs: that would let a malformed negative-delta buy PASS the dust
    // gate and emit a negative-notional order — dropping it here is the safe behavior.
    if (deltaUsd < cfg.minOrderUsd) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
    if (fractionalOk(t.ticker)) { orders.push({ ...common, side: "buy", kind: "notional", notional: deltaUsd }); continue; }
    const qty = Math.floor(deltaUsd / mark);
    if (qty <= 0) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
    orders.push({ ...common, side: "buy", kind: "qty", qty });
  }
  return { orders, skippedDust };
}
