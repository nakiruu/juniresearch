import { describe, it, expect } from "vitest";
import { mapQuote } from "@/lib/facts/map/quote";
const DIR = "data/raw/AVGO/0001730168-26-000080";

describe("mapQuote on the AVGO capture", () => {
  const q = mapQuote(DIR);
  it("identifies the company from the tearsheet overview", () => {
    expect(q.company).toBe("Broadcom Inc.");
    expect(q.exchange).toBe("NASDAQ");
    expect(q.cik).toBe(1730168);
    expect(q.description.text.length).toBeGreaterThan(100);
    expect(q.description.source).toBe("bigdata:company_tearsheet");
  });
  it("carries the quote as raw numbers with the tearsheet's as-of date", () => {
    expect(q.quote.price).toBe(361.99);
    expect(q.quote.marketCap).toBeGreaterThan(1.7e12);
    expect(q.quote.week52High).toBe(495);
    expect(q.quote.week52Low).toBe(289.96);
    expect(q.quote.asOf).toBe("2026-09-11");
  });
  it("derives shares outstanding from market cap and price, within 5% of the fixture", () => {
    expect(Math.abs(q.quote.sharesOutstanding / 4.76e9 - 1)).toBeLessThan(0.05);
  });
  it("reads dividend yield as a ratio", () => {
    expect(q.quote.dividendYield).toBeGreaterThan(0.005);
    expect(q.quote.dividendYield).toBeLessThan(0.01);
  });
  it("throws naming the file when the tearsheet is empty", () => {
    expect(() => mapQuote("lib/facts/map/__fixtures__/empty")).toThrow(/bigdata-tearsheet-annual\.json/);
  });
});
