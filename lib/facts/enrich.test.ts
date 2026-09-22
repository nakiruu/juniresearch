import { describe, it, expect } from "vitest";
import { alignGoodwill, parsePeerMultiples } from "./enrich";

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
