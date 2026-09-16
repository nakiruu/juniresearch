import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCompanyFacts, type SecPeriod } from "./sec";

const facts = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", "utf8"));

describe("parseCompanyFacts", () => {
  const { annual, quarter } = parseCompanyFacts(facts);
  const fy = (y: number) => annual.find((p) => p.fiscal_year === y)!;

  it("selects annual FY rows by 10-K, ~1-year duration, keyed by period-end year", () => {
    const latest = annual.at(-1)!;
    expect(latest.fiscal_period).toBe("FY");
    expect(latest.report_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(latest.revenue).toBeGreaterThan(0);
    expect(latest.net_income).not.toBeNull();
  });

  it("derives EBITDA as operating income + D&A", () => {
    const p = annual.at(-1)!;
    // EBITDA must exceed operating income when D&A is positive
    expect(p.ebitda!).toBeGreaterThan(p.operating_income!);
  });

  it("derives total debt, net debt (debt − cash), and free cash flow (OCF + capex, capex negative)", () => {
    const p = annual.at(-1)!;
    expect(p.total_debt!).toBeGreaterThan(0);
    expect(p.net_debt!).toBe(p.total_debt! - p.cash!);
    expect(p.capex!).toBeLessThan(0);
    expect(p.free_cash_flow!).toBe(p.operating_cash_flow! + p.capex!);
  });

  it("total debt reflects the live current-debt concept, not a stale one that merely exists somewhere in the filing history", () => {
    const p = annual.at(-1)!;
    // FY2025: LongTermDebtCurrent (the design spec's primary current-debt concept) has had no
    // LLY data since 2013; DebtCurrent ($1,635.0M for FY2025) is what LLY tags today for
    // LongTermDebtNoncurrent ($40,868.0M) + DebtCurrent ($1,635.0M) = $42,503.0M. Concept
    // selection that commits to the first concept present *anywhere* in the filing history
    // (rather than resolving per period) would lock onto the stale LongTermDebtCurrent tag,
    // silently drop the current-debt portion, and understate total_debt by $1.635B.
    expect(p.total_debt).toBe(42_503_000_000);
  });

  it("emits quarterly income rows labelled Q1..Q4 with revenue and operating income", () => {
    expect(quarter.length).toBeGreaterThanOrEqual(4);
    const latest = quarter.at(-1)!;
    expect(latest.fiscal_period).toMatch(/^Q[1-4]$/);
    expect(latest.revenue).toBeGreaterThan(0);
    expect(latest.operating_income).not.toBeNull();
  });

  // LLY (like most 10-Q filers) tags cash-flow-statement concepts — operating cash flow,
  // capex, dividends, buybacks — and D&A year-to-date, not per discrete quarter: its Q2 10-Q
  // reports a 6-month cumulative NetCashProvidedByUsedInOperatingActivities, its Q3 10-Q a
  // 9-month cumulative figure. Only Q1 (YTD == discrete) and the FY (10-K) land inside the
  // existing ~90-day / ~365-day duration filters. Q2 and Q3 must be reconstructed by
  // differencing consecutive YTD entries.
  describe("YTD-tagged flow reconstruction (cash flow, D&A)", () => {
    const q1_2025 = quarter.find((p) => p.fiscal_year === 2025 && p.fiscal_period === "Q1")!;
    const q2_2025 = quarter.find((p) => p.fiscal_year === 2025 && p.fiscal_period === "Q2")!;
    const q3_2025 = quarter.find((p) => p.fiscal_year === 2025 && p.fiscal_period === "Q3")!;

    it("reconstructs Q2 operating_cash_flow as the 6-month YTD entry minus the Q1 entry", () => {
      // 6-month YTD (latest-filed, 2026-08-05 comparative): $4,753.0M; Q1 (latest-filed,
      // 2026-04-30 comparative): $1,666.0M. LLY never tags a discrete ~180-day-minus-90-day
      // Q2 figure for this concept, so this value only exists via differencing.
      expect(q1_2025.operating_cash_flow).toBe(1_666_000_000);
      expect(q2_2025.operating_cash_flow).toBe(4_753_000_000 - 1_666_000_000);
    });

    it("reconstructs Q3 operating_cash_flow as the 9-month YTD entry minus the 6-month YTD entry", () => {
      // 6-month YTD here uses the latest-filed value ($4,753.0M, the 2026-08-05 comparative),
      // same latest-filed-wins rule the file already applies to every other period lookup.
      expect(q3_2025.operating_cash_flow).toBe(13_588_400_000 - 4_753_000_000);
    });

    it("derives non-null, above-operating-income ebitda for a quarter whose D&A is only YTD-tagged", () => {
      // Before reconstruction, D&A for Q2/Q3 is null (its only tags are 180-/270-day YTD
      // entries, outside the ~90-day discrete-quarter filter), so ebitda = operating_income +
      // D&A is null too. Once D&A is recovered by differencing, ebitda must be non-null and
      // exceed operating income (D&A is positive).
      expect(q2_2025.ebitda).not.toBeNull();
      expect(q2_2025.ebitda!).toBeGreaterThan(q2_2025.operating_income!);
      expect(q3_2025.ebitda).not.toBeNull();
      expect(q3_2025.ebitda!).toBeGreaterThan(q3_2025.operating_income!);
    });

    it("leaves discretely-tagged income-statement flows (revenue, operating income) untouched by YTD differencing", () => {
      // Regression guard: revenue/operating_income are always tagged per discrete quarter, so
      // reconstruction must never fire for them — a doubled or halved value here would mean
      // the fix leaked into concepts that never needed it.
      expect(q2_2025.revenue).toBe(15_558_000_000);
      expect(q2_2025.operating_income).toBe(6_777_000_000 - -90_000_000);
    });
  });

  it("computes a non-null TTM EBITDA (and therefore EV/EBITDA-style ratios) once the trailing four quarters' D&A is fully reconstructed", () => {
    // Integration check mirroring the real bug: computeTtm sums the last four quarters and
    // nulls the sum if any single quarter is missing the field (see ttm.ts). Before this fix,
    // 2025Q3's ebitda was null (YTD-only D&A), which alone nulled the whole TTM sum.
    const last4 = [...quarter].sort((a, b) => (a.report_date < b.report_date ? -1 : 1)).slice(-4);
    expect(last4).toHaveLength(4);
    const ttmEbitda = last4.reduce<number | null>((acc, p) => (acc == null || p.ebitda == null ? null : acc + p.ebitda), 0);
    expect(ttmEbitda).not.toBeNull();
    expect(ttmEbitda!).toBeGreaterThan(0);
  });
});

// Regression for a review finding on the YTD-reconstruction fix above: the Q1/H1/9M bucket
// classification originally matched on DURATION ALONE (an 80-100 day entry -> "Q1", etc). A
// discrete Q3 entry is also ~90 days, so a filer that tags a discrete Q1 AND a discrete Q3 (both
// ~90d) plus a YTD H1 in the same fiscal year could have the later-filed ~90d entry win the "Q1"
// anchor slot — silently corrupting Q2's reconstruction (H1 - Q3 instead of H1 - Q1) with a
// wrong, non-null number. These use small synthetic companyfacts objects (not live LLY data) to
// isolate the collision from any real filer's incidental tagging pattern.
describe("YTD bucket anchoring (off-quarter ~90-day entries must not occupy the Q1 slot)", () => {
  const collisionFacts = {
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-03-31", val: 1000, form: "10-Q", filed: "2024-04-20" },
              { start: "2024-04-01", end: "2024-06-30", val: 1100, form: "10-Q", filed: "2024-07-20" },
              { start: "2024-07-01", end: "2024-09-30", val: 1200, form: "10-Q", filed: "2024-10-25" },
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-03-31", val: 50, form: "10-Q", filed: "2024-04-20" },
              { start: "2024-04-01", end: "2024-06-30", val: 60, form: "10-Q", filed: "2024-07-20" },
              { start: "2024-07-01", end: "2024-09-30", val: 70, form: "10-Q", filed: "2024-10-25" },
            ],
          },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              // True discrete Q1: ~90d, ends Mar 31, filed first.
              { start: "2024-01-01", end: "2024-03-31", val: 100, form: "10-Q", filed: "2024-04-20" },
              // Discrete Q3: ALSO ~90d (92 days) but ends Sep 30 — filed LATER than the true
              // Q1. Duration-only bucketing would let this win the "Q1" anchor slot.
              { start: "2024-07-01", end: "2024-09-30", val: 130, form: "10-Q", filed: "2024-10-25" },
              // YTD H1: ~180d, ends Jun 30. No discrete Q2 tag exists for this concept, so Q2
              // must come from differencing this against the correct Q1 anchor.
              { start: "2024-01-01", end: "2024-06-30", val: 250, form: "10-Q", filed: "2024-07-20" },
            ],
          },
        },
      },
    },
  };

  it("reconstructs Q2 as H1 minus the true Q1, not H1 minus the later-filed off-quarter Q3 entry", () => {
    const { quarter } = parseCompanyFacts(collisionFacts);
    const q2 = quarter.find((p) => p.fiscal_year === 2024 && p.fiscal_period === "Q2")!;
    expect(q2).toBeDefined();
    expect(q2.operating_cash_flow).toBe(250 - 100); // correct: H1(250) − Q1(100) = 150
    expect(q2.operating_cash_flow).not.toBe(250 - 130); // must NOT be H1 − Q3(130) = 120
  });
});

// The review also flagged that "a discrete tag always wins over a reconstructed value" (the
// merge in quarterFlowWithYtdFallback) was never exercised with a case where the two actually
// differ — a bug there would be invisible as long as the reconstructed and discrete values
// happened to agree.
describe("discrete tag wins over YTD reconstruction when both exist for the same quarter", () => {
  const bothTaggedFacts = {
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-03-31", val: 1000, form: "10-Q", filed: "2024-04-20" },
              { start: "2024-04-01", end: "2024-06-30", val: 1100, form: "10-Q", filed: "2024-07-20" },
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-03-31", val: 50, form: "10-Q", filed: "2024-04-20" },
              { start: "2024-04-01", end: "2024-06-30", val: 60, form: "10-Q", filed: "2024-07-20" },
            ],
          },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-03-31", val: 100, form: "10-Q", filed: "2024-04-20" }, // discrete Q1
              { start: "2024-01-01", end: "2024-06-30", val: 250, form: "10-Q", filed: "2024-07-20" }, // YTD H1 -> would reconstruct Q2 as 150
              { start: "2024-04-01", end: "2024-06-30", val: 999, form: "10-Q", filed: "2024-07-20" }, // genuine discrete Q2, deliberately != 150
            ],
          },
        },
      },
    },
  };

  it("uses the genuine discrete Q2 tag (999), not the YTD-reconstructed value (150)", () => {
    const { quarter } = parseCompanyFacts(bothTaggedFacts);
    const q2 = quarter.find((p) => p.fiscal_year === 2024 && p.fiscal_period === "Q2")!;
    expect(q2).toBeDefined();
    expect(q2.operating_cash_flow).toBe(999);
    expect(q2.operating_cash_flow).not.toBe(250 - 100);
  });
});
