import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCompanyFacts, combineCapex, deriveTotalDebt, CAPEX_RAW, type SecPeriod } from "./sec";

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

// VST-shape: total operating revenue (Revenues) differs from customer-contract revenue, which excludes hedging.
describe("revenue prefers the income-statement total over customer-contract revenue", () => {
  const q = (start: string, end: string, val: number, filed: string) => ({ start, end, val, form: "10-Q", filed });
  const facts = {
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [q("2025-04-01", "2025-06-30", 4_250, "2025-08-07"), q("2026-04-01", "2026-06-30", 4_017, "2026-08-10")] } },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [q("2025-04-01", "2025-06-30", 3_753, "2025-08-07"), q("2026-04-01", "2026-06-30", 4_401, "2026-08-10")] },
        },
        NetIncomeLoss: { units: { USD: [q("2025-04-01", "2025-06-30", 100, "2025-08-07"), q("2026-04-01", "2026-06-30", 120, "2026-08-10")] } },
      },
    },
  };
  it("takes Revenues when both are tagged for the same quarter", () => {
    const { quarter } = parseCompanyFacts(facts);
    expect(quarter.find((p) => p.report_date === "2026-06-30")!.revenue).toBe(4_017);
    expect(quarter.find((p) => p.report_date === "2025-06-30")!.revenue).toBe(4_250);
  });
});

// BSX-shape: long-term debt tagged only as LongTermDebtAndCapitalLeaseObligations (noncurrent), current
// debt as DebtCurrent. Total debt must be both, not the current line alone.
describe("total debt from LongTermDebtAndCapitalLeaseObligations", () => {
  const fy = (val: number) => ({ start: "2025-01-01", end: "2025-12-31", val, form: "10-K", filed: "2026-02-17" });
  const inst = (val: number) => ({ end: "2025-12-31", val, form: "10-K", filed: "2026-02-17" });
  const facts = {
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [fy(20_074)] } },
        NetIncomeLoss: { units: { USD: [fy(2_898)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [inst(1_965)] } },
        LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(11_137)] } },
        DebtCurrent: { units: { USD: [inst(299)] } },
      },
    },
  };

  it("adds current debt to the noncurrent debt-and-lease line", () => {
    const { annual } = parseCompanyFacts(facts);
    const fy2025 = annual.find((p) => p.fiscal_year === 2025)!;
    expect(fy2025.total_debt).toBe(11_137 + 299);
    expect(fy2025.net_debt).toBe(11_137 + 299 - 1_965);
  });

  it("prefers LongTermDebt when it is tagged beside the debt-and-lease line (VST-shape)", () => {
    // VST 2025-12-31: LongTermDebt $17,043M (holds the current portion), noncurrent debt-and-lease $15,842M,
    // current portion tagged LongTermDebtAndCapitalLeaseObligationsCurrent $1,201M, short-term borrowings $1,800M.
    const vst = {
      facts: {
        "us-gaap": {
          Revenues: { units: { USD: [fy(17_586)] } },
          NetIncomeLoss: { units: { USD: [fy(944)] } },
          LongTermDebt: { units: { USD: [inst(17_043)] } },
          LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(15_842)] } },
          LongTermDebtAndCapitalLeaseObligationsCurrent: { units: { USD: [inst(1_201)] } },
          ShortTermBorrowings: { units: { USD: [inst(1_800)] } },
        },
      },
    };
    const fy2025 = parseCompanyFacts(vst).annual.find((p) => p.fiscal_year === 2025)!;
    expect(fy2025.total_debt).toBe(17_043 + 1_800);
  });
});

describe("deriveTotalDebt with the debt-and-lease line", () => {
  const none = {
    ltdNoncurrent: null, ltdTotal: null, ltdLeaseNoncurrent: null, ltdCurrent: null,
    debtCurrent: null, shortTermBorrowings: null, convertibleNoncurrent: null, convertibleCurrent: null,
  };
  it("uses it only after LongTermDebtNoncurrent and LongTermDebt", () => {
    expect(deriveTotalDebt({ ...none, ltdLeaseNoncurrent: 15_842, ltdCurrent: 1_201, shortTermBorrowings: 1_800 })).toBe(18_843);
    expect(deriveTotalDebt({ ...none, ltdTotal: 17_043, ltdLeaseNoncurrent: 15_842, ltdCurrent: 1_201, shortTermBorrowings: 1_800 })).toBe(18_843);
    expect(deriveTotalDebt({ ...none, ltdNoncurrent: 15_000, ltdLeaseNoncurrent: 15_842, debtCurrent: 500 })).toBe(15_500);
  });
});

// BWA-shape: cash tagged only as the cash-plus-restricted-cash total, interest only as InterestExpenseDebt.
describe("cash and interest fallbacks (restricted-cash total, InterestExpenseDebt)", () => {
  const fy = (val: number) => ({ start: "2025-01-01", end: "2025-12-31", val, form: "10-K", filed: "2026-02-11" });
  const inst = (val: number) => ({ end: "2025-12-31", val, form: "10-K", filed: "2026-02-11" });
  const base = {
    Revenues: { units: { USD: [fy(14_316)] } },
    NetIncomeLoss: { units: { USD: [fy(277)] } },
    LongTermDebtNoncurrent: { units: { USD: [inst(3_894)] } },
    LongTermDebtCurrent: { units: { USD: [inst(2)] } },
    CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents: { units: { USD: [inst(2_313)] } },
    InterestExpenseDebt: { units: { USD: [fy(100)] } },
  };

  it("reads cash and net debt from the restricted-cash total and interest from InterestExpenseDebt", () => {
    const fy2025 = parseCompanyFacts({ facts: { "us-gaap": base } }).annual.find((p) => p.fiscal_year === 2025)!;
    expect(fy2025.cash).toBe(2_313);
    expect(fy2025.net_debt).toBe(3_894 + 2 - 2_313);
    expect(fy2025.interest_expense).toBe(100);
  });

  it("prefers CashAndCashEquivalentsAtCarryingValue and InterestExpense when tagged", () => {
    const facts = {
      facts: {
        "us-gaap": {
          ...base,
          CashAndCashEquivalentsAtCarryingValue: { units: { USD: [inst(2_300)] } },
          InterestExpense: { units: { USD: [fy(110)] } },
        },
      },
    };
    const fy2025 = parseCompanyFacts(facts).annual.find((p) => p.fiscal_year === 2025)!;
    expect(fy2025.cash).toBe(2_300);
    expect(fy2025.interest_expense).toBe(110);
  });
});

// ADI-shape: a fiscal year that starts in the prior calendar year (FY2026 runs 2025-11-02 to
// 2026-10-31). Every YTD entry starts in 2025 and ends in 2026; a same-calendar-year guard dropped
// them all, so Q2/Q3 cash flow and D&A (and therefore EBITDA) came out null.
describe("YTD reconstruction for a fiscal year that starts in the prior calendar year", () => {
  const q = (start: string, end: string, val: number, filed: string) => ({ start, end, val, form: "10-Q", filed });
  const offCalendarFacts = {
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              q("2025-11-02", "2026-01-31", 3000, "2026-02-18"),
              q("2026-02-01", "2026-05-02", 3500, "2026-05-20"),
              q("2026-05-03", "2026-08-01", 4000, "2026-08-19"),
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              q("2025-11-02", "2026-01-31", 600, "2026-02-18"),
              q("2026-02-01", "2026-05-02", 700, "2026-05-20"),
              q("2026-05-03", "2026-08-01", 800, "2026-08-19"),
            ],
          },
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              q("2025-11-02", "2026-01-31", 1000, "2026-02-18"),
              q("2025-11-02", "2026-05-02", 2500, "2026-05-20"),
              q("2025-11-02", "2026-08-01", 4200, "2026-08-19"),
            ],
          },
        },
      },
    },
  };

  it("reconstructs Q2 and Q3 from YTD entries that start in the prior calendar year", () => {
    const { quarter } = parseCompanyFacts(offCalendarFacts);
    const byEnd = (end: string) => quarter.find((p) => p.report_date === end)!;
    expect(byEnd("2026-01-31").operating_cash_flow).toBe(1000);
    expect(byEnd("2026-05-02").operating_cash_flow).toBe(2500 - 1000);
    expect(byEnd("2026-08-01").operating_cash_flow).toBe(4200 - 2500);
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

// A bank (East West Bancorp) tags net interest income and noninterest income separately but no
// combined revenue concept: it never tags RevenuesNetOfInterestExpense or Revenues, and its only
// RevenueFromContractWithCustomer* line is a fee-only subset it stopped tagging in an earlier year.
// combineRevenue must then derive net revenue = net interest income + noninterest income so the
// FY/quarter rows anchor on live periods instead of going stale at the last fee-subset period.
describe("bank net-revenue derivation (no combined revenue concept)", () => {
  const bankFacts = {
    facts: {
      "us-gaap": {
        // Fee-only contract revenue: present ONLY for 2023, absent 2024+ (mirrors EWBC's stale tag).
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [{ start: "2023-01-01", end: "2023-12-31", val: 200, form: "10-K", filed: "2024-02-20" }],
          },
        },
        InterestIncomeExpenseNet: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-12-31", val: 2400, form: "10-K", filed: "2025-02-20" },
              { start: "2025-01-01", end: "2025-12-31", val: 2600, form: "10-K", filed: "2026-02-20" },
              { start: "2025-01-01", end: "2025-03-31", val: 640, form: "10-Q", filed: "2025-04-20" },
            ],
          },
        },
        NoninterestIncome: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-12-31", val: 380, form: "10-K", filed: "2025-02-20" },
              { start: "2025-01-01", end: "2025-12-31", val: 400, form: "10-K", filed: "2026-02-20" },
              { start: "2025-01-01", end: "2025-03-31", val: 100, form: "10-Q", filed: "2025-04-20" },
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-12-31", val: 900, form: "10-K", filed: "2025-02-20" },
              { start: "2025-01-01", end: "2025-12-31", val: 1000, form: "10-K", filed: "2026-02-20" },
              { start: "2025-01-01", end: "2025-03-31", val: 250, form: "10-Q", filed: "2025-04-20" },
            ],
          },
        },
      },
    },
  };

  it("derives FY net revenue as net interest income + noninterest income where no revenue concept covers the year", () => {
    const { annual } = parseCompanyFacts(bankFacts);
    const fy2025 = annual.find((p) => p.fiscal_year === 2025)!;
    expect(fy2025).toBeDefined();
    expect(fy2025.revenue).toBe(2600 + 400); // 3000, not stale at 2023's 200 fee subset
    const fy2024 = annual.find((p) => p.fiscal_year === 2024)!;
    expect(fy2024.revenue).toBe(2400 + 380); // 2780
  });

  it("anchors a live quarter row on the derived net revenue (no stale-quarter validation failure)", () => {
    const { quarter } = parseCompanyFacts(bankFacts);
    const q1 = quarter.find((p) => p.fiscal_year === 2025 && p.fiscal_period === "Q1")!;
    expect(q1).toBeDefined();
    expect(q1.revenue).toBe(640 + 100); // 740
  });

  it("keeps the primary revenue concept where it is tagged (fill-gaps-only)", () => {
    const { annual } = parseCompanyFacts(bankFacts);
    const fy2023 = annual.find((p) => p.fiscal_year === 2023);
    // 2023 has only the fee-subset concept (no NII/noninterest that year) -> primary value kept.
    expect(fy2023?.revenue).toBe(200);
  });
});

// A non-December fiscal year-end (here: late June, mirroring Lam Research) spreads a fiscal year's
// three reported quarters across TWO calendar years — Q1 ends in Sep, Q2 in Dec of the prior calendar
// year, Q3 in Mar of the next. The Q4 = FY − (Q1+Q2+Q3) derivation must group the composing quarters
// by the fiscal year they belong to (the three immediately preceding the annual period-end), not by
// their calendar year, or it never derives the final quarter — which is exactly the latest quarter
// when the primary filing is a 10-K.
describe("Q4 derivation for a non-December (June) fiscal year-end", () => {
  const juneFacts = {
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              // FY2026 annual (fiscal year ended 2026-06-28).
              { start: "2025-06-30", end: "2026-06-28", val: 2000, form: "10-K", filed: "2026-08-07" },
              // The three reported quarters of FY2026, straddling calendar 2025 and 2026.
              { start: "2025-06-30", end: "2025-09-28", val: 400, form: "10-Q", filed: "2025-10-24" }, // fiscal Q1
              { start: "2025-09-29", end: "2025-12-28", val: 500, form: "10-Q", filed: "2026-01-29" }, // fiscal Q2
              { start: "2025-12-29", end: "2026-03-29", val: 600, form: "10-Q", filed: "2026-04-23" }, // fiscal Q3
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              { start: "2025-06-30", end: "2026-06-28", val: 800, form: "10-K", filed: "2026-08-07" },
              { start: "2025-06-30", end: "2025-09-28", val: 150, form: "10-Q", filed: "2025-10-24" },
              { start: "2025-09-29", end: "2025-12-28", val: 200, form: "10-Q", filed: "2026-01-29" },
              { start: "2025-12-29", end: "2026-03-29", val: 250, form: "10-Q", filed: "2026-04-23" },
            ],
          },
        },
      },
    },
  };

  it("derives the final quarter as FY − (Q1+Q2+Q3), dated on the fiscal year-end", () => {
    const { quarter } = parseCompanyFacts(juneFacts);
    const last = quarter.at(-1)!;
    expect(last.report_date).toBe("2026-06-28"); // the fiscal Q4 / year-end quarter, not March
    expect(last.revenue).toBe(2000 - (400 + 500 + 600)); // 500
    expect(last.net_income).toBe(800 - (150 + 200 + 250)); // 200
  });
});

describe("net income from ProfitLoss (incl. NCI) fallback when NetIncomeLoss is untagged", () => {
  // A filer (Bloom Energy from FY2024) tags its net-income line as us-gaap:ProfitLoss
  // (net loss including noncontrolling interests) with no plain us-gaap:NetIncomeLoss.
  // Net income attributable to the parent = ProfitLoss − the NCI portion.
  const facts = {
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              { start: "2023-01-01", end: "2023-12-31", val: 1400, form: "10-K", filed: "2024-02-20" },
              { start: "2024-01-01", end: "2024-12-31", val: 1441, form: "10-K", filed: "2025-02-20" },
              { start: "2025-01-01", end: "2025-12-31", val: 2001, form: "10-K", filed: "2026-02-20" },
            ],
          },
        },
        // NetIncomeLoss (parent-attributable) present ONLY for 2023, absent 2024+.
        NetIncomeLoss: {
          units: { USD: [{ start: "2023-01-01", end: "2023-12-31", val: -302, form: "10-K", filed: "2024-02-20" }] },
        },
        ProfitLoss: {
          units: {
            USD: [
              { start: "2023-01-01", end: "2023-12-31", val: -999, form: "10-K", filed: "2024-02-20" }, // must be ignored (2023 has NetIncomeLoss)
              { start: "2024-01-01", end: "2024-12-31", val: -27, form: "10-K", filed: "2025-02-20" },
              { start: "2025-01-01", end: "2025-12-31", val: -87, form: "10-K", filed: "2026-02-20" },
            ],
          },
        },
        NetIncomeLossAttributableToNoncontrollingInterest: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-12-31", val: -2, form: "10-K", filed: "2025-02-20" },
              { start: "2025-01-01", end: "2025-12-31", val: -1, form: "10-K", filed: "2026-02-20" },
            ],
          },
        },
      },
    },
  };

  it("keeps parent-attributable NetIncomeLoss where tagged, and fills gaps with ProfitLoss minus NCI", () => {
    const { annual } = parseCompanyFacts(facts);
    const fy = (y: number) => annual.find((p) => p.fiscal_year === y)!;
    expect(fy(2023).net_income).toBe(-302);       // NetIncomeLoss kept (fill-gaps-only), NOT ProfitLoss(-999)
    expect(fy(2024).net_income).toBe(-27 - -2);   // ProfitLoss − NCI = -25
    expect(fy(2025).net_income).toBe(-87 - -1);   // -86
  });
});

describe("D&A from Depreciation + AmortizationOfIntangibleAssets when no combined D&A is tagged", () => {
  const y = (concept: string, rows: [string, number][]) => ({ [concept]: { units: { USD: rows.map(([yr, val]) => ({ start: `${yr}-01-01`, end: `${yr}-12-31`, val, form: "10-K", filed: `${Number(yr) + 1}-02-20` })) } } });
  const base = {
    ...y("Revenues", [["2024", 1000], ["2025", 1200]]),
    ...y("OperatingIncomeLoss", [["2024", 200], ["2025", 260]]),
    ...y("NetIncomeLoss", [["2024", 150], ["2025", 190]]),
  };
  it("sums the components, and prefers a combined D&A where one exists for the period", () => {
    const { annual } = parseCompanyFacts({ facts: { "us-gaap": {
      ...base,
      ...y("DepreciationDepletionAndAmortization", [["2024", 90]]),          // combined only for 2024
      ...y("Depreciation", [["2024", 999], ["2025", 40]]),
      ...y("AmortizationOfIntangibleAssets", [["2024", 999], ["2025", 25]]),
    } } });
    const fy = (yr: number) => annual.find((p) => p.fiscal_year === yr)!;
    expect(fy(2024).ebitda).toBe(200 + 90);        // combined concept wins where present
    expect(fy(2025).ebitda).toBe(260 + 40 + 25);   // depreciation + amortization of intangibles
  });
  it("leaves EBITDA empty for a period with depreciation but no amortization, when the filer tags amortization elsewhere", () => {
    const { annual } = parseCompanyFacts({ facts: { "us-gaap": {
      ...base,
      ...y("Depreciation", [["2024", 30], ["2025", 40]]),
      ...y("AmortizationOfIntangibleAssets", [["2024", 10]]),
    } } });
    expect(annual.find((p) => p.fiscal_year === 2024)!.ebitda).toBe(200 + 30 + 10);
    expect(annual.find((p) => p.fiscal_year === 2025)!.ebitda).toBeNull(); // not understated
  });
  it("uses depreciation alone for a filer that never tags intangible amortization", () => {
    const { annual } = parseCompanyFacts({ facts: { "us-gaap": { ...base, ...y("Depreciation", [["2025", 40]]) } } });
    expect(annual.find((p) => p.fiscal_year === 2025)!.ebitda).toBe(260 + 40);
  });
});

describe("combineCapex — PP&E capex plus separately tagged reinvestment", () => {
  const e = (val: number) => ({ end: "2025-12-31", val, form: "10-K", filed: "2026-02-01" });
  const m = (val?: number) => new Map(val == null ? [] : [[2025, e(val)]]);
  const base = (ppe?: number, allIn?: number, other?: number) => [m(ppe), m(allIn), m(other)];
  it("adds capitalized software and lease equipment to a PP&E base (FOUR-shape)", () => {
    expect(CAPEX_RAW[1]).toBe("PaymentsToAcquireProductiveAssets");
    expect(combineCapex(base(20), [m(5), m(), m(140)]).get(2025)?.val).toBe(165);
  });
  it("adds nothing when the base is the all-in productive-assets concept (V-shape)", () => {
    expect(combineCapex(base(undefined, 1482), [m(300)]).get(2025)?.val).toBe(1482);
  });
  it("still adds to the lowest-priority other-PP&E base (LLY-shape)", () => {
    expect(combineCapex(base(undefined, undefined, 50), [m(10)]).get(2025)?.val).toBe(60);
  });
  it("never turns extras alone into a capex figure", () => {
    expect(combineCapex(base(), [m(10)]).has(2025)).toBe(false);
  });
});

describe("deriveTotalDebt", () => {
  const none = {
    ltdNoncurrent: null,
    ltdTotal: null,
    ltdLeaseNoncurrent: null,
    ltdCurrent: null,
    debtCurrent: null,
    shortTermBorrowings: null,
    convertibleNoncurrent: null,
    convertibleCurrent: null,
  };

  it("adds all current debt (DebtCurrent, commercial paper included) to noncurrent long-term debt", () => {
    // CSCO FY2026 10-K: LongTermDebtNoncurrent $19,372M; DebtCurrent $10,161M (commercial paper +
    // $3,500M LongTermDebtCurrent). Preferring LongTermDebtCurrent dropped the commercial paper.
    expect(
      deriveTotalDebt({ ...none, ltdNoncurrent: 19_372e6, ltdTotal: 22_872e6, ltdCurrent: 3_500e6, debtCurrent: 10_161e6 }),
    ).toBe(29_533e6);
  });

  it("does not add the current portion on top of LongTermDebt when no noncurrent line is tagged", () => {
    // AEIS 2025-12-31: LongTermDebt $567.5M and LongTermDebtCurrent $567.5M are the same notes.
    expect(deriveTotalDebt({ ...none, ltdTotal: 567.5e6, ltdCurrent: 567.5e6 })).toBe(567.5e6);
  });

  it("adds non-long-term current debt to LongTermDebt", () => {
    expect(deriveTotalDebt({ ...none, ltdTotal: 1_000e6, ltdCurrent: 100e6, debtCurrent: 300e6 })).toBe(1_200e6);
    expect(deriveTotalDebt({ ...none, ltdTotal: 1_000e6, shortTermBorrowings: 50e6 })).toBe(1_050e6);
  });

  it("falls back to current debt alone, and is null when nothing is tagged", () => {
    expect(deriveTotalDebt({ ...none, ltdCurrent: 100e6, shortTermBorrowings: 50e6 })).toBe(150e6);
    expect(deriveTotalDebt(none)).toBeNull();
  });

  it("falls back to convertible notes when no long-term debt concept is tagged", () => {
    // NET 2025-12-31: ConvertibleDebtNoncurrent $1,974.1M + ConvertibleDebtCurrent $1,291.3M, nothing else.
    expect(deriveTotalDebt({ ...none, convertibleNoncurrent: 1_974.12e6, convertibleCurrent: 1_291.281e6 })).toBe(3_265.401e6);
    expect(deriveTotalDebt({ ...none, convertibleCurrent: 12.117e6 })).toBe(12.117e6);
    // DebtCurrent, when tagged, already holds the current convertibles.
    expect(deriveTotalDebt({ ...none, convertibleNoncurrent: 1_000e6, convertibleCurrent: 200e6, debtCurrent: 250e6 })).toBe(1_250e6);
  });

  it("ignores convertible concepts when a long-term debt concept reports the period", () => {
    expect(deriveTotalDebt({ ...none, ltdNoncurrent: 1_000e6, convertibleNoncurrent: 400e6, convertibleCurrent: 50e6 })).toBe(1_000e6);
    expect(deriveTotalDebt({ ...none, ltdTotal: 1_000e6, convertibleNoncurrent: 400e6 })).toBe(1_000e6);
  });
});
