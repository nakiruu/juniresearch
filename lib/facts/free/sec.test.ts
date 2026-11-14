import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCompanyFacts, combineCapex, deriveTotalDebt, fiscalPeriodOf, fiscalYearKey, fiscalYearLabel, fiscalYearSpans, CAPEX_RAW, type FiscalYearSpan, type SecPeriod } from "./sec";
import { computeTtm } from "./ttm";

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
    ltdLeaseTotal: null, combinedTotal: null, unsecuredLtd: null,
  };
  const lt = { filerTagsLongTerm: true };
  it("uses it only after LongTermDebtNoncurrent and LongTermDebt", () => {
    expect(deriveTotalDebt({ ...none, ltdLeaseNoncurrent: 15_842, ltdCurrent: 1_201, shortTermBorrowings: 1_800 }, lt)).toBe(18_843);
    expect(deriveTotalDebt({ ...none, ltdTotal: 17_043, ltdLeaseNoncurrent: 15_842, ltdCurrent: 1_201, shortTermBorrowings: 1_800 }, lt)).toBe(18_843);
    expect(deriveTotalDebt({ ...none, ltdNoncurrent: 15_000, ltdLeaseNoncurrent: 15_842, debtCurrent: 500 }, lt)).toBe(15_500);
  });
});

// Audit 2026-10-06 (D-1) and review F-1/F-2/F-4: filers that tag total debt under concepts no list held, two that
// were OVERSTATED by a double-add, and the zero-vs-gap rule. Values in $M from the captured filings' inline XBRL
// (data/raw/<T>/<ACC>/edgar-10k-primary.html); every expectation is the balance-sheet total debt the 10-K prints,
// or — where a balance-sheet line sits under a concept no list holds — the total of the concepts read, with the
// unlisted line named.
describe("total debt — concepts and rules added 2026-10-07 (D-1)", () => {
  const fy = (val: number) => ({ start: "2025-01-01", end: "2025-12-31", val, form: "10-K", filed: "2026-02-20" });
  const inst = (val: number, end = "2025-12-31") => ({ end, val, form: "10-K", filed: "2026-02-20" });
  const base = { Revenues: { units: { USD: [fy(1_000)] } }, NetIncomeLoss: { units: { USD: [fy(100)] } } };
  const fy2025 = (gaap: Record<string, unknown>) =>
    parseCompanyFacts({ facts: { "us-gaap": { ...base, ...gaap } } }).annual.find((p) => p.fiscal_year === 2025)!;

  it("CVX-10-K-shape: the noncurrent lease line equals the including-current line → all-in; add short-term borrowings only, never DebtCurrent", () => {
    // CVX FY2025 10-K (captured as edgar-10k-primary.html under the Q2'26 10-Q 0000093410-26-000167): balance sheet
    // "Short-term debt 977" + "Long-term debt 39,781".
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(39_781)] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(39_781)] } },
      DebtCurrent: { units: { USD: [inst(10_918)] } }, // note subtotal before the $9,941M reclassification — must NOT be added
      LongTermDebtCurrent: { units: { USD: [inst(2_345)] } },
      CommercialPaper: { units: { USD: [inst(4_642)] } }, // inside the lease line; ShortTermBorrowings outranks it per period
      ShortTermBorrowings: { units: { USD: [inst(977)] } },
      ShortTermBankLoansAndNotesPayable: { units: { USD: [inst(96)] } }, // a note component of the 977; outranked per period
    });
    expect(p.total_debt).toBe(40_758);
  });

  it("CVX FY2024 column: the same rule with that year's values (20,135 = 20,135; short-term 4,406)", () => {
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 900, form: "10-K", filed: "2025-02-20" }] } },
      NetIncomeLoss: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 90, form: "10-K", filed: "2025-02-20" }] } },
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(20_135, "2024-12-31")] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(20_135, "2024-12-31")] } },
      DebtCurrent: { units: { USD: [inst(12_656, "2024-12-31")] } },
      LongTermDebtCurrent: { units: { USD: [inst(4_012, "2024-12-31")] } },
      CommercialPaper: { units: { USD: [inst(5_386, "2024-12-31")] } },
      ShortTermBorrowings: { units: { USD: [inst(4_406, "2024-12-31")] } },
    } } };
    expect(parseCompanyFacts(facts).annual.find((p) => p.fiscal_year === 2024)!.total_debt).toBe(24_541);
  });

  it("SCHW-shape (held): the same equal-value pattern, 22,199 = 22,199, + other short-term borrowings + FHLB advances", () => {
    // SCHW FY2025 10-K (captured under 0000316709-26-000031) balance sheet: Other short-term borrowings 6,913 + Federal
    // Home Loan Bank borrowings 1,850 (us-gaap:AdvancesFromFederalHomeLoanBanks, its own face line) + Long-term debt
    // 22,199 = 30,962. The $1.9B commercial paper is a note figure INSIDE other short-term borrowings ("other short-term
    // borrowings (e.g., commercial paper, …)"), so it is not added on top.
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(22_199)] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(22_199)] } },
      OtherShortTermBorrowings: { units: { USD: [inst(6_913)] } },
      CommercialPaper: { units: { USD: [inst(1_900)] } },
      AdvancesFromFederalHomeLoanBanks: { units: { USD: [inst(1_850)] } },
    });
    expect(p.total_debt).toBe(30_962);
  });

  it("SCHW FY2024 column: 5,999 + 16,700 FHLB + 22,428 = 45,127", () => {
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 900, form: "10-K", filed: "2025-02-20" }] } },
      NetIncomeLoss: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 90, form: "10-K", filed: "2025-02-20" }] } },
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(22_428, "2024-12-31")] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(22_428, "2024-12-31")] } },
      OtherShortTermBorrowings: { units: { USD: [inst(5_999, "2024-12-31")] } },
      AdvancesFromFederalHomeLoanBanks: { units: { USD: [inst(16_700, "2024-12-31")] } },
    } } };
    expect(parseCompanyFacts(facts).annual.find((p) => p.fiscal_year === 2024)!.total_debt).toBe(45_127);
  });

  it("SCHW FY2022 column: ShortTermBorrowings 17,050 already holds the FHLB advances; they are not added again (37,878)", () => {
    // SCHW's FY2022 10-K (0000316709-23-000009) tags "Short-term borrowings" 17,050; its FY2023 10-K (0000316709-24-000018)
    // recasts the same column as OtherShortTermBorrowings 4,650 + AdvancesFromFederalHomeLoanBanks 12,400 (= 17,050).
    // Total debt is 17,050 + 20,828 = 37,878, not 17,050 + 12,400 + 20,828 = 50,278.
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [{ start: "2022-01-01", end: "2022-12-31", val: 900, form: "10-K", filed: "2023-02-23" }] } },
      NetIncomeLoss: { units: { USD: [{ start: "2022-01-01", end: "2022-12-31", val: 90, form: "10-K", filed: "2023-02-23" }] } },
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(20_828, "2022-12-31")] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(20_828, "2022-12-31")] } },
      ShortTermBorrowings: { units: { USD: [inst(17_050, "2022-12-31")] } },
      OtherShortTermBorrowings: { units: { USD: [inst(4_650, "2022-12-31")] } },
      CommercialPaper: { units: { USD: [inst(250, "2022-12-31")] } },
      AdvancesFromFederalHomeLoanBanks: { units: { USD: [inst(12_400, "2022-12-31")] } },
    } } };
    expect(parseCompanyFacts(facts).annual.find((p) => p.fiscal_year === 2022)!.total_debt).toBe(37_878);
  });

  it("FHLB advances are never added on a LongTermDebt / DebtCurrent path (a bank's borrowings total there can hold them)", () => {
    // CFG-style: LongTermDebt is the long-term borrowings total; an FHLB note figure beside it must not be re-added.
    expect(fy2025({
      LongTermDebt: { units: { USD: [inst(11_224)] } },
      ShortTermBorrowings: { units: { USD: [inst(58)] } },
      AdvancesFromFederalHomeLoanBanks: { units: { USD: [inst(500)] } },
    }).total_debt).toBe(11_282);
    // A lease-line filer that tags DebtCurrent (all current debt, short-term FHLB advances included) gets no add either.
    expect(fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(1_000)] } },
      DebtCurrent: { units: { USD: [inst(300)] } },
      AdvancesFromFederalHomeLoanBanks: { units: { USD: [inst(200)] } },
    }).total_debt).toBe(1_300);
    // FHLB advances alone are not a total-debt figure.
    expect(fy2025({ AdvancesFromFederalHomeLoanBanks: { units: { USD: [inst(200)] } } }).total_debt).toBeNull();
  });

  it("DOW-shape: notes payable (ShortTermBankLoansAndNotesPayable) is a short-term line — 17,849 + 222 + 90 = 18,161", () => {
    // DOW FY2025 10-K (captured under 0001751788-26-000147): "Notes payable 90; Long-term debt due within one year 222;
    // Long-term debt 17,849; Gross debt 18,161" (FY2024: 135 + 497 + 15,711 = 16,343).
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(17_849)] } },
      LongTermDebtAndCapitalLeaseObligationsCurrent: { units: { USD: [inst(222)] } },
      ShortTermBankLoansAndNotesPayable: { units: { USD: [inst(90)] } },
    });
    expect(p.total_debt).toBe(18_161);
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 900, form: "10-K", filed: "2025-02-20" }] } },
      NetIncomeLoss: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 90, form: "10-K", filed: "2025-02-20" }] } },
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(15_711, "2024-12-31")] } },
      LongTermDebtAndCapitalLeaseObligationsCurrent: { units: { USD: [inst(497, "2024-12-31")] } },
      ShortTermBankLoansAndNotesPayable: { units: { USD: [inst(135, "2024-12-31")] } },
    } } };
    expect(parseCompanyFacts(facts).annual.find((p) => p.fiscal_year === 2024)!.total_debt).toBe(16_343);
  });

  it("RTX-shape: the including-current line DIFFERS from the noncurrent lease line, so the noncurrent line + all current debt is used", () => {
    // RTX FY2025 10-K (0000101829-26-000027): LongTermDebtAndCapitalLeaseObligations 34,288; …IncludingCurrentMaturities
    // 37,700; …Current 3,412; ShortTermBorrowings 204. Balance sheet: 34,288 + 3,412 + 204 = 37,904.
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(34_288)] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(37_700)] } },
      LongTermDebtAndCapitalLeaseObligationsCurrent: { units: { USD: [inst(3_412)] } },
      ShortTermBorrowings: { units: { USD: [inst(204)] } },
      OtherLongTermDebt: { units: { USD: [inst(146)] } }, // a note component, unread
    });
    expect(p.total_debt).toBe(37_904);
  });

  it("GE-shape: DebtLongtermAndShorttermCombinedAmount is the whole figure (nothing added)", () => {
    const p = fy2025({
      DebtLongtermAndShorttermCombinedAmount: { units: { USD: [inst(20_494)] } },
      ShortTermBorrowings: { units: { USD: [inst(1_000)] } }, // already inside the combined amount
    });
    expect(p.total_debt).toBe(20_494);
  });

  it("TMO-shape: the two face lines (noncurrent debt-and-lease + DebtCurrent) are the balance-sheet total; LongTermDebt is not re-added", () => {
    // TMO FY2025 10-K (0000097745-26-000144) balance sheet: "Short-term obligations and current maturities of long-term
    // obligations 3,533" + "Long-term obligations 35,852" = 39,385. The note's LongTermDebt 39,172 already includes the
    // current maturities and excludes the $213M finance leases; the pack captured on the pre-2026-10-06 code read
    // 39,172 + 3,533 = 42,705. TMO tags no LongTermDebtCurrent or ShortTermBorrowings.
    const p = fy2025({
      LongTermDebt: { units: { USD: [inst(39_172)] } },
      DebtCurrent: { units: { USD: [inst(3_533)] } },
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(35_852)] } },
      DebtInstrumentCarryingAmount: { units: { USD: [inst(39_459)] } }, // note-level, unread
    });
    expect(p.total_debt).toBe(39_385);
  });

  it("GE-shape (10-K): every path agrees with the combined amount; nothing is double-added", () => {
    // GE FY2025 10-K (0000040545-26-000049): LongTermDebt 20,469; DebtCurrent 1,686; LongTermDebtAndCapitalLeaseObligations
    // 18,808; ShortTermBorrowings 25; DebtLongtermAndShorttermCombinedAmount 20,494 (= 18,808 + 1,686). The pack captured
    // on the pre-2026-10-06 code read LongTermDebt as a noncurrent line: 20,469 + 1,686 + 25 = 22,180.
    const p = fy2025({
      LongTermDebt: { units: { USD: [inst(20_469)] } },
      DebtCurrent: { units: { USD: [inst(1_686)] } },
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(18_808)] } },
      ShortTermBorrowings: { units: { USD: [inst(25)] } },
      DebtLongtermAndShorttermCombinedAmount: { units: { USD: [inst(20_494)] } },
    });
    expect(p.total_debt).toBe(20_494);
  });

  it("CME-shape: UnsecuredLongTermDebt + a zero LongTermDebtCurrent", () => {
    const p = fy2025({
      UnsecuredLongTermDebt: { units: { USD: [inst(3_422)] } },
      LongTermDebtCurrent: { units: { USD: [inst(0)] } },
    });
    expect(p.total_debt).toBe(3_422);
  });

  it("gap-shape: a zero current-only period is null when the filer tags a long-term concept in another period", () => {
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [fy(1_000), { start: "2024-01-01", end: "2024-12-31", val: 900, form: "10-K", filed: "2025-02-20" }] } },
      NetIncomeLoss: { units: { USD: [fy(100), { start: "2024-01-01", end: "2024-12-31", val: 90, form: "10-K", filed: "2025-02-20" }] } },
      LongTermDebtNoncurrent: { units: { USD: [inst(500)] } }, // FY2025 only
      LongTermDebtCurrent: { units: { USD: [inst(0, "2024-12-31"), inst(0)] } }, // both years
    } } };
    const { annual } = parseCompanyFacts(facts);
    expect(annual.find((p) => p.fiscal_year === 2024)!.total_debt).toBeNull(); // a gap, not a zero
    expect(annual.find((p) => p.fiscal_year === 2025)!.total_debt).toBe(500);
  });

  it("DSP-shape: a filer that never tags a long-term concept keeps its honest zero (DSP FY22–FY25, PLTR, RDVT, LASR, AMSC)", () => {
    const p = fy2025({
      LongTermDebtCurrent: { units: { USD: [inst(0)] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [inst(250)] } },
    });
    expect(p.total_debt).toBe(0);
    expect(p.net_debt).toBe(-250);
  });

  it("existing shapes are unchanged: BSX, VST, AEIS, CSCO, NET", () => {
    const none = {
      ltdNoncurrent: null, ltdTotal: null, ltdLeaseNoncurrent: null, ltdCurrent: null, debtCurrent: null,
      shortTermBorrowings: null, convertibleNoncurrent: null, convertibleCurrent: null,
      ltdLeaseTotal: null, combinedTotal: null, unsecuredLtd: null,
    };
    const lt = { filerTagsLongTerm: true };
    expect(deriveTotalDebt({ ...none, ltdLeaseNoncurrent: 11_137, debtCurrent: 299 }, lt)).toBe(11_436); // BSX
    expect(deriveTotalDebt({ ...none, ltdTotal: 17_043, ltdLeaseNoncurrent: 15_842, ltdCurrent: 1_201, shortTermBorrowings: 1_800 }, lt)).toBe(18_843); // VST
    expect(deriveTotalDebt({ ...none, ltdTotal: 567.5, ltdCurrent: 567.5 }, lt)).toBe(567.5); // AEIS
    expect(deriveTotalDebt({ ...none, ltdNoncurrent: 19_372, ltdTotal: 22_872, ltdCurrent: 3_500, debtCurrent: 10_161 }, lt)).toBe(29_533); // CSCO
    expect(deriveTotalDebt({ ...none, convertibleNoncurrent: 1_974.12, convertibleCurrent: 1_291.281 }, lt)).toBe(3_265.401); // NET
    expect(deriveTotalDebt({ ...none, ltdCurrent: 100, shortTermBorrowings: 50 }, lt)).toBe(150); // non-zero current-only stays
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, lt)).toBeNull(); // zero current-only in a filer with long-term tags → gap
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, { filerTagsLongTerm: false })).toBe(0); // honest zero
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
    ltdLeaseTotal: null,
    combinedTotal: null,
    unsecuredLtd: null,
  };
  const lt = { filerTagsLongTerm: true };

  it("adds all current debt (DebtCurrent, commercial paper included) to noncurrent long-term debt", () => {
    // CSCO FY2026 10-K: LongTermDebtNoncurrent $19,372M; DebtCurrent $10,161M (commercial paper +
    // $3,500M LongTermDebtCurrent). Preferring LongTermDebtCurrent dropped the commercial paper.
    expect(
      deriveTotalDebt({ ...none, ltdNoncurrent: 19_372e6, ltdTotal: 22_872e6, ltdCurrent: 3_500e6, debtCurrent: 10_161e6 }, lt),
    ).toBe(29_533e6);
  });

  it("does not add the current portion on top of LongTermDebt when no noncurrent line is tagged", () => {
    // AEIS 2025-12-31: LongTermDebt $567.5M and LongTermDebtCurrent $567.5M are the same notes.
    expect(deriveTotalDebt({ ...none, ltdTotal: 567.5e6, ltdCurrent: 567.5e6 }, lt)).toBe(567.5e6);
  });

  it("adds non-long-term current debt to LongTermDebt", () => {
    expect(deriveTotalDebt({ ...none, ltdTotal: 1_000e6, ltdCurrent: 100e6, debtCurrent: 300e6 }, lt)).toBe(1_200e6);
    expect(deriveTotalDebt({ ...none, ltdTotal: 1_000e6, shortTermBorrowings: 50e6 }, lt)).toBe(1_050e6);
  });

  it("falls back to current debt alone; a zero current-only figure is null in a filer with long-term tags elsewhere, 0 otherwise", () => {
    const noLt = { filerTagsLongTerm: false };
    expect(deriveTotalDebt({ ...none, ltdCurrent: 100e6, shortTermBorrowings: 50e6 }, lt)).toBe(150e6);
    expect(deriveTotalDebt(none, lt)).toBeNull();
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, lt)).toBeNull(); // gap (CME FY2023 before UnsecuredLongTermDebt)
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0, shortTermBorrowings: 0 }, lt)).toBeNull();
    expect(deriveTotalDebt({ ...none, debtCurrent: 0 }, lt)).toBeNull();
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, noLt)).toBe(0); // honest zero (DSP-shape)
    expect(deriveTotalDebt({ ...none, debtCurrent: 0 }, noLt)).toBe(0);
    expect(deriveTotalDebt(none, noLt)).toBeNull(); // nothing tagged is still null, not 0
  });

  it("falls back to convertible notes when no long-term debt concept is tagged", () => {
    // NET 2025-12-31: ConvertibleDebtNoncurrent $1,974.1M + ConvertibleDebtCurrent $1,291.3M, nothing else.
    expect(deriveTotalDebt({ ...none, convertibleNoncurrent: 1_974.12e6, convertibleCurrent: 1_291.281e6 }, lt)).toBe(3_265.401e6);
    expect(deriveTotalDebt({ ...none, convertibleCurrent: 12.117e6 }, lt)).toBe(12.117e6);
    // DebtCurrent, when tagged, already holds the current convertibles.
    expect(deriveTotalDebt({ ...none, convertibleNoncurrent: 1_000e6, convertibleCurrent: 200e6, debtCurrent: 250e6 }, lt)).toBe(1_250e6);
  });

  it("ignores convertible concepts when a long-term debt concept reports the period", () => {
    expect(deriveTotalDebt({ ...none, ltdNoncurrent: 1_000e6, convertibleNoncurrent: 400e6, convertibleCurrent: 50e6 }, lt)).toBe(1_000e6);
    expect(deriveTotalDebt({ ...none, ltdTotal: 1_000e6, convertibleNoncurrent: 400e6 }, lt)).toBe(1_000e6);
  });
});

// DOW (0001751788-26-000147): every capex period through Q1'26 is tagged twice at the same value, as
// PaymentsToAcquireProductiveAssets and PaymentsToAcquireMachineryAndEquipment; the Q2'26 10-Q tags capex only as
// PaymentsToAcquireMachineryAndEquipment, so the June quarter's capex — and the whole TTM FCF — read null.
// Values in $M from the saved companyfacts and the 10-Q iXBRL; TTM to 2026-06-30: OCF 3,866, capex 2,267, FCF 1,599.
describe("capex — PaymentsToAcquireMachineryAndEquipment is the lowest-priority base (DOW, 2026-10-07)", () => {
  const d = (start: string, end: string, val: number, form: "10-Q" | "10-K", filed: string) => ({ start, end, val, form, filed });
  const Q1_25 = "2025-04-25", Q2_25 = "2025-07-25", Q3_25 = "2025-10-24", K25 = "2026-02-06", Q1_26 = "2026-04-24", Q2_26 = "2026-07-24";
  const capexYtd = [
    d("2025-01-01", "2025-03-31", 685, "10-Q", Q1_25), d("2025-01-01", "2025-06-30", 1_347, "10-Q", Q2_25),
    d("2025-01-01", "2025-09-30", 1_911, "10-Q", Q3_25), d("2025-01-01", "2025-12-31", 2_479, "10-K", K25),
    d("2026-01-01", "2026-03-31", 503, "10-Q", Q1_26),
  ];
  const qRev = (start: string, end: string, filed: string) => d(start, end, 10_000, "10-Q", filed);
  const dowFacts = { facts: { "us-gaap": {
    Revenues: { units: { USD: [
      qRev("2025-01-01", "2025-03-31", Q1_25), qRev("2025-04-01", "2025-06-30", Q2_25), qRev("2025-07-01", "2025-09-30", Q3_25),
      d("2025-01-01", "2025-12-31", 40_000, "10-K", K25), qRev("2026-01-01", "2026-03-31", Q1_26), qRev("2026-04-01", "2026-06-30", Q2_26),
    ] } },
    NetIncomeLoss: { units: { USD: [d("2025-01-01", "2025-12-31", -1_000, "10-K", K25)] } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
      d("2025-01-01", "2025-03-31", 91, "10-Q", Q1_25), d("2025-01-01", "2025-06-30", -379, "10-Q", Q2_25),
      d("2025-01-01", "2025-09-30", 748, "10-Q", Q3_25), d("2025-01-01", "2025-12-31", 1_032, "10-K", K25),
      d("2026-01-01", "2026-03-31", 1_124, "10-Q", Q1_26), d("2026-01-01", "2026-06-30", 2_455, "10-Q", Q2_26),
    ] } },
    PaymentsToAcquireProductiveAssets: { units: { USD: capexYtd } },
    PaymentsToAcquireMachineryAndEquipment: { units: { USD: [
      ...capexYtd, d("2026-01-01", "2026-06-30", 1_135, "10-Q", Q2_26), d("2026-04-01", "2026-06-30", 632, "10-Q", Q2_26),
    ] } },
  } } };

  it("fills the June-2026 quarter only MachineryAndEquipment tags, so TTM FCF reads 3,866 − 2,267 = 1,599", () => {
    const { quarter } = parseCompanyFacts(dowFacts);
    const last4 = quarter.slice(-4);
    expect(last4.map((q) => q.report_date)).toEqual(["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]);
    expect(last4.map((q) => q.capex)).toEqual([-564, -568, -503, -632]);
    expect(last4.reduce((a, q) => a + q.operating_cash_flow!, 0)).toBe(3_866);
    const ttm = computeTtm(quarter, { price: 1, marketCap: 1_000_000, dividendYield: 0 });
    expect((ttm.keyMetrics.free_cash_flow_yield as number) * 1_000_000).toBeCloseTo(1_599, 6);
  });

  it("never adds to, or replaces, a higher-priority capex concept that reports the same period", () => {
    const fyCapex = (gaap: Record<string, unknown>) => parseCompanyFacts({ facts: { "us-gaap": {
      Revenues: { units: { USD: [d("2025-01-01", "2025-12-31", 1_000, "10-K", K25)] } },
      NetIncomeLoss: { units: { USD: [d("2025-01-01", "2025-12-31", 100, "10-K", K25)] } },
      ...gaap,
    } } }).annual[0].capex;
    const me = { PaymentsToAcquireMachineryAndEquipment: { units: { USD: [d("2025-01-01", "2025-12-31", 60, "10-K", K25)] } } };
    const other = (c: string) => ({ [c]: { units: { USD: [d("2025-01-01", "2025-12-31", 100, "10-K", K25)] } } });
    expect(fyCapex({ ...me, ...other("PaymentsToAcquirePropertyPlantAndEquipment") })).toBe(-100); // a subset beside total PP&E: not added
    expect(fyCapex({ ...me, ...other("PaymentsToAcquireProductiveAssets") })).toBe(-100); // beside the all-in line: the all-in line, once
    expect(fyCapex({ ...me, ...other("PaymentsToAcquireOtherPropertyPlantAndEquipment") })).toBe(-100);
    expect(fyCapex(me)).toBe(-60); // alone, it is the period's capex
    expect(CAPEX_RAW.at(-1)).toBe("PaymentsToAcquireMachineryAndEquipment");
  });
});

// TJX, SOLS and CSTM show no operating subtotal on the income statement and tag no NonoperatingIncomeExpense
// total, so tiers one and two read null. Values are the FY2025 (TJX: FY2026) face lines, in $M.
describe("operating income — third tier from pretax income (2026-11-13)", () => {
  const y = (val: number) => ({ start: "2025-01-01", end: "2025-12-31", val, form: "10-K", fp: "FY", filed: "2026-02-20" });
  const parse = (concepts: Record<string, number>, sic: number | null = 5651) =>
    parseCompanyFacts(
      { facts: { "us-gaap": Object.fromEntries(Object.entries({ NetIncomeLoss: 100, ...concepts }).map(([c, v]) => [c, { units: { USD: [y(v)] } }])) } },
      { sic },
    ).annual[0];
  const PRETAX = "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";

  it("subtracts net interest income (TJX: 7,299 − 121 = revenue − cost of sales − SG&A)", () => {
    const p = parse({ RevenueFromContractWithCustomerIncludingAssessedTax: 60_372, CostOfGoodsAndServicesSold: 41_679, [PRETAX]: 7_299, InterestRevenueExpenseNet: 121, InterestExpense: 79 });
    expect(p.operating_income).toBe(7_178);
    expect(p.operating_income).toBe(60_372 - 41_679 - 11_515);
  });
  it("adds back interest expense and takes out other nonoperating income (SOLS: 647 + 28 − 60)", () => {
    const p = parse({ RevenueFromContractWithCustomerExcludingAssessedTax: 3_886, [PRETAX]: 647, InterestExpenseNonoperating: 28, OtherNonoperatingIncomeExpense: 60 });
    expect(p.operating_income).toBe(615);
  });
  it("prefers the face interest line over the debt-note line (CSTM: 408 + 109, not + 102)", () => {
    const p = parse({ RevenueFromContractWithCustomerExcludingAssessedTax: 8_449, [PRETAX]: 408, InterestAndDebtExpense: 109, InterestExpenseDebt: 102 });
    expect(p.operating_income).toBe(517);
    expect(p.interest_expense).toBe(102); // the interest-coverage denominator keeps its own order
  });
  it("stays null on a single-step statement, where other income sits inside revenue (XOM, CVX)", () => {
    const p = parse({ Revenues: 332_238, CostsAndExpenses: 290_970, [PRETAX]: 41_268, InterestExpense: 603 });
    expect(p.operating_income).toBeNull();
  });
  it("stays null for a bank-like filer, whose interest expense is a funding cost (CFG, SCHW)", () => {
    const p = parse({ Revenues: 8_000, [PRETAX]: 2_000, InterestExpense: 1_300, InterestIncomeExpenseNet: 6_000 });
    expect(p.operating_income).toBeNull();
  });
  it("stays null when no interest line is tagged: pretax income alone is not operating income", () => {
    expect(parse({ Revenues: 1_000, [PRETAX]: 100 }).operating_income).toBeNull();
  });
  it("stays null when equity-method income is tagged: XBRL cannot place it above or below the operating line (HASI)", () => {
    // pretax 273.5 + funding-cost interest 292.4 would read 565.9 on revenue of 400.5
    const p = parse({ Revenues: 400.5, [PRETAX]: 273.5, InterestExpense: 292.4, IncomeLossFromEquityMethodInvestments: 300.7 });
    expect(p.operating_income).toBeNull();
    expect(p.ebitda).toBeNull();
  });
  it("stays null when the result is larger than revenue or gross profit", () => {
    expect(parse({ Revenues: 400.5, [PRETAX]: 273.5, InterestExpense: 292.4 }).operating_income).toBeNull();
    expect(parse({ Revenues: 1_000, CostOfRevenue: 900, [PRETAX]: 90, InterestExpense: 20 }).operating_income).toBeNull(); // 110 > gross profit 100
  });
  it("stays null for a lender with no bank tags, and when the SIC is unknown: interest may be a funding cost", () => {
    const lender = { Revenues: 1_000, [PRETAX]: 200, InterestExpense: 300 };
    expect(parse(lender).operating_income).toBe(500); // what an industrial SIC would read
    expect(parse(lender, 6159).operating_income).toBeNull();
    expect(parse(lender, 6799).operating_income).toBeNull();
    expect(parse(lender, null).operating_income).toBeNull();
  });
  it("never overrides the first two tiers", () => {
    expect(parse({ Revenues: 1_000, [PRETAX]: 100, InterestExpense: 10, OperatingIncomeLoss: 150 }).operating_income).toBe(150);
    expect(parse({ Revenues: 1_000, [PRETAX]: 100, InterestExpense: 10, NonoperatingIncomeExpense: -30 }).operating_income).toBe(130);
  });

  // The method is the filer's, not the period's: a fiscal year and its quarters must not mix methods, because
  // Q4 is derived as FY − (Q1 + Q2 + Q3).
  const period = (start: string, end: string, form: string, filed: string) => (val: number) => ({ start, end, val, form, fp: form === "10-K" ? "FY" : "Q", filed });
  const FY = period("2025-01-01", "2025-12-31", "10-K", "2026-02-20");
  const QS = [period("2025-01-01", "2025-03-31", "10-Q", "2025-05-01"), period("2025-04-01", "2025-06-30", "10-Q", "2025-08-01"), period("2025-07-01", "2025-09-30", "10-Q", "2025-11-01")];
  const filer = (concepts: Record<string, { fy?: number; q?: (number | null)[] }>) =>
    parseCompanyFacts(
      {
        facts: {
          "us-gaap": Object.fromEntries(
            Object.entries(concepts).map(([c, v]) => [
              c,
              { units: { USD: [...(v.fy != null ? [FY(v.fy)] : []), ...(v.q ?? []).flatMap((x, k) => (x == null ? [] : [QS[k](x)]))] } },
            ]),
          ),
        },
      },
      { sic: 3350 },
    );
  const base = { Revenues: { fy: 4_000, q: [1_000, 1_000, 1_000] }, NetIncomeLoss: { fy: 400, q: [100, 100, 100] }, [PRETAX]: { fy: 500, q: [120, 130, 125] } };
  const oi = (r: ReturnType<typeof filer>) => ({ fy: r.annual[0].operating_income, q: r.quarter.filter((x) => x.fiscal_year === 2025).map((x) => x.operating_income) });

  it("derives every quarter and Q4 on one method when the filer tags the same lines throughout", () => {
    const r = oi(filer({ ...base, InterestExpense: { fy: 40, q: [10, 10, 10] } }));
    expect(r.fy).toBe(540);
    expect(r.q).toEqual([130, 140, 135, 135]);
  });
  it("uses one interest concept for the filer: the face line the 10-Qs carry, not a 10-K-only note line", () => {
    const r = oi(filer({ ...base, [PRETAX]: { fy: 400, q: [100, 100, 100] }, InterestExpense: { fy: 120 }, InterestExpenseNonoperating: { fy: 100, q: [25, 25, 25] } }));
    expect(r.fy).toBe(500);
    expect(r.q).toEqual([125, 125, 125, 125]);
  });
  it("follows a renamed interest tag: the old concept's longer history does not blank or overwrite the latest years", () => {
    const yr = (year: number, val: number) => ({ start: `${year}-01-01`, end: `${year}-12-31`, val, form: "10-K", fp: "FY", filed: `${year + 1}-02-20` });
    const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
    const series = (ys: number[], val: number) => ({ units: { USD: ys.map((year) => yr(year, val)) } });
    const renamed = (oldYears: number[]) =>
      parseCompanyFacts(
        {
          facts: {
            "us-gaap": {
              Revenues: series(years, 4_000), NetIncomeLoss: series(years, 400), [PRETAX]: series(years, 400),
              InterestExpense: series(oldYears, 140), // the old face tag, later only a note line
              InterestExpenseNonoperating: { units: { USD: [yr(2024, 100), yr(2025, 100), ...QS.map((q) => q(25))] } },
            },
          },
        },
        { sic: 3350 },
      ).annual;
    const at = (rows: ReturnType<typeof renamed>, year: number) => rows.find((p) => p.fiscal_year === year)!.operating_income;
    const dropped = renamed([2019, 2020, 2021, 2022, 2023]); // old tag stops at the rename
    expect(at(dropped, 2025)).toBe(500);
    expect(at(dropped, 2024)).toBe(500);
    expect(at(dropped, 2023)).toBeNull(); // the current line is not tagged that far back
    const kept = renamed(years); // old tag carries on in the 10-K note at 140
    expect(at(kept, 2025)).toBe(500);
  });
  it("leaves a quarter null, and so Q4, when it lacks the line the filer's method needs", () => {
    // the 10-K tags the net interest line, the 10-Qs only gross interest expense: net in FY, nothing comparable in the quarters
    const r = oi(filer({ ...base, InterestRevenueExpenseNet: { fy: 20 }, InterestExpense: { fy: 40, q: [10, 10, 10] } }));
    expect(r.fy).toBe(480);
    expect(r.q.every((x) => x == null)).toBe(true);
  });
  it("does not fill a period the first two tiers leave null for a filer that tags them elsewhere (DOW)", () => {
    const r = oi(filer({ ...base, InterestExpense: { fy: 40, q: [10, 10, 10] }, NonoperatingIncomeExpense: { fy: -40, q: [-10, null, -10] } }));
    expect(r.fy).toBe(540);
    expect(r.q[0]).toBe(130);
    expect(r.q[1]).toBeNull();
    expect(r.q[3]).toBeNull();
  });
  it("blocks the whole filer when any period is single-step, even one outside the latest years (XOM)", () => {
    const r = filer({
      Revenues: { fy: 4_000, q: [1_000, 1_000, 1_000] }, NetIncomeLoss: { fy: 400, q: [100, 100, 100] }, [PRETAX]: { fy: 500, q: [120, 130, 125] },
      InterestExpense: { fy: 40, q: [10, 10, 10] }, CostsAndExpenses: { q: [880] }, // only Q1 reconciles: 1,000 − 880 = 120
    });
    expect(oi(r).fy).toBeNull();
    expect(oi(r).q.every((x) => x == null)).toBe(true);
  });
});

// --- fiscal period keys (2026-10 period-keying audit, steps 2–4) ------------------------------------
//
// Fixture shorthands: a duration entry and a balance-sheet instant, in companyfacts shape.
const d = (start: string, end: string, val: number, form: string, filed: string) => ({ start, end, val, form, filed });
const i = (end: string, val: number, form: string, filed: string) => ({ end, val, form, filed });
const gaap = (concepts: Record<string, ReturnType<typeof d | typeof i>[]>) => ({
  facts: { "us-gaap": Object.fromEntries(Object.entries(concepts).map(([c, USD]) => [c, { units: { USD } }])) },
});
const rowAt = (rows: SecPeriod[], date: string) => rows.filter((r) => r.report_date === date);

describe("fiscalYearKey", () => {
  it("keeps the calendar year of a year end, except one in the first two weeks of January", () => {
    expect(fiscalYearKey("2025-12-31")).toBe(2025);
    expect(fiscalYearKey("2025-12-27")).toBe(2025);
    expect(fiscalYearKey("2025-09-30")).toBe(2025);
    expect(fiscalYearKey("2026-01-31")).toBe(2026); // TJX's late-January year keeps its year
    expect(fiscalYearKey("2026-02-01")).toBe(2026);
    expect(fiscalYearKey("2021-01-02")).toBe(2020); // USFD's 53-week fiscal 2020
    expect(fiscalYearKey("2022-01-01")).toBe(2021);
  });
});

describe("fiscalPeriodOf", () => {
  const sept: FiscalYearSpan[] = [
    { start: "2023-10-01", end: "2024-09-30" },
    { start: "2024-10-01", end: "2025-09-30" },
  ];
  it("numbers a September filer's quarters from its October start", () => {
    expect(fiscalPeriodOf("2024-12-31", sept)).toEqual({ fiscalYear: 2025, quarter: 1 });
    expect(fiscalPeriodOf("2025-03-31", sept)).toEqual({ fiscalYear: 2025, quarter: 2 });
    expect(fiscalPeriodOf("2025-06-30", sept)).toEqual({ fiscalYear: 2025, quarter: 3 });
    expect(fiscalPeriodOf("2025-09-30", sept)).toEqual({ fiscalYear: 2025, quarter: 4 });
  });
  it("places the year in progress from the last year end, and the year before the first from its start", () => {
    expect(fiscalPeriodOf("2026-03-31", sept)).toEqual({ fiscalYear: 2026, quarter: 2 });
    expect(fiscalPeriodOf("2023-06-30", sept)).toEqual({ fiscalYear: 2023, quarter: 3 });
    expect(fiscalPeriodOf("2023-09-30", sept)).toEqual({ fiscalYear: 2023, quarter: 4 });
  });
  it("tells two 52/53-week quarter ends in one calendar quarter apart", () => {
    const wk = [{ start: "2023-01-01", end: "2023-12-30" }];
    expect(fiscalPeriodOf("2023-07-01", wk)).toEqual({ fiscalYear: 2023, quarter: 2 });
    expect(fiscalPeriodOf("2023-09-30", wk)).toEqual({ fiscalYear: 2023, quarter: 3 });
  });
  it("is null for a date that is not near a quarter boundary, or beyond a year from the known years", () => {
    expect(fiscalPeriodOf("2025-02-14", sept)).toBeNull();
    expect(fiscalPeriodOf("2027-03-31", sept)).toBeNull();
    expect(fiscalPeriodOf("2022-03-31", sept)).toBeNull();
  });
});

describe("fiscalYearSpans", () => {
  it("reads each fiscal year's first and last day from 10-K ~1-year durations, ignoring 10-Q and quarterly entries", () => {
    const f = gaap({
      Revenues: [d("2023-10-01", "2024-09-30", 10, "10-K", "2024-11-10"), d("2024-10-01", "2025-09-30", 11, "10-K", "2025-11-10"), d("2024-10-01", "2024-12-31", 3, "10-Q", "2025-01-30")],
      NetIncomeLoss: [d("2024-07-01", "2025-09-30", 9, "10-K", "2025-11-10")], // 15 months: not a fiscal year
    });
    expect(fiscalYearSpans(f)).toEqual([{ start: "2023-10-01", end: "2024-09-30" }, { start: "2024-10-01", end: "2025-09-30" }]);
  });
  it("leaves a fiscal-year-end change open instead of inventing a year across it", () => {
    const f = gaap({ Revenues: [d("2022-05-01", "2023-04-30", 10, "10-K", "2023-06-20"), d("2024-01-01", "2024-12-31", 12, "10-K", "2025-02-20")] });
    expect(fiscalYearSpans(f)).toEqual([{ start: "2022-05-01", end: "2023-04-30" }, { start: "2024-01-01", end: "2024-12-31" }]);
  });
});

// V/ATO shape: a September year. The December quarter is tagged discretely; the March and June cash flows
// only as six- and nine-month year-to-date figures, which end in calendar Q1 and Q2.
describe("YTD cash flow for a September fiscal year", () => {
  const f = gaap({
    Revenues: [
      d("2024-10-01", "2025-09-30", 4_000, "10-K", "2025-11-06"),
      d("2024-10-01", "2024-12-31", 900, "10-Q", "2025-01-30"),
      d("2025-01-01", "2025-03-31", 1_000, "10-Q", "2025-04-29"),
      d("2025-04-01", "2025-06-30", 1_050, "10-Q", "2025-07-29"),
    ],
    NetIncomeLoss: [d("2024-10-01", "2025-09-30", 400, "10-K", "2025-11-06")],
    NetCashProvidedByUsedInOperatingActivities: [
      d("2024-10-01", "2025-09-30", 2_000, "10-K", "2025-11-06"),
      d("2024-10-01", "2024-12-31", 500, "10-Q", "2025-01-30"),
      d("2024-10-01", "2025-03-31", 950, "10-Q", "2025-04-29"), // six months
      d("2024-10-01", "2025-06-30", 1_500, "10-Q", "2025-07-29"), // nine months
    ],
  });
  const { quarter } = parseCompanyFacts(f);
  it("reconstructs the March quarter as six months − December and the June quarter as nine − six months", () => {
    expect(rowAt(quarter, "2024-12-31")[0].operating_cash_flow).toBe(500);
    expect(rowAt(quarter, "2025-03-31")[0].operating_cash_flow).toBe(950 - 500);
    expect(rowAt(quarter, "2025-06-30")[0].operating_cash_flow).toBe(1_500 - 950);
  });
  it("derives the September quarter as the year less those three", () => {
    expect(rowAt(quarter, "2025-09-30")[0].operating_cash_flow).toBe(2_000 - 1_500);
    expect(rowAt(quarter, "2025-09-30")[0].revenue).toBe(4_000 - 900 - 1_000 - 1_050);
  });
  it("labels each quarter by its place in the fiscal year: the June quarter is Q3 of fiscal 2025", () => {
    expect(quarter.map((q) => `${q.fiscal_period}/${q.fiscal_year}@${q.report_date}`)).toEqual([
      "Q1/2025@2024-12-31", "Q2/2025@2025-03-31", "Q3/2025@2025-06-30", "Q4/2025@2025-09-30",
    ]);
  });
  it("keeps the calendar labels under the calendar override (LQDT), every value unchanged", () => {
    const cal = parseCompanyFacts(f, { labels: { labels: "calendar" } });
    expect(cal.quarter.map((q) => `${q.fiscal_period}/${q.fiscal_year}@${q.report_date}`)).toEqual([
      "Q4/2024@2024-12-31", "Q1/2025@2025-03-31", "Q2/2025@2025-06-30", "Q4/2025@2025-09-30",
    ]);
    const unlabelled = (rows: SecPeriod[]) => rows.map(({ fiscal_period: _p, fiscal_year: _y, ...rest }) => rest);
    expect(unlabelled(cal.quarter)).toEqual(unlabelled(quarter));
  });
});

// ADI shape: an October/November year whose quarters still end in calendar Q1–Q3. The fiscal calendar must give
// the same answer the 2026-10-06 start-date grouping already did.
describe("YTD cash flow for an ADI-shape fiscal year (quarters end in calendar Q1–Q3)", () => {
  const f = gaap({
    Revenues: [
      d("2024-11-03", "2025-11-01", 10_000, "10-K", "2025-11-25"),
      d("2025-11-02", "2026-01-31", 3_000, "10-Q", "2026-02-20"),
      d("2026-02-01", "2026-05-02", 3_100, "10-Q", "2026-05-22"),
      d("2026-05-03", "2026-08-01", 3_200, "10-Q", "2026-08-21"),
    ],
    NetIncomeLoss: [d("2024-11-03", "2025-11-01", 2_000, "10-K", "2025-11-25")],
    NetCashProvidedByUsedInOperatingActivities: [
      d("2025-11-02", "2026-01-31", 1_000, "10-Q", "2026-02-20"),
      d("2025-11-02", "2026-05-02", 2_300, "10-Q", "2026-05-22"),
      d("2025-11-02", "2026-08-01", 3_900, "10-Q", "2026-08-21"),
    ],
  });
  it("reconstructs Q2 and Q3 and labels them as before", () => {
    const { quarter } = parseCompanyFacts(f);
    expect(quarter.map((q) => [q.fiscal_period, q.fiscal_year, q.report_date, q.operating_cash_flow])).toEqual([
      ["Q1", 2026, "2026-01-31", 1_000],
      ["Q2", 2026, "2026-05-02", 1_300],
      ["Q3", 2026, "2026-08-01", 1_600],
    ]);
  });
});

// TMO/USFD shape: a 52/53-week year ending the Saturday nearest December 31. In 2023 the second quarter ended
// on July 1 and the third on September 30, both in calendar Q3.
describe("two quarter ends in one calendar quarter (52/53-week year)", () => {
  const f = gaap({
    Revenues: [
      d("2023-01-01", "2023-12-30", 4_000, "10-K", "2024-02-20"),
      d("2023-01-01", "2023-04-01", 900, "10-Q", "2023-05-05"),
      d("2023-04-02", "2023-07-01", 1_000, "10-Q", "2023-08-04"),
      d("2023-07-02", "2023-09-30", 1_050, "10-Q", "2023-11-03"),
    ],
    NetIncomeLoss: [
      d("2023-01-01", "2023-12-30", 400, "10-K", "2024-02-20"),
      d("2023-01-01", "2023-04-01", 90, "10-Q", "2023-05-05"),
      d("2023-04-02", "2023-07-01", 100, "10-Q", "2023-08-04"),
      d("2023-07-02", "2023-09-30", 105, "10-Q", "2023-11-03"),
      d("2023-04-02", "2023-07-01", 100, "10-Q", "2024-08-02"), // re-reported a year later, filed last
    ],
    CashAndCashEquivalentsAtCarryingValue: [i("2023-07-01", 70, "10-Q", "2023-08-04"), i("2023-09-30", 80, "10-Q", "2023-11-03")],
  });
  const { quarter } = parseCompanyFacts(f);
  it("keeps both quarters, each with its own figures, labelled Q2 and Q3", () => {
    expect(rowAt(quarter, "2023-07-01").map((q) => [q.fiscal_period, q.fiscal_year, q.revenue, q.net_income, q.cash])).toEqual([["Q2", 2023, 1_000, 100, 70]]);
    expect(rowAt(quarter, "2023-09-30").map((q) => [q.fiscal_period, q.fiscal_year, q.revenue, q.net_income, q.cash])).toEqual([["Q3", 2023, 1_050, 105, 80]]);
  });
  it("labels the April 1 quarter Q1, not the calendar Q2 its end falls in", () => {
    expect(rowAt(quarter, "2023-04-01").map((q) => `${q.fiscal_period}/${q.fiscal_year}`)).toEqual(["Q1/2023"]);
  });
  it("derives the year's Q4 from its three quarters", () => {
    expect(rowAt(quarter, "2023-12-30").map((q) => [q.fiscal_period, q.revenue, q.net_income])).toEqual([["Q4", 4_000 - 900 - 1_000 - 1_050, 400 - 90 - 100 - 105]]);
  });
});

// USFD shape: 52/53-week years ending 2021-01-02 (fiscal 2020), 2022-01-01 (fiscal 2021) and 2022-12-31 (fiscal 2022).
describe("two fiscal years ending in one calendar year", () => {
  const f = gaap({
    Revenues: [
      d("2019-12-29", "2021-01-02", 22_885, "10-K", "2021-02-17"),
      d("2021-01-03", "2022-01-01", 29_487, "10-K", "2022-02-16"),
      d("2022-01-02", "2022-12-31", 34_057, "10-K", "2023-02-16"),
    ],
    NetIncomeLoss: [d("2019-12-29", "2021-01-02", -226, "10-K", "2021-02-17"), d("2021-01-03", "2022-01-01", 164, "10-K", "2022-02-16"), d("2022-01-02", "2022-12-31", 265, "10-K", "2023-02-16")],
    CashAndCashEquivalentsAtCarryingValue: [i("2022-01-01", 148, "10-K", "2022-02-16"), i("2022-12-31", 211, "10-K", "2023-02-16")],
  });
  it("keeps every year, each with its own balance sheet, labelled 2020, 2021 and 2022", () => {
    const { annual } = parseCompanyFacts(f);
    expect(annual.map((a) => [a.fiscal_year, a.report_date, a.revenue, a.cash])).toEqual([
      [2020, "2021-01-02", 22_885, null],
      [2021, "2022-01-01", 29_487, 148],
      [2022, "2022-12-31", 34_057, 211],
    ]);
  });
});

// RTX shape: a 10-Q filed after a merger re-reports the prior December quarter discretely.
describe("a 10-Q that re-reports a fiscal Q4", () => {
  const f = gaap({
    Revenues: [
      d("2019-01-01", "2019-12-31", 45_349, "10-K", "2020-02-10"),
      d("2019-01-01", "2019-03-31", 11_000, "10-Q", "2019-04-25"),
      d("2019-04-01", "2019-06-30", 11_300, "10-Q", "2019-07-25"),
      d("2019-07-01", "2019-09-30", 11_355, "10-Q", "2019-10-25"),
      d("2019-10-01", "2019-12-31", 11_694, "10-Q", "2020-07-29"),
    ],
    NetIncomeLoss: [
      d("2019-01-01", "2019-12-31", 5_000, "10-K", "2020-02-10"),
      d("2019-01-01", "2019-03-31", 1_200, "10-Q", "2019-04-25"),
      d("2019-04-01", "2019-06-30", 1_300, "10-Q", "2019-07-25"),
      d("2019-07-01", "2019-09-30", 1_357, "10-Q", "2019-10-25"),
    ],
  });
  it("emits one row per date: the reported quarter, not a derived duplicate", () => {
    const { quarter } = parseCompanyFacts(f);
    const dates = quarter.map((q) => q.report_date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(rowAt(quarter, "2019-12-31").map((q) => [q.fiscal_period, q.revenue])).toEqual([["Q4", 11_694]]);
  });
  it("fills what the recast left untagged from FY − Q1..Q3 when the two agree on revenue", () => {
    // the recast 10-Q tags Q4 revenue but not net income; 5,000 − (1,200 + 1,300 + 1,357) = 1,143
    expect(rowAt(parseCompanyFacts(f).quarter, "2019-12-31")[0].net_income).toBe(1_143);
  });
  it("leaves the gaps null when the recast revenue is on a different basis from the full year", () => {
    const recast = gaap({
      ...Object.fromEntries(Object.entries(f.facts["us-gaap"]).map(([c, v]) => [c, v.units.USD])),
      Revenues: f.facts["us-gaap"].Revenues.units.USD.map((e) => (e.end === "2019-12-31" && e.form === "10-Q" ? { ...e, val: 12_500 } : e)),
    });
    const [row] = rowAt(parseCompanyFacts(recast).quarter, "2019-12-31");
    expect(row.revenue).toBe(12_500);
    expect(row.net_income).toBeNull();
  });
});

// CEG shape: a later 10-Q tags balances at the spin-off date, inside the March quarter. USFD shape: a note tags a
// mis-scaled debt figure at a date that is no period end. Neither may replace the quarter-end balance.
describe("a balance tagged at a date that is no period end", () => {
  const f = gaap({
    Revenues: [
      d("2021-01-01", "2021-12-31", 19_000, "10-K", "2022-02-25"),
      d("2022-01-01", "2022-03-31", 5_591, "10-Q", "2022-05-12"),
    ],
    NetIncomeLoss: [d("2021-01-01", "2021-12-31", -200, "10-K", "2022-02-25"), d("2022-01-01", "2022-03-31", 106, "10-Q", "2022-05-12")],
    StockholdersEquity: [i("2022-03-31", 11_505, "10-Q", "2022-05-12"), i("2022-01-31", 0, "10-Q", "2022-08-04")],
    LongTermDebt: [i("2022-03-31", 4_548, "10-Q", "2022-05-12"), i("2022-02-15", 1.334, "10-Q", "2022-08-04")],
  });
  it("keeps the quarter-end balance, however late the off-date figure was filed", () => {
    const [row] = rowAt(parseCompanyFacts(f).quarter, "2022-03-31");
    expect(row.total_equity).toBe(11_505);
    expect(row.total_debt).toBe(4_548);
  });
});

// RCAT shape: an April year, an eight-month transition to December, then a calendar year.
describe("a fiscal-year-end change", () => {
  const f = gaap({
    Revenues: [
      d("2022-05-01", "2023-04-30", 1_200, "10-K", "2023-07-14"),
      d("2023-05-01", "2023-07-31", 300, "10-Q", "2023-09-14"),
      d("2023-08-01", "2023-10-31", 310, "10-Q", "2023-12-14"),
      d("2024-01-01", "2024-12-31", 1_600, "10-K", "2025-03-20"),
      d("2024-01-01", "2024-03-31", 380, "10-Q", "2024-05-14"),
      d("2024-04-01", "2024-06-30", 390, "10-Q", "2024-08-14"),
      d("2024-07-01", "2024-09-30", 400, "10-Q", "2024-11-14"),
    ],
    NetIncomeLoss: [d("2022-05-01", "2023-04-30", 10, "10-K", "2023-07-14"), d("2024-01-01", "2024-12-31", 20, "10-K", "2025-03-20")],
    NetCashProvidedByUsedInOperatingActivities: [
      d("2023-05-01", "2023-07-31", 30, "10-Q", "2023-09-14"),
      d("2023-05-01", "2023-10-31", 70, "10-Q", "2023-12-14"), // six months of the transition period
    ],
  });
  const { quarter } = parseCompanyFacts(f);
  it("emits no row for a quarter inside the transition, rather than placing it in a guessed fiscal year", () => {
    expect(rowAt(quarter, "2023-07-31")).toEqual([]);
    expect(rowAt(quarter, "2023-10-31")).toEqual([]);
  });
  it("still keys the calendar year that follows, and derives its Q4 from its own three quarters", () => {
    expect(rowAt(quarter, "2024-12-31").map((q) => q.revenue)).toEqual([1_600 - 380 - 390 - 400]);
  });
});

describe("Q4 derivation stays inside one fiscal year", () => {
  // June year; FY2026 lacks its first quarter. FY2025's quarters and Q4 are complete.
  const f = gaap({
    Revenues: [
      d("2024-06-30", "2025-06-29", 1_800, "10-K", "2025-08-08"),
      d("2024-06-30", "2024-09-29", 400, "10-Q", "2024-10-25"),
      d("2024-09-30", "2024-12-29", 450, "10-Q", "2025-01-30"),
      d("2024-12-30", "2025-03-30", 470, "10-Q", "2025-04-24"),
      d("2025-06-30", "2026-06-28", 2_000, "10-K", "2026-08-07"),
      d("2025-09-29", "2025-12-28", 500, "10-Q", "2026-01-29"),
      d("2025-12-29", "2026-03-29", 600, "10-Q", "2026-04-23"),
    ],
    NetIncomeLoss: [d("2024-06-30", "2025-06-29", 1, "10-K", "2025-08-08"), d("2025-06-30", "2026-06-28", 1, "10-K", "2026-08-07")],
  });
  it("derives a year's Q4 from that year's quarters, and none when one of them is missing", () => {
    const { quarter } = parseCompanyFacts(f);
    expect(rowAt(quarter, "2025-06-29").map((q) => q.revenue)).toEqual([1_800 - 400 - 450 - 470]);
    expect(rowAt(quarter, "2026-06-28")).toEqual([]);
  });
});

describe("no two emitted rows share a report_date", () => {
  it("holds for the LLY fixture", () => {
    const { annual, quarter } = parseCompanyFacts(facts);
    for (const rows of [annual, quarter]) expect(new Set(rows.map((r) => r.report_date)).size).toBe(rows.length);
  });
});

// --- fiscal labels (step 5) ----------------------------------------------------------------------------
describe("fiscal labels on emitted rows", () => {
  it("a January-year filer (TJX shape): the quarter ended 2026-08-01 is Q2 of fiscal 2027, the year ending January 2027", () => {
    const f = gaap({
      Revenues: [
        d("2025-02-02", "2026-01-31", 56_000, "10-K", "2026-04-01"),
        d("2026-02-01", "2026-05-02", 13_000, "10-Q", "2026-05-29"),
        d("2026-05-03", "2026-08-01", 15_180, "10-Q", "2026-08-28"),
      ],
      NetIncomeLoss: [d("2025-02-02", "2026-01-31", 5_000, "10-K", "2026-04-01")],
    });
    const { annual, quarter } = parseCompanyFacts(f);
    expect(annual.map((a) => [a.fiscal_period, a.fiscal_year])).toEqual([["FY", 2026]]);
    expect(quarter.map((q) => [q.fiscal_period, q.fiscal_year, q.report_date])).toEqual([["Q1", 2027, "2026-05-02"], ["Q2", 2027, "2026-08-01"]]);
  });

  it("a 52/53-week December filer (VSH/ZBRA shape): the quarter ended July 4 is Q2", () => {
    const f = gaap({
      Revenues: [
        d("2025-01-01", "2025-12-31", 3_000, "10-K", "2026-02-20"),
        d("2026-01-01", "2026-04-04", 800, "10-Q", "2026-05-05"),
        d("2026-04-05", "2026-07-04", 889, "10-Q", "2026-08-05"),
      ],
      NetIncomeLoss: [d("2025-01-01", "2025-12-31", 100, "10-K", "2026-02-20")],
    });
    expect(parseCompanyFacts(f).quarter.map((q) => [q.fiscal_period, q.fiscal_year, q.report_date])).toEqual([["Q1", 2026, "2026-04-04"], ["Q2", 2026, "2026-07-04"]]);
  });

  it("a year offset (CHWY shape) names the year by its start on annual, real and derived quarter rows alike", () => {
    const f = gaap({
      Revenues: [
        d("2025-02-03", "2026-02-01", 12_000, "10-K", "2026-03-20"),
        d("2025-02-03", "2025-05-04", 3_100, "10-Q", "2025-06-10"),
        d("2025-05-05", "2025-08-03", 3_100, "10-Q", "2025-09-10"),
        d("2025-08-04", "2025-11-02", 3_100, "10-Q", "2025-12-10"),
        d("2026-02-02", "2026-05-03", 3_350, "10-Q", "2026-06-10"),
        d("2026-05-04", "2026-08-02", 3_330, "10-Q", "2026-09-10"),
      ],
      NetIncomeLoss: [d("2025-02-03", "2026-02-01", 100, "10-K", "2026-03-20")],
    });
    const { annual, quarter } = parseCompanyFacts(f, { labels: { yearOffset: -1 } });
    expect(annual.map((a) => [a.fiscal_year, a.report_date])).toEqual([[2025, "2026-02-01"]]);
    expect(quarter.map((q) => `${q.fiscal_period}/${q.fiscal_year}@${q.report_date}`)).toEqual([
      "Q1/2025@2025-05-04", "Q2/2025@2025-08-03", "Q3/2025@2025-11-02", "Q4/2025@2026-02-01", "Q1/2026@2026-05-03", "Q2/2026@2026-08-02",
    ]);
    expect(rowAt(quarter, "2026-02-01")[0].revenue).toBe(12_000 - 3 * 3_100);
  });

  it("a calendar-December filer keeps the labels it always had", () => {
    const f = gaap({
      Revenues: [
        d("2025-01-01", "2025-12-31", 400, "10-K", "2026-02-10"),
        d("2025-01-01", "2025-03-31", 90, "10-Q", "2025-04-30"),
        d("2025-04-01", "2025-06-30", 100, "10-Q", "2025-07-30"),
        d("2025-07-01", "2025-09-30", 105, "10-Q", "2025-10-30"),
        d("2026-01-01", "2026-03-31", 110, "10-Q", "2026-04-30"),
      ],
      NetIncomeLoss: [d("2025-01-01", "2025-12-31", 40, "10-K", "2026-02-10")],
    });
    for (const labels of [undefined, { labels: "calendar" as const }]) {
      const { annual, quarter } = parseCompanyFacts(f, { labels });
      expect(annual.map((a) => `${a.fiscal_period}/${a.fiscal_year}`)).toEqual(["FY/2025"]);
      expect(quarter.map((q) => `${q.fiscal_period}/${q.fiscal_year}`)).toEqual(["Q1/2025", "Q2/2025", "Q3/2025", "Q4/2025", "Q1/2026"]);
    }
  });
});

describe("fiscalYearLabel", () => {
  it("is the fiscal-year key plus the offset, or the calendar year of the end under the calendar override", () => {
    expect(fiscalYearLabel("2026-02-01")).toBe(2026);
    expect(fiscalYearLabel("2026-02-01", { yearOffset: -1 })).toBe(2025);
    expect(fiscalYearLabel("2021-01-02")).toBe(2020);
    expect(fiscalYearLabel("2021-01-02", { labels: "calendar" })).toBe(2021);
    expect(fiscalYearLabel("2025-09-30", { labels: "calendar" })).toBe(2025);
  });
});
