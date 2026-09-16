import { readRawJson, num, section, type Rec } from "../raw";
import type { FactPack } from "../schema";
const FILE = "bigdata-tearsheet-annual.json";
const STATEMENTS = "bigdata-statements-annual.json";
export const READS = [FILE, STATEMENTS] as const;
/** Vendor labels sometimes arrive letter-spaced ("E M E A"); collapse those, leave real multi-word names alone. */
export const tidyName = (s: string) => (s.trim().split(/\s+/).every((t) => t.length === 1) ? s.replace(/\s+/g, "") : s.trim());
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] = [
  { field: "segments", endpoint: "bigdata_company_tearsheet.revenue_segmentation.product", source: "bigdata" },
  { field: "geoMix", endpoint: "bigdata_company_tearsheet.revenue_segmentation.geographic", source: "bigdata" },
];

/** The latest FY entry of one revenue_segmentation kind, or null when the vendor carries none. */
function latestMix(ts: unknown, kind: "product" | "geographic", valuesKey: string): { basis: string; values: Record<string, number>; total: number } | null {
  const byDate = section<Record<string, Rec>>(ts, ["revenue_segmentation", kind], FILE);
  const entries = Object.values(byDate).filter((e) => e.period === "FY" && typeof e.fiscal_year === "number");
  if (!entries.length) return null;
  const top = entries.sort((a, b) => (b.fiscal_year as number) - (a.fiscal_year as number))[0];
  const fy = num(top, "fiscal_year", FILE)!;
  const values = section<Record<string, number>>(top, [valuesKey], FILE);
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (total === 0) throw new Error(`Zero ${kind} segment total under revenue_segmentation in ${FILE}`);
  return { basis: `FY${String(fy).slice(2)}`, values, total };
}

export function mapSegments(dir: string): { segments: FactPack["segments"]; geoMix: FactPack["geoMix"] } {
  const ts = readRawJson(dir, FILE);
  const product = latestMix(ts, "product", "product_segments");
  const geography = latestMix(ts, "geographic", "region_segments");
  const toItems = (m: { basis: string; values: Record<string, number>; total: number }) =>
    Object.entries(m.values).map(([name, revenue]) => ({ name: tidyName(name), revenue, share: revenue / m.total }));

  if (product) {
    // The usual case: the vendor breaks revenue out by product line. Geography is the separate mix, and
    // a single-jurisdiction issuer (a domestic miner, say) carries none — an empty geoMix, not a failure.
    return {
      segments: { basis: product.basis, items: toItems(product) },
      geoMix: geography
        ? { basis: geography.basis, items: toItems(geography).map((g) => ({ region: g.name, share: g.share })) }
        : { basis: product.basis, items: [] },
    };
  }
  if (geography) {
    // No product segmentation (a single-product company such as an AI cloud): the only disaggregation the
    // vendor gives is geographic, so it becomes the segment basis, labelled by geography, with no separate
    // geography line to avoid repeating it.
    return {
      segments: { basis: `${geography.basis} by geography`, items: toItems(geography) },
      geoMix: { basis: geography.basis, items: [] },
    };
  }
  // Neither a product nor a geographic split: a single-reportable-segment issuer, such as a young
  // AI-compute company whose 10-Q reports one segment. Size one consolidated segment from the latest
  // FY revenue so the moat section has a basis to narrate, and carry an empty geoMix.
  const stmts = readRawJson(dir, STATEMENTS);
  const rows = section<Rec[]>(stmts, ["fundamentals", "income_statement"], STATEMENTS);
  const fyRows = rows.filter((r) => r.fiscal_period === "FY" && typeof r.fiscal_year === "number");
  if (!fyRows.length) throw new Error(`No product/geographic segmentation, and no FY income rows to size a single reportable segment in ${STATEMENTS}`);
  const top = fyRows.sort((a, b) => (b.fiscal_year as number) - (a.fiscal_year as number))[0];
  const fy = num(top, "fiscal_year", STATEMENTS)!;
  const revenue = num(top, "revenue", STATEMENTS)!;
  const yy = String(fy).slice(2);
  return {
    segments: { basis: `FY${yy} (single reportable segment)`, items: [{ name: "Consolidated", revenue, share: 1 }] },
    geoMix: { basis: `FY${yy}`, items: [] },
  };
}
