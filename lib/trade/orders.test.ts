import { describe, it, expect } from "vitest";
import { tradesToOrders, clientOrderId } from "./orders";
import { DEFAULT_TRADE_CONFIG as cfg } from "./config";
import type { TradePlan, Trade } from "./rebalance";

const trade = (o: Partial<Trade>): Trade => ({ ticker: "A", sector: "35", side: "buy", reason: "ENTER", currentWeight: 0, targetWeight: 0.1, deltaWeight: 0.1, ...o });
const plan = (trades: Trade[]): TradePlan => ({ today: "2026-09-25", trades, skipped: [], classifications: [], frozenWeight: 0, sizingTarget: 0.99, plannedInvested: 0.99, plannedCash: 0.01, buyScale: 1 });
const base = { nav: 100_000, marks: { A: 50, B: 200 }, positions: {}, fractionalOk: () => true, marketCapUsd: { A: 50e9, B: 1e9 }, runId: "run1", cfg };

describe("clientOrderId", () => {
  it("is a deterministic 32-hex id that changes with side", () => {
    const a = clientOrderId("r", "A", "buy", "2026-09-25");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(clientOrderId("r", "A", "buy", "2026-09-25")).toBe(a);
    expect(clientOrderId("r", "A", "sell", "2026-09-25")).not.toBe(a);
  });
});

describe("tradesToOrders", () => {
  it("buys a fractional-eligible name by notional, with cost by bucket", () => {
    const { orders } = tradesToOrders({ ...base, plan: plan([trade({ deltaWeight: 0.1 })]) });
    expect(orders).toEqual([expect.objectContaining({ ticker: "A", side: "buy", kind: "notional", notional: 10_000, bucket: "large", estCostUsd: 8, reason: "ENTER" })]);
  });
  it("buys whole shares (floor) when the name is not fractional-eligible", () => {
    const { orders } = tradesToOrders({ ...base, fractionalOk: () => false, plan: plan([trade({ ticker: "B", deltaWeight: 0.0125 })]) }); // $1,250 / $200 = 6.25
    expect(orders[0]).toEqual(expect.objectContaining({ ticker: "B", kind: "qty", qty: 6, bucket: "small" }));
  });
  it("an EXIT sells the broker's exact (possibly fractional) position qty", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 33.4, reason: "EXIT" }));
  });
  it("a TRIM sells whole shares, never more than the position", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 100, marketValue: 5000 } },
      plan: plan([trade({ side: "sell", reason: "TRIM", currentWeight: 0.05, targetWeight: 0.03, deltaWeight: -0.02 })]) }); // $2,000 / $50 = 40
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 40, reason: "TRIM" }));
  });
  it("skips dust below minOrderUsd, but never an EXIT", () => {
    const { orders, skippedDust } = tradesToOrders({ ...base, positions: { A: { qty: 0.2, marketValue: 10 } }, plan: plan([
      trade({ ticker: "A", deltaWeight: 0.0001 }),                                                         // $10 buy → dust
      trade({ ticker: "A", side: "sell", reason: "EXIT", currentWeight: 0.0001, targetWeight: 0, deltaWeight: -0.0001 }), // $10 exit → kept
    ]) });
    expect(skippedDust).toEqual([{ ticker: "A", deltaUsd: 10 }]);
    expect(orders).toEqual([expect.objectContaining({ side: "sell", reason: "EXIT", qty: 0.2 })]);
  });
  it("refuses a sell with no position or a trade with no mark", () => {
    expect(() => tradesToOrders({ ...base, plan: plan([trade({ side: "sell", reason: "EXIT", deltaWeight: -0.1 })]) })).toThrow(/no position/);
    expect(() => tradesToOrders({ ...base, marks: {}, plan: plan([trade({})]) })).toThrow(/no mark/);
  });
});
