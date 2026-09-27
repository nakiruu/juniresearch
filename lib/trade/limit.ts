/**
 * limit.ts — slippage-capped limit pricing. Spec §4/§7. Pure, no I/O.
 *
 * Freshness gate: last trade (tier 1) → quote mid/touch (tier 2) → prior close (tier 3, sized down).
 * Hard cap: the limit price never crosses a per-bucket τ_max, tick-inclusive (floored/ceiled to a
 * legal tick before comparing), so the cap itself is always a submittable price.
 * Gap-halt: compares the clean reference (last trade if fresh, else quote mid, else close) against
 * the prior close — a wide-but-clean quote never halts on its own; only the reference itself gapping
 * does.
 */
import { bucketFor, type LiquidityBucket, type TradeConfig } from "./config";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export const tickFor = (px: number) => (px >= 1 ? 0.01 : 0.0001);

export function roundTick(px: number, dir: "up" | "down"): number {
  const t = tickFor(px);
  const n = px / t;
  const r = dir === "up" ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9); // eps: on-tick is a no-op
  return Math.round(r * t * 1e6) / 1e6;
}

export function quoteMetrics(q: { bid: number; ask: number } | null): { valid: boolean; mid: number; relSpread: number } {
  if (!q || q.bid <= 0 || q.ask <= 0 || q.ask < q.bid) return { valid: false, mid: NaN, relSpread: 0 };
  const mid = (q.ask + q.bid) / 2;
  return { valid: true, mid, relSpread: Math.min((q.ask - q.bid) / mid, 0.10) };
}

/** The τ the spread asks for, before the per-bucket clamp — recorded so τ_max can be judged from data. */
export function toleranceWanted(bucket: LiquidityBucket, relSpread: number, side: "buy" | "sell", cfg: TradeConfig): number {
  const base = side === "buy" ? cfg.limitTol[bucket] : cfg.exitTolMult * cfg.limitTol[bucket];
  return Math.max(base, cfg.limitTolBeta * relSpread);
}

export function tolerance(bucket: LiquidityBucket, relSpread: number, side: "buy" | "sell", cfg: TradeConfig): number {
  return clamp(toleranceWanted(bucket, relSpread, side, cfg), cfg.limitTolMin, cfg.limitTolMax[bucket]);
}

export function limitPrice(pRef: number, tau: number, tauMax: number, side: "buy" | "sell"): { L: number; capPx: number; capBound: boolean } {
  if (side === "buy") {
    const target = roundTick(pRef * (1 + tau), "up");
    const capPx = roundTick(pRef * (1 + tauMax), "down");
    const L = Math.min(target, capPx);
    return { L, capPx, capBound: L < target };
  }
  const target = roundTick(pRef * (1 - tau), "down");
  const capPx = roundTick(pRef * (1 - tauMax), "up");
  const L = Math.max(target, capPx);
  return { L, capPx, capBound: L > target };
}

export interface Mkt {
  lastTrade: { price: number; tsMs: number } | null;
  quote: { bid: number; ask: number; tsMs: number } | null;
  close: number;
}
export interface LimitInput { side: "buy" | "sell"; marketCapUsd: number | null; nowMs: number; mkt: Mkt; cfg: TradeConfig }
export interface LimitResult {
  action: "submit" | "halt"; reason: string; side: "buy" | "sell"; bucket: LiquidityBucket;
  pRef?: number; tier?: 1 | 2 | 3; tau?: number; L?: number; capPx?: number; capBound?: boolean; sizeMult?: number;
  /** Diagnostics (spec #9) — what the market looked like when the limit was set. */
  diag?: LimitDiagnostics;
}
export interface LimitDiagnostics {
  relSpread: number | null;   // (ask − bid) / mid, clamped ≤ 10%; null without a valid quote
  tauWanted: number;          // the τ the spread asked for, before the τ_max clamp
  bid: number | null; ask: number | null;
  quoteAgeMs: number | null; tradeAgeMs: number | null;
}

const lastFresh = (m: Mkt, nowMs: number, staleMs: number) =>
  !!m.lastTrade && m.lastTrade.price > 0 && nowMs - m.lastTrade.tsMs <= staleMs;

function anchor(m: Mkt, nowMs: number, staleMs: number, side: "buy" | "sell"): { pRef: number; tier: 1 | 2 | 3 } | null {
  if (lastFresh(m, nowMs, staleMs)) return { pRef: m.lastTrade!.price, tier: 1 };
  const q = quoteMetrics(m.quote);
  if (m.quote && q.valid && nowMs - m.quote.tsMs <= staleMs) return { pRef: side === "buy" ? m.quote.ask : m.quote.bid, tier: 2 };
  if (m.close > 0) return { pRef: m.close, tier: 3 };
  return null;
}

function gapReference(m: Mkt, nowMs: number, staleMs: number): number {
  if (lastFresh(m, nowMs, staleMs)) return m.lastTrade!.price;
  const q = quoteMetrics(m.quote);
  return q.valid ? q.mid : m.close;
}

export function computeLimit(inp: LimitInput): LimitResult {
  const { mkt: m, cfg, side, nowMs } = inp;
  const bucket = bucketFor(inp.marketCapUsd);
  const staleMs = cfg.maxStaleMin[bucket] * 60_000;
  const a = anchor(m, nowMs, staleMs, side);
  if (!a) return { action: "halt", reason: "no_price", side, bucket };
  const gref = gapReference(m, nowMs, staleMs);
  if (m.close > 0 && Math.abs(gref - m.close) / m.close > cfg.gapHalt[bucket])
    return { action: "halt", reason: "gap", side, bucket, pRef: a.pRef, tier: a.tier };
  const qm = quoteMetrics(m.quote);
  const tau = tolerance(bucket, qm.relSpread, side, cfg);
  const { L, capPx, capBound } = limitPrice(a.pRef, tau, cfg.limitTolMax[bucket], side);
  const sizeMult = a.tier === 3 && side === "buy" ? cfg.closeAnchorSizeMult : 1;
  const diag: LimitDiagnostics = {
    relSpread: qm.valid ? qm.relSpread : null, tauWanted: toleranceWanted(bucket, qm.relSpread, side, cfg),
    bid: m.quote?.bid ?? null, ask: m.quote?.ask ?? null,
    quoteAgeMs: m.quote ? nowMs - m.quote.tsMs : null, tradeAgeMs: m.lastTrade ? nowMs - m.lastTrade.tsMs : null,
  };
  return { action: "submit", reason: a.tier === 3 ? "close_anchored" : "ok", side, bucket, pRef: a.pRef, tier: a.tier, tau, L, capPx, capBound, sizeMult, diag };
}
