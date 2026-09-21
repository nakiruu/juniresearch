# Rating Score — Design

**Date:** 2026-09-21
**Status:** Approved design, pending spec review → implementation plan
**Author:** Nico (Juniper Finance Research Desk) with Claude

## Goal

Make the rating a **deterministic, risk-aware function of the calls the author
already makes**, and show the reader the two numbers it rests on. Today the
label is a five-point bucket applied by feel to one point estimate (the
probability-weighted fair value); this design derives it from the fair-value
upside **and** the bear-case downside, adds the guard that makes the bear
honest, and renders the result — with no new inputs from the author.

Triggered by an audit of all 20 published reports on 2026-09-21. The label
distribution is 13 BUY / 7 HOLD and no report has ever used STRONG BUY, SELL
or STRONG SELL, for structural reasons:

- **STRONG BUY is nearly unreachable.** Fair value is a probability blend, so
  the house's habitual ~25% bear weight drags every fair value under the
  +25% line: KTOS, NVDA, AVGO and ORCL all land at +21–23%.
- **SELL is dead code.** All 20 reports have positive fair-value upside
  (minimum CME, +1.4%); the process anchors the base case above price.
- **The overlap zone is decided by feel.** Nine reports sit at +10.5%…+15%,
  where BUY and HOLD are both valid: CRWV at +12.5% is HOLD, ICE at +12.4%
  is BUY.
- **The envelope is risk-blind.** CRWV (+12.5% fair value, −51% bear) and BAC
  (+11%, −16% bear) sit in the same band.
- **Probabilities are a template.** 18 of 20 reports use exactly 0.25/0.5/0.25
  or 0.3/0.45/0.25, so "probability-weighted" carries almost no information
  beyond the base case.
- **The bear is unenforced.** House style says "the bear scenario is a real
  scenario, not a formality," but nothing checks it; WFC's bear is −9.4% and
  NEE's −10.2%, which quietly inflate fair value.

## Design principles

1. **Computed, never authored.** Every new number is derived in code from the
   existing `rating` and `scenarios` fields. The `Judgment` schema does not
   change; every existing judgment file still parses.
2. **Two honest numbers, one ratio.** Expected upside and bear-case downside
   are shown to the reader; the label follows from them. No opaque 0–100
   score on the report page.
3. **Conviction may differ from arithmetic; contradiction may not** (the
   existing principle, kept). The author may be one notch *more conservative*
   than the derived label, never more aggressive.
4. **Thresholds live in `desk.json`**, and the authoring prompt renders them
   from there, so the rule the author reads and the rule the validator
   enforces cannot drift.
5. **Published reports are untouched.** Validation runs at build time; the 20
   existing `data/*.json` files still parse and render (the new field is
   optional) and are not re-rated.

## The measures

Let `price` be `pack.quote.price`, and `bull`, `base`, `bear` the three
scenarios' `impliedPrice`. All three are already validated: exactly three,
named `Bull`/`Base`/`Bear`, probabilities sum to 1 (±0.001), bull ≥ base ≥
bear, and the target range brackets `base`.

| Measure | Definition | Notes |
|---|---|---|
| **Expected upside** `E` | `fairValue / price − 1`, where `fairValue = Σ impliedPrice × probability` | Unchanged from today (`computeScenarios` + `upside`). |
| **Bear-case downside** `D` | `(price − bear) / price` | The loss to the bear case, as a positive magnitude. |
| **Reward/risk** `R` | `E / D` when `D > 0`; otherwise `null` | Expected upside earned per unit of bear-case loss. A bear at or above the current price has no defined ratio; the bear floor (below) turns that into a build error, so a `null` never reaches a published report. |

A new pure function carries these:

```ts
// lib/format.ts
export interface Conviction { expectedUpside: number; bearDownside: number; rewardRisk: number | null }
export function computeConviction(scenarios: ScenarioIn[], price: number): Conviction
```

It finds the bear by name (`/bear/i`, the same match `ratingIssues` uses) and
reuses `computeScenarios`. It never throws: with three valid scenarios it
always returns `E` and `D`, and `R` is `null` exactly when `D ≤ 0`.

## The label rule

The label becomes a function of `(E, R)` — a two-dimensional envelope with
**no overlap**, replacing the one-dimensional overlapping `ENVELOPES` table.

```ts
// lib/format.ts
export function deriveLabel(c: Conviction, cfg: DeskRating): RatingLabel
```

Evaluated top to bottom; the first rule that matches wins:

| Derived label | Rule (desk defaults in parentheses) |
|---|---|
| STRONG SELL | `E ≤ strongSell.maxUpside` (−20%) |
| SELL | `E ≤ sell.maxUpside` (−5%) |
| STRONG BUY | `E ≥ strongBuy.minUpside` (+20%) **and** `R ≥ strongBuy.minRewardRisk` (1.0) |
| BUY | `E ≥ buy.minUpside` (+10%) **and** `R ≥ buy.minRewardRisk` (0.5) |
| HOLD | otherwise |

`R` is `null` only when the bear floor also fails, in which case the build
already stops; for the derivation a `null` `R` never satisfies a `≥` test, so
the label falls through to HOLD.

The sell side stays one-dimensional (upside only). Downside asymmetry is the
right lens for a long recommendation; a short-side analogue is out of scope
(see below) and the sell bands are kept exactly as today.

**Author discretion — the one-notch rule.** The author's `rating.label` must
be **either** the derived label **or** exactly one notch more conservative:

| Derived | Also allowed |
|---|---|
| STRONG BUY | BUY |
| BUY | HOLD |
| HOLD | — |
| SELL | HOLD |
| STRONG SELL | SELL |

Any other label is a build error (see *Errors*). This keeps the spirit of the
existing rule — a conservative label passes, a contradiction fails — while
ending the overlap zone: the derived label is the same for the same numbers,
and an *upgrade* beyond it is never allowed.

### Validation against the published record

Re-applying the rule to the 20 published reports with the desk defaults
reproduces the desk's own label in 19 cases and disagrees once:

| Ticker | E | D | R | Published | Derived |
|---|---|---|---|---|---|
| KTOS | +22.8% | 37.0% | 0.62 | BUY | BUY |
| NVDA | +22.8% | 29.3% | 0.78 | BUY | BUY |
| AVGO | +21.6% | 30.9% | 0.70 | BUY | BUY |
| ORCL | +21.0% | 36.7% | 0.57 | BUY | BUY |
| NEE | +18.7% | 10.2% | 1.83 | BUY | BUY |
| WFC | +15.0% | 9.4% | 1.60 | BUY | BUY |
| LLY | +14.0% | 21.1% | 0.66 | BUY | BUY |
| HON | +13.7% | 15.6% | 0.88 | BUY | BUY |
| CRWV | +12.5% | 50.6% | 0.25 | HOLD | HOLD |
| ICE | +12.4% | 13.2% | 0.94 | BUY | BUY |
| **AMD** | **+12.1%** | **32.6%** | **0.37** | **BUY** | **HOLD** |
| BAC | +11.0% | 15.9% | 0.69 | BUY | BUY |
| EWBC | +11.0% | 17.3% | 0.64 | BUY | BUY |
| V | +10.5% | 15.8% | 0.66 | BUY | BUY |
| CBRS | +7.5% | 40.2% | 0.19 | HOLD | HOLD |
| UEC | +6.1% | 30.9% | 0.20 | HOLD | HOLD |
| JPM | +5.8% | 17.1% | 0.34 | HOLD | HOLD |
| T | +5.6% | 20.8% | 0.27 | HOLD | HOLD |
| INTC | +3.5% | 38.2% | 0.09 | HOLD | HOLD |
| CME | +1.4% | 16.7% | 0.08 | HOLD | HOLD |

The one disagreement is the point: AMD's +12.1% expected upside is bought
with a −33% bear, a reward/risk of 0.37 — the label rule says HOLD, and the
author's BUY would be a disallowed upgrade. No published report earns STRONG
BUY; the four names above +20% all carry deep bears. That is the honest
answer, and it is why the label could never reach the top band under the old
one-dimensional rule.

## Guards

**Bear-depth floor (build error).** `bear ≤ price × (1 − bearFloor)`, default
`bearFloor = 0.15`. A bear case closer to the price than the floor is not a
real scenario and would otherwise inflate both `E` and `R`. On the published
record this would fire for NEE (10.2%), WFC (9.4%) and ICE (13.2%) if they
were rebuilt — by design.

**Target-low on a buy (lint warning, not an error).** On BUY or STRONG BUY,
`targetLow < price` makes the page's "Upside Potential" line read negative
(V today: "−6.3% to +23.5%"). It is a *warning* because the house's range is
a "where it could trade" band that brackets the base case, not a Street-style
price target, and 7 of the 13 published BUYs have a low end below price; an
error would force a change of meaning on rebuild. The warning tells the
author to raise the low end or address it in the prose. Symmetrically, on
SELL or STRONG SELL a `targetHigh > price` warns. HOLD is unconstrained.

**Kept unchanged:** probabilities sum to 1, bull ≥ base ≥ bear, exact
scenario names, the target range brackets the base case, `targetLow <
targetHigh`.

## Architecture

```
desk.json  ─ rating thresholds ─┐
                                ├─► renderPrompt      (Calls text quotes the thresholds)
judgment.json ─ rating+scenarios┤
                                ├─► mergeReport       (Report.rating.conviction = computeConviction)
pack.quote.price ───────────────┤
                                ├─► validateJudgment  (ratingIssues: derived label, one-notch, bear floor)
                                └─► lintJudgment      (target-low warning; needs price)
Report ─► RatingBlock (third row: E · D · R)   Report ─► renderJudgmentBlock (E, D, R quotable)
```

### Components and files

**`lib/synth/desk.schema.ts`** — new `DeskRating` block with defaults,
following the `DeskLint` pattern (strict object, per-field defaults, a
`DESK_RATING_DEFAULTS` constant, a whole-block default):

```ts
export const DESK_RATING_DEFAULTS = {
  bearFloor: 0.15,
  strongBuy: { minUpside: 0.20, minRewardRisk: 1.0 },
  buy:       { minUpside: 0.10, minRewardRisk: 0.5 },
  sell:      { maxUpside: -0.05 },
  strongSell:{ maxUpside: -0.20 },
};
```

Refinements (each a clear message): `0 < bearFloor < 1`;
`buy.minUpside < strongBuy.minUpside`; `buy.minRewardRisk ≤
strongBuy.minRewardRisk`; `strongSell.maxUpside < sell.maxUpside < 0 <
buy.minUpside`; all ratios `> 0`. `Desk` gains `rating: DeskRating`.
`data/desk/desk.json` carries the block explicitly (the committed desk.json
carries every block explicitly today; the schema test asserts it).

**`lib/format.ts`** — `computeConviction` and `deriveLabel` as above, plus
one formatter `rewardRiskText(r: number | null): string` → `"0.66×"` (two
decimals, `×`) or `"—"` when `null`. `E` and `D` use the existing `pct(x, {
signed: true })` (`"+10.5%"`, `"−15.8%"` — `D` is displayed as a negative
move, i.e. `pct(-D, { signed: true })`).

**`lib/report.schema.ts`** — `rating` gains an **optional** `conviction`:

```ts
conviction: z.object({
  expectedUpside: z.number(),
  bearDownside: z.number(),
  rewardRisk: z.number().nullable(),
  derivedLabel: RatingLabelEnum,
}).optional(),
```

Optional because `lib/reports.ts` parses every `data/*.json` at site build
and the 20 published reports do not carry it.

**`lib/synth/merge.ts`** — `mergeReport` sets
`rating.conviction = { ...computeConviction(scenarios, facts.quote.currentPrice), derivedLabel: deriveLabel(…, desk.rating) }`.
`merge.ts` already receives `desk`; the price comes from `facts.quote`
(`currentPrice`), the same value `validateJudgment` receives as
`pack.quote.price`.

**`lib/synth/validate-judgment.ts`** — `ratingIssues(j, currentPrice, cfg:
DeskRating)` replaces the `ENVELOPES` constant and its check with: derive
the label; if `j.rating.label` is neither the derived label nor its
one-notch-conservative alternative, push the label issue; push the bear-floor
issue when `bear > price × (1 − cfg.bearFloor)`. The scenario-name and
bull ≥ base ≥ bear checks are unchanged. `validateJudgment(j, facts, pack,
desk)` gains the fourth parameter and passes `desk.rating` through.
`ENVELOPES` is deleted (its only consumers are this file and its test).

**`lib/synth/lint.ts`** — `lintJudgment(j, desk, ctx?: { currentPrice: number
})` gains an optional context; when `currentPrice` is present, a new
warning-severity rule `rating/target-low` fires for a low end below price on
a buy label (or a high end above price on a sell label). Without the context
the rule is skipped, so existing callers and tests are unaffected.

**`scripts/synth-build.ts`** — passes `desk` to `validateJudgment` and `{
currentPrice: pack.quote.price }` to `lintJudgment`. No other change: merge
still runs before validation, and validation issues remain build errors,
lint warnings remain warnings.

**`lib/synth/prompt.ts`** — `CALLS` becomes `renderCalls(desk.rating)`. The
rating bullet is replaced with three, rendered from the config so the numbers
the author reads are the numbers enforced:

```
- Rating: the page derives a label from two numbers you set through the scenarios —
  expected upside E (probability-weighted fair value vs the current price) and bear-case
  downside D (bear implied price vs the current price), with reward/risk R = E ÷ D.
  STRONG BUY needs E ≥ +20% and R ≥ 1.0; BUY needs E ≥ +10% and R ≥ 0.5; SELL is
  E ≤ −5%; STRONG SELL is E ≤ −20%; anything else is HOLD. Your label must be the derived
  label or one notch more conservative (STRONG BUY→BUY, BUY→HOLD, SELL→HOLD,
  STRONG SELL→SELL); a more aggressive label fails.
- Bear case: the Bear implied price must sit at least 15% below the current price — a
  bear scenario is a real scenario, not a formality.
- On a BUY, a target low below the current price makes the page's upside line read
  negative; the lint warns so you can raise it or address it in the prose.
```

(Percentages and ratios are interpolated from `desk.rating`, not typed.)
The existing "numbers you may quote from your own calls" bullet is extended
to name expected upside, bear-case downside and reward/risk.

**`renderJudgmentBlock`** (in `validate-judgment.ts`) — appends three lines
so the author can cite the values without a grounding failure, formatted
exactly as the page renders them:

```
Expected upside +10.5%
Bear-case downside −15.8%
Reward/risk 0.66×
```

**`components/report/RatingBlock.tsx`** — when `rating.conviction` is
present, a third row under the two existing ones:

```
Expected upside +10.5% · Bear case −15.8% · Reward/risk 0.66×
```

Same border/typography as the "Upside Potential" row. Absent on the 20
published reports (no `conviction`), so their pages are unchanged. Section 8
reuses `RatingBlock`, so the row appears in both places automatically.
`ScenarioTable` is unchanged (it already shows the weighted fair value).

## Errors and messages

All are `ValidationIssue`s with the field the author must fix.

| Condition | Field | Message |
|---|---|---|
| Label neither derived nor one notch conservative | `rating.label` | `BUY is inconsistent with the derived HOLD (expected upside +12.1%, reward/risk 0.37×); allowed: HOLD` — the "allowed" list names the derived label and, when one exists, its conservative alternative |
| Bear above the floor | `sections.valuation.scenarios[bear].impliedPrice` | `bear case $78.00 is only 9.4% below the price; the desk floor is 15% — a bear scenario is a real scenario, not a formality` (WFC's shape) |
| Target low below price on a buy (lint **warning**) | `rating.targetLow` | `target low $345.00 sits 6.3% below the price on a BUY, so the upside line will read negative; raise the low end or address it in the prose` |
| Target high above price on a sell (lint **warning**) | `rating.targetHigh` | mirror wording |

The existing messages for scenario names, ordering, probability sum and
bracketing are unchanged.

## Data flow (one build)

1. `synth:prompt` renders the Calls section from `desk.rating` — the author
   sees the thresholds.
2. The author writes `rating.label`, `targetLow/High`, and three scenarios,
   as today.
3. `synth:build`: `mergeReport` computes `rating.conviction`; `Report.parse`
   validates it; `validateJudgment` derives the label and applies the
   one-notch and bear-floor rules; `lintJudgment` emits the target-low
   warning; the gated editorial review is unchanged.
4. The page renders the third rating row; the quotable block lets the author
   cite `E`, `D` and `R` in the valuation prose.

## Testing

Table-driven, matching the existing `withRating(label, [bull, base, bear])`
harness (price 100, probabilities 0.3/0.5/0.2). The old envelope table is
replaced, because several of its rows have a bear at or above price and now
fail the floor by design.

- **`format.test.ts`** — `computeConviction`: `E`, `D`, `R` for one shape
  worked by hand; `R` is `null` when `bear ≥ price`; `deriveLabel` for every
  band boundary (each `≥`/`≤` at, just below and just above the threshold),
  and the AMD shape (`E` 12.1%, `D` 32.6%) → HOLD; `rewardRiskText` for a
  number and for `null`.
- **`validate-judgment.test.ts`** — the one-notch rule: every derived label ×
  every author label (25 cases) with the expected pass/fail; the bear floor
  at, just inside and just outside 15%; the label message names the derived
  label and the allowed set; `renderJudgmentBlock` contains the three new
  lines in the page's format.
- **`desk.schema.test.ts`** — defaults fill when the block is absent; each
  refinement rejects an inverted or out-of-range value with its message; the
  committed `desk.json` carries the block explicitly.
- **`lint.test.ts`** — target-low warning fires on BUY/STRONG BUY with a low
  end below price, the mirror on SELL/STRONG SELL, never on HOLD, and never
  without `currentPrice`.
- **`merge.test.ts`** — `conviction` is populated from the scenarios and the
  quote price; `derivedLabel` matches `deriveLabel`.
- **`report.schema.test.ts`** — a report without `conviction` still parses
  (the published-report guarantee).
- **`RatingBlock`** render test — the third row appears iff `conviction` is
  present, with the exact text.
- **`prompt.test.ts`** — the Calls text interpolates the desk thresholds
  (change a threshold in a test desk, assert it appears).
- **Regression** — the golden AVGO judgment still builds: its shape
  (`E` +21.6%, `D` 30.9%, `R` 0.70, label BUY) derives BUY.

## Migration and compatibility

- **Judgment files:** no schema change; all existing judgments parse.
- **Published reports:** `conviction` is optional; all 20 `data/*.json` parse
  and render unchanged. Nothing is re-rated.
- **Rebuilds:** re-running `synth:build` on an existing name applies the new
  rules. On the current record that means AMD's label (BUY → derived HOLD),
  and the bear floor for NEE, WFC and ICE. These are intended.
- **`ENVELOPES`:** removed; no external consumer.

## Out of scope (follow-ons, not part of this design)

- A sortable 0–100 score for the `/research` index. The report page shows the
  three honest numbers; a single scalar for ranking coverage is a separate,
  small design once these exist.
- A multi-factor scorecard (quality, leverage, moat, Street) — richer, but it
  needs arbitrary weights and mixes facts with judgment.
- A short-side asymmetry rule (a "reward/risk" for SELL labels).
- Re-rating the 20 published reports.

## Decisions to confirm at spec review

1. **Bear floor = 15%.** It trips three of twenty published bears on rebuild.
   10% would trip none of the published names (WFC's 9.4% would still fail);
   20% would also catch HON (15.6%), BAC (15.9%), V (15.8%), CME (16.7%),
   JPM (17.1%) and EWBC (17.3%).
2. **STRONG BUY = E ≥ 20% and R ≥ 1.0.** No published report qualifies under
   this; lowering the ratio to 0.75 would admit NVDA (0.78).
3. **Target-low as a warning, not an error** (rationale above).
