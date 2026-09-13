import { readRawJson, num, section, type Rec } from "../raw";
import type { FactPack } from "../schema";
const FILE = "bigdata-tearsheet-annual.json";
export const READS = [FILE] as const;
/** Vendor labels sometimes arrive letter-spaced ("E M E A"); collapse those, leave real multi-word names alone. */
export const tidyName = (s: string) => (s.trim().split(/\s+/).every((t) => t.length === 1) ? s.replace(/\s+/g, "") : s.trim());
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] = [
  { field: "segments", endpoint: "bigdata_company_tearsheet.revenue_segmentation.product", source: "bigdata" },
  { field: "geoMix", endpoint: "bigdata_company_tearsheet.revenue_segmentation.geographic", source: "bigdata" },
];

/** revenue_segmentation.<kind> is keyed by period-end date; take the latest FY entry. */
function latest(byDate: Record<string, Rec>, valuesKey: string): [string, Record<string, number>, number] {
  const entries = Object.values(byDate).filter((e) => e.period === "FY" && typeof e.fiscal_year === "number");
  if (!entries.length) throw new Error(`No FY entries under revenue_segmentation in ${FILE}`);
  const top = entries.sort((a, b) => (b.fiscal_year as number) - (a.fiscal_year as number))[0];
  const fy = num(top, "fiscal_year", FILE)!;
  const values = section<Record<string, number>>(top, [valuesKey], FILE);
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (total === 0) throw new Error(`Zero segment total under revenue_segmentation in ${FILE}`);
  return [`FY${String(fy).slice(2)}`, values, total];
}

export function mapSegments(dir: string): { segments: FactPack["segments"]; geoMix: FactPack["geoMix"] } {
  const ts = readRawJson(dir, FILE);
  const [pBasis, product, pTotal] = latest(section(ts, ["revenue_segmentation", "product"], FILE), "product_segments");
  const [gBasis, geo, gTotal] = latest(section(ts, ["revenue_segmentation", "geographic"], FILE), "region_segments");
  return {
    segments: { basis: pBasis, items: Object.entries(product).map(([name, revenue]) => ({ name: tidyName(name), revenue, share: revenue / pTotal })) },
    geoMix: { basis: gBasis, items: Object.entries(geo).map(([region, v]) => ({ region: tidyName(region), share: v / gTotal })) },
  };
}
