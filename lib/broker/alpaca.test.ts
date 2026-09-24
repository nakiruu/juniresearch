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
  it("reads the settled close from daily bars with the iex feed", async () => {
    const { b, calls } = mk({ "/v2/stocks/bars": { bars: { NVT: [{ t: "2026-09-24T04:00:00Z", o: 1, h: 1, l: 1, c: 101.25, v: 1 }] }, next_page_token: null } });
    expect(await b.getLastClose(["NVT"], "2026-09-24")).toEqual({ NVT: 101.25 });
    expect(calls[0].url).toContain("data.alpaca.markets/v2/stocks/bars");
    expect(calls[0].url).toContain("timeframe=1Day");
    expect(calls[0].url).toContain("feed=iex");
    await expect(b.getLastClose(["ZZZ"], "2026-09-24")).rejects.toThrow(/no bar/);
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
