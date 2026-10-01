import { describe, it, expect } from "vitest";
import { tradesToOrders, clientOrderId } from "./orders";
import { DEFAULT_TRADE_CONFIG as cfg } from "./config";
import type { TradePlan, Trade } from "./rebalance";
import type { Mkt } from "./limit";

const NOW = 1_700_000_000_000;
const freshMkt = (price: number, close = price): Mkt => ({ lastTrade: { price, tsMs: NOW }, quote: null, close });

const trade = (o: Partial<Trade>): Trade => ({ ticker: "A", sector: "35", side: "buy", reason: "ENTER", currentWeight: 0, targetWeight: 0.1, deltaWeight: 0.1, ...o });
const plan = (trades: Trade[]): TradePlan => ({ today: "2026-09-25", trades, skipped: [], classifications: [], frozenWeight: 0, sizingTarget: 0.99, plannedInvested: 0.99, plannedCash: 0.01, buyScale: 1 });
const base = {
  nav: 100_000, marks: { A: 50, B: 200 }, positions: {},
  marketCapUsd: { A: 50e9, B: 1e9 }, // A: large bucket, B: small bucket
  mkts: { A: freshMkt(50), B: freshMkt(200) },
  nowMs: NOW, runId: "run1", cfg,
};

describe("clientOrderId", () => {
  it("is a deterministic 32-hex id that changes with side", () => {
    const a = clientOrderId("r", "A", "buy", "2026-09-25");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(clientOrderId("r", "A", "buy", "2026-09-25")).toBe(a);
    expect(clientOrderId("r", "A", "sell", "2026-09-25")).not.toBe(a);
  });
});

describe("tradesToOrders", () => {
  it("buys whole shares (floor) at the slippage-capped limit price, tier 1 (fresh last trade)", () => {
    // pRef=50, tau=limitTol.large=0.0015 -> target 50.075 -> tick-up 50.08; capPx 50*1.004 tick-down 50.20 -> L=50.08 (not cap-bound)
    const { orders } = tradesToOrders({ ...base, plan: plan([trade({ deltaWeight: 0.1 })]) }); // deltaUsd = $10,000
    expect(orders).toEqual([expect.objectContaining({
      ticker: "A", sector: "35", side: "buy", kind: "qty", qty: 199, // floor(10_000 / 50.08)
      limitPrice: 50.08, timeInForce: "ioc", tier: 1, capBound: false, anchorReason: "ok",
      bucket: "large", estCostUsd: 8, reason: "ENTER",
    })]);
    // spec #9: every order carries the anchor, the τ used, and the market diagnostics behind it.
    expect(orders[0]).toMatchObject({ pRef: 50, tau: 0.0015, diag: expect.objectContaining({ tauWanted: 0.0015 }) });
  });
  it("applies sizeMult to a tier-3 (close-anchored) BUY, halving the qty", () => {
    const closeOnly: Mkt = { lastTrade: null, quote: null, close: 200 };
    // pRef=200 (close), tau=limitTol.small=0.008 -> target/L 201.6; sizeMult=closeAnchorSizeMult=0.5
    const { orders } = tradesToOrders({ ...base, mkts: { ...base.mkts, B: closeOnly },
      plan: plan([trade({ ticker: "B", deltaWeight: 0.0125 })]) }); // deltaUsd = $1,250
    expect(orders[0]).toEqual(expect.objectContaining({
      ticker: "B", kind: "qty", qty: 3, // floor(1_250 * 0.5 / 201.6)
      limitPrice: 201.6, tier: 3, anchorReason: "close_anchored", bucket: "small",
    }));
  });
  it("a tier-3 (close-anchored) SELL keeps full size — sizeMult is a BUY-only multiplier", () => {
    const closeOnly: Mkt = { lastTrade: null, quote: null, close: 50 };
    const { orders } = tradesToOrders({ ...base, mkts: { ...base.mkts, A: closeOnly },
      positions: { A: { qty: 100, marketValue: 5000 } },
      plan: plan([trade({ side: "sell", reason: "TRIM", currentWeight: 0.05, targetWeight: 0.03, deltaWeight: -0.02 })]) }); // $2,000 / $50 = 40
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 40, tier: 3, anchorReason: "close_anchored" }));
  });
  it("whole-share mode: an EXIT sells the broker's exact (possibly fractional) position qty, at the sell limit price", () => {
    const { orders } = tradesToOrders({ ...base, cfg: { ...cfg, fractionalShares: false }, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    // sell tau = exitTolMult(1.5) * limitTol.large(0.0015) = 0.00225 -> target 49.8875 tick-down 49.88; capPx 49.8 tick-up 49.80 -> L=max=49.88
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 33.4, type: "limit", reason: "EXIT", limitPrice: 49.88, tier: 1, capBound: false }));
  });
  it("a TRIM sells whole shares, never more than the position", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 100, marketValue: 5000 } },
      plan: plan([trade({ side: "sell", reason: "TRIM", currentWeight: 0.05, targetWeight: 0.03, deltaWeight: -0.02 })]) }); // $2,000 / $50 = 40
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 40, reason: "TRIM" }));
  });
  it("whole-share mode: skips dust below minOrderUsd, but never an EXIT", () => {
    const { orders, skippedDust } = tradesToOrders({ ...base, cfg: { ...cfg, fractionalShares: false }, positions: { A: { qty: 0.2, marketValue: 10 } }, plan: plan([
      trade({ ticker: "A", deltaWeight: 0.0001 }),                                                         // $10 buy -> dust
      trade({ ticker: "A", side: "sell", reason: "EXIT", currentWeight: 0.0001, targetWeight: 0, deltaWeight: -0.0001 }), // $10 exit -> kept
    ]) });
    expect(skippedDust).toEqual([{ ticker: "A", deltaUsd: 10 }]);
    expect(orders).toEqual([expect.objectContaining({ side: "sell", reason: "EXIT", qty: 0.2 })]);
  });
  it("skips (does not submit) a ticker with no mkts entry, recording skippedHalt", () => {
    const { orders, skippedHalt } = tradesToOrders({ ...base, plan: plan([trade({ ticker: "C", deltaWeight: 0.05 })]),
      marks: { ...base.marks, C: 10 }, marketCapUsd: { ...base.marketCapUsd, C: 5e9 } });
    expect(orders).toEqual([]);
    expect(skippedHalt).toEqual([{ ticker: "C", reason: "no_market_data" }]);
  });
  it("skips (does not throw) a computeLimit gap-halt", () => {
    const gappy: Mkt = { lastTrade: { price: 80, tsMs: NOW }, quote: null, close: 50 }; // 60% gap vs large's 10% gapHalt
    const { orders, skippedHalt } = tradesToOrders({ ...base, mkts: { ...base.mkts, A: gappy },
      plan: plan([trade({ ticker: "A", deltaWeight: 0.1 })]) });
    expect(orders).toEqual([]);
    expect(skippedHalt).toEqual([{ ticker: "A", reason: "gap" }]);
  });
  it("refuses a sell with no position or a trade with no mark", () => {
    expect(() => tradesToOrders({ ...base, plan: plan([trade({ side: "sell", reason: "EXIT", deltaWeight: -0.1 })]) })).toThrow(/no position/);
    expect(() => tradesToOrders({ ...base, marks: {}, plan: plan([trade({})]) })).toThrow(/no mark/);
  });
});

describe("tradesToOrders — hybrid (whole-share limit + fractional market remainder)", () => {
  // A fresh, tight quote: the market leg is allowed. relSpread = 0.02 / 50 = 4 bps.
  const quoted = (price: number, spread = 0.02): Mkt => ({ lastTrade: { price, tsMs: NOW }, quote: { bid: price - spread / 2, ask: price + spread / 2, tsMs: NOW }, close: price });
  const hb = { ...base, mkts: { A: quoted(50), B: quoted(200) } };

  it("splits a large order: whole shares as an IOC limit, the remainder as a MARKET leg with its own clientOrderId", () => {
    const { orders } = tradesToOrders({ ...hb, plan: plan([trade({ deltaWeight: 0.1 })]) }); // $10,000 / 50.08 = 199.6805
    expect(orders).toEqual([
      expect.objectContaining({ type: "limit", timeInForce: "ioc", qty: 199, leg: "whole", limitPrice: 50.08 }),
      expect.objectContaining({ type: "market", timeInForce: "day", qty: 0.6805, leg: "frac" }),
    ]);
    expect(orders[1].clientOrderId).not.toBe(orders[0].clientOrderId);
    expect(orders[1].clientOrderId).toBe(clientOrderId("run1", "A", "buy", "2026-09-25", "frac"));
  });
  it("sends a small order entirely at market (no split below marketOnlyBelowUsd)", () => {
    const { orders } = tradesToOrders({ ...hb, nav: 1_000, plan: plan([trade({ deltaWeight: 0.1 })]) }); // $100
    expect(orders).toEqual([expect.objectContaining({ type: "market", qty: 1.9968, clientOrderId: clientOrderId("run1", "A", "buy", "2026-09-25") })]);
    expect(orders[0].leg).toBeUndefined();
  });
  it("an EXIT sells the exact fractional position: whole-share limit + market remainder", () => {
    const { orders } = tradesToOrders({ ...hb, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    expect(orders).toEqual([
      expect.objectContaining({ side: "sell", type: "limit", qty: 33, leg: "whole" }),
      expect.objectContaining({ side: "sell", type: "market", qty: 0.4, leg: "frac" }),
    ]);
  });
  it("a sub-share EXIT (the old crash) is one market sell of the exact qty — sells have no $1 minimum", () => {
    const { orders } = tradesToOrders({ ...hb, nav: 100, positions: { A: { qty: 0.0896, marketValue: 4.48 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0448, targetWeight: 0, deltaWeight: -0.0448 })]) });
    expect(orders).toEqual([expect.objectContaining({ side: "sell", type: "market", qty: 0.0896 })]);
  });
  it("no market leg without a fresh, tight quote: a wide spread keeps only the limit leg, and a held sell remainder is reported", () => {
    const wide = { ...hb, mkts: { A: quoted(50, 1) } }; // 2% spread > large's 1%
    const buy = tradesToOrders({ ...wide, plan: plan([trade({ deltaWeight: 0.1 })]) });
    expect(buy.orders).toEqual([expect.objectContaining({ type: "limit", qty: 199 })]);
    expect(buy.orders[0].leg).toBeUndefined(); // no remainder follows it
    const exit = tradesToOrders({ ...wide, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    expect(exit.orders).toEqual([expect.objectContaining({ type: "limit", qty: 33 })]);
    expect(exit.skippedHalt).toEqual([{ ticker: "A", reason: "remainder 0.4 sh held: market_wide_spread" }]);
    const small = tradesToOrders({ ...wide, nav: 1_000, plan: plan([trade({ deltaWeight: 0.01 })]) }); // $10 < 1 share, market blocked
    expect(small.orders).toEqual([]);
    expect(small.skippedHalt).toEqual([{ ticker: "A", reason: "market_wide_spread" }]);
    const noQuote = tradesToOrders({ ...base, nav: 1_000, plan: plan([trade({ deltaWeight: 0.01 })]) });
    expect(noQuote.skippedHalt).toEqual([{ ticker: "A", reason: "market_no_quote" }]);
  });
  it("a stale quote blocks the market leg", () => {
    const stale: Mkt = { ...quoted(50), quote: { bid: 49.99, ask: 50.01, tsMs: NOW - 6 * 60_000 } }; // large: 5-min window
    const { orders, skippedHalt } = tradesToOrders({ ...hb, nav: 1_000, mkts: { A: stale }, plan: plan([trade({ deltaWeight: 0.01 })]) });
    expect(orders).toEqual([]);
    expect(skippedHalt).toEqual([{ ticker: "A", reason: "market_stale_quote" }]);
  });
  it("minimums: ENTER ≥ $1; ADD/TRIM ≥ max($1, 0.5% NAV) by default (each fill starts a lock); EXIT none", () => {
    const at = (nav: number, t: Partial<Trade>, positions = {}) => tradesToOrders({ ...hb, nav, positions, plan: plan([trade(t)]) });
    expect(at(100, { reason: "ENTER", deltaWeight: 0.02 }).orders).toHaveLength(1);                         // $2 entry
    expect(at(100, { reason: "ENTER", deltaWeight: 0.005 }).skippedDust).toHaveLength(1);                  // $0.50 < $1
    expect(at(100, { reason: "ADD", currentWeight: 0.05, deltaWeight: 0.005 }).skippedDust).toHaveLength(1);    // $0.50 < $1
    expect(at(100, { reason: "ADD", currentWeight: 0.05, deltaWeight: 0.02 }).orders).toHaveLength(1);          // $2 ≥ $1
    expect(at(10_000, { reason: "ADD", currentWeight: 0.05, deltaWeight: 0.004 }).skippedDust).toHaveLength(1); // $40 < 0.5% of $10k
    expect(at(10_000, { reason: "ADD", currentWeight: 0.05, deltaWeight: 0.006 }).orders.length).toBeGreaterThan(0); // $60 ≥ $50
    expect(at(10_000, { reason: "TRIM", side: "sell", currentWeight: 0.05, deltaWeight: -0.004 }, { A: { qty: 10, marketValue: 500 } }).skippedDust).toHaveLength(1);
    expect(at(10_000, { reason: "EXIT", side: "sell", currentWeight: 0.0001, targetWeight: 0, deltaWeight: -0.0001 }, { A: { qty: 0.02, marketValue: 1 } }).orders).toHaveLength(1);
    // the owner's env knobs (TRADE_MIN_USD / TRADE_MIN_NAV_PCT) flow through cfg
    expect(tradesToOrders({ ...hb, nav: 100, cfg: { ...cfg, minTradeUsd: 5 }, plan: plan([trade({ reason: "ADD", currentWeight: 0.05, deltaWeight: 0.02 })]) }).skippedDust).toHaveLength(1);
  });
  it("a market BUY remainder under the $1 fractional minimum is dropped (the limit leg goes alone)", () => {
    // B: small bucket, τ = 0.8% → L = 201.60. $1,008.50 / 201.60 = 5.0024 sh → remainder 0.0024 × 201.60 ≈ $0.48 < $1.
    const { orders } = tradesToOrders({ ...hb, plan: plan([trade({ ticker: "B", deltaWeight: 0.010085 })]) });
    expect(orders).toEqual([expect.objectContaining({ ticker: "B", type: "limit", qty: 5, limitPrice: 201.6 })]);
    expect(orders[0].leg).toBeUndefined();
  });
});
