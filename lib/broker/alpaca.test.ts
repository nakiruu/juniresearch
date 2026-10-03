import { describe, it, expect } from "vitest";
import { AlpacaPaperBroker } from "./alpaca";

type Call = { url: string; init: RequestInit };
function mockFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const mk = (routes: Record<string, unknown>) => {
  const f = mockFetch(routes);
  return { b: new AlpacaPaperBroker({ keyId: "k", secretKey: "s", baseUrl: "https://paper-api.alpaca.markets", fetchImpl: f.impl }), ...f };
};

describe("AlpacaPaperBroker", () => {
  it("getLatestSnapshots reads every symbol's latest trade and quote from ONE /v2/stocks/snapshots request", async () => {
    const { b, calls } = mk({ "/v2/stocks/snapshots": {
      NVT: { latestTrade: { p: 104.5, t: "2026-09-25T19:09:00Z" }, latestQuote: { bp: 104.4, ap: 104.6, t: "2026-09-25T19:09:30Z" } },
      QQQ: { latestTrade: { p: 0, t: "2026-09-25T19:09:00Z" }, latestQuote: { bp: 101, ap: 102, t: "bad" } },
      NONE: null,
    } });
    const snaps = await b.getLatestSnapshots(["NVT", "QQQ", "NONE", "MISSING"]);
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("symbols")).toBe("NVT,QQQ,NONE,MISSING");
    expect(q.get("feed")).toBe("iex");
    expect(snaps).toEqual({
      NVT: { lastTrade: { price: 104.5, tsMs: Date.parse("2026-09-25T19:09:00Z") }, quote: { bid: 104.4, ask: 104.6, tsMs: Date.parse("2026-09-25T19:09:30Z") } },
      QQQ: { lastTrade: null, quote: null }, // zero price, unparseable time: the same rules as getLatestTrade/getLatestQuote
      NONE: { lastTrade: null, quote: null },
      MISSING: { lastTrade: null, quote: null },
    });
  });
  it("lists orders newest-first and forwards the after bound", async () => {
    const { b, calls } = mk({ "/v2/orders": [] });
    await b.getOrders("all", "2026-09-28T13:44:00.000Z");
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("direction")).toBe("desc");
    expect(q.get("after")).toBe("2026-09-28T13:44:00.000Z");
  });
  it("an order submit that dies on the network or gets a 5xx is SubmitOutcomeUnknown and is POSTed once", async () => {
    for (const post of [async () => { throw new TypeError("fetch failed"); }, async () => new Response("x", { status: 503 })]) {
      let posts = 0;
      const impl = (async (_url: string, init: RequestInit = {}) => { if (init.method === "POST") { posts++; return post(); } return new Response("{}", { status: 404 }); }) as unknown as typeof fetch;
      const b = new AlpacaPaperBroker({ keyId: "k", secretKey: "s", baseUrl: "https://paper-api.alpaca.markets", fetchImpl: impl });
      await expect(b.submitOrder({ symbol: "NVT", side: "buy", qty: 1, clientOrderId: "c9", estNotionalUsd: 100, limitPrice: 100, timeInForce: "ioc" })).rejects.toMatchObject({ name: "SubmitOutcomeUnknownError", clientOrderId: "c9" });
      expect(posts).toBe(1);
    }
  });
  it("findSubmitted looks the order up by client_order_id (404 → null)", async () => {
    const order = { id: "o1", client_order_id: "c9", symbol: "NVT", side: "buy", status: "filled", qty: "1", notional: null, filled_qty: "1", filled_avg_price: "100", filled_at: "2026-09-25T13:36:00Z", submitted_at: "2026-09-25T13:35:59Z" };
    const { b, calls } = mk({ "orders:by_client_order_id": order });
    const req = { symbol: "NVT", side: "buy" as const, qty: 1, clientOrderId: "c9", estNotionalUsd: 100 };
    expect(await b.findSubmitted(req)).toMatchObject({ id: "o1", clientOrderId: "c9", filledQty: 1 });
    expect(new URL(calls[0].url).searchParams.get("client_order_id")).toBe("c9");
    expect(await mk({}).b.findSubmitted(req)).toBeNull();
  });
  it("refuses a non-paper base URL at construction", () => {
    expect(() => new AlpacaPaperBroker({ keyId: "k", secretKey: "s", baseUrl: "https://api.alpaca.markets" })).toThrow(/paper/);
  });
  it("sends the two auth headers and converts account strings to numbers", async () => {
    const { b, calls } = mk({ "/v2/account": { equity: "100000.5", cash: "2500", buying_power: "5000", status: "ACTIVE" } });
    expect(await b.getAccount()).toEqual({ equity: 100000.5, cash: 2500, buyingPower: 5000 });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["APCA-API-KEY-ID"]).toBe("k");
    expect(h["APCA-API-SECRET-KEY"]).toBe("s");
  });
  it("parses positions, the clock and the calendar", async () => {
    const { b } = mk({
      "/v2/positions": [{ symbol: "NVT", qty: "10.5", market_value: "1155", avg_entry_price: "100", side: "long" }],
      "/v2/clock": { timestamp: "2026-09-25T14:00:00Z", is_open: true, next_open: "x", next_close: "y" },
      "/v2/calendar": [{ date: "2026-09-25", open: "09:30", close: "16:00", session_open: "0400", session_close: "2000" }],
    });
    expect(await b.getPositions()).toEqual([{ symbol: "NVT", qty: 10.5, marketValue: 1155, avgEntryPrice: 100 }]);
    expect(await b.getClock()).toEqual({ timestamp: "2026-09-25T14:00:00Z", isOpen: true, nextOpen: "x", nextClose: "y" });
    expect(await b.getCalendar("2026-09-25", "2026-09-25")).toEqual([{ date: "2026-09-25", open: "09:30", close: "16:00" }]);
  });
  it("posts a market/day order with exactly one of qty or notional and the client id", async () => {
    const { b, calls } = mk({ "/v2/orders": { id: "id1", client_order_id: "c1", symbol: "NVT", side: "buy", status: "accepted", qty: null, notional: "1000", filled_qty: "0", filled_avg_price: null, filled_at: null, submitted_at: "t", type: "market", time_in_force: "day" } });
    const o = await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1000, clientOrderId: "c1", estNotionalUsd: 1000 });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ symbol: "NVT", side: "buy", type: "market", time_in_force: "day", client_order_id: "c1", notional: "1000" });
    expect(o).toEqual(expect.objectContaining({ id: "id1", clientOrderId: "c1", status: "accepted", notional: 1000, qty: null, filledQty: 0, filledAvgPrice: null }));
  });
  it("posts a limit/ioc order when limitPrice and timeInForce are set", async () => {
    const { b, calls } = mk({ "/v2/orders": { id: "id1", client_order_id: "c1", symbol: "NVT", side: "buy", status: "accepted", qty: "10", notional: null, filled_qty: "0", filled_avg_price: null, filled_at: null, submitted_at: "t", type: "limit", time_in_force: "ioc" } });
    await b.submitOrder({ symbol: "NVT", side: "buy", qty: 10, clientOrderId: "c1", estNotionalUsd: 1100, limitPrice: 110, timeInForce: "ioc" });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ symbol: "NVT", side: "buy", type: "limit", limit_price: "110", time_in_force: "ioc", client_order_id: "c1", qty: "10" });
  });
  it("defaults time_in_force to day for a limit order when timeInForce is unset", async () => {
    const { b, calls } = mk({ "/v2/orders": { id: "id2", client_order_id: "c2", symbol: "NVT", side: "buy", status: "accepted", qty: "10", notional: null, filled_qty: "0", filled_avg_price: null, filled_at: null, submitted_at: "t", type: "limit", time_in_force: "day" } });
    await b.submitOrder({ symbol: "NVT", side: "buy", qty: 10, clientOrderId: "c2", estNotionalUsd: 1100, limitPrice: 110 });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ symbol: "NVT", side: "buy", type: "limit", limit_price: "110", time_in_force: "day", client_order_id: "c2", qty: "10" });
  });
  it("reads the settled close from daily bars with the iex feed", async () => {
    const { b, calls } = mk({ "/v2/stocks/bars": { bars: { NVT: [{ t: "2026-09-24T04:00:00Z", o: 1, h: 1, l: 1, c: 101.25, v: 1 }] }, next_page_token: null } });
    expect(await b.getLastClose(["NVT"], "2026-09-24")).toEqual({ NVT: 101.25 });
    expect(calls[0].url).toContain("data.alpaca.markets/v2/stocks/bars");
    expect(calls[0].url).toContain("timeframe=1Day");
    expect(calls[0].url).toContain("feed=iex");
    await expect(b.getLastClose(["ZZZ"], "2026-09-24")).rejects.toThrow(/no bar/);
  });
  it("reads the last close on/before the date from a 10-day window: a trading day gets its own bar, a weekend the prior session's", async () => {
    const bar = (d: string, c: number) => ({ t: `${d}T04:00:00Z`, o: 1, h: 1, l: 1, c, v: 1 });
    const { b, calls } = mk({ "/v2/stocks/bars": { bars: { SPY: [bar("2026-09-17", 650), bar("2026-09-18", 652.5)], NVT: [bar("2026-09-18", 99)] }, next_page_token: null } });
    expect(await b.getLastClose(["SPY", "NVT"], "2026-09-20")).toEqual({ SPY: 652.5, NVT: 99 }); // Sunday → Friday's close
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("start")).toBe("2026-09-10");
    expect(q.get("end")).toBe("2026-09-20");
    const day = mk({ "/v2/stocks/bars": { bars: { NVT: [bar("2026-09-23", 100), bar("2026-09-24", 101.25), bar("2026-09-25", 105)] } } });
    expect(await day.b.getLastClose(["NVT"], "2026-09-24")).toEqual({ NVT: 101.25 }); // the date's own bar; a later bar is never used
  });
  it("follows next_page_token so a symbol on a later page is not missed", async () => {
    const urls: string[] = [];
    const pages = [
      { bars: { AAA: [{ t: "2026-09-24T04:00:00Z", c: 10 }] }, next_page_token: "p2" },
      { bars: { AAA: [{ t: "2026-09-25T04:00:00Z", c: 11 }], ZZZ: [{ t: "2026-09-25T04:00:00Z", c: 20 }] }, next_page_token: null },
    ];
    const impl = (async (url: string) => { urls.push(url); return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 }); }) as unknown as typeof fetch;
    const b = new AlpacaPaperBroker({ keyId: "k", secretKey: "s", baseUrl: "https://paper-api.alpaca.markets", fetchImpl: impl });
    expect(await b.getLastClose(["AAA", "ZZZ"], "2026-09-25")).toEqual({ AAA: 11, ZZZ: 20 });
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get("page_token")).toBeNull();
    expect(new URL(urls[1]).searchParams.get("page_token")).toBe("p2");
  });
  it("reads fractionability per asset", async () => {
    const { b } = mk({ "/v2/assets/NVT": { symbol: "NVT", fractionable: true, tradable: true } });
    expect(await b.isFractionable(["NVT"])).toEqual({ NVT: true });
  });
  it("surfaces HTTP errors with the body", async () => {
    const { b } = mk({});
    await expect(b.getAccount()).rejects.toThrow(/404/);
  });
});
