import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseQuoteSummary } from "./yahoo";

const raw = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-quotesummary.json", "utf8"));

describe("parseQuoteSummary", () => {
  const d = parseQuoteSummary(raw, { latestFY: 2025 });

  it("reads price, market cap, 52-week range and description", () => {
    expect(d.price).toBeGreaterThan(0);
    expect(d.marketCap).toBeGreaterThan(0);
    expect(d.week52High).toBeGreaterThan(d.week52Low);
    expect(d.description.length).toBeGreaterThan(20);
  });

  it("reads analyst targets and a rating breakdown that sums to at least one opinion", () => {
    expect(d.targets.consensus).toBeGreaterThan(0);
    expect(d.targets.high).toBeGreaterThanOrEqual(d.targets.low);
    const total = d.ratings.strong_buy + d.ratings.buy + d.ratings.hold + d.ratings.sell + d.ratings.strong_sell;
    expect(total).toBeGreaterThan(0);
    expect(d.ratings.consensus.length).toBeGreaterThan(0);
  });

  it("maps forward estimates to fiscal years latestFY+1 and beyond", () => {
    const next = d.estimates.find((e) => e.fiscal_year === 2026);
    expect(next).toBeDefined();
    expect(next!.sales === null || next!.sales! > 0).toBe(true);
    expect(next!.eps === null || Number.isFinite(next!.eps!)).toBe(true);
  });
});

describe("parseQuoteSummary required fields", () => {
  it("throws when the 52-week low/high is absent instead of defaulting to 0", () => {
    const clone = JSON.parse(JSON.stringify(raw));
    delete clone.quoteSummary.result[0].summaryDetail.fiftyTwoWeekLow;
    delete clone.quoteSummary.result[0].summaryDetail.fiftyTwoWeekHigh;
    expect(() => parseQuoteSummary(clone, { latestFY: 2025 })).toThrow();
  });

  it("throws when the description (assetProfile.longBusinessSummary) is absent instead of defaulting to empty string", () => {
    const clone = JSON.parse(JSON.stringify(raw));
    delete clone.quoteSummary.result[0].assetProfile.longBusinessSummary;
    expect(() => parseQuoteSummary(clone, { latestFY: 2025 })).toThrow();
  });
});
