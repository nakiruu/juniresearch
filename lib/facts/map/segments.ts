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

type Mix = { basis: string; values: Record<string, number>; total: number };

/** The latest FY entry of one revenue_segmentation kind, or null when the vendor carries none. */
function latestMix(ts: unknown, kind: "product" | "geographic", valuesKey: string): Mix | null {
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

/** The latest FY income row (fiscal year and revenue), or null when the statements file has none. */
function latestFyIncome(dir: string): { fy: number; revenue: number } | null {
  let rows: Rec[];
  try {
    rows = section<Rec[]>(readRawJson(dir, STATEMENTS), ["fundamentals", "income_statement"], STATEMENTS);
  } catch {
    return null;
  }
  const fyRows = rows.filter((r) => r.fiscal_period === "FY" && typeof r.fiscal_year === "number");
  if (!fyRows.length) return null;
  const top = fyRows.sort((a, b) => (b.fiscal_year as number) - (a.fiscal_year as number))[0];
  const fy = num(top, "fiscal_year", STATEMENTS), revenue = num(top, "revenue", STATEMENTS);
  return fy != null && revenue != null ? { fy, revenue } : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isContraLine = (name: string, value: number) => value < 0 && /elimination|intersegment/i.test(name);

/** Some vendor product mixes carry a contra-revenue reconciling line — internal sales a company
 *  nets out at the consolidated level (an in-house foundry selling wafers to its own product groups,
 *  say). It arrives as a negative "Intersegment Eliminations" entry, so the positive operating
 *  segments sum well above consolidated revenue. Drop the contra line and present the operating
 *  segments on a gross basis (shares of their own gross total), noted, rather than as a segment with
 *  a negative share. Leaves a mix with no such line untouched. */
function stripEliminations(mix: Mix): Mix {
  if (!Object.entries(mix.values).some(([n, v]) => isContraLine(n, v))) return mix;
  const values = Object.fromEntries(Object.entries(mix.values).filter(([n, v]) => !isContraLine(n, v)));
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (Object.keys(values).length < 2 || total <= 0) return mix;
  return { basis: `${mix.basis} (gross of intersegment eliminations)`, values, total };
}

/** Some vendor product mixes carry both a combined segment ("Client and Gaming") and one of its
 *  components ("Gaming") as separate lines, so they sum above total revenue and double-count. When
 *  that happens, drop any label that appears as a whole-word sub-phrase of another label, but only
 *  if doing so reconciles the remaining lines to revenue and still leaves at least two segments. */
function reconcileToRevenue(mix: Mix, revenue: number | null): Mix {
  if (revenue == null || mix.total <= revenue * 1.02) return mix;
  const names = Object.keys(mix.values);
  const redundant = new Set(names.filter((n) => names.some((m) => m !== n && new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(m))));
  if (!redundant.size) return mix;
  const values = Object.fromEntries(Object.entries(mix.values).filter(([n]) => !redundant.has(n)));
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (Object.keys(values).length < 2 || Math.abs(total - revenue) > revenue * 0.02) return mix;
  return { basis: mix.basis, values, total };
}

export function mapSegments(dir: string): { segments: FactPack["segments"]; geoMix: FactPack["geoMix"] } {
  const ts = readRawJson(dir, FILE);
  const income = latestFyIncome(dir);
  let product = latestMix(ts, "product", "product_segments");
  if (product) product = reconcileToRevenue(stripEliminations(product), income?.revenue ?? null);
  const geography = latestMix(ts, "geographic", "region_segments");
  const toItems = (m: Mix) =>
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
  if (!income) throw new Error(`No product/geographic segmentation, and no FY income rows to size a single reportable segment in ${STATEMENTS}`);
  const yy = String(income.fy).slice(2);
  return {
    segments: { basis: `FY${yy} (single reportable segment)`, items: [{ name: "Consolidated", revenue: income.revenue, share: 1 }] },
    geoMix: { basis: `FY${yy}`, items: [] },
  };
}
