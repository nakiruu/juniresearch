import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchwabBroker } from "./schwab";
import { SchwabTokenStore } from "./schwab-auth";

const NOW = Date.parse("2026-09-25T13:36:00Z");
const HASH = "ACCTHASH";
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

function seededStore(): SchwabTokenStore {
  const store = new SchwabTokenStore(join(mkdtempSync(join(tmpdir(), "schwab-")), "t.json"));
  store.write({ refreshToken: "R", accessToken: "A", accessExpiresAt: NOW + 3_600_000, refreshObtainedAt: NOW });
  return store;
}

/** A routing mock: dispatches on URL + method; records POST/DELETE calls for assertions. */
function mockFetch(handlers: { orders?: unknown[]; postLocation?: string }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? String(init.body) : undefined });
    if (url.includes("/markets")) return json({ equity: { EQ: { isOpen: true } } });
    if (url.includes("/pricehistory")) return json({ candles: [{ close: 99, datetime: Date.parse("2026-09-24T20:00:00Z") }, { close: 101, datetime: Date.parse("2026-09-25T20:00:00Z") }, { close: 200, datetime: Date.parse("2026-09-26T20:00:00Z") }] });
    if (url.includes("/quotes")) return json({ NEE: { quote: { lastPrice: 75.5, bidPrice: 75.4, askPrice: 75.6, tradeTime: NOW, quoteTime: NOW } } });
    if (url.includes("/orders") && method === "POST") return new Response(null, { status: 201, headers: { Location: handlers.postLocation ?? `https://api.schwabapi.com/trader/v1/accounts/${HASH}/orders/1001` } });
    if (url.includes("/orders") && method === "DELETE") return new Response(null, { status: 200 });
    if (url.includes("/orders")) return json(handlers.orders ?? []);
    if (url.includes("/accounts/")) return json({ securitiesAccount: { currentBalances: { liquidationValue: 100000, cashBalance: 41487, buyingPower: 41487 }, positions: [
      { instrument: { symbol: "NEE" }, longQuantity: 43, marketValue: 3249, averagePrice: 75.56 },
      { instrument: { symbol: "OLD" }, longQuantity: 0, marketValue: 0, averagePrice: 0 },
    ] } });
    throw new Error(`unhandled ${method} ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const mk = (fetchImpl: typeof fetch) => new SchwabBroker({ tokenStore: seededStore(), clientId: "cid", clientSecret: "s", accountHash: HASH, fetchImpl, nowMs: () => NOW });

describe("SchwabBroker reads", () => {
  it("getAccount maps balances", async () => {
    expect(await mk(mockFetch({}).fetchImpl).getAccount()).toEqual({ equity: 100000, cash: 41487, buyingPower: 41487 });
  });
  it("getPositions maps long positions and drops zero-qty", async () => {
    expect(await mk(mockFetch({}).fetchImpl).getPositions()).toEqual([{ symbol: "NEE", qty: 43, marketValue: 3249, avgEntryPrice: 75.56 }]);
  });
  it("getClock reads isOpen", async () => {
    expect((await mk(mockFetch({}).fetchImpl).getClock()).isOpen).toBe(true);
  });
  it("getLastClose picks the last candle on/before the date", async () => {
    expect(await mk(mockFetch({}).fetchImpl).getLastClose(["NEE"], "2026-09-25")).toEqual({ NEE: 101 }); // not the 09-26 candle (200)
  });
  it("getLatestTrade / getLatestQuote", async () => {
    const b = mk(mockFetch({}).fetchImpl);
    expect(await b.getLatestTrade("NEE")).toEqual({ price: 75.5, tsMs: NOW });
    expect(await b.getLatestQuote("NEE")).toEqual({ bid: 75.4, ask: 75.6, tsMs: NOW });
  });
  it("isFractionable is always false", async () => {
    expect(await mk(mockFetch({}).fetchImpl).isFractionable(["NEE", "AMZN"])).toEqual({ NEE: false, AMZN: false });
  });
  it("getCalendar delegates to the local NYSE calendar", async () => {
    const days = (await mk(mockFetch({}).fetchImpl).getCalendar("2026-09-21", "2026-09-25")).map((d) => d.date);
    expect(days).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
  });
  it("getOrders maps status/side/filledQty and a weighted average fill price", async () => {
    const orders = [{ orderId: 1001, status: "FILLED", quantity: 10, filledQuantity: 10, enteredTime: "2026-09-25T13:35:00Z",
      orderLegCollection: [{ instruction: "BUY", instrument: { symbol: "NEE" }, quantity: 10 }],
      orderActivityCollection: [{ executionLegs: [{ quantity: 6, price: 75.5, time: "2026-09-25T13:36:00Z" }, { quantity: 4, price: 75.6, time: "2026-09-25T13:36:01Z" }] }] }];
    const [o] = await mk(mockFetch({ orders }).fetchImpl).getOrders("all");
    expect(o).toMatchObject({ id: "1001", symbol: "NEE", side: "buy", status: "filled", filledQty: 10 });
    expect(o.filledAvgPrice).toBeCloseTo((6 * 75.5 + 4 * 75.6) / 10, 6);
    expect(o.filledAt).toBe("2026-09-25T13:36:01Z");
  });
});

describe("SchwabBroker submit / cancel", () => {
  it("submitOrder parses the Location order id, records the cid map, and getOrders then stamps clientOrderId", async () => {
    const { fetchImpl, calls } = mockFetch({ orders: [{ orderId: 1001, status: "FILLED", quantity: 5, filledQuantity: 5, orderLegCollection: [{ instruction: "BUY", instrument: { symbol: "NEE" } }], orderActivityCollection: [] }] });
    const b = mk(fetchImpl);
    const submitted = await b.submitOrder({ symbol: "NEE", side: "buy", qty: 5, clientOrderId: "cid-xyz", estNotionalUsd: 400, limitPrice: 75.68, timeInForce: "ioc" });
    expect(submitted).toMatchObject({ id: "1001", clientOrderId: "cid-xyz", status: "new" });
    const postBody = JSON.parse(calls.find((c) => c.method === "POST")!.body!);
    expect(postBody).toMatchObject({ orderType: "LIMIT", duration: "IMMEDIATE_OR_CANCEL", session: "NORMAL", price: 75.68 });
    expect(postBody.orderLegCollection[0]).toMatchObject({ instruction: "BUY", quantity: 5, instrument: { symbol: "NEE", assetType: "EQUITY" } });
    const [o] = await b.getOrders("all"); // stamped from the map set at submit
    expect(o.clientOrderId).toBe("cid-xyz");
  });
  it("rejects a notional (fractional) order and a non-integer qty", async () => {
    const b = mk(mockFetch({}).fetchImpl);
    await expect(b.submitOrder({ symbol: "NEE", side: "buy", notional: 100, clientOrderId: "c", estNotionalUsd: 100 })).rejects.toThrow(/notional\/fractional/);
    await expect(b.submitOrder({ symbol: "NEE", side: "buy", qty: 1.5, clientOrderId: "c", estNotionalUsd: 100 })).rejects.toThrow(/whole-share/);
  });
  it("cancelOrder issues a DELETE", async () => {
    const { fetchImpl, calls } = mockFetch({});
    await mk(fetchImpl).cancelOrder("1001");
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/orders/1001"))).toBe(true);
  });
});
