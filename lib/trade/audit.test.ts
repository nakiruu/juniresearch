import { describe, it, expect } from "vitest";
import { crossCheckBroker } from "./audit";
import type { BrokerOrder, BrokerOrderStatus } from "../broker/adapter";
import type { Fill } from "./fills";

const ord = (o: Partial<BrokerOrder> & { clientOrderId: string; symbol: string }): BrokerOrder => ({
  id: `b-${o.clientOrderId}`, side: "buy", status: "filled" as BrokerOrderStatus,
  qty: 10, notional: null, filledQty: 10, filledAvgPrice: 100, filledAt: "2026-09-25T13:36:00Z",
  submittedAt: "2026-09-25T13:35:00Z", ...o,
});
const fill = (f: Partial<Fill> & { ticker: string; orderId: string }): Fill => ({
  side: "buy", qty: 10, price: 100, filledAt: "2026-09-25T13:36:00Z", tradingDate: "2026-09-25", runId: "R", ...f,
});
const exp = (clientOrderId: string, ticker: string, side: "buy" | "sell" = "buy") => ({ clientOrderId, ticker, side });

describe("crossCheckBroker", () => {
  it("clean run: every order filled and recorded → ok, no discrepancies", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA"), exp("c2", "BBB")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA" }), ord({ clientOrderId: "c2", symbol: "BBB", filledAvgPrice: 50, filledQty: 4 })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1" }), fill({ ticker: "BBB", orderId: "b-c2", qty: 4, price: 50 })],
    });
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.checked).toEqual({ expected: 2, brokerMatched: 2, fills: 2 });
  });

  it("zero-fill (canceled IOC) with no recorded fill → clean", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", status: "canceled", filledQty: 0, filledAvgPrice: null, filledAt: null })],
      fills: [],
    });
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it("partial fill recorded correctly → clean", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", status: "canceled", qty: 10, filledQty: 6, filledAvgPrice: 100 })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1", qty: 6 })],
    });
    expect(r.ok).toBe(true);
  });

  it("UNRECORDED_FILL: broker filled but nothing in fills.jsonl → critical", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", filledQty: 10 })],
      fills: [],
    });
    expect(r.ok).toBe(false);
    expect(r.critical).toBe(1);
    expect(r.discrepancies[0]).toMatchObject({ code: "UNRECORDED_FILL", severity: "critical", ticker: "AAA" });
  });

  it("ORPHAN_FILL: fill with no matching broker order → critical", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA" })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1" }), fill({ ticker: "ZZZ", orderId: "ghost-1" })],
    });
    expect(r.ok).toBe(false);
    expect(r.discrepancies.filter((x) => x.code === "ORPHAN_FILL")).toHaveLength(1);
    expect(r.discrepancies.find((x) => x.code === "ORPHAN_FILL")).toMatchObject({ ticker: "ZZZ", severity: "critical" });
  });

  it("QTY_MISMATCH: recorded qty ≠ broker filledQty → critical", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", filledQty: 10 })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1", qty: 7 })],
    });
    expect(r.ok).toBe(false);
    expect(r.discrepancies[0]).toMatchObject({ code: "QTY_MISMATCH", severity: "critical" });
  });

  it("PRICE_MISMATCH: recorded price off beyond eps → warn (not critical)", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", filledQty: 10, filledAvgPrice: 100 })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1", qty: 10, price: 102 })],
    });
    expect(r.ok).toBe(true);          // warn only
    expect(r.warn).toBe(1);
    expect(r.discrepancies[0]).toMatchObject({ code: "PRICE_MISMATCH", severity: "warn" });
  });

  it("price within eps → no discrepancy", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", filledQty: 10, filledAvgPrice: 100 })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1", qty: 10, price: 100.005 })],
    });
    expect(r.discrepancies).toEqual([]);
  });

  it("REJECTED: broker rejected the order → warn", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA", status: "rejected", filledQty: 0, filledAvgPrice: null, filledAt: null })],
      fills: [],
    });
    expect(r.ok).toBe(true);
    expect(r.discrepancies[0]).toMatchObject({ code: "REJECTED", severity: "warn" });
  });

  it("MISSING_SUBMISSION: expected order absent from broker → warn", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA"), exp("c2", "BBB")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA" })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1" })],
    });
    expect(r.ok).toBe(true);
    expect(r.discrepancies[0]).toMatchObject({ code: "MISSING_SUBMISSION", severity: "warn", ticker: "BBB" });
    expect(r.checked.brokerMatched).toBe(1);
  });

  it("cross-run scoping: a foreign broker order (clientOrderId not expected) is ignored", () => {
    const r = crossCheckBroker({
      expected: [exp("c1", "AAA")],
      brokerOrders: [ord({ clientOrderId: "c1", symbol: "AAA" }), ord({ clientOrderId: "OTHER", symbol: "QQQ", filledQty: 5 })],
      fills: [fill({ ticker: "AAA", orderId: "b-c1" })],
    });
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it("empty run: no orders, no fills → ok", () => {
    const r = crossCheckBroker({ expected: [], brokerOrders: [], fills: [] });
    expect(r.ok).toBe(true);
    expect(r.checked).toEqual({ expected: 0, brokerMatched: 0, fills: 0 });
  });
});
