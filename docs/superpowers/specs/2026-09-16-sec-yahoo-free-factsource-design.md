# SEC + Yahoo Free Fact Source — Design

**Date:** 2026-09-16
**Status:** Approved design, pending spec review → implementation plan
**Author:** Nico (Juniper Finance Research Desk) with Claude

## Goal

Produce the three Bigdata.com tearsheet files a FactPack needs —
`bigdata-tearsheet-annual.json`, `bigdata-statements-annual.json`,
`bigdata-statements-quarter.json` — from **free** sources (SEC XBRL +
Yahoo Finance), so the fact pipeline no longer depends on metered
Bigdata.com credits for a company's fundamentals.

Triggered by a real incident: on 2026-09-16 Bigdata.com ran out of credits
mid-run (LLY), and those three phase-2 tearsheet calls returned
`{"outOfCredits": true}`, halting `facts:build`. See
`[[project-subsystem2-mcp-debt]]`.

## Architecture

**Shape-preserving adapter.** The downstream pipeline
(`lib/facts/build.ts`, every mapper under `lib/facts/map/`, the schema,
the validators, the report and synthesis layers) reads the capture
directory and only cares about the *shape* of those three JSON files. The
free source writes the same three filenames in the same shape; **nothing
downstream changes.**

```
facts:prepare (unchanged)          → edgar-*, yahoo-history.json, capture.json
facts:free  <TICKER> <ACCESSION>   → the 3 bigdata-*.json files (NEW, this design)
facts:manifest --check (unchanged) → "all raw files present"
facts:build (unchanged)            → data/facts/<T>/<A>.json
synthesize  (unchanged)            → data/<t>.json
```

`facts:free` replaces exactly the three tearsheet files. Every other raw
file (EDGAR filings, `yahoo-history.json`, `fmp-peers.json`, and — for a
Bigdata-captured run — `bigdata-entity.json`, `bigdata-transcript.json`,
`bigdata-headlines.json`) is produced as it is today. The FMP `peers`
call is not metered/blocked, so `fmp-peers.json` is unaffected.

**Phase-1 assumption.** `facts:free` replaces only the *phase-2* tearsheets.
It assumes the phase-1 files (`bigdata-entity.json`,
`bigdata-transcript.json`, `bigdata-headlines.json`, `fmp-peers.json`) are
already present from the connector capture — as they are for LLY, since only
the phase-2 calls hit the credit wall. `facts:manifest --check` still
requires `bigdata-entity.json` (it resolves `phase2Ready`), so a
partial-free/hybrid run is the v1 target. A fully connector-free capture
(transcript/headlines/entity from free sources too) is a follow-up.

**Known limitation — provenance labels.** Because the mappers hardcode
`source: "bigdata"` in their `PROVENANCE` arrays and `mapQuote` hardcodes
the description source as `"bigdata:company_tearsheet"`, a FactPack built
from SEC+Yahoo data will still *say* "bigdata" in its provenance rows and
description source. Shape parity buys us zero downstream changes at the cost
of this provenance inaccuracy. A proper fix — provenance that reflects the
real source — means touching the mappers and the `provenance` field, and is
a deliberate follow-up, not part of v1.

### Components (all new, under `lib/facts/free/`)

- **`sec.ts`** — fetch `https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json`
  (keyless, `User-Agent: EDGAR_CONTACT`), and turn it into annual and
  quarterly statement rows via the concept map and period-selection rules
  below. Owns concept-name variance and the derivations (EBITDA, total
  debt, net debt, FCF).
- **`yahoo.ts`** — the crumb flow (`fc.yahoo.com` cookie →
  `query1.finance.yahoo.com/v1/test/getcrumb` → `query2` `quoteSummary`),
  then parse `price`, `summaryDetail`, `financialData`, `earningsTrend`,
  `recommendationTrend`, `assetProfile` into quote, analyst, estimate, and
  description fields.
- **`ttm.ts`** — compute the TTM `key_metrics` and `ratios` rows from the
  last four SEC quarters plus the Yahoo price/market cap.
- **`emit.ts`** — assemble the parsed pieces into the exact three tearsheet
  shapes and write them.
- **`scripts/facts-free.ts`** — CLI orchestration: `npm run facts:free -- <TICKER> <ACCESSION>`.
  Resolves CIK from the watchlist, reads the price from `yahoo-history.json`
  or the Yahoo quote, runs sec + yahoo + ttm + emit.

## SEC concept map (us-gaap unless noted)

Each field lists concepts in priority order; the first present with a
usable value wins. All values in USD from `units.USD` (EPS from
`units.USD/shares`).

**Income statement (flow; duration-scoped):**
| Emitted field | XBRL concept(s) |
|---|---|
| `revenue` | RevenueFromContractWithCustomerExcludingAssessedTax → Revenues → RevenueFromContractWithCustomerIncludingAssessedTax → SalesRevenueNet |
| `gross_profit` | GrossProfit → (revenue − CostOfGoodsAndServicesSold\|CostOfRevenue) |
| `operating_income` | OperatingIncomeLoss |
| `net_income` | NetIncomeLoss |
| `eps_diluted` | EarningsPerShareDiluted (units USD/shares) |
| (D&A, for EBITDA) | DepreciationDepletionAndAmortization → DepreciationAmortizationAndAccretionNet → DepreciationAndAmortization (from cash-flow section) |
| (interest, for coverage) | InterestExpense → InterestExpenseNonoperating |
| `ebitda` | **derived**: operating_income + D&A |

**Balance sheet (instant; period-end):**
| Emitted field | XBRL concept(s) |
|---|---|
| `cash_and_short_term_investments` | CashCashEquivalentsAndShortTermInvestments → (CashAndCashEquivalentsAtCarryingValue + ShortTermInvestments) |
| (cash only, for net debt) | CashAndCashEquivalentsAtCarryingValue |
| `total_debt` | **derived**: (LongTermDebtNoncurrent → LongTermDebt) + (LongTermDebtCurrent → DebtCurrent) + (ShortTermBorrowings\|CommercialPaper, if present) |
| `net_debt` | **derived**: total_debt − cash only (matches vendor convention) |
| `total_equity` | StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest → StockholdersEquity |
| `total_current_assets` | AssetsCurrent |
| `total_current_liabilities` | LiabilitiesCurrent |

**Cash flow (flow; duration-scoped). Vendor sign convention: outflows negative.**
| Emitted field | XBRL concept(s) |
|---|---|
| `operating_cash_flow` | NetCashProvidedByUsedInOperatingActivities → …ContinuingOperations |
| `capex` | **−**(PaymentsToAcquirePropertyPlantAndEquipment → PaymentsToAcquireProductiveAssets) |
| `common_stock_repurchased` | **−**PaymentsForRepurchaseOfCommonStock |
| `common_dividends_paid` | **−**(PaymentsOfDividendsCommonStock → PaymentsOfDividends) |
| `free_cash_flow` | **derived**: operating_cash_flow + capex (capex already negative) |

Market cap and price come from Yahoo (below), so shares need not be mapped
from SEC; `mapQuote` derives `sharesOutstanding = market_cap / price`.

### Period selection (the XBRL "fy-means-filing-year" trap)

`companyfacts` unit entries carry `{start?, end, val, fy, fp, form, filed, frame?}`.
Do **not** trust `fy`/`fp` alone. Instead:

- **Annual rows:** keep entries with `form == "10-K"`. Flow concepts:
  require a duration `end − start` in ~[350, 380] days. Stock (balance)
  concepts: instant (`start` absent). Key each by `fiscalYear = year(end)`.
  On duplicates for a year, keep the one with the latest `filed`.
  `report_date = end`, `fiscal_period = "FY"`, `fiscal_year = year(end)`.
- **Quarterly rows:** keep `form == "10-Q"`, flow duration in ~[80, 100]
  days, `fiscal_period` = `Q{quarter-of(end)}`. Derive the missing **Q4**
  for flow concepts as `FY − (Q1 + Q2 + Q3)` of the same year; Q4 balance
  is the 10-K period-end instant. Key by `year(end)`.
- Emit newest-first is not required (mappers sort), but emit all aligned
  years/quarters available (the annual mapper keeps the last 5 and needs
  ≥ 3; the quarter mapper needs the latest quarter and its year-ago).
- Companies whose fiscal year ≠ calendar year still work: `fiscal_year`
  and `fiscal_period` derive from `end`, not from a hardcoded month.

## Yahoo quoteSummary map

Crumb flow (verified working 2026-09-16): GET `fc.yahoo.com` for a
`Set-Cookie`; GET `query1.finance.yahoo.com/v1/test/getcrumb` with that
cookie; GET `query2.finance.yahoo.com/v10/finance/quoteSummary/<T>?modules=...&crumb=<crumb>`
with the cookie. Browser `User-Agent`.

Modules: `price,summaryDetail,financialData,earningsTrend,recommendationTrend,assetProfile`.

| Tearsheet target | Yahoo source |
|---|---|
| `company_overview.price` | price.regularMarketPrice.raw |
| `company_overview.market_cap` | price.marketCap.raw |
| `company_overview.company_name` | price.longName / shortName |
| `company_overview.exchange` | price.exchangeName (normalize to e.g. "NYSE"/"NASDAQ") |
| `company_overview.cik` | from the watchlist entry (not Yahoo) |
| `company_overview.timestamp` | ISO now (capture time) |
| `company_overview.description` | assetProfile.longBusinessSummary |
| `price_performance.current_market.year_low/high` | summaryDetail.fiftyTwoWeekLow/High.raw |
| `analyst_data.price_targets.target_consensus/median/high/low` | financialData.targetMeanPrice / targetMedianPrice / targetHighPrice / targetLowPrice |
| `analyst_data.ratings.{strong_buy,buy,hold,sell,strong_sell}` | recommendationTrend.trend[0].{strongBuy,buy,hold,sell,strongSell} |
| `analyst_data.ratings.consensus` | from financialData.recommendationKey → Title-case ("buy"→"Buy") |
| `analyst_data.as_of_utc_timestamp` | ISO now |
| `estimates.records[]` SALES/EPS | earningsTrend.trend[], mapping each entry's `endDate` → fiscal_year, emit for {latestFY+1, latestFY+2}: SALES = revenueEstimate.avg.raw, EPS = earningsEstimate.avg.raw |

`dividend_yield` for the TTM ratios row: summaryDetail.dividendYield.raw
(or trailingAnnualDividendYield.raw), else 0.

## TTM computation (`ttm.ts`)

From the last four SEC quarters (flow sums) and the latest quarter
(balance) plus Yahoo price/market cap:

- `ttmRevenue = Σ revenue`, `ttmNetIncome = Σ net_income`,
  `ttmEbitda = Σ ebitda`, `ttmOcf = Σ operating_cash_flow`,
  `ttmCapex = Σ capex`, `ttmFcf = ttmOcf + ttmCapex`,
  `ttmInterest = Σ interest`, `ttmEps = Σ eps_diluted`.
- `key_metrics[TTM]`: `pe_ratio = price / ttmEps`,
  `price_to_sales = market_cap / ttmRevenue`,
  `ev_to_ebitda = (market_cap + net_debt) / ttmEbitda`,
  `free_cash_flow_yield = ttmFcf / market_cap`.
- `ratios[TTM]`: `gross_margin = Σ gross_profit / ttmRevenue`,
  `operating_margin = Σ operating_income / ttmRevenue`,
  `net_margin = ttmNetIncome / ttmRevenue`,
  `net_debt_to_ebitda = net_debt / ttmEbitda`,
  `interest_coverage = Σ operating_income / ttmInterest`,
  `current_ratio = total_current_assets / total_current_liabilities` (latest quarter),
  `dividend_yield` (Yahoo, above).
- Any denominator of 0 or a missing input → `null` (mappers read TTM
  fields as optional).

## Emit shapes (`emit.ts`)

Reproduce the exact nesting the mappers read (verified against
`statements.ts`, `quote.ts`, `analysts.ts`, `segments.ts`):

- **`bigdata-statements-annual.json`**:
  `{ fundamentals: { income_statement: [...], balance_sheet: [...], cash_flow: [...] } }`
  with FY rows carrying `fiscal_period:"FY", fiscal_year, report_date` + the mapped fields.
- **`bigdata-statements-quarter.json`**: `{ fundamentals: { income_statement: [...] } }`
  with quarterly rows carrying `fiscal_period:"Q#", fiscal_year, report_date, revenue, operating_income`.
- **`bigdata-tearsheet-annual.json`**: `company_overview`, `price_performance.current_market`,
  `analyst_data.{price_targets,ratings,as_of_utc_timestamp}`, `estimates.records`,
  `fundamentals.{key_metrics:[TTM row], ratios:[TTM row]}`, and
  `revenue_segmentation.{product:{}, geographic:{}}` (**empty for v1** → the
  segments mapper's single-"Consolidated" fallback, sized from the latest FY revenue).

## Error handling

- **SEC concept missing:** walk the priority list; if none present, emit
  `null` for optional fields. Revenue and net income are required — if
  absent, fail with a clear message naming the company and the concepts tried.
- **Yahoo crumb/quoteSummary fails** (401/403/HTML/empty): fail the run
  loudly. The report requires analyst targets (`mapAnalysts` reads
  `target_consensus` etc. as non-optional), so we never emit a report with
  fabricated Street data — a clear "Yahoo unavailable, retry or top up
  Bigdata" beats a silent hole.
- **Fewer than 3 aligned annual years:** let the existing `mapStatements`
  guard throw (do not paper over it).

## Testing

- Unit: `sec.ts` concept selection + period selection against a trimmed
  `companyfacts` fixture (a real LLY slice); the derivations (EBITDA, total
  debt, net debt, FCF, Q4-from-FY); `yahoo.ts` parsing against a captured
  `quoteSummary` fixture; `ttm.ts` math.
- **Contract test (the important one):** feed `emit.ts` output straight
  through the *real* `mapStatements`, `mapQuote`, `mapAnalysts`,
  `mapSegments` and assert a well-formed FactPack slice — proving shape
  parity with the Bigdata path without mocking the mappers.
- Network calls live behind a small fetch seam so tests never hit the wire.

## Scope boundaries (explicit)

- **In:** the three tearsheet files, from SEC + Yahoo, for a
  calendar-or-offset-fiscal-year US filer with a normal statement structure.
- **Out (v1), noted as follow-ups:**
  - **Segments** from XBRL dimensional axes (`ProductOrService` /
    `StatementGeographicalAxis`) — v1 degrades to one Consolidated segment.
  - **Transcript & headlines** from a free source (FMP `earningsTranscript`
    / `news`) — still Bigdata-sourced; already captured for LLY.
  - Banks/insurers and other non-standard statement shapes (revisit when
    one comes up, as BAC did for the vendor path).

## Success criteria

Running `facts:free -- LLY 0000059478-26-000081` followed by the unchanged
`facts:build` produces a `data/facts/LLY/…json` that validates, and
`synthesize` publishes a report indistinguishable in shape from a
Bigdata-sourced one (segments aside). The full `vitest` suite stays green.
