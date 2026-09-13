# Juniper Research — Fact Pipeline Design

**Date:** 2026-09-12
**Status:** Approved, ready for implementation planning
**Subsystem:** 2 of 5 (filing detection + fact fetching)
**Depends on:** subsystem 1 (render site), merged to `main` at `6b3ca7a`

---

## Context

Subsystem 1 renders a validated `Report` JSON into the research page. The
`Report` contract splits into facts (raw numbers pulled deterministically) and
judgment (the analyst's prose and calls, written by a model). Subsystem 2 is
the first two steps of the README's pipeline: **detect** a new 10-Q or 10-K for
a watched company, then **fetch the facts** that a report needs — and hand them
to subsystem 3 (synthesis) as a single, validated object.

Which `Report` fields are facts, and therefore this subsystem's output:

| Facts (this subsystem) | Judgment (subsystem 3) |
|---|---|
| `meta.filing`, `quote`, the numbers in `analystSentiment`, the three `financials` tables, the company's columns in `valuation.multiples`, `businessMoat.segments[].{revenue, sharePct}`, `geoMix`, the `snapshot` values, and the ~30 daily closes for the chart's history line | `rating`, thesis, scenarios (prices and probabilities), all prose, `moatRating`, peer *selection* for the multiples table, company-specific snapshot cells |

Subsystem 3 also needs prose *context* — business description, MD&A and
risk-factor language from the filing, transcript highlights. This subsystem
fetches that too, bounded and tagged, so that subsystem 3 becomes a pure
function `FactPack → Report` with no data-source I/O of its own.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Data access through the Claude **MCP connectors** (FMP, Bigdata.com), not API keys | No keys in hand; the connectors already authenticate via the Claude account. **Recorded debt:** unattended or scheduled runs need FMP and Bigdata.com API keys and a REST implementation of the `FactSource` seam (see §9). |
| 2 | Detection is **plain code** against EDGAR's `submissions` API, driven by a watchlist file | Keyless, authoritative, deterministic, testable offline; survives the migration in decision 1 untouched. |
| 3 | A FactPack carries **numbers plus bounded prose context**, each with provenance | Subsystem 3 needs both; putting every connector call in one subsystem makes the migration a one-subsystem job. |
| 4 | **Raw capture in a skill, all mapping in code** | The model's job is "call tool X with params Y, save the response verbatim as file Z." Every rule with judgment in it — mapping, validation, projection — is a tested pure function over saved raw files. The prompt contains no logic that can drift. |
| 5 | Filing excerpts (MD&A, Risk Factors) come from **EDGAR's primary document**, not Bigdata | The URL is known from detection, keyless; section extraction is deterministic and testable against a saved HTML fixture. Bigdata supplies what EDGAR cannot: transcript highlights and headlines. |
| 6 | Raw captures are **committed** | ~150KB per filing. They are the mapping's regression fixtures and the provenance record; the README already treats git as the archive. |
| 7 | The `Report` schema gains optional `quote.history` and moves to **1.1.0** | Subsystem 1 left the chart's history line as a labelled placeholder for this subsystem to fill. Additive: 1.0.0 files still parse. |

### On decision 4

The alternative — instructing the model to build the FactPack directly from
tool responses — puts every mapping rule in prose, where the model can silently
round, reorder, or "helpfully" fill a gap. That is the exact failure the whole
project was designed against. Under decision 4 the model never sees a mapping
rule; it copies. If the raw files are wrong, the build fails naming the file.

An Agent SDK script was considered and rejected: the FMP and Bigdata.com
connectors attached to Claude sessions are claude.ai-hosted and account-bound;
reproducing their auth in an SDK config is the API-key problem decision 1 defers.

## Architecture

```
data/
  edgar/watchlist.json             [{ "ticker": "AVGO", "cik": 1730168 }]
  edgar/seen.json                  { "AVGO": ["0001730168-26-000080", …] }
  raw/<ticker>/<accession>/        verbatim tool responses — written by the skill
  facts/<ticker>/<accession>.json  the FactPack — written by code
lib/
  edgar/
    tickers.ts        resolveCik(ticker): fetches sec.gov/files/company_tickers.json
    submissions.ts    fetchSubmissions(cik) → Filing[]   (10-Q / 10-K only)
    filing-text.ts    fetchPrimaryDocument(url) → { mda, riskFactors }  (capped)
    detect.ts         detectNew(watchlist, seen) → NewFiling[]
  facts/
    schema.ts         FactPack Zod contract, SCHEMA_VERSION "1.0.0"
    manifest.ts       the fixed list of tool calls and their raw filenames
    source.ts         FactSource interface — the REST seam
    map/
      quote.ts  statements.ts  segments.ts  analysts.ts  history.ts  context.ts
    build.ts          raw dir → map → validate → write FactPack
    validate.ts       consistency rules
    project.ts        FactPack → ReportFacts (the numeric subset of Report)
scripts/
  detect.ts          npm run detect                    prints new filings; marks them seen
  watchlist-add.ts   npm run watchlist:add AVGO        resolves CIK, appends
  facts-prepare.ts   npm run facts:prepare AVGO <acc>  code-fetched raw files + capture.json
  facts-manifest.ts  npm run facts:manifest AVGO <acc> [--check]  prints/checks the manifest
  facts-build.ts     npm run facts:build AVGO <acc>    raw → FactPack, or fails loudly
  facts-diff.ts      npm run facts:diff  AVGO <acc>    projected values vs data/avgo.json
  report-history.ts  npm run report:history AVGO <acc> copies real closes into the report
.claude/skills/fetch-facts/SKILL.md   the capture recipe; reads manifest.ts
```

Every path above is a real file. Nothing in `lib/` performs network I/O except
`lib/edgar/*`; the connectors are reached only through the skill.

## The watcher

**`tickers.ts`** — `resolveCik(ticker)` fetches `https://www.sec.gov/files/company_tickers.json`
(≈800KB, keyless) and returns the `cik_str` for the ticker, or throws naming the
ticker. It runs once, at `watchlist:add` time, so detection never needs the map.

**`submissions.ts`** — `fetchSubmissions(cik)` GETs
`https://data.sec.gov/submissions/CIK{cik padded to 10}.json` with the header
`User-Agent: juniresearch/<version> (<contact email>)` that SEC requires, and a
10-request-per-second ceiling enforced by a small delay when called in a loop.
The response's `filings.recent` is columnar (`form[]`, `accessionNumber[]`,
`filingDate[]`, `reportDate[]`, `primaryDocument[]`, …, ~990 entries). The
function zips those arrays into

```ts
Filing { form: "10-Q" | "10-K"; accession: string; filedDate: string;
         periodEnd: string; primaryDocument: string; url: string }
```

keeping only `10-Q` and `10-K`. `url` is
`https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/<primaryDocument>`.
Non-200 or malformed responses throw naming the URL.

**`detect.ts`** — `detectNew(filingsByTicker, seen, limit = 4): NewFiling[]` where
`NewFiling = Filing & { ticker: string }`. It returns, per ticker, the newest
`limit` previously-unseen filings (accession not in `seen[ticker]`). It is pure;
the CLI does the fetching, prints only those filings, and marks **every**
fetched 10-Q/10-K seen — not just the reported ones — rewriting `seen.json`
with the full set of accessions from this run.

**`filing-text.ts`** — `fetchPrimaryDocument(url)` GETs the filing HTML (same
header), strips tags to text, and extracts two sections by their Item headings:
Item 2 (10-Q) / Item 7 (10-K) "Management's Discussion and Analysis", and
Item 1A "Risk Factors". The MD&A excerpt is capped at 16,000 characters and
Risk Factors at 8,000, both cut at a sentence boundary; `extractSections`
returns `{ text, truncated }` per section. Headings are matched
case-insensitively with the item number as anchor; a section not found yields
`null`, never a guess.

## The FactPack contract

```ts
FactPack {
  schemaVersion: "1.0.0";
  ticker: string; cik: number; company: string; exchange: string;
  filing: { form; accession; filedDate; periodEnd; url };
  capturedAt: string;                                   // ISO instant of the raw capture

  quote: { price; marketCap; sharesOutstanding; week52Low; week52High;
           dividendYield; asOf };                       // dividendYield is a ratio

  statements: {
    fiscalYears: string[];                              // ["FY21", …, "FY25"], oldest first
    income:  StatementRow[];                            // revenue, grossProfit, operatingIncome,
    balance: StatementRow[];                            //   ebitda, netIncome, epsDiluted, …
    cashflow: StatementRow[];                           // each { key, label, values: number[] }
  };
  latestQuarter: { label: string; periodEnd; revenue; operatingMargin; revenueYoY };
  ttm: { pe; ps; evToEbitda; grossMargin; operatingMargin; netMargin };
  estimates: { nextFY: { label; revenue; eps }; followingFY: { label; revenue; eps } };
  analysts: { count; buy; hold; sell; consensusRating; consensusTarget;
              medianTarget; highTarget; lowTarget; asOf };
  segments: { basis: string; items: { name; revenue; share }[] };
  geoMix:   { basis: string; items: { region; share }[] };
  peers:    { ticker; pe; ps; evToEbitda }[];          // tickers from FMP peers; multiples null until a peer source exists
  history:  { date: string; close: number }[];         // ascending, trailing ~30 trading days

  context: {
    description:          Excerpt;                     // FMP profile
    mdaExcerpt:           Excerpt | null;               // EDGAR
    riskFactorsExcerpt:   Excerpt | null;               // EDGAR
    transcriptHighlights: Excerpt | null;               // Bigdata search
    headlines:            Excerpt[];                    // Bigdata search, ≤ 10
  };
  provenance: { field: string; source: "fmp" | "bigdata" | "edgar";
                endpoint: string; capturedAt: string }[];
}
Excerpt { text: string; source: string; url?: string; asOf: string; truncated?: boolean }
```

Same discipline as the Report: numbers are numbers, ratios are ratios, nothing
is pre-formatted. Every field that a `Report` fact derives from has a
provenance entry, so subsystem 3 can cite.

## Raw capture — the manifest and the skill

`manifest.ts` is the single source of truth for what gets captured: an array of
`{ name, server, tool, params }` where `params` may reference `ticker`,
`periodEnd`, `today`, and — for the peer entries — the peers list captured
earlier in the same run. Adding a data point is a code change here, not a
prompt edit.

The captures, with the raw filename each produces:

*Superseded 2026-09-12 by the revision at the end of this document (decision 8): the manifest is now eight Bigdata/FMP calls plus three code-fetched files.*

| # | Server · tool · endpoint | Params | Raw file |
|---|---|---|---|
| 1 | FMP `company` · `profile-symbol` | ticker | `fmp-profile.json` |
| 2 | FMP `quote` · `quote` | ticker | `fmp-quote.json` |
| 3 | FMP `statements` · `income-statement` | ticker, annual, limit 5 | `fmp-income-annual.json` |
| 4 | FMP `statements` · `balance-sheet-statement` | ticker, annual, limit 5 | `fmp-balance-annual.json` |
| 5 | FMP `statements` · `cashflow-statement` | ticker, annual, limit 5 | `fmp-cashflow-annual.json` |
| 6 | FMP `statements` · `income-statement` | ticker, quarter, limit 8 | `fmp-income-quarter.json` |
| 7 | FMP `statements` · `key-metrics-ttm` | ticker | `fmp-key-metrics-ttm.json` |
| 8 | FMP `statements` · `metrics-ratios-ttm` | ticker | `fmp-ratios-ttm.json` |
| 9 | FMP `statements` · `revenue-product-segmentation` | ticker, annual | `fmp-segments-product.json` |
| 10 | FMP `statements` · `revenue-geographic-segments` | ticker, annual | `fmp-segments-geo.json` |
| 11 | FMP `analyst` · `price-target-consensus` | ticker | `fmp-target-consensus.json` |
| 12 | FMP `analyst` · `price-target-summary` | ticker | `fmp-target-summary.json` |
| 13 | FMP `analyst` · `grades-summary` | ticker | `fmp-grades-summary.json` |
| 14 | FMP `analyst` · `financial-estimates` | ticker, annual | `fmp-estimates.json` |
| 15 | FMP `chart` · `historical-price-eod-light` | ticker, from = periodEnd − 45d, to = today | `fmp-history.json` |
| 16 | FMP `company` · `peers` | ticker | `fmp-peers.json` |
| 17–20 | FMP `statements` · `key-metrics-ttm` | each of the first four peers in FMP's response order | `fmp-peer-<TICKER>-ttm.json` |
| 21 | Bigdata `find_securities` | query = ticker | `bigdata-entity.json` |
| 22 | Bigdata `company_tearsheet` | rp_entity_id, company_type, quarter, sections: company_overview, analyst_ratings, revenue_segmentation | `bigdata-tearsheet.md` |
| 23 | Bigdata `bigdata_search` | "<company> latest earnings call key points" | `bigdata-transcript.md` |
| 24 | Bigdata `bigdata_search` | "<company> news since <periodEnd>" | `bigdata-headlines.md` |

The two EDGAR items — the submissions record and the primary document — are
fetched by code (`facts:build` calls `lib/edgar`), not by the skill, and saved
alongside as `edgar-filing.json` and `edgar-primary.html`.

**`.claude/skills/fetch-facts/SKILL.md`** instructs the agent to: take a ticker
and accession; create `data/raw/<ticker>/<accession>/`; for each manifest entry
call exactly that tool with exactly those params and write the response
verbatim to the named file (JSON responses as returned, Markdown responses as
returned — no reformatting, no summarising, no omitting fields); then run
`npm run facts:build <ticker> <accession>` and report its output. The skill
contains no mapping rule and no number. If a tool call fails, the agent saves
the error text to `<name>.error.txt` and continues; `facts:build` then fails
naming the missing file.

## Mapping, validation, projection

**`map/*.ts`** — one pure function per raw file family, each typed against the
raw shape it reads and returning the FactPack section it owns:

- `quote.ts` — `fmp-quote.json` + `fmp-profile.json` → `quote`, `company`, `exchange`
- `statements.ts` — the three annual files → `statements` (rows keyed
  `revenue`, `grossProfit`, `operatingIncome`, `ebitda`, `netIncome`, `epsDiluted`,
  `cashAndInvestments`, `totalDebt`, `netDebt`, `totalEquity`, `currentRatio`,
  `operatingCashFlow`, `freeCashFlow`, `fcfMargin`); the quarterly file →
  `latestQuarter`; the TTM files → `ttm`
- `segments.ts` — product and geographic files → `segments`, `geoMix` (shares
  computed from revenue; basis = the fiscal year label)
- `analysts.ts` — consensus, summary, grades, estimates → `analysts`, `estimates`;
  peers + peer TTM files → `peers`
- `history.ts` — `fmp-history.json` → `history`, ascending, trimmed to the
  trailing 30 trading days ending on or before `capturedAt`
- `context.ts` — profile description, EDGAR excerpts, Bigdata markdown → `context`

Each mapper throws on an empty array, an error object, or a missing key it
requires, naming the file and key.

**`validate.ts`** — after Zod, these rules, each reporting field and value:

- `statements.fiscalYears` has five consecutive years, oldest first, and every
  row has exactly five values
- segment shares sum to 1 ± 0.02; geo shares likewise
- `analysts.buy + hold + sell === count`
- `history` is strictly ascending by date, has ≥ 20 points, last date ≤ `capturedAt`
- `filing.accession` equals the raw directory name
- `latestQuarter.periodEnd === filing.periodEnd`

**`project.ts`** — `projectReportFacts(pack): ReportFacts` where `ReportFacts` is
the numeric subset of `Report` (`meta.filing`, `quote` including `history`,
`analystSentiment` minus `commentary`, the three `financials` tables, the
company's columns of `valuation.multiples`, `segments`, `geoMix`, and the
generic `snapshot` below). The financial tables' display rows "YoY Growth",
"Gross Margin" and "FCF Margin" are derived at projection from full-precision
`revenue`, `grossProfit` and `freeCashFlow`, per the README's convention.

The generic snapshot is exactly these sixteen cells, in this order, each built
by `format.ts` rules from FactPack fields: Current Price · Market Cap (approx) ·
52-Week Range (raw) · Shares Outstanding (approx) · P/E (TTM) · Consensus Target
(+ upside change) · EV/EBITDA (TTM) · Analyst Consensus (raw "Buy (54 B / 6 H /
0 S)") · <FY> Revenue (+ YoY) · <FY> Net Income · <FY> Diluted EPS · <FY+1>E
Revenue (approx, + YoY) · <latest quarter> Revenue (+ YoY) · <latest quarter>
Operating Margin · Fwd P/E (<FY+2>E, approx) · Dividend Yield. Company-specific
cells (the fixture's "Q3'26 AI Semis", "FY26E AI Revenue (guided)") are
subsystem 3's to add.

**Parity.** `npm run facts:diff AVGO 0001730168-26-000080` projects the FactPack
and compares it to `data/avgo.json` **at the formatted-string level** through
`lib/format.ts` — `"63.9"` against `"63.9"` — because the fixture stores rounded
billions and the reader sees strings. In the test suite, the five-year statement
rows are asserted equal; quote, target and estimate fields, which drift daily,
are printed by the CLI but not asserted.

## The history line

`lib/report.schema.ts` gains

```ts
quote: { …, history: z.array(z.object({ date: z.string(), close: z.number() })).optional() }
```

and `SCHEMA_VERSION` becomes `"1.1.0"`. `buildChartModel` carries
`history: HistoryPoint[]` and `placeholder: boolean` on `ChartModel` — built once,
from `quote.history` when it has ≥ 2 points, from the synthetic wave otherwise.
`ProjectionChart` and `EquityReport` read those fields instead of each calling
`historySeries()`. The "history line is indicative" caption renders only when
`placeholder` is true. `data/avgo.json` is backfilled with the FactPack's
history so the live page shows Broadcom's actual trailing month; its
`schemaVersion` becomes `1.1.0`.

## Error handling

- EDGAR: non-200, non-JSON, or a ticker absent from the map → throw naming the URL or ticker.
- Capture: a tool failure is saved as `<name>.error.txt`; `facts:build` fails
  naming every manifest entry without a raw file, so a partial capture can never
  produce a FactPack.
- Mapping: empty array, error object, or missing required key → throw naming the file and key.
- Validation: every failing rule listed with field and value, same shape as
  subsystem 1's `validate.ts`; the FactPack is not written.
- Detection marks every fetched filing seen after the run prints the new ones.

## Testing

Vitest, the existing harness (`npm test`, pristine output).

- **EDGAR** — `submissions.ts` against a saved fixture trimmed to twenty recent
  entries (Broadcom's real record, captured 2026-09-12); `tickers.ts` against a
  ten-entry slice of the map; `filing-text.ts` against the saved AVGO 10-Q HTML,
  asserting both sections are found, capped, and cut at a sentence boundary;
  `detect.ts` with synthetic seen-state (nothing new; one new; unknown ticker).
  Network calls are behind a `fetch` parameter so tests inject the fixture.
- **Mapping** — golden tests: `map(rawFixture) → expected FactPack section`,
  using the committed AVGO raw capture. Every mapper has a "throws on empty
  response" case.
- **Validation** — a passing FactPack, then one mutation per rule.
- **Projection** — parity of the fixture's fifteen financial-table display rows
  (seven income, five balance, three cash-flow, including the three derived
  rows) against `avgo.json` through `format.ts`.
- **History** — geometry with real points: `placeholder === false`, last point
  equals the last close; render test: caption absent when history is present,
  present when it is not.
- **Skill** — the manifest has a test asserting every entry names a file some
  mapper reads, and every file a mapper reads is produced by an entry.

## Dependencies

No new runtime dependencies. `zod` for the schema; Node's global `fetch`; a
small HTML-to-text step in `filing-text.ts` written by hand (tag stripping and
entity decoding — the filing HTML is simple), not a parser library.

The `scripts/*.ts` CLIs run via `tsx` (a dev dependency): `node --env-file-if-exists=.env.local --import tsx scripts/<name>.ts`, wrapped by `package.json` scripts. Node's native type stripping was rejected because it requires `.ts` extensions on relative imports, which the Next `tsconfig` does not allow.

## Revision 2026-09-12 — data sourcing after the first capture

The first execution of the manifest (Task 6) found that **the FMP connector's plan
tier gates `quote`, `statements`, `analyst`, and `chart`**; only `company` is
open. Probing the alternatives produced these facts, verified from the controller
session against Broadcom's record:

- Bigdata.com's `bigdata_company_tearsheet` returns the same FMP data
  (`source.provider_id: "FMP"`), as JSON: quote, 52-week range, market cap,
  analyst targets and ratings, FY estimates, product and geographic segments
  FY21–FY25, five years of ratios, TTM key metrics, and **full income, balance
  and cash-flow statements by year and by quarter**. Every value matched
  `data/avgo.json`.
- Yahoo's v8 chart endpoint is keyless and returns daily closes (unofficial;
  needs a browser-like `User-Agent`).
- SEC XBRL `companyfacts` is keyless and authoritative but has the
  fiscal-year-means-filing-year trap and no EBITDA or normalized debt.
- Stooq sits behind a JavaScript challenge.

**Decision 8 — re-source without new spend.** The manifest becomes seven tool
calls: FMP `company` for peers; Bigdata `find_securities`, three
`bigdata_company_tearsheet` calls (annual: overview, analyst ratings,
estimates, key metrics, ratios, segmentation; annual `financial_statements`;
quarterly `financial_statements`), and the two `bigdata_search` calls. Code
fetches `edgar-filing.json`, `edgar-primary.html`, and `yahoo-history.json`
(`lib/prices/yahoo.ts`, the second permitted network module beside `lib/edgar/`).
Peer multiples are not captured; `peers[]` carries tickers with null multiples
until a peer source exists. `sharesOutstanding` is derived as
`marketCap / price` from the tearsheet's overview, with provenance saying so.
The FactPack schema is unchanged except `provenance.source` gains `"yahoo"`.
SEC XBRL is parked as a later hardening pass. The MD&A excerpt cap is 16,000
characters (Risk Factors 8,000) and `extractSections` returns
`{ text, truncated }` per section. Transcript highlights are capped at 16,000
characters (raised 2026-09-13 after the Oracle run showed the call's headline
figures sit past 8,000). The watchlist lives at
`data/edgar/watchlist.json`. CLIs run via `tsx`.

The manifest table and mapping section above are superseded by the plan's
revised Tasks 6–11, which carry the captured response shapes verbatim.

## Revision 2026-09-13 — after the Oracle comparison

Running the pipeline against Oracle's real 10-Q and 10-K (rather than only
Broadcom's) surfaced three gaps neither the design nor the first capture had
exercised. The schema moves to **FactPack 1.1.0**.

**Cover-page shares outstanding.** ORCL's vendor-derived `sharesOutstanding`
(`marketCap / price`, ≈2.88B) diverged materially from the actual cover-page
count (3,023,736,000) — a derived figure is only as fresh as the vendor's own
price/cap snapshot. `filing-text.ts` gains `extractCoverShares(text)`, reading
the primary document's cover-page "... shares outstanding as of ..." line;
`lib/facts/map/cover.ts` (`mapCover`) wraps it against `edgar-primary.html`,
and `build.ts` prefers the cover count over the vendor's whenever one is
found, recording the winner as `quote.sharesSource: "cover" | "derived"`.
`project.ts`'s "Shares Outstanding" snapshot cell is `approx` only when the
source is `"derived"`.

**Two more EDGAR documents.** `facts:prepare` (`scripts/facts-prepare.ts`) now
also discovers the earnings press release: the newest item-2.02 8-K filed on
or before the filing (`findEarningsRelease`, `lib/edgar/submissions.ts`), its
exhibit 99.1 resolved from that filing's own index (`fetchFilingIndex` +
`exhibit99Url`) and saved as `edgar-press-release.html`. Neither the 8-K nor
an ex-99.1 exhibit is guaranteed to exist — when discovery comes up empty,
`facts:prepare` writes `edgar-press-release.missing` (the reason, as text)
instead of failing the capture. For a 10-Q, `facts:prepare` also fetches the
prior 10-K's primary document as `edgar-10k-primary.html`
(`findLatestAnnual`) — read only to arbitrate the Risk Factors excerpt below.
`edgar-filing.json` gains `pressRelease` and `annualReport` records
(`{ accession, filedDate, url } | null`).

`lib/facts/manifest.ts` names both new files: `edgar-press-release.html`
joins `CODE_FETCHED_FILES` (required by `--check`, but the `.missing` marker
satisfies the requirement in its place); `edgar-10k-primary.html` is the new
`OPTIONAL_FILES` — captured only for a 10-Q, read when present, never
required.

**The longer Risk Factors wins.** A 10-Q's own Item 1A is often a thin
cross-reference to the prior 10-K ("see our Annual Report"). The first cut
compared the two documents' already-capped excerpts and picked the longer
one — but both candidates routinely exceed the cap, so their capped lengths
collapse to near-identical values and the sentence-boundary cut point decides
the winner instead of which document actually says more (caught on AVGO:
94,265 vs 90,270 raw characters, 7,880 vs 7,869 capped — an inversion risk).
`filing-text.ts` now exposes `extractRawSections` (uncapped) underlying
`extractSections`; `context.ts` compares the *raw* candidate lengths — the
10-Q's own Item 1A against the 10-K's, when a 10-K was captured — and caps
only the winner. `context.riskFactorsSource: "10-Q" | "10-K" | null` records
which document won.

**FactPack 1.1.0 fields** (additive over 1.0.0):
- `quote.sharesSource: "cover" | "derived"`
- `ttm.netDebtToEbitda`, `ttm.interestCoverage`, `ttm.fcfYield`,
  `ttm.currentRatio` — nullable, from the tearsheet's TTM `key_metrics` /
  `ratios`
- `context.pressRelease: Excerpt | null` (source `"edgar:8-K ex-99.1"`,
  capped at the new `PRESS_CAP` = 16,000 characters) and
  `context.riskFactorsSource: "10-Q" | "10-K" | null`
- `statements.cashflow` gains `buybacks` ("Share Repurchases") and
  `dividends` ("Dividends Paid") rows, both optional (a company that neither
  repurchases nor pays a dividend reports null, not zero)

`project.ts` adds an "Operating Margin" row to the income table (right after
"Operating Income ($B)") and expands the cash-flow table to Operating Cash
Flow, Capital Expenditure, Share Repurchases, Dividends Paid, Free Cash Flow,
FCF Margin. `ReportFacts.highlightCells` (`lib/facts/highlights.ts`) exposes
eleven fact-derived Snapshot cells — FCF, capex, net debt, total debt,
buybacks, dividends at the latest FY, plus TTM net-debt/EBITDA, interest
coverage, FCF yield, current ratio, and latest-FY gross margin — each present
only when its underlying figure is non-null. See the synthesis spec's
"Highlight cells" section for how the model selects among them.

## Out of scope

- Scheduling and unattended runs — blocked on the API-key migration (decision 1)
- The REST implementation of `FactSource` — the interface is defined, only the
  manifest/skill path is built
- The synthesis model call and the Zod re-prompt loop (subsystem 3)
- PDF, publishing, ISR (subsystems 4–5)
- Any second data vendor, XBRL parsing, or as-reported statements

## The FactSource seam (for the migration)

```ts
interface FactSource {
  capture(ticker: string, filing: Filing, outDir: string): Promise<void>;
}
```

The skill is the current implementation in prose: it produces the raw directory.
A future `RestFactSource` produces the same files from the same manifest using
API keys. `build.ts` reads the directory and does not know which wrote it.
