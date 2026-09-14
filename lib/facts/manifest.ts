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
 *
 * Revision 2026-09-13: facts:prepare also fetches the earnings press release
 * (8-K exhibit 99.1) as CODE_FETCHED_FILES' edgar-press-release.html, or writes
 * edgar-press-release.missing when no 8-K/exhibit is found — `--check` accepts
 * that marker in the .html's place — and, for a 10-Q, the prior 10-K's primary
 * document as the new OPTIONAL_FILES' edgar-10k-primary.html, read when present
 * but never required.
 *
 * Revision 2026-09-14: the latest definitive proxy statement (DEF 14A) filed on
 * or before the filing is captured as OPTIONAL_FILES' edgar-proxy.html — the
 * governance source (board, pay, ownership) — read when present, never required.
 */
export const PEER_LIMIT = 4;
export const RAW_CAPTURE_META = "capture.json";
export const PRESS_RELEASE_FILE = "edgar-press-release.html";
/** Stands in for PRESS_RELEASE_FILE when no earnings release was found; `--check` accepts either. */
export const PRESS_RELEASE_MISSING_FILE = "edgar-press-release.missing";
/** A 10-Q's prior 10-K primary document, captured only when relevant (see OPTIONAL_FILES). */
export const ANNUAL_PRIMARY_FILE = "edgar-10k-primary.html";
/** The latest definitive proxy statement (DEF 14A) filed on or before the filing — the governance source (see OPTIONAL_FILES). */
export const PROXY_FILE = "edgar-proxy.html";
export const CODE_FETCHED_FILES = ["edgar-filing.json", "edgar-primary.html", "yahoo-history.json", PRESS_RELEASE_FILE] as const;
/** Captured only when relevant (a 10-Q's prior 10-K); read when present but never required by `--check`. */
export const OPTIONAL_FILES = [ANNUAL_PRIMARY_FILE, PROXY_FILE] as const;
/** Captured in phase 1 and read by facts-manifest to resolve phase 2 (rpEntityId, companyType); not FactPack data, so no mapper reads it. */
export const PHASE_INPUT_FILES = ["bigdata-entity.json"] as const;

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
  { name: "entity", file: PHASE_INPUT_FILES[0], server: "bigdata", tool: "find_securities", phase: 1,
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

/**
 * Which required raw files are absent, given the filenames actually present in the capture
 * directory. A present PRESS_RELEASE_MISSING_FILE satisfies the press-release requirement in
 * PRESS_RELEASE_FILE's place, so `--check` never demands both.
 */
export function missingRawFiles(present: readonly string[], ctx: CaptureContext): string[] {
  const have = new Set(present);
  return requiredRawFiles(ctx).filter((f) => {
    if (have.has(f)) return false;
    if (f === PRESS_RELEASE_FILE && have.has(PRESS_RELEASE_MISSING_FILE)) return false;
    return true;
  });
}

/** True when the press-release requirement is satisfied only by the `.missing` marker, not the html. */
export function pressReleaseIsMissing(present: readonly string[]): boolean {
  const have = new Set(present);
  return !have.has(PRESS_RELEASE_FILE) && have.has(PRESS_RELEASE_MISSING_FILE);
}
