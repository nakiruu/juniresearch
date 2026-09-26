import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile, weightsOf, positionsOf, readLedger, writeLedger, ReconcileError } from "./ledger";
import type { Fill } from "./fills";
import type { BrokerOrder } from "../broker/adapter";

const buy = (ticker: string): Fill => ({ ticker, side: "buy", qty: 1, price: 1, filledAt: "2026-09-21T15:00:00Z", tradingDate: "2026-09-21", orderId: "o", runId: "r" });
const acct = { equity: 100_000, cash: 20_000 };
const pos = (symbol: string, qty: number, marketValue: number) => ({ symbol, qty, marketValue, avgEntryPrice: marketValue / qty });

describe("reconcile", () => {
  it("builds the ledger from broker account + positions and derives weights", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000), pos("MP", 600, 30_000)], fills: [buy("NVT"), buy("MP")] });
    expect(l.nav).toBe(100_000);
    expect(weightsOf(l)).toEqual({ NVT: 0.5, MP: 0.3 });
    expect(positionsOf(l)).toEqual({ NVT: { qty: 100, marketValue: 50_000 }, MP: { qty: 600, marketValue: 30_000 } });
  });
  it("halts on a broker position the fills log cannot explain", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [] }))
      .toThrow(ReconcileError);
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [] }))
      .toThrow(/NVT.*no buy fill/);
  });
  it("accepts an empty book and drops zero-qty positions", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("X", 0, 0)], fills: [] });
    expect(l.positions).toEqual([]);
  });
  it("drops a negative-qty broker position just like a zero-qty one", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("X", -5, -100)], fills: [] });
    expect(l.positions).toEqual([]);
  });
  it("rejects a non-positive equity", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: { equity: 0, cash: 0 }, positions: [], fills: [] })).toThrow(ReconcileError);
  });
});

describe("reconcile — broker orders over the lock window (spec #7)", () => {
  const W = "2026-09-17"; // lockWindowStart
  const order = (o: Partial<BrokerOrder> & { id: string; symbol: string }): BrokerOrder => ({
    clientOrderId: "", side: "buy", status: "filled", qty: 10, notional: null, filledQty: 10, filledAvgPrice: 100,
    filledAt: "2026-09-24T13:50:00Z", submittedAt: "2026-09-24T13:49:00Z", ...o,
  });
  const f = (ticker: string, orderId: string, side: "buy" | "sell", qty = 10): Fill => ({ ticker, side, qty, price: 100, filledAt: "2026-09-24T13:50:00Z", tradingDate: "2026-09-24", orderId, runId: "r" });
  const base = { asOf: "2026-09-25", account: acct, lockWindowStart: W };

  it("passes when every executed order in the window is fully recorded (buy and sell)", () => {
    expect(() => reconcile({ ...base, positions: [pos("NVT", 10, 1000)], fills: [f("NVT", "B1", "buy"), f("MP", "S1", "sell")],
      brokerOrders: [order({ id: "B1", symbol: "NVT" }), order({ id: "S1", symbol: "MP", side: "sell" })] })).not.toThrow();
  });
  it("halts on an unrecorded SELL — the case that would leave buyLockUntil unset", () => {
    expect(() => reconcile({ ...base, positions: [], fills: [], brokerOrders: [order({ id: "S1", symbol: "MP", side: "sell" })] }))
      .toThrow(/S1 sell MP filled 10, fills.jsonl records 0/);
  });
  it("halts on an extra buy of a name already held (positions alone would pass)", () => {
    expect(() => reconcile({ ...base, positions: [pos("NVT", 20, 2000)], fills: [f("NVT", "B1", "buy")],
      brokerOrders: [order({ id: "B1", symbol: "NVT" }), order({ id: "B2", symbol: "NVT" })] })).toThrow(/B2 buy NVT/);
  });
  it("halts on a partially recorded quantity", () => {
    expect(() => reconcile({ ...base, positions: [pos("NVT", 10, 1000)], fills: [f("NVT", "B1", "buy", 4)],
      brokerOrders: [order({ id: "B1", symbol: "NVT" })] })).toThrow(/filled 10, fills.jsonl records 4/);
  });
  it("sums split fills for one order", () => {
    expect(() => reconcile({ ...base, positions: [pos("NVT", 10, 1000)], fills: [f("NVT", "B1", "buy", 4), f("NVT", "B1", "buy", 6)],
      brokerOrders: [order({ id: "B1", symbol: "NVT" })] })).not.toThrow();
  });
  it("halts on a non-terminal (working) order", () => {
    expect(() => reconcile({ ...base, positions: [], fills: [], brokerOrders: [order({ id: "W1", symbol: "NVT", status: "new", filledQty: 0 })] }))
      .toThrow(/open broker order W1/);
  });
  it("ignores unfilled terminal orders and orders before the lock window", () => {
    expect(() => reconcile({ ...base, positions: [], fills: [], brokerOrders: [
      order({ id: "C1", symbol: "NVT", status: "canceled", filledQty: 0, filledAt: null }),
      order({ id: "OLD", symbol: "MP", filledAt: "2026-09-10T14:00:00Z", submittedAt: "2026-09-10T14:00:00Z" }),
    ] })).not.toThrow();
  });
  it("checks a manual order (no clientOrderId) by broker id — passes once recorded under runId 'manual'", () => {
    const manual = order({ id: "M1", symbol: "AMZN", side: "sell", clientOrderId: "" });
    expect(() => reconcile({ ...base, positions: [], fills: [], brokerOrders: [manual] })).toThrow(/M1 sell AMZN/);
    expect(() => reconcile({ ...base, positions: [], fills: [{ ...f("AMZN", "M1", "sell"), runId: "manual" }], brokerOrders: [manual] })).not.toThrow();
  });
  it("without brokerOrders behaves exactly as before", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 10, 1000)], fills: [buy("NVT")] })).not.toThrow();
  });
});

describe("ledger file", () => {
  it("round-trips through disk and reads null when absent", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "sub", "ledger.json");
    expect(readLedger(p)).toBeNull();
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [buy("NVT")] });
    writeLedger(p, l);
    expect(readLedger(p)).toEqual(l);
  });
});
