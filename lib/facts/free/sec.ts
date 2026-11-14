/**
 * SEC companyfacts → statement rows.
 *
 * Turns a company's `companyfacts` XBRL JSON (data.sec.gov/api/xbrl/companyfacts)
 * into annual and quarterly `SecPeriod` rows, owning concept-name variance
 * (companies tag the "same" line item under different us-gaap concepts) and
 * the vendor-shape derivations (EBITDA, total debt, net debt, FCF, Q4-from-FY).
 *
 * See docs/superpowers/specs/2026-09-16-sec-yahoo-free-factsource-design.md
 * for the concept map and period-selection rules this file implements.
 */
import { edgarJson, type FetchLike } from "../../edgar/client";
import { padCik } from "../../edgar/submissions";

export interface SecPeriod {
  fiscal_period: string; // "FY" | "Q1" | "Q2" | "Q3" | "Q4"
  fiscal_year: number; // calendar year of period end
  report_date: string; // YYYY-MM-DD (period end)
  revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  ebitda: number | null;
  net_income: number | null;
  eps_diluted: number | null;
  interest_expense: number | null;
  cash_and_short_term_investments: number | null;
  cash: number | null;
  total_debt: number | null;
  net_debt: number | null;
  total_equity: number | null;
  total_current_assets: number | null;
  total_current_liabilities: number | null;
  operating_cash_flow: number | null;
  capex: number | null;
  common_stock_repurchased: number | null;
  common_dividends_paid: number | null;
  free_cash_flow: number | null;
}

// --- companyfacts JSON shape (loose; only the fields we read) ---------

interface UnitEntry {
  start?: string;
  end: string;
  val: number;
  form: string;
  filed: string;
}

type Unit = "USD" | "USD/shares";

interface CompanyFactsShape {
  facts?: { "us-gaap"?: Record<string, { units?: Partial<Record<Unit, UnitEntry[]>> }> };
}

// --- SEC concept map (us-gaap), priority order = fallback order -------
// Matches the design spec's table; extended in priority order where a real
// LLY companyfacts fetch showed the "expected" primary concept unused (see
// task-1-report.md for which concepts were missing and why).
//
// Selection is per-period, not per-series (see mergeByPriority below): a filer that has
// switched XBRL tags mid-history — one concept covering only old periods, another covering
// only current ones — must not have the stale concept's mere existence shadow the live one
// for the periods we actually want. Priority order below still matters when two concepts
// both report the *same* period (the higher-priority one wins).

const REVENUE = [
  // Utilities report total operating revenue under this concept (regulated + unregulated); it is the
  // headline top line and exceeds RevenueFromContractWithCustomer, which excludes regulatory-mechanism
  // and alternative-revenue-program amounts. Non-utilities never tag it, so per-period selection is
  // unaffected for them.
  "RegulatedAndUnregulatedOperatingRevenue",
  // Banks report "total net revenue" (net interest income after interest expense + noninterest income)
  // under this concept — the headline top line — and RevenueFromContractWithCustomer captures only their
  // fee/contract revenue, a subset. It must therefore outrank the contract concepts. JPMorgan also tags
  // the plain `Revenues` concept ANNUALLY (same value) but stopped tagging it quarterly after 2014, so
  // without this concept the quarterly series went stale at Q4'14; RevenuesNetOfInterestExpense carries
  // the live quarterly net revenue. Non-banks never tag it, so per-period selection is unaffected.
  "RevenuesNetOfInterestExpense",
  // `Revenues` is the income-statement total and outranks the customer-contract (ASC 606) amount, which
  // leaves out hedging, derivative, lease and insurance revenue. Most filers tag both at the same value; where
  // they differ, the contract line is a footnote subset (VST Q2 2026: total $4,017M, contract $4,401M, so
  // growth read +17% YoY when the reported top line fell; CEG, GE, PGY, BAM likewise). Owner-approved 2026-10-06.
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
];
// Some banks (e.g. East West Bancorp) tag net interest income and noninterest income separately but
// NOT any combined net-revenue concept: they never tag RevenuesNetOfInterestExpense or Revenues, and
// their only RevenueFromContractWithCustomer* line is a fee-only subset that they stop tagging (EWBC:
// last Q3'20). For such filers net revenue is derived as net interest income + noninterest income and
// used for every period no REVENUE concept above covers (see combineRevenue). Both are income-statement
// flow concepts tagged per discrete quarter, so plain flowSeries handles them; a filer that also tags a
// REVENUE concept keeps it (combineRevenue only fills the gaps), so non-banks are unaffected.
const NET_INTEREST_INCOME = ["InterestIncomeExpenseNet"];
const NONINTEREST_INCOME = ["NoninterestIncome"];
const COGS = ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"];
const GROSS_PROFIT = ["GrossProfit"]; // else derived: revenue − COGS
const OPERATING_INCOME = ["OperatingIncomeLoss"]; // else derived: pretax income − nonoperating income/expense, else the third tier below
// Helper concepts for the operating_income fallback (LLY tags neither OperatingIncomeLoss
// nor GrossProfit — its income statement has no such subtotal lines in XBRL).
const PRETAX_INCOME = [
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeBeforeIncomeTaxesMinorityInterestAndCumulativeEffectOfChangeInAccountingPrinciple",
];
const NONOPERATING_INCOME_EXPENSE = ["NonoperatingIncomeExpense"];
// Third tier for operating_income, for filers whose face statement has no operating subtotal and no
// NonoperatingIncomeExpense total (TJX, SOLS, CSTM): pretax income with the interest line and the
// other-nonoperating line taken back out. parseCompanyFacts decides per filer whether it applies (pretaxTier).
const NET_INTEREST_NONOPERATING = ["InterestRevenueExpenseNet", "InterestIncomeExpenseNonoperatingNet"]; // income-positive
// Kept apart from INTEREST_EXPENSE, whose order sets interest coverage. The filer's line is the one tagged in
// the most periods; this order only breaks ties (CSTM's InterestAndDebtExpense 109 vs the note's InterestExpenseDebt 102).
const FACE_INTEREST_EXPENSE = ["InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense", "InterestExpenseDebt"];
const OTHER_NONOPERATING = ["OtherNonoperatingIncomeExpense"]; // income-positive
const COSTS_AND_EXPENSES = ["CostsAndExpenses"];
const EQUITY_METHOD_INCOME = ["IncomeLossFromEquityMethodInvestments"];
const NET_INCOME = ["NetIncomeLoss"]; // parent-attributable; ProfitLoss − NCI fills gaps (see fillNetIncomeFromProfitLoss)
const PROFIT_LOSS = ["ProfitLoss"]; // net income INCLUDING noncontrolling interests
const NCI = ["NetIncomeLossAttributableToNoncontrollingInterest"];
const EPS_DILUTED = ["EarningsPerShareDiluted"];
const DA = ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"];
// Component fallback for filers that tag no combined D&A (e.g. INTU, LITE, ORCL tag Depreciation and
// AmortizationOfIntangibleAssets separately): D&A = depreciation + amortization of intangibles, see combineDa.
const DEPRECIATION = ["Depreciation"];
const AMORTIZATION_INTANGIBLES = ["AmortizationOfIntangibleAssets", "AmortizationOfAcquiredIntangibleAssets"];
// InterestExpenseDebt (interest on debt) is the fallback for filers that tag no total: BWA tags only it ($25M
// in Q2 2026) beside a net InterestIncomeExpenseNonoperatingNet, so interest coverage was null.
const INTEREST_EXPENSE = ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"];
const CASH_AND_ST_INVESTMENTS = ["CashCashEquivalentsAndShortTermInvestments"]; // else derived: cash + ST investments
// The cash-plus-restricted-cash total is the fallback for filers whose balance-sheet line includes restricted cash:
// BWA tags only it ($2,313M at FY2025), so cash and net debt were null for FY2022–FY2025.
const CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"];
// LLY's real companyfacts (2026-09-16 fetch) confirms ShortTermInvestments is the only STI concept it has
// ever tagged; the others are appended for filers that use them instead. Priority order matters only when
// two concepts both report the same period (see mergeByPriority) — a stale/unused concept here can't shadow
// a live one for a period it doesn't cover.
// CALX tags its current marketable securities only as DebtSecuritiesAvailableForSaleExcludingAccruedInterestCurrent
// in its 10-K ($245.0M at FY2025), so without it cash + investments read $143.1M against the $388.1M reported.
const SHORT_TERM_INVESTMENTS = [
  "ShortTermInvestments",
  "AvailableForSaleSecuritiesCurrent",
  "MarketableSecuritiesCurrent",
  "OtherShortTermInvestments",
  "DebtSecuritiesAvailableForSaleExcludingAccruedInterestCurrent",
  // NET tags its available-for-sale securities only as AvailableForSaleSecuritiesDebtSecuritiesCurrent
  // ($3,157.7M at FY2025), so without it cash + investments read $943.5M against the $4,101.3M reported.
  // Lowest priority: some filers also tag it as a note-level subset of a face-statement total above.
  "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
];
// Debt concepts are kept apart because they overlap: LongTermDebt is the long-term total *including*
// its current portion, and DebtCurrent is all current debt (current long-term debt + commercial paper +
// short-term borrowings). Treating LongTermDebt as a noncurrent fallback double-counted the current
// portion (AEIS FY2025: $567.5M reported as $1,135.0M), and preferring LongTermDebtCurrent over
// DebtCurrent dropped commercial paper (CSCO FY2026: $29,533M reported as $22,872M). See deriveFields.
// LongTermDebtAndCapitalLeaseObligations is the noncurrent debt-and-finance-lease line; BSX tags its long-term
// debt only that way ($11,137M at FY2025), so without it total debt read as current debt alone ($299M). It is
// read only when neither LongTermDebtNoncurrent nor LongTermDebt reports the period (see deriveTotalDebt): VST
// tags it beside LongTermDebt, with its current portion as LongTermDebtAndCapitalLeaseObligationsCurrent, and
// preferring it there dropped that portion (FY2025: $18,843M read as $17,642M).
const LTD_NONCURRENT = ["LongTermDebtNoncurrent"];
const LTD_LEASE_NONCURRENT = ["LongTermDebtAndCapitalLeaseObligations"];
const LTD_TOTAL = ["LongTermDebt"];
const LTD_CURRENT = ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"];
const DEBT_CURRENT = ["DebtCurrent"];
// OtherShortTermBorrowings is SCHW's balance-sheet short-term line ($6,913M at FY2025); its $1.9B commercial paper is a
// note figure inside it, so the line outranks CommercialPaper for the period and is never added to it.
// ShortTermBankLoansAndNotesPayable is DOW's "Notes payable" face line ($90M at FY2025; gross debt 18,161). It is
// lowest priority because CVX tags it ($96M) as a note component of its "Short-term debt" ShortTermBorrowings 977.
const SHORT_TERM_BORROWINGS = ["ShortTermBorrowings", "OtherShortTermBorrowings", "CommercialPaper", "ShortTermBankLoansAndNotesPayable"];
// FHLB advances are their own face line at SCHW ($1,850M at FY2025, beside other short-term borrowings and long-term
// debt) and EWBC ($3,000M, beside a $35.6M debt-and-lease line). They are ADDED, not merged with short-term
// borrowings, and only on the debt-and-lease-line paths with no DebtCurrent (rules 0, 3, 4): a bank's LongTermDebt /
// DebtCurrent borrowings total can already hold its FHLB advances (CFG's long-term borrowings). Nor are they added
// when the plain ShortTermBorrowings concept reports the period: SCHW's FY2022 10-K tags "Short-term borrowings"
// 17,050, which its FY2023 10-K recasts as other short-term borrowings 4,650 + FHLB 12,400.
const FHLB_ADVANCES = ["AdvancesFromFederalHomeLoanBanks"];
const SHORT_TERM_BORROWINGS_TOTAL = ["ShortTermBorrowings"];
// Convertible notes tagged apart from long-term debt. Read only when no long-term debt concept reports the
// period (see deriveTotalDebt), since filers that do tag LongTermDebt* often tag these as a subset of it.
// NET FY2025: ConvertibleDebtNoncurrent $1,974.1M + ConvertibleDebtCurrent $1,291.3M, and no other debt.
const CONVERTIBLE_NONCURRENT = ["ConvertibleDebtNoncurrent", "ConvertibleLongTermNotesPayable"];
const CONVERTIBLE_CURRENT = ["ConvertibleDebtCurrent", "ConvertibleNotesPayableCurrent"];
// Audit 2026-10-06 (D-1) and review 2026-10-07: total-debt concepts no list held. Each is read only when no
// higher-priority concept reports the period (see deriveTotalDebt), so the seven packs verified before this change
// (BSX, NET, ADI, VST, CSCO, AEIS, CALX) are untouched — scripts/debt-sweep.ts proves it offline.
//   - LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities already holds its current portion. CVX and
//     SCHW tag it AND LongTermDebtAndCapitalLeaseObligations at the SAME value (one balance-sheet line tagged
//     twice: CVX FY2025 39,781 = 39,781, FY2024 20,135 = 20,135; SCHW 22,199 = 22,199), beside a DebtCurrent that
//     is a note subtotal before reclassification (CVX 10,918). Adding DebtCurrent there overstates by 24–34%; only
//     short-term borrowings / commercial paper may be added. When the two lease lines differ (RTX FY2025: 34,288
//     vs 37,700), the noncurrent line + all current debt is the right read, as today (37,904).
//   - DebtLongtermAndShorttermCombinedAmount is the whole figure, long and short (GE FY2025 10-K $20,494M).
//   - UnsecuredLongTermDebt is CME's only long-term line ($3,422M at FY2025).
// DebtInstrumentCarryingAmount was considered and DROPPED (review F-5): it is a note-level, often subset figure
// (CVX 30,922; SCHW 22,237) with no filer that needs it. UnsecuredDebt likewise waits for a fixture.
// ShortTermBankLoansAndNotesPayable (DOW: 90) and AdvancesFromFederalHomeLoanBanks (SCHW: 1,850, a bank-wide
// concept) are also unlisted. Add either only with a fixture.
const LTD_LEASE_TOTAL = ["LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"];
const DEBT_COMBINED_TOTAL = ["DebtLongtermAndShorttermCombinedAmount"];
const UNSECURED_LTD = ["UnsecuredLongTermDebt"];
const TOTAL_EQUITY = ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"];
const CURRENT_ASSETS = ["AssetsCurrent"];
const CURRENT_LIABILITIES = ["LiabilitiesCurrent"];
export const OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
// LLY tags neither of the spec's two concepts for its current capex line; it uses "other
// property, plant and equipment" instead. Appended at lowest priority — per-period merging
// (see mergeByPriority) means this is only reached for periods neither spec concept covers.
// PaymentsToAcquireMachineryAndEquipment is lowest priority: DOW tags every capex period through Q1'26 both as it and as
// PaymentsToAcquireProductiveAssets at the same value, and its Q2'26 10-Q only as it ($632M), which left the June quarter
// and the TTM FCF null (2026-10-07). Selection is per period by priority, never summed, so where any concept above
// reports the period (a subset beside total PP&E, or DOW's twin all-in line) it is not read.
export const CAPEX_RAW = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToAcquireMachineryAndEquipment"];
/** The all-in concept: PP&E plus intangibles/software. When it is the period's capex base, nothing is added. */
export const CAPEX_ALL_IN = "PaymentsToAcquireProductiveAssets";
/**
 * Capital spending a filer tags apart from PP&E, added to a PP&E-based capex so FCF is owner cash after all
 * reinvestment: capitalized software (DSP $18M TTM) and equipment bought to lease out (FOUR $140M TTM).
 * The 2026-10 cross-check review (docs/superpowers/specs/2026-10-03-crosscheck-input-review.md) found
 * FCF overstated by up to 84% without them. Untagged lines (FOUR's capitalized software) remain invisible.
 */
export const CAPEX_EXTRA = ["PaymentsToDevelopSoftware", "PaymentsForSoftware", "PaymentsToAcquireEquipmentOnLease"];
const BUYBACKS_RAW = ["PaymentsForRepurchaseOfCommonStock"];
const DIVIDENDS_RAW = ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"];

// --- concept selection --------------------------------------------------

/** Returns one concept's raw unit-entry array (empty if that concept is untagged). */
function entriesFor(facts: unknown, concept: string, unit: Unit = "USD"): UnitEntry[] {
  const gaap = (facts as CompanyFactsShape)?.facts?.["us-gaap"];
  return gaap?.[concept]?.units?.[unit] ?? [];
}

// --- period selection (the XBRL "fy-means-filing-year" trap) -----------

// The emitted LABELS (fiscal_period, fiscal_year on each row) are still calendar-based: the quarter and
// year of the period end. Relabelling to the filer's own fiscal quarters is a separate, owner-gated change
// (learnings §3: LQDT's label stays). Only the map KEYS below are fiscal.
const yearOf = (date: string) => Number(date.slice(0, 4));
const daysBetween = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000;
const quarterOf = (end: string) => Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// --- fiscal calendar (period keys) ----------------------------------------
//
// Periods are keyed by the filer's fiscal year and quarter, not by the calendar. A calendar key collides
// whenever two quarter ends fall in one calendar quarter: TMO, USFD, CALX, VSH and ZBRA ended quarters on
// 2023-07-01 and 2023-09-30, both "2023Q3", so the July quarter was dropped and FY2023 had no Q4. And a
// calendar year key drops one of two 52/53-week years ending in the same calendar year (USFD: 2022-01-01 and
// 2022-12-31). For a calendar-December filer every fiscal key equals the calendar key it replaces.

/** One fiscal year, first and last day, from a 10-K's ~1-year duration entries. */
export interface FiscalYearSpan {
  start: string;
  end: string;
}

/** A period end placed in its fiscal year (fiscalYearKey of that year's end) and fiscal quarter. */
export interface FiscalPeriod {
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
}

/**
 * The key of the fiscal year ending on `end`: the calendar year of the date two weeks earlier. A 52/53-week
 * year that ends in the first days of January belongs to the year before (USFD's 2021-01-02 year is its
 * fiscal 2020); every other year end keeps its calendar year (Dec 31, TJX's late January, V's September).
 */
export const fiscalYearKey = (end: string): number => yearOf(addDays(end, -14));

/** A fiscal quarter is 13 weeks, 14 in some 53-week years; a period end further than this from a quarter boundary is not a quarter end. */
const QUARTER_DAYS = 365.25 / 4;
const QUARTER_TOLERANCE_DAYS = 15;

/**
 * The filer's fiscal years, from the start and end of every 10-K duration entry spanning 350–380 days (a
 * 52/53-week year runs 364 or 371). Each end takes the start most entries give it. Where two candidate years
 * overlap (a stray twelve-month disclosure), the one more entries report wins. One wholly missing year between
 * two known ones (a gap of 350–380 days) is filled; any other gap is a fiscal-year-end change and stays open,
 * so the periods inside it are not placed. Pure.
 */
export function fiscalYearSpans(facts: unknown): FiscalYearSpan[] {
  const gaap = (facts as CompanyFactsShape)?.facts?.["us-gaap"] ?? {};
  const starts = new Map<string, Map<string, number>>(); // end → start → count
  for (const node of Object.values(gaap)) {
    for (const e of node.units?.USD ?? []) {
      if (e.form !== "10-K" || !e.start) continue;
      const d = daysBetween(e.start, e.end);
      if (d < 350 || d > 380) continue;
      const byStart = starts.get(e.end) ?? new Map<string, number>();
      byStart.set(e.start, (byStart.get(e.start) ?? 0) + 1);
      starts.set(e.end, byStart);
    }
  }
  const candidates = [...starts].map(([end, byStart]) => {
    const [start] = [...byStart].reduce((best, x) => (x[1] > best[1] ? x : best));
    return { start, end, support: [...byStart.values()].reduce((a, b) => a + b, 0) };
  });
  const kept: FiscalYearSpan[] = [];
  for (const c of [...candidates].sort((a, b) => b.support - a.support || (a.end < b.end ? -1 : 1))) {
    if (!kept.some((k) => c.start <= k.end && k.start <= c.end)) kept.push({ start: c.start, end: c.end });
  }
  kept.sort((a, b) => (a.end < b.end ? -1 : 1));
  const spans: FiscalYearSpan[] = [];
  for (const s of kept) {
    const prev = spans.at(-1);
    if (prev) {
      const gap = daysBetween(prev.end, s.start) - 1; // days strictly between the two years
      if (gap >= 350 && gap <= 380) spans.push({ start: addDays(prev.end, 1), end: addDays(s.start, -1) });
    }
    spans.push(s);
  }
  return spans;
}

/** The quarter (1–3) a period `days` after the previous fiscal-year end closes, or null when it is not near a quarter boundary. */
function quarterAfter(days: number): 1 | 2 | 3 | null {
  const q = Math.round(days / QUARTER_DAYS);
  return q >= 1 && q <= 3 && Math.abs(days - q * QUARTER_DAYS) <= QUARTER_TOLERANCE_DAYS ? (q as 1 | 2 | 3) : null;
}

/**
 * Places a period end in the filer's fiscal calendar (`spans`, oldest first, from fiscalYearSpans):
 *   - inside a known fiscal year: a period ending on its last day is Q4, else Q1–Q3 by the days since the
 *     previous year end;
 *   - after the last known year (the year in progress): counted from that year's end, within one year;
 *   - before the first known year: counted back from its start, within one year.
 * Null when the end is in a gap between known years (a fiscal-year-end change) or not near a quarter
 * boundary — never a guess. Pure.
 */
export function fiscalPeriodOf(end: string, spans: FiscalYearSpan[]): FiscalPeriod | null {
  if (!spans.length) return null;
  const inside = spans.find((s) => s.start <= end && end <= s.end);
  if (inside) {
    if (end === inside.end) return { fiscalYear: fiscalYearKey(inside.end), quarter: 4 };
    const q = quarterAfter(daysBetween(addDays(inside.start, -1), end));
    return q ? { fiscalYear: fiscalYearKey(inside.end), quarter: q } : null;
  }
  const last = spans[spans.length - 1], first = spans[0];
  if (end > last.end) {
    const days = daysBetween(last.end, end);
    const q = days <= 380 ? quarterAfter(days) : null;
    return q ? { fiscalYear: fiscalYearKey(last.end) + 1, quarter: q } : null;
  }
  if (end < first.start) {
    const priorEnd = addDays(first.start, -1);
    if (end === priorEnd) return { fiscalYear: fiscalYearKey(priorEnd), quarter: 4 };
    const back = daysBetween(end, priorEnd);
    const q = back < 365 ? quarterAfter(365.25 - back) : null;
    return q ? { fiscalYear: fiscalYearKey(priorEnd), quarter: q } : null;
  }
  return null;
}

/**
 * The filer's quarterly period keys, "<fiscal year>Q<n>", null when the end cannot be placed. A balance-sheet
 * instant is keyed only when some 10-Q or 10-K duration ends on the same day: a note's off-date instant would
 * otherwise join the quarter it falls near (GE's 10-Q tags a $2.0B current-debt line at 2015-10-09, nine days
 * after its quarter end; CEG's tags spin-off-date balances at 2022-01-31, which beat its March 31 ones).
 */
interface FiscalCalendar {
  annualInstantKey: (end: string) => number | null;
  quarterKey: (end: string) => string | null;
  instantKey: (end: string) => string | null;
  quarterNumber: (end: string) => number | null;
}

function fiscalCalendar(facts: unknown): FiscalCalendar {
  const spans = fiscalYearSpans(facts);
  const durationEnds = new Set<string>();
  for (const node of Object.values((facts as CompanyFactsShape)?.facts?.["us-gaap"] ?? {})) {
    for (const e of node.units?.USD ?? []) if (e.start && (e.form === "10-Q" || e.form === "10-K")) durationEnds.add(e.end);
  }
  // A filer with no 10-K year at all (only 10-Qs captured) has no fiscal calendar to place against; its periods
  // keep the calendar key they always had. facts:free refuses such a filer anyway (it needs three fiscal years).
  const locate = spans.length
    ? (end: string) => fiscalPeriodOf(end, spans)
    : (end: string): FiscalPeriod => ({ fiscalYear: yearOf(end), quarter: quarterOf(end) as FiscalPeriod["quarter"] });
  const cache = new Map<string, FiscalPeriod | null>();
  const placed = (end: string) => {
    if (!cache.has(end)) cache.set(end, locate(end));
    return cache.get(end)!;
  };
  return {
    annualInstantKey: (end) => (durationEnds.has(end) ? fiscalYearKey(end) : null),
    quarterKey: (end) => {
      const p = placed(end);
      return p ? `${p.fiscalYear}Q${p.quarter}` : null;
    },
    instantKey: (end) => {
      const p = durationEnds.has(end) ? placed(end) : null;
      return p ? `${p.fiscalYear}Q${p.quarter}` : null;
    },
    quarterNumber: (end) => placed(end)?.quarter ?? null,
  };
}

/** Latest-filed entry per key; an entry whose key is null (a period the fiscal calendar cannot place) is left out. */
function keepLatestFiled<K>(entries: UnitEntry[], keyOf: (e: UnitEntry) => K | null): Map<K, UnitEntry> {
  const m = new Map<K, UnitEntry>();
  for (const e of entries) {
    const k = keyOf(e);
    if (k == null) continue;
    const prev = m.get(k);
    if (!prev || e.filed > prev.filed) m.set(k, e);
  }
  return m;
}

const annualFlow = (entries: UnitEntry[]): Map<number, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-K" && e.start && daysBetween(e.start, e.end) >= 350 && daysBetween(e.start, e.end) <= 380),
    (e) => fiscalYearKey(e.end),
  );

const annualInstant = (entries: UnitEntry[], cal: FiscalCalendar): Map<number, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-K" && !e.start),
    (e) => cal.annualInstantKey(e.end),
  );

const quarterFlow = (entries: UnitEntry[], cal: FiscalCalendar): Map<string, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-Q" && e.start && daysBetween(e.start, e.end) >= 80 && daysBetween(e.start, e.end) <= 100),
    (e) => cal.quarterKey(e.end),
  );

const quarterInstant = (entries: UnitEntry[], cal: FiscalCalendar): Map<string, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-Q" && !e.start),
    (e) => cal.instantKey(e.end),
  );

// --- YTD reconstruction (the "10-Q cash-flow items are cumulative" trap) -----------------
//
// Income-statement concepts (revenue, operating income, ...) are tagged per discrete quarter,
// so quarterFlow above is all they need. But cash-flow-statement concepts (operating cash
// flow, capex, dividends paid, buybacks) plus D&A and interest expense are commonly tagged
// YEAR-TO-DATE in 10-Qs instead: a Q2 10-Q reports a ~180-day (6-month) cumulative figure, a
// Q3 10-Q a ~270-day (9-month) figure — both outside quarterFlow's ~90-day discrete-quarter
// filter, so it silently returns nothing for those quarters. Q1 is unaffected (YTD-ending-Q1
// *is* the discrete Q1 figure, already ~90 days).
//
// The fix: for the concepts that need it, reconstruct each discrete quarter as
//   Q1 = YTD ending Q1 (already discrete, no differencing needed)
//   Q2 = YTD ending Q2 (~180d) − YTD ending Q1 (~90d)
//   Q3 = YTD ending Q3 (~270d) − YTD ending Q2 (~180d)
// keyed by the fiscal quarter of the YTD entry's own period-end date (FiscalCalendar.quarterKey),
// same as quarterFlow. Q4 is left to the existing FY − (Q1+Q2+Q3) derivation below, which already
// works once Q1–Q3 are non-null here. A discrete tag, when one exists, always wins over a
// reconstructed value (some filers — and some concepts, e.g. LLY's interest expense — tag
// both; the true discrete figure is preferred to an equivalent-but-derived one).

type YtdBucket = "Q1" | "H1" | "9M";

/**
 * ~90d / ~180d / ~270d duration buckets a 10-Q YTD entry can fall into; null otherwise.
 *
 * Duration alone is NOT enough: a discrete Q3 entry (~90 days, ending Sep 30) matches the same
 * 80–100 day window as a true discrete Q1 (~90 days, ending Mar 31) — if a filer tags both,
 * whichever is filed later would otherwise win the "Q1" anchor slot in ytdByYear below, and
 * reconstructedQuarterFlow would silently compute Q2 = H1 − Q3 instead of H1 − Q1 (a wrong,
 * non-null number, not a null one — nothing downstream would flag it). So bucket
 * classification also requires the entry's period-end to actually fall in the FISCAL quarter the
 * bucket represents: an off-quarter ~90-day entry can never occupy the Q1 slot. Fiscal, not
 * calendar: V's and ATO's six-month YTD ends in March and the nine-month YTD in June (September
 * years), and ESAB's and ZBRA's first quarter ends in early April, so a calendar test dropped every
 * one of them and their fiscal Q2/Q3 cash flow, D&A and interest read null.
 */
function ytdBucketOf(days: number, end: string, cal: FiscalCalendar): YtdBucket | null {
  const q = cal.quarterNumber(end);
  if (days >= 80 && days <= 100 && q === 1) return "Q1";
  if (days >= 170 && days <= 190 && q === 2) return "H1";
  if (days >= 260 && days <= 280 && q === 3) return "9M";
  return null;
}

/**
 * Groups a concept's 10-Q entries by fiscal year and YTD bucket, keeping only the latest-filed
 * entry per (fiscal year, bucket) — mirroring keepLatestFiled. A fiscal year is identified by the
 * start date its YTD entries share, so only entries cumulating from the same start are differenced
 * (a stray duration that merely matches a bucket width has its own start and never joins a group).
 * Keying on the start, not the period-end's calendar year, keeps fiscal years that begin in the
 * prior calendar year: ADI's FY2026 YTD entries all start 2025-11-02, and a same-calendar-year
 * guard dropped every one of them, leaving its Q2/Q3 D&A, cash flow and EBITDA null.
 */
function ytdByYear(entries: UnitEntry[], cal: FiscalCalendar): Map<string, Partial<Record<YtdBucket, UnitEntry>>> {
  const byStart = new Map<string, Partial<Record<YtdBucket, UnitEntry>>>();
  for (const e of entries) {
    if (e.form !== "10-Q" || !e.start) continue;
    const bucket = ytdBucketOf(daysBetween(e.start, e.end), e.end, cal);
    if (!bucket) continue;
    if (!byStart.has(e.start)) byStart.set(e.start, {});
    const group = byStart.get(e.start)!;
    const prev = group[bucket];
    if (!prev || e.filed > prev.filed) group[bucket] = e;
  }
  return byStart;
}

/** Reconstructs discrete Q1/Q2/Q3 entries by differencing consecutive YTD entries, per fiscal year. */
function reconstructedQuarterFlow(entries: UnitEntry[], cal: FiscalCalendar): Map<string, UnitEntry> {
  const out = new Map<string, UnitEntry>();
  // Every bucketed entry has a placeable end (ytdBucketOf needs its fiscal quarter), so its key is never null.
  const keyOf = (e: UnitEntry) => cal.quarterKey(e.end)!;
  for (const { Q1, H1, "9M": nineMonth } of ytdByYear(entries, cal).values()) {
    if (Q1) out.set(keyOf(Q1), Q1); // YTD-ending-Q1 IS the discrete Q1 figure
    // `start` below is approximate (the prior quarter's end date, not its own start-of-quarter
    // day) — nothing downstream reads a reconstructed entry's `start`, so this is cosmetic.
    if (H1 && Q1) out.set(keyOf(H1), { ...H1, start: Q1.end, val: H1.val - Q1.val });
    if (nineMonth && H1) out.set(keyOf(nineMonth), { ...nineMonth, start: H1.end, val: nineMonth.val - H1.val });
  }
  return out;
}

/** quarterFlow, falling back to a YTD-differenced value when no discrete tag exists for that quarter. */
const quarterFlowWithYtdFallback = (entries: UnitEntry[], cal: FiscalCalendar): Map<string, UnitEntry> => {
  const merged = new Map(reconstructedQuarterFlow(entries, cal));
  for (const [key, entry] of quarterFlow(entries, cal)) merged.set(key, entry); // discrete tag wins when present
  return merged;
};

/**
 * Merges filtered per-concept period maps in priority order: for each period key, the value
 * comes from the highest-priority concept that has a datapoint for THAT period — not merely
 * the first concept in `concepts` that is tagged somewhere in the filing history. Iterates
 * lowest-priority first so each higher-priority map's entries overwrite on key collision.
 */
function mergeByPriority<K>(periodMaps: Map<K, UnitEntry>[]): Map<K, UnitEntry> {
  const merged = new Map<K, UnitEntry>();
  for (let i = periodMaps.length - 1; i >= 0; i--) {
    for (const [key, entry] of periodMaps[i]) merged.set(key, entry);
  }
  return merged;
}

/**
 * Total capex per period: the CAPEX_RAW base by priority, plus every CAPEX_EXTRA concept tagged for that
 * period — unless the base is the all-in PaymentsToAcquireProductiveAssets, which already includes them.
 * Extras without any base for the period are not turned into a capex figure. Pure.
 */
export function combineCapex<K>(base: Map<K, UnitEntry>[], extras: Map<K, UnitEntry>[]): Map<K, UnitEntry> {
  const out = new Map<K, UnitEntry>();
  const allInIdx = CAPEX_RAW.indexOf(CAPEX_ALL_IN);
  const keys = new Set<K>(base.flatMap((m) => [...m.keys()]));
  for (const k of keys) {
    const idx = base.findIndex((m) => m.has(k));
    const entry = base[idx].get(k)!;
    const add = idx === allInIdx ? 0 : extras.reduce((a, m) => a + (m.get(k)?.val ?? 0), 0);
    out.set(k, add ? { ...entry, val: entry.val + add } : entry);
  }
  return out;
}

/** A filer's companyfacts with the fiscal calendar its period keys are drawn from. */
interface FactsSource {
  facts: unknown;
  cal: FiscalCalendar;
}

function flowSeries({ facts, cal }: FactsSource, concepts: string[], unit: Unit = "USD") {
  const perConcept = concepts.map((c) => entriesFor(facts, c, unit));
  return {
    annual: mergeByPriority(perConcept.map(annualFlow)),
    quarter: mergeByPriority(perConcept.map((e) => quarterFlow(e, cal))),
  };
}
/**
 * Like flowSeries, but for concepts 10-Qs commonly tag year-to-date instead of per discrete
 * quarter (cash-flow-statement items, D&A, interest expense) — see quarterFlowWithYtdFallback.
 * Income-statement concepts (revenue, operating income, ...) must keep using plain flowSeries:
 * they're already discretely tagged, and running them through YTD differencing would be a
 * silent no-op at best and a double-difference bug at worst if a filer ever tags both.
 */
function flowSeriesYtd({ facts, cal }: FactsSource, concepts: string[], unit: Unit = "USD") {
  const perConcept = concepts.map((c) => entriesFor(facts, c, unit));
  return {
    annual: mergeByPriority(perConcept.map(annualFlow)),
    quarter: mergeByPriority(perConcept.map((e) => quarterFlowWithYtdFallback(e, cal))),
  };
}
function instantSeries({ facts, cal }: FactsSource, concepts: string[], unit: Unit = "USD") {
  const perConcept = concepts.map((c) => entriesFor(facts, c, unit));
  return {
    annual: mergeByPriority(perConcept.map((e) => annualInstant(e, cal))),
    quarter: mergeByPriority(perConcept.map((e) => quarterInstant(e, cal))),
  };
}

const at = <K>(m: Map<K, UnitEntry>, k: K): number | null => m.get(k)?.val ?? null;

/**
 * Effective net-revenue series for filers with no combined revenue concept (see NET_INTEREST_INCOME).
 * Keeps every period the primary REVENUE concepts cover, and for periods they miss, synthesizes an
 * entry from net interest income + noninterest income when BOTH are present (a real reported subtotal,
 * summed, not a fabricated number). The synthesized entry carries the NII entry's period-end/form so it
 * anchors an FY/quarter row exactly like a primary revenue entry would. A non-bank (no NII/noninterest
 * tags) gets its primary map back unchanged.
 */
function combineRevenue<K>(primary: Map<K, UnitEntry>, nii: Map<K, UnitEntry>, noninterest: Map<K, UnitEntry>): Map<K, UnitEntry> {
  const out = new Map(primary);
  for (const [key, niiEntry] of nii) {
    if (out.has(key)) continue;
    const nonintEntry = noninterest.get(key);
    if (!nonintEntry) continue;
    out.set(key, { ...niiEntry, val: niiEntry.val + nonintEntry.val });
  }
  return out;
}

/**
 * Effective D&A series. Keeps every period a combined D&A concept covers; for periods it misses,
 * synthesizes depreciation + amortization of intangibles from the filer's own component tags (a sum of
 * reported figures, not an estimate). Amortization is required for that period whenever the filer tags it
 * anywhere — a period with depreciation but no amortization is left empty rather than understated. Only a
 * filer that never tags intangible amortization (no intangibles) gets depreciation alone.
 */
function combineDa<K>(primary: Map<K, UnitEntry>, depreciation: Map<K, UnitEntry>, amortization: Map<K, UnitEntry>, filerTagsAmortization: boolean): Map<K, UnitEntry> {
  const out = new Map(primary);
  for (const [key, dep] of depreciation) {
    if (out.has(key)) continue;
    const amort = amortization.get(key);
    if (!amort && filerTagsAmortization) continue;
    out.set(key, { ...dep, val: dep.val + (amort?.val ?? 0) });
  }
  return out;
}

/**
 * Fill net-income gaps with parent-attributable net income derived from ProfitLoss.
 *
 * Some filers (e.g. Bloom Energy) tag consolidated net income only as us-gaap:ProfitLoss
 * (which INCLUDES noncontrolling interests) and stop tagging us-gaap:NetIncomeLoss
 * (the parent-attributable figure) after an early year. `primary` (NetIncomeLoss) is kept
 * wherever it exists, so the historical series is unchanged; only the missing periods are
 * filled with ProfitLoss − NetIncomeLossAttributableToNoncontrollingInterest, which equals
 * the parent-attributable net income and stays consistent with the pre-gap history. A filer
 * with no ProfitLoss tag (the common case) gets its primary map back unchanged.
 */
function fillNetIncomeFromProfitLoss<K>(primary: Map<K, UnitEntry>, profitLoss: Map<K, UnitEntry>, nci: Map<K, UnitEntry>): Map<K, UnitEntry> {
  const out = new Map(primary);
  for (const [key, plEntry] of profitLoss) {
    if (out.has(key)) continue;
    out.set(key, { ...plEntry, val: plEntry.val - (nci.get(key)?.val ?? 0) });
  }
  return out;
}

// --- derivation (shared by annual rows and real quarter rows) ----------

interface RawValues {
  revenue: number | null;
  cogs: number | null;
  grossProfitDirect: number | null;
  operatingIncomeDirect: number | null;
  pretax: number | null;
  nonoperating: number | null;
  netInterestNonoperating: number | null;
  faceInterestExpense: number | null;
  otherNonoperating: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  da: number | null;
  interestExpense: number | null;
  cashAndStDirect: number | null;
  cash: number | null;
  shortTermInvestments: number | null;
  ltdNoncurrent: number | null;
  ltdTotal: number | null;
  ltdLeaseNoncurrent: number | null;
  ltdCurrent: number | null;
  debtCurrent: number | null;
  shortTermBorrowings: number | null;
  convertibleNoncurrent: number | null;
  convertibleCurrent: number | null;
  ltdLeaseTotal: number | null;
  combinedTotal: number | null;
  unsecuredLtd: number | null;
  fhlbAdvances: number | null;
  shortTermBorrowingsTotal: number | null;
  totalEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  ocf: number | null;
  capexRaw: number | null;
  buybacksRaw: number | null;
  dividendsRaw: number | null;
}

type DerivedFields = Omit<SecPeriod, "fiscal_period" | "fiscal_year" | "report_date">;

/**
 * Total debt for one period, by the first concept group that reports it:
 *   0. both lease lines (noncurrent and including-current) report the period with the SAME value → that value is
 *      the all-in balance-sheet line (CVX, SCHW); add only short-term borrowings / commercial paper, never DebtCurrent;
 *   1. LongTermDebtNoncurrent + all current debt;
 *   1b. the two FACE lines, LongTermDebtAndCapitalLeaseObligations (noncurrent) + DebtCurrent, when both report:
 *      their sum is the balance-sheet total (TMO FY2025: 35,852 + 3,533 = 39,385; GE: 18,808 + 1,686 = 20,494),
 *      and it outranks the note's LongTermDebt, which includes the current maturities but not finance leases
 *      (TMO 39,172 — 213 short of the balance sheet, or 42,705 if DebtCurrent were re-added);
 *   2. LongTermDebt (already holds its current portion) + non-long-term current debt only;
 *   3. LongTermDebtAndCapitalLeaseObligations (noncurrent) + all current debt (RTX, BSX);
 *   4. …IncludingCurrentMaturities alone when it is the only lease line (holds its current portion) + non-long-term current debt only;
 *   5. DebtLongtermAndShorttermCombinedAmount alone (it is the whole figure);
 *   6. UnsecuredLongTermDebt + all current debt;
 *   7. convertible notes: noncurrent convertibles + all current debt (else current convertibles);
 *   8. current debt alone. A zero current-only figure is null when the filer tags a long-term concept in some
 *      other period of the series (a gap in the tags, e.g. CME FY2023 before UnsecuredLongTermDebt is read); a
 *      filer that never tags a long-term concept (DSP, PLTR, RDVT, LASR, AMSC) keeps its honest 0.
 * FHLB advances (a bank's own face line) are added on rules 0, 3 and 4 only, where neither DebtCurrent nor the
 * plain ShortTermBorrowings concept reports (either can already hold them).
 * Null when no debt concept reports the period.
 */
export function deriveTotalDebt(
  r: Pick<
    RawValues,
    | "ltdNoncurrent" | "ltdTotal" | "ltdLeaseNoncurrent" | "ltdCurrent" | "debtCurrent" | "shortTermBorrowings"
    | "convertibleNoncurrent" | "convertibleCurrent" | "ltdLeaseTotal" | "combinedTotal" | "unsecuredLtd"
  > & Partial<Pick<RawValues, "fhlbAdvances" | "shortTermBorrowingsTotal">>,
  opts: { filerTagsLongTerm: boolean },
): number | null {
  const otherCurrent =
    r.debtCurrent != null && r.ltdCurrent != null ? r.debtCurrent - r.ltdCurrent : r.shortTermBorrowings;
  const allCurrent =
    r.debtCurrent ??
    (r.ltdCurrent == null && r.shortTermBorrowings == null ? null : (r.ltdCurrent ?? 0) + (r.shortTermBorrowings ?? 0));
  const fhlb = r.debtCurrent == null && r.shortTermBorrowingsTotal == null ? (r.fhlbAdvances ?? 0) : 0;
  if (r.ltdLeaseTotal != null && r.ltdLeaseNoncurrent != null && r.ltdLeaseTotal === r.ltdLeaseNoncurrent)
    return r.ltdLeaseTotal + (r.shortTermBorrowings ?? 0) + fhlb;
  if (r.ltdNoncurrent != null) return r.ltdNoncurrent + (allCurrent ?? 0);
  if (r.ltdLeaseNoncurrent != null && r.debtCurrent != null) return r.ltdLeaseNoncurrent + r.debtCurrent;
  if (r.ltdTotal != null) return r.ltdTotal + (otherCurrent ?? 0);
  if (r.ltdLeaseNoncurrent != null) return r.ltdLeaseNoncurrent + (allCurrent ?? 0) + fhlb;
  if (r.ltdLeaseTotal != null) return r.ltdLeaseTotal + (otherCurrent ?? 0) + fhlb;
  if (r.combinedTotal != null) return r.combinedTotal;
  if (r.unsecuredLtd != null) return r.unsecuredLtd + (allCurrent ?? 0);
  const current = allCurrent ?? r.convertibleCurrent;
  if (r.convertibleNoncurrent != null) return r.convertibleNoncurrent + (current ?? 0);
  if (current == null) return null;
  return current === 0 && opts.filerTagsLongTerm ? null : current;
}

/**
 * How the third operating-income tier reads a filer, decided once for the whole filer so a fiscal year
 * and its quarters never mix methods (Q4 is FY − Q1..Q3): "net" subtracts the net interest line, "gross"
 * adds back the face interest expense, null means the tier does not apply.
 */
export interface PretaxTier {
  interest: "net" | "gross";
  subtractsOther: boolean; // the filer tags OtherNonoperatingIncomeExpense, so every period must carry it
}

/**
 * Operating income for a filer that tags neither OperatingIncomeLoss nor NonoperatingIncomeExpense:
 * pretax income, less net interest income (or plus the face interest expense), less other nonoperating
 * income. Null when a line the filer's method needs is missing for the period, and when the result is
 * larger than revenue or gross profit, which no operating income can be.
 */
export function deriveOperatingIncomeFromPretax(
  r: Pick<RawValues, "revenue" | "cogs" | "grossProfitDirect" | "pretax" | "netInterestNonoperating" | "faceInterestExpense" | "otherNonoperating">,
  tier: PretaxTier | null,
): number | null {
  if (!tier || r.pretax == null) return null;
  const interest = tier.interest === "net" ? (r.netInterestNonoperating == null ? null : -r.netInterestNonoperating) : r.faceInterestExpense;
  if (interest == null || (tier.subtractsOther && r.otherNonoperating == null)) return null;
  const operatingIncome = r.pretax + interest - (tier.subtractsOther ? r.otherNonoperating! : 0);
  const grossProfit = r.grossProfitDirect ?? (r.revenue != null && r.cogs != null ? r.revenue - r.cogs : null);
  if (r.revenue != null && Math.abs(operatingIncome) > Math.abs(r.revenue)) return null;
  if (grossProfit != null && operatingIncome > grossProfit) return null;
  return operatingIncome;
}

function deriveFields(r: RawValues, opts: { filerTagsLongTerm: boolean; pretaxTier: PretaxTier | null }): DerivedFields {
  const grossProfit = r.grossProfitDirect ?? (r.revenue != null && r.cogs != null ? r.revenue - r.cogs : null);
  const operatingIncome =
    r.operatingIncomeDirect ?? (r.pretax != null && r.nonoperating != null ? r.pretax - r.nonoperating : deriveOperatingIncomeFromPretax(r, opts.pretaxTier));
  const ebitda = operatingIncome != null && r.da != null ? operatingIncome + r.da : null;
  // Some filers stop separately tagging short-term investments once the balance is immaterial (LLY: no
  // ShortTermInvestments entry for FY2025, though every prior year back to 2008 has one). Falling back to
  // `null` there would make mapStatements' required "cashAndInvestments" column throw for a filer that
  // plainly reports cash. Cash alone is a real, non-fabricated subset of the combined figure, so it's
  // never null merely because the STI leg wasn't separately disclosed for that period.
  const cashAndShortTermInvestments =
    r.cashAndStDirect ?? (r.cash != null ? r.cash + (r.shortTermInvestments ?? 0) : null);
  const totalDebt = deriveTotalDebt(r, opts);
  const netDebt = totalDebt != null && r.cash != null ? totalDebt - r.cash : null;
  const capex = r.capexRaw != null ? -r.capexRaw : null;
  const commonStockRepurchased = r.buybacksRaw != null ? -r.buybacksRaw : null;
  const commonDividendsPaid = r.dividendsRaw != null ? -r.dividendsRaw : null;
  const freeCashFlow = r.ocf != null && capex != null ? r.ocf + capex : null;

  return {
    revenue: r.revenue,
    gross_profit: grossProfit,
    operating_income: operatingIncome,
    ebitda,
    net_income: r.netIncome,
    eps_diluted: r.epsDiluted,
    interest_expense: r.interestExpense,
    cash_and_short_term_investments: cashAndShortTermInvestments,
    cash: r.cash,
    total_debt: totalDebt,
    net_debt: netDebt,
    total_equity: r.totalEquity,
    total_current_assets: r.currentAssets,
    total_current_liabilities: r.currentLiabilities,
    operating_cash_flow: r.ocf,
    capex,
    common_stock_repurchased: commonStockRepurchased,
    common_dividends_paid: commonDividendsPaid,
    free_cash_flow: freeCashFlow,
  };
}

// --- assembly ------------------------------------------------------------

const FLOW_FIELDS: (keyof DerivedFields)[] = [
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "ebitda",
  "operating_cash_flow",
  "capex",
  "common_dividends_paid",
  "common_stock_repurchased",
  "interest_expense",
  "eps_diluted",
];
const INSTANT_FIELDS: (keyof DerivedFields)[] = [
  "cash_and_short_term_investments",
  "cash",
  "total_debt",
  "net_debt",
  "total_equity",
  "total_current_assets",
  "total_current_liabilities",
];

/**
 * One series for the whole filer. Only a concept that reports the filer's latest fiscal year qualifies, so a tag
 * the filer has since renamed cannot supply or blank the recent years. Among those, the one tagged in the most
 * periods of the last two years wins (the face line is in every 10-Q, a note line often only in the 10-K), list
 * order breaking ties. A note line tagged as often as the face line is indistinguishable here and can still win.
 */
function bestCoveredSeries(src: FactsSource, concepts: string[]) {
  const all = concepts.map((c) => flowSeriesYtd(src, [c]));
  const latest = Math.max(...all.flatMap((x) => [...x.annual.keys()]));
  const recent = (x: (typeof all)[number]) =>
    [...x.annual.keys()].filter((y) => y >= latest - 1).length + [...x.quarter.keys()].filter((k) => Number.parseInt(String(k), 10) >= latest - 1).length;
  const current = all.filter((x) => x.annual.has(latest));
  return current.length ? current.reduce((best, x) => (recent(x) > recent(best) ? x : best)) : all[0];
}

/** SIC division H (finance, insurance, real estate): interest expense is a funding cost, not a financing line below operating income. */
const sicIsFinancial = (sic: number) => sic >= 6000 && sic <= 6799;

export function parseCompanyFacts(facts: unknown, opts: { sic?: number | null } = {}): { annual: SecPeriod[]; quarter: SecPeriod[] } {
  const src: FactsSource = { facts, cal: fiscalCalendar(facts) };
  const revenuePrimary = flowSeries(src, REVENUE);
  const netInterestIncome = flowSeries(src, NET_INTEREST_INCOME);
  const noninterestIncome = flowSeries(src, NONINTEREST_INCOME);
  // For a bank that tags no combined revenue concept, fill the gaps with net interest income +
  // noninterest income so the FY/quarter rows anchor on live periods, not a stale fee-only line.
  const revenue = {
    annual: combineRevenue(revenuePrimary.annual, netInterestIncome.annual, noninterestIncome.annual),
    quarter: combineRevenue(revenuePrimary.quarter, netInterestIncome.quarter, noninterestIncome.quarter),
  };
  const cogs = flowSeries(src, COGS);
  const grossProfitDirect = flowSeries(src, GROSS_PROFIT);
  const operatingIncomeDirect = flowSeries(src, OPERATING_INCOME);
  const pretax = flowSeries(src, PRETAX_INCOME);
  const nonoperating = flowSeries(src, NONOPERATING_INCOME_EXPENSE);
  // Interest lines are often tagged year-to-date in 10-Qs, like INTEREST_EXPENSE below. Each is ONE concept for
  // the filer: a 10-K note line of 120 beside a face line of 100 that the 10-Qs also carry must not give the
  // fiscal year one basis and its quarters another.
  const netInterestNonoperating = bestCoveredSeries(src, NET_INTEREST_NONOPERATING);
  const faceInterestExpense = bestCoveredSeries(src, FACE_INTEREST_EXPENSE);
  const otherNonoperating = flowSeriesYtd(src, OTHER_NONOPERATING);
  const costsAndExpenses = flowSeries(src, COSTS_AND_EXPENSES);
  // The third tier applies to a filer only when nothing in its history rules it out:
  //  - it tags tier one or two anywhere (DOW's one quarter without NonoperatingIncomeExpense must stay null);
  //  - it is bank-like, or its SIC is financial or unknown, so its interest expense may be a funding cost (CFG,
  //    SCHW; a lender with no bank tags read pretax 200 + interest 300 = 500 on revenue of 1,000);
  //  - it tags equity-method income, which XBRL cannot place above or below the operating line (HASI read
  //    an operating income of 141% of revenue; XOM, CVX about a quarter too high);
  //  - any period is single-step, revenue − CostsAndExpenses = pretax income, so other income sits in revenue.
  const tagged = (x: { annual: Map<unknown, unknown>; quarter: Map<unknown, unknown> }) => x.annual.size > 0 || x.quarter.size > 0;
  const singleStep = (["annual", "quarter"] as const).some((side) =>
    [...(pretax[side] as Map<unknown, UnitEntry>).entries()].some(([key, p]) => {
      const rev = (revenue[side] as Map<unknown, UnitEntry>).get(key)?.val;
      const costs = (costsAndExpenses[side] as Map<unknown, UnitEntry>).get(key)?.val;
      return rev != null && costs != null && Math.abs(rev - costs - p.val) <= Math.abs(p.val) * 0.001;
    }),
  );
  const pretaxTier: PretaxTier | null =
    opts.sic == null || sicIsFinancial(opts.sic) || [operatingIncomeDirect, nonoperating, netInterestIncome, noninterestIncome, flowSeries(src, EQUITY_METHOD_INCOME)].some(tagged) || singleStep
      ? null
      : { interest: tagged(netInterestNonoperating) ? "net" : "gross", subtractsOther: tagged(otherNonoperating) };
  // Parent-attributable net income. Prefer NetIncomeLoss; for filers that tag only ProfitLoss
  // (incl. noncontrolling interests), fill the gaps with ProfitLoss − NCI (see helper).
  const netIncomeDirect = flowSeries(src, NET_INCOME);
  const profitLoss = flowSeries(src, PROFIT_LOSS);
  const nci = flowSeries(src, NCI);
  const netIncome = {
    annual: fillNetIncomeFromProfitLoss(netIncomeDirect.annual, profitLoss.annual, nci.annual),
    quarter: fillNetIncomeFromProfitLoss(netIncomeDirect.quarter, profitLoss.quarter, nci.quarter),
  };
  const epsDiluted = flowSeries(src, EPS_DILUTED, "USD/shares");
  // These six are commonly tagged year-to-date rather than per discrete quarter in 10-Qs (see
  // flowSeriesYtd / quarterFlowWithYtdFallback above); the rest of the flow concepts above are
  // income-statement items filers already tag discretely and must NOT go through YTD
  // differencing.
  const daPrimary = flowSeriesYtd(src, DA);
  const depreciation = flowSeriesYtd(src, DEPRECIATION);
  const amortization = flowSeriesYtd(src, AMORTIZATION_INTANGIBLES);
  const tagsAmortization = amortization.annual.size > 0 || amortization.quarter.size > 0;
  const da = {
    annual: combineDa(daPrimary.annual, depreciation.annual, amortization.annual, tagsAmortization),
    quarter: combineDa(daPrimary.quarter, depreciation.quarter, amortization.quarter, tagsAmortization),
  };
  const interestExpense = flowSeriesYtd(src, INTEREST_EXPENSE);
  const ocf = flowSeriesYtd(src, OCF);
  const capexBase = CAPEX_RAW.map((c) => flowSeriesYtd(src, [c]));
  const capexExtra = CAPEX_EXTRA.map((c) => flowSeriesYtd(src, [c]));
  const capexRaw = {
    annual: combineCapex(capexBase.map((x) => x.annual), capexExtra.map((x) => x.annual)),
    quarter: combineCapex(capexBase.map((x) => x.quarter), capexExtra.map((x) => x.quarter)),
  };
  const buybacksRaw = flowSeriesYtd(src, BUYBACKS_RAW);
  const dividendsRaw = flowSeriesYtd(src, DIVIDENDS_RAW);

  const cashAndStDirect = instantSeries(src, CASH_AND_ST_INVESTMENTS);
  const cash = instantSeries(src, CASH);
  const shortTermInvestments = instantSeries(src, SHORT_TERM_INVESTMENTS);
  const ltdNoncurrent = instantSeries(src, LTD_NONCURRENT);
  const ltdTotal = instantSeries(src, LTD_TOTAL);
  const ltdLeaseNoncurrent = instantSeries(src, LTD_LEASE_NONCURRENT);
  const ltdCurrent = instantSeries(src, LTD_CURRENT);
  const debtCurrent = instantSeries(src, DEBT_CURRENT);
  const shortTermBorrowings = instantSeries(src, SHORT_TERM_BORROWINGS);
  const convertibleNoncurrent = instantSeries(src, CONVERTIBLE_NONCURRENT);
  const convertibleCurrent = instantSeries(src, CONVERTIBLE_CURRENT);
  const ltdLeaseTotal = instantSeries(src, LTD_LEASE_TOTAL);
  const combinedTotal = instantSeries(src, DEBT_COMBINED_TOTAL);
  const unsecuredLtd = instantSeries(src, UNSECURED_LTD);
  const fhlbAdvances = instantSeries(src, FHLB_ADVANCES);
  const shortTermBorrowingsTotal = instantSeries(src, SHORT_TERM_BORROWINGS_TOTAL);
  // Does the filer tag ANY long-term debt concept anywhere in its history? Decides whether a zero current-only
  // period is a gap (null) or an honest zero (see deriveTotalDebt rule 8). Modelled on combineDa's tagsAmortization.
  const filerTagsLongTerm = [ltdNoncurrent, ltdTotal, ltdLeaseNoncurrent, ltdLeaseTotal, combinedTotal, unsecuredLtd, convertibleNoncurrent]
    .some((s) => s.annual.size > 0 || s.quarter.size > 0);
  const totalEquity = instantSeries(src, TOTAL_EQUITY);
  const currentAssets = instantSeries(src, CURRENT_ASSETS);
  const currentLiabilities = instantSeries(src, CURRENT_LIABILITIES);

  if (revenue.annual.size === 0 && revenue.quarter.size === 0) {
    throw new Error(`No revenue concept found among: ${REVENUE.join(", ")} (nor derivable from ${NET_INTEREST_INCOME[0]} + ${NONINTEREST_INCOME[0]})`);
  }
  if (netIncome.annual.size === 0 && netIncome.quarter.size === 0) {
    throw new Error(`No net income concept found among: ${NET_INCOME.join(", ")} (nor derivable from ${PROFIT_LOSS[0]} − ${NCI[0]})`);
  }

  const rawAt = <K>(key: K, side: "annual" | "quarter"): RawValues => ({
    revenue: at(revenue[side] as Map<K, UnitEntry>, key),
    cogs: at(cogs[side] as Map<K, UnitEntry>, key),
    grossProfitDirect: at(grossProfitDirect[side] as Map<K, UnitEntry>, key),
    operatingIncomeDirect: at(operatingIncomeDirect[side] as Map<K, UnitEntry>, key),
    pretax: at(pretax[side] as Map<K, UnitEntry>, key),
    nonoperating: at(nonoperating[side] as Map<K, UnitEntry>, key),
    netInterestNonoperating: at(netInterestNonoperating[side] as Map<K, UnitEntry>, key),
    faceInterestExpense: at(faceInterestExpense[side] as Map<K, UnitEntry>, key),
    otherNonoperating: at(otherNonoperating[side] as Map<K, UnitEntry>, key),
    netIncome: at(netIncome[side] as Map<K, UnitEntry>, key),
    epsDiluted: at(epsDiluted[side] as Map<K, UnitEntry>, key),
    da: at(da[side] as Map<K, UnitEntry>, key),
    interestExpense: at(interestExpense[side] as Map<K, UnitEntry>, key),
    cashAndStDirect: at(cashAndStDirect[side] as Map<K, UnitEntry>, key),
    cash: at(cash[side] as Map<K, UnitEntry>, key),
    shortTermInvestments: at(shortTermInvestments[side] as Map<K, UnitEntry>, key),
    ltdNoncurrent: at(ltdNoncurrent[side] as Map<K, UnitEntry>, key),
    ltdTotal: at(ltdTotal[side] as Map<K, UnitEntry>, key),
    ltdLeaseNoncurrent: at(ltdLeaseNoncurrent[side] as Map<K, UnitEntry>, key),
    ltdCurrent: at(ltdCurrent[side] as Map<K, UnitEntry>, key),
    debtCurrent: at(debtCurrent[side] as Map<K, UnitEntry>, key),
    shortTermBorrowings: at(shortTermBorrowings[side] as Map<K, UnitEntry>, key),
    convertibleNoncurrent: at(convertibleNoncurrent[side] as Map<K, UnitEntry>, key),
    convertibleCurrent: at(convertibleCurrent[side] as Map<K, UnitEntry>, key),
    ltdLeaseTotal: at(ltdLeaseTotal[side] as Map<K, UnitEntry>, key),
    combinedTotal: at(combinedTotal[side] as Map<K, UnitEntry>, key),
    unsecuredLtd: at(unsecuredLtd[side] as Map<K, UnitEntry>, key),
    fhlbAdvances: at(fhlbAdvances[side] as Map<K, UnitEntry>, key),
    shortTermBorrowingsTotal: at(shortTermBorrowingsTotal[side] as Map<K, UnitEntry>, key),
    totalEquity: at(totalEquity[side] as Map<K, UnitEntry>, key),
    currentAssets: at(currentAssets[side] as Map<K, UnitEntry>, key),
    currentLiabilities: at(currentLiabilities[side] as Map<K, UnitEntry>, key),
    ocf: at(ocf[side] as Map<K, UnitEntry>, key),
    capexRaw: at(capexRaw[side] as Map<K, UnitEntry>, key),
    buybacksRaw: at(buybacksRaw[side] as Map<K, UnitEntry>, key),
    dividendsRaw: at(dividendsRaw[side] as Map<K, UnitEntry>, key),
  });

  // Annual (FY) rows, anchored on the fiscal years the revenue concept reports. The row's label stays the
  // calendar year of its end (see yearOf above), so USFD's fiscal 2020 (ended 2021-01-02) is still "2021" and
  // its fiscal 2021 (ended 2022-01-01), no longer dropped, is labelled "2022" beside fiscal 2022.
  const annualYears = [...revenue.annual.keys()].sort((a, b) => a - b);
  const annual: SecPeriod[] = annualYears.map((year) => {
    const end = revenue.annual.get(year)!.end;
    return {
      fiscal_period: "FY",
      fiscal_year: yearOf(end),
      report_date: end,
      ...deriveFields(rawAt(year, "annual"), { filerTagsLongTerm, pretaxTier }),
    };
  });
  // Real quarterly rows, anchored on the quarters the revenue concept reports: Q1-Q3, and the rare Q4 a
  // 10-Q re-reports (RTX's 2020 10-Qs recast Q4 2019). Labelled by the calendar quarter of the end.
  const quarterKeys = [...revenue.quarter.keys()].sort();
  const realQuarters: { key: string; row: SecPeriod }[] = quarterKeys.map((key) => {
    const end = revenue.quarter.get(key)!.end;
    return {
      key,
      row: {
        fiscal_period: `Q${quarterOf(end)}`,
        fiscal_year: yearOf(end),
        report_date: end,
        ...deriveFields(rawAt(key, "quarter"), { filerTagsLongTerm, pretaxTier }),
      },
    };
  });

  const byReportDate = (a: SecPeriod, b: SecPeriod) => (a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : 0);

  // Derive Q4 = FY − (Q1 + Q2 + Q3), one per fiscal year whose three earlier quarters are present.
  // The composing quarters are the ones keyed to that FISCAL year (`<year>Q1`..`<year>Q3`), not to a
  // calendar year: a non-December fiscal year-end (e.g. Lam Research's late-June year) spreads them
  // across two calendar years, and the final quarter (the latest quarter when the primary filing is
  // a 10-K) would otherwise never be derived. A quarter in a fiscal-year-end change has no key, so a
  // year it would belong to gets no Q4 rather than one composed across two fiscal calendars. A year
  // whose Q4 a 10-Q already reports keeps that real row, so no two rows share a date; the derived values
  // only fill what the recast left untagged (RTX's 2020 10-Qs re-report Q4 2019 revenue and operating
  // income but not net income or cash flow), and only when the two agree on revenue, so one row never
  // mixes a recast basis with the 10-K's.
  const derivedQ4: SecPeriod[] = [];
  const realByKey = new Map(realQuarters.map((q) => [q.key, q.row]));
  const realByDate = new Map(realQuarters.map((q) => [q.row.report_date, q.row]));
  annualYears.forEach((year, i) => {
    const fyRow = annual[i];
    const fyEnd = fyRow.report_date;
    const [q1, q2, q3] = [1, 2, 3].map((n) => realByKey.get(`${year}Q${n}`));
    if (!q1 || !q2 || !q3) return;

    // NOTE: for eps_diluted specifically, FY − (Q1+Q2+Q3) is an approximation, not an exact
    // Q4 figure — diluted share counts (the EPS denominator) differ quarter to quarter, so this
    // subtraction doesn't reflect Q4's own weighted-average share count. It feeds ttm.pe_ratio
    // (via the last four quarters' eps_diluted sum), so that figure is an approximation too, not
    // an exact TTM EPS.
    const sub = (field: keyof DerivedFields): number | null => {
      const fy = fyRow[field], a = q1[field], b = q2[field], c = q3[field];
      return fy == null || a == null || b == null || c == null ? null : (fy as number) - ((a as number) + (b as number) + (c as number));
    };
    const q4Partial = Object.fromEntries(FLOW_FIELDS.map((f) => [f, sub(f)])) as Pick<DerivedFields, (typeof FLOW_FIELDS)[number]>;
    const instantPartial = Object.fromEntries(INSTANT_FIELDS.map((f) => [f, fyRow[f]])) as Pick<DerivedFields, (typeof INSTANT_FIELDS)[number]>;
    const real = realByDate.get(fyEnd);
    if (real) {
      const derivedRevenue = q4Partial.revenue;
      if (derivedRevenue == null || real.revenue == null || Math.abs(derivedRevenue - real.revenue) > Math.abs(real.revenue) * 0.005) return;
      for (const [field, value] of Object.entries({ ...q4Partial, ...instantPartial }) as [keyof DerivedFields, number | null][]) {
        if (real[field] == null && value != null) (real as Record<keyof DerivedFields, number | null>)[field] = value;
      }
      return;
    }
    derivedQ4.push({
      fiscal_period: "Q4",
      fiscal_year: fyRow.fiscal_year,
      report_date: fyEnd,
      ...q4Partial,
      ...instantPartial,
    });
  });

  const quarter = [...realQuarters.map((q) => q.row), ...derivedQ4].sort(byReportDate);
  annual.sort(byReportDate);

  return { annual, quarter };
}

export async function fetchCompanyFacts(cik: number, contact: string, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
  return edgarJson(url, contact, fetchImpl);
}
