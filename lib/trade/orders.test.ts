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
      ticker: "A", side: "buy", kind: "qty", qty: 199, // floor(10_000 / 50.08)
      limitPrice: 50.08, timeInForce: "ioc", tier: 1, capBound: false, anchorReason: "ok",
      bucket: "large", estCostUsd: 8, reason: "ENTER",
    })]);
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
  it("an EXIT sells the broker's exact (possibly fractional) position qty, at the sell limit price", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    // sell tau = exitTolMult(1.5) * limitTol.large(0.0015) = 0.00225 -> target 49.8875 tick-down 49.88; capPx 49.8 tick-up 49.80 -> L=max=49.88
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 33.4, reason: "EXIT", limitPrice: 49.88, tier: 1, capBound: false }));
  });
  it("a TRIM sells whole shares, never more than the position", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 100, marketValue: 5000 } },
      plan: plan([trade({ side: "sell", reason: "TRIM", currentWeight: 0.05, targetWeight: 0.03, deltaWeight: -0.02 })]) }); // $2,000 / $50 = 40
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 40, reason: "TRIM" }));
  });
  it("skips dust below minOrderUsd, but never an EXIT", () => {
    const { orders, skippedDust } = tradesToOrders({ ...base, positions: { A: { qty: 0.2, marketValue: 10 } }, plan: plan([
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
