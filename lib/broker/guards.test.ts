import { describe, it, expect } from "vitest";
import { assertOrderAllowed, guardedSubmit, GuardError, PAPER_HOST, type GuardContext } from "./guards";
import { FakeBroker } from "./fake";
import { DEFAULT_TRADE_CONFIG as cfg } from "../trade/config";

const ctx = (o: Partial<GuardContext> = {}): GuardContext => ({
  brokerKind: "alpaca-paper", configuredBaseUrl: `https://${PAPER_HOST}`, locks: { buyLockUntil: {}, sellLockUntil: {} },
  today: "2026-09-25", nav: 100_000, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0 }, ...o,
});
const buy = { symbol: "NVT", side: "buy" as const, notional: 1_000, clientOrderId: "c", estNotionalUsd: 1_000 };
const sell = { symbol: "NVT", side: "sell" as const, qty: 1, clientOrderId: "c", estNotionalUsd: 100 };

describe("assertOrderAllowed", () => {
  it("allows a plain order", () => { expect(() => assertOrderAllowed(buy, ctx())).not.toThrow(); });
  it("kill switch refuses everything", () => {
    expect(() => assertOrderAllowed(buy, ctx({ env: { TRADE_DISABLED: "1" } as unknown as NodeJS.ProcessEnv }))).toThrow(GuardError);
  });
  it("refuses a non-paper endpoint for the Alpaca kind, but not for the fake", () => {
    expect(() => assertOrderAllowed(buy, ctx({ configuredBaseUrl: "https://api.alpaca.markets" }))).toThrow(/not the paper endpoint/);
    expect(() => assertOrderAllowed(buy, ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" }))).not.toThrow();
  });
  it("refuses a buy of a banned symbol but allows the disposing sell", () => {
    expect(() => assertOrderAllowed({ ...buy, symbol: "ICE" }, ctx())).toThrow(/banned/);
    expect(() => assertOrderAllowed({ ...sell, symbol: "ICE" }, ctx())).not.toThrow();
  });
  it("refuses a buy inside a buy-lock and a sell inside a sell-lock", () => {
    const locks = { buyLockUntil: { NVT: "2026-09-29" }, sellLockUntil: { NVT: "2026-09-29" } };
    expect(() => assertOrderAllowed(buy, ctx({ locks }))).toThrow(/buy-locked/);
    expect(() => assertOrderAllowed(sell, ctx({ locks }))).toThrow(/sell-locked/);
    expect(() => assertOrderAllowed(buy, ctx({ locks, today: "2026-09-29" }))).not.toThrow(); // first legal day
  });
  it("refuses past the order-count and notional caps", () => {
    expect(() => assertOrderAllowed(buy, ctx({ counters: { orders: cfg.maxOrdersPerRun, notionalUsd: 0 } }))).toThrow(/maxOrdersPerRun/);
    expect(() => assertOrderAllowed(buy, ctx({ counters: { orders: 0, notionalUsd: 99_500 } }))).toThrow(/maxNotionalFrac/);
  });
});

describe("guardedSubmit", () => {
  it("submits through the adapter and advances the counters", async () => {
    const b = new FakeBroker({ calendar: [{ date: "2026-09-25", open: "09:30", close: "16:00" }], closes: { NVT: { "2026-09-25": 100 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const c = ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" });
    const o = await guardedSubmit(b, buy, c);
    expect(o.status).toBe("filled");
    expect(c.counters).toEqual({ orders: 1, notionalUsd: 1_000 });
  });
  it("does not call the adapter when a guard refuses", async () => {
    const b = new FakeBroker({ calendar: [{ date: "2026-09-25", open: "09:30", close: "16:00" }], closes: { ICE: { "2026-09-25": 100 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    await expect(guardedSubmit(b, { ...buy, symbol: "ICE" }, ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" }))).rejects.toThrow(GuardError);
    expect(await b.getOrders("all")).toEqual([]);
  });
  it("threads limitPrice and timeInForce through to the adapter unchanged", async () => {
    const b = new FakeBroker({ calendar: [{ date: "2026-09-25", open: "09:30", close: "16:00" }], closes: { NVT: { "2026-09-25": 100 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const c = ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" });
    // limitPrice 90 on a buy is not marketable against the 100 close — if guardedSubmit dropped the
    // field, the fake would treat this as a plain market order and fill it instead of cancelling it.
    const o = await guardedSubmit(b, { ...buy, limitPrice: 90, timeInForce: "ioc" }, c);
    expect(o.status).toBe("canceled");
    expect(o.filledQty).toBe(0);
    expect(c.counters).toEqual({ orders: 1, notionalUsd: 1_000 });
  });
});
