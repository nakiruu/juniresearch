/**
 * manifest.ts — the single list of what a capture fetches.
 * -----------------------------------------------------------------------------
 * The skill reads this (via `npm run facts:manifest`) and executes it. Adding a
 * data point is a change here, not a prompt edit. Phase 2 entries depend on a
 * value learned in phase 1: the Bigdata entity id.
 *
 * Revision 2026-09-12: the FMP connector's plan gates quote/statements/analyst/
 * chart, so numbers now come from Bigdata's tearsheet (which proxies FMP) and
 * daily closes come from Yahoo's keyless chart endpoint (fetched in code, see
 * CODE_FETCHED_FILES) — not through the manifest at all.
 */
export const PEER_LIMIT = 4;
export const RAW_CAPTURE_META = "capture.json";
export const CODE_FETCHED_FILES = ["edgar-filing.json", "edgar-primary.html", "yahoo-history.json"] as const;

export interface CaptureContext {
  ticker: string;
  company: string;
  periodEnd: string;   // YYYY-MM-DD from the filing
  today: string;       // YYYY-MM-DD
  rpEntityId?: string;
  companyType?: "Public" | "Private";
}

export interface ManifestEntry {
  name: string;
  file: string;
  server: "fmp" | "bigdata";
  tool: string;                       // MCP tool name suffix, e.g. "statements"
  phase: 1 | 2;
  params: (ctx: CaptureContext) => Record<string, unknown>;
}

export interface RenderedCall { name: string; file: string; server: "fmp" | "bigdata"; tool: string; params: Record<string, unknown> }

export const isoMinusDays = (ymd: string, days: number) => {
  const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const fmp = (name: string, file: string, tool: string, params: ManifestEntry["params"]): ManifestEntry =>
  ({ name, file, server: "fmp", tool, phase: 1, params });

const TEARSHEET_SECTIONS_ANNUAL = [
  "company_overview", "analyst_ratings", "analyst_estimates", "key_metrics", "financial_ratios", "revenue_segmentation",
];

const tearsheet = (name: string, file: string, interval: "annual" | "quarter", sections: string[]): ManifestEntry => ({
  name, file, server: "bigdata", tool: "bigdata_company_tearsheet", phase: 2,
  params: (c) => ({ rp_entity_id: c.rpEntityId, company_type: c.companyType, interval, sections }),
});

export const MANIFEST: ManifestEntry[] = [
  fmp("peers", "fmp-peers.json", "company", (c) => ({ endpoint: "peers", symbol: c.ticker })),
  { name: "entity", file: "bigdata-entity.json", server: "bigdata", tool: "find_securities", phase: 1,
    params: (c) => ({ query: c.ticker, security_types: ["COMPANY"] }) },
  tearsheet("tearsheet-annual", "bigdata-tearsheet-annual.json", "annual", TEARSHEET_SECTIONS_ANNUAL),
  tearsheet("statements-annual", "bigdata-statements-annual.json", "annual", ["financial_statements"]),
  tearsheet("statements-quarter", "bigdata-statements-quarter.json", "quarter", ["financial_statements"]),
  { name: "transcript", file: "bigdata-transcript.json", server: "bigdata", tool: "bigdata_search", phase: 1,
    params: (c) => ({ request: { search_mode: "smart", query: {
      text: `${c.company} latest earnings call key points and management commentary`, max_chunks: 20 } } }) },
  { name: "headlines", file: "bigdata-headlines.json", server: "bigdata", tool: "bigdata_search", phase: 1,
    params: (c) => ({ request: { search_mode: "smart", query: {
      text: `${c.company} news since ${c.periodEnd}`, max_chunks: 20 } } }) },
];

export function renderManifest(ctx: CaptureContext): RenderedCall[] {
  const phase2Ready = Boolean(ctx.rpEntityId && ctx.companyType);
  return MANIFEST
    .filter((m) => m.phase === 1 || phase2Ready)
    .map((m) => ({ name: m.name, file: m.file, server: m.server, tool: m.tool, params: m.params(ctx) }));
}

export function requiredRawFiles(ctx: CaptureContext): string[] {
  return [RAW_CAPTURE_META, ...CODE_FETCHED_FILES, ...renderManifest(ctx).map((c) => c.file)];
}
