import { readRawJson, section, type Rec } from "../raw";
import type { FactPack } from "../schema";
const FILE = "bigdata-tearsheet-annual.json";
export const READS = [FILE] as const;
export const PROVENANCE = [
  { field: "segments", endpoint: "bigdata_company_tearsheet.revenue_segmentation.product" },
  { field: "geoMix", endpoint: "bigdata_company_tearsheet.revenue_segmentation.geographic" },
];

/** revenue_segmentation.<kind> is keyed by period-end date; take the latest FY entry. */
function latest(byDate: Record<string, Rec>, valuesKey: string): [string, Record<string, number>] {
  const entries = Object.values(byDate).filter((e) => e.period === "FY" && typeof e.fiscal_year === "number");
  if (!entries.length) throw new Error(`No FY entries under revenue_segmentation in ${FILE}`);
  const top = entries.sort((a, b) => (b.fiscal_year as number) - (a.fiscal_year as number))[0];
  return [`FY${String(top.fiscal_year).slice(2)}`, top[valuesKey] as Record<string, number>];
}

export function mapSegments(dir: string): { segments: FactPack["segments"]; geoMix: FactPack["geoMix"] } {
  const ts = readRawJson(dir, FILE);
  const [pBasis, product] = latest(section(ts, ["revenue_segmentation", "product"], FILE), "product_segments");
  const [gBasis, geo] = latest(section(ts, ["revenue_segmentation", "geographic"], FILE), "region_segments");
  const pTotal = Object.values(product).reduce((a, b) => a + b, 0), gTotal = Object.values(geo).reduce((a, b) => a + b, 0);
  return {
    segments: { basis: pBasis, items: Object.entries(product).map(([name, revenue]) => ({ name, revenue, share: revenue / pTotal })) },
    geoMix: { basis: gBasis, items: Object.entries(geo).map(([region, v]) => ({ region, share: v / gTotal })) },
  };
}
