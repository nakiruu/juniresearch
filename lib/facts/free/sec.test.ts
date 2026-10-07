import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCompanyFacts, combineCapex, deriveTotalDebt, CAPEX_RAW, type SecPeriod } from "./sec";
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
