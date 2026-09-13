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
  if (years.length !== 5) throw new Error(`Expected 5 aligned fiscal years in ${ANNUAL}, found ${years.length}: ${years.join(",")}`);
  const col = (m: Map<number, Rec>, key: string, optional = false) => years.map((y) => num(m.get(y), key, ANNUAL, { optional }));

  const revenue = col(inc, "revenue");
  const curA = col(bal, "total_current_assets"), curL = col(bal, "total_current_liabilities");
  const statements: FactPack["statements"] = {
    fiscalYears: years.map(fyLabel),
    income: [
      row("revenue", "Revenue", revenue),
      row("grossProfit", "Gross Profit", col(inc, "gross_profit")),
      row("operatingIncome", "Operating Income", col(inc, "operating_income")),
      row("ebitda", "EBITDA", col(inc, "ebitda", true)),
      row("netIncome", "Net Income", col(inc, "net_income")),
      row("epsDiluted", "Diluted EPS", col(inc, "eps_diluted")),
    ],
    balance: [
      row("cashAndInvestments", "Cash & ST Investments", col(bal, "cash_and_short_term_investments")),
      row("totalDebt", "Total Debt", col(bal, "total_debt")),
      row("netDebt", "Net Debt", col(bal, "net_debt")),
      row("totalEquity", "Total Equity", col(bal, "total_equity")),
      row("currentRatio", "Current Ratio", curA.map((x, i) => div(x, curL[i]))),
    ],
    cashflow: [
      row("operatingCashFlow", "Operating Cash Flow", col(cf, "operating_cash_flow")),
      row("freeCashFlow", "Free Cash Flow", col(cf, "free_cash_flow")),
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
  const latestQuarter: FactPack["latestQuarter"] = {
    label: `${period}'${String(fy).slice(2)}`,
    periodEnd: str(latest, "report_date", QUARTER),
    revenue: rev,
    operatingMargin: num(latest, "operating_income", QUARTER)! / rev,
    revenueYoY: prior ? rev / num(prior, "revenue", QUARTER)! - 1 : null,
  };

  const sheet = readRawJson(dir, SHEET);
  const km = section<Rec[]>(sheet, ["fundamentals", "key_metrics"], SHEET).find((r) => r.fiscal_period === "TTM");
  const rt = section<Rec[]>(sheet, ["fundamentals", "ratios"], SHEET).find((r) => r.fiscal_period === "TTM");
  const opt = (o: Rec | undefined, k: string) => num(o, k, SHEET, { optional: true });
  const ttm: FactPack["ttm"] = {
    pe: opt(km, "pe_ratio"), ps: opt(km, "price_to_sales"), evToEbitda: opt(km, "ev_to_ebitda"),
    grossMargin: opt(rt, "gross_margin"), operatingMargin: opt(rt, "operating_margin"), netMargin: opt(rt, "net_margin"),
  };
  return { statements, latestQuarter, ttm };
}
