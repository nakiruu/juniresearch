import { describe, it, expect, afterEach } from "vitest";
import { GET } from "./route";

const prev = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k]; Object.assign(process.env, prev); });

describe("GET /api/trade/status", () => {
  it("503 when no token is configured", async () => {
    delete process.env.TRADE_STATUS_TOKEN;
    expect((await GET(new Request("http://x/api/trade/status"))).status).toBe(503);
  });
  it("401 on a wrong/absent bearer token", async () => {
    process.env.TRADE_STATUS_TOKEN = "sekret";
    expect((await GET(new Request("http://x/api/trade/status"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/trade/status", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });
  it("200 with the status shape on the right token", async () => {
    process.env.TRADE_STATUS_TOKEN = "sekret"; process.env.BROKER = "alpaca-paper";
    const res = await GET(new Request("http://x/api/trade/status", { headers: { authorization: "Bearer sekret" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("armed");
    expect(body.broker).toBe("alpaca-paper");
  });
});
