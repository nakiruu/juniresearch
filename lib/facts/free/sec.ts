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
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
];
const COGS = ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"];
const GROSS_PROFIT = ["GrossProfit"]; // else derived: revenue − COGS
const OPERATING_INCOME = ["OperatingIncomeLoss"]; // else derived: pretax income − nonoperating income/expense
// Helper concepts for the operating_income fallback (LLY tags neither OperatingIncomeLoss
// nor GrossProfit — its income statement has no such subtotal lines in XBRL).
const PRETAX_INCOME = [
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeBeforeIncomeTaxesMinorityInterestAndCumulativeEffectOfChangeInAccountingPrinciple",
];
const NONOPERATING_INCOME_EXPENSE = ["NonoperatingIncomeExpense"];
const NET_INCOME = ["NetIncomeLoss"];
const EPS_DILUTED = ["EarningsPerShareDiluted"];
const DA = ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"];
const INTEREST_EXPENSE = ["InterestExpense", "InterestExpenseNonoperating"];
const CASH_AND_ST_INVESTMENTS = ["CashCashEquivalentsAndShortTermInvestments"]; // else derived: cash + ST investments
const CASH = ["CashAndCashEquivalentsAtCarryingValue"];
// LLY's real companyfacts (2026-09-16 fetch) confirms ShortTermInvestments is the only STI concept it has
// ever tagged; the others are appended for filers that use them instead. Priority order matters only when
// two concepts both report the same period (see mergeByPriority) — a stale/unused concept here can't shadow
// a live one for a period it doesn't cover.
const SHORT_TERM_INVESTMENTS = ["ShortTermInvestments", "AvailableForSaleSecuritiesCurrent", "MarketableSecuritiesCurrent", "OtherShortTermInvestments"];
const LTD_NONCURRENT = ["LongTermDebtNoncurrent", "LongTermDebt"];
const LTD_CURRENT = ["LongTermDebtCurrent", "DebtCurrent"];
const SHORT_TERM_BORROWINGS = ["ShortTermBorrowings", "CommercialPaper"];
const TOTAL_EQUITY = ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"];
const CURRENT_ASSETS = ["AssetsCurrent"];
const CURRENT_LIABILITIES = ["LiabilitiesCurrent"];
const OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
// LLY tags neither of the spec's two concepts for its current capex line; it uses "other
// property, plant and equipment" instead. Appended at lowest priority — per-period merging
// (see mergeByPriority) means this is only reached for periods neither spec concept covers.
const CAPEX_RAW = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquireOtherPropertyPlantAndEquipment"];
const BUYBACKS_RAW = ["PaymentsForRepurchaseOfCommonStock"];
const DIVIDENDS_RAW = ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"];

// --- concept selection --------------------------------------------------

/** Returns one concept's raw unit-entry array (empty if that concept is untagged). */
function entriesFor(facts: unknown, concept: string, unit: Unit = "USD"): UnitEntry[] {
  const gaap = (facts as CompanyFactsShape)?.facts?.["us-gaap"];
  return gaap?.[concept]?.units?.[unit] ?? [];
}

// --- period selection (the XBRL "fy-means-filing-year" trap) -----------

const yearOf = (date: string) => Number(date.slice(0, 4));
const daysBetween = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000;
const quarterOf = (end: string) => Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1;
const quarterKey = (end: string) => `${yearOf(end)}Q${quarterOf(end)}`;

function keepLatestFiled<K>(entries: UnitEntry[], keyOf: (e: UnitEntry) => K): Map<K, UnitEntry> {
  const m = new Map<K, UnitEntry>();
  for (const e of entries) {
    const k = keyOf(e);
    const prev = m.get(k);
    if (!prev || e.filed > prev.filed) m.set(k, e);
  }
  return m;
}

const annualFlow = (entries: UnitEntry[]): Map<number, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-K" && e.start && daysBetween(e.start, e.end) >= 350 && daysBetween(e.start, e.end) <= 380),
    (e) => yearOf(e.end),
  );

const annualInstant = (entries: UnitEntry[]): Map<number, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-K" && !e.start),
    (e) => yearOf(e.end),
  );

const quarterFlow = (entries: UnitEntry[]): Map<string, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-Q" && e.start && daysBetween(e.start, e.end) >= 80 && daysBetween(e.start, e.end) <= 100),
    (e) => quarterKey(e.end),
  );

const quarterInstant = (entries: UnitEntry[]): Map<string, UnitEntry> =>
  keepLatestFiled(
    entries.filter((e) => e.form === "10-Q" && !e.start),
    (e) => quarterKey(e.end),
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
// keyed by the calendar quarter of the YTD entry's own period-end date (quarterKey), same as
// quarterFlow. Q4 is left to the existing FY − (Q1+Q2+Q3) derivation below, which already
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
 * classification also requires the entry's period-end to actually fall in the calendar quarter
 * the bucket represents: an off-quarter ~90-day entry can never occupy the Q1 slot.
 */
function ytdBucketOf(days: number, end: string): YtdBucket | null {
  const q = quarterOf(end);
  if (days >= 80 && days <= 100 && q === 1) return "Q1";
  if (days >= 170 && days <= 190 && q === 2) return "H1";
  if (days >= 260 && days <= 280 && q === 3) return "9M";
  return null;
}

/**
 * Groups a concept's 10-Q entries by fiscal year (the period-end's calendar year) and YTD
 * bucket, keeping only the latest-filed entry per (year, bucket) — mirroring keepLatestFiled.
 * Only entries whose start falls in the same calendar year as their end are considered "YTD"
 * (guards against stray cross-year durations coincidentally matching a bucket width).
 */
function ytdByYear(entries: UnitEntry[]): Map<number, Partial<Record<YtdBucket, UnitEntry>>> {
  const latestPerKey = new Map<string, UnitEntry>();
  for (const e of entries) {
    if (e.form !== "10-Q" || !e.start || yearOf(e.start) !== yearOf(e.end)) continue;
    const bucket = ytdBucketOf(daysBetween(e.start, e.end), e.end);
    if (!bucket) continue;
    const key = `${yearOf(e.end)}:${bucket}`;
    const prev = latestPerKey.get(key);
    if (!prev || e.filed > prev.filed) latestPerKey.set(key, e);
  }
  const byYear = new Map<number, Partial<Record<YtdBucket, UnitEntry>>>();
  for (const [key, entry] of latestPerKey) {
    const [yearStr, bucket] = key.split(":") as [string, YtdBucket];
    const year = Number(yearStr);
    if (!byYear.has(year)) byYear.set(year, {});
    byYear.get(year)![bucket] = entry;
  }
  return byYear;
}

/** Reconstructs discrete Q1/Q2/Q3 entries by differencing consecutive YTD entries, per fiscal year. */
function reconstructedQuarterFlow(entries: UnitEntry[]): Map<string, UnitEntry> {
  const out = new Map<string, UnitEntry>();
  for (const { Q1, H1, "9M": nineMonth } of ytdByYear(entries).values()) {
    if (Q1) out.set(quarterKey(Q1.end), Q1); // YTD-ending-Q1 IS the discrete Q1 figure
    // `start` below is approximate (the prior quarter's end date, not its own start-of-quarter
    // day) — nothing downstream reads a reconstructed entry's `start`, so this is cosmetic.
    if (H1 && Q1) out.set(quarterKey(H1.end), { ...H1, start: Q1.end, val: H1.val - Q1.val });
    if (nineMonth && H1) out.set(quarterKey(nineMonth.end), { ...nineMonth, start: H1.end, val: nineMonth.val - H1.val });
  }
  return out;
}

/** quarterFlow, falling back to a YTD-differenced value when no discrete tag exists for that quarter. */
const quarterFlowWithYtdFallback = (entries: UnitEntry[]): Map<string, UnitEntry> => {
  const merged = new Map(reconstructedQuarterFlow(entries));
  for (const [key, entry] of quarterFlow(entries)) merged.set(key, entry); // discrete tag wins when present
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

function flowSeries(facts: unknown, concepts: string[], unit: Unit = "USD") {
  const perConcept = concepts.map((c) => entriesFor(facts, c, unit));
  return {
    annual: mergeByPriority(perConcept.map(annualFlow)),
    quarter: mergeByPriority(perConcept.map(quarterFlow)),
  };
}
/**
 * Like flowSeries, but for concepts 10-Qs commonly tag year-to-date instead of per discrete
 * quarter (cash-flow-statement items, D&A, interest expense) — see quarterFlowWithYtdFallback.
 * Income-statement concepts (revenue, operating income, ...) must keep using plain flowSeries:
 * they're already discretely tagged, and running them through YTD differencing would be a
 * silent no-op at best and a double-difference bug at worst if a filer ever tags both.
 */
function flowSeriesYtd(facts: unknown, concepts: string[], unit: Unit = "USD") {
  const perConcept = concepts.map((c) => entriesFor(facts, c, unit));
  return {
    annual: mergeByPriority(perConcept.map(annualFlow)),
    quarter: mergeByPriority(perConcept.map(quarterFlowWithYtdFallback)),
  };
}
function instantSeries(facts: unknown, concepts: string[], unit: Unit = "USD") {
  const perConcept = concepts.map((c) => entriesFor(facts, c, unit));
  return {
    annual: mergeByPriority(perConcept.map(annualInstant)),
    quarter: mergeByPriority(perConcept.map(quarterInstant)),
  };
}

const at = <K>(m: Map<K, UnitEntry>, k: K): number | null => m.get(k)?.val ?? null;

// --- derivation (shared by annual rows and real quarter rows) ----------

interface RawValues {
  revenue: number | null;
  cogs: number | null;
  grossProfitDirect: number | null;
  operatingIncomeDirect: number | null;
  pretax: number | null;
  nonoperating: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  da: number | null;
  interestExpense: number | null;
  cashAndStDirect: number | null;
  cash: number | null;
  shortTermInvestments: number | null;
  ltdNoncurrent: number | null;
  ltdCurrent: number | null;
  shortTermBorrowings: number | null;
  totalEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  ocf: number | null;
  capexRaw: number | null;
  buybacksRaw: number | null;
  dividendsRaw: number | null;
}

type DerivedFields = Omit<SecPeriod, "fiscal_period" | "fiscal_year" | "report_date">;

function deriveFields(r: RawValues): DerivedFields {
  const grossProfit = r.grossProfitDirect ?? (r.revenue != null && r.cogs != null ? r.revenue - r.cogs : null);
  const operatingIncome = r.operatingIncomeDirect ?? (r.pretax != null && r.nonoperating != null ? r.pretax - r.nonoperating : null);
  const ebitda = operatingIncome != null && r.da != null ? operatingIncome + r.da : null;
  // Some filers stop separately tagging short-term investments once the balance is immaterial (LLY: no
  // ShortTermInvestments entry for FY2025, though every prior year back to 2008 has one). Falling back to
  // `null` there would make mapStatements' required "cashAndInvestments" column throw for a filer that
  // plainly reports cash. Cash alone is a real, non-fabricated subset of the combined figure, so it's
  // never null merely because the STI leg wasn't separately disclosed for that period.
  const cashAndShortTermInvestments =
    r.cashAndStDirect ?? (r.cash != null ? r.cash + (r.shortTermInvestments ?? 0) : null);
  const totalDebt =
    r.ltdNoncurrent == null && r.ltdCurrent == null && r.shortTermBorrowings == null
      ? null
      : (r.ltdNoncurrent ?? 0) + (r.ltdCurrent ?? 0) + (r.shortTermBorrowings ?? 0);
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

export function parseCompanyFacts(facts: unknown): { annual: SecPeriod[]; quarter: SecPeriod[] } {
  const revenue = flowSeries(facts, REVENUE);
  const cogs = flowSeries(facts, COGS);
  const grossProfitDirect = flowSeries(facts, GROSS_PROFIT);
  const operatingIncomeDirect = flowSeries(facts, OPERATING_INCOME);
  const pretax = flowSeries(facts, PRETAX_INCOME);
  const nonoperating = flowSeries(facts, NONOPERATING_INCOME_EXPENSE);
  const netIncome = flowSeries(facts, NET_INCOME);
  const epsDiluted = flowSeries(facts, EPS_DILUTED, "USD/shares");
  // These six are commonly tagged year-to-date rather than per discrete quarter in 10-Qs (see
  // flowSeriesYtd / quarterFlowWithYtdFallback above); the rest of the flow concepts above are
  // income-statement items filers already tag discretely and must NOT go through YTD
  // differencing.
  const da = flowSeriesYtd(facts, DA);
  const interestExpense = flowSeriesYtd(facts, INTEREST_EXPENSE);
  const ocf = flowSeriesYtd(facts, OCF);
  const capexRaw = flowSeriesYtd(facts, CAPEX_RAW);
  const buybacksRaw = flowSeriesYtd(facts, BUYBACKS_RAW);
  const dividendsRaw = flowSeriesYtd(facts, DIVIDENDS_RAW);

  const cashAndStDirect = instantSeries(facts, CASH_AND_ST_INVESTMENTS);
  const cash = instantSeries(facts, CASH);
  const shortTermInvestments = instantSeries(facts, SHORT_TERM_INVESTMENTS);
  const ltdNoncurrent = instantSeries(facts, LTD_NONCURRENT);
  const ltdCurrent = instantSeries(facts, LTD_CURRENT);
  const shortTermBorrowings = instantSeries(facts, SHORT_TERM_BORROWINGS);
  const totalEquity = instantSeries(facts, TOTAL_EQUITY);
  const currentAssets = instantSeries(facts, CURRENT_ASSETS);
  const currentLiabilities = instantSeries(facts, CURRENT_LIABILITIES);

  if (revenue.annual.size === 0 && revenue.quarter.size === 0) {
    throw new Error(`No revenue concept found among: ${REVENUE.join(", ")}`);
  }
  if (netIncome.annual.size === 0 && netIncome.quarter.size === 0) {
    throw new Error(`No net income concept found among: ${NET_INCOME.join(", ")}`);
  }

  const rawAt = <K>(key: K, side: "annual" | "quarter"): RawValues => ({
    revenue: at(revenue[side] as Map<K, UnitEntry>, key),
    cogs: at(cogs[side] as Map<K, UnitEntry>, key),
    grossProfitDirect: at(grossProfitDirect[side] as Map<K, UnitEntry>, key),
    operatingIncomeDirect: at(operatingIncomeDirect[side] as Map<K, UnitEntry>, key),
    pretax: at(pretax[side] as Map<K, UnitEntry>, key),
    nonoperating: at(nonoperating[side] as Map<K, UnitEntry>, key),
    netIncome: at(netIncome[side] as Map<K, UnitEntry>, key),
    epsDiluted: at(epsDiluted[side] as Map<K, UnitEntry>, key),
    da: at(da[side] as Map<K, UnitEntry>, key),
    interestExpense: at(interestExpense[side] as Map<K, UnitEntry>, key),
    cashAndStDirect: at(cashAndStDirect[side] as Map<K, UnitEntry>, key),
    cash: at(cash[side] as Map<K, UnitEntry>, key),
    shortTermInvestments: at(shortTermInvestments[side] as Map<K, UnitEntry>, key),
    ltdNoncurrent: at(ltdNoncurrent[side] as Map<K, UnitEntry>, key),
    ltdCurrent: at(ltdCurrent[side] as Map<K, UnitEntry>, key),
    shortTermBorrowings: at(shortTermBorrowings[side] as Map<K, UnitEntry>, key),
    totalEquity: at(totalEquity[side] as Map<K, UnitEntry>, key),
    currentAssets: at(currentAssets[side] as Map<K, UnitEntry>, key),
    currentLiabilities: at(currentLiabilities[side] as Map<K, UnitEntry>, key),
    ocf: at(ocf[side] as Map<K, UnitEntry>, key),
    capexRaw: at(capexRaw[side] as Map<K, UnitEntry>, key),
    buybacksRaw: at(buybacksRaw[side] as Map<K, UnitEntry>, key),
    dividendsRaw: at(dividendsRaw[side] as Map<K, UnitEntry>, key),
  });

  // Annual (FY) rows, anchored on the years the revenue concept reports.
  const annualYears = [...revenue.annual.keys()].sort((a, b) => a - b);
  const annual: SecPeriod[] = annualYears.map((year) => ({
    fiscal_period: "FY",
    fiscal_year: year,
    report_date: revenue.annual.get(year)!.end,
    ...deriveFields(rawAt(year, "annual")),
  }));
  const annualByYear = new Map(annual.map((p) => [p.fiscal_year, p]));

  // Real quarterly rows (Q1-Q3 only — Q4 is never separately filed), anchored
  // on the quarters the revenue concept reports.
  const quarterKeys = [...revenue.quarter.keys()].sort();
  const realQuarters: SecPeriod[] = quarterKeys.map((key) => {
    const end = revenue.quarter.get(key)!.end;
    return {
      fiscal_period: `Q${quarterOf(end)}`,
      fiscal_year: yearOf(end),
      report_date: end,
      ...deriveFields(rawAt(key, "quarter")),
    };
  });

  // Derive Q4 = FY − (Q1 + Q2 + Q3) per year, when all four are present.
  const byYearQuarter = new Map<number, Map<string, SecPeriod>>();
  for (const q of realQuarters) {
    if (!byYearQuarter.has(q.fiscal_year)) byYearQuarter.set(q.fiscal_year, new Map());
    byYearQuarter.get(q.fiscal_year)!.set(q.fiscal_period, q);
  }
  const derivedQ4: SecPeriod[] = [];
  for (const [year, fyRow] of annualByYear) {
    const byQuarter = byYearQuarter.get(year);
    const q1 = byQuarter?.get("Q1"), q2 = byQuarter?.get("Q2"), q3 = byQuarter?.get("Q3");
    if (!q1 || !q2 || !q3) continue;

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
    derivedQ4.push({
      fiscal_period: "Q4",
      fiscal_year: year,
      report_date: fyRow.report_date,
      ...q4Partial,
      ...instantPartial,
    });
  }

  const byReportDate = (a: SecPeriod, b: SecPeriod) => (a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : 0);
  const quarter = [...realQuarters, ...derivedQ4].sort(byReportDate);
  annual.sort(byReportDate);

  return { annual, quarter };
}

export async function fetchCompanyFacts(cik: number, contact: string, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
  return edgarJson(url, contact, fetchImpl);
}
