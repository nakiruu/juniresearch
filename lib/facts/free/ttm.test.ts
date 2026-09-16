import { describe, it, expect } from "vitest";
import { computeTtm } from "./ttm";
import type { SecPeriod } from "./sec";

const q = (over: Partial<SecPeriod>): SecPeriod => ({
  fiscal_period: "Q1", fiscal_year: 2026, report_date: "2026-03-31",
  revenue: 100, gross_profit: 80, operating_income: 40, ebitda: 50, net_income: 30, eps_diluted: 2,
  interest_expense: 5, cash_and_short_term_investments: 200, cash: 150, total_debt: 300, net_debt: 150,
  total_equity: 500, total_current_assets: 400, total_current_liabilities: 200,
  operating_cash_flow: 45, capex: -10, common_stock_repurchased: -5, common_dividends_paid: -8, free_cash_flow: 35,
  ...over,
});

describe("computeTtm", () => {
  const quarters = [
    q({ report_date: "2025-09-30" }), q({ report_date: "2025-12-31" }),
    q({ report_date: "2026-03-31" }), q({ report_date: "2026-06-30", net_debt: 150 }),
  ];
  const t = computeTtm(quarters, { price: 100, marketCap: 4000, dividendYield: 0.01 });

  it("sums the last four quarters for TTM margins and multiples", () => {
    expect(t.ratios.fiscal_period).toBe("TTM");
    expect(t.ratios.net_margin).toBeCloseTo(120 / 400, 6);     // Σnet 120 / Σrev 400
    expect(t.keyMetrics.price_to_sales).toBeCloseTo(4000 / 400, 6);
    expect(t.keyMetrics.pe_ratio).toBeCloseTo(100 / 8, 6);      // price / Σeps(8)
    expect(t.keyMetrics.ev_to_ebitda).toBeCloseTo((4000 + 150) / 200, 6); // (mktcap+netDebt)/Σebitda
  });

  it("uses the latest quarter for the current ratio and passes dividend yield through", () => {
    expect(t.ratios.current_ratio).toBeCloseTo(400 / 200, 6);
    expect(t.ratios.dividend_yield).toBe(0.01);
  });

  it("nulls both leverage metrics when the latest quarter's net_debt is null, rather than falling back to 0", () => {
    const quartersMissingNetDebt = [
      q({ report_date: "2025-09-30" }), q({ report_date: "2025-12-31" }), q({ report_date: "2026-03-31" }),
      q({ report_date: "2026-06-30", total_debt: null, net_debt: null }),
    ];
    const partial = computeTtm(quartersMissingNetDebt, { price: 100, marketCap: 4000, dividendYield: 0.01 });
    expect(partial.keyMetrics.ev_to_ebitda).toBeNull();
    expect(partial.ratios.net_debt_to_ebitda).toBeNull();
  });

  it("throws a clear error when fewer than four quarters are supplied", () => {
    const threeQuarters = [q({ report_date: "2025-09-30" }), q({ report_date: "2025-12-31" }), q({ report_date: "2026-03-31" })];
    expect(() => computeTtm(threeQuarters, { price: 100, marketCap: 4000, dividendYield: 0.01 })).toThrow(
      "computeTtm needs 4 quarters for a trailing-twelve-month period, got 3",
    );
  });

  it("nulls a summed TTM ratio when one of the four quarters is missing that flow field, instead of treating it as 0", () => {
    const quartersMissingRevenue = [
      q({ report_date: "2025-09-30", revenue: null }), q({ report_date: "2025-12-31" }),
      q({ report_date: "2026-03-31" }), q({ report_date: "2026-06-30", net_debt: 150 }),
    ];
    const partial = computeTtm(quartersMissingRevenue, { price: 100, marketCap: 4000, dividendYield: 0.01 });
    expect(partial.ratios.net_margin).toBeNull();
    expect(partial.keyMetrics.price_to_sales).toBeNull();
  });
});
