/**
 * Assembles the SEC + Yahoo + TTM pieces (Tasks 1–3) into the three
 * Bigdata.com tearsheet-shaped JSON files and writes them to a capture
 * directory.
 *
 * Shape-preserving adapter: the exact nesting here must match what the real
 * mappers under `lib/facts/map/` read (proven by emit.test.ts running the
 * emitted files through those mappers unchanged). See
 * docs/superpowers/specs/2026-09-16-sec-yahoo-free-factsource-design.md
 * ("Emit shapes") for the contract this file implements.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecPeriod } from "./sec";
import type { YahooData, YahooEstimate } from "./yahoo";
import type { TtmRows } from "./ttm";

export interface EmitInput {
  cik: number;
  sec: { annual: SecPeriod[]; quarter: SecPeriod[] };
  yahoo: YahooData;
  ttm: TtmRows;
  capturedAt: string;
}

export interface TearsheetFiles {
  tearsheetAnnual: unknown;
  statementsAnnual: unknown;
  statementsQuarter: unknown;
}

const ANNUAL_FILE = "bigdata-statements-annual.json";
const QUARTER_FILE = "bigdata-statements-quarter.json";
const TEARSHEET_FILE = "bigdata-tearsheet-annual.json";

function incomeRow(p: SecPeriod) {
  return {
    fiscal_period: p.fiscal_period,
    fiscal_year: p.fiscal_year,
    report_date: p.report_date,
    revenue: p.revenue,
    gross_profit: p.gross_profit,
    operating_income: p.operating_income,
    ebitda: p.ebitda,
    net_income: p.net_income,
    eps_diluted: p.eps_diluted,
  };
}

function balanceRow(p: SecPeriod) {
  return {
    fiscal_period: p.fiscal_period,
    fiscal_year: p.fiscal_year,
    report_date: p.report_date,
    cash_and_short_term_investments: p.cash_and_short_term_investments,
    total_debt: p.total_debt,
    net_debt: p.net_debt,
    total_equity: p.total_equity,
    total_current_assets: p.total_current_assets,
    total_current_liabilities: p.total_current_liabilities,
  };
}

function cashflowRow(p: SecPeriod) {
  return {
    fiscal_period: p.fiscal_period,
    fiscal_year: p.fiscal_year,
    report_date: p.report_date,
    operating_cash_flow: p.operating_cash_flow,
    capex: p.capex,
    common_stock_repurchased: p.common_stock_repurchased,
    common_dividends_paid: p.common_dividends_paid,
    free_cash_flow: p.free_cash_flow,
  };
}

function quarterIncomeRow(p: SecPeriod) {
  return {
    fiscal_period: p.fiscal_period,
    fiscal_year: p.fiscal_year,
    report_date: p.report_date,
    revenue: p.revenue,
    operating_income: p.operating_income,
  };
}

interface EstimateRecord {
  metric: "SALES" | "EPS";
  fiscal_year: number;
  fiscal_period: "FY";
  estimate_mean: number;
}

function estimateRecords(estimates: YahooEstimate[]): EstimateRecord[] {
  const records: EstimateRecord[] = [];
  for (const e of estimates) {
    if (e.sales != null) records.push({ metric: "SALES", fiscal_year: e.fiscal_year, fiscal_period: "FY", estimate_mean: e.sales });
    if (e.eps != null) records.push({ metric: "EPS", fiscal_year: e.fiscal_year, fiscal_period: "FY", estimate_mean: e.eps });
  }
  return records;
}

export function buildTearsheetFiles(input: EmitInput): TearsheetFiles {
  const { sec, yahoo, ttm, cik, capturedAt } = input;

  const statementsAnnual = {
    fundamentals: {
      income_statement: sec.annual.map(incomeRow),
      balance_sheet: sec.annual.map(balanceRow),
      cash_flow: sec.annual.map(cashflowRow),
    },
  };

  const statementsQuarter = {
    fundamentals: {
      income_statement: sec.quarter.map(quarterIncomeRow),
    },
  };

  const tearsheetAnnual = {
    company_overview: {
      company_name: yahoo.companyName,
      exchange: yahoo.exchange,
      cik,
      description: yahoo.description,
      price: yahoo.price,
      market_cap: yahoo.marketCap,
      timestamp: capturedAt,
    },
    price_performance: {
      current_market: {
        year_low: yahoo.week52Low,
        year_high: yahoo.week52High,
      },
    },
    analyst_data: {
      price_targets: {
        target_consensus: yahoo.targets.consensus,
        target_median: yahoo.targets.median,
        target_high: yahoo.targets.high,
        target_low: yahoo.targets.low,
      },
      ratings: {
        strong_buy: yahoo.ratings.strong_buy,
        buy: yahoo.ratings.buy,
        hold: yahoo.ratings.hold,
        sell: yahoo.ratings.sell,
        strong_sell: yahoo.ratings.strong_sell,
        consensus: yahoo.ratings.consensus,
      },
      as_of_utc_timestamp: capturedAt,
    },
    estimates: {
      records: estimateRecords(yahoo.estimates),
    },
    fundamentals: {
      key_metrics: [ttm.keyMetrics],
      ratios: [ttm.ratios],
    },
    revenue_segmentation: {
      product: {},
      geographic: {},
    },
  };

  return { tearsheetAnnual, statementsAnnual, statementsQuarter };
}

export function writeTearsheetFiles(dir: string, files: TearsheetFiles): void {
  writeFileSync(join(dir, TEARSHEET_FILE), JSON.stringify(files.tearsheetAnnual));
  writeFileSync(join(dir, ANNUAL_FILE), JSON.stringify(files.statementsAnnual));
  writeFileSync(join(dir, QUARTER_FILE), JSON.stringify(files.statementsQuarter));
}
