# Fact Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect new 10-Q/10-K filings for a watchlist via EDGAR, capture every vendor response a report needs verbatim through a manifest-driven skill, and turn those raw files into a validated FactPack — plus wire the real price history into the chart.

**Architecture:** Detection is keyless TypeScript against `data.sec.gov`. Capture is a repo skill that executes a code-owned manifest and saves responses byte-for-byte to `data/raw/<TICKER>/<accession>/`. Everything with judgment in it — mapping, validation, projection — is a pure, tested function over those files. The Report schema gains optional `quote.history` (1.1.0) so the chart shows real closes.

**Tech Stack:** TypeScript, Zod, Node 24 `fetch`, `tsx` (dev) for CLIs, Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-fact-pipeline-design.md`

> **Revision 2026-09-12:** Tasks 6–11 were rewritten after the first capture showed the FMP connector's plan gates most endpoints. Numbers now come from Bigdata.com tearsheets, closes from Yahoo, profile/peers from FMP `company`. See the spec's "Revision 2026-09-12" section (decision 8).

## Global Constraints

- **Numbers are numbers; every percentage is a decimal ratio.** A FactPack never contains a pre-formatted string for a number. `dividendYield: 0.0072`, never `0.72` or `"0.72%"`.
- **The skill contains no mapping rule and no number.** It executes the manifest: call tool X with params Y, save the response verbatim as file Z. Responses are saved exactly as returned — no reformatting, summarising, or omitted fields.
- **All network I/O in `lib/` lives in `lib/edgar/`.** Every fetcher takes `fetchImpl: typeof fetch = fetch` as its last parameter so tests inject fixtures. The connectors are reached only through the skill.
- **EDGAR requests carry `User-Agent: juniresearch/0.1 (<contact>)`** where `<contact>` is the `EDGAR_CONTACT` environment variable. CLIs fail with a clear message when it is unset. Never commit an email address; `.env.local` is git-ignored.
- **Raw files are committed** under `data/raw/<TICKER>/<accession>/`. Ticker directories are upper-case; the accession keeps its dashes.
- **`data/facts/<TICKER>/<accession>.json`** is written only by `facts:build`, only after Zod and `validateFactPack` both pass.
- **`lib/format.ts` is frozen. `lib/report.schema.ts` is frozen except for Task 12's additive change** (`quote.history?`, `SCHEMA_VERSION = "1.1.0"`).
- **CLIs run via `tsx`:** `node --env-file-if-exists=.env.local --import tsx scripts/<name>.ts`. Scripts import `lib/` with relative paths.
- **Test output stays pristine.** `npm test` green after every task; `npx tsc --noEmit -p .` clean after every task; `npm run build` green after Task 12.
- **Commit after every task.** Conventional prefixes. End every commit message with the `Co-Authored-By:` and `Claude-Session:` trailer lines the session instructs.
- **Fixture facts, verified 2026-09-12:** Broadcom CIK `1730168`; latest 10-Q accession `0001730168-26-000080`, filed `2026-09-10`, period end `2026-08-02`, primary document `avgo-20260802.htm`; the `submissions` record has ~990 `filings.recent` entries with columnar arrays `accessionNumber[]`, `form[]`, `filingDate[]`, `reportDate[]`, `primaryDocument[]`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/facts/schema.ts` | FactPack Zod contract, `FACTPACK_SCHEMA_VERSION` |
| `lib/edgar/client.ts` | headers, `edgarJson`, `edgarText`, `FetchLike` |
| `lib/edgar/tickers.ts` | `resolveCik` |
| `lib/edgar/submissions.ts` | `Filing`, `parseSubmissions`, `fetchSubmissions`, URL helpers |
| `lib/edgar/filing-text.ts` | `htmlToText`, `capAtSentence`, `extractSections`, `fetchPrimaryDocument` |
| `lib/edgar/detect.ts` | `detectNew`, `markSeen`, `WatchEntry`, `SeenState`, `NewFiling` |
| `lib/edgar/__fixtures__/` | trimmed submissions JSON, ticker-map slice |
| `lib/facts/manifest.ts` | the capture list, `renderManifest`, `requiredRawFiles` |
| `lib/facts/source.ts` | `FactSource` interface (the REST seam) |
| `lib/prices/yahoo.ts` | `yahooChartUrl`, `fetchDailyCloses` (daily closes; the second permitted network module) |
| `lib/facts/raw.ts` | `readRawJson`, `readRawText`, `num`, `str`, `section` |
| `lib/facts/map/*.ts` | one pure mapper per raw-file family |
| `lib/facts/validate.ts` | consistency rules |
| `lib/facts/build.ts` | raw dir → FactPack |
| `lib/facts/project.ts` | FactPack → `ReportFacts` |
| `scripts/*.ts` | `detect`, `watchlist-add`, `facts-manifest`, `facts-prepare`, `facts-build`, `facts-diff`, `report-history` |
| `.claude/skills/fetch-facts/SKILL.md` | the capture recipe |
| `data/edgar/watchlist.json`, `data/edgar/seen.json` | pipeline state |

---

## Task 1: FactPack schema

**Files:**
- Create: `lib/facts/schema.ts`, `lib/facts/__fixtures__/minimal-pack.ts`
- Test: `lib/facts/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FactPack` (Zod object + inferred type), `FACTPACK_SCHEMA_VERSION = "1.0.0"`, `StatementRow`, `Excerpt`, `HistoryPoint` types; `minimalPack()` fixture factory (used again by Task 10).

- [ ] **Step 1: Write the fixture factory and the failing test**

`lib/facts/__fixtures__/minimal-pack.ts` (a plain module, not a test file, so both test files can import it without re-registering suites):

```ts
import { FACTPACK_SCHEMA_VERSION } from "../schema";

export const excerpt = { text: "x", source: "fmp:profile-symbol", asOf: "2026-09-12T00:00:00Z" };
const row = (key: string) => ({ key, label: key, values: [1, 2, 3, 4, 5] });

export const minimalPack = () => ({
  schemaVersion: FACTPACK_SCHEMA_VERSION,
  ticker: "AVGO", cik: 1730168, company: "Broadcom Inc.", exchange: "NASDAQ",
  filing: { form: "10-Q", accession: "0001730168-26-000080", filedDate: "2026-09-10",
            periodEnd: "2026-08-02", url: "https://www.sec.gov/x" },
  capturedAt: "2026-09-12T15:00:00Z",
  quote: { price: 361.99, marketCap: 1.72e12, sharesOutstanding: 4.76e9,
           week52Low: 289.96, week52High: 495, dividendYield: 0.0072, asOf: "2026-09-11" },
  statements: { fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25"],
                income: [row("revenue")], balance: [row("totalDebt")], cashflow: [row("freeCashFlow")] },
  latestQuarter: { label: "Q3'26", periodEnd: "2026-08-02", revenue: 2.96e10, operatingMargin: 0.68, revenueYoY: 0.86 },
  ttm: { pe: 44.9, ps: 19.3, evToEbitda: 33.6, grossMargin: 0.68, operatingMargin: 0.6, netMargin: 0.4 },
  estimates: { nextFY: { label: "FY26E", revenue: 1.059e11, eps: 12 }, followingFY: { label: "FY27E", revenue: 1.5e11, eps: 19 } },
  analysts: { count: 60, buy: 54, hold: 6, sell: 0, consensusRating: "Buy", consensusTarget: 509.61,
              medianTarget: 517.5, highTarget: 600, lowTarget: 350, asOf: "2026-09-12" },
  segments: { basis: "FY25", items: [{ name: "Semis", revenue: 3.69e10, share: 0.58 }, { name: "Software", revenue: 2.7e10, share: 0.42 }] },
  geoMix: { basis: "FY25", items: [{ region: "APAC", share: 0.56 }, { region: "Americas", share: 0.3 }, { region: "EMEA", share: 0.14 }] },
  peers: [{ ticker: "NVDA", pe: 40, ps: 24, evToEbitda: 36 }],
  history: [{ date: "2026-09-10", close: 360 }, { date: "2026-09-11", close: 361.99 }],
  context: { description: excerpt, mdaExcerpt: null, riskFactorsExcerpt: null, transcriptHighlights: null, headlines: [] },
  provenance: [{ field: "quote", source: "fmp", endpoint: "quote", capturedAt: "2026-09-12T15:00:00Z" }],
});
```

`lib/facts/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FactPack } from "@/lib/facts/schema";
import { minimalPack, excerpt } from "@/lib/facts/__fixtures__/minimal-pack";

describe("FactPack schema", () => {
  it("parses a minimal valid pack", () => {
    expect(() => FactPack.parse(minimalPack())).not.toThrow();
  });
  it("rejects a foreign schema version", () => {
    expect(() => FactPack.parse({ ...minimalPack(), schemaVersion: "0.9.0" })).toThrow();
  });
  it("requires exactly five fiscal years", () => {
    const p = minimalPack(); p.statements.fiscalYears = ["FY22", "FY23", "FY24", "FY25"];
    expect(() => FactPack.parse(p)).toThrow();
  });
  it("caps headlines at ten", () => {
    const p = minimalPack(); p.context.headlines = Array.from({ length: 11 }, () => excerpt);
    expect(() => FactPack.parse(p)).toThrow();
  });
  it("allows null statement cells for a year a vendor lacks", () => {
    const p = minimalPack(); p.statements.income = [{ key: "ebitda", label: "EBITDA", values: [null, 1, 2, 3, 4] }];
    expect(() => FactPack.parse(p)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/facts/schema.test.ts` → FAIL, cannot resolve `@/lib/facts/schema`.

- [ ] **Step 3: Implement**

```ts
/**
 * schema.ts — the FactPack: everything subsystem 3 needs to write a report.
 * -----------------------------------------------------------------------------
 * Numbers are raw, ratios are ratios, nothing is pre-formatted. Every field a
 * Report fact derives from has a provenance entry. Statement cells may be null
 * where a vendor lacks a year; the Report's own cell contract renders null as —.
 */
import { z } from "zod";

export const FACTPACK_SCHEMA_VERSION = "1.0.0";

const ratio = z.number();
const nullableNum = z.number().nullable();

export const Excerpt = z.object({
  text: z.string(),
  source: z.string(),
  url: z.string().optional(),
  asOf: z.string(),
  truncated: z.boolean().optional(),
});

export const StatementRow = z.object({
  key: z.string(),
  label: z.string(),
  values: z.array(nullableNum).length(5),
});

export const HistoryPoint = z.object({ date: z.string(), close: z.number() });

const estimate = z.object({ label: z.string(), revenue: nullableNum, eps: nullableNum });

export const FactPack = z.object({
  schemaVersion: z.literal(FACTPACK_SCHEMA_VERSION),
  ticker: z.string(),
  cik: z.number().int(),
  company: z.string(),
  exchange: z.string(),
  filing: z.object({
    form: z.enum(["10-Q", "10-K"]),
    accession: z.string(),
    filedDate: z.string(),
    periodEnd: z.string(),
    url: z.string(),
  }),
  capturedAt: z.string(),
  quote: z.object({
    price: z.number(), marketCap: z.number(), sharesOutstanding: z.number(),
    week52Low: z.number(), week52High: z.number(), dividendYield: ratio, asOf: z.string(),
  }),
  statements: z.object({
    fiscalYears: z.array(z.string()).length(5),
    income: z.array(StatementRow),
    balance: z.array(StatementRow),
    cashflow: z.array(StatementRow),
  }),
  latestQuarter: z.object({
    label: z.string(), periodEnd: z.string(), revenue: z.number(),
    operatingMargin: ratio, revenueYoY: ratio,
  }),
  ttm: z.object({
    pe: nullableNum, ps: nullableNum, evToEbitda: nullableNum,
    grossMargin: nullableNum, operatingMargin: nullableNum, netMargin: nullableNum,
  }),
  estimates: z.object({ nextFY: estimate, followingFY: estimate }),
  analysts: z.object({
    count: z.number().int(), buy: z.number().int(), hold: z.number().int(), sell: z.number().int(),
    consensusRating: z.string(), consensusTarget: z.number(), medianTarget: z.number(),
    highTarget: z.number(), lowTarget: z.number(), asOf: z.string(),
  }),
  segments: z.object({
    basis: z.string(),
    items: z.array(z.object({ name: z.string(), revenue: z.number(), share: ratio })),
  }),
  geoMix: z.object({
    basis: z.string(),
    items: z.array(z.object({ region: z.string(), share: ratio })),
  }),
  peers: z.array(z.object({ ticker: z.string(), pe: nullableNum, ps: nullableNum, evToEbitda: nullableNum })),
  history: z.array(HistoryPoint),
  context: z.object({
    description: Excerpt,
    mdaExcerpt: Excerpt.nullable(),
    riskFactorsExcerpt: Excerpt.nullable(),
    transcriptHighlights: Excerpt.nullable(),
    headlines: z.array(Excerpt).max(10),
  }),
  provenance: z.array(z.object({
    field: z.string(),
    source: z.enum(["fmp", "bigdata", "edgar"]),
    endpoint: z.string(),
    capturedAt: z.string(),
  })),
});

export type FactPack = z.infer<typeof FactPack>;
export type StatementRow = z.infer<typeof StatementRow>;
export type Excerpt = z.infer<typeof Excerpt>;
export type HistoryPoint = z.infer<typeof HistoryPoint>;
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/facts/schema.test.ts` → 5 passing. Then `npm test` — 97 + 5.

- [ ] **Step 5: Commit** — `git add lib/facts && git commit -m "feat: add the FactPack schema"`

---

## Task 2: EDGAR client, ticker map, submissions

**Files:**
- Create: `lib/edgar/client.ts`, `lib/edgar/tickers.ts`, `lib/edgar/submissions.ts`
- Create fixtures: `lib/edgar/__fixtures__/avgo-submissions.json`, `lib/edgar/__fixtures__/company-tickers-slice.json`
- Test: `lib/edgar/submissions.test.ts`, `lib/edgar/tickers.test.ts`

**Interfaces:**
- Produces: `FetchLike`, `edgarHeaders(contact)`, `edgarJson<T>(url, contact, fetchImpl?)`, `edgarText(url, contact, fetchImpl?)`; `resolveCik(ticker, contact, fetchImpl?) → { cik, title }`; `Filing`, `padCik`, `submissionsUrl(cik)`, `filingUrl(cik, accession, primaryDocument)`, `parseSubmissions(cik, body) → Filing[]`, `fetchSubmissions(cik, contact, fetchImpl?)`.

- [ ] **Step 1: Create the fixtures with a one-off fetch**

Set `EDGAR_CONTACT` in `.env.local` (git-ignored) as `EDGAR_CONTACT=<your email>`. Then:

```bash
mkdir -p lib/edgar/__fixtures__
node --env-file=.env.local -e '
const ua = { "User-Agent": `juniresearch/0.1 (${process.env.EDGAR_CONTACT})`, Accept: "application/json" };
const fs = require("fs");
(async () => {
  const sub = await (await fetch("https://data.sec.gov/submissions/CIK0001730168.json", { headers: ua })).json();
  const r = sub.filings.recent; const keys = Object.keys(r); const n = 20;
  const recent = Object.fromEntries(keys.map(k => [k, r[k].slice(0, n)]));
  fs.writeFileSync("lib/edgar/__fixtures__/avgo-submissions.json",
    JSON.stringify({ cik: sub.cik, name: sub.name, tickers: sub.tickers, fiscalYearEnd: sub.fiscalYearEnd, filings: { recent, files: [] } }, null, 2));
  const map = await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: ua })).json();
  const slice = Object.fromEntries(Object.entries(map).filter(([, v]) => ["AVGO","NVDA","AMD","QCOM","AAPL","MSFT","ORCL","AVGOP","GOOG","META"].includes(v.ticker)).slice(0, 10));
  fs.writeFileSync("lib/edgar/__fixtures__/company-tickers-slice.json", JSON.stringify(slice, null, 2));
  console.log("recent forms:", recent.form.join(","));
})();'
```

Expected: the printed forms include `10-Q` at least once (the 2026-09-10 filing is within the twenty most recent). If it does not, raise `n` until it does and note the value.

- [ ] **Step 2: Write the failing tests**

`lib/edgar/submissions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSubmissions, fetchSubmissions, submissionsUrl, filingUrl, padCik } from "@/lib/edgar/submissions";
import fixture from "@/lib/edgar/__fixtures__/avgo-submissions.json";

const fakeFetch = (status: number, body: unknown) =>
  (async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;

describe("URL helpers", () => {
  it("pads the CIK to ten digits", () => {
    expect(padCik(1730168)).toBe("0001730168");
    expect(submissionsUrl(1730168)).toBe("https://data.sec.gov/submissions/CIK0001730168.json");
  });
  it("builds the archive URL without accession dashes", () => {
    expect(filingUrl(1730168, "0001730168-26-000080", "avgo-20260802.htm"))
      .toBe("https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm");
  });
});

describe("parseSubmissions", () => {
  const filings = parseSubmissions(1730168, fixture as never);
  it("keeps only 10-Q and 10-K, newest first", () => {
    expect(filings.length).toBeGreaterThan(0);
    for (const f of filings) expect(["10-Q", "10-K"]).toContain(f.form);
    expect(filings[0].accession).toBe("0001730168-26-000080");
  });
  it("zips the columnar record into a Filing", () => {
    expect(filings[0]).toEqual({
      form: "10-Q", accession: "0001730168-26-000080", filedDate: "2026-09-10",
      periodEnd: "2026-08-02", primaryDocument: "avgo-20260802.htm",
      url: "https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm",
    });
  });
});

describe("fetchSubmissions", () => {
  it("throws naming the URL on a non-200", async () => {
    await expect(fetchSubmissions(1730168, "test@example.com", fakeFetch(403, {})))
      .rejects.toThrow(/403.*CIK0001730168/);
  });
  it("sends the required User-Agent", async () => {
    let seen: Record<string, string> = {};
    const spy = (async (_u: string, init: RequestInit) => { seen = init.headers as Record<string, string>;
      return { ok: true, status: 200, json: async () => fixture }; }) as unknown as typeof fetch;
    await fetchSubmissions(1730168, "test@example.com", spy);
    expect(seen["User-Agent"]).toBe("juniresearch/0.1 (test@example.com)");
  });
});
```

`lib/edgar/tickers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveCik } from "@/lib/edgar/tickers";
import slice from "@/lib/edgar/__fixtures__/company-tickers-slice.json";

const fakeFetch = (body: unknown) =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

describe("resolveCik", () => {
  it("resolves a ticker case-insensitively", async () => {
    expect(await resolveCik("avgo", "t@example.com", fakeFetch(slice))).toEqual({ cik: 1730168, title: "Broadcom Inc." });
  });
  it("throws naming the ticker when absent", async () => {
    await expect(resolveCik("ZZZZ", "t@example.com", fakeFetch(slice))).rejects.toThrow(/ZZZZ/);
  });
});
```

- [ ] **Step 3: Run to verify they fail** — both files fail on module resolution.

- [ ] **Step 4: Implement**

`lib/edgar/client.ts`:
```ts
/** Shared EDGAR plumbing. SEC requires a descriptive User-Agent and ≤10 req/s. */
export type FetchLike = typeof fetch;

export function edgarHeaders(contact: string): Record<string, string> {
  return { "User-Agent": `juniresearch/0.1 (${contact})`, Accept: "application/json" };
}

export async function edgarJson<T>(url: string, contact: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: edgarHeaders(contact) });
  if (!res.ok) throw new Error(`EDGAR responded ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function edgarText(url: string, contact: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl(url, { headers: { ...edgarHeaders(contact), Accept: "text/html" } });
  if (!res.ok) throw new Error(`EDGAR responded ${res.status} for ${url}`);
  return res.text();
}

export const EDGAR_MIN_INTERVAL_MS = 120; // ≤ 10 requests/second with margin
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

`lib/edgar/tickers.ts`:
```ts
import { edgarJson, type FetchLike } from "./client";

export const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;

/** One-time lookup at watchlist:add time; detection never needs the 800KB map. */
export async function resolveCik(ticker: string, contact: string, fetchImpl: FetchLike = fetch): Promise<{ cik: number; title: string }> {
  const map = await edgarJson<TickerMap>(TICKER_MAP_URL, contact, fetchImpl);
  const want = ticker.toUpperCase();
  const hit = Object.values(map).find((e) => e.ticker.toUpperCase() === want);
  if (!hit) throw new Error(`Ticker ${ticker} not found in ${TICKER_MAP_URL}`);
  return { cik: hit.cik_str, title: hit.title };
}
```

`lib/edgar/submissions.ts`:
```ts
import { edgarJson, type FetchLike } from "./client";

export interface Filing {
  form: "10-Q" | "10-K";
  accession: string;
  filedDate: string;
  periodEnd: string;
  primaryDocument: string;
  url: string;
}

interface SubmissionsBody {
  filings: { recent: {
    accessionNumber: string[]; form: string[]; filingDate: string[];
    reportDate: string[]; primaryDocument: string[];
  } };
}

export const padCik = (cik: number) => String(cik).padStart(10, "0");
export const submissionsUrl = (cik: number) => `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
export const filingUrl = (cik: number, accession: string, primaryDocument: string) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${primaryDocument}`;

const WANTED = new Set(["10-Q", "10-K"]);

export function parseSubmissions(cik: number, body: SubmissionsBody): Filing[] {
  const r = body.filings.recent;
  const out: Filing[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!WANTED.has(r.form[i])) continue;
    out.push({
      form: r.form[i] as Filing["form"],
      accession: r.accessionNumber[i],
      filedDate: r.filingDate[i],
      periodEnd: r.reportDate[i],
      primaryDocument: r.primaryDocument[i],
      url: filingUrl(cik, r.accessionNumber[i], r.primaryDocument[i]),
    });
  }
  return out; // EDGAR lists newest first; order preserved
}

export async function fetchSubmissions(cik: number, contact: string, fetchImpl: FetchLike = fetch): Promise<Filing[]> {
  return parseSubmissions(cik, await edgarJson<SubmissionsBody>(submissionsUrl(cik), contact, fetchImpl));
}
```

- [ ] **Step 5: Run to verify they pass** — `npx vitest run lib/edgar` → 7 passing; `npm test` green.

- [ ] **Step 6: Commit** — `git add lib/edgar && git commit -m "feat: add EDGAR client, ticker resolution, and submissions parsing"`

---

## Task 3: Filing text extraction

**Files:**
- Create: `lib/edgar/filing-text.ts`
- Create fixture: `data/raw/AVGO/0001730168-26-000080/edgar-primary.html`
- Test: `lib/edgar/filing-text.test.ts`

**Interfaces:**
- Consumes: `edgarText`, `FetchLike` from Task 2.
- Produces: `htmlToText(html)`, `capAtSentence(text, cap?) → { text, truncated }`, `extractSections(text, form) → { mda: string | null; riskFactors: string | null }`, `fetchPrimaryDocument(url, contact, fetchImpl?) → string`, `EXCERPT_CAP = 8000`.

- [ ] **Step 1: Fetch the fixture into its permanent raw location**

```bash
mkdir -p data/raw/AVGO/0001730168-26-000080
node --env-file=.env.local -e '
const ua = { "User-Agent": `juniresearch/0.1 (${process.env.EDGAR_CONTACT})`, Accept: "text/html" };
(async () => {
  const html = await (await fetch("https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm", { headers: ua })).text();
  require("fs").writeFileSync("data/raw/AVGO/0001730168-26-000080/edgar-primary.html", html);
  console.log("bytes:", html.length);
})();'
```

Record the byte count in your report. Anything under 8MB is expected for an inline-XBRL 10-Q.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { htmlToText, capAtSentence, extractSections, EXCERPT_CAP } from "@/lib/edgar/filing-text";

const html = readFileSync("data/raw/AVGO/0001730168-26-000080/edgar-primary.html", "utf8");
const text = htmlToText(html);

describe("htmlToText", () => {
  it("strips tags and decodes common entities", () => {
    expect(htmlToText("<p>Revenue &amp; margin&nbsp;grew</p><p>Next</p>")).toBe("Revenue & margin grew\nNext");
  });
  it("drops scripts and styles", () => {
    expect(htmlToText("<style>p{}</style><script>x()</script><p>ok</p>")).toBe("ok");
  });
});

describe("capAtSentence", () => {
  it("returns short text untouched", () => {
    expect(capAtSentence("Short. Text.", 100)).toEqual({ text: "Short. Text.", truncated: false });
  });
  it("cuts at a sentence boundary and flags truncation", () => {
    const long = "First sentence. Second sentence. " + "x".repeat(200);
    const out = capAtSentence(long, 40);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("First sentence. Second sentence.");
  });
});

describe("extractSections on the AVGO 10-Q", () => {
  const s = extractSections(text, "10-Q");
  it("finds the MD&A body, not the table-of-contents entry", () => {
    expect(s.mda).not.toBeNull();
    expect(s.mda!.length).toBeGreaterThan(2000);
    expect(s.mda!.toLowerCase()).toContain("revenue");
  });
  it("finds risk factors", () => {
    expect(s.riskFactors).not.toBeNull();
    expect(s.riskFactors!.toLowerCase()).toContain("risk");
  });
  it("caps each section", () => {
    expect(s.mda!.length).toBeLessThanOrEqual(EXCERPT_CAP);
    expect(s.riskFactors!.length).toBeLessThanOrEqual(EXCERPT_CAP);
  });
  it("returns null for a section that is absent", () => {
    expect(extractSections("Item 1. Nothing here.", "10-K")).toEqual({ mda: null, riskFactors: null });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — module resolution.

- [ ] **Step 4: Implement**

```ts
/**
 * filing-text.ts — turn an EDGAR primary document into two capped excerpts.
 * -----------------------------------------------------------------------------
 * The filing HTML is simple enough for hand-rolled stripping. Section headings
 * appear twice — once in the table of contents, once in the body — so we take,
 * for each heading, the candidate whose section is longest.
 */
import { edgarText, type FetchLike } from "./client";

export const EXCERPT_CAP = 8000;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|br|td|th)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function capAtSentence(text: string, cap = EXCERPT_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  const slice = text.slice(0, cap);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"), slice.lastIndexOf(".") === slice.length - 1 ? slice.length - 1 : -1);
  const cut = end > cap * 0.5 ? slice.slice(0, end + 1) : slice;
  return { text: cut.trim(), truncated: true };
}

interface SectionSpec { item: string; title: RegExp; until: string[] }

const SPECS: Record<"10-Q" | "10-K", { mda: SectionSpec; riskFactors: SectionSpec }> = {
  "10-Q": {
    mda: { item: "2", title: /management.{0,5}s discussion/i, until: ["3", "4"] },
    riskFactors: { item: "1A", title: /risk factors/i, until: ["2", "3", "4", "5", "6"] },
  },
  "10-K": {
    mda: { item: "7", title: /management.{0,5}s discussion/i, until: ["7A", "8"] },
    riskFactors: { item: "1A", title: /risk factors/i, until: ["1B", "1C", "2"] },
  },
};

function headingRegex(item: string): RegExp {
  return new RegExp(`(^|\\n)\\s*item\\s+${item}\\.?\\s`, "gi");
}

/** Longest candidate wins: the TOC entry is short, the body is long. */
function extractItem(text: string, spec: SectionSpec): string | null {
  const heads = [...text.matchAll(headingRegex(spec.item))].map((m) => m.index! + (m[1]?.length ?? 0));
  let best: string | null = null;
  for (const start of heads) {
    const after = text.slice(start, start + 300);
    if (!spec.title.test(after)) continue;
    let end = text.length;
    for (const nxt of spec.until) {
      const m = headingRegex(nxt).exec(text.slice(start + 50));
      if (m) end = Math.min(end, start + 50 + m.index + (m[1]?.length ?? 0));
    }
    const body = text.slice(start, end).trim();
    if (!best || body.length > best.length) best = body;
  }
  return best && best.length > 200 ? best : null;
}

export function extractSections(text: string, form: "10-Q" | "10-K"): { mda: string | null; riskFactors: string | null } {
  const spec = SPECS[form];
  const mda = extractItem(text, spec.mda);
  const rf = extractItem(text, spec.riskFactors);
  return {
    mda: mda ? capAtSentence(mda).text : null,
    riskFactors: rf ? capAtSentence(rf).text : null,
  };
}

export async function fetchPrimaryDocument(url: string, contact: string, fetchImpl: FetchLike = fetch): Promise<string> {
  return edgarText(url, contact, fetchImpl);
}
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run lib/edgar/filing-text.test.ts` → 7 passing. If `extractSections` returns null for the AVGO MD&A, print the first 300 characters after each `Item 2` heading match and adjust `headingRegex`/`title` to the filing's real punctuation (for example `Item 2 —`) — do not loosen the "longest candidate" rule or the 200-character floor. Report exactly what you changed.

- [ ] **Step 6: Commit** — `git add lib/edgar data/raw && git commit -m "feat: extract MD&A and risk-factor excerpts from EDGAR primary documents"`

---

## Task 4: Detection, watchlist, seen-state, CLIs

**Files:**
- Create: `lib/edgar/detect.ts`, `scripts/detect.ts`, `scripts/watchlist-add.ts`, `data/watchlist.json`, `data/edgar/seen.json`, `.env.example`
- Modify: `package.json` (scripts, `tsx` devDependency)
- Modify: `docs/superpowers/specs/2026-09-12-fact-pipeline-design.md` (the CLI-runtime sentence)
- Test: `lib/edgar/detect.test.ts`

**Interfaces:**
- Consumes: `Filing`, `fetchSubmissions`, `resolveCik`, `sleep`, `EDGAR_MIN_INTERVAL_MS`.
- Produces: `WatchEntry { ticker; cik }`, `SeenState = Record<string, string[]>`, `NewFiling = Filing & { ticker }`, `detectNew(filingsByTicker, seen, limit = 4) → NewFiling[]`, `markSeen(seen, filings) → SeenState`; `npm run detect`, `npm run watchlist:add <TICKER>`.

- [ ] **Step 1: Install tsx and wire scripts**

```bash
npm install -D tsx
```

Add to `package.json` `scripts`:
```json
"detect": "node --env-file-if-exists=.env.local --import tsx scripts/detect.ts",
"watchlist:add": "node --env-file-if-exists=.env.local --import tsx scripts/watchlist-add.ts"
```

Create `.env.example` with one line: `EDGAR_CONTACT=you@example.com`.

Create `data/watchlist.json`: `[{ "ticker": "AVGO", "cik": 1730168 }]` and `data/edgar/seen.json`: `{}`.

In the spec, replace the paragraph beginning "The `scripts/*.ts` CLIs run under Node 24's native type stripping" with: "The `scripts/*.ts` CLIs run via `tsx` (a dev dependency): `node --env-file-if-exists=.env.local --import tsx scripts/<name>.ts`, wrapped by `package.json` scripts. Node's native type stripping was rejected because it requires `.ts` extensions on relative imports, which the Next `tsconfig` does not allow."

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { detectNew, markSeen } from "@/lib/edgar/detect";
import type { Filing } from "@/lib/edgar/submissions";

const f = (accession: string, filedDate: string): Filing => ({
  form: "10-Q", accession, filedDate, periodEnd: "2026-08-02", primaryDocument: "x.htm", url: "https://x/" + accession,
});
const filings = { AVGO: [f("A-3", "2026-09-10"), f("A-2", "2026-06-09"), f("A-1", "2026-03-11")] };

describe("detectNew", () => {
  it("reports everything up to the limit when nothing is seen", () => {
    expect(detectNew(filings, {}, 2).map((x) => x.accession)).toEqual(["A-3", "A-2"]);
  });
  it("reports only unseen accessions, newest first", () => {
    const out = detectNew(filings, { AVGO: ["A-2", "A-1"] });
    expect(out).toEqual([{ ...f("A-3", "2026-09-10"), ticker: "AVGO" }]);
  });
  it("reports nothing when all are seen", () => {
    expect(detectNew(filings, { AVGO: ["A-3", "A-2", "A-1"] })).toEqual([]);
  });
  it("tolerates a ticker with no seen entry", () => {
    expect(detectNew({ NVDA: [f("N-1", "2026-08-01")] }, { AVGO: ["A-3"] }, 4)).toHaveLength(1);
  });
});

describe("markSeen", () => {
  it("appends without mutating the input", () => {
    const seen = { AVGO: ["A-1"] };
    const next = markSeen(seen, [{ ...f("A-2", "2026-06-09"), ticker: "AVGO" }, { ...f("N-1", "2026-08-01"), ticker: "NVDA" }]);
    expect(next).toEqual({ AVGO: ["A-1", "A-2"], NVDA: ["N-1"] });
    expect(seen).toEqual({ AVGO: ["A-1"] });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — module resolution.

- [ ] **Step 4: Implement**

`lib/edgar/detect.ts`:
```ts
import type { Filing } from "./submissions";

export interface WatchEntry { ticker: string; cik: number }
export type SeenState = Record<string, string[]>;
export type NewFiling = Filing & { ticker: string };

/** Pure: which of each ticker's filings has not been seen. Newest first, capped. */
export function detectNew(filingsByTicker: Record<string, Filing[]>, seen: SeenState, limit = 4): NewFiling[] {
  const out: NewFiling[] = [];
  for (const [ticker, filings] of Object.entries(filingsByTicker)) {
    const done = new Set(seen[ticker] ?? []);
    for (const f of filings.filter((x) => !done.has(x.accession)).slice(0, limit)) out.push({ ...f, ticker });
  }
  return out;
}

export function markSeen(seen: SeenState, filings: NewFiling[]): SeenState {
  const next: SeenState = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]]));
  for (const f of filings) (next[f.ticker] ??= []).push(f.accession);
  return next;
}
```

`scripts/_env.ts` (shared by every CLI):
```ts
export function requireContact(): string {
  const c = process.env.EDGAR_CONTACT;
  if (!c) { console.error("EDGAR_CONTACT is not set. Add it to .env.local (see .env.example)."); process.exit(2); }
  return c;
}
```

`scripts/detect.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { fetchSubmissions, type Filing } from "../lib/edgar/submissions";
import { detectNew, markSeen, type SeenState, type WatchEntry } from "../lib/edgar/detect";
import { sleep, EDGAR_MIN_INTERVAL_MS } from "../lib/edgar/client";
import { requireContact } from "./_env";

const contact = requireContact();
const watchlist = JSON.parse(readFileSync("data/watchlist.json", "utf8")) as WatchEntry[];
const seen = JSON.parse(readFileSync("data/edgar/seen.json", "utf8")) as SeenState;

const byTicker: Record<string, Filing[]> = {};
for (const w of watchlist) {
  byTicker[w.ticker] = await fetchSubmissions(w.cik, contact);
  await sleep(EDGAR_MIN_INTERVAL_MS);
}
const fresh = detectNew(byTicker, seen);
if (fresh.length === 0) { console.log("No new 10-Q/10-K filings."); process.exit(0); }
for (const f of fresh) console.log(`${f.ticker}  ${f.form}  ${f.accession}  filed ${f.filedDate}  period ${f.periodEnd}\n  ${f.url}`);
writeFileSync("data/edgar/seen.json", JSON.stringify(markSeen(seen, fresh), null, 2) + "\n");
console.log(`\nMarked ${fresh.length} filing(s) seen. Next: /fetch-facts <TICKER> <ACCESSION>`);
```

`scripts/watchlist-add.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolveCik } from "../lib/edgar/tickers";
import type { WatchEntry } from "../lib/edgar/detect";
import { requireContact } from "./_env";

const ticker = (process.argv[2] ?? "").toUpperCase();
if (!ticker) { console.error("usage: npm run watchlist:add -- <TICKER>"); process.exit(2); }
const list = JSON.parse(readFileSync("data/watchlist.json", "utf8")) as WatchEntry[];
if (list.some((w) => w.ticker === ticker)) { console.log(`${ticker} already watched.`); process.exit(0); }
const { cik, title } = await resolveCik(ticker, requireContact());
list.push({ ticker, cik });
writeFileSync("data/watchlist.json", JSON.stringify(list, null, 2) + "\n");
console.log(`Added ${ticker} (${title}, CIK ${cik}).`);
```

- [ ] **Step 5: Run tests, then the CLI for real**

`npx vitest run lib/edgar/detect.test.ts` → 5 passing. Then `npm run detect` with `.env.local` present. Expected: it prints Broadcom's four most recent 10-Q/10-K filings, the first being `0001730168-26-000080`, and `data/edgar/seen.json` now lists them. Run it again: `No new 10-Q/10-K filings.` Paste both outputs. `npx tsc --noEmit -p .` must be clean (scripts are included by the tsconfig glob).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: add EDGAR filing detection with a watchlist and seen-state"`

---

## Task 5: The capture manifest and the FactSource seam

**Files:**
- Create: `lib/facts/manifest.ts`, `lib/facts/source.ts`, `scripts/facts-manifest.ts`
- Modify: `package.json` (`facts:manifest` script)
- Test: `lib/facts/manifest.test.ts`

**Interfaces:**
- Produces: `ManifestEntry { name; file; server; tool; endpoint?; params; phase: 1 | 2; perPeer? }`, `MANIFEST`, `PEER_LIMIT = 4`, `CaptureContext`, `renderManifest(ctx) → RenderedCall[]`, `requiredRawFiles(ctx) → string[]`, `RAW_CAPTURE_META = "capture.json"`; `FactSource` interface; `npm run facts:manifest <TICKER> <ACCESSION> [--check]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { MANIFEST, renderManifest, requiredRawFiles, PEER_LIMIT } from "@/lib/facts/manifest";

const ctx = { ticker: "AVGO", company: "Broadcom Inc.", periodEnd: "2026-08-02", today: "2026-09-12" };

describe("MANIFEST", () => {
  it("has unique names and files", () => {
    const names = MANIFEST.map((m) => m.name), files = MANIFEST.map((m) => m.file);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(files).size).toBe(files.length);
  });
  it("covers every raw file the spec lists", () => {
    for (const f of ["fmp-profile.json", "fmp-quote.json", "fmp-income-annual.json", "fmp-balance-annual.json",
      "fmp-cashflow-annual.json", "fmp-income-quarter.json", "fmp-key-metrics-ttm.json", "fmp-ratios-ttm.json",
      "fmp-segments-product.json", "fmp-segments-geo.json", "fmp-target-consensus.json", "fmp-target-summary.json",
      "fmp-grades-summary.json", "fmp-estimates.json", "fmp-history.json", "fmp-peers.json",
      "bigdata-entity.json", "bigdata-tearsheet.md", "bigdata-transcript.md", "bigdata-headlines.md"]) {
      expect(MANIFEST.map((m) => m.file)).toContain(f);
    }
  });
});

describe("renderManifest", () => {
  it("renders phase 1 with the history window from periodEnd − 45 days to today", () => {
    const calls = renderManifest({ ...ctx });
    const hist = calls.find((c) => c.file === "fmp-history.json")!;
    expect(hist.params).toMatchObject({ endpoint: "historical-price-eod-light", symbol: "AVGO", from_date: "2026-06-18", to_date: "2026-09-12" });
    expect(calls.some((c) => c.file.startsWith("fmp-peer-"))).toBe(false);
  });
  it("renders per-peer calls and the tearsheet once peers and entity are known", () => {
    const calls = renderManifest({ ...ctx, peers: ["NVDA", "AMD", "QCOM", "MRVL", "INTC"], rpEntityId: "ABC123", companyType: "Public" });
    const peerCalls = calls.filter((c) => c.file.startsWith("fmp-peer-"));
    expect(peerCalls.map((c) => c.file)).toEqual(["fmp-peer-NVDA-ttm.json", "fmp-peer-AMD-ttm.json", "fmp-peer-QCOM-ttm.json", "fmp-peer-MRVL-ttm.json"]);
    expect(peerCalls).toHaveLength(PEER_LIMIT);
    expect(calls.find((c) => c.file === "bigdata-tearsheet.md")!.params).toMatchObject({ rp_entity_id: "ABC123", company_type: "Public" });
  });
});

describe("requiredRawFiles", () => {
  it("lists capture.json, every phase-1 file, and phase-2 files when peers are known", () => {
    const files = requiredRawFiles({ ...ctx, peers: ["NVDA"], rpEntityId: "X", companyType: "Public" });
    expect(files).toContain("capture.json");
    expect(files).toContain("fmp-quote.json");
    expect(files).toContain("fmp-peer-NVDA-ttm.json");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module resolution.

- [ ] **Step 3: Implement**

`lib/facts/manifest.ts`:
```ts
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
    params: (c) => ({ query: `${c.company} latest earnings call key points and management commentary` }) },
  { name: "headlines", file: "bigdata-headlines.md", server: "bigdata", tool: "bigdata_search", phase: 1,
    params: (c) => ({ query: `${c.company} news since ${c.periodEnd}` }) },
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
```

`lib/facts/source.ts`:
```ts
import type { Filing } from "../edgar/submissions";

/**
 * The seam between "how raw files are produced" and everything downstream.
 * Today the only implementation is the fetch-facts skill (prose, executed by a
 * Claude session with the FMP and Bigdata.com connectors). A future
 * RestFactSource produces the same files from the same manifest using API keys.
 * build.ts reads the directory and does not know which wrote it.
 */
export interface FactSource {
  capture(ticker: string, filing: Filing, outDir: string): Promise<void>;
}
```

`scripts/facts-manifest.ts` — prints the rendered calls as JSON for the skill; with `--check`, lists missing raw files and exits 1 if any:
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderManifest, requiredRawFiles, type CaptureContext } from "../lib/facts/manifest";

const [ticker, accession, flag] = process.argv.slice(2);
if (!ticker || !accession) { console.error("usage: npm run facts:manifest -- <TICKER> <ACCESSION> [--check]"); process.exit(2); }
const dir = join("data", "raw", ticker.toUpperCase(), accession);
const filing = JSON.parse(readFileSync(join(dir, "edgar-filing.json"), "utf8")) as { periodEnd: string; company: string };

const ctx: CaptureContext = { ticker: ticker.toUpperCase(), company: filing.company, periodEnd: filing.periodEnd,
  today: new Date().toISOString().slice(0, 10) };
const peersFile = join(dir, "fmp-peers.json"), entityFile = join(dir, "bigdata-entity.json");
if (existsSync(peersFile)) {
  const raw = JSON.parse(readFileSync(peersFile, "utf8"));
  const list: unknown[] = Array.isArray(raw) ? raw : raw.data ?? raw.peersList ?? [];
  ctx.peers = list.map((p) => (typeof p === "string" ? p : (p as { symbol: string }).symbol)).filter(Boolean);
}
if (existsSync(entityFile)) {
  const raw = JSON.parse(readFileSync(entityFile, "utf8"));
  const first = (Array.isArray(raw) ? raw : raw.results ?? raw.data ?? [])[0] as { id?: string; listing_type?: string } | undefined;
  if (first?.id) { ctx.rpEntityId = first.id; ctx.companyType = first.listing_type === "PRIVATE" ? "Private" : "Public"; }
}

if (flag === "--check") {
  const missing = requiredRawFiles(ctx).filter((f) => !existsSync(join(dir, f)));
  if (missing.length) { console.error("Missing raw files:\n  " + missing.join("\n  ")); process.exit(1); }
  console.log(`All ${requiredRawFiles(ctx).length} raw files present in ${dir}`);
} else {
  console.log(JSON.stringify({ dir, phase2Ready: Boolean(ctx.peers && ctx.rpEntityId), calls: renderManifest(ctx) }, null, 2));
}
```

Add `"facts:manifest": "node --env-file-if-exists=.env.local --import tsx scripts/facts-manifest.ts"` to `package.json`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/facts/manifest.test.ts` → 5 passing; `npm test` green; `tsc` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: add the capture manifest and the FactSource seam"`

---

## Task 6: Revised manifest, Yahoo fetcher, prepare CLI, the skill, and the AVGO capture

> **Revision 2026-09-12.** The first capture proved the FMP connector's plan gates `quote`/`statements`/`analyst`/`chart`. Numbers now come from Bigdata's tearsheet (which proxies FMP), daily closes from Yahoo's keyless v8 chart endpoint, and profile/peers from FMP `company`. Spec: "Revision 2026-09-12 — data sourcing after the first capture".

**Files:**
- Modify: `lib/facts/manifest.ts`, `lib/facts/manifest.test.ts`, `scripts/facts-manifest.ts`, `lib/facts/schema.ts` (one enum value), `.claude/skills/fetch-facts/SKILL.md`
- Create: `lib/prices/yahoo.ts`, `scripts/facts-prepare.ts`
- Delete: `scripts/facts-edgar.ts` (superseded by `facts-prepare.ts`); the `.error.txt` files and stale FMP-named files in the raw dir
- Modify: `package.json` (`facts:prepare` replaces `facts:edgar`)
- Test: `lib/facts/manifest.test.ts`, `lib/prices/yahoo.test.ts`
- Create (by executing the skill): the eight vendor files plus `capture.json`, `edgar-filing.json`, `yahoo-history.json` in `data/raw/AVGO/0001730168-26-000080/`

**Interfaces:**
- Consumes: `fetchSubmissions`, `fetchPrimaryDocument`, `FetchLike`, `Filing`; `renderManifest`, `requiredRawFiles`.
- Produces: the revised `MANIFEST` (8 entries), `CODE_FETCHED_FILES = ["edgar-filing.json", "edgar-primary.html", "yahoo-history.json"]`, `requiredRawFiles(ctx)` including them; `fetchDailyCloses(ticker, from, to, fetchImpl?) → string` (raw JSON text); `yahooChartUrl(ticker, from, to)`; `npm run facts:prepare <TICKER> <ACCESSION>`; `provenance.source` accepts `"yahoo"`; the committed AVGO raw capture.

**This task requires an agent with the FMP and Bigdata.com MCP tools** (they are available to subagents — Task 6's first run proved it).

- [ ] **Step 1: Rewrite the manifest**

Replace the `MANIFEST` array and the two helpers in `lib/facts/manifest.ts` with:

```ts
export const CODE_FETCHED_FILES = ["edgar-filing.json", "edgar-primary.html", "yahoo-history.json"] as const;

const TEARSHEET_SECTIONS_ANNUAL = [
  "company_overview", "analyst_ratings", "analyst_estimates", "key_metrics", "financial_ratios", "revenue_segmentation",
];

const tearsheet = (name: string, file: string, interval: "annual" | "quarter", sections: string[]): ManifestEntry => ({
  name, file, server: "bigdata", tool: "bigdata_company_tearsheet", phase: 2,
  params: (c) => ({ rp_entity_id: c.rpEntityId, company_type: c.companyType, interval, sections }),
});

export const MANIFEST: ManifestEntry[] = [
  fmp("profile", "fmp-profile.json", "company", (c) => ({ endpoint: "profile-symbol", symbol: c.ticker })),
  fmp("peers", "fmp-peers.json", "company", (c) => ({ endpoint: "peers", symbol: c.ticker })),
  { name: "entity", file: "bigdata-entity.json", server: "bigdata", tool: "find_securities", phase: 1,
    params: (c) => ({ query: c.ticker, security_types: ["COMPANY"] }) },
  tearsheet("tearsheet-annual", "bigdata-tearsheet-annual.json", "annual", TEARSHEET_SECTIONS_ANNUAL),
  tearsheet("statements-annual", "bigdata-statements-annual.json", "annual", ["financial_statements"]),
  tearsheet("statements-quarter", "bigdata-statements-quarter.json", "quarter", ["financial_statements"]),
  { name: "transcript", file: "bigdata-transcript.md", server: "bigdata", tool: "bigdata_search", phase: 1,
    params: (c) => ({ request: { search_mode: "smart", query: {
      text: `${c.company} latest earnings call key points and management commentary`, max_chunks: 20 } } }) },
  { name: "headlines", file: "bigdata-headlines.md", server: "bigdata", tool: "bigdata_search", phase: 1,
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
```

Remove the `perPeer` field from `ManifestEntry` and the `peers` field from `CaptureContext`; drop the `peer` parameter from `params`; the `fmp` helper becomes `const fmp = (name: string, file: string, tool: string, params: ManifestEntry["params"]): ManifestEntry => ({ name, file, server: "fmp", tool, phase: 1, params })`. Keep `PEER_LIMIT` exported (Task 8 still caps the peer *ticker* list with it). **Export `isoMinusDays`** (it is module-private today) — the prepare CLI uses it for the Yahoo window.

Replace the tests in `lib/facts/manifest.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { MANIFEST, renderManifest, requiredRawFiles, CODE_FETCHED_FILES, isoMinusDays } from "@/lib/facts/manifest";

const ctx = { ticker: "AVGO", company: "Broadcom Inc.", periodEnd: "2026-08-02", today: "2026-09-12" };

describe("MANIFEST", () => {
  it("has unique names and files", () => {
    const names = MANIFEST.map((m) => m.name), files = MANIFEST.map((m) => m.file);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(files).size).toBe(files.length);
  });
  it("lists exactly the eight vendor captures of the revised design", () => {
    expect(MANIFEST.map((m) => m.file).sort()).toEqual([
      "bigdata-entity.json", "bigdata-headlines.md", "bigdata-statements-annual.json", "bigdata-statements-quarter.json",
      "bigdata-tearsheet-annual.json", "bigdata-transcript.md", "fmp-peers.json", "fmp-profile.json",
    ]);
  });
  it("uses only FMP endpoints the connector plan allows", () => {
    const fmpEndpoints = MANIFEST.filter((m) => m.server === "fmp").map((m) => (m.params(ctx) as { endpoint: string }).endpoint);
    expect(fmpEndpoints.sort()).toEqual(["peers", "profile-symbol"]);
    expect(MANIFEST.filter((m) => m.server === "fmp").every((m) => m.tool === "company")).toBe(true);
  });
});

describe("renderManifest", () => {
  it("renders only phase 1 until the Bigdata entity is known", () => {
    const calls = renderManifest(ctx);
    expect(calls.map((c) => c.name).sort()).toEqual(["entity", "headlines", "peers", "profile", "transcript"]);
  });
  it("renders the three tearsheets once the entity is known", () => {
    const calls = renderManifest({ ...ctx, rpEntityId: "09DE1F", companyType: "Public" });
    const sheets = calls.filter((c) => c.tool === "bigdata_company_tearsheet");
    expect(sheets).toHaveLength(3);
    expect(sheets.find((c) => c.file === "bigdata-statements-quarter.json")!.params)
      .toMatchObject({ rp_entity_id: "09DE1F", company_type: "Public", interval: "quarter", sections: ["financial_statements"] });
    expect(sheets.find((c) => c.file === "bigdata-tearsheet-annual.json")!.params)
      .toMatchObject({ interval: "annual", sections: expect.arrayContaining(["company_overview", "analyst_ratings", "analyst_estimates", "key_metrics", "financial_ratios", "revenue_segmentation"]) });
  });
  it("renders bigdata_search calls in the tool's request envelope", () => {
    for (const name of ["transcript", "headlines"]) {
      const c = renderManifest(ctx).find((x) => x.name === name)!;
      expect(c.params).toMatchObject({ request: { search_mode: "smart", query: { text: expect.stringContaining("Broadcom Inc."), max_chunks: 20 } } });
    }
  });
});

describe("requiredRawFiles", () => {
  it("includes capture.json and every code-fetched file", () => {
    const files = requiredRawFiles({ ...ctx, rpEntityId: "X", companyType: "Public" });
    expect(files).toContain("capture.json");
    for (const f of CODE_FETCHED_FILES) expect(files).toContain(f);
    expect(files).toHaveLength(1 + CODE_FETCHED_FILES.length + 8);
  });
});

describe("isoMinusDays", () => {
  it("subtracts calendar days in UTC", () => {
    expect(isoMinusDays("2026-08-02", 45)).toBe("2026-06-18");
  });
});
```

- [ ] **Step 2: Fix the phase-2 extraction in `scripts/facts-manifest.ts`**

The captured `bigdata-entity.json` is `[{ "results": [ { "id": "09DE1F", "name": "Broadcom Inc.", "security_type": "COMPANY", "listing_type": "PUBLIC", … } ], "metadata": … }]`. Replace the entity block with:

```ts
if (existsSync(entityFile)) {
  const raw = JSON.parse(readFileSync(entityFile, "utf8")) as unknown;
  const top = Array.isArray(raw) ? raw[0] : raw;
  const list = ((top as { results?: unknown[]; data?: unknown[] })?.results
    ?? (top as { data?: unknown[] })?.data
    ?? (Array.isArray(raw) ? raw : [])) as { id?: string; listing_type?: string }[];
  const first = list[0];
  if (first?.id) { ctx.rpEntityId = first.id; ctx.companyType = first.listing_type === "PRIVATE" ? "Private" : "Public"; }
}
```

Delete the `peersFile` block (peers are no longer a phase-2 input).

- [ ] **Step 3: The Yahoo fetcher**

`lib/prices/yahoo.ts`:
```ts
/**
 * yahoo.ts — daily closes for the chart's history line.
 * -----------------------------------------------------------------------------
 * Keyless, unofficial. The raw response is saved verbatim as yahoo-history.json;
 * map/history.ts parses it. If this endpoint ever breaks, the chart falls back
 * to its labelled placeholder — nothing else in the pipeline depends on it.
 */
export type FetchLike = typeof fetch;

const toUnix = (ymd: string) => Math.floor(new Date(ymd + "T00:00:00Z").getTime() / 1000);

export function yahooChartUrl(ticker: string, from: string, to: string): string {
  const p1 = toUnix(from), p2 = toUnix(to) + 86400; // period2 is exclusive
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d`;
}

export async function fetchDailyCloses(ticker: string, from: string, to: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const url = yahooChartUrl(ticker, from, to);
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status} for ${url}`);
  return res.text();
}
```

`lib/prices/yahoo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { yahooChartUrl, fetchDailyCloses } from "@/lib/prices/yahoo";

describe("yahooChartUrl", () => {
  it("builds a daily chart URL with an exclusive end", () => {
    const u = new URL(yahooChartUrl("AVGO", "2026-06-18", "2026-09-12"));
    expect(u.pathname).toBe("/v8/finance/chart/AVGO");
    expect(u.searchParams.get("interval")).toBe("1d");
    expect(Number(u.searchParams.get("period2")) - Number(u.searchParams.get("period1"))).toBe((86 + 1) * 86400);
  });
});

describe("fetchDailyCloses", () => {
  it("returns the body verbatim and sends a browser-like User-Agent", async () => {
    let ua = "";
    const fake = (async (_u: string, init: RequestInit) => { ua = (init.headers as Record<string, string>)["User-Agent"];
      return { ok: true, status: 200, text: async () => '{"chart":{"result":[]}}' }; }) as unknown as typeof fetch;
    expect(await fetchDailyCloses("AVGO", "2026-06-18", "2026-09-12", fake)).toBe('{"chart":{"result":[]}}');
    expect(ua).toMatch(/Mozilla/);
  });
  it("throws naming the URL on a non-200", async () => {
    const fake = (async () => ({ ok: false, status: 429, text: async () => "" })) as unknown as typeof fetch;
    await expect(fetchDailyCloses("AVGO", "2026-06-18", "2026-09-12", fake)).rejects.toThrow(/429.*chart\/AVGO/);
  });
});
```

(June 18 → September 12 is 86 days; the URL adds one exclusive day.)

Add `"yahoo"` to the `provenance.source` enum in `lib/facts/schema.ts`: `z.enum(["fmp", "bigdata", "edgar", "yahoo"])`. No other schema change.

- [ ] **Step 4: The prepare CLI**

`scripts/facts-prepare.ts` (replaces `facts-edgar.ts`; `git rm scripts/facts-edgar.ts`):
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSubmissions } from "../lib/edgar/submissions";
import { fetchPrimaryDocument } from "../lib/edgar/filing-text";
import type { WatchEntry } from "../lib/edgar/detect";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { isoMinusDays } from "../lib/facts/manifest";
import { requireContact } from "./_env";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:prepare -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();
const watch = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as WatchEntry[]).find((w) => w.ticker === ticker);
if (!watch) { console.error(`${ticker} is not in data/edgar/watchlist.json — run npm run watchlist:add -- ${ticker}`); process.exit(2); }

const filing = (await fetchSubmissions(watch.cik, contact)).find((f) => f.accession === accession);
if (!filing) { console.error(`Accession ${accession} not found among ${ticker}'s 10-Q/10-K filings`); process.exit(1); }

const dir = join("data", "raw", ticker, accession);
mkdirSync(dir, { recursive: true });
const slice = JSON.parse(readFileSync("lib/edgar/__fixtures__/company-tickers-slice.json", "utf8")) as Record<string, { ticker: string; title: string }>;
const company = Object.values(slice).find((c) => c.ticker === ticker)?.title ?? ticker;

writeFileSync(join(dir, "edgar-filing.json"), JSON.stringify({ ...filing, ticker, cik: watch.cik, company }, null, 2) + "\n");
if (!existsSync(join(dir, "edgar-primary.html"))) writeFileSync(join(dir, "edgar-primary.html"), await fetchPrimaryDocument(filing.url, contact));
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dir, "yahoo-history.json"), await fetchDailyCloses(ticker, isoMinusDays(filing.periodEnd, 45), today));
console.log(`Prepared ${dir}: edgar-filing.json, edgar-primary.html, yahoo-history.json (${isoMinusDays(filing.periodEnd, 45)} → ${today})`);
```

`package.json`: remove `facts:edgar`; add `"facts:prepare": "node --env-file-if-exists=.env.local --import tsx scripts/facts-prepare.ts"`.

- [ ] **Step 5: Revise the skill**

In `.claude/skills/fetch-facts/SKILL.md`, replace step 1 with `npm run facts:prepare -- <TICKER> <ACCESSION>` ("creates the raw directory with `edgar-filing.json`, the primary document, and `yahoo-history.json`"), and in step 5 replace "the per-peer and tearsheet entries" with "the three tearsheet entries". Add one line under Rules: "Tearsheet responses are JSON objects; save the JSON text exactly as returned."

- [ ] **Step 6: Clean the raw directory and capture**

```bash
cd data/raw/AVGO/0001730168-26-000080 && rm -f *.error.txt fmp-peer-*.json && cd -
```
Keep `edgar-primary.html`, `fmp-profile.json`, `fmp-peers.json`, `bigdata-entity.json`, `bigdata-transcript.md`, `bigdata-headlines.md` from the first run — they are valid captures. Then execute the skill steps 1–6: `facts:prepare` (rewrites `edgar-filing.json`, adds `yahoo-history.json`), write a fresh `capture.json`, run `facts:manifest`, execute the printed calls (phase 1 files that already exist may be re-captured or kept — keep them), run `facts:manifest` again (now `phase2Ready: true`), execute the three tearsheet calls, save each response's JSON text verbatim, then `--check` → "All 12 raw files present".

- [ ] **Step 7: Verify and commit**

`npm test` (expect 132 − 6 old manifest tests + 7 new manifest + 3 yahoo = 136), `npx tsc --noEmit -p .`, `npx eslint lib scripts`. In the report paste the `--check` output, `ls -la` of the raw dir, and the first 30 lines of `bigdata-statements-annual.json` (the one shape not yet seen). Commit: `git add -A && git commit -m "feat: re-source the capture via Bigdata tearsheets and Yahoo; capture Broadcom's raw data"`.

---

## Task 7: Mapping — quote, profile, statements, TTM (from the tearsheets)

**Files:**
- Create: `lib/facts/raw.ts`, `lib/facts/map/quote.ts`, `lib/facts/map/statements.ts`, `lib/facts/map/__fixtures__/empty/` (two files)
- Test: `lib/facts/map/quote.test.ts`, `lib/facts/map/statements.test.ts`

**Interfaces:**
- Consumes: the committed raw files; `FactPack` section types.
- Produces: `readRawJson`, `readRawText`, `num(obj, key, file, opts?)`, `str(obj, key, file)`; `mapQuote(dir) → { quote, company, exchange, cik, description }`; `mapStatements(dir) → { statements, latestQuarter, ttm }`; each mapper's `PROVENANCE`.

**Captured shapes (verbatim from the AVGO capture):**

`bigdata-tearsheet-annual.json` is one JSON object:
```jsonc
{
  "company_overview": { "company_name": "Broadcom Inc.", "exchange": "NASDAQ", "cik": "0001730168", "market_cap": 1722196384200,
                        "price": 361.99, "timestamp": "2026-09-11T20:00:01Z", "description": "…", "full_time_employees": 33000, … },
  "analyst_data": { "as_of_utc_timestamp": "2026-09-12T23:45:33Z",
                    "price_targets": { "target_consensus": 509.61, "target_median": 517.5, "target_high": 600, "target_low": 350 },
                    "ratings": { "strong_buy": 0, "buy": 54, "hold": 6, "sell": 0, "strong_sell": 0, "consensus": "Buy" } },
  "price_performance": { "current_market": { "current_price": 361.99, "year_high": 495, "year_low": 289.96, "market_cap": 1722196384200, … } },
  "revenue_segmentation": {
    "geographic": { "2025-11-02": { "fiscal_year": 2025, "period": "FY", "region_segments": { "Americas": 18939000000, "Asia Pacific": 35896000000, "EMEA": 9052000000 } }, "2024-11-03": {…}, … },
    "product":    { "2025-11-02": { "fiscal_year": 2025, "period": "FY", "product_segments": { "Infrastructure Software": 27029000000, "Semiconductor Solutions": 36858000000 } }, … } },
  "fundamentals": {
    "ratios":      [ { "fiscal_period": "TTM", "gross_margin": 0.6766, "operating_margin": 0.4827, "net_margin": 0.4294, "current_ratio": 2.50, "dividend_yield": 0.00701677, … },
                     { "fiscal_year": 2025, "fiscal_period": "FY", "report_date": "2025-11-02", "gross_margin": 0.6777, … }, … ],
    "key_metrics": [ { "fiscal_period": "TTM", "pe_ratio": 44.91, "price_to_sales": 19.33, "ev_to_ebitda": 33.63, … }, { "fiscal_year": 2025, "fiscal_period": "FY", … }, … ] },
  "estimates": { "periodicity": "ANN", "records": [ { "metric": "SALES", "fiscal_year": 2026, "fiscal_period": "FY", "estimate_mean": 105864823726, "num_analysts": 29 },
                                                     { "metric": "EPS",   "fiscal_year": 2026, "fiscal_period": "FY", "estimate_mean": 11.62904 }, … ] }
}
```

`bigdata-statements-quarter.json` (and, by the same shape with `"fiscal_period": "FY"`, `bigdata-statements-annual.json` — **confirm from the captured file**):
```jsonc
{ "fundamentals": {
    "income_statement": [ { "fiscal_year": 2026, "fiscal_period": "Q3", "report_date": "2026-08-02", "filing_date": "2026-09-10",
                            "revenue": 29591000000, "gross_profit": 20456000000, "operating_income": 15955000000, "ebitda": 18266000000,
                            "net_income": 13088000000, "eps_diluted": 2.68, "weighted_average_shares_diluted": 4887000000, … }, … ],
    "balance_sheet":    [ { "fiscal_year": 2026, "fiscal_period": "Q3", "report_date": "2026-08-02", "cash_and_short_term_investments": 23975000000,
                            "total_debt": 59419000000, "net_debt": 35444000000, "total_equity": 99690000000,
                            "total_current_assets": 52173000000, "total_current_liabilities": 20838000000, … }, … ],
    "cash_flow":        [ { "fiscal_year": 2026, "fiscal_period": "Q3", "report_date": "2026-08-02", "operating_cash_flow": 14197000000,
                            "capex": -532000000, "free_cash_flow": 13665000000, … }, … ] } }
```
Entries are newest-first.

- [ ] **Step 1: Write the failing tests** (assertions grounded in `data/avgo.json`)

`lib/facts/map/quote.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapQuote } from "@/lib/facts/map/quote";
const DIR = "data/raw/AVGO/0001730168-26-000080";

describe("mapQuote on the AVGO capture", () => {
  const q = mapQuote(DIR);
  it("identifies the company from the tearsheet overview", () => {
    expect(q.company).toBe("Broadcom Inc.");
    expect(q.exchange).toBe("NASDAQ");
    expect(q.cik).toBe(1730168);
    expect(q.description.text.length).toBeGreaterThan(100);
    expect(q.description.source).toBe("bigdata:company_tearsheet");
  });
  it("carries the quote as raw numbers with the tearsheet's as-of date", () => {
    expect(q.quote.price).toBe(361.99);
    expect(q.quote.marketCap).toBeGreaterThan(1.7e12);
    expect(q.quote.week52High).toBe(495);
    expect(q.quote.week52Low).toBe(289.96);
    expect(q.quote.asOf).toBe("2026-09-11");
  });
  it("derives shares outstanding from market cap and price, within 5% of the fixture", () => {
    expect(Math.abs(q.quote.sharesOutstanding / 4.76e9 - 1)).toBeLessThan(0.05);
  });
  it("reads dividend yield as a ratio", () => {
    expect(q.quote.dividendYield).toBeGreaterThan(0.005);
    expect(q.quote.dividendYield).toBeLessThan(0.01);
  });
  it("throws naming the file when the tearsheet is empty", () => {
    expect(() => mapQuote("lib/facts/map/__fixtures__/empty")).toThrow(/bigdata-tearsheet-annual\.json/);
  });
});
```
Create `lib/facts/map/__fixtures__/empty/bigdata-tearsheet-annual.json` containing `{}` and `capture.json` containing `{"capturedAt":"2026-09-12T00:00:00Z"}`.

`lib/facts/map/statements.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapStatements } from "@/lib/facts/map/statements";
const DIR = "data/raw/AVGO/0001730168-26-000080";
const near = (a: number | null, b: number, tol = 0.005) => a != null && Math.abs(a - b) / Math.abs(b) <= tol;

describe("mapStatements on the AVGO capture", () => {
  const s = mapStatements(DIR);
  const row = (t: "income" | "balance" | "cashflow", key: string) => s.statements[t].find((r) => r.key === key)!;

  it("labels five consecutive fiscal years oldest first", () => {
    expect(s.statements.fiscalYears).toEqual(["FY21", "FY22", "FY23", "FY24", "FY25"]);
  });
  it("reads FY25 income rows matching the fixture", () => {
    expect(near(row("income", "revenue").values[4], 63.9e9)).toBe(true);
    expect(near(row("income", "operatingIncome").values[4], 25.5e9)).toBe(true);
    expect(near(row("income", "ebitda").values[4], 34.7e9)).toBe(true);
    expect(near(row("income", "netIncome").values[4], 23.1e9)).toBe(true);
    expect(near(row("income", "epsDiluted").values[4], 4.77, 0.003)).toBe(true);
  });
  it("reads FY25 balance rows matching the fixture", () => {
    expect(near(row("balance", "cashAndInvestments").values[4], 16.2e9)).toBe(true);
    expect(near(row("balance", "totalDebt").values[4], 65.1e9)).toBe(true);
    expect(near(row("balance", "netDebt").values[4], 49.0e9)).toBe(true);
    expect(near(row("balance", "totalEquity").values[4], 81.3e9)).toBe(true);
    expect(near(row("balance", "currentRatio").values[4], 1.71, 0.005)).toBe(true);
  });
  it("reads FY25 cash-flow rows matching the fixture", () => {
    expect(near(row("cashflow", "operatingCashFlow").values[4], 27.5e9)).toBe(true);
    expect(near(row("cashflow", "freeCashFlow").values[4], 26.9e9)).toBe(true);
  });
  it("derives the latest quarter with YoY growth from the quarterly statements", () => {
    expect(s.latestQuarter.label).toBe("Q3'26");
    expect(s.latestQuarter.periodEnd).toBe("2026-08-02");
    expect(near(s.latestQuarter.revenue, 29.591e9, 0.001)).toBe(true);
    expect(near(s.latestQuarter.revenueYoY, 29.591 / 15.952 - 1, 0.01)).toBe(true);
    expect(near(s.latestQuarter.operatingMargin, 15.955 / 29.591, 0.01)).toBe(true);
  });
  it("reads TTM multiples and margins", () => {
    expect(near(s.ttm.pe, 44.9, 0.01)).toBe(true);
    expect(near(s.ttm.ps, 19.3, 0.01)).toBe(true);
    expect(near(s.ttm.evToEbitda, 33.6, 0.01)).toBe(true);
    expect(s.ttm.grossMargin).toBeGreaterThan(0.6);
    expect(s.ttm.grossMargin).toBeLessThan(0.7);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module resolution.

- [ ] **Step 3: Implement**

`lib/facts/raw.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Rec = Record<string, unknown>;

export function readRawText(dir: string, file: string): string {
  try { return readFileSync(join(dir, file), "utf8"); }
  catch { throw new Error(`Missing raw file ${file} in ${dir}`); }
}

export function readRawJson(dir: string, file: string): unknown {
  const text = readRawText(dir, file);
  try { return JSON.parse(text); } catch { throw new Error(`Raw file ${file} in ${dir} is not JSON`); }
}

/** A numeric field, tolerating numeric strings; throws naming file and key unless optional. */
export function num(obj: Rec | undefined, key: string, file: string, opts: { optional?: boolean } = {}): number | null {
  const v = obj?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (opts.optional) return null;
  throw new Error(`Missing numeric "${key}" in ${file}`);
}

export function str(obj: Rec | undefined, key: string, file: string): string {
  const v = obj?.[key];
  if (typeof v === "string" && v.trim()) return v;
  throw new Error(`Missing string "${key}" in ${file}`);
}

export function section<T = Rec>(obj: unknown, path: string[], file: string): T {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object" || !(p in (cur as Rec))) throw new Error(`Missing "${path.join(".")}" in ${file}`);
    cur = (cur as Rec)[p];
  }
  return cur as T;
}
```

`lib/facts/map/quote.ts`:
```ts
import { readRawJson, num, str, section, type Rec } from "../raw";
import type { FactPack, Excerpt } from "../schema";

const FILE = "bigdata-tearsheet-annual.json";
export const PROVENANCE = [
  { field: "quote", endpoint: "bigdata_company_tearsheet.company_overview + price_performance" },
  { field: "quote.sharesOutstanding", endpoint: "derived: market_cap / price" },
  { field: "quote.dividendYield", endpoint: "bigdata_company_tearsheet.fundamentals.ratios[TTM]" },
  { field: "company", endpoint: "bigdata_company_tearsheet.company_overview" },
  { field: "context.description", endpoint: "bigdata_company_tearsheet.company_overview" },
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
      dividendYield: num(ttm, "dividend_yield", FILE, { optional: true }) ?? 0,
      asOf,
    },
  };
}
```

`lib/facts/map/statements.ts`:
```ts
import { readRawJson, num, str, section, type Rec } from "../raw";
import type { FactPack, StatementRow } from "../schema";

const ANNUAL = "bigdata-statements-annual.json", QUARTER = "bigdata-statements-quarter.json", SHEET = "bigdata-tearsheet-annual.json";
export const PROVENANCE = [
  { field: "statements", endpoint: "bigdata_company_tearsheet.financial_statements (annual)" },
  { field: "latestQuarter", endpoint: "bigdata_company_tearsheet.financial_statements (quarter)" },
  { field: "ttm", endpoint: "bigdata_company_tearsheet.fundamentals.key_metrics[TTM] + ratios[TTM]" },
];

const fyLabel = (fy: number) => `FY${String(fy).slice(2)}`;
const row = (key: string, label: string, values: (number | null)[]): StatementRow => ({ key, label, values });
const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);

function fyRows(all: Rec[], file: string): Map<number, Rec> {
  const m = new Map<number, Rec>();
  for (const r of all) if (r.fiscal_period === "FY") m.set(num(r, "fiscal_year", file)!, r);
  return m;
}

export function mapStatements(dir: string): { statements: FactPack["statements"]; latestQuarter: FactPack["latestQuarter"]; ttm: FactPack["ttm"] } {
  const a = readRawJson(dir, ANNUAL);
  const inc = fyRows(section<Rec[]>(a, ["fundamentals", "income_statement"], ANNUAL), ANNUAL);
  const bal = fyRows(section<Rec[]>(a, ["fundamentals", "balance_sheet"], ANNUAL), ANNUAL);
  const cf = fyRows(section<Rec[]>(a, ["fundamentals", "cash_flow"], ANNUAL), ANNUAL);
  const years = [...inc.keys()].filter((y) => bal.has(y) && cf.has(y)).sort((x, y) => x - y).slice(-5);
  if (years.length !== 5) throw new Error(`Expected 5 aligned fiscal years in ${ANNUAL}, found ${years.length}: ${years.join(",")}`);
  const col = (m: Map<number, Rec>, key: string, optional = false) => years.map((y) => num(m.get(y), key, ANNUAL, { optional }));

  const revenue = col(inc, "revenue");
  const curA = col(bal, "total_current_assets"), curL = col(bal, "total_current_liabilities");
  const statements: FactPack["statements"] = {
    fiscalYears: years.map(fyLabel),
    income: [
      row("revenue", "Revenue", revenue),
      row("grossProfit", "Gross Profit", col(inc, "gross_profit")),
      row("operatingIncome", "Operating Income", col(inc, "operating_income")),
      row("ebitda", "EBITDA", col(inc, "ebitda", true)),
      row("netIncome", "Net Income", col(inc, "net_income")),
      row("epsDiluted", "Diluted EPS", col(inc, "eps_diluted")),
    ],
    balance: [
      row("cashAndInvestments", "Cash & ST Investments", col(bal, "cash_and_short_term_investments")),
      row("totalDebt", "Total Debt", col(bal, "total_debt")),
      row("netDebt", "Net Debt", col(bal, "net_debt")),
      row("totalEquity", "Total Equity", col(bal, "total_equity")),
      row("currentRatio", "Current Ratio", curA.map((x, i) => div(x, curL[i]))),
    ],
    cashflow: [
      row("operatingCashFlow", "Operating Cash Flow", col(cf, "operating_cash_flow")),
      row("freeCashFlow", "Free Cash Flow", col(cf, "free_cash_flow")),
    ],
  };

  const q = readRawJson(dir, QUARTER);
  const quarters = section<Rec[]>(q, ["fundamentals", "income_statement"], QUARTER)
    .filter((r) => r.fiscal_period !== "FY")
    .sort((x, y) => (str(x, "report_date", QUARTER) < str(y, "report_date", QUARTER) ? 1 : -1));
  const latest = quarters[0];
  if (!latest) throw new Error(`No quarterly income rows in ${QUARTER}`);
  const fy = num(latest, "fiscal_year", QUARTER)!, period = str(latest, "fiscal_period", QUARTER);
  const prior = quarters.find((r) => r.fiscal_period === period && num(r, "fiscal_year", QUARTER) === fy - 1);
  const rev = num(latest, "revenue", QUARTER)!;
  const latestQuarter: FactPack["latestQuarter"] = {
    label: `${period}'${String(fy).slice(2)}`,
    periodEnd: str(latest, "report_date", QUARTER),
    revenue: rev,
    operatingMargin: num(latest, "operating_income", QUARTER)! / rev,
    revenueYoY: prior ? rev / num(prior, "revenue", QUARTER)! - 1 : null, // null, never a fabricated 0 (ruling, Task 7 review)
  };

  const sheet = readRawJson(dir, SHEET);
  const km = section<Rec[]>(sheet, ["fundamentals", "key_metrics"], SHEET).find((r) => r.fiscal_period === "TTM");
  const rt = section<Rec[]>(sheet, ["fundamentals", "ratios"], SHEET).find((r) => r.fiscal_period === "TTM");
  const opt = (o: Rec | undefined, k: string) => num(o, k, SHEET, { optional: true });
  const ttm: FactPack["ttm"] = {
    pe: opt(km, "pe_ratio"), ps: opt(km, "price_to_sales"), evToEbitda: opt(km, "ev_to_ebitda"),
    grossMargin: opt(rt, "gross_margin"), operatingMargin: opt(rt, "operating_margin"), netMargin: opt(rt, "net_margin"),
  };
  return { statements, latestQuarter, ttm };
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run lib/facts/map` → 11 passing. If the annual statements file's rows carry a different `fiscal_period` label than `"FY"`, print the distinct values and adapt `fyRows` — record it. If a numeric assertion misses, report both values; do not change tolerances or the fixture.

- [ ] **Step 5: Commit** — `git add lib/facts && git commit -m "feat: map quote, statements, and TTM metrics from the Bigdata tearsheets"`

---

## Task 8: Mapping — segments, analysts, estimates, peers, history

**Files:**
- Create: `lib/facts/map/segments.ts`, `lib/facts/map/analysts.ts`, `lib/facts/map/history.ts`
- Test: one test file per mapper

**Interfaces:**
- Consumes: `readRawJson`, `readRawText`, `num`, `str`, `section`; `PEER_LIMIT`.
- Produces: `mapSegments(dir) → { segments, geoMix }`; `mapAnalysts(dir, latestFY: number) → { analysts, estimates, peers }`; `mapHistory(dir, capturedAt) → HistoryPoint[]`; `PROVENANCE` on each.

- [ ] **Step 1: Write the failing tests**

`segments.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapSegments } from "@/lib/facts/map/segments";
const DIR = "data/raw/AVGO/0001730168-26-000080";
describe("mapSegments on the AVGO capture", () => {
  const s = mapSegments(DIR);
  it("takes the latest fiscal year's product mix, shares summing to one", () => {
    expect(s.segments.basis).toBe("FY25");
    expect(s.segments.items.map((i) => i.name).sort()).toEqual(["Infrastructure Software", "Semiconductor Solutions"]);
    const semis = s.segments.items.find((i) => i.name === "Semiconductor Solutions")!;
    expect(semis.revenue).toBe(36858000000);
    expect(semis.share).toBeCloseTo(0.58, 2);
    expect(s.segments.items.reduce((a, i) => a + i.share, 0)).toBeCloseTo(1, 6);
  });
  it("takes the latest fiscal year's geographic mix", () => {
    expect(s.geoMix.basis).toBe("FY25");
    const byRegion = Object.fromEntries(s.geoMix.items.map((g) => [g.region, g.share]));
    expect(byRegion["Asia Pacific"]).toBeCloseTo(0.56, 2);
    expect(byRegion["Americas"]).toBeCloseTo(0.30, 2);
    expect(byRegion["EMEA"]).toBeCloseTo(0.14, 2);
  });
});
```

`analysts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapAnalysts } from "@/lib/facts/map/analysts";
const DIR = "data/raw/AVGO/0001730168-26-000080";
describe("mapAnalysts on the AVGO capture", () => {
  const a = mapAnalysts(DIR, 2025);
  it("reads targets and the rating split exactly as the fixture", () => {
    expect(a.analysts).toMatchObject({ consensusTarget: 509.61, medianTarget: 517.5, highTarget: 600, lowTarget: 350,
      buy: 54, hold: 6, sell: 0, count: 60, consensusRating: "Buy" });
    expect(a.analysts.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("labels the next two fiscal years' SALES and EPS means as estimates", () => {
    expect(a.estimates.nextFY.label).toBe("FY26E");
    expect(a.estimates.nextFY.revenue).toBeCloseTo(105.86e9, -9);
    expect(a.estimates.nextFY.eps).toBeCloseTo(11.629, 2);
    expect(a.estimates.followingFY.label).toBe("FY27E");
    expect(a.estimates.followingFY.eps).toBeCloseTo(19.28, 1);
  });
  it("carries up to four peer tickers with null multiples until a peer source exists", () => {
    expect(a.peers.length).toBeGreaterThan(0);
    expect(a.peers.length).toBeLessThanOrEqual(4);
    for (const p of a.peers) { expect(p.ticker).toMatch(/^[A-Z.]+$/); expect(p.pe).toBeNull(); }
  });
});
```

`history.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapHistory } from "@/lib/facts/map/history";
const DIR = "data/raw/AVGO/0001730168-26-000080";
describe("mapHistory on the AVGO capture", () => {
  const h = mapHistory(DIR, "2026-09-12T00:00:00Z");
  it("returns thirty ascending trading days ending on or before capture", () => {
    expect(h).toHaveLength(30);
    for (let i = 1; i < h.length; i++) expect(h[i].date > h[i - 1].date).toBe(true);
    expect(h[h.length - 1].date <= "2026-09-12").toBe(true);
  });
  it("ends on the quote's as-of close", () => {
    expect(h[h.length - 1]).toMatchObject({ date: "2026-09-11" });
    expect(h[h.length - 1].close).toBeCloseTo(361.99, 1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module resolution.

- [ ] **Step 3: Implement**

`segments.ts`:
```ts
import { readRawJson, section, type Rec } from "../raw";
import type { FactPack } from "../schema";
const FILE = "bigdata-tearsheet-annual.json";
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
```

`analysts.ts`:
```ts
import { readRawJson, num, str, section, type Rec } from "../raw";
import { PEER_LIMIT } from "../manifest";
import type { FactPack } from "../schema";
const FILE = "bigdata-tearsheet-annual.json";
export const PROVENANCE = [
  { field: "analysts", endpoint: "bigdata_company_tearsheet.analyst_data" },
  { field: "estimates", endpoint: "bigdata_company_tearsheet.estimates" },
  { field: "peers", endpoint: "fmp company/peers (tickers only)" },
];

export function mapAnalysts(dir: string, latestFY: number): { analysts: FactPack["analysts"]; estimates: FactPack["estimates"]; peers: FactPack["peers"] } {
  const ts = readRawJson(dir, FILE);
  const ad = section<Rec>(ts, ["analyst_data"], FILE);
  const pt = section<Rec>(ad, ["price_targets"], FILE), rt = section<Rec>(ad, ["ratings"], FILE);
  const g = (k: string) => num(rt, k, FILE, { optional: true }) ?? 0;
  const buy = g("strong_buy") + g("buy"), hold = g("hold"), sell = g("sell") + g("strong_sell");
  const analysts: FactPack["analysts"] = {
    count: buy + hold + sell, buy, hold, sell,
    consensusRating: str(rt, "consensus", FILE),
    consensusTarget: num(pt, "target_consensus", FILE)!, medianTarget: num(pt, "target_median", FILE)!,
    highTarget: num(pt, "target_high", FILE)!, lowTarget: num(pt, "target_low", FILE)!,
    asOf: str(ad, "as_of_utc_timestamp", FILE).slice(0, 10),
  };

  const records = section<Rec[]>(ts, ["estimates", "records"], FILE);
  const mean = (metric: string, fy: number) => {
    const r = records.find((x) => x.metric === metric && x.fiscal_year === fy && x.fiscal_period === "FY");
    return r ? num(r, "estimate_mean", FILE, { optional: true }) : null;
  };
  const est = (fy: number) => ({ label: `FY${String(fy).slice(2)}E`, revenue: mean("SALES", fy), eps: mean("EPS", fy) });
  const estimates: FactPack["estimates"] = { nextFY: est(latestFY + 1), followingFY: est(latestFY + 2) };

  const peersRaw = readRawJson(dir, "fmp-peers.json") as Rec | Rec[];
  const list: unknown[] = Array.isArray(peersRaw) ? peersRaw : ((peersRaw.data ?? peersRaw.peersList ?? []) as unknown[]);
  const peers: FactPack["peers"] = list
    .map((p) => (typeof p === "string" ? p : (p as Rec).symbol as string))
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, PEER_LIMIT)
    .map((ticker) => ({ ticker, pe: null, ps: null, evToEbitda: null }));
  return { analysts, estimates, peers };
}
```

`history.ts`:
```ts
import { readRawJson, section } from "../raw";
import type { HistoryPoint } from "../schema";
export const PROVENANCE = [{ field: "history", endpoint: "yahoo v8 chart (daily close)" }];
export const HISTORY_DAYS = 30;

/** Yahoo's shape: chart.result[0].timestamp[] (unix seconds) aligned with indicators.quote[0].close[]. */
export function mapHistory(dir: string, capturedAt: string): HistoryPoint[] {
  const FILE = "yahoo-history.json";
  const raw = readRawJson(dir, FILE);
  const result = section<unknown[]>(raw, ["chart", "result"], FILE)[0];
  if (!result) throw new Error(`Empty chart.result in ${FILE}`);
  const ts = section<number[]>(result, ["timestamp"], FILE);
  const quote = section<{ close: (number | null)[] }[]>(result, ["indicators", "quote"], FILE)[0];
  const cutoff = capturedAt.slice(0, 10);
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: quote.close[i] }))
    .filter((p): p is HistoryPoint => typeof p.close === "number" && p.date <= cutoff)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-HISTORY_DAYS);
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run lib/facts/map` → 18 passing. The analyst and estimate literals in these tests were read from the tearsheet on 2026-09-12; the vendor refreshes them. If a test fails **and the captured raw file plainly carries a different value** (open `bigdata-tearsheet-annual.json` and quote the field), change the test literal to the captured value and record the change in your report — never change the mapper to force agreement. Peer-list shape: if `fmp-peers.json` is not an array of `{ symbol }` objects, print its first 200 characters and extend the unwrap — never invent tickers.

- [ ] **Step 5: Commit** — `git add lib/facts && git commit -m "feat: map segments, analysts, estimates, peers, and Yahoo price history"`

---

## Task 9: Mapping — context

> **Revision 2026-09-12 (second).** The captured `bigdata_search` responses are JSON, not Markdown: `{ "results": [ { "id", "headline", "timestamp", "source": { "name" }, "chunks": [ { "cnum", "text" } ], "url" } ], "metadata", "audit" }`. The two raw files are renamed to `.json` here and parsed as JSON; the manifest, its test, and the skill follow.

**Files:**
- Create: `lib/facts/map/context.ts`
- Modify: `lib/facts/manifest.ts` (two file names), `lib/facts/manifest.test.ts` (the expected file list), `.claude/skills/fetch-facts/SKILL.md` (if it names the two files)
- Rename (git mv, content untouched): `data/raw/AVGO/0001730168-26-000080/bigdata-transcript.md` → `bigdata-transcript.json`, `bigdata-headlines.md` → `bigdata-headlines.json`
- Test: `lib/facts/map/context.test.ts`

**Interfaces:**
- Consumes: `extractSections` (returns `{ mda: CappedSection | null; riskFactors: CappedSection | null }`), `htmlToText`, `capAtSentence` from `lib/edgar/filing-text`; `readRawText`, `readRawJson`, `section`, `str` from `lib/facts/raw`.
- Produces: `mapContext(dir, filing: { form; url; filedDate }, capturedAt, description: Excerpt) → FactPack["context"]`; `PROVENANCE`.

**Captured shape (verbatim from the AVGO capture, first result of each file):**
```jsonc
// bigdata-headlines.json — 14 results
{ "results": [ { "id": "B2A63DCA0F4374F148907C96C83CBB57", "headline": "What Is Going on With Broadcom Stock on Tuesday?",
                 "timestamp": "2026-08-04T17:39:17", "source": { "name": "Benzinga" },
                 "chunks": [ { "cnum": 1, "text": "Broadcom Inc. (NASDAQ:AVGO) stock gained by more than 4% on Tuesday …" }, … ],
                 "url": "https://app.bigdata.com/documents/B2A63DCA0F4374F148907C96C83CBB57?cnum=1&cnum=3" }, … ],
  "metadata": { … }, "audit": { … } }
// bigdata-transcript.json — 2 results, 8 chunks in the first
{ "results": [ { "headline": "Broadcom Inc: Q3 2026 Earnings Call on Sep 2, 2026 - Transcript", "timestamp": "2026-09-02T21:00:00",
                 "source": { "name": "Quartr Transcripts" }, "chunks": [ { "cnum": 11, "text": "In Q4, we forecast non-AI semiconductor revenue …" }, … ],
                 "url": "https://app.bigdata.com/documents/EA18C42CD71533FFBD9B9301B6401E92" }, … ] }
```

- [ ] **Step 1: Rename the two raw files and update the manifest**

```bash
git mv data/raw/AVGO/0001730168-26-000080/bigdata-transcript.md data/raw/AVGO/0001730168-26-000080/bigdata-transcript.json
git mv data/raw/AVGO/0001730168-26-000080/bigdata-headlines.md  data/raw/AVGO/0001730168-26-000080/bigdata-headlines.json
```
In `lib/facts/manifest.ts` change the two `file:` values to `"bigdata-transcript.json"` and `"bigdata-headlines.json"`. In `lib/facts/manifest.test.ts` change the expected list to match (`"bigdata-headlines.json"`, `"bigdata-transcript.json"` — keep it sorted). In `.claude/skills/fetch-facts/SKILL.md`, if either `.md` name appears, change it; add to Rules: "`bigdata_search` responses are JSON too; save the JSON text exactly as returned." Run `npx vitest run lib/facts/manifest.test.ts` and `npm run facts:manifest -- AVGO 0001730168-26-000080 --check` → all 12 present.

- [ ] **Step 2: Write the failing test**

`lib/facts/map/context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapContext } from "@/lib/facts/map/context";
const DIR = "data/raw/AVGO/0001730168-26-000080";
const filing = { form: "10-Q" as const, url: "https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm", filedDate: "2026-09-10" };
const desc = { text: "Broadcom designs chips.", source: "bigdata:company_tearsheet", asOf: "2026-09-11" };

describe("mapContext on the AVGO capture", () => {
  const c = mapContext(DIR, filing, "2026-09-13T03:18:05Z", desc);
  it("carries capped, sourced filing excerpts with their real truncation flags", () => {
    expect(c.mdaExcerpt).toMatchObject({ source: "edgar:10-Q", url: filing.url, asOf: "2026-09-10", truncated: true });
    expect(c.mdaExcerpt!.text.length).toBeLessThanOrEqual(16000);
    expect(c.mdaExcerpt!.text.toLowerCase()).toContain("revenue");
    expect(c.riskFactorsExcerpt).toMatchObject({ source: "edgar:10-Q", truncated: true });
    expect(c.riskFactorsExcerpt!.text.length).toBeLessThanOrEqual(8000);
  });
  it("joins the transcript chunks into one capped, sourced excerpt", () => {
    const t = c.transcriptHighlights!;
    expect(t.source).toBe("bigdata:Quartr Transcripts");
    expect(t.url).toMatch(/^https:\/\/app\.bigdata\.com\/documents\//);
    expect(t.asOf).toBe("2026-09-02");
    expect(t.text.length).toBeGreaterThan(1000);
    expect(t.text.length).toBeLessThanOrEqual(8000);
    expect(t.text).toContain("infrastructure software");
  });
  it("carries the ten newest-ranked headlines with publisher, date, and link", () => {
    expect(c.headlines).toHaveLength(10);
    expect(c.headlines[0]).toEqual({
      text: "What Is Going on With Broadcom Stock on Tuesday?", source: "bigdata:Benzinga", asOf: "2026-08-04",
      url: "https://app.bigdata.com/documents/B2A63DCA0F4374F148907C96C83CBB57?cnum=1&cnum=3",
    });
    for (const h of c.headlines) { expect(h.text.length).toBeGreaterThan(10); expect(h.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
  });
  it("passes the description through and tolerates a missing search capture", () => {
    expect(c.description).toEqual(desc);
    const bare = mapContext("lib/facts/map/__fixtures__/context-bare", filing, "2026-09-13T03:18:05Z", desc);
    expect(bare.headlines).toEqual([]);
    expect(bare.transcriptHighlights).toBeNull();
  });
});
```
Create `lib/facts/map/__fixtures__/context-bare/edgar-primary.html` containing exactly:
```html
<html><body><p>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</p><p>Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat. Revenue was flat.</p><p>Item 3. Quantitative and Qualitative Disclosures About Market Risk</p></body></html>
```
(The "bare" directory has no search captures, so both Bigdata fields must degrade, not throw. If `extractSections` returns `null` for this stub's MD&A that is fine — the test does not assert on it.)

- [ ] **Step 3: Run to verify it fails** — module resolution.

- [ ] **Step 4: Implement**

`lib/facts/map/context.ts`:
```ts
/**
 * context.ts — the prose half of the FactPack: filing excerpts and Bigdata context.
 * -----------------------------------------------------------------------------
 * Excerpts are bounded and sourced; nothing here is a number. The two Bigdata
 * search captures are optional — a pack without them is still valid.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readRawJson, readRawText, section, str, type Rec } from "../raw";
import { htmlToText, extractSections, capAtSentence, type CappedSection } from "../../edgar/filing-text";
import type { Excerpt, FactPack } from "../schema";

export const PROVENANCE = [
  { field: "context.mdaExcerpt", endpoint: "edgar primary document" },
  { field: "context.riskFactorsExcerpt", endpoint: "edgar primary document" },
  { field: "context.transcriptHighlights", endpoint: "bigdata_search" },
  { field: "context.headlines", endpoint: "bigdata_search" },
];

export const HEADLINE_LIMIT = 10;

interface SearchResult { headline?: string; timestamp?: string; source?: { name?: string }; chunks?: { cnum?: number; text?: string }[]; url?: string }

/** bigdata_search returns { results: [...] }; an absent file means the capture skipped it. */
function searchResults(dir: string, file: string): SearchResult[] {
  if (!existsSync(join(dir, file))) return [];
  return section<SearchResult[]>(readRawJson(dir, file), ["results"], file);
}

const sourceOf = (r: SearchResult) => `bigdata:${r.source?.name?.trim() || "search"}`;
const dayOf = (r: SearchResult, fallback: string) => (r.timestamp ?? fallback).slice(0, 10);

function headlinesFrom(results: SearchResult[], fallbackDay: string): Excerpt[] {
  return results
    .filter((r) => typeof r.headline === "string" && r.headline.trim().length > 10)
    .slice(0, HEADLINE_LIMIT)
    .map((r) => ({ text: r.headline!.trim(), source: sourceOf(r), asOf: dayOf(r, fallbackDay), ...(r.url ? { url: r.url } : {}) }));
}

/** Concatenate every chunk of every transcript result, in rank then chunk order, then cap at a sentence. */
function transcriptFrom(results: SearchResult[], fallbackDay: string): Excerpt | null {
  const first = results[0];
  if (!first) return null;
  const text = results
    .flatMap((r) => [...(r.chunks ?? [])].sort((a, b) => (a.cnum ?? 0) - (b.cnum ?? 0)).map((c) => c.text?.trim() ?? ""))
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  const capped = capAtSentence(text);
  return { text: capped.text, source: sourceOf(first), asOf: dayOf(first, fallbackDay), truncated: capped.truncated, ...(first.url ? { url: first.url } : {}) };
}

export function mapContext(
  dir: string,
  filing: { form: "10-Q" | "10-K"; url: string; filedDate: string },
  capturedAt: string,
  description: Excerpt,
): FactPack["context"] {
  const { mda, riskFactors } = extractSections(htmlToText(readRawText(dir, "edgar-primary.html")), filing.form);
  const edgar = (s: CappedSection | null): Excerpt | null =>
    s ? { text: s.text, source: `edgar:${filing.form}`, url: filing.url, asOf: filing.filedDate, truncated: s.truncated } : null;
  const day = capturedAt.slice(0, 10);
  return {
    description,
    mdaExcerpt: edgar(mda),
    riskFactorsExcerpt: edgar(riskFactors),
    transcriptHighlights: transcriptFrom(searchResults(dir, "bigdata-transcript.json"), day),
    headlines: headlinesFrom(searchResults(dir, "bigdata-headlines.json"), day),
  };
}
```
(`Rec` and `str` are imported only if you use them; drop unused imports so ESLint stays clean.)

- [ ] **Step 5: Run to verify it passes** — `npx vitest run lib/facts/map/context.test.ts` → 4 passing. If the transcript excerpt does not contain "infrastructure software", print the first 300 characters of the joined text and report — do not change the assertion to whatever is there.

- [ ] **Step 6: Commit** — `git add -A lib/facts .claude data/raw && git commit -m "feat: map filing excerpts and Bigdata search context into the FactPack"`

---

## Task 10: Validation, build, and the AVGO FactPack

**Files:**
- Create: `lib/facts/validate.ts`, `lib/facts/build.ts`, `scripts/facts-build.ts`
- Modify: `package.json` (`facts:build`)
- Create (by running the CLI): `data/facts/AVGO/0001730168-26-000080.json`
- Test: `lib/facts/validate.test.ts`, `lib/facts/build.test.ts`

**Interfaces:**
- Consumes: every mapper; `FactPack`; `RAW_CAPTURE_META`; `minimalPack` from `lib/facts/__fixtures__/minimal-pack`.
- Produces: `validateFactPack(pack) → ValidationIssue[]`, `assertValidFactPack(pack, label)`, `buildFactPack(dir) → FactPack`, `npm run facts:build <TICKER> <ACCESSION>`.

- [ ] **Step 1: Write the failing tests**

First, `lib/facts/__fixtures__/minimal-pack.ts`: the validation rule below requires ≥ 20 history points, and the fixture has two. Replace its `history` line with twenty-two generated trading days ending 2026-09-11 (Task 1's schema tests only parse the pack, so this is safe):
```ts
  history: Array.from({ length: 22 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 7, 21)); d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), close: 340 + i };
  }),
```


`validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateFactPack, assertValidFactPack } from "@/lib/facts/validate";
import { minimalPack } from "@/lib/facts/__fixtures__/minimal-pack";

describe("validateFactPack", () => {
  it("accepts the minimal pack", () => { expect(validateFactPack(minimalPack())).toEqual([]); });
  it("rejects non-consecutive fiscal years", () => {
    const p = minimalPack(); p.statements.fiscalYears = ["FY20", "FY22", "FY23", "FY24", "FY25"];
    expect(validateFactPack(p).map((i) => i.field)).toContain("statements.fiscalYears");
  });
  it("rejects segment shares that do not sum to one", () => {
    const p = minimalPack(); p.segments.items[0].share = 0.7;
    expect(validateFactPack(p).map((i) => i.field)).toContain("segments.items[].share");
  });
  it("rejects analyst counts that disagree", () => {
    const p = minimalPack(); p.analysts.count = 61;
    expect(validateFactPack(p).map((i) => i.field)).toContain("analysts.count");
  });
  it("rejects unsorted, short, or future history", () => {
    const p = minimalPack(); p.history = [{ date: "2026-09-13", close: 1 }, { date: "2026-09-12", close: 1 }];
    expect(validateFactPack(p).map((i) => i.field)).toContain("history");
  });
  it("rejects a quarter that does not end on the filing period", () => {
    const p = minimalPack(); p.latestQuarter.periodEnd = "2026-05-03";
    expect(validateFactPack(p).map((i) => i.field)).toContain("latestQuarter.periodEnd");
  });
  it("assert throws naming the label and every field", () => {
    const p = minimalPack(); p.analysts.count = 61; p.segments.items[0].share = 0.7;
    expect(() => assertValidFactPack(p, "AVGO/x")).toThrow(/AVGO\/x[\s\S]*analysts\.count[\s\S]*segments/);
  });
});
```

`build.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildFactPack } from "@/lib/facts/build";
import { FactPack } from "@/lib/facts/schema";
const DIR = "data/raw/AVGO/0001730168-26-000080";

describe("buildFactPack on the AVGO capture", () => {
  const pack = buildFactPack(DIR);
  it("produces a pack that parses and validates", () => { expect(() => FactPack.parse(pack)).not.toThrow(); });
  it("stamps the filing and capture identity", () => {
    expect(pack.ticker).toBe("AVGO");
    expect(pack.filing.accession).toBe("0001730168-26-000080");
    expect(pack.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("records provenance for every fact section, with yahoo for history", () => {
    const fields = new Set(pack.provenance.map((p) => p.field.split(".")[0]));
    for (const f of ["quote", "statements", "latestQuarter", "ttm", "analysts", "estimates", "segments", "geoMix", "peers", "history", "context"]) expect(fields).toContain(f);
    expect(pack.provenance.find((p) => p.field === "history")?.source).toBe("yahoo");
  });
  it("fails naming a missing raw file", () => {
    expect(() => buildFactPack("lib/facts/map/__fixtures__/empty")).toThrow(/Missing raw file|Missing "company_overview"/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module resolution.

- [ ] **Step 3: Implement**

`validate.ts`:
```ts
import type { FactPack } from "./schema";
export interface ValidationIssue { field: string; message: string; value: unknown }
const sumShares = (xs: { share: number }[]) => xs.reduce((a, x) => a + x.share, 0);

export function validateFactPack(p: FactPack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const years = p.statements.fiscalYears.map((l) => Number("20" + l.slice(2)));
  if (!years.every((y, i) => i === 0 || y === years[i - 1] + 1))
    issues.push({ field: "statements.fiscalYears", message: "must be five consecutive years, oldest first", value: p.statements.fiscalYears });
  for (const [name, table] of Object.entries({ income: p.statements.income, balance: p.statements.balance, cashflow: p.statements.cashflow }))
    for (const r of table) if (r.values.length !== 5) issues.push({ field: `statements.${name}.${r.key}`, message: "must have five values", value: r.values.length });
  const segSum = sumShares(p.segments.items);
  if (Math.abs(segSum - 1) > 0.02) issues.push({ field: "segments.items[].share", message: "shares must sum to 1 ± 0.02", value: segSum });
  const geoSum = sumShares(p.geoMix.items);
  if (Math.abs(geoSum - 1) > 0.02) issues.push({ field: "geoMix.items[].share", message: "shares must sum to 1 ± 0.02", value: geoSum });
  const a = p.analysts;
  if (a.buy + a.hold + a.sell !== a.count) issues.push({ field: "analysts.count", message: "buy + hold + sell must equal count", value: a.count });
  const h = p.history;
  const ascending = h.every((pt, i) => i === 0 || pt.date > h[i - 1].date);
  if (h.length < 20 || !ascending || (h.length > 0 && h[h.length - 1].date > p.capturedAt.slice(0, 10)))
    issues.push({ field: "history", message: "must be ≥ 20 points, strictly ascending, ending on or before capturedAt", value: { length: h.length, ascending, last: h.at(-1)?.date } });
  if (p.latestQuarter.periodEnd !== p.filing.periodEnd)
    issues.push({ field: "latestQuarter.periodEnd", message: `must equal filing.periodEnd (${p.filing.periodEnd})`, value: p.latestQuarter.periodEnd });
  return issues;
}

export function assertValidFactPack(p: FactPack, label: string): void {
  const issues = validateFactPack(p);
  if (!issues.length) return;
  throw new Error(`Invalid FactPack ${label}:\n` + issues.map((i) => `  - ${i.field}: ${i.message} (received ${JSON.stringify(i.value)})`).join("\n"));
}
```

`build.ts`:
```ts
/** build.ts — raw directory in, FactPack out. Refuses to write on any failure. */
import { basename } from "node:path";
import { readRawJson } from "./raw";
import { FactPack, FACTPACK_SCHEMA_VERSION } from "./schema";
import { assertValidFactPack } from "./validate";
import { RAW_CAPTURE_META } from "./manifest";
import * as quote from "./map/quote";
import * as statements from "./map/statements";
import * as segments from "./map/segments";
import * as analysts from "./map/analysts";
import * as history from "./map/history";
import * as context from "./map/context";

type Source = "fmp" | "bigdata" | "edgar" | "yahoo";

export function buildFactPack(dir: string): FactPack {
  const meta = readRawJson(dir, RAW_CAPTURE_META) as { capturedAt: string };
  const filing = readRawJson(dir, "edgar-filing.json") as {
    form: "10-Q" | "10-K"; accession: string; filedDate: string; periodEnd: string; url: string; ticker: string; cik: number; company: string };
  if (filing.accession !== basename(dir)) throw new Error(`edgar-filing.json accession ${filing.accession} ≠ directory ${basename(dir)}`);

  const q = quote.mapQuote(dir);
  const s = statements.mapStatements(dir);
  const latestFY = Number("20" + s.statements.fiscalYears[4].slice(2));
  const g = segments.mapSegments(dir);
  const a = analysts.mapAnalysts(dir, latestFY);
  const h = history.mapHistory(dir, meta.capturedAt);
  const c = context.mapContext(dir, filing, meta.capturedAt, q.description);

  const stamp = (source: Source, rows: { field: string; endpoint: string }[]) => rows.map((r) => ({ ...r, source, capturedAt: meta.capturedAt }));
  const peersProv = analysts.PROVENANCE.filter((r) => r.field === "peers");
  const bigdataProv = analysts.PROVENANCE.filter((r) => r.field !== "peers");

  const pack: FactPack = {
    schemaVersion: FACTPACK_SCHEMA_VERSION,
    ticker: filing.ticker, cik: filing.cik, company: q.company, exchange: q.exchange,
    filing: { form: filing.form, accession: filing.accession, filedDate: filing.filedDate, periodEnd: filing.periodEnd, url: filing.url },
    capturedAt: meta.capturedAt,
    quote: q.quote, statements: s.statements, latestQuarter: s.latestQuarter, ttm: s.ttm,
    estimates: a.estimates, analysts: a.analysts, segments: g.segments, geoMix: g.geoMix, peers: a.peers,
    history: h, context: c,
    provenance: [
      ...stamp("bigdata", quote.PROVENANCE), ...stamp("bigdata", statements.PROVENANCE), ...stamp("bigdata", segments.PROVENANCE),
      ...stamp("bigdata", bigdataProv), ...stamp("fmp", peersProv), ...stamp("yahoo", history.PROVENANCE),
      ...stamp("edgar", context.PROVENANCE.slice(0, 2)), ...stamp("bigdata", context.PROVENANCE.slice(2)),
    ],
  };
  FactPack.parse(pack);
  assertValidFactPack(pack, `${filing.ticker}/${filing.accession}`);
  return pack;
}
```

`scripts/facts-build.ts`:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFactPack } from "../lib/facts/build";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:build -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const pack = buildFactPack(join("data", "raw", ticker, accession));
const outDir = join("data", "facts", ticker);
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${accession}.json`);
writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
console.log(`Wrote ${out}\n  ${pack.company} · ${pack.filing.form} ${pack.filing.periodEnd} · price ${pack.quote.price} · ${pack.history.length} closes · ${pack.provenance.length} provenance rows`);
```

Add `"facts:build": "node --env-file-if-exists=.env.local --import tsx scripts/facts-build.ts"`.

- [ ] **Step 4: Run tests, then build for real** — `npx vitest run lib/facts` green; `npm run facts:build -- AVGO 0001730168-26-000080` writes the FactPack. Paste the CLI output. If validation fails, paste the issues and stop.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: validate and build the FactPack; add Broadcom's first FactPack"`

---

## Task 11: Projection and parity

**Files:**
- Create: `lib/facts/project.ts`, `scripts/facts-diff.ts`
- Modify: `package.json` (`facts:diff`)
- Test: `lib/facts/project.test.ts`

**Interfaces:**
- Consumes: `FactPack`; `Report`, `FinancialTable`, `SnapshotCellData` types; `formatCell`, `formatSnapshot`, `usd`.
- Produces: `ReportFacts`; `projectReportFacts(pack) → ReportFacts`; `npm run facts:diff <TICKER> <ACCESSION>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { projectReportFacts } from "@/lib/facts/project";
import { buildFactPack } from "@/lib/facts/build";
import { formatCell } from "@/lib/format";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const facts = projectReportFacts(buildFactPack("data/raw/AVGO/0001730168-26-000080"));
const fixture = Report.parse(avgo);

/** Same vendor as the fixture, so every row is asserted — including EBITDA. */
const LABELS: Record<"income" | "balance" | "cashflow", string[]> = {
  income: ["Revenue ($B)", "YoY Growth", "Gross Margin", "Operating Income ($B)", "EBITDA ($B)", "Net Income ($B)", "Diluted EPS ($)*"],
  balance: ["Cash & ST Investments", "Total Debt", "Net Debt", "Total Equity", "Current Ratio"],
  cashflow: ["Operating Cash Flow", "Free Cash Flow", "FCF Margin"],
};

describe("projectReportFacts parity with data/avgo.json", () => {
  for (const table of ["income", "balance", "cashflow"] as const) {
    it(`matches the ${table} table row for row, formatted`, () => {
      const got = facts.sections.financials[table], want = fixture.sections.financials[table];
      expect(got.columns).toEqual(want.columns);
      for (const label of LABELS[table]) {
        const g = got.rows.find((r) => r.label === label)!, w = want.rows.find((r) => r.label === label)!;
        expect(g, label).toBeDefined();
        expect(g.values.map((v) => formatCell(v, g.format)), label).toEqual(w.values.map((v) => formatCell(v, w.format)));
      }
    });
  }
  it("projects the filing metadata exactly", () => { expect(facts.meta.filing).toEqual(fixture.meta.filing); });
  it("projects the sixteen generic snapshot cells in order", () => {
    expect(facts.snapshot.map((c) => c.label)).toEqual([
      "Current Price", "Market Cap", "52-Week Range", "Shares Outstanding", "P/E (TTM)", "Consensus Target",
      "EV/EBITDA (TTM)", "Analyst Consensus", "FY25 Revenue", "FY25 Net Income", "FY25 Diluted EPS",
      "FY26E Revenue", "Q3'26 Revenue", "Q3'26 Operating Margin", "Fwd P/E (FY27E)", "Dividend Yield",
    ]);
  });
  it("projects the analyst numbers the fixture carries", () => {
    expect(facts.analystSentiment).toMatchObject({ numAnalysts: 60, buy: 54, hold: 6, sell: 0, consensusTarget: 509.61, medianTarget: 517.5, highTarget: 600, lowTarget: 350 });
  });
  it("projects segments and geography as ratios", () => {
    expect(facts.sections.businessMoat.segments.map((s) => s.sharePct).reduce((a, b) => a + b)).toBeCloseTo(1, 6);
    expect(facts.sections.businessMoat.geoMix.every((g) => g.sharePct > 0 && g.sharePct < 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module resolution.

- [ ] **Step 3: Implement**

```ts
/**
 * project.ts — FactPack → the numeric subset of a Report.
 * -----------------------------------------------------------------------------
 * Display labels and formats match data/avgo.json so parity can be checked at
 * the string level. Derived rows (YoY, gross margin, FCF margin) are computed
 * here from full-precision values, never from rounded ones.
 */
import type { FactPack } from "./schema";
import type { Report, FinancialTable, SnapshotCellData } from "../report.schema";

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
}

const vals = (p: FactPack, table: "income" | "balance" | "cashflow", key: string) =>
  p.statements[table].find((r) => r.key === key)?.values ?? [null, null, null, null, null];
const ratioRows = (a: (number | null)[], b: (number | null)[]) => a.map((x, i) => (x == null || b[i] == null || b[i] === 0 ? null : x / (b[i] as number)));
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
    { label: "EBITDA ($B)", values: vals(p, "income", "ebitda"), format: "usdB" },
    { label: "Net Income ($B)", values: vals(p, "income", "netIncome"), format: "usdB" },
    { label: "Diluted EPS ($)*", values: vals(p, "income", "epsDiluted"), format: "eps" },
  ] };
  const balance: FinancialTable = { columns: ["Metric ($B)", ...fy], rows: [
    { label: "Cash & ST Investments", values: vals(p, "balance", "cashAndInvestments"), format: "usdB" },
    { label: "Total Debt", values: vals(p, "balance", "totalDebt"), format: "usdB" },
    { label: "Net Debt", values: vals(p, "balance", "netDebt"), format: "usdB" },
    { label: "Total Equity", values: vals(p, "balance", "totalEquity"), format: "usdB" },
    { label: "Current Ratio", values: vals(p, "balance", "currentRatio"), format: "num2" },
  ] };
  const fcf = vals(p, "cashflow", "freeCashFlow");
  const cashflow: FinancialTable = { columns: ["Metric ($B)", ...fy], rows: [
    { label: "Operating Cash Flow", values: vals(p, "cashflow", "operatingCashFlow"), format: "usdB" },
    { label: "Free Cash Flow", values: fcf, format: "usdB" },
    { label: "FCF Margin", values: ratioRows(fcf, revenue), format: "pct" },
  ] };

  const last = fy[4], q = p.quote, a = p.analysts, lq = p.latestQuarter;
  const fwdPe = p.estimates.followingFY.eps ? q.price / p.estimates.followingFY.eps : null;
  const nextRevYoY = p.estimates.nextFY.revenue && revenue[4] ? p.estimates.nextFY.revenue / revenue[4]! - 1 : undefined;
  const snapshot: SnapshotCellData[] = [
    { label: "Current Price", value: q.price, unit: "usd" },
    { label: "Market Cap", value: q.marketCap, unit: "usdLarge", approx: true },
    { label: "52-Week Range", raw: `$${q.week52Low.toFixed(2)} – $${q.week52High.toFixed(2)}` },
    { label: "Shares Outstanding", value: q.sharesOutstanding, unit: "shares", approx: true },
    { label: "P/E (TTM)", value: p.ttm.pe ?? undefined, unit: "mult" },
    { label: "Consensus Target", value: a.consensusTarget, unit: "usd", change: a.consensusTarget / q.price - 1 },
    { label: "EV/EBITDA (TTM)", value: p.ttm.evToEbitda ?? undefined, unit: "mult" },
    { label: "Analyst Consensus", raw: `${a.consensusRating} (${a.buy} B / ${a.hold} H / ${a.sell} S)` },
    { label: `${last} Revenue`, value: revenue[4] ?? undefined, unit: "usdLarge", change: yoy(revenue)[4] ?? undefined },
    { label: `${last} Net Income`, value: vals(p, "income", "netIncome")[4] ?? undefined, unit: "usdLarge" },
    { label: `${last} Diluted EPS`, value: vals(p, "income", "epsDiluted")[4] ?? undefined, unit: "usd" },
    { label: `${p.estimates.nextFY.label} Revenue`, value: p.estimates.nextFY.revenue ?? undefined, unit: "usdLarge", approx: true, change: nextRevYoY, changeDp: 0 },
    { label: `${lq.label} Revenue`, value: lq.revenue, unit: "usdLarge", change: lq.revenueYoY ?? undefined, changeDp: 0 },
    { label: `${lq.label} Operating Margin`, value: lq.operatingMargin, unit: "pct", dp: 0 },
    { label: `Fwd P/E (${p.estimates.followingFY.label})`, value: fwdPe ?? undefined, unit: "mult", approx: true },
    { label: "Dividend Yield", value: q.dividendYield, unit: "pct", dp: 2 },
  ];

  // The fixture stores display forms here: "fiscal Q3 2026" and "Sep 10, 2026".
  const fiscalPeriod = `fiscal ${lq.label.slice(0, 2)} 20${lq.label.slice(3)}`;
  const filedDate = new Date(p.filing.filedDate + "T00:00:00Z")
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  return {
    meta: { filing: { form: p.filing.form, fiscalPeriod, filedDate, accession: p.filing.accession },
            company: p.company, ticker: p.ticker, exchange: p.exchange, asOf: q.asOf },
    quote: { currentPrice: q.price, marketCap: q.marketCap, sharesOutstanding: q.sharesOutstanding, week52Low: q.week52Low, week52High: q.week52High, dividendYield: q.dividendYield },
    snapshot,
    analystSentiment: { numAnalysts: a.count, buy: a.buy, hold: a.hold, sell: a.sell, consensusRating: a.consensusRating,
      consensusTarget: a.consensusTarget, medianTarget: a.medianTarget, highTarget: a.highTarget, lowTarget: a.lowTarget },
    sections: {
      financials: { income, balance, cashflow },
      valuation: { multiplesCompanyColumn: [
        { label: "P/E", value: p.ttm.pe }, { label: "P/S", value: p.ttm.ps }, { label: "EV/EBITDA", value: p.ttm.evToEbitda }, { label: "Fwd P/E (NTM)", value: fwdPe } ] },
      businessMoat: {
        segments: p.segments.items.map((s) => ({ name: s.name, sharePct: s.share, revenue: s.revenue })), segmentsBasis: `${p.segments.basis} mix`,
        geoMix: p.geoMix.items.map((g) => ({ region: g.region, sharePct: g.share })), geographyBasis: p.geoMix.basis,
      },
    },
  };
}
```

`scripts/facts-diff.ts` — prints, for every projected value that has a counterpart in `data/<ticker>.json`, the two formatted strings and whether they match; exits 0 regardless (it is a report):
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFactPack } from "../lib/facts/build";
import { projectReportFacts } from "../lib/facts/project";
import { formatCell, formatSnapshot } from "../lib/format";
import { Report } from "../lib/report.schema";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:diff -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const facts = projectReportFacts(buildFactPack(join("data", "raw", ticker, accession)));
const fixture = Report.parse(JSON.parse(readFileSync(join("data", `${ticker.toLowerCase()}.json`), "utf8")));

let same = 0, diff = 0;
const line = (where: string, a: string, b: string) => { const ok = a === b; ok ? same++ : diff++; console.log(`${ok ? "  " : "! "}${where.padEnd(44)} facts=${a.padEnd(18)} report=${b}`); };
for (const t of ["income", "balance", "cashflow"] as const)
  for (const g of facts.sections.financials[t].rows) {
    const w = fixture.sections.financials[t].rows.find((r) => r.label === g.label); if (!w) continue;
    g.values.forEach((v, i) => line(`${t}.${g.label}[${fixture.sections.financials[t].columns[i + 1]}]`, formatCell(v, g.format), formatCell(w.values[i], w.format)));
  }
for (const c of facts.snapshot) { const w = fixture.snapshot.find((x) => x.label === c.label); if (w) line(`snapshot.${c.label}`, formatSnapshot(c), formatSnapshot(w)); }
for (const k of ["consensusTarget", "medianTarget", "highTarget", "lowTarget", "numAnalysts"] as const)
  line(`analystSentiment.${k}`, String(facts.analystSentiment[k]), String(fixture.analystSentiment[k]));
console.log(`\n${same} match, ${diff} differ. Quote/target/estimate fields drift daily; statement rows should match.`);
```

Add `"facts:diff": "node --env-file-if-exists=.env.local --import tsx scripts/facts-diff.ts"`.

- [ ] **Step 4: Run** — `npx vitest run lib/facts/project.test.ts`. Then `npm run facts:diff -- AVGO 0001730168-26-000080` and paste the full output. Expect the fifteen statement rows to match. The snapshot cell `Q3'26 Operating Margin` is expected to differ: the projection is GAAP (≈54%), the fixture's "68% (record)" is Broadcom's non-GAAP figure — report it, do not chase it. Any *statement* row that differs is a finding to report with both values.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: project a FactPack onto the Report's numeric fields, with parity against avgo.json"`

---

## Task 12: Real history in the chart (schema 1.1.0)

**Files:**
- Modify: `lib/report.schema.ts` (additive), `components/chart/types.ts`, `components/chart/geometry.ts`, `components/chart/ProjectionChart.tsx`, `components/report/EquityReport.tsx`, `lib/format.test.ts` (schema version assertion), `data/avgo.json`
- Create: `scripts/report-history.ts`
- Modify: `package.json` (`report:history`)
- Test: `components/chart/geometry.test.ts`, `components/report/EquityReport.test.tsx` (additions)

**Interfaces:**
- Consumes: `FactPack.history`.
- Produces: `Report.quote.history?: { date; close }[]`; `SCHEMA_VERSION = "1.1.0"`; `ChartModel.history: HistoryPoint[]`, `ChartModel.placeholder: boolean`; `npm run report:history <TICKER> <ACCESSION>`.

- [ ] **Step 1: Write the failing tests**

Append to `components/chart/geometry.test.ts`:
```ts
describe("buildChartModel history", () => {
  it("uses real closes when the report carries them", () => {
    const closes = Array.from({ length: 25 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, close: 300 + i }));
    const withHistory = { ...report, quote: { ...report.quote, history: closes } };
    const m = buildChartModel(withHistory);
    expect(m.placeholder).toBe(false);
    expect(m.history).toHaveLength(25);
    expect(m.history[24]).toEqual({ day: 0, price: 324 });
    expect(m.history[0].day).toBe(-24);
  });
  it("falls back to the synthetic placeholder without history", () => {
    const m = buildChartModel({ ...report, quote: { ...report.quote, history: undefined } });
    expect(m.placeholder).toBe(true);
    expect(m.history.at(-1)).toEqual({ day: 0, price: report.quote.currentPrice });
  });
});
```

In `components/report/EquityReport.test.tsx`, **replace** the existing test `"captions the placeholder history line"` (after Step 3 the fixture carries real closes, so the caption is absent by default) with these two:
```ts
  it("captions the history line while it is the placeholder", () => {
    render(<EquityReport data={{ ...report, quote: { ...report.quote, history: undefined } }} />);
    expect(screen.getByText(/history line is indicative/i)).toBeInTheDocument();
  });
  it("drops the placeholder caption when real history is present", () => {
    const closes = Array.from({ length: 25 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, close: 300 + i }));
    render(<EquityReport data={{ ...report, quote: { ...report.quote, history: closes } }} />);
    expect(screen.queryByText(/history line is indicative/i)).toBeNull();
  });
```

In `lib/format.test.ts`, change the `schemaVersion` assertion to `"1.1.0"` (it will fail until Step 3 backfills the fixture).

- [ ] **Step 2: Run to verify they fail** — the new geometry tests fail (`placeholder`/`history` undefined on `ChartModel`); the format test fails on version.

- [ ] **Step 3: Implement**

`lib/report.schema.ts` — two additive edits only:
```ts
export const SCHEMA_VERSION = "1.1.0";
// inside quote:
  history: z.array(z.object({ date: z.string(), close: z.number() })).optional(),
```

`components/chart/types.ts` — add to `ChartModel`:
```ts
  /** Trailing closes as (day ≤ 0, price); day 0 is the current price. */
  history: HistoryPoint[];
  /** True when history is the synthetic wave, not vendor closes. */
  placeholder: boolean;
```

`components/chart/geometry.ts` — in `buildChartModel`, after `current`:
```ts
  const closes = r.quote.history ?? [];
  const real = closes.length >= 2;
  const history: HistoryPoint[] = real
    ? closes.map((c, i) => ({ day: i - (closes.length - 1), price: c.close }))
    : historySeries(current).points;
  if (real) history[history.length - 1] = { day: 0, price: closes[closes.length - 1].close };
```
and include `history, placeholder: !real` in the returned model. (`historySeries` stays exported and unchanged; it is now called only here.)

`components/chart/ProjectionChart.tsx` — remove the `historySeries(model.current)` call and the import; use `model.history` for the path generator.

`components/report/EquityReport.tsx` — remove the `historySeries` import and the `isPlaceholderHistory` line; render the caption on `chartModel.placeholder`.

`scripts/report-history.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../lib/report.schema";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run report:history -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const pack = JSON.parse(readFileSync(join("data", "facts", ticker, `${accession}.json`), "utf8")) as { history: { date: string; close: number }[] };
const reportPath = join("data", `${ticker.toLowerCase()}.json`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
report.schemaVersion = SCHEMA_VERSION;
report.quote.history = pack.history;
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Wrote ${pack.history.length} closes into ${reportPath} (schema ${SCHEMA_VERSION})`);
```

Add `"report:history": "node --import tsx scripts/report-history.ts"`. Run `npm run report:history -- AVGO 0001730168-26-000080`.

- [ ] **Step 4: Verify everything** — `npm test` green (all suites, including the parity test which re-reads the fixture); `npx tsc --noEmit -p .` clean; `npm run build` green. Then `npm run dev`, curl `/research/avgo`, and confirm the caption text "history line is indicative" is **absent** and the history `<path d="…">` is present. Paste the greps.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: carry real price history into the report and chart (schema 1.1.0)"`

---

## Task 13: README and the loop end to end

**Files:**
- Modify: `README.md`
- Test: none new; the deliverable is a documented, reproducible run.

- [ ] **Step 1: Add the pipeline section to `README.md`**, after "Running it":

```markdown
## The fact pipeline (subsystem 2)

```bash
npm run watchlist:add -- NVDA           # resolves the CIK via sec.gov, appends to data/edgar/watchlist.json
npm run detect                          # polls EDGAR for new 10-Q/10-K on the watchlist; prints them; marks seen
npm run facts:prepare -- AVGO 0001730168-26-000080  # EDGAR filing record + primary document + Yahoo daily closes → data/raw/…
/fetch-facts AVGO 0001730168-26-000080  # in Claude Code: captures vendor responses verbatim to data/raw/…
npm run facts:build -- AVGO 0001730168-26-000080   # raw → validated FactPack in data/facts/…
npm run facts:diff  -- AVGO 0001730168-26-000080   # projected facts vs data/avgo.json, formatted
npm run report:history -- AVGO 0001730168-26-000080 # copies real closes into the report (chart history line)
```

`EDGAR_CONTACT=<your email>` must be set in `.env.local` (see `.env.example`); SEC requires it.
Numbers come from Bigdata.com company tearsheets (which proxy FMP data) and profile/peers from FMP `company`, both through the Claude connectors — the
`fetch-facts` skill executes `lib/facts/manifest.ts`; EDGAR and Yahoo are fetched by code. Unattended runs need API keys
and a REST `FactSource`; see the spec's "FactSource seam".
```

Also update the "Pipeline flow" list's steps 1–2 to reference these commands, and change any remaining `1.0.0` mention of `schemaVersion` to `1.1.0`.

- [ ] **Step 2: Prove the loop from a clean state** — run, in order, and paste each output: `npm run detect` (expect "No new" — everything is seen), `npm run facts:manifest -- AVGO 0001730168-26-000080 --check` (all present), `npm run facts:build -- AVGO 0001730168-26-000080` (writes the pack, byte-identical to the committed one — verify with `git status --short` showing no change), `npm test`, `npm run build`.

- [ ] **Step 3: Commit** — `git add README.md && git commit -m "docs: document the fact pipeline commands"`

---

## Self-Review

**Spec coverage.** Watcher (§) → Tasks 2, 4. Filing text → Task 3. FactPack contract → Task 1. Manifest + skill → Tasks 5, 6. Mapping → Tasks 7–9. Validation, build → Task 10. Projection + parity → Task 11. History line / schema 1.1.0 → Task 12. Error handling → Tasks 2 (URL-naming throws), 6 (`.error.txt`, `--check`), 7 (`readRawArray`/`pick` throws), 10 (validate). Testing section → every task. FactSource seam → Task 5. README → Task 13. The spec's "scripts run under native type stripping" sentence is corrected in Task 4.

**Type consistency.** `Filing` (Task 2) is consumed by Tasks 4, 6, 9, 10 with the same five fields plus `url`. `FactPack["quote" | "statements" | …]` section types (Task 1) are the return types of every mapper (Tasks 7–9) and are assembled in Task 10. `HistoryPoint` from `lib/facts/schema` (`{ date, close }`) is distinct from `components/chart/types` `HistoryPoint` (`{ day, price }`); Task 12 converts between them explicitly. `PEER_LIMIT` (Task 5) is imported by Task 8. `ValidationIssue` matches subsystem 1's shape.

**Placeholder scan.** None. The mapper tasks (revised 2026-09-12) carry the captured tearsheet, FMP `company`, and Yahoo shapes verbatim, with a report-both-values procedure for any mismatch — a procedure, not a gap. Task 6 states the MCP-tool prerequisite and the escalation path.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks. Task 6 needs an agent with the FMP/Bigdata connectors (proven available to subagents on the first run).
2. **Inline Execution** — tasks executed in this session with batch checkpoints.
