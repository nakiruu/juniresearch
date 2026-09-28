/**
 * orders.ts — weights to broker orders (spec §9, Phase 2 §7, audit 2026-09-28 hybrid). Pure.
 *
 * Whole-share mode (fractionalShares off): every order is a whole-share, τ-capped IOC limit.
 * Hybrid mode (default): the whole-share part is a τ-capped IOC limit; the fractional remainder is a
 * MARKET order (the only way Schwab takes a sub-share quantity: ≥ $1, ≤ 4 dp). An order smaller than
 * marketOnlyBelowUsd goes entirely at market. A market leg needs a fresh, valid quote no wider than
 * marketMaxSpread (the tail guard that τ_max is for the limit leg); without one only the whole-share
 * limit is sent. A computeLimit halt (no price / gap) still skips the whole trade.
 *
 * Minimums: ENTER ≥ minEnterUsd; ADD/TRIM ≥ max(minTradeUsd, minTradeNavFrac × NAV), because every
 * fill starts a 5-business-day both-sides lock on the ticker; EXIT has no floor. An EXIT sells the
 * exact broker qty. clientOrderId is deterministic per (run, ticker, side, day, leg).
 */
import { createHash } from "node:crypto";
import type { TradePlan, TradeReason } from "./rebalance";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { bucketFor, estimateCostUsd, type LiquidityBucket } from "./costs";
import { computeLimit, type LimitDiagnostics, type Mkt } from "./limit";

export interface OrderRequest {
  ticker: string; sector: string; side: "buy" | "sell"; kind: "qty"; qty: number;
  /** "limit": sent with limitPrice as an (emulated) IOC. "market": sent without a price, DAY. */
  type: "limit" | "market";
  /**
   * The τ-capped limit price. On a market leg it is NOT sent — it stays the conservative price estimate
   * behind every notional measure (cash backstop reservation, turnover breaker, run caps).
   */
  limitPrice: number; timeInForce: "ioc" | "day"; tier: 1 | 2 | 3; capBound: boolean; anchorReason: string;
  /** Hybrid split: "whole" = the limit leg, "frac" = its market remainder (sent only if the limit leg filled). Unset = the only order for this trade. */
  leg?: "whole" | "frac";
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

export function clientOrderId(runId: string, ticker: string, side: "buy" | "sell", today: TradingDay, leg?: "frac"): string {
  return createHash("sha256").update(`${runId}|${ticker}|${side}|${today}${leg ? `|${leg}` : ""}`).digest("hex").slice(0, 32);
}

/** Schwab takes at most 4 decimal places; round DOWN so we never ask for more than we hold or can pay for. */
const floor4 = (x: number) => Math.floor(x * 1e4 + 1e-6) / 1e4;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Why a market leg may not be sent: it needs a valid quote, captured within the bucket's freshness window, no wider than marketMaxSpread. */
export function marketLegBlock(diag: LimitDiagnostics | undefined, bucket: LiquidityBucket, cfg: TradeConfig): string | null {
  if (!diag || diag.relSpread == null || diag.quoteAgeMs == null) return "no_quote";
  if (diag.quoteAgeMs > cfg.maxStaleMin[bucket] * 60_000) return "stale_quote";
  if (diag.relSpread > cfg.marketMaxSpread[bucket]) return "wide_spread";
  return null;
}

/** The dust floor for a trade, in $ (EXIT: none). */
export function minTradeUsdFor(reason: TradeReason, nav: number, cfg: TradeConfig): number {
  if (!cfg.fractionalShares) return reason === "EXIT" ? 0 : cfg.minOrderUsd;
  if (reason === "EXIT") return 0;
  if (reason === "ENTER") return cfg.minEnterUsd;
  return Math.max(cfg.minTradeUsd, cfg.minTradeNavFrac * nav);
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
    const limitFields = { limitPrice: r.L!, tier: r.tier!, capBound: r.capBound!, anchorReason: r.reason, pRef: r.pRef, tau: r.tau, diag: r.diag, anchorAtMs: at };
    const floorUsd = minTradeUsdFor(t.reason, nav, cfg);
    if (t.reason !== "EXIT" && Math.abs(deltaUsd) < floorUsd) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }

    // Total quantity for the trade.
    let qty: number;
    if (t.side === "sell") {
      const pos = positions[t.ticker];
      if (!pos || pos.qty <= 0) throw new Error(`tradesToOrders: sell of ${t.ticker} with no position`);
      // sizeMult is a BUY-only multiplier (computeLimit sets it to 1 for every sell, tier 3 included) —
      // a sell's qty is never scaled by it. Key off r.sizeMult (not r.reason) if that ever changes.
      qty = t.reason === "EXIT" ? pos.qty
        : Math.min(pos.qty, cfg.fractionalShares ? floor4(-deltaUsd / mark) : Math.round(-deltaUsd / mark));
    } else {
      // Buys always carry deltaUsd >= 0 (emitTrades' ENTER/ADD deltas are positive and buyScale keeps
      // them non-negative), and the floor above already dropped a malformed negative one. Sized at the
      // limit price, so the whole order fits the cash reserved for it even at the cap.
      const raw = (deltaUsd * (r.sizeMult ?? 1)) / r.L!;
      qty = cfg.fractionalShares ? floor4(raw) : Math.floor(raw);
    }
    if (!(qty > 0)) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }

    if (!cfg.fractionalShares) {
      orders.push({ ...common, side: t.side, kind: "qty", qty, type: "limit", timeInForce: "ioc", ...limitFields });
      continue;
    }

    // Hybrid split.
    const block = marketLegBlock(r.diag, bucket, cfg);
    const whole = Math.floor(qty + 1e-9);
    const frac = round4(qty - whole);
    const market = (q: number, leg?: "frac"): OrderRequest => ({ ...common, ...(leg ? { clientOrderId: clientOrderId(runId, t.ticker, t.side, plan.today, leg), leg } : {}), side: t.side, kind: "qty", qty: q, type: "market", timeInForce: "day", ...limitFields });
    // A market BUY below the broker's $1 fractional minimum is refused; a fractional SELL of any size is accepted.
    const marketable = (q: number) => q > 0 && (t.side === "sell" || q * r.L! >= cfg.minEnterUsd);
    if (!block && qty * r.L! < cfg.marketOnlyBelowUsd && marketable(qty)) {
      orders.push(market(qty));
      continue;
    }
    if (whole >= 1) orders.push({ ...common, side: t.side, kind: "qty", qty: whole, type: "limit", timeInForce: "ioc", ...limitFields, ...(frac > 0 && !block && marketable(frac) ? { leg: "whole" as const } : {}) });
    if (frac > 0 && !block && marketable(frac)) {
      orders.push(whole >= 1 ? market(frac, "frac") : market(frac));
    } else if (whole >= 1) {
      // A sell's unsendable remainder stays held — say so (a buy's dropped fraction is just a smaller buy).
      if (t.side === "sell" && frac > 0 && block) skippedHalt.push({ ticker: t.ticker, reason: `remainder ${frac} sh held: market_${block}` });
    } else {
      // Nothing sendable: under one share and the market leg is blocked (or under the $1 minimum).
      if (block) skippedHalt.push({ ticker: t.ticker, reason: `market_${block}` });
      else skippedDust.push({ ticker: t.ticker, deltaUsd });
    }
  }
  return { orders, skippedDust, skippedHalt };
}
