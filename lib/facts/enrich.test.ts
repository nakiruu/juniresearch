import { describe, it, expect } from "vitest";
import { alignGoodwill, parsePeerMultiples, enrichPack } from "./enrich";

describe("alignGoodwill", () => {
  const usd = [
    { fy: 2022, val: 21_100_000_000, form: "10-K", fp: "FY" },
    { fy: 2023, val: 30_600_000_000, form: "10-K", fp: "FY" },
    { fy: 2023, val: 999, form: "10-Q", fp: "Q2" }, // ignored: not annual
    { fy: 2024, val: 30_600_000_000, form: "10-K", fp: "FY" },
  ];
  it("aligns annual (10-K/FY) goodwill to the pack's fiscal years, null where absent", () => {
    expect(alignGoodwill(usd, ["FY22", "FY23", "FY24", "FY25"])).toEqual([21_100_000_000, 30_600_000_000, 30_600_000_000, null]);
  });
  it("ignores non-annual entries", () => {
    expect(alignGoodwill(usd, ["FY23"])).toEqual([30_600_000_000]);
  });
});

describe("parsePeerMultiples", () => {
  it("reads trailing P/E, P/S and EV/EBITDA from a quoteSummary result", () => {
    const result = {
      summaryDetail: { trailingPE: { raw: 40.02 }, priceToSalesTrailing12Months: { raw: 11.95 } },
      defaultKeyStatistics: { enterpriseToEbitda: { raw: 36.09 } },
    };
    expect(parsePeerMultiples(result)).toEqual({ pe: 40.02, ps: 11.95, evToEbitda: 36.09 });
  });
  it("returns nulls for missing or non-numeric fields", () => {
    expect(parsePeerMultiples({})).toEqual({ pe: null, ps: null, evToEbitda: null });
    expect(parsePeerMultiples({ summaryDetail: { trailingPE: {} } })).toEqual({ pe: null, ps: null, evToEbitda: null });
  });
});

describe("enrichPack", () => {
  it("stamps goodwill, then sbc, then peer multiples (key order is what facts:enrich writes)", async () => {
    const annual = (val: number) => ({ units: { USD: [{ fy: 2025, val, form: "10-K", fp: "FY" }] } });
    const fetchImpl = (async (url: string) => {
      if (url.includes("/Goodwill.json")) return Response.json(annual(7));
      if (url.includes("/ShareBasedCompensation.json")) return Response.json(annual(3));
      if (url === "https://fc.yahoo.com") return new Response("", { headers: { "set-cookie": "A=1; path=/" } });
      if (url.includes("getcrumb")) return new Response("crumb");
      return Response.json({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 20 } } }] } });
    }) as typeof fetch;
    const pack = { cik: 1, statements: { fiscalYears: ["FY25"] }, peers: [{ ticker: "PEER", pe: null, ps: null, evToEbitda: null }] };
    const out = await enrichPack(pack, "test@example.com", fetchImpl);
    expect(Object.keys(out)).toEqual(["cik", "statements", "peers", "goodwill", "sbc"]);
    expect(out).toMatchObject({ goodwill: [7], sbc: [3], peers: [{ ticker: "PEER", pe: 20, ps: null, evToEbitda: null }] });
  });
});
