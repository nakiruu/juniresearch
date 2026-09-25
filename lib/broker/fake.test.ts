import { describe, it, expect } from "vitest";
import { FakeBroker } from "./fake";

const CAL = [{ date: "2026-09-24", open: "09:30", close: "16:00" }, { date: "2026-09-25", open: "09:30", close: "16:00" }];
const mk = () => new FakeBroker({ calendar: CAL, closes: { NVT: { "2026-09-24": 100, "2026-09-25": 110 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });

describe("FakeBroker", () => {
  it("fills a notional buy instantly at today's close and updates cash, positions and equity", async () => {
    const b = mk();
    const o = await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_100, clientOrderId: "c1", estNotionalUsd: 1_100 });
    expect(o).toEqual(expect.objectContaining({ status: "filled", filledQty: 10, filledAvgPrice: 110, notional: 1_100, qty: null, clientOrderId: "c1" }));
    expect(o.filledAt).toMatch(/^2026-09-25T/);
    expect(await b.getPositions()).toEqual([{ symbol: "NVT", qty: 10, marketValue: 1_100, avgEntryPrice: 110 }]);
    expect(await b.getAccount()).toEqual({ equity: 10_000, cash: 8_900, buyingPower: 8_900 });
  });
  it("fills a qty sell, removes an emptied position, and lists orders", async () => {
    const b = mk();
    await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_100, clientOrderId: "c1", estNotionalUsd: 1_100 });
    await b.submitOrder({ symbol: "NVT", side: "sell", qty: 10, clientOrderId: "c2", estNotionalUsd: 1_100 });
    expect(await b.getPositions()).toEqual([]);
    expect((await b.getOrders("all")).map((o) => o.clientOrderId)).toEqual(["c1", "c2"]);
  });
  it("serves the settled close, the calendar, the clock, and fractionability", async () => {
    const b = mk();
    expect(await b.getLastClose(["NVT"], "2026-09-24")).toEqual({ NVT: 100 });
    await expect(b.getLastClose(["ZZZ"], "2026-09-24")).rejects.toThrow(/no close/);
    expect(await b.getCalendar("2026-09-24", "2026-09-25")).toEqual(CAL);
    expect((await b.getClock()).isOpen).toBe(true);
    expect(await b.isFractionable(["NVT"])).toEqual({ NVT: true });
  });
  it("refuses to sell more than it holds", async () => {
    await expect(mk().submitOrder({ symbol: "NVT", side: "sell", qty: 1, clientOrderId: "c", estNotionalUsd: 110 })).rejects.toThrow(/insufficient/);
  });
});

describe("fake market data", () => {
  it("returns injected trade/quote with timestamps, null when unset", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: {}, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    b.setTrade("NEE", 80.14, 1234);
    b.setQuote("NEE", 80.13, 80.15, 1234);
    expect(await b.getLatestTrade("NEE")).toEqual({ price: 80.14, tsMs: 1234 });
    expect(await b.getLatestQuote("NEE")).toEqual({ bid: 80.13, ask: 80.15, tsMs: 1234 });
    expect(await b.getLatestTrade("ZZZ")).toBeNull();
    expect(await b.getLatestQuote("ZZZ")).toBeNull();
  });
  it("setClock flips isOpen for the freshness gate's market-hours tests", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: {}, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    expect((await b.getClock()).isOpen).toBe(true);
    b.setClock(false);
    expect((await b.getClock()).isOpen).toBe(false);
    b.setClock(true);
    expect((await b.getClock()).isOpen).toBe(true);
  });
});
