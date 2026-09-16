# SEC + Yahoo Free Fact Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the three Bigdata tearsheet files (`bigdata-tearsheet-annual.json`, `bigdata-statements-annual.json`, `bigdata-statements-quarter.json`) from free sources — SEC XBRL `companyfacts` and Yahoo `quoteSummary` — via a new `npm run facts:free` command, so `facts:build` no longer depends on metered Bigdata.com credits.

**Architecture:** A shape-preserving adapter under `lib/facts/free/`. New code fetches SEC XBRL + Yahoo, derives the values the tearsheet carries (EBITDA, net debt, FCF, TTM ratios, estimates, targets), and writes the three files in the exact shape the existing mappers read. Zero changes to `build.ts`, the mappers, the schema, validators, or the report/synthesis layer — parity is proven by a contract test that runs the emitted files through the real mappers.

**Tech Stack:** TypeScript, Node 20+ (built-in `fetch`, `--env-file`), tsx, vitest. Reuses `lib/edgar/client.ts` (`edgarJson`, `FetchLike` seam) and `scripts/_env.ts` (`requireContact`).

**Spec:** `docs/superpowers/specs/2026-09-16-sec-yahoo-free-factsource-design.md` — the plan argues from the spec; read both. The spec carries the full SEC concept-map table (with fallbacks), the Yahoo field map, the period-selection rules, and the TTM formulas. Where a task says "per the spec's concept map", the exhaustive fallback lists live there.

## Global Constraints

- Every network call goes through an injectable `fetchImpl: FetchLike = fetch` parameter (the `lib/edgar/client.ts` pattern) so tests never hit the wire.
- SEC requests use `edgarHeaders(contact)` (User-Agent `juniresearch/0.1 (<EDGAR_CONTACT>)`); `EDGAR_CONTACT` is read only via `requireContact()` and never printed.
- Vendor sign convention (match Bigdata exactly): cash-flow outflows are **negative** (`capex`, `common_stock_repurchased`, `common_dividends_paid`); `free_cash_flow = operating_cash_flow + capex`.
- `net_debt = total_debt − cash` (cash only, not cash+ST-investments) — matches the vendor convention verified on the INTC capture.
- The emitted files must keep the exact nesting the mappers read: statements under `fundamentals.{income_statement,balance_sheet,cash_flow}`; TTM rows under `fundamentals.{key_metrics,ratios}` with `fiscal_period: "TTM"`; quote under `company_overview` + `price_performance.current_market`; analysts under `analyst_data.{price_targets,ratings}`; estimates under `estimates.records`; segments under `revenue_segmentation.{product,geographic}` (empty objects for v1).
- Yahoo failure (401/403/HTML/empty crumb) **fails the run loudly** — never emit a report with fabricated analyst targets.
- v1 scope: segments emit as empty (`{}`) → the existing single-"Consolidated" fallback handles them. Do NOT parse XBRL segment axes in v1.
- Follow existing file conventions: small focused modules, named exports, no default exports, `type`-only imports where possible.

---

## File Structure

- `lib/facts/free/sec.ts` — SEC `companyfacts` fetch + concept/period selection + derivations → `SecPeriod[]` (annual, quarter). Owns the concept map and the XBRL period-selection rules.
- `lib/facts/free/yahoo.ts` — Yahoo crumb flow + `quoteSummary` fetch, and a pure parser → `YahooData`.
- `lib/facts/free/ttm.ts` — TTM `key_metrics` + `ratios` rows from the last four SEC quarters + Yahoo price/market cap.
- `lib/facts/free/emit.ts` — assemble `SecPeriod[]` + `YahooData` + TTM into the three tearsheet-shaped objects, and write them to a capture dir.
- `scripts/facts-free.ts` — CLI: `npm run facts:free -- <TICKER> <ACCESSION>`.
- `lib/facts/free/__fixtures__/` — trimmed real `companyfacts` slice and `quoteSummary` response for tests.
- `package.json` — add the `facts:free` script.

---

## Task 1: SEC companyfacts → statement rows

**Files:**
- Create: `lib/facts/free/sec.ts`
- Create: `lib/facts/free/__fixtures__/lly-companyfacts.json` (trimmed real slice)
- Test: `lib/facts/free/sec.test.ts`

**Interfaces:**
- Consumes: `edgarJson`, `FetchLike` from `../../edgar/client`.
- Produces:
  ```ts
  export interface SecPeriod {
    fiscal_period: string; // "FY" | "Q1" | "Q2" | "Q3" | "Q4"
    fiscal_year: number;   // calendar year of period end
    report_date: string;   // YYYY-MM-DD (period end)
    revenue: number | null;
    gross_profit: number | null;
    operating_income: number | null;
    ebitda: number | null;
    net_income: number | null;
    eps_diluted: number | null;
    interest_expense: number | null;
    cash_and_short_term_investments: number | null;
    cash: number | null;
    total_debt: number | null;
    net_debt: number | null;
    total_equity: number | null;
    total_current_assets: number | null;
    total_current_liabilities: number | null;
    operating_cash_flow: number | null;
    capex: number | null;
    common_stock_repurchased: number | null;
    common_dividends_paid: number | null;
    free_cash_flow: number | null;
  }
  export async function fetchCompanyFacts(cik: number, contact: string, fetchImpl?: FetchLike): Promise<unknown>;
  export function parseCompanyFacts(facts: unknown): { annual: SecPeriod[]; quarter: SecPeriod[] };
  ```

**Fixture creation (do this first, once):** run this throwaway snippet from the worktree to capture a trimmed real slice, then hand-trim to ~2 annual + ~5 quarterly periods per concept to keep the fixture small:
```bash
node --env-file-if-exists=.env.local -e '
const ua=`juniresearch/0.1 (${process.env.EDGAR_CONTACT})`;
const r=await fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK0000059478.json",{headers:{"User-Agent":ua}});
const j=await r.json();
const keep=["Revenues","GrossProfit","OperatingIncomeLoss","NetIncomeLoss","EarningsPerShareDiluted",
"DepreciationDepletionAndAmortization","InterestExpense","CashCashEquivalentsAndShortTermInvestments",
"CashAndCashEquivalentsAtCarryingValue","LongTermDebtNoncurrent","LongTermDebtCurrent","StockholdersEquity",
"AssetsCurrent","LiabilitiesCurrent","NetCashProvidedByUsedInOperatingActivities",
"PaymentsToAcquirePropertyPlantAndEquipment","PaymentsForRepurchaseOfCommonStock","PaymentsOfDividendsCommonStock"];
const out={entityName:j.entityName, facts:{"us-gaap":{}}};
for(const k of keep) if(j.facts["us-gaap"][k]) out.facts["us-gaap"][k]=j.facts["us-gaap"][k];
require("fs").writeFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", JSON.stringify(out));
console.log("wrote fixture, concepts:", Object.keys(out.facts["us-gaap"]).length);
'
```
(Then open the fixture and delete all but the most recent ~2 FY and ~5 quarterly unit entries per concept so tests stay fast and legible.)

- [ ] **Step 1: Write the failing test** (`lib/facts/free/sec.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCompanyFacts, type SecPeriod } from "./sec";

const facts = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", "utf8"));

describe("parseCompanyFacts", () => {
  const { annual, quarter } = parseCompanyFacts(facts);
  const fy = (y: number) => annual.find((p) => p.fiscal_year === y)!;

  it("selects annual FY rows by 10-K, ~1-year duration, keyed by period-end year", () => {
    const latest = annual.at(-1)!;
    expect(latest.fiscal_period).toBe("FY");
    expect(latest.report_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(latest.revenue).toBeGreaterThan(0);
    expect(latest.net_income).not.toBeNull();
  });

  it("derives EBITDA as operating income + D&A", () => {
    const p = annual.at(-1)!;
    // EBITDA must exceed operating income when D&A is positive
    expect(p.ebitda!).toBeGreaterThan(p.operating_income!);
  });

  it("derives total debt, net debt (debt − cash), and free cash flow (OCF + capex, capex negative)", () => {
    const p = annual.at(-1)!;
    expect(p.total_debt!).toBeGreaterThan(0);
    expect(p.net_debt!).toBe(p.total_debt! - p.cash!);
    expect(p.capex!).toBeLessThan(0);
    expect(p.free_cash_flow!).toBe(p.operating_cash_flow! + p.capex!);
  });

  it("emits quarterly income rows labelled Q1..Q4 with revenue and operating income", () => {
    expect(quarter.length).toBeGreaterThanOrEqual(4);
    const latest = quarter.at(-1)!;
    expect(latest.fiscal_period).toMatch(/^Q[1-4]$/);
    expect(latest.revenue).toBeGreaterThan(0);
    expect(latest.operating_income).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/facts/free/sec.test.ts`
Expected: FAIL with "Cannot find module './sec'" (or "parseCompanyFacts is not a function").

- [ ] **Step 3: Write the implementation** (`lib/facts/free/sec.ts`)

Implement, per the spec's SEC concept map and period-selection rules:
- A `pick(facts, concepts: string[]): UnitEntry[]` helper that returns the first present concept's `units.USD` (or `units["USD/shares"]` for EPS) array.
- Period selectors:
  - `annualFlow(entries)`: `form === "10-K"`, has `start`, duration `end−start` in `[350, 380]` days; key by `year(end)`; on duplicate years keep max `filed`.
  - `annualInstant(entries)`: `form === "10-K"`, no `start`; key by `year(end)`; keep max `filed`.
  - `quarterFlow(entries)`: `form === "10-Q"`, has `start`, duration in `[80, 100]` days; `fiscal_period = "Q" + quarterOf(end)`; key by `year(end)`.
  - `quarterInstant(entries)`: latest instant per quarter end.
  - `quarterOf(end)`: `Math.floor(month0(end) / 3) + 1` (month of period end → calendar quarter).
- Build one `SecPeriod` per year (annual) and per quarter, reading each field with the concept fallback lists **from the spec's table** encoded as arrays, e.g.:
  ```ts
  const REVENUE = ["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet"];
  const DA = ["DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet","DepreciationAndAmortization"];
  const LTD_NONCURRENT = ["LongTermDebtNoncurrent","LongTermDebt"];
  const LTD_CURRENT = ["LongTermDebtCurrent","DebtCurrent"];
  // ...one const per row, order = priority (see spec)
  ```
- Derivations, per the Global Constraints:
  - `ebitda = operating_income + da` (null if either missing).
  - `total_debt = (ltdNoncurrent ?? 0) + (ltdCurrent ?? 0) + (shortTermBorrowings ?? 0)`; null only if all three concepts absent.
  - `net_debt = total_debt − cash`.
  - `capex = -paymentsToAcquirePPE`; `common_stock_repurchased = -repurchase`; `common_dividends_paid = -dividends` (each null if absent).
  - `free_cash_flow = operating_cash_flow + capex`.
  - Q4 flow rows (revenue, gross_profit, operating_income, net_income, ebitda, OCF, capex, dividends, buybacks, interest, eps_diluted): `FYvalue − (Q1 + Q2 + Q3)` for the same year, when all three quarters and the FY are present. Q4 balance/instant fields: the FY (10-K) period-end instant.
  - Sort `annual` and `quarter` ascending by `report_date`.
- `fetchCompanyFacts(cik, contact, fetchImpl=fetch)`: `edgarJson(\`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10,"0")}.json\`, contact, fetchImpl)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/facts/free/sec.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add lib/facts/free/sec.ts lib/facts/free/sec.test.ts lib/facts/free/__fixtures__/lly-companyfacts.json
git commit -m "Add SEC companyfacts parser for the free fact source"
```

---

## Task 2: Yahoo quoteSummary client + parser

**Files:**
- Create: `lib/facts/free/yahoo.ts`
- Create: `lib/facts/free/__fixtures__/lly-quotesummary.json` (trimmed real response)
- Test: `lib/facts/free/yahoo.test.ts`

**Interfaces:**
- Consumes: `FetchLike` from `../../edgar/client`.
- Produces:
  ```ts
  export interface YahooEstimate { fiscal_year: number; sales: number | null; eps: number | null }
  export interface YahooData {
    price: number; marketCap: number; companyName: string; exchange: string; description: string;
    week52Low: number; week52High: number; dividendYield: number;
    targets: { consensus: number; median: number; high: number; low: number };
    ratings: { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number; consensus: string };
    estimates: YahooEstimate[];
  }
  export async function fetchQuoteSummary(ticker: string, fetchImpl?: FetchLike): Promise<unknown>;
  export function parseQuoteSummary(raw: unknown, opts: { latestFY: number }): YahooData;
  ```

**Fixture creation (once):** capture a real trimmed response:
```bash
node -e '
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const c=await fetch("https://fc.yahoo.com",{headers:{"User-Agent":UA}});
const cookie=(c.headers.get("set-cookie")||"").split(";")[0];
const cr=await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb",{headers:{"User-Agent":UA,"Cookie":cookie}});
const crumb=await cr.text();
const u="https://query2.finance.yahoo.com/v10/finance/quoteSummary/LLY?modules=price,summaryDetail,financialData,earningsTrend,recommendationTrend,assetProfile&crumb="+encodeURIComponent(crumb);
const r=await fetch(u,{headers:{"User-Agent":UA,"Cookie":cookie}});
require("fs").writeFileSync("lib/facts/free/__fixtures__/lly-quotesummary.json", await r.text());
console.log("wrote fixture, status", r.status);
'
```

- [ ] **Step 1: Write the failing test** (`lib/facts/free/yahoo.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseQuoteSummary } from "./yahoo";

const raw = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-quotesummary.json", "utf8"));

describe("parseQuoteSummary", () => {
  const d = parseQuoteSummary(raw, { latestFY: 2025 });

  it("reads price, market cap, 52-week range and description", () => {
    expect(d.price).toBeGreaterThan(0);
    expect(d.marketCap).toBeGreaterThan(0);
    expect(d.week52High).toBeGreaterThan(d.week52Low);
    expect(d.description.length).toBeGreaterThan(20);
  });

  it("reads analyst targets and a rating breakdown that sums to at least one opinion", () => {
    expect(d.targets.consensus).toBeGreaterThan(0);
    expect(d.targets.high).toBeGreaterThanOrEqual(d.targets.low);
    const total = d.ratings.strong_buy + d.ratings.buy + d.ratings.hold + d.ratings.sell + d.ratings.strong_sell;
    expect(total).toBeGreaterThan(0);
    expect(d.ratings.consensus.length).toBeGreaterThan(0);
  });

  it("maps forward estimates to fiscal years latestFY+1 and beyond", () => {
    const next = d.estimates.find((e) => e.fiscal_year === 2026);
    expect(next).toBeDefined();
    expect(next!.sales === null || next!.sales! > 0).toBe(true);
    expect(next!.eps === null || Number.isFinite(next!.eps!)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/facts/free/yahoo.test.ts`
Expected: FAIL ("Cannot find module './yahoo'").

- [ ] **Step 3: Write the implementation** (`lib/facts/free/yahoo.ts`)

- `fetchQuoteSummary(ticker, fetchImpl=fetch)`:
  1. GET `https://fc.yahoo.com` with a browser `User-Agent`; read `set-cookie`, take the substring before the first `;`.
  2. GET `https://query1.finance.yahoo.com/v1/test/getcrumb` with `{User-Agent, Cookie}`; the response text is the crumb.
  3. If status ≠ 200, the crumb contains `<`, or it is empty → `throw new Error("Yahoo quoteSummary unavailable (crumb step failed); retry later or top up Bigdata.")`.
  4. GET `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price,summaryDetail,financialData,earningsTrend,recommendationTrend,assetProfile&crumb=${encodeURIComponent(crumb)}` with `{User-Agent, Cookie}`; if not ok, throw the same-style error; else return the parsed JSON.
- `parseQuoteSummary(raw, { latestFY })`: read `raw.quoteSummary.result[0]`; helper `rawVal(x) = x?.raw ?? null`. Map per the spec's Yahoo table:
  - `price = rawVal(price.regularMarketPrice)`, `marketCap = rawVal(price.marketCap)`, `companyName = price.longName ?? price.shortName`, `exchange = normalizeExchange(price.exchangeName)` (map `"NMS"/"NGM"→"NASDAQ"`, `"NYQ"→"NYSE"`, else uppercase), `description = assetProfile.longBusinessSummary`.
  - `week52Low/High = rawVal(summaryDetail.fiftyTwoWeekLow/High)`.
  - `dividendYield = rawVal(summaryDetail.dividendYield) ?? rawVal(summaryDetail.trailingAnnualDividendYield) ?? 0`.
  - `targets = { consensus: rawVal(financialData.targetMeanPrice), median: rawVal(financialData.targetMedianPrice), high: rawVal(financialData.targetHighPrice), low: rawVal(financialData.targetLowPrice) }`.
  - `ratings`: from `recommendationTrend.trend[0]` counts; `consensus = titleCase(financialData.recommendationKey)` (e.g. `"buy"→"Buy"`, `"strong_buy"→"Strong Buy"`).
  - `estimates`: for each `earningsTrend.trend[]` entry whose `endDate` year is in `{latestFY+1, latestFY+2}`, push `{ fiscal_year: year(endDate), sales: rawVal(revenueEstimate.avg), eps: rawVal(earningsEstimate.avg) }`.
  - Throw if `price`, `marketCap`, or any of the four `targets` is null (the report needs them).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/facts/free/yahoo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/facts/free/yahoo.ts lib/facts/free/yahoo.test.ts lib/facts/free/__fixtures__/lly-quotesummary.json
git commit -m "Add Yahoo quoteSummary client and parser for the free fact source"
```

---

## Task 3: TTM key_metrics + ratios

**Files:**
- Create: `lib/facts/free/ttm.ts`
- Test: `lib/facts/free/ttm.test.ts`

**Interfaces:**
- Consumes: `SecPeriod` from `./sec`.
- Produces:
  ```ts
  export interface TtmRows { keyMetrics: Record<string, unknown>; ratios: Record<string, unknown> }
  export function computeTtm(
    quarters: SecPeriod[],
    yh: { price: number; marketCap: number; dividendYield: number },
  ): TtmRows;
  ```

- [ ] **Step 1: Write the failing test** (`lib/facts/free/ttm.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { computeTtm } from "./ttm";
import type { SecPeriod } from "./sec";

const q = (over: Partial<SecPeriod>): SecPeriod => ({
  fiscal_period: "Q1", fiscal_year: 2026, report_date: "2026-03-31",
  revenue: 100, gross_profit: 80, operating_income: 40, ebitda: 50, net_income: 30, eps_diluted: 2,
  interest_expense: 5, cash_and_short_term_investments: 200, cash: 150, total_debt: 300, net_debt: 150,
  total_equity: 500, total_current_assets: 400, total_current_liabilities: 200,
  operating_cash_flow: 45, capex: -10, common_stock_repurchased: -5, common_dividends_paid: -8, free_cash_flow: 35,
  ...over,
});

describe("computeTtm", () => {
  const quarters = [
    q({ report_date: "2025-09-30" }), q({ report_date: "2025-12-31" }),
    q({ report_date: "2026-03-31" }), q({ report_date: "2026-06-30", net_debt: 150 }),
  ];
  const t = computeTtm(quarters, { price: 100, marketCap: 4000, dividendYield: 0.01 });

  it("sums the last four quarters for TTM margins and multiples", () => {
    expect(t.ratios.fiscal_period).toBe("TTM");
    expect(t.ratios.net_margin).toBeCloseTo(120 / 400, 6);     // Σnet 120 / Σrev 400
    expect(t.keyMetrics.price_to_sales).toBeCloseTo(4000 / 400, 6);
    expect(t.keyMetrics.pe_ratio).toBeCloseTo(100 / 8, 6);      // price / Σeps(8)
    expect(t.keyMetrics.ev_to_ebitda).toBeCloseTo((4000 + 150) / 200, 6); // (mktcap+netDebt)/Σebitda
  });

  it("uses the latest quarter for the current ratio and passes dividend yield through", () => {
    expect(t.ratios.current_ratio).toBeCloseTo(400 / 200, 6);
    expect(t.ratios.dividend_yield).toBe(0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/facts/free/ttm.test.ts`
Expected: FAIL ("Cannot find module './ttm'").

- [ ] **Step 3: Write the implementation** (`lib/facts/free/ttm.ts`)

- Take the last four quarters by `report_date`; `latest` = the newest.
- `sum(key)` over the four, treating null as skip; if any of the four is null return null (a partial TTM is misleading).
- `safeDiv(a, b) = a == null || b == null || b === 0 ? null : a / b`.
- `ratios`: `{ fiscal_period: "TTM", gross_margin: safeDiv(Σgross, Σrev), operating_margin: safeDiv(Σopinc, Σrev), net_margin: safeDiv(Σnet, Σrev), net_debt_to_ebitda: safeDiv(latest.net_debt, Σebitda), interest_coverage: safeDiv(Σopinc, Σinterest), current_ratio: safeDiv(latest.total_current_assets, latest.total_current_liabilities), dividend_yield: yh.dividendYield }`.
- `keyMetrics`: `{ fiscal_period: "TTM", pe_ratio: safeDiv(yh.price, Σeps), price_to_sales: safeDiv(yh.marketCap, Σrev), ev_to_ebitda: safeDiv(yh.marketCap + (latest.net_debt ?? 0), Σebitda), free_cash_flow_yield: safeDiv(Σfcf, yh.marketCap) }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/facts/free/ttm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/facts/free/ttm.ts lib/facts/free/ttm.test.ts
git commit -m "Add TTM metrics/ratios computation for the free fact source"
```

---

## Task 4: Emit the three tearsheet files (with mapper contract test)

**Files:**
- Create: `lib/facts/free/emit.ts`
- Test: `lib/facts/free/emit.test.ts`

**Interfaces:**
- Consumes: `SecPeriod` from `./sec`, `YahooData` from `./yahoo`, `TtmRows` from `./ttm`; the real mappers `mapStatements` (`../map/statements`), `mapQuote` (`../map/quote`), `mapAnalysts` (`../map/analysts`), `mapSegments` (`../map/segments`) — used by the test only.
- Produces:
  ```ts
  export interface EmitInput {
    cik: number; sec: { annual: SecPeriod[]; quarter: SecPeriod[] }; yahoo: YahooData; ttm: TtmRows; capturedAt: string;
  }
  export interface TearsheetFiles { tearsheetAnnual: unknown; statementsAnnual: unknown; statementsQuarter: unknown }
  export function buildTearsheetFiles(input: EmitInput): TearsheetFiles;
  export function writeTearsheetFiles(dir: string, files: TearsheetFiles): void;
  ```

- [ ] **Step 1: Write the failing test** (`lib/facts/free/emit.test.ts`) — the contract test that runs emitted files through the real mappers

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCompanyFacts } from "./sec";
import { parseQuoteSummary } from "./yahoo";
import { computeTtm } from "./ttm";
import { buildTearsheetFiles, writeTearsheetFiles } from "./emit";
import { mapStatements } from "../map/statements";
import { mapQuote } from "../map/quote";
import { mapAnalysts } from "../map/analysts";

const facts = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-companyfacts.json", "utf8"));
const yraw = JSON.parse(readFileSync("lib/facts/free/__fixtures__/lly-quotesummary.json", "utf8"));

describe("buildTearsheetFiles → real mappers (shape parity)", () => {
  const sec = parseCompanyFacts(facts);
  const yahoo = parseQuoteSummary(yraw, { latestFY: sec.annual.at(-1)!.fiscal_year });
  const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield });
  const files = buildTearsheetFiles({ cik: 59478, sec, yahoo, ttm, capturedAt: "2026-09-16T12:00:00Z" });

  it("writes the three files and mapStatements reads them without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lly-free-"));
    // fmp-peers.json is needed by mapAnalysts; write a minimal one
    writeFileSync(join(dir, "fmp-peers.json"), JSON.stringify([{ symbol: "MRK" }, { symbol: "PFE" }]));
    writeTearsheetFiles(dir, files);
    const s = mapStatements(dir);
    expect(s.statements.fiscalYears.length).toBeGreaterThanOrEqual(3);
    expect(s.latestQuarter.revenue).toBeGreaterThan(0);
    expect(s.ttm.grossMargin === null || s.ttm.grossMargin! > 0).toBe(true);
  });

  it("mapQuote and mapAnalysts read the tearsheet without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lly-free-"));
    writeFileSync(join(dir, "fmp-peers.json"), JSON.stringify([{ symbol: "MRK" }]));
    writeTearsheetFiles(dir, files);
    const q = mapQuote(dir);
    expect(q.quote.price).toBeGreaterThan(0);
    expect(q.quote.week52High).toBeGreaterThan(q.quote.week52Low);
    const a = mapAnalysts(dir, sec.annual.at(-1)!.fiscal_year);
    expect(a.analysts.consensusTarget).toBeGreaterThan(0);
    expect(a.estimates.nextFY.label).toMatch(/^FY\d\dE$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/facts/free/emit.test.ts`
Expected: FAIL ("Cannot find module './emit'").

- [ ] **Step 3: Write the implementation** (`lib/facts/free/emit.ts`)

- `buildTearsheetFiles(input)`:
  - `statementsAnnual = { fundamentals: { income_statement: incomeRows(annual), balance_sheet: balanceRows(annual), cash_flow: cashflowRows(annual) } }` where each `*Rows` maps a `SecPeriod` to `{ fiscal_period, fiscal_year, report_date, ...only that statement's fields }` (income: revenue, gross_profit, operating_income, ebitda, net_income, eps_diluted; balance: cash_and_short_term_investments, total_debt, net_debt, total_equity, total_current_assets, total_current_liabilities; cash_flow: operating_cash_flow, capex, common_stock_repurchased, common_dividends_paid, free_cash_flow).
  - `statementsQuarter = { fundamentals: { income_statement: quarter.map(p => ({ fiscal_period, fiscal_year, report_date, revenue, operating_income })) } }`.
  - `tearsheetAnnual = { company_overview: { company_name: yahoo.companyName, exchange: yahoo.exchange, cik: input.cik, description: yahoo.description, price: yahoo.price, market_cap: yahoo.marketCap, timestamp: input.capturedAt }, price_performance: { current_market: { year_low: yahoo.week52Low, year_high: yahoo.week52High } }, analyst_data: { price_targets: { target_consensus: yahoo.targets.consensus, target_median: yahoo.targets.median, target_high: yahoo.targets.high, target_low: yahoo.targets.low }, ratings: { strong_buy: yahoo.ratings.strong_buy, buy: yahoo.ratings.buy, hold: yahoo.ratings.hold, sell: yahoo.ratings.sell, strong_sell: yahoo.ratings.strong_sell, consensus: yahoo.ratings.consensus }, as_of_utc_timestamp: input.capturedAt }, estimates: { records: estimateRecords(yahoo.estimates) }, fundamentals: { key_metrics: [input.ttm.keyMetrics], ratios: [input.ttm.ratios] }, revenue_segmentation: { product: {}, geographic: {} } }`.
  - `estimateRecords(estimates)`: for each `{ fiscal_year, sales, eps }`, emit two rows: `{ metric: "SALES", fiscal_year, fiscal_period: "FY", estimate_mean: sales }` and `{ metric: "EPS", fiscal_year, fiscal_period: "FY", estimate_mean: eps }` (omit a row whose value is null).
- `writeTearsheetFiles(dir, files)`: `writeFileSync(join(dir, name), JSON.stringify(obj))` for the three filenames `bigdata-statements-annual.json`, `bigdata-statements-quarter.json`, `bigdata-tearsheet-annual.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/facts/free/emit.test.ts`
Expected: PASS — the real mappers read the emitted files. If a mapper throws "Missing X", the emit shape is wrong: fix emit to match the field the mapper names (do not change the mapper).

- [ ] **Step 5: Commit**

```bash
git add lib/facts/free/emit.ts lib/facts/free/emit.test.ts
git commit -m "Emit tearsheet-shaped files from the free fact source, proven against the real mappers"
```

---

## Task 5: CLI command + npm script

**Files:**
- Create: `scripts/facts-free.ts`
- Modify: `package.json` (add the `facts:free` script line)
- Test: `scripts/facts-free.test.ts` (thin — argument handling only)

**Interfaces:**
- Consumes: `fetchCompanyFacts`, `parseCompanyFacts` (`../lib/facts/free/sec`), `fetchQuoteSummary`, `parseQuoteSummary` (`../lib/facts/free/yahoo`), `computeTtm` (`../lib/facts/free/ttm`), `buildTearsheetFiles`, `writeTearsheetFiles` (`../lib/facts/free/emit`), `requireContact` (`./_env`), `resolveCik` (`../lib/edgar/tickers`).
- Produces: a CLI; no exported API.

- [ ] **Step 1: Add the npm script** (`package.json`, in `scripts`, next to `facts:build`)

```json
"facts:free": "node --env-file-if-exists=.env.local --import tsx scripts/facts-free.ts",
```

- [ ] **Step 2: Write the CLI** (`scripts/facts-free.ts`)

```ts
import { join } from "node:path";
import { requireContact } from "./_env";
import { resolveCik } from "../lib/edgar/tickers";
import { fetchCompanyFacts, parseCompanyFacts } from "../lib/facts/free/sec";
import { fetchQuoteSummary, parseQuoteSummary } from "../lib/facts/free/yahoo";
import { computeTtm } from "../lib/facts/free/ttm";
import { buildTearsheetFiles, writeTearsheetFiles } from "../lib/facts/free/emit";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:free -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const contact = requireContact();

const { cik } = await resolveCik(ticker, contact);
const facts = await fetchCompanyFacts(cik, contact);
const sec = parseCompanyFacts(facts);
if (sec.annual.length < 3) { console.error(`Only ${sec.annual.length} annual periods from SEC for ${ticker}; need ≥3.`); process.exit(1); }
const latestFY = sec.annual.at(-1)!.fiscal_year;

const yraw = await fetchQuoteSummary(ticker);          // throws loudly on crumb/HTTP failure
const yahoo = parseQuoteSummary(yraw, { latestFY });
const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield });

const dir = join("data", "raw", ticker, accession);
const files = buildTearsheetFiles({ cik, sec, yahoo, ttm, capturedAt: new Date().toISOString() });
writeTearsheetFiles(dir, files);
console.log(`Wrote 3 free tearsheet files to ${dir}\n  ${yahoo.companyName} · price ${yahoo.price} · ${sec.annual.length} FY · ${sec.quarter.length} quarters · target ${yahoo.targets.consensus}`);
```

- [ ] **Step 3: Write a thin arg test** (`scripts/facts-free.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("facts:free CLI", () => {
  it("exits 2 with usage when args are missing", () => {
    try {
      execFileSync("node", ["--import", "tsx", "scripts/facts-free.ts"], { stdio: "pipe" });
      throw new Error("should have exited non-zero");
    } catch (e: any) {
      expect(e.status).toBe(2);
      expect(String(e.stderr)).toContain("usage: npm run facts:free");
    }
  });
});
```

- [ ] **Step 4: Run the arg test + full suite**

Run: `npx vitest run scripts/facts-free.test.ts` then `npx vitest run`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add scripts/facts-free.ts scripts/facts-free.test.ts package.json
git commit -m "Add facts:free CLI wiring the SEC+Yahoo free fact source"
```

---

## Task 6: End-to-end validation on LLY (no new code)

**Files:** none (verification task; unblocks the real LLY run).

- [ ] **Step 1: Run the free capture for LLY**

Run: `npm run facts:free -- LLY 0000059478-26-000081`
Expected: "Wrote 3 free tearsheet files…" with a plausible price (~$1,230) and target.

- [ ] **Step 2: Confirm the capture is complete**

Run: `npm run facts:manifest -- LLY 0000059478-26-000081 --check`
Expected: "All N raw files present" (phase-1 files were already captured; the three tearsheet files now exist).

- [ ] **Step 3: Build the FactPack**

Run: `npm run facts:build -- LLY 0000059478-26-000081`
Expected: "Wrote data/facts/LLY/…json · Eli Lilly … · price ~1230 · N closes · M provenance rows". Inspect `data/facts/LLY/0000059478-26-000081.json`: statements populated, `ttm` ratios present, `analysts` targets present, `estimates.nextFY`/`followingFY` present, `segments` = one "Consolidated" line (v1 fallback).

- [ ] **Step 4: Run the full suite once more**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit the resulting FactPack is deferred to the synthesis run** — do not commit `data/facts/LLY` here; the LLY report run (capture + publish commits) owns it. This task only proves the free source works end-to-end.

---

## Notes for the executor

- After all tasks: hand back to the human for the LLY **synthesis** run (author judgment → editorial review → publish → screenshot → merge/push gate). That is the existing report workflow, not part of this plan.
- If Yahoo's crumb flow is dead at run time (Yahoo changed it), Task 6 Step 1 will throw the clear error by design; that is a correct outcome, not a bug in this code — report it and fall back to topping up Bigdata for the immediate LLY run.
