/**
 * manifest.ts — the single list of what a capture fetches.
 * -----------------------------------------------------------------------------
 * The skill reads this (via `npm run facts:manifest`) and executes it. Adding a
 * data point is a change here, not a prompt edit. Phase 2 entries depend on
 * values learned in phase 1 (peers, the Bigdata entity id).
 */
export const PEER_LIMIT = 4;
export const RAW_CAPTURE_META = "capture.json";

export interface CaptureContext {
  ticker: string;
  company: string;
  periodEnd: string;   // YYYY-MM-DD from the filing
  today: string;       // YYYY-MM-DD
  peers?: string[];
  rpEntityId?: string;
  companyType?: "Public" | "Private";
}

export interface ManifestEntry {
  name: string;
  file: string;
  server: "fmp" | "bigdata";
  tool: string;                       // MCP tool name suffix, e.g. "statements"
  phase: 1 | 2;
  perPeer?: boolean;
  params: (ctx: CaptureContext, peer?: string) => Record<string, unknown>;
}

export interface RenderedCall { name: string; file: string; server: "fmp" | "bigdata"; tool: string; params: Record<string, unknown> }

const isoMinusDays = (ymd: string, days: number) => {
  const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const fmp = (name: string, file: string, tool: string, params: ManifestEntry["params"], phase: 1 | 2 = 1, perPeer = false): ManifestEntry =>
  ({ name, file, server: "fmp", tool, phase, perPeer, params });

export const MANIFEST: ManifestEntry[] = [
  fmp("profile", "fmp-profile.json", "company", (c) => ({ endpoint: "profile-symbol", symbol: c.ticker })),
  fmp("quote", "fmp-quote.json", "quote", (c) => ({ endpoint: "quote", symbol: c.ticker })),
  fmp("income-annual", "fmp-income-annual.json", "statements", (c) => ({ endpoint: "income-statement", symbol: c.ticker, period: "annual", limit: 5 })),
  fmp("balance-annual", "fmp-balance-annual.json", "statements", (c) => ({ endpoint: "balance-sheet-statement", symbol: c.ticker, period: "annual", limit: 5 })),
  fmp("cashflow-annual", "fmp-cashflow-annual.json", "statements", (c) => ({ endpoint: "cashflow-statement", symbol: c.ticker, period: "annual", limit: 5 })),
  fmp("income-quarter", "fmp-income-quarter.json", "statements", (c) => ({ endpoint: "income-statement", symbol: c.ticker, period: "quarter", limit: 8 })),
  fmp("key-metrics-ttm", "fmp-key-metrics-ttm.json", "statements", (c) => ({ endpoint: "key-metrics-ttm", symbol: c.ticker })),
  fmp("ratios-ttm", "fmp-ratios-ttm.json", "statements", (c) => ({ endpoint: "metrics-ratios-ttm", symbol: c.ticker })),
  fmp("segments-product", "fmp-segments-product.json", "statements", (c) => ({ endpoint: "revenue-product-segmentation", symbol: c.ticker, period: "annual" })),
  fmp("segments-geo", "fmp-segments-geo.json", "statements", (c) => ({ endpoint: "revenue-geographic-segments", symbol: c.ticker, period: "annual" })),
  fmp("target-consensus", "fmp-target-consensus.json", "analyst", (c) => ({ endpoint: "price-target-consensus", symbol: c.ticker })),
  fmp("target-summary", "fmp-target-summary.json", "analyst", (c) => ({ endpoint: "price-target-summary", symbol: c.ticker })),
  fmp("grades-summary", "fmp-grades-summary.json", "analyst", (c) => ({ endpoint: "grades-summary", symbol: c.ticker })),
  fmp("estimates", "fmp-estimates.json", "analyst", (c) => ({ endpoint: "financial-estimates", symbol: c.ticker, period: "annual" })),
  fmp("history", "fmp-history.json", "chart", (c) => ({ endpoint: "historical-price-eod-light", symbol: c.ticker, from_date: isoMinusDays(c.periodEnd, 45), to_date: c.today })),
  fmp("peers", "fmp-peers.json", "company", (c) => ({ endpoint: "peers", symbol: c.ticker })),
  fmp("peer-ttm", "fmp-peer-{PEER}-ttm.json", "statements", (_c, peer) => ({ endpoint: "key-metrics-ttm", symbol: peer }), 2, true),
  { name: "entity", file: "bigdata-entity.json", server: "bigdata", tool: "find_securities", phase: 1,
    params: (c) => ({ query: c.ticker, security_types: ["COMPANY"] }) },
  { name: "tearsheet", file: "bigdata-tearsheet.md", server: "bigdata", tool: "bigdata_company_tearsheet", phase: 2,
    params: (c) => ({ rp_entity_id: c.rpEntityId, company_type: c.companyType, interval: "quarter",
                      sections: ["company_overview", "analyst_ratings", "revenue_segmentation"] }) },
  { name: "transcript", file: "bigdata-transcript.md", server: "bigdata", tool: "bigdata_search", phase: 1,
    params: (c) => ({ request: { search_mode: "smart", query: {
      text: `${c.company} latest earnings call key points and management commentary`, max_chunks: 20 } } }) },
  { name: "headlines", file: "bigdata-headlines.md", server: "bigdata", tool: "bigdata_search", phase: 1,
    params: (c) => ({ request: { search_mode: "smart", query: {
      text: `${c.company} news since ${c.periodEnd}`, max_chunks: 20 } } }) },
];

export function renderManifest(ctx: CaptureContext): RenderedCall[] {
  const out: RenderedCall[] = [];
  for (const m of MANIFEST) {
    if (m.phase === 2 && m.perPeer) {
      for (const peer of (ctx.peers ?? []).slice(0, PEER_LIMIT))
        out.push({ name: `${m.name}:${peer}`, file: m.file.replace("{PEER}", peer), server: m.server, tool: m.tool, params: m.params(ctx, peer) });
      continue;
    }
    if (m.phase === 2 && !(ctx.rpEntityId && ctx.companyType)) continue;
    out.push({ name: m.name, file: m.file, server: m.server, tool: m.tool, params: m.params(ctx) });
  }
  return out;
}

export function requiredRawFiles(ctx: CaptureContext): string[] {
  return [RAW_CAPTURE_META, ...renderManifest(ctx).map((c) => c.file)];
}
