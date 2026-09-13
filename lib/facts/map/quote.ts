import { readRawJson, num, str, section, type Rec } from "../raw";
import type { FactPack, Excerpt } from "../schema";

const FILE = "bigdata-tearsheet-annual.json";
export const READS = [FILE] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] = [
  { field: "quote", endpoint: "bigdata_company_tearsheet.company_overview + price_performance", source: "bigdata" },
  { field: "quote.sharesOutstanding", endpoint: "derived: market_cap / price", source: "bigdata" },
  { field: "quote.dividendYield", endpoint: "bigdata_company_tearsheet.fundamentals.ratios[TTM]", source: "bigdata" },
  { field: "company", endpoint: "bigdata_company_tearsheet.company_overview", source: "bigdata" },
  { field: "context.description", endpoint: "bigdata_company_tearsheet.company_overview", source: "bigdata" },
];

export function mapQuote(dir: string): { quote: FactPack["quote"]; company: string; exchange: string; cik: number; description: Excerpt } {
  const ts = readRawJson(dir, FILE);
  const ov = section<Rec>(ts, ["company_overview"], FILE);
  const pp = section<Rec>(ts, ["price_performance", "current_market"], FILE);
  const ratios = section<Rec[]>(ts, ["fundamentals", "ratios"], FILE);
  const ttm = ratios.find((r) => r.fiscal_period === "TTM");
  const price = num(ov, "price", FILE)!, marketCap = num(ov, "market_cap", FILE)!;
  const asOf = str(ov, "timestamp", FILE).slice(0, 10);
  return {
    company: str(ov, "company_name", FILE),
    exchange: str(ov, "exchange", FILE).toUpperCase(),
    cik: num(ov, "cik", FILE)!,
    description: { text: str(ov, "description", FILE), source: "bigdata:company_tearsheet", asOf },
    quote: {
      price, marketCap,
      sharesOutstanding: marketCap / price,
      week52Low: num(pp, "year_low", FILE)!, week52High: num(pp, "year_high", FILE)!,
      // A missing TTM dividend_yield is read as 0: the vendor omits the field for
      // non-payers rather than reporting an explicit zero. Ruled, known limitation.
      dividendYield: num(ttm, "dividend_yield", FILE, { optional: true }) ?? 0,
      asOf,
    },
  };
}
