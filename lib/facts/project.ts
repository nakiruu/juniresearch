/**
 * project.ts — FactPack → the numeric subset of a Report.
 * -----------------------------------------------------------------------------
 * Display labels and formats match the golden fixture (`lib/__fixtures__/avgo-golden.json`) so parity can be checked at
 * the string level. Derived rows (YoY, gross margin, FCF margin) are computed
 * here from full-precision values, never from rounded ones.
 */
import type { FactPack } from "./schema";
import type { Report, FinancialTable, SnapshotCellData } from "../report.schema";
import { buildHighlightCells } from "./highlights";
import { statementValues, safeDiv } from "./statement-values";

export interface ReportFacts {
  meta: { filing: Report["meta"]["filing"]; company: string; ticker: string; exchange: string; asOf: string };
  quote: Report["quote"];
  snapshot: SnapshotCellData[];
  analystSentiment: Omit<Report["analystSentiment"], "commentary">;
  sections: {
    financials: { income: FinancialTable; balance: FinancialTable; cashflow: FinancialTable };
    valuation: { multiplesCompanyColumn: { label: string; value: number | null }[] };
    businessMoat: { segments: { name: string; sharePct: number; revenue: number }[]; segmentsBasis: string;
                    geoMix: { region: string; sharePct: number }[]; geographyBasis: string };
  };
  highlightCells: ReturnType<typeof buildHighlightCells>;
}

const vals = statementValues;
const ratioRows = (a: (number | null)[], b: (number | null)[]) => a.map((x, i) => safeDiv(x, b[i]));
const yoy = (a: (number | null)[]) => a.map((x, i) => (i === 0 || x == null || a[i - 1] == null || a[i - 1] === 0 ? null : x / (a[i - 1] as number) - 1));

export function projectReportFacts(p: FactPack): ReportFacts {
  const fy = p.statements.fiscalYears;
  const revenue = vals(p, "income", "revenue");
  const cols = ["Metric", ...fy];
  const income: FinancialTable = { columns: cols, rows: [
    { label: "Revenue ($B)", values: revenue, format: "usdB" },
    { label: "YoY Growth", values: yoy(revenue), format: "pctSigned" },
    { label: "Gross Margin", values: ratioRows(vals(p, "income", "grossProfit"), revenue), format: "pct" },
    { label: "Operating Income ($B)", values: vals(p, "income", "operatingIncome"), format: "usdB" },
    { label: "Operating Margin", values: ratioRows(vals(p, "income", "operatingIncome"), revenue), format: "pct" },
    { label: "EBITDA ($B)", values: vals(p, "income", "ebitda"), format: "usdB" },
    { label: "Net Income ($B)", values: vals(p, "income", "netIncome"), format: "usdB" },
    { label: "Diluted EPS ($)*", values: vals(p, "income", "epsDiluted"), format: "eps" },
  ] };
  const colsB = ["Metric ($B)", ...fy];
  const balance: FinancialTable = { columns: colsB, rows: [
    { label: "Cash & ST Investments", values: vals(p, "balance", "cashAndInvestments"), format: "usdB" },
    { label: "Total Debt", values: vals(p, "balance", "totalDebt"), format: "usdB" },
    { label: "Net Debt", values: vals(p, "balance", "netDebt"), format: "usdB" },
    { label: "Total Equity", values: vals(p, "balance", "totalEquity"), format: "usdB" },
    { label: "Current Ratio", values: vals(p, "balance", "currentRatio"), format: "num2" },
  ] };
  const fcf = vals(p, "cashflow", "freeCashFlow");
  const cashflow: FinancialTable = { columns: colsB, rows: [
    { label: "Operating Cash Flow", values: vals(p, "cashflow", "operatingCashFlow"), format: "usdB" },
    { label: "Capital Expenditure", values: vals(p, "cashflow", "capex"), format: "usdB" },
    { label: "Share Repurchases", values: vals(p, "cashflow", "buybacks"), format: "usdB" },
    { label: "Dividends Paid", values: vals(p, "cashflow", "dividends"), format: "usdB" },
    { label: "Free Cash Flow", values: fcf, format: "usdB" },
    { label: "FCF Margin", values: ratioRows(fcf, revenue), format: "pct" },
  ] };

  const last = fy.at(-1)!, li = fy.length - 1, q = p.quote, a = p.analysts, lq = p.latestQuarter;
  const fwdPe = p.estimates.followingFY.eps ? q.price / p.estimates.followingFY.eps : null;
  const ntmPe = p.estimates.nextFY.eps ? q.price / p.estimates.nextFY.eps : null;
  const nextRevYoY = p.estimates.nextFY.revenue && revenue[li] ? p.estimates.nextFY.revenue / revenue[li]! - 1 : undefined;
  const snapshot: SnapshotCellData[] = [
    { label: "Current Price", value: q.price, unit: "usd" },
    { label: "Market Cap", value: q.marketCap, unit: "usdLarge", approx: true },
    { label: "52-Week Range", raw: `$${q.week52Low.toFixed(2)} – $${q.week52High.toFixed(2)}` },
    { label: "Shares Outstanding", value: q.sharesOutstanding, unit: "shares", approx: q.sharesSource !== "cover" },
    { label: "P/E (TTM)", value: p.ttm.pe ?? undefined, unit: "mult" },
    { label: "Consensus Target", value: a.consensusTarget, unit: "usd", change: a.consensusTarget / q.price - 1 },
    { label: "EV/EBITDA (TTM)", value: p.ttm.evToEbitda ?? undefined, unit: "mult" },
    { label: "Analyst Consensus", raw: `${a.consensusRating} (${a.buy} B / ${a.hold} H / ${a.sell} S)` },
    { label: `${last} Revenue`, value: revenue[li] ?? undefined, unit: "usdLarge", change: yoy(revenue)[li] ?? undefined },
    { label: `${last} Net Income`, value: vals(p, "income", "netIncome")[li] ?? undefined, unit: "usdLarge" },
    { label: `${last} Diluted EPS`, value: vals(p, "income", "epsDiluted")[li] ?? undefined, unit: "usd" },
    p.estimates.nextFY.revenue == null
      ? { label: `${p.estimates.nextFY.label} Revenue`, raw: "—", note: "no consensus estimate" }
      : { label: `${p.estimates.nextFY.label} Revenue`, value: p.estimates.nextFY.revenue, unit: "usdLarge", approx: true, change: nextRevYoY, changeDp: 0 },
    { label: `${lq.label} Revenue`, value: lq.revenue, unit: "usdLarge", change: lq.revenueYoY ?? undefined, changeDp: 0 },
    lq.operatingMargin == null
      ? { label: `${lq.label} Operating Margin`, raw: "n/m", note: "no revenue in the quarter" }
      : { label: `${lq.label} Operating Margin`, value: lq.operatingMargin, unit: "pct", dp: 0 },
    // A negative forward multiple (consensus expects a loss) is not meaningful; a missing one is a dash.
    fwdPe == null
      ? { label: `Fwd P/E (${p.estimates.followingFY.label})`, raw: "—", note: "no consensus EPS" }
      : fwdPe < 0
        ? { label: `Fwd P/E (${p.estimates.followingFY.label})`, raw: "n/m", note: "consensus expects a loss" }
        : { label: `Fwd P/E (${p.estimates.followingFY.label})`, value: fwdPe, unit: "mult", approx: true },
    { label: "Dividend Yield", value: q.dividendYield, unit: "pct", dp: 2 },
  ];

  // The fixture stores display forms here: "fiscal Q3 2026" and "Sep 10, 2026".
  const shortDate = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  // fiscalPeriod describes the filing, not the latest quarter: a 10-K is always its fiscal year; a 10-Q
  // keeps the "fiscal Qn YYYY" label only when the latest quarter is the one the filing itself reports.
  const fiscalPeriod = p.filing.form === "10-K"
    ? `fiscal ${new Date(p.filing.periodEnd + "T00:00:00Z").getUTCFullYear()}`
    : lq.periodEnd === p.filing.periodEnd
      ? `fiscal ${lq.label.slice(0, 2)} 20${lq.label.slice(3)}`
      : `quarter ended ${shortDate(p.filing.periodEnd)}`;
  const filedDate = shortDate(p.filing.filedDate);

  return {
    meta: { filing: { form: p.filing.form, fiscalPeriod, filedDate, accession: p.filing.accession },
            company: p.company, ticker: p.ticker, exchange: p.exchange, asOf: q.asOf },
    quote: { currentPrice: q.price, marketCap: q.marketCap, sharesOutstanding: q.sharesOutstanding, week52Low: q.week52Low, week52High: q.week52High, dividendYield: q.dividendYield, history: p.history.map((h) => ({ date: h.date, close: h.close })) },
    snapshot,
    analystSentiment: { numAnalysts: a.count, buy: a.buy, hold: a.hold, sell: a.sell, consensusRating: a.consensusRating,
      consensusTarget: a.consensusTarget, medianTarget: a.medianTarget, highTarget: a.highTarget, lowTarget: a.lowTarget },
    sections: {
      financials: { income, balance, cashflow },
      valuation: { multiplesCompanyColumn: [
        { label: "P/E", value: p.ttm.pe }, { label: "P/S", value: p.ttm.ps }, { label: "EV/EBITDA", value: p.ttm.evToEbitda }, { label: "Fwd P/E (NTM)", value: ntmPe } ] },
      businessMoat: {
        segments: p.segments.items.map((s) => ({ name: s.name, sharePct: s.share, revenue: s.revenue })), segmentsBasis: `${p.segments.basis} mix`,
        geoMix: p.geoMix.items.map((g) => ({ region: g.region, sharePct: g.share })), geographyBasis: p.geoMix.basis,
      },
    },
    highlightCells: buildHighlightCells(p),
  };
}
