# Windmill investment analysis and automated portfolio management

Date: 2026-11-14

Status: Proposed implementation design; no deployment or trading configuration changes made

Scope: headless company analysis, validated investment decisions, portfolio construction, broker execution, and operational recovery

Reading guide: [scope](#1-objective-and-boundaries), [architecture](#4-target-architecture), [analysis without papers](#5-complete-analytical-specification), [data contracts](#6-domain-contracts), [Windmill flows](#7-windmill-flow-catalog), [portfolio policy](#9-portfolio-construction-and-operating-policy), [execution and recovery](#10-automated-execution-and-broker-ownership), [deployment](#13-deployment-and-operational-configuration), [implementation phases](#15-implementation-sequence-and-completion-gates), and [acceptance](#17-acceptance-definition).

## 1. Objective and boundaries

Build a Windmill-orchestrated system that collects financial evidence, analyzes companies, produces validated investment decisions, and automatically manages a portfolio without producing equity research papers. This document defines the analytical calculations and operating policy independently of any other application.

The durable output is a versioned **AnalysisRecord**, not a rendered report. A portfolio run consumes an immutable set of accepted AnalysisRecords, current broker prices, account state, and a versioned strategy configuration.

Included:

- Filing discovery and source capture; financial statements, ratios, estimates, peers, segments, management evidence, catalysts, and risks.
- Structured analytical judgment, Bull/Base/Bear valuation scenarios, independent analytical review, and evidence validation.
- Deterministic distress/quality gates, moat analysis, reverse DCF, composite score, uncertainty, conviction, and rating logic.
- Explicit portfolio sizing, entry/exit hysteresis, holding restrictions, cash constraints, execution rules, reconciliation, and audit.
- Windmill flows and schedules, storage contracts, worker isolation, secrets, backups, rollout, and acceptance tests.

Excluded:

- Dashboard, application UI, report website, chart presentation, PDF generation, themes, and report formatting.
- Equity-paper authoring, executive summaries, polished financial commentary, editorial voice, word counts, or publication workflows.
- A new investment strategy, changed thresholds, unproven factor overlays, autonomous parameter optimization, or a claim of improved investment returns.

Short evidence-backed assertions, assumption explanations, and machine-readable reason codes remain necessary analytical records. They are not research papers. Windmill is used through versioned flows, jobs, schedules, and APIs; this document specifies no UI work.

## 2. Reproducibility and analytical judgment

Separate facts, judgment, and calculation. Facts are observed values with sources, periods, units, availability dates, and limitations. Judgment supplies assumptions, qualitative assessments, scenario prices/probabilities, and a constrained selected recommendation. Deterministic code computes gates, scores, labels, portfolio weights, and orders.

Identical facts, scenarios, configuration, prices, account state, and clocks must produce identical deterministic outputs within declared numerical tolerances. Model-generated judgment need not be identical across runs; retain the accepted output rather than regenerating it during portfolio execution.

The system must cover business economics, segments, financial quality, valuation, competitive advantage, growth, management, governance, catalysts, and counter-cases. Removing narrative presentation does not remove this evidence or the assumptions supporting scenarios.

Every accepted analysis is immutable. A correction or rescore creates a new version and records differences. Mechanical rescoring does not reset substantive analysis age or its reference price; a substantive new analysis may establish a new baseline. Optional strategy overlays remain disabled unless separately evaluated and versioned.

## 3. Independent analytical foundation

The core investment contract is structured data, with these explicit fields:

| Field | Meaning |
|---|---|
| Security identity | Stable security ID, ticker history, company, currency, CIK, filing accession |
| Effective date | Date of substantive analysis, used for staleness |
| Reference quote | Immutable price/date and corporate-action basis used for scenario acceptance and subsequent price-decline attribution |
| Scenarios | Bull/Base/Bear prices, probabilities, horizons, and assumptions |
| Selected label | Constrained analyst/model recommendation |
| Derived label | Mechanical expected-return/reward-risk recommendation |
| Gated label | Fundamental ceiling applied to the derived recommendation |
| Computed assessment | Conviction, gate, moat, intrinsic value, composite, and uncertainty outputs |
| Execution metadata | Market capitalization, SIC, beta, observation dates, and provenance |
| Earnings observations | Actual/estimated earnings, signed surprise and units, announcement and availability dates |
| Coverage universe | Explicit securities to analyze, separate from the accepted analysis release |

Use validated schemas with versioned migrations. Keep calculations in one pure engine, separate from source retrieval, model calls, persistence, and execution side effects. Validation fixtures must contain explicit inputs and expected outputs, without requiring another codebase or undocumented behavior.

## 4. Target architecture

Use a modular TypeScript engine with Windmill as the orchestration layer and PostgreSQL as the durable application state store.

| Component | Responsibility | Explicit boundary |
|---|---|---|
| Windmill server and control workers | Schedules, flow dispatch, execution history, retries, notifications | Do not define investment mathematics or broker truth |
| Capture worker | SEC and market-data collection, parsing, evidence packaging | No broker submission credentials |
| Analysis worker | Structured analytical model calls, scoring, independent review | Cannot change strategy policy or submit orders |
| Portfolio orchestration jobs | Request a scheduled run; inspect status; schedule recovery/audit | Do not submit individual orders |
| Single broker executor per account | Reconciliation, live planning, order lifecycle, account guards | Sole holder of broker submission credentials; no autonomous timer |
| PostgreSQL | Application identities, versions, accepted releases, run claims, order intents, fills, audit | Application schemas separate from Windmill internals |
| Artifact volume | Immutable source bodies and larger analytical payloads | Content addressed, backed up, never dependent on worker scratch space |
| Monitoring and backup jobs | Detect missed work; verify recovery capability | Monitoring should survive loss of the primary host |

All scheduled work originates in Windmill. The broker executor is a small private service containing the trading calculations and lifecycle controls specified here, not a second scheduler. A Windmill job requests a portfolio slot by its stable command ID; the executor validates, claims, and executes that slot. Windmill can restart or lose an HTTP response without creating another investment decision.

Why retain an executor service? The live submit/poll/cancel sequence must not be split into independently retried workflow nodes. A persistent owner can finish reconciliation if an orchestration request disconnects. The investment engine remains a reusable library; the service is an execution boundary, not a reimplementation.

For an initial single-host deployment, one PostgreSQL server may host separate `windmill` and `investment` databases with separate roles. Sharing the server saves resources but shares its failure domain. Never write application state into undocumented Windmill tables.

Windmill's documented self-hosted architecture uses server, workers, and PostgreSQL. Pin a tested release and image digests before implementation. [Windmill self-hosting](https://www.windmill.dev/docs/advanced/self_host).

## 5. Complete analytical specification

### 5.1 Source collection and factual normalization

Support SEC filing/company-fact retrieval, a market-data adapter, and versioned vendor captures. Keep source selection explicit in each capture manifest.

Capture and normalize:

- Issuer identity, CIK, ticker history, exchange, currency, SIC, and filing accession.
- Primary 10-Q/10-K, relevant earnings release/8-K exhibits, prior annual filing, and proxy evidence where used.
- Annual and quarterly statements, TTM reconstruction, debt, cash, shares, capex, SBC, goodwill, FCF, and provenance for each financial field.
- Price snapshot and history, market cap, analyst estimates/targets, peer multiples, reported segments, and their dates.
- Earnings surprise observations, measured beta where available, and independent source cross-checks.
- Source limitations, missing fields, restatements, spin-offs, mismatched fiscal periods, and stale observations.

Financial parsing must explicitly select concepts, units, fiscal periods, and amendments. Reconstruct TTM observations from compatible quarters and retain provenance for each component. Keep one tested parser in the engine rather than duplicating selection rules in workflow expressions.

Immutable source bodies are identified by hash and retrieval time. Each normalized fact snapshot references a capture manifest; a refetch creates a new revision. Missing information stays null with a reason. Never substitute zero or an uncited model estimate for an observed fact. Calculation-specific numerical proxies described below remain separate from source observations and carry warnings.

### 5.2 Structured company assessment

Replace narrative sections with typed assessments:

| Domain | Structured output | Role in decisions |
|---|---|---|
| Business and segments | Segment identity, revenue exposure, economics, dependencies, evidence references | Scenario assumptions and concentration assessment |
| Financial performance | Growth/margin trends, cash conversion, leverage, dilution, accounting exceptions | Deterministic scoring plus scenario evidence |
| Valuation | Peer context, method, assumptions, Bull/Base/Bear prices and probabilities | Direct input to E/R, conviction, sizing |
| Competitive position | Structured moat factors, durability, counter-evidence | Judgment context; computed moat remains a separate code-owned result |
| Growth and catalysts | Event/type, horizon, status, evidence, expected directional effect | Scenario construction; not a new sizing multiplier |
| Management/governance | Capital allocation, ownership, incentives, governance observations | Scenario and selected-label context |
| Risks/counter-case | Idiosyncratic/systemic categories, materiality, affected assumptions, disconfirming evidence | Analytical review and scenario plausibility |
| Recommendation | Selected label and coded justification for an allowed conservative notch | Eligibility, alongside the independent gate ceiling |

Do not convert these qualitative fields into new numerical penalties during this redesign. Their influence passes through judgment and scenario selection. In particular, the model's qualitative moat assessment must not overwrite the computed ROIC/WACC moat used by the portfolio quality tilt.

### 5.3 Scenario production without paper writing

The analysis model receives a versioned evidence bundle, analytical policy, and strict JSON schema. It returns only a structured assessment and ScenarioSet. No executive summary, paragraphs, report tables, or final-recommendation essay is requested.

Retain exactly three scenarios, named Bull, Base, and Bear, each with a positive implied price and probability strictly between zero and one. Validate probability sum, ordering `Bull >= Base >= Bear`, label consistency, and a 15% minimum bear downside at the analysis reference price. Require the probability sum to differ from one by no more than 0.001; reject invalid sums rather than silently normalizing them.

Distinguish observed facts, calculated values, and assumptions. Every observed number refers to a specific source field/period. Every assumption has a type, horizon, evidence references, and a concise rationale; it is never represented as an observed fact. Where a valuation recipe is supplied, code evaluates the formula and checks the implied price. Direct implied-price judgments are supported when assumptions and evidence are recorded; mandatory new valuation formulas require separate validation.

Apply the rating rule in section 5.5.8. A selected label may equal the derived label or take exactly one permitted alternative: STRONG BUY to BUY, BUY to HOLD, SELL to HOLD, or STRONG SELL to SELL. HOLD has no alternative. The agent cannot pick a more aggressive label or alter desk thresholds.

Preserve a bounded correction process: at most three analytical-generation/validation attempts, then at most two independent review rounds. Exhaustion produces `needs_attention`, not an invented fallback scenario. Use separate author and reviewer model calls with explicit evidence bundles; do not let the author certify its own analytical validity. Model/provider choice is configuration, pinned and recorded per run.

### 5.4 Replace editorial review with analytical review

Review attribution, unsupported claims, temporal accuracy, counter-case quality, scenario coherence, and source disagreements. Remove voice, repetition, presentation, and length requirements.

Review output contains finding ID, severity, field path, evidence references, requested correction, status, and an input fingerprint. Critical and Important analytical findings block acceptance. Minor findings may be explicitly accepted with a reason. A review is valid only for the exact fact, context, policy, scenario, and assessment hashes it examined.

Routine clean analyses are automatically accepted after the machine gates and independent review pass. There is no mandatory human approval for every name or daily portfolio run. Human intervention is reserved for unresolved material findings, source-conflict overrides, authentication renewal, and operating-policy changes.

### 5.5 Deterministic financial calculations

Each calculation returns inputs, intermediate values, applicability, missing-data and proxy flags, and warnings. Ratios use decimal fractions unless stated otherwise.

#### 5.5.1 Sector classification and fundamental gate

Classify SIC 6000–6199, 6211, 6282, 6712, and 6300–6499 as financial; 4900–4999 and 6790–6799 as utility; otherwise industrial. When SIC is unavailable, use explicit financial/bank/insurance or utility descriptors, then a versioned security-classification override table. Unknown companies use industrial rules with a warning.

Order labels STRONG SELL < SELL < HOLD < BUY < STRONG BUY. Start the fundamental ceiling at STRONG BUY; restrictions can only lower it.

Determine net-debtor status from debt exceeding cash plus investments when both are finite; otherwise use positive net debt, then positive net-debt/EBITDA, then false with a warning. Cash runway is cash divided by absolute negative annual FCF; use infinity for tests when this calculation is unavailable or inapplicable, explicitly flagging that condition.

Financial companies abstain from distress assessment. For others, impose a SELL ceiling when either current ratio < 1, annual FCF < 0, and runway < 1 year; or the company is a net debtor, interest coverage < 1, and runway < 2 years. Utilities otherwise receive SAFE status. Industrials receive WEAK status and at most HOLD when a net debtor has interest coverage < 1, or net-debt/EBITDA > 6 with positive EBITDA; otherwise SAFE.

Compute a nine-point financial-strength proxy, one point per true condition and zero for false or unavailable:

1. Positive net income.
2. Positive operating cash flow.
3. Rising net income divided by equity plus debt.
4. Operating cash flow exceeding net income.
5. Falling debt divided by equity plus debt.
6. Rising current ratio.
7. No dilution: negative signed repurchase cash flow, or inferred shares `netIncome/EPS` no higher than the previous period when net income is positive and EPS nonzero.
8. Rising gross margin.
9. Rising revenue divided by equity plus debt.

This is a defined proxy, not textbook Piotroski scoring. For industrial companies, score ≤ 1 with negative annual FCF caps the label at SELL; otherwise score ≤ 2 caps it at HOLD.

Accrual ratio is `(netIncome-operatingCashFlow)/average(equity+debt)` over the latest two annual periods, using the latest denominator alone if the prior period is missing. Missing required values or zero denominator yields null. Above 0.10 is HIGH, below zero LOW, otherwise neutral. HIGH accruals and strength score ≤ 3 cap industrial companies at HOLD.

Gate confidence is low with fewer than two annual periods or WEAK distress. Otherwise nonindustrial confidence is medium. Industrial confidence is high only with at least five annual periods, SAFE distress, and finite TTM interest coverage, net-debt/EBITDA, and current ratio; otherwise medium.

#### 5.5.2 Beta and cost of capital

Prefer beta from two years of matched weekly logarithmic stock and SPY returns through the quote date, requiring at least 52 observations. Raw beta is covariance with market returns divided by market-return variance. Apply `2/3*rawBeta + 1/3`, then clamp to [0.3, 2.5].

Fallback SIC beta: 4900–4999 → 0.5; 2834 → 0.8; 4813 → 0.9; 3674 → 1.7; 7372 or 3559 → 1.3; 1090 → 1.4; 3724, 3760, or 7389 → 1.1; 6200 → 1.0; otherwise 1.1.

Risk-free rate is 0.043, equity risk premium 0.045, tax rate 0.21. Cost of equity is `riskFree + beta*equityRiskPremium`. Debt credit spread is 0.010 for interest coverage > 15, 0.015 for coverage ≥ 8, 0.025 for coverage ≥ 4, otherwise 0.040; missing coverage uses 0.025.

With market capitalization M and debt D:

```text
WACC = M/(M+D)*costOfEquity + D/(M+D)*(riskFree+creditSpread)*(1-taxRate)
```

Nonpositive total capital falls back to cost of equity. Missing debt uses a disclosed zero proxy. Live macro assumptions or a different beta method require a new policy version.

#### 5.5.3 Computed moat

Only industrial companies receive this calculation. Annual NOPAT is operating income times 0.79. Invested capital is debt plus equity minus cash and investments; ROIC is NOPAT divided by invested capital. Missing components use disclosed zero proxies; zero invested capital returns zero ROIC with a warning.

Start comparable history after the most recent absolute invested-capital change exceeding 50% of prior absolute invested capital, or a revenue decline exceeding 20% when history is marked restated; use the later break. Incremental ROIC is change in NOPAT divided by change in invested capital from comparable start to latest year, null for no interval or zero capital change.

If goodwill exceeds 15% of positive invested capital in any year, width tests use ROIC excluding goodwill where adjusted invested capital is positive, otherwise ordinary ROIC. Trend and incremental calculations use unadjusted ROIC. Flag mixed restatement bases.

| Test | Wide | Narrow | None |
|---|---|---|---|
| A: median ROIC minus WACC | ≥ 8 percentage points | ≥ 0 | Below 0 |
| B: positive-spread persistence | ≥ 80% positive and ROIC population standard deviation / absolute mean < 0.35 | ≥ 40% positive | Otherwise |
| C: incremental ROIC | ≥ WACC + 10 percentage points | ≥ WACC | Otherwise/unavailable |
| D: gross-margin strength | Latest margin ≥ 40% and comparable-period slope ≥ 0 | Latest margin ≥ 25% or slope ≥ 0 | Otherwise |

For B, zero mean implies infinite variation ratio. Final width is wide if A and B are wide and D at least narrow; otherwise narrow if A is at least narrow, C wide, or D wide; otherwise none. A narrow result is contingent when a comparability break exists and post-break A is none while C and D are wide.

Trend uses up to the latest three comparable years and endpoint change per interval. Spread slope ≥ 0.01 counts up, ≤ -0.01 down; gross-margin thresholds are ±0.005; operating-margin slope uses its sign; incremental ROIC versus mean unadjusted ROIC supplies another sign. WIDENING requires at least three up signals and spread slope > -0.01. ERODING requires at least two down signals, with a falling spread receiving an extra down count. Otherwise STABLE.

With fewer than three comparable years, withhold trend and expose STABLE as a placeholder. With fewer than four total annual years, withhold width, return none, and clear contingent status. Advisory bear-probability floors are 35% for eroding moat; otherwise 15% wide, 20% narrow, 30% none. Their effect on accepted scenarios is disabled.

#### 5.5.4 Owner earnings and intrinsic value

Only industrial companies are eligible. Abstain on failed guarded market-capitalization, share-count, or FCF source comparisons. Owner earnings must be positive and at least 1.5% of market capitalization.

Use finite TTM FCF yield times market capitalization, else latest nonnull annual FCF, else a disclosed zero proxy. Subtract SBC: prefer TTM SBC with TTM FCF, otherwise matching annual SBC, falling back to TTM SBC if annual SBC is missing. If neither is available, retain FCF as a disclosed owner-earnings proxy. An unqualified provider zero for SBC is missing unless metadata establishes a genuine observed zero.

Use ten years, central discount rate `max(costOfEquity,0.07)`, and reference terminal growth 0.03:

```text
growth(t) = initialGrowth + (terminalGrowth-initialGrowth)*(t-1)/9
cashFlow(t) = cashFlow(t-1)*(1+growth(t))
value = [sum(cashFlow(t)/(1+r)^t, t=1..10)
       + cashFlow(10)*(1+terminalGrowth)/(r-terminalGrowth)/(1+r)^10] / shares
```

Reverse-solve initial growth matching reference price using 100 bisection iterations over [-0.50, 2.00]; flag results within 0.001 of endpoints.

Achievable growth uses history after a restatement revenue break. With fewer than two post-break intervals, use revenue CAGR or zero. Otherwise use FCF CAGR only with positive endpoints and initial FCF at least 25% of final FCF; else revenue CAGR. Negative FCF growth cannot override nonnegative revenue growth; when both are negative use the less negative. Clamp to [-0.10, 0.15].

Forward valuations use terminal growth `min(0.03,max(initialGrowth,0))`. Define `spread=max(0.03,abs(impliedGrowth-achievableGrowth)/2)`. Diagnostic bear growth is `min(impliedGrowth/2,achievableGrowth-spread)`, base is achievable growth, bull is `max(0.9*impliedGrowth,achievableGrowth+spread)`. Diagnostic probabilities are 25%/50%/25%, separate from authored scenarios.

Margin of safety is base value/reference price minus one. Produce a range from the central estimate and four corners of discount rate ±1 percentage point and growth ±2 percentage points, corner discount rate floored at 6%, without additional growth clamping. Produce an implied-growth band using discount rate ±2 percentage points, floored at 6%.

#### 5.5.5 Composite score

Financial companies abstain. Compute available components and renormalize weights:

- Value, weight 1.0: inverse positive P/E, P/S, and EV/EBITDA. Require valid company yield and at least three valid comparison yields > 0.002 per metric; include the company in the comparison set. Rank `(count(yield <= companyYield)-0.5)/count`; average available metrics.
- Quality, weight 0.7: current gross, operating, and net margins against each metric's own annual history, requiring at least three observations. Population standard deviation zero gives 0.5, otherwise `logistic(1.702*z)`. Average available metrics.
- Growth, weight 0.7: latest revenue year-over-year growth and next-fiscal-year estimated revenue/latest finite annual revenue minus one. Map each through `min(0.95,logistic((growth-0.10)/0.25))`; average.
- Momentum, weight 0.4: clamp `(price-low52)/(high52-low52)` to [0,1] for a valid range.

Here `logistic(x)=1/(1+exp(-x))`. Multiply weighted available-component mean by 100; no components gives null. Confidence is high when the value component meets its comparison-count requirement, otherwise low. This is not an overall coverage-universe percentile.

#### 5.5.6 Uncertainty

Add points for analyst-target dispersion `(high-low)/median`: > 1 adds 3, > 0.6 adds 2, > 0.3 adds 1. An industrial net debtor with net-debt/EBITDA > 3 adds 2. Cyclical SIC 3674, 1000–1499, 2900–2999, 3711, or 4512 adds 2. Fewer than five annual periods adds 1. Industrials add 1 per unavailable moat/intrinsic/composite view, up to 3. With at least two segments, industrial revenue-share Herfindahl index > 0.6 adds 2, > 0.4 adds 1; a single reported segment does not trigger this penalty.

Total ≤ 2 is low, ≤ 4 medium, ≤ 7 high, otherwise very high. Optional band multipliers 1, 1.2, 1.8, and 2.5 remain disabled.

#### 5.5.7 Source-conflict gate

Compare finite observations A and nonzero B using `abs((A-B)/abs(B))`, rounded to four decimal places. Difference ≤ 10% is OK, ≤ 25% WARN, otherwise FAIL. Missing inputs or zero B skip comparison with a warning. Quotes must be on/before reference date and no more than ten days old. Quarter ends must match within ten days. TTM comparison requires four quarters spanning 250–300 days from first to last quarter end and matching period ends across populated fields.

An unaccepted FAIL blocks acceptance; missing checks warn. An override records security, field, sources, period, input hash, and reason. Acceptance override does not remove DCF abstention for guarded failed inputs.

#### 5.5.8 Rating and conviction

At reference price P, `E=sum(probability*targetPrice)/P-1`, `D=(P-bearTarget)/P`, and `R=E/D` when D > 0, otherwise null. Evaluate in order: E ≤ -20% → STRONG SELL; E ≤ -5% → SELL; E ≥ 20% and R ≥ 1 → STRONG BUY; E ≥ 10% and R ≥ 0.5 → BUY; otherwise HOLD.

Start conviction at 100 and subtract:

| Condition | Deduction |
|---|---:|
| Fundamental ceiling below decision label | 25 |
| Eroding moat with bullish decision | 15 |
| Robust intrinsic-value direction contradicts E with bullish decision | 20 |
| Analyst-target dispersion | `round(clamp(dispersion,0,1)*15)` |
| Missing intrinsic, moat, or composite view | 10 each |
| Low gate confidence | 10 |
| Contingent moat | 5 |

Robust DCF disagreement means the full intrinsic range implies returns of opposite sign to E. A point without a range uses point direction with a limitation flag. A range crossing zero warns without the deduction. Clamp conviction to [0,100]; ≥ 70 high, ≥ 45 moderate, otherwise low. Absolute DCF-versus-analyst-target expected-return difference > 25 percentage points is advisory only.

Gate enforcement within the advisory decision label, corroboration, moat-floor, uncertainty, and dispersion adjustments remain off. Baseline decision label equals derived label. A model's confidence estimate never replaces numerical conviction.

### 5.6 Four labels must remain distinct

Persist these separately:

1. `derivedLabel`: E/R rule at the analysis reference price.
2. `selectedLabel`: analyst/model choice, validated against the derived label and allowed notch.
3. `gatedLabel`: the lower of the fundamental ceiling and derived label, independently of the selected label.
4. `decision.label`: advisory/composed decision under the pinned decision policy.

The portfolio uses selected label and gated label, plus `decision.conviction`. Replacing selected label with `decision.label` would change strategy. The default optional decision policies remain off even though a stored gated label still constrains portfolio eligibility.

## 6. Domain contracts

These are proposed records, with their full meanings defined below. Implement strict validation and schema versions; they do not depend on another application schema.

### 6.1 Source and analysis records

| Record | Required content |
|---|---|
| `SourceArtifact` | Provider, source URL/tool, request fingerprint, captured-at/available-at timestamps, period, SHA-256, storage key, media type |
| `CaptureManifest` | Security, accession, ordered artifact references, provider versions, missing inputs and reasons |
| `FactSnapshot` | Immutable normalized financial observations with periods, units, sources, and missing-data reasons, manifest ID, fact hash, schema version, validation result |
| `AnalyticalAssessment` | Domain assessments from section 5.2, source-linked claims, assumptions, selected label, model/prompt versions |
| `ScenarioSet` | Bull/Base/Bear, probabilities, prices, horizons, assumption IDs, optional evaluable valuation recipes |
| `AnalysisReview` | Exact input hashes, independent reviewer identity/version, findings and disposition |
| `ComputedAssessment` | Conviction inputs, four labels, full gate/moat/intrinsic/composite/uncertainty/decision results |
| `AnalysisRecord` | References to all of the above; code/config versions, dates, reference quote, execution metadata, acceptance state |
| `AnalysisRelease` | Immutable map of security to accepted AnalysisRecord ID, with release hash and creation time |

An AnalysisRecord also contains:

- `securityId`, current ticker, CIK, company, currency, filing accession, and fiscal period.
- `analysisEffectiveDate`: date of the substantive analysis used for staleness.
- `computedAt` and `acceptedAt`: operational timestamps, not replacements for the effective date.
- `referenceQuote`: price, price date/time, source, and corporate-action basis used when scenarios were accepted.
- `executionMetadata`: explicit SIC, market cap and observation time, measured/fallback beta and its source, and optional price-history reference.
- `contentHash`, `parentAnalysisId`, `strategyVersion`, `engineCommit`, `modelVersion`, `promptHash`, and `evidenceBundleHash`.

Never reset analysis age or the original price merely because a worker restarted, an audit ran, or a quote refreshed. An accepted substantive re-analysis may establish a new date/reference price; a mechanical rescore alone preserves them. This distinction prevents the stale-entry gate from being defeated by automatically refreshing its baseline after a price fall.

### 6.2 Narrow portfolio input

Introduce `PortfolioAnalysisInput`, containing only identity, effective date, original price/date, scenarios, selected/gated labels, decision conviction, computed moat/composite results, and execution metadata.

Signal construction, price-decline attribution, and relabel checks consume this narrow projection. Validate dates, corporate-action basis, market-capitalization units, and timestamps explicitly because they affect age and execution liquidity buckets. Do not require presentation fields.

### 6.3 Portfolio and broker records

| Record | Required content |
|---|---|
| `PortfolioRun` | Stable account/strategy/date/slot identity; mode; release/config hashes; status and timestamps |
| `AccountSnapshot` | Broker account, cash, NAV, positions, broker clock, capture timestamps |
| `MarketSnapshot` | Quotes/trades, settled reference closes, source timestamps, fallback and freshness diagnostics |
| `PortfolioDecision` | Signals, classifications, exclusions, locks, target weights, cash, expected trades and reasons |
| `OrderIntent` | Stable ID, run ID, ticker, side, leg, quantity, price policy, client ID, current lifecycle state |
| `BrokerObservation` | Immutable broker order/fill/cancel responses and observation timestamps |
| `FillEvent` | Canonical deduplicated execution event, order reference, quantity, price, trading date |
| `AuditResult` | Run/account, discrepancies, severity, evidence references, recovery status |

Use decimal-safe storage for money and quantities; define conversion and rounding at calculation boundaries and verify them against explicit expected-result fixtures.

## 7. Windmill flow catalog

Paths below are proposed version-controlled Windmill paths. Every flow returns a small structured result containing domain IDs, status, warnings, and artifact references. Large source bodies and credentials never travel as flow results.

### F01 — `f/investment/discover_filings`

Trigger: proposed polling every 30 minutes; manual targeted invocation also supported.

1. Load the explicit coverage universe.
2. Poll EDGAR through the shared request limiter.
3. Upsert discovered filing identities and enqueue durable analysis requests in one application transaction.
4. Dispatch pending requests through an outbox dispatcher; retry dispatch safely.
5. Return counts and request IDs.

Deduplicate discovery by security and accession. An amended filing/new accession is a new event. Reprocessing an filing uses an explicit analysis revision, not deletion of its discovery history.

A discovery remains pending until durably dispatched and processed. Never mark an item complete merely because it was printed or handed to an in-memory queue.

### F02 — `f/investment/analyze_filing`

Inputs: request ID, security, accession, provider profile, analysis-policy version, refresh reason.

Steps:

1. Claim the request using a durable per-security/revision claim.
2. Capture primary documents and provider data, preserving immutable raw artifacts.
3. Build and enrich a FactSnapshot; load beta and cross-check observations.
4. Validate periods, units, provenance, completeness, and source conflicts.
5. Assemble the evidence bundle, including relevant business/proxy/earnings context.
6. Compute the deterministic fundamental views to inform the structured assessment.
7. Generate structured assessment and scenarios; run numerical and claim validation.
8. Independently review analytical coverage, assumptions, source attribution, and counter-case.
9. Apply bounded corrections, then recompute and verify the final score/labels.
10. Persist an accepted or blocked AnalysisRecord and its exact review fingerprint.
11. Request release promotion when accepted.

Failure of a new analysis leaves the previous accepted version available under its age and expiry. It does not reset its freshness, replace it with a partial result, or silently label the name HOLD. Invalid active data must be revoked explicitly and handled as an operational exception.

### F03 — `f/investment/promote_analysis`

Trigger: accepted analysis; explicit batch promotion after a controlled rescore.

- Verify all referenced artifacts and hashes exist, review remains current, and policy versions match.
- Serialize promotion or use compare-and-swap on the current release pointer so concurrent promotions cannot lose another name's update.
- Reject accidental promotion of an older filing/revision over a newer accepted analysis unless a recorded rollback is requested.
- Create a new immutable AnalysisRelease and atomically advance the active pointer.
- A running portfolio slot retains its pinned release; promotion affects a later slot only.

This replaces report publication. There is no website build, paper, or rendering step.

### F04 — `f/investment/refresh_context`

Trigger: proposed weekday morning job and targeted earnings/event refresh.

Refresh earnings observations, permitted market context, source availability, and broker/calendar health. Peer/macro/beta changes are versioned and may enqueue analysis, but must not mutate already accepted calculations in place.

Record actual earnings, estimated earnings, signed surprise, explicit units, announcement date, and availability timestamp; preserve the definition within each versioned provider profile. Observation dates must not lie after the portfolio decision time. Missing provider responses remain visible.

### F05 — `f/investment/reanalysis_requests`

Trigger: new filing, material corrected facts, a confirmed relabel advisory, or stale-entry/breach diagnostic.

Create one deduplicated request per security, reason, and input revision. Prioritize using filing materiality, holdings exposure, and analysis age; never discard a filing because it ranks poorly. Preserve an oldest-request fallback to avoid starvation.

Relabel confirmation requires three consecutive observed run days. Keep it advisory: it may enqueue re-analysis but must not instantly overwrite selected labels or trigger an extra trade. Re-analysis acceptance is a new analytical event and can legitimately alter a later portfolio run; distinguish changes in accepted inputs from changes in calculation behavior.

### F06 — `f/investment/portfolio_slot`

Trigger: weekday 15:10 in `America/New_York`, with a proposed recovery check inside the 15:10–15:30 start window.

1. Resolve the stable slot command ID and configured mode.
2. Request that command from the private broker executor; do not pass arbitrary orders.
3. Persist the executor's run ID and query its domain status until terminal or hand off to monitoring.
4. Emit an operational outcome; workflow failure must not imply broker orders failed.

The executor performs the complete reconcile → live plan → guards → execute → persist → audit sequence. Windmill does not pause between individual orders for analysis or model calls.

Windmill supports schedules with timezone selection. Its schedule is not an exchange calendar: the executor still enforces the versioned exchange/broker calendar, regular-session checks, maximum lateness, and submit cutoff. [Schedule documentation](https://www.windmill.dev/docs/core_concepts/scheduling).

### F07 — `f/investment/reconcile_and_audit`

Trigger: after execution, proposed end-of-day job, startup recovery, or unresolved submit/audit incident.

Request reconciliation through the same account executor so it serializes against execution. Compare orders, fills, positions, and account state. Append missing broker-proven events idempotently; retain manual/external trades as explicit evidence. Never fabricate fills from targets or infer that a timed-out order was rejected.

This flow may run after the trading cutoff because it performs recovery reads and required order-lifecycle management, not new investment decisions. A cancellation of an outstanding order is an execution-control action and remains owned by the executor.

### F08 — `f/investment/auth_health`

Trigger: proposed daily check and immediately before a portfolio run.

Report broker-auth health and refresh expiry; deduplicate warnings by account, credential, and expiry revision. Use configured expiry and renewal thresholds, verified against provider behavior. Token refresh is serialized by the executor/token owner. A failed or expired credential blocks submission and creates an actionable incident. Human OAuth reauthorization remains necessary where the broker requires it; Windmill does not remove that dependency.

### F09 — `f/investment/calibration`

Trigger: proposed weekly and when an analysis reaches its measurement horizon.

Compare accepted scenario expectations with realized outcomes; record forecast error, realized return, benchmark return, drawdown, and cohort coverage. Store benchmark comparisons and forecast error by analysis version, horizon, and cohort. Record corporate-action limitations and incomplete histories.

Calibration produces data and diagnostics, not automatic strategy updates. Do not activate Kelly-based sizing, inverse-volatility overlays, different bear floors, or changing threshold bands through this flow.

### F10 — `f/investment/operations`

Trigger: proposed health probes every few minutes; backups daily and after material state transitions.

Check overdue requests, queue age, missing slot outcomes, storage integrity, auth expiry, stale analysis, broker audit status, and backup completion. Notify with concise structured context. Perform periodic restore drills with trading disabled.

## 8. Scheduling, retries, and concurrency

### 8.1 Scheduling policy

| Work | Proposed timing | Semantic constraint |
|---|---|---|
| Filing discovery | Every 30 minutes | No lost discovery on dispatch failure |
| Pending work dispatcher | Every minute | Domain deduplication, not reliance on queue uniqueness |
| Context refresh | Weekdays before market open | Does not reset analytical age or reference price |
| Portfolio decision | 15:10 ET | Fixed strategy slot, one accepted decision per account/strategy/date/slot |
| Slot recovery check | Inside 15:10–15:30 ET | Dispatch only if domain state proves no execution has started |
| Submit cutoff | 15:50 ET | Rechecked before each new submission |
| Reconcile/audit | After run and after close | Broker truth; never replay an uncertain order |
| Calibration/restore drill | Weekly / periodic | Read-only analytics / isolated disabled environment |

These are proposed operating schedules. On early-close days, the 15:10 slot observes a closed market and skips trading; moving it earlier requires a separate policy change. Use a versioned exchange calendar with an explicit supported horizon and advance expiry alerts. Only one scheduler may own each live account's decision slot.

### 8.2 Retry classes

| Operation | Retry policy |
|---|---|
| Source GET/read | Bounded backoff, honor provider responses, retain completed artifacts |
| Pure parse/score | Safe with identical hashes; invalid data goes to correction, not endless retries |
| Model call | Bounded attempts and spend; persist successful outputs before resuming |
| Analysis acceptance/promotion | Idempotent transaction with expected versions |
| Portfolio command delivery | May retry the same command ID; never generate a new slot/run ID on HTTP timeout |
| Broker submission | No generic Windmill retry; executor lookup/reconciliation only |
| Notification | Retry independently; never re-run the trading operation to resend a message |

Windmill offers step-level retries. Configure them according to the side effect, not uniformly across the flow. [Retry documentation](https://www.windmill.dev/docs/flows/retries).

### 8.3 Community Edition baseline

Design without depending on paid global concurrency limits. Windmill documents global concurrency limiting as Cloud/Self-Hosted Enterprise functionality. Application-level locks, unique keys, and provider limiters are required regardless of edition. [Concurrency documentation](https://www.windmill.dev/docs/flows/concurrency_limit).

Use static worker tags and environment configuration to isolate capture and analysis queues. Community workers can subscribe to tags through `WORKER_TAGS`; advanced management features vary by edition. The broker executor is an independent credential boundary, not merely a queue tag. [Worker documentation](https://www.windmill.dev/docs/core_concepts/worker_groups).

Start with one capture worker and one analysis worker. All SEC requests, including retries and separate flows, pass through a shared limiter keyed by provider and egress identity. Enforce at least 120 ms request-start spacing across processes; multiple process-local limiters do not provide that guarantee. Implement the limiter in the data adapter using durable scheduling/serialization, without holding a database transaction during a network call. Account for other clients sharing the same egress.

### 8.4 Incremental work and bounded cost

Reuse immutable artifacts by their actual dependencies, not by ticker alone:

- Capture cache key: provider, request parameters, filing/period, source profile, and explicitly selected freshness policy.
- Fact-build key: capture hashes, parser version, and enrichment policy.
- Structured-assessment key: evidence, analytical policy, model version, prompt version, and requested analysis revision.
- Score key: facts, scenarios, selected label, engine version, and score policy.
- Review key: all inputs reviewed, reviewer policy/model, and reviewed output hash.

A daily portfolio mark does not regenerate scenarios or call an LLM. A parser correction invalidates affected downstream facts and assessments; a score-code change can recompute scores without pretending to refresh the underlying analysis date. Reuse a review only when every input in its review contract is unchanged. New broker quotes, account reads, and submission guards are never served from an analysis-result cache.

Set per-job deadlines and per-analysis model/token spending limits in the model profile. A budget or deadline breach returns a durable blocked/retryable status and leaves the prior accepted analysis untouched. Do not silently switch to a cheaper model, smaller evidence bundle, or weaker review policy to make a job finish. Record time spent in capture, model generation, validation, review, and queue waiting so later optimization follows measured costs.

## 9. Portfolio construction and operating policy

Pin one analysis release, engine version, strategy configuration, earnings/context snapshot, and account at slot start. Capture fresh broker data. Individual security jobs cannot change the live portfolio independently.

### 9.1 Live signals and sizing score

For current price P, scenario target V and probability p:

```text
r_i = V_i/P - 1
mu = sum(p_i*r_i)
sigma = sqrt(sum(p_i*(r_i-mu)^2))
sigmaDown = sqrt(sum(p_i*r_i^2 for r_i < 0))
D = max(0,-min(r_i))
R = mu/D if D > 0, otherwise null
kappa = conviction/100
ageDays = max(0,round(elapsed days since effective UTC date))
recency = 0.5^(ageDays/90)
R_size = mu/max(D,0.25)
score = max(mu,0)*max(kappa,0)*max(R_size,0)*recency*qualityTilt
```

Use raw R for eligibility, R_size only for sizing. Volatility remains diagnostic; each score exponent is 1. Composite defaults to 50 if unavailable. Moat score is wide=1, narrow=0.5, none=0, unavailable=0.25:

```text
qualityTilt = clamp(1 + 0.10*(composite-50)/50
                    + 0.20*(moatScore-0.5)
                    - 0.10*(moatTrend is ERODING), 0.8, 1.2)
```

### 9.2 Entry and exit

BUY and STRONG BUY are buy-side labels. An unheld name may enter only when unrestricted, selected label buy-side, any present gated label buy-side, mu ≥ 8%, R ≥ 0.60, conviction ≥ 45, age ≤ 150 days, and no buy lock or stale-entry block. A missing gated label alone does not block entry; disclose it.

A held name exits when restricted, selected label nonbuy, a present gated label nonbuy, mu < 3%, R null or < 0.15, or age > 150 days. Low conviction alone is not an exit rule. A held position with no usable analytical signal is frozen; an unexplained broker position or damaged ledger instead triggers reconciliation failure.

Restrictions are explicit account configuration containing security IDs and reasons. Restricted names cannot be purchased and are classified for disposal when held, subject to execution guards and active opposite-side fill locks. No security-specific restriction is hidden in engine code.

A separate read-only analytical eligibility view uses mu ≥ 5%, R ≥ 0.5, conviction ≥ 45, age ≤ 150 days, and the same selected/gated label tests. It does not replace trading thresholds.

### 9.3 Bear breaches, stale entries, and relabels

When current price falls below every scenario target, D is zero and R null. The special exception applies only when this null R is the sole exit reason. From immutable reference stock and SPY prices:

```text
stockReturn = currentStock/referenceStock - 1
marketContribution = beta*(currentSPY/referenceSPY - 1)
stockSpecificReturn = stockReturn-marketContribution
stockSpecificShare = stockSpecificReturn/stockReturn
```

Require positive valid prices and negative stock return. Share < 0.5 is market-driven and permits holding; 0.5 to < 0.9 freezes; ≥ 0.9 retains exit classification subject to locks. Missing attribution uses ordinary exit. Other exit reasons override this exception.

For unheld names, block stale entry when stock return ≤ -5%, stock-specific share ≥ 0.9, and a negative earnings surprise occurred on/before decision date within 120 days. Missing optional attribution/earnings data allows entry under this baseline, with a degraded-evidence warning.

Relabel advisories require three consecutive observed run days before requesting reanalysis. They cannot overwrite accepted labels or trigger additional trading.

### 9.4 Allocation, cash, and fill locks

Freeze weights that cannot currently change. Allocate at most `max(0,0.99-frozenWeight)` across eligible HOLD/ENTER names in proportion to positive scores. Repeatedly redistribute excess after a name reaches 10% or SIC sector reaches 30%; leave unallocatable weight in cash. Zero positive score allocates nothing further. Frozen holdings may cause realized cap breaches: disclose them rather than bypass locks.

Minimum target-weight dust threshold is zero. Cash floor is 1%; a 35% soft cash ceiling is a diagnostic, not a command to buy ineligible names or violate caps. Partial-buy top-ups are off.

Add/trim retained positions only when absolute target/current-weight difference exceeds 2.5 percentage points. EXIT requests liquidation. A buy fill prevents selling until the fifth subsequent exchange trading day; a sell fill similarly prevents buying. The release date permits trading, and same-side orders remain allowed. Derive locks from canonical fills and the versioned calendar.

If unexecuted trims or frozen holdings would push investment above 99%, scale down buys. Never spend expected proceeds from unfilled sells.

## 10. Automated execution and broker ownership

### 10.1 Private executor command contract

Proposed internal API, authenticated and unavailable to analytical model tools:

| Operation | Input | Effect |
|---|---|---|
| `POST /portfolio-commands` | account, strategy, ET date, slot, mode, stable command ID | Validate/claim slot, pin inputs, start or return run |
| `GET /portfolio-commands/{id}` | command ID | Return domain outcome even if Windmill job failed |
| `POST /reconciliation-commands` | account, incident/run ID, idempotency key | Serialize recovery/audit with account execution |
| `POST /controls/halt` | account, reason, control identity | Persist halt; prevent subsequent submissions |
| `POST /controls/resume` | account, expected halt version, reason | Clear only an eligible resolved halt after reconciliation |

Normal portfolio commands do not accept caller-supplied orders, arbitrary prices, strategy overrides, or a force-run flag. Mode transitions and deliberate manual runs are separate authorized operations. Preview run IDs are separate from the production slot claim so a preview cannot consume the day's actual decision slot.

The executor returns promptly with an accepted/command ID and runs the domain operation independently of the requesting HTTP connection. Windmill job cancellation does not cancel broker orders or undo fills. An explicit halt/cancel policy is required for execution control.

### 10.2 Slot ownership and the exactly-once boundary

Enforce a unique live slot claim on `(account_id, strategy_id, trading_date, slot)`. A re-delivered command returns the same logical run. Use a durable state machine, not a random run ID generated by each workflow attempt.

Slot states: `claimed -> reconciling -> planning -> executing -> auditing -> completed`; terminal alternatives include `closed`, `late`, `disabled`, `noop`, `halted`, and `needs_reconciliation`. Store detailed execution outcome separately from orchestration success.

One executor process owns an account, reinforced with an application database lock and ownership generation. Ownership loss stops new submissions. Do not automatically take over a live account solely because a heartbeat/lease expired: an old process may still be making a broker request. Establish that the old executor has stopped, reconcile all unresolved intents, then transfer ownership. Database fencing cannot retract a request already sent to a broker.

Neither Windmill nor PostgreSQL can atomically commit a broker order and a local row. The target is durable intent, idempotent command processing, and broker reconciliation—not a claim of universal exactly-once execution.

### 10.3 Order lifecycle

Before any external submission, persist the final intent and its deterministic client ID. Derive identity from stable domain run ID, security, side, trading date, and order leg. The same logical order must never get a new client ID because a workflow retries.

Lifecycle: `planned -> submitting -> acknowledged -> partially_filled/terminal`. Ambiguous responses move to `unknown`, blocking new submissions until reconciled. Terminal includes filled, canceled, expired, rejected, and other explicitly mapped terminal provider statuses.

| Crash/failure point | Recovery |
|---|---|
| Before durable intent | Nothing may be submitted; retry planning only if slot has not entered execution |
| Intent persisted, before send | Recovery still verifies whether sending began; do not assume a missing response proves no side effect |
| Request sent, response lost | Look up broker order through the provider adapter; do not resubmit |
| Ack received, local persistence fails | Halt new submissions; reconstruct from broker evidence |
| Partial fill, cancel uncertain | Retain committed cash and order uncertainty; reconcile until broker state is known |
| Notification failed | Retry notification from outbox; do not execute the portfolio again |

Absence from one broker lookup is not proof that a timed-out submission never happened. Query uncertain submissions after 2, 5, and 10 seconds; unresolved ambiguity blocks new submissions and escalates to reconciliation, never blind resubmission. Do not assume Schwab and Alpaca provide identical client-ID deduplication semantics.

### 10.4 Order construction and guards

Classify liquidity by market capitalization: large ≥ $10 billion, mid ≥ $2 billion, small below that; unavailable capitalization uses mid with a warning.

| Parameter | Large | Mid | Small |
|---|---:|---:|---:|
| Base limit tolerance | 0.15% | 0.35% | 0.80% |
| Maximum limit tolerance | 0.40% | 1.00% | 1.50% |
| Gap halt | 10% | 15% | 25% |
| Freshness | 5 minutes | 15 minutes | 60 minutes |
| Maximum market-leg spread | 1% | 1% | 2.5% |
| Diagnostic round-trip cost | 8 bps | 15 bps | 30 bps |

Decision marks prefer fresh trade, fresh valid quote midpoint, then settled prior close. Future timestamps do not qualify as fresh. A live price failing gap checks falls back to close for marking and must not authorize unsafe execution.

Execution anchor prefers fresh trade, then fresh ask for buys or bid for sells, then settled close. Gap reference prefers fresh trade, then valid quote midpoint, then close. The gap-reference midpoint need not meet freshness criteria, so a stale quote may conservatively halt execution; record this distinction.

Relative spread is `(ask-bid)/midpoint`, capped at 0.1 for tolerance calculation. Requested tolerance is max(half relative spread, base tolerance), with base multiplied by 1.5 for sells; clamp between 0.0005 and bucket maximum.

Price tick is $0.01 at/above $1, otherwise $0.0001, subject to verified broker acceptance. Buy limit is min(round-up(anchor*(1+tolerance)), round-down(anchor*(1+maximumTolerance))); sell limit is max(round-down(anchor*(1-tolerance)), round-up(anchor*(1-maximumTolerance))). Close-anchored buys halve intended size.

Fractional-mode entry minimum is $1; add/trim minimum max($1,0.005*NAV); exits have no minimum. Whole-share mode nonexit minimum is $25. Orders below $200 may be entirely market orders. Larger orders use a whole-share immediate-or-cancel limit leg followed by a fractional market remainder only after the whole-share leg fills. Market legs require fresh acceptable spreads. Floor sell quantities to four decimals without exceeding holdings.

Verify broker-specific capabilities. When immediate-or-cancel is emulated with a DAY order, cancellation and terminal polling are mandatory; uncertain cancellation blocks the fractional remainder. Client-ID lookup/deduplication semantics must be tested per provider.

Every submission checks kill switch, account/endpoint, restrictions, fill locks, price/spread/gap rules, cutoff, maximum 40 orders/run, and aggregate order notional ≤ one NAV. Available cash is broker cash plus confirmed sell proceeds minus committed buys and cash floor; no borrowing.

Turnover breaker is off by default. When enabled, limits are 15% of NAV per run and 25% per day. Clip buys in descending priority using whole orders; halt if required sells alone exceed limits. Daily accounting uses actual fills.

Three consecutive counted halts block further execution until a clean audited run or recorded operator resolution clears relevant state. Missing or critical post-execution audit keeps the account halted. No model calls or long review waits occur after live planning begins.

### 10.5 Modes and authentication

Disabled mode stops before broker calls. Preview reconciles and plans but never submits, invents fills, consumes a production slot, or contributes to turnover. Preview may update advisory relabel observations; it does not clear live halt history, while applicable early guards may still record halts.

Keep paper and live credentials/state separate and configure supported broker endpoints explicitly. After cutoff, cancellation and reconciliation may complete outstanding lifecycle work, but no new investment decision starts.

Authentication checks may use a configured seven-day refresh lifetime and 72-hour warning where appropriate, but actual token lifetimes and renewal rules must be verified per provider. Refresh is serialized by the credential owner; expired credentials block submission.

## 11. Persistence and consistency

### 11.1 Application tables

| Table group | Important constraints |
|---|---|
| `securities`, `coverage_memberships`, `filing_events` | Stable security identity; unique filing key; dated ticker mapping |
| `analysis_requests`, `outbox_events` | Durable discovery/dispatch; unique logical request/revision and event IDs |
| `source_artifacts`, `capture_manifests`, `fact_snapshots` | Immutable hashes; source/period/timestamp metadata |
| `assessments`, `scenario_sets`, `analysis_reviews`, `analyses` | Versioned input/output hashes; no mutable accepted content |
| `analysis_releases`, `release_members`, `active_release` | Immutable membership; transactional compare-and-swap pointer |
| `strategy_versions`, `model_profiles`, `provider_profiles` | Versioned behavior; secrets referenced, not copied into config history |
| `earnings_observations`, `market_snapshots`, `account_snapshots` | As-of timestamps; no future data in replay |
| `portfolio_runs`, `portfolio_decisions`, `slot_claims` | Unique production slot; pinned release/config; full diagnostic output |
| `order_intents`, `broker_observations`, `fill_events` | Unique intent/client IDs; idempotent fill accounting; immutable broker evidence |
| `account_controls`, `halt_events`, `relabel_state`, `auth_health` | Versioned controls and explainable changes |
| `audit_results`, `incidents`, `notification_outbox` | Reconciliation evidence and retryable operational messaging |

A broker order may have several partial fills: do not make `broker_order_id` alone the unique fill key. Use provider execution IDs when available; otherwise normalize cumulative execution observations into idempotent deltas and preserve corrections. Verify quantity and notional reconciliation, including changes to cumulative average price, using adapter-specific tests.

Materialized current positions/locks are derived from broker state and canonical fills with provenance. PostgreSQL becoming the local ledger does not make it more authoritative than the broker about executed trades.

### 11.2 Artifact storage

Begin with a persistent local artifact volume and a storage interface exposing immutable put/get/hash verification. An initial single-host deployment does not require an object-storage cluster. Add an S3-compatible backend only when multiple hosts or storage operations justify it.

Write and verify the artifact before committing database references. Orphaned artifacts can be garbage-collected after a retention delay; a committed accepted record must never reference a missing object. Use a tested local filesystem for atomic creation, and do not treat local rename behavior as a cross-host consistency guarantee.

Workers use isolated scratch directories per request. Temporary files are disposable; validated results and source bodies enter durable storage before a job completes. Workers never mutate shared active analysis files.

### 11.3 Recovery and retention

Back up application and Windmill databases, artifact manifests/bodies, deployment definitions, and the secret-encryption material needed for recovery. Keep backup storage off-host. Use a coordinated database snapshot and immutable-artifact retention so every restored reference resolves.

Order intents/fills and controls require a durable commit before the next external action; any database unavailability stops new submissions. Provider-side execution cannot be rolled back by restoring a database. Every restore starts disabled, revalidates tokens, reconciles since the last trusted checkpoint, and resolves uncertain orders before enabling execution.

Retain accepted analyses, configuration versions, source evidence, execution records, and corrections according to an explicitly adopted retention policy; do not inherit Windmill job-log expiry as the investment audit policy. A proposed operational target is daily backups plus database recovery tooling for finer recovery points, with restore time and acceptable data loss measured in drills rather than assumed.

## 12. Headless provider integrations

An interactive connector session is not automatically a headless container integration. Autonomous deployment requires explicit adapters:

| Input | Required interface |
|---|---|
| SEC filings/company facts | Filing and concept retrieval, period/unit normalization, raw bodies, shared limiter and contact identity |
| Prices/estimates/peers | Timestamped observations with corporate-action basis, market capitalization, analyst targets/estimates and comparison data |
| Optional financial vendor | Documented field definitions and permissions; versioned captured responses |
| Measured beta | Two-year weekly stock/SPY methodology and adjustment from section 5.5.2, with explicit fallback |
| Independent comparisons | Separate observations with periods and source identity; missing differs from FAIL |
| Earnings | Actual/estimated earnings, signed surprise with units, announcement date and availability timestamp |
| Qualitative evidence | Filing/proxy/context retrieval with attribution and known-at-time cutoff |
| Analytical author/reviewer | Headless model API, strict structured output, isolated review context, recorded model/prompt/budget |
| Broker | Account, clock, quotes, positions, submission, lookup, fills, cancellation, authentication and audit observations |

If a provider is available only through imported captures, label that coverage partially automated. A filing-only feed cannot be assumed to provide analyst estimates, earnings surprises, independent comparisons, or all qualitative context.

No provider substitution is assumed equivalent. Compare field definitions, periods, corporate-action adjustment, beta estimation, and earnings-surprise units. Record differences as source/profile versions and test their downstream effect.

Untrusted filings and retrieved text are evidence, never instructions to tools. Analytical model calls cannot access broker secrets, execute arbitrary scripts, edit strategy configuration, or override acceptance gates. New observations are inserted through capture adapters, not by model-authored changes to financial facts.

## 13. Deployment and operational configuration

### 13.1 Initial service layout

| Service | Persistence / credentials |
|---|---|
| `windmill-server` | Windmill DB credentials; management access kept private |
| `windmill-control-worker` | Windmill access plus narrowly scoped investment dispatch/command access |
| `windmill-capture-worker` | Pinned Node runtime/package; capture provider credentials; artifact access |
| `windmill-analysis-worker` | Pinned engine package; model resources; read evidence/write candidate privileges |
| `investment-executor` | Exactly one active process per account; broker secrets; account-state privileges |
| `postgres` | Separate databases/roles for Windmill and investment application state; durable volume |
| `backup-job` | Read/snapshot rights and off-host backup destination |
| Independent monitor | Outcome/health probes; no broker submit permission |

Tag routing alone is not access control. Scope worker identities, application DB roles, model tools, and filesystem mounts. Deployment must verify that analysis code cannot retrieve the executor's broker resource. Where the installed Windmill permission model cannot enforce the required split, keep broker credentials outside Windmill in the executor's secret mount.

Use a pinned TypeScript/Node toolchain and dependency lockfile to build a versioned engine package/custom worker image. Do not install dependencies or pull a moving Git branch on each analytical job. Queue jobs with engine/artifact hashes; reject execution on a mismatched worker version.

Windmill supports resources and encrypted secret variables. Use references rather than literal credentials in flow definitions/results; encrypted-at-rest secrets do not prevent a privileged script from printing them. [Resources](https://www.windmill.dev/docs/core_concepts/resources_and_types), [secrets](https://www.windmill.dev/docs/core_concepts/variables_and_secrets).

### 13.2 Implementation modules

Separate pure calculation modules, versioned contracts and schema migrations, provider and storage adapters, private account executor, thin Windmill scripts and flows, infrastructure definitions, numerical fixtures, and recovery tests. Engine mathematics has one implementation; wrappers import or invoke it. No module depends on narrative presentation or another application's source tree.

### 13.3 Configuration and release management

Store strategy policy separately from provider credentials. A strategy version includes desk thresholds, trade/portfolio config, macro constants, optional policy switches, calendar version, and deployed environment overrides that affect behavior.

Version flow definitions and deploy through the Windmill CLI from reviewed Git. The CLI supports scoped workspace synchronization; scope deployment carefully because sync can remove target items absent from the source. Native automatic Git synchronization has edition limits and is not required by this design. [CLI sync](https://www.windmill.dev/docs/advanced/cli/sync), [Git sync](https://www.windmill.dev/docs/advanced/git_sync).

Keep development, shadow, Alpaca paper, and live credentials/state separate. Release engine, schema, and flow versions with compatibility checks. in-flight runs keep their pinned compatible code; drain or finish them before incompatible upgrades. Never hot-replace the active account executor during unresolved order activity.

### 13.4 Operational outcomes and alerts

Store and expose machine-readable health and reason codes for:

- Analysis blocked by missing evidence, unresolved review, source conflict, or budget exhaustion.
- Filing request queued too long or dispatch repeatedly failing.
- Portfolio slot missed, closed, late, disabled, preview, noop, executed, halted, or awaiting reconciliation.
- Unknown submit, unexpected broker position, missing fill, cash discrepancy, or failed cancel.
- Authentication renewal approaching, refresh failure, stale calendar coverage, or unavailable database/artifacts.
- Backup missing, integrity check failed, or restore drill overdue.

Distinguish Windmill job failure from portfolio outcome and broker state. A network failure after a completed run must not trigger an “execute again” remediation. Alerts use a transactional outbox with stable event IDs; notification delivery failure must not retry trading or invalidate broker-proven outcomes.

## 14. Policy boundaries

| Baseline behavior | Change requiring separate evaluation |
|---|---|
| Fixed risk-free/ERP and specified beta method | Live macro assumptions or another estimator |
| Structured judgment and independent review | Fully mechanical scenarios or weaker review |
| Specified sizing and quality tilt | Kelly sizing, inverse volatility, new factors |
| Missing optional earnings warns but permits entry | Rejecting every missing optional observation |
| Selected and gated labels constrain portfolio | Substituting the advisory decision label |
| Context refresh preserves analysis age | Resetting age on quotes or mechanical rescore |
| Afternoon slot skips early-close sessions | Moving decisions earlier on those sessions |
| Calibration records outcomes | Automatic parameter optimization |

Missing optional evidence and corrupted required operational state are different cases. Missing optional earnings may warn; a damaged fill ledger or ambiguous broker order blocks execution.

## 15. Implementation sequence and completion gates

1. **Specify contracts and fixtures.** Build explicit expected-result cases for formulas, labels, null handling, dates, sector applicability, portfolio branches, and rounded orders. Freeze a policy manifest. Completion: fixtures are self-contained and reproducible.
2. **Implement the pure engine.** Build normalization, scoring, portfolio logic, and order calculations behind validated contracts. Completion: numerical and classification fixtures pass with declared tolerances.
3. **Deploy capture and structured analysis.** Add storage, provider limiter, durable requests/outbox, author/reviewer integrations, and immutable promotion into a shadow release. Completion: a filing becomes independently reviewed structured analysis without broker access or paper generation.
4. **Implement recoverable execution.** Add stable commands, ownership, intents, fills, controls, and audit. Use a fake broker and fault injection first. Completion: duplicates, crashes, outages, partial fills, and unknown submissions cannot cause blind second orders.
5. **Exercise shadow and paper trading.** Use fixed-clock replay and the actual Windmill-to-executor path. Require at least ten clean paper runs; extend coverage for untested calendar/recovery cases. Completion: no unexplained calculation differences or unresolved incidents; restore and drain procedures demonstrated.
6. **Enable controlled live operation.** Verify one scheduler and executor, accepted release, account policy, historical lock-relevant fills, open orders, controls, authentication, backups, and monitor. Reconcile broker truth before submission. Completion: verified state and successful post-run audit.
7. **Optimize from measurements.** Tune caching, batching, concurrency, storage, and provider use against observed bottlenecks. Completion: lower latency/cost without changed calculations, review coverage, or recovery guarantees.

Rollback means halting new submissions, resolving outstanding orders, reconciling fills and controls, and selecting one compatible executor version. Restoring a stale database/image without subsequent broker activity is not a valid rollback.

## 16. Verification matrix

| Test group | Required cases |
|---|---|
| Analysis equivalence | Gate, moat, DCF sensitivity, composite, uncertainty, four labels, conviction and reasons on identical fact snapshots/scenarios |
| Coverage | Banks/utilities/industrials, missing estimates, short history, negative earnings, spin-offs/restatements, disputed FCF/share counts |
| Judgment validation | Probability errors, wrong scenario ordering, shallow bear, inconsistent selected label, unsupported source claim, missing counter-case |
| Review integrity | Changed facts/context/policy/scenarios invalidate review; author cannot approve itself; bounded repair exhaustion |
| Release consistency | Concurrent promotions, stale older result, missing artifact, running slot pinned to old release |
| Signal/sizing | Live remarking, raw versus sizing R, age rounding, quality tilt, caps/cash feasibility, frozen/locked positions |
| Trade semantics | Entry/exit asymmetry, account restrictions, five-day locks, market/mixed/stock breach, missing inputs, stale-entry earnings gate |
| Timing | DST transitions, holidays, early closes, delayed queues, missed slots, cutoff reached mid-loop, restarted scheduler |
| Orders | Small market orders, whole/fractional dependency, gap halt, stale/wide quote, partial fills, failed cancellation |
| Idempotency | Duplicate delivery before/after ack, stable IDs, crash after send, missing ack, repeated broker observations |
| Persistence/recovery | DB unavailable, artifact unavailable, restore from older checkpoint, executor ownership loss, old process still alive |
| Isolation | Analysis cannot read broker credentials, arbitrary flow cannot submit an order, preview cannot consume live slot |
| Provider compatibility | Beta method, units, filing periods, timestamps, corporate-action basis, cross-check override scope |

For deterministic arithmetic, use a documented tight absolute/relative tolerance; for classifications, reason codes, target membership, quantities after prescribed rounding, and order identity, require exact agreement. Use fixed captured market data and clock for every fixture replay. Comparing two live runs with different quotes does not establish a regression.

Normalize incidental timestamps in fixture comparisons, but compare deterministic order IDs using the same logical run identity. Within operational retries, preserve actual IDs exactly.

Forecast-quality evaluation is separate from deterministic correctness. Evaluate new structured scenarios on blinded representative historical evidence, without future observations. Report deviations instead of forcing the generator to reproduce known later outcomes. No return guarantee follows from implementation correctness.

## 17. Acceptance definition

The redesign is implemented when all of the following hold:

1. A filing enters a durable queue, receives complete source capture or explicit missing-data status, and produces a validated structured analysis without a paper.
2. All substantive analytical domains specified here are covered; no presentation-only field is required for acceptance.
3. Calculations and portfolio rules pass the self-contained expected-result fixtures.
4. New analyses preserve source lineage, assumptions, independent review, dates, policy versions, and all labels/score outputs.
5. Routine accepted analyses and daily portfolio decisions run automatically; only documented exceptions require intervention.
6. Portfolio runs consume immutable releases and cannot mix ticker versions mid-run.
7. A single account executor applies the specified trading policy and survives duplicate workflow delivery without blindly resending orders.
8. Broker fills, locks, cash, halts, and audits survive restarts and tested recovery.
9. Headless provider coverage is proven; any remaining manual connector import is explicitly labeled partial automation.
10. Operational health, missed-slot detection, authentication renewal, backups, and rollback have been exercised.
11. No dashboard, report website, PDF, or equity-paper generation is part of the runtime path.

## 18. Decisions and implementation prerequisites

### Design decisions

- **D1 — Centralize calculations:** use one pure engine; Windmill coordinates, rather than reimplementing rules in flow expressions.
- **D2 — Make analysis the product:** strict structured records replace the paper as the investment contract.
- **D3 — Retain judgment:** scenario/qualitative analysis remains, with bounded model calls and independent review; new math is not smuggled in as automation.
- **D4 — Use immutable releases:** accepted inputs are versioned and pinned for each portfolio slot.
- **D5 — Centralize broker side effects:** one executor owns account mutations; Windmill delivers idempotent commands.
- **D6 — Use application-owned persistence:** PostgreSQL state and artifact references survive Windmill job retention and retries.
- **D7 — Target Community-capable operation:** application correctness does not rely on enterprise concurrency, automatic Git sync, or advanced worker-management features.
- **D8 — Preserve operating defaults:** stronger policy choices require explicit versioned changes, not silent infrastructure edits.

### Prerequisites to resolve before production implementation

| Item | Default design / required decision |
|---|---|
| Windmill release and edition | Pin a tested Community-capable baseline; verify selected release features |
| Hosting capacity | Single host initially; measure capture/model concurrency and reserve executor resources |
| Analytical model/provider | Select headless author/reviewer access; record model versions, spending limits and data-handling constraints |
| Provider integration | Prove headless access for earnings/beta/cross-check and optional vendor context; otherwise document partial automation |
| Effective live configuration | Record account mode, restrictions, and all nonsecret behavior settings; validate and hash the effective configuration |
| New-analysis auto-activation | Enable only after numerical and structured-analysis evaluation; clean routine analyses then auto-promote |
| Missing optional data | Use the fallback semantics specified here; changes require a separate policy version |
| Historical rescoring | Explicitly choose which versions may be rescored; stored accepted decisions remain immutable unless explicitly superseded |
| Backup objectives and retention | Adopt measured recovery targets and retention before live cutover |
| Broker lifecycle validation | Confirm adapter behavior for account permissions, fractional orders, lookup ambiguity, and token rotation |

These are deployment inputs, not reasons to leave the core architecture undefined. The proposed implementation can proceed in shadow mode while provider/account choices are finalized.

## 19. External references

Windmill official documentation supports the orchestration and deployment choices:

- [Self-hosting](https://www.windmill.dev/docs/advanced/self_host)
- [Scheduling](https://www.windmill.dev/docs/core_concepts/scheduling)
- [Retries](https://www.windmill.dev/docs/flows/retries)
- [Concurrency](https://www.windmill.dev/docs/flows/concurrency_limit)
- [Workers](https://www.windmill.dev/docs/core_concepts/worker_groups)
- [Resources](https://www.windmill.dev/docs/core_concepts/resources_and_types)
- [Secrets](https://www.windmill.dev/docs/core_concepts/variables_and_secrets)
- [CLI synchronization](https://www.windmill.dev/docs/advanced/cli/sync)
- [Git synchronization](https://www.windmill.dev/docs/advanced/git_sync)

The analytical and operating rules are specified in this document. These links explain the orchestration platform rather than substituting for financial-policy definitions.
