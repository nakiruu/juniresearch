import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
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

describe("SchwabBroker.getClock — isOpen is a trading-DAY flag; only the regular session counts as open", () => {
  // Real /markets payloads captured 2026-09-26 (read-only). nextday = a trading day's entry.
  const tradingDay = JSON.parse(readFileSync(join(__dirname, "__fixtures__/schwab-markets-nextday.json"), "utf8"));
  const closedDay = JSON.parse(readFileSync(join(__dirname, "__fixtures__/schwab-markets-weekend.json"), "utf8"));
  const clockAt = (iso: string, body: unknown) => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => { urls.push(url); return json(body); }) as unknown as typeof fetch;
    const tokenStore = seededStore();
    tokenStore.write({ ...tokenStore.read()!, accessExpiresAt: Date.parse("2027-01-01T00:00:00Z") }); // no refresh at these instants
    const b = new SchwabBroker({ tokenStore, clientId: "cid", clientSecret: "s", accountHash: HASH, fetchImpl, nowMs: () => Date.parse(iso) });
    return { clock: b.getClock(), urls };
  };

  it("is open during the regular session (10:00 ET) and reports the session bounds", async () => {
    const c = await clockAt("2026-09-28T14:00:00Z", tradingDay).clock;
    expect(c).toMatchObject({ isOpen: true, nextOpen: "2026-09-28T09:30:00-04:00", nextClose: "2026-09-28T16:00:00-04:00" });
  });
  it("is CLOSED after hours even though Schwab says isOpen:true (21:00 ET)", async () => {
    expect((await clockAt("2026-09-29T01:00:00Z", tradingDay).clock).isOpen).toBe(false);
  });
  it("is closed pre-market (08:00 ET) and exactly at the 16:00 close", async () => {
    expect((await clockAt("2026-09-28T12:00:00Z", tradingDay).clock).isOpen).toBe(false);
    expect((await clockAt("2026-09-28T20:00:00Z", tradingDay).clock).isOpen).toBe(false);
    expect((await clockAt("2026-09-28T13:30:00Z", tradingDay).clock).isOpen).toBe(true); // 09:30 sharp
  });
  it("is closed when Schwab says the date is not a trading day", async () => {
    expect((await clockAt("2026-09-26T14:00:00Z", closedDay).clock).isOpen).toBe(false);
  });
  it("asks for today's ET date explicitly (the evening UTC date would be tomorrow)", async () => {
    const { clock, urls } = clockAt("2026-09-29T01:00:00Z", tradingDay);
    await clock;
    expect(urls[0]).toContain("date=2026-09-28");
  });
  it("falls back to the NYSE calendar + 09:30–16:00 ET when sessionHours are missing", async () => {
    const bare = { equity: { EQ: { isOpen: true } } };
    expect((await clockAt("2026-09-28T14:00:00Z", bare).clock).isOpen).toBe(true);   // Mon 10:00 ET
    expect((await clockAt("2026-09-29T01:00:00Z", bare).clock).isOpen).toBe(false);  // Mon 21:00 ET
    expect((await clockAt("2026-11-26T15:00:00Z", bare).clock).isOpen).toBe(false);  // Thanksgiving
  });
});

describe("SchwabBroker reads", () => {
  it("getAccount maps balances", async () => {
    expect(await mk(mockFetch({}).fetchImpl).getAccount()).toEqual({ equity: 100000, cash: 41487, buyingPower: 41487 });
  });
  it("getPositions maps long positions and drops zero-qty", async () => {
    expect(await mk(mockFetch({}).fetchImpl).getPositions()).toEqual([{ symbol: "NEE", qty: 43, marketValue: 3249, avgEntryPrice: 75.56 }]);
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
  it("getOrders' default window starts at ET midnight, even in the evening when the UTC date is tomorrow", async () => {
    const { fetchImpl, calls } = mockFetch({ orders: [] });
    const tokenStore = seededStore();
    tokenStore.write({ ...tokenStore.read()!, accessExpiresAt: Date.parse("2027-01-01T00:00:00Z") });
    const b = new SchwabBroker({ tokenStore, clientId: "cid", clientSecret: "s", accountHash: HASH, fetchImpl, nowMs: () => Date.parse("2026-09-29T01:00:00Z") }); // 21:00 EDT Mon
    await b.getOrders("all");
    const from = new URL(calls.find((c) => c.url.includes("/orders"))!.url).searchParams.get("fromEnteredTime");
    expect(from).toBe("2026-09-28T04:00:00.000Z"); // 00:00 EDT Mon 09-28, not 00:00Z Tue
  });
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
