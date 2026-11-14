import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseQuoteSummary } from "./yahoo";
import { fiscalYearLabel } from "./sec";

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

// A January year (CHWY shape): Yahoo dates each annual estimate by the year's end. The estimate must attach to the
// year the statements call latestFY + 1, on the same label rule, whatever the year offset.
describe("parseQuoteSummary estimate years follow the statement label rule", () => {
  const chwy = (() => {
    const clone = JSON.parse(JSON.stringify(raw));
    clone.quoteSummary.result[0].earningsTrend.trend = [
      { period: "0q", endDate: "2026-11-01", revenueEstimate: { avg: { raw: 3_000 } }, earningsEstimate: { avg: { raw: 0.1 } } },
      { period: "0y", endDate: "2027-01-31", revenueEstimate: { avg: { raw: 13_500 } }, earningsEstimate: { avg: { raw: 1.1 } } },
      { period: "+1y", endDate: "2028-01-30", revenueEstimate: { avg: { raw: 14_300 } }, earningsEstimate: { avg: { raw: 1.4 } } },
    ];
    return clone;
  })();
  it("with no offset, the year ending January 2027 is fiscal 2027", () => {
    const d = parseQuoteSummary(chwy, { latestFY: 2026 });
    expect(d.estimates.map((e) => [e.fiscal_year, e.sales, e.endDate])).toEqual([[2027, 13_500, "2027-01-31"], [2028, 14_300, "2028-01-30"]]);
  });
  it("with a −1 offset, the same year is fiscal 2026 and still the year after the latest fiscal 2025", () => {
    const d = parseQuoteSummary(chwy, { latestFY: 2025, yearLabelOf: (end) => fiscalYearLabel(end, { yearOffset: -1 }) });
    expect(d.estimates.map((e) => [e.fiscal_year, e.sales])).toEqual([[2026, 13_500], [2027, 14_300]]);
  });
  it("a 52/53-week year ending in early January belongs to the year before (USFD)", () => {
    const clone = JSON.parse(JSON.stringify(chwy));
    clone.quoteSummary.result[0].earningsTrend.trend[1].endDate = "2027-01-02";
    clone.quoteSummary.result[0].earningsTrend.trend[2].endDate = "2027-12-31";
    const d = parseQuoteSummary(clone, { latestFY: 2025 });
    expect(d.estimates.map((e) => [e.fiscal_year, e.sales])).toEqual([[2026, 13_500], [2027, 14_300]]);
  });
});
