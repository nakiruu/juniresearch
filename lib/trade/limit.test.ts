import { describe, it, expect } from "vitest";
import { roundTick, quoteMetrics, tolerance, limitPrice, computeLimit, type Mkt } from "./limit";
import { DEFAULT_TRADE_CONFIG as C } from "./config";

const now = 1_000_000_000_000;
const mkt = (o: Partial<Mkt> = {}): Mkt => ({
  lastTrade: { price: 80.14, tsMs: now - 30_000 },
  quote: { bid: 80.13, ask: 80.15, tsMs: now - 30_000 }, close: 79.00, ...o,
});

describe("roundTick", () => {
  it("uses a penny tick ≥ $1 and sub-penny below, and is a no-op on-tick", () => {
    expect(roundTick(80.121, "up")).toBe(80.13);
    expect(roundTick(80.129, "down")).toBe(80.12);
    expect(roundTick(80.15, "up")).toBe(80.15);   // on-tick no-op
    expect(roundTick(0.50011, "up")).toBe(0.5002);
  });
});

describe("quoteMetrics", () => {
  it("invalidates a missing/crossed/zero quote and clamps relSpread at 10%", () => {
    expect(quoteMetrics(null).valid).toBe(false);
    expect(quoteMetrics({ bid: 0, ask: 6.3 }).valid).toBe(false);      // no bid → not 200%
    expect(quoteMetrics({ bid: 6.4, ask: 6.3 }).valid).toBe(false);    // crossed
    expect(quoteMetrics({ bid: 5, ask: 6 }).relSpread).toBeCloseTo(0.10); // (1/5.5)=18% → clamp 10%
  });
});

describe("tolerance", () => {
  it("floors by bucket, widens on spread, caps per bucket, and widens exits", () => {
    expect(tolerance("large", 0, "buy", C)).toBeCloseTo(0.0015);
    // 0.5*0.02=0.01 > floor 0.0015, but clamped to limitTolMax.large = 0.004
    expect(tolerance("large", 0.02, "buy", C)).toBeCloseTo(0.004);
    expect(tolerance("small", 0, "buy", C)).toBeCloseTo(0.0080);
    expect(tolerance("small", 0, "sell", C)).toBeCloseTo(0.012);    // 1.5*0.008, < cap 0.015
  });
});

describe("limitPrice — hard, tick-inclusive cap", () => {
  it("buys ceil to target but never above the floored cap", () => {
    // low-priced name: ceil would overshoot τ_max, so L pins to capPx
    const r = limitPrice(1.00, 0.0015, 0.004, "buy");
    expect(r.capPx).toBe(1.00);               // floor_to_tick(1.004) = 1.00
    expect(r.L).toBe(1.00);                    // min(ceil 1.01, cap 1.00) = 1.00
    expect(r.L).toBeLessThanOrEqual(1.00 * 1.004);
    expect(r.capBound).toBe(true);
  });
  it("normal name fills at target under the cap", () => {
    const r = limitPrice(80.14, 0.0015, 0.004, "buy");
    expect(r.L).toBe(80.27);                   // ceil(80.14*1.0015)=80.27 < cap floor(80.46)
    expect(r.capBound).toBe(false);
  });
});

describe("computeLimit", () => {
  it("tier-1 fresh last trade, submits under cap", () => {
    const r = computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: mkt(), cfg: C });
    expect(r).toMatchObject({ action: "submit", tier: 1, bucket: "large", sizeMult: 1 });
  });
  it("stale last → quote (tier 2); stale both → close (tier 3) with 0.5× size", () => {
    const staleLast = mkt({ lastTrade: { price: 80.14, tsMs: now - 100 * 60_000 } });
    expect(computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: staleLast, cfg: C }).tier).toBe(2);
    const staleBoth = mkt({ lastTrade: { price: 80, tsMs: now - 1e9 }, quote: { bid: 80.1, ask: 80.2, tsMs: now - 1e9 } });
    const r3 = computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: staleBoth, cfg: C });
    expect(r3).toMatchObject({ action: "submit", tier: 3, sizeMult: 0.5, reason: "close_anchored" });
  });
  it("halts on a gap using the clean reference, not the quote touch", () => {
    const gapped = mkt({ lastTrade: { price: 100, tsMs: now - 1000 }, close: 79 }); // +26.6% vs close, large cap 10%
    expect(computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: gapped, cfg: C }).action).toBe("halt");
    // a merely wide quote does NOT halt (last trade is clean)
    const wideQuote = mkt({ quote: { bid: 60, ask: 100, tsMs: now - 1000 } });
    expect(computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: wideQuote, cfg: C }).action).toBe("submit");
  });
  it("halts when no price is available", () => {
    const blind = mkt({ lastTrade: null, quote: null, close: 0 });
    expect(computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: blind, cfg: C }).action).toBe("halt");
  });
});

describe("computeLimit diagnostics (spec #9)", () => {
  it("records spread, quote/trade ages, and the τ the spread wanted before the cap", () => {
    const r = computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: mkt(), cfg: C });
    expect(r.diag).toMatchObject({ bid: 80.13, ask: 80.15, quoteAgeMs: 30_000, tradeAgeMs: 30_000 });
    expect(r.diag!.relSpread).toBeCloseTo(0.02 / 80.14, 9);
    expect(r.diag!.tauWanted).toBe(C.limitTol.large); // a tight spread wants only the bucket floor
  });
  it("a wide early-session spread wants more τ than the cap allows — that is exactly when capBound fires", () => {
    const wide = mkt({ lastTrade: null, quote: { bid: 79.6, ask: 80.4, tsMs: now - 1_000 } }); // 1% spread
    const r = computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: wide, cfg: C });
    expect(r.diag!.tauWanted).toBeCloseTo(C.limitTolBeta * 0.01, 9);
    expect(r.diag!.tauWanted).toBeGreaterThan(C.limitTolMax.large);
    expect(r.tau).toBe(C.limitTolMax.large);
    expect(r.capBound).toBe(true);
  });
  it("has null quote fields without a quote", () => {
    const r = computeLimit({ side: "buy", marketCapUsd: 50e9, nowMs: now, mkt: mkt({ quote: null }), cfg: C });
    expect(r.diag).toMatchObject({ relSpread: null, bid: null, ask: null, quoteAgeMs: null });
  });
});
