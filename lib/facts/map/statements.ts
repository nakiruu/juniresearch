import { readRawJson, num, str, section, type Rec } from "../raw";
import type { FactPack, StatementRow } from "../schema";

const ANNUAL = "bigdata-statements-annual.json", QUARTER = "bigdata-statements-quarter.json", SHEET = "bigdata-tearsheet-annual.json";
export const READS = [ANNUAL, QUARTER, SHEET] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] = [
  { field: "statements", endpoint: "bigdata_company_tearsheet.financial_statements (annual)", source: "bigdata" },
  { field: "latestQuarter", endpoint: "bigdata_company_tearsheet.financial_statements (quarter)", source: "bigdata" },
  { field: "ttm", endpoint: "bigdata_company_tearsheet.fundamentals.key_metrics[TTM] + ratios[TTM]", source: "bigdata" },
];

const fyLabel = (fy: number) => `FY${String(fy).slice(2)}`;
const row = (key: string, label: string, values: (number | null)[]): StatementRow => ({ key, label, values });
const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);

function fyRows(all: Rec[], file: string): Map<number, Rec> {
  const m = new Map<number, Rec>();
  for (const r of all) if (r.fiscal_period === "FY") m.set(num(r, "fiscal_year", file)!, r);
  return m;
}

export function mapStatements(dir: string): { statements: FactPack["statements"]; latestQuarter: FactPack["latestQuarter"]; ttm: FactPack["ttm"] } {
  const a = readRawJson(dir, ANNUAL);
  const inc = fyRows(section<Rec[]>(a, ["fundamentals", "income_statement"], ANNUAL), ANNUAL);
  const bal = fyRows(section<Rec[]>(a, ["fundamentals", "balance_sheet"], ANNUAL), ANNUAL);
  const cf = fyRows(section<Rec[]>(a, ["fundamentals", "cash_flow"], ANNUAL), ANNUAL);
  const years = [...inc.keys()].filter((y) => bal.has(y) && cf.has(y)).sort((x, y) => x - y).slice(-5);
  // Five years is the norm; a company public for under five years (a 2025 IPO, say) has fewer aligned years.
  // Three is the floor below which the trend tables say too little to publish.
  if (years.length < 3) throw new Error(`Expected at least 3 aligned fiscal years in ${ANNUAL}, found ${years.length}: ${years.join(",")}`);
  const col = (m: Map<number, Rec>, key: string, optional = false) => years.map((y) => num(m.get(y), key, ANNUAL, { optional }));

  const revenue = col(inc, "revenue");
  // Optional: banks present an UNCLASSIFIED balance sheet (no current/non-current split), so they tag no
  // total_current_assets/liabilities and the current ratio is undefined for them — the row renders "—".
  const curA = col(bal, "total_current_assets", true), curL = col(bal, "total_current_liabilities", true);
  const statements: FactPack["statements"] = {
    fiscalYears: years.map(fyLabel),
    income: [
      row("revenue", "Revenue", revenue),
      // Optional: utilities and banks report no gross-profit line (no COGS), so SEC XBRL carries no
      // GrossProfit tag and none can be derived — the row is null and renders "—", with operating
      // margin carrying profitability instead.
      row("grossProfit", "Gross Profit", col(inc, "gross_profit", true)),
      // Optional: banks have no operating-income subtotal (net revenue → provision → noninterest expense
      // → pretax income), and SEC XBRL carries none to derive — the row renders "—", with net income and
      // net margin carrying profitability instead.
      row("operatingIncome", "Operating Income", col(inc, "operating_income", true)),
      row("ebitda", "EBITDA", col(inc, "ebitda", true)),
      row("netIncome", "Net Income", col(inc, "net_income")),
      row("epsDiluted", "Diluted EPS", col(inc, "eps_diluted")),
    ],
    balance: [
      // Optional: a bank's cash sits under "cash and due from banks" / "deposits with banks" concepts the
      // combined tag does not capture, so it can be null; net debt is not meaningful for a bank (deposits
      // fund the balance sheet, not net borrowings) and is null when cash is. Both render "—".
      row("cashAndInvestments", "Cash & ST Investments", col(bal, "cash_and_short_term_investments", true)),
      row("totalDebt", "Total Debt", col(bal, "total_debt")),
      row("netDebt", "Net Debt", col(bal, "net_debt", true)),
      row("totalEquity", "Total Equity", col(bal, "total_equity")),
      row("currentRatio", "Current Ratio", curA.map((x, i) => div(x, curL[i]))),
    ],
    cashflow: [
      row("operatingCashFlow", "Operating Cash Flow", col(cf, "operating_cash_flow")),
      row("capex", "Capital Expenditure", col(cf, "capex", true)),
      row("buybacks", "Share Repurchases", col(cf, "common_stock_repurchased", true)),
      row("dividends", "Dividends Paid", col(cf, "common_dividends_paid", true)),
      // Optional: free cash flow is OCF + capex, so it is null whenever capex is (a utility that tags
      // capital spending only under company-specific extension concepts, not a us-gaap capex tag) —
      // the row renders "—" rather than forcing a figure that cannot be derived.
      row("freeCashFlow", "Free Cash Flow", col(cf, "free_cash_flow", true)),
    ],
  };

  const q = readRawJson(dir, QUARTER);
  const quarters = section<Rec[]>(q, ["fundamentals", "income_statement"], QUARTER)
    .filter((r) => r.fiscal_period !== "FY")
    .sort((x, y) => (str(x, "report_date", QUARTER) < str(y, "report_date", QUARTER) ? 1 : -1));
  const latest = quarters[0];
  if (!latest) throw new Error(`No quarterly income rows in ${QUARTER}`);
  const fy = num(latest, "fiscal_year", QUARTER)!, period = str(latest, "fiscal_period", QUARTER);
  const prior = quarters.find((r) => r.fiscal_period === period && num(r, "fiscal_year", QUARTER) === fy - 1);
  const rev = num(latest, "revenue", QUARTER)!;
  const priorRev = prior ? num(prior, "revenue", QUARTER)! : null;
  // A quarter with no revenue (a miner that sold nothing that quarter) has no margin and no growth rate;
  // null keeps -Infinity and NaN out of the pack rather than pretending the ratio exists.
  const latestQuarter: FactPack["latestQuarter"] = {
    label: `${period}'${String(fy).slice(2)}`,
    periodEnd: str(latest, "report_date", QUARTER),
    revenue: rev,
    // operating_income is optional (banks and some filers tag no operating-income subtotal) → a null
    // operating margin, not a throw; the snapshot renders "—".
    operatingMargin: (() => { const oi = num(latest, "operating_income", QUARTER, { optional: true }); return rev === 0 || oi == null ? null : oi / rev; })(),
    revenueYoY: priorRev == null || priorRev === 0 ? null : rev / priorRev - 1,
  };

  const sheet = readRawJson(dir, SHEET);
  const km = section<Rec[]>(sheet, ["fundamentals", "key_metrics"], SHEET).find((r) => r.fiscal_period === "TTM");
  const rt = section<Rec[]>(sheet, ["fundamentals", "ratios"], SHEET).find((r) => r.fiscal_period === "TTM");
  const opt = (o: Rec | undefined, k: string) => num(o, k, SHEET, { optional: true });
  const ttm: FactPack["ttm"] = {
    pe: opt(km, "pe_ratio"), ps: opt(km, "price_to_sales"), evToEbitda: opt(km, "ev_to_ebitda"),
    grossMargin: opt(rt, "gross_margin"), operatingMargin: opt(rt, "operating_margin"), netMargin: opt(rt, "net_margin"),
    netDebtToEbitda: opt(rt, "net_debt_to_ebitda"), interestCoverage: opt(rt, "interest_coverage"),
    currentRatio: opt(rt, "current_ratio"), fcfYield: opt(km, "free_cash_flow_yield"),
  };
  return { statements, latestQuarter, ttm };
}
