import { describe, it, expect } from "vitest";
import { alignGoodwill, parsePeerMultiples, enrichPack, secEvToEbitda, evToEbitdaNotMeaningful } from "./enrich";

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

describe("secEvToEbitda", () => {
  const q = (report_date: string, ebitda: number | null, net_debt: number | null = null) => ({ report_date, ebitda, net_debt });
  const quarters = [q("2025-09-30", 50), q("2025-12-31", 60), q("2026-03-31", 70), q("2026-06-30", 80, 300), q("2026-09-30", 999, 999)];
  it("is (capture market cap + latest net debt) / sum of the four quarters ending at the pack's latest quarter", () => {
    expect(secEvToEbitda(quarters, "2026-06-30", 2_300)).toBeCloseTo((2_300 + 300) / (50 + 60 + 70 + 80));
  });
  it("is null when the latest quarter is missing, a quarter's EBITDA or the net debt is missing, or TTM EBITDA is not positive", () => {
    expect(secEvToEbitda(quarters, "2026-05-31", 2_300)).toBeNull();
    expect(secEvToEbitda([q("2025-09-30", 50), q("2025-12-31", null), q("2026-03-31", 70), q("2026-06-30", 80, 300)], "2026-06-30", 2_300)).toBeNull();
    expect(secEvToEbitda([q("2025-09-30", 50), q("2025-12-31", 60), q("2026-03-31", 70), q("2026-06-30", 80)], "2026-06-30", 2_300)).toBeNull();
    expect(secEvToEbitda([q("2025-09-30", -50), q("2025-12-31", -60), q("2026-03-31", 70), q("2026-06-30", 10, 0)], "2026-06-30", 2_300)).toBeNull();
    expect(secEvToEbitda(quarters, "2026-06-30", null)).toBeNull();
  });
});

describe("evToEbitdaNotMeaningful", () => {
  it("is true for banks, lenders and insurers, false for exchanges, asset managers and non-financials", () => {
    for (const sic of [6021, 6022, 6035, 6141, 6199, 6311, 6331, 6411]) expect(evToEbitdaNotMeaningful(sic)).toBe(true);
    for (const sic of [6200, 6211, 6282, 6798, 3674, 7372, null, undefined]) expect(evToEbitdaNotMeaningful(sic)).toBe(false);
  });
});
