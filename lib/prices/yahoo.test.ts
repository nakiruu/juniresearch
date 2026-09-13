import { describe, it, expect } from "vitest";
import { yahooChartUrl, fetchDailyCloses } from "@/lib/prices/yahoo";

describe("yahooChartUrl", () => {
  it("builds a daily chart URL with an exclusive end", () => {
    const u = new URL(yahooChartUrl("AVGO", "2026-06-18", "2026-09-12"));
    expect(u.pathname).toBe("/v8/finance/chart/AVGO");
    expect(u.searchParams.get("interval")).toBe("1d");
    expect(Number(u.searchParams.get("period2")) - Number(u.searchParams.get("period1"))).toBe((86 + 1) * 86400);
  });
});

describe("fetchDailyCloses", () => {
  it("returns the body verbatim and sends a browser-like User-Agent", async () => {
    let ua = "";
    const fake = (async (_u: string, init: RequestInit) => { ua = (init.headers as Record<string, string>)["User-Agent"];
      return { ok: true, status: 200, text: async () => '{"chart":{"result":[]}}' }; }) as unknown as typeof fetch;
    expect(await fetchDailyCloses("AVGO", "2026-06-18", "2026-09-12", fake)).toBe('{"chart":{"result":[]}}');
    expect(ua).toMatch(/Mozilla/);
  });
  it("throws naming the URL on a non-200", async () => {
    const fake = (async () => ({ ok: false, status: 429, text: async () => "" })) as unknown as typeof fetch;
    await expect(fetchDailyCloses("AVGO", "2026-06-18", "2026-09-12", fake)).rejects.toThrow(/429.*chart\/AVGO/);
  });
});
