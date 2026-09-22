# Rating-Driven Portfolio — Conceptual Outline

**Status:** design only (v0). No implementation. This document reasons through the
math and the mapping from published judgments to portfolio weights. It is the
brief a later spec → plan → build would execute against.

**One-sentence goal:** turn the desk's live set of published reports into a single,
mostly-invested, long-only equity book plus cash that behaves like an actively
managed ETF — holding the *subset* of BUYs that are worth holding, at sizes set by
edge, risk, and the desk's own confidence, rebalanced as reports change.

**Design premise — this is a long-horizon *fundamental* book.** The alpha is the gap
between price and a fundamental fair value that closes over quarters to years, not a
short-term technical edge. That one fact drives every choice below and separates this
system from a fast, technical, high-turnover, large-universe trader:

- **Horizon:** ~12-month scenario targets (theses can run 1–3 years) → alpha decays
  slowly → **low turnover is correct**, not a cost to be minimized away.
- **Cadence:** the natural clock is the **filing / report cycle** (a new 10-Q/10-K →
  a new judgment) plus catalysts — *event-driven*, not calendar or technical.
- **Universe:** ~22 names, not hundreds → estimation error dominates → robust,
  near-1/N sizing beats optimization (§6).
- **Risk unit:** the risk that matters is *the thesis being wrong* — captured
  natively by the Bull/Base/Bear scenarios (§3) — **not** intraday price volatility.
  Trailing price vol is at most a secondary, mark-to-market comfort check.
- **Cost:** infrequent trades in liquid large-caps → transaction cost is a footnote,
  not a core gate.

The theory invoked below (growth-optimal Kelly sizing, estimation-error robustness,
effective breadth, the transfer-coefficient haircut) is horizon-agnostic
institutional active-management theory — Grinold & Kahn's *Active Portfolio
Management* is a *fundamental*-manager text — applied here to fundamentals. None of it
is a port of a short-term technical design.

---

## 1. Framing decisions (what kind of portfolio)

Three choices shape all the math. Recommendations in **bold**; each is an open
decision (§12).

- **Direction — long-only. [DECIDED]** The desk publishes mostly BUY/HOLD; SELL is
  rare (0 of 22 today). A long-only book that expresses SELL/STRONG SELL only as
  *absence* (→ cash) captures almost all the signal without the machinery, borrow
  cost, and risk of a short sleeve. A short sleeve is *far* down the road — not v2.
- **Return objective — absolute, benchmark-aware. [DECIDED]** Judged on absolute
  return, but tracked against **two** benchmarks (§9): an equal-weight of the full
  covered universe (the primary *skill* test) and **SPY** (the *product* bar).
- **Cash — a first-class, *bounded cash-emergent* position.** Cash emerges from the
  sizing math (§6) — the book is only as invested as the eligible set's edge
  justifies — but is clamped to a band so it is a bottom-up *de-risking* lever, never
  a top-down *market-timing* bet the desk has no edge on (§9). Cash *competes*
  against every BUY (Grinold & Kahn: cash carries an opportunity cost the book must
  clear).
- **Delivery — analytical → paper → real. [DECIDED]** v1 is an *analytical artifact*:
  given the current report archive + live prices, emit the target book as a **CSV/JSON
  snapshot** (weights, cash, per-name rationale, benchmark stats) — "see how the
  portfolio looks." Only once it looks promising *and* coverage has grown does it
  progress to paper trading, then real capital. No live execution in v1.

---

## 2. The signal surface we already have (per name, per report)

Every published `Report` already carries everything v1 needs — no new data plumbing:

| Field | Symbol | Role in the portfolio |
|---|---|---|
| `sections.valuation.scenarios[]` (Bull/Base/Bear `impliedPrice`, `probability`) | — | **the return distribution** (see §3) |
| `rating.conviction.expectedUpside` | `E` | expected return `μ` |
| `rating.conviction.bearDownside` | `D` | downside / tail risk |
| `rating.conviction.rewardRisk` | `R = E/D` | asymmetry filter |
| `rating.decision.conviction` (0–100) | `κ·100` | **confidence** → Kelly-fraction shrink |
| `rating.decision.tier` (high/mod/low) | — | coarse confidence (already in the 0–100) |
| `rating.decision.moat` (width/trend/contingent/bearFloor) | — | quality tilt; downside floor |
| `rating.decision.intrinsic.marginOfSafety` | `MoS` | quality/value corroboration |
| `rating.decision.composite.percentile` (0–100) | — | cross-sectional quality tilt |
| `rating.decision.uncertainty.tier` | — | risk widener (already in the 0–100 — mind double-count) |
| `rating.gate.gatedLabel` / `distress` / `confidence` | — | **eligibility hard filter** |
| `rating.label` (5-level) | — | eligibility (BUY/STRONG BUY only, v1) |
| `quote.price`, `week52`, `history` (~30 closes) | `P0` | re-marking, (thin) realized vol |
| `analystSentiment` (targets, dispersion) | — | external cross-check on `μ`, `σ` |
| `meta.asOf` / `filing.filedDate`, `sic` | `τ`, sector | staleness decay; sector caps |

The portfolio engine is therefore a **pure function of the report archive at a point
in time, plus a live price quote** — the same architecture as the scoring layer.

---

## 3. The core idea: the three scenarios *are* a return distribution

This is what makes the whole system tractable without a covariance matrix. For name
`i`, each scenario `s ∈ {Bull, Base, Bear}` gives an implied price `P_s` with the
author's probability `p_s` (Σ p_s = 1). Against the **current** price `P0`:

```
r_{i,s} = P_s / P0 − 1                        # scenario return
μ_i     = Σ_s p_s · r_{i,s}                   # expected return  (== conviction.E, re-marked to P0)
σ_i     = sqrt( Σ_s p_s (r_{i,s} − μ_i)² )    # scenario-implied volatility
σ⁻_i    = sqrt( Σ_{s: r<0} p_s · r_{i,s}² )   # downside semi-deviation (tail)
```

`μ_i` and `σ_i` come from the *same* judgment, so they are internally consistent and
need no external estimation. Three consequences:

1. **Risk is free.** We get a per-name risk number (`σ_i`) with zero extra data.
2. **It re-marks.** Recompute `r_{i,s}` against the *live* `P0`, not the report's
   as-of price. A BUY that has already rallied to its Base case has small `μ_i` now —
   it self-demotes without a re-rating. (The stored `conviction.E` is as-of the
   report; the engine must recompute against today's price.)
3. **Caveat — it is a 3-point, lower-bound dispersion.** Real outcome distributions
   have fatter tails than three mass points. Treat `σ_i` as a *relative risk ordering
   across names*, not a calibrated volatility. v2 can widen the tails and cross-check
   against realized price vol, but the scenario spread stays the primary,
   horizon-matched risk (§11).

**Horizon note — and why scenario risk is the *right* risk here.** The scenario
prices are ~12-month fair-value targets, so `μ_i, σ_i` are ~annual, thesis-level
figures — consistent across names, which is what cross-sectional sizing requires.
Crucially, for a long-horizon fundamental book the risk that should size a position is
the *dispersion of fundamental outcomes* (will the thesis play out?), which is exactly
what the Bull/Base/Bear spread measures — not trailing price volatility, a technical,
short-horizon risk. So `σ_i` here is not a stopgap for a missing vol estimate; it is
the horizon-appropriate risk unit. One rebalance period ≈ the target horizon for
absolute-Kelly calibration.

---

## 4. Eligibility — "are all BUYs worth holding?" → **No.**

A BUY label is *necessary but not sufficient*. A name enters the eligible set `𝓔`
only if it clears every gate below. Everything that fails falls to cash/bench.

1. **Direction:** `label ∈ {BUY, STRONG BUY}` (long-only v1). HOLD → bench (cash),
   never a short; SELL/STRONG SELL → excluded (v1).
2. **Fundamental gate not binding:** `gatedLabel ∈ {BUY, STRONG BUY}`. This is the
   payoff of the scoring layer — a BUY whose distress/quality gate caps it to HOLD
   (e.g., a levered, low-Piotroski name) is *not* eligible even though the author
   said BUY.
3. **Still cheap at the live price:** re-marked `μ_i(P0_now) ≥ μ_min` (e.g. +5–10%).
   Rallied-to-target names drop out here.
4. **Asymmetry:** `R_i ≥ R_min` (≥ 0.5 is the BUY floor; 0.6–0.7 to be selective).
5. **Confidence:** `conviction ≥ κ_min` (e.g. ≥ 45–50). A barely-BUY at low
   conviction and very-high uncertainty is a weak hold; drop it.
6. **Freshness:** `τ_i = today − asOf ≤ staleness_max` (e.g. 120 days).
7. *(optional)* uncertainty ≠ veryHigh unless conviction compensates.

This filter, plus the sizing floor (§6) and sector caps (§7), is the multi-layer
answer to the question: the book holds a **concentrated subset** of the BUYs, and
the marginal BUY earns a marginal (often sub-threshold → zero) weight.

---

## 5. From judgment to the four sizing inputs

For each `i ∈ 𝓔` collapse the signal surface into four scalars:

- **Edge `μ_i`** — scenario expected return, re-marked to live price (§3).
- **Risk `σ_i`** — scenario-implied vol, floored at `σ_min` to avoid divide-by-near-zero
  when scenarios are tight; optionally `max(σ_i, σ⁻_i·√2)` to respect fat downside.
- **Confidence `κ_i = conviction/100 ∈ [0,1]`** — the desk's single best "how much do
  we trust this whole view," already net of gate/moat/value/dispersion/uncertainty
  penalties. Used as the Kelly-fraction shrink (Bayesian fractional Kelly: shrink the
  bet as prior uncertainty rises — López de Prado 2020). **Use `κ` OR an explicit
  uncertainty-widening of `σ`, not both** — `conviction` already docks for
  uncertainty, so widening `σ` again double-counts.
- **Quality tilt `q_i ∈ [0.8, 1.2]`** — a *modest* nudge from slow-moving quality:
  ```
  q_i = clamp( 1 + a·(composite_pctile−50)/50 + b·moat_score − c·eroding , 0.8, 1.2 )
  ```
  Keep it small; these sub-signals are noisier than `μ/σ`. Its job is to break ties
  toward durable, cross-sectionally cheap names, not to dominate.
- **Staleness `δ_i = exp(−τ_i / H)`** (half-life `H` ≈ 90 d) — a soft decay layered on
  the hard cutoff in §4.6.

---

## 6. Sizing — confidence-shrunk fractional Kelly, rank-and-cap

**Why not mean-variance optimization?** With ~14 BUYs, `Σ⁻¹μ` amplifies estimation
error catastrophically (Michaud 1989); DeMiguel-Garlappi-Uppal (2009) show you would
need ~250 years of data to reliably beat naive 1/N at this asset count. So the core
is deliberately **covariance-free rank-and-cap sizing**, which is a near-optimal
response to estimation error — not a simplification we apologize for.

**Step 1 — raw fractional-Kelly weight.** Single-name Kelly is `f* = μ/σ²`. Full
Kelly on a single equity is wildly aggressive (a name with `μ=20%, σ=25%` implies
`f*=3.2×` NAV), so we apply a Kelly fraction `α` *and* the confidence shrink:

```
wᵢ_raw = α · κᵢ · (μᵢ / σᵢ²) · qᵢ · δᵢ
```

with `α ∈ [0.25, 0.5]` (half-Kelly keeps ~0.75 of the log-growth at far lower
drawdown — MacLean/Thorp/Ziemba 2011). Calibrate `α` so a *reference* name
(`μ=15%, σ=25%, κ=0.6, q=1`) lands near a sensible target weight (~6%): that gives
`α ≈ 0.4`, comfortably inside the fractional-Kelly band.

**Step 2 — hard per-name cap.** `wᵢ = min(wᵢ_raw, w_max)`, `w_max ≈ 8–12%`. Because
raw Kelly is large for high-conviction names, **the cap binds for the strongest
names** and Kelly mainly differentiates the mid-tier. This is a feature: the book
*degrades gracefully to capped quasi-equal-weight when convictions are uniformly
strong* (the DeMiguel-robust regime) and *tilts + de-risks when they are dispersed
or weak*.

**Step 3 — sector caps.** Group by SIC → coarse sector. If `Σ_{i∈sector} wᵢ >
sector_max` (≈ 25–30%), scale that sector's names down proportionally (or trim
lowest-score first). This is our correlation control in place of a covariance matrix
— two bank BUYs cannot both run to the cap.

**Step 4 — min-position floor.** Drop `wᵢ < w_min` (≈ 1–2%); their weight → cash.
This is where the weak, sub-threshold BUYs actually leave the book (§4).

**Step 5 — cash and the invested fraction (bounded cash-emergent).**
```
invested = Σ wᵢ
if invested > 1 − cash_floor:   scale all wᵢ by (1 − cash_floor)/invested   # no leverage
else:                            cash = 1 − invested                         # hold cash
cash = clamp(cash, cash_floor, cash_ceiling)                                 # then re-scale wᵢ to fit
```
Cash *emerges* from how much genuine edge-per-unit-risk the eligible set offers —
many strong names → near fully invested (cap-bound); few weak/dispersed names → real
cash — but it is **clamped** to `[cash_floor ≈ 1–2%, cash_ceiling ≈ 25–35%]`. The
ceiling breaks only when the eligible set is genuinely near-empty (`|𝓔| < ~3–4`), so
the book never silently becomes a cash fund on a noisy `σ` estimate. The design
intent (see §9): the invested fraction tracks **bottom-up breadth × conviction**
(how many good names, how good) — which the desk can assess — and never a top-down
market-valuation call, which it cannot.

> **Alternative worth noting (decouples "who" from "how much invested"):** size
> *shares* Kelly-proportionally (`wᵢ ∝ κᵢ μᵢ/σᵢ²`, normalized to a target invested
> level) and set the *invested level* separately from an aggregate strength gauge
> (breadth × average conviction). Cleaner separation; slightly more knobs. The
> absolute-Kelly form above is the recommended v1 for its self-calibration.

---

## 7. Constraints (the risk envelope)

- **Per-name cap `w_max` — default 10%, exposed as a tunable knob. [DECIDED]**
  (Practitioner single-name norm is 3–5% for a hundreds-name book; a deliberately
  concentrated ~10-name conviction book runs higher.) It is a first-class parameter
  of the engine, alterable per run, so the concentration/diversification trade-off
  can be dialed without a code change.
- **Sector cap** ~25–30% by SIC group.
- **Min position** 1–2% (dust → cash, controls churn).
- **Cash** floor 1–2%, soft ceiling ~30–40%.
- **Concentration / effective breadth.** Track `N_eff = 1 / Σ wᵢ²` (inverse
  Herfindahl). Grinold-Kahn: a 30–100-name book has only 5–20 *independent* bets
  under sector correlation, so our ~14 BUYs are ~6–10 effective bets — set a floor
  like `N_eff ≥ 5` so the book is never one or two names in a trench coat.
- **Turnover — kept deliberately low.** This is a slow book: the default between
  fundamental updates is to *hold*. Trade a name only when a new report changes its
  judgment, its eligibility flips, or its weight drifts past a *wide* no-trade band
  (≈ 2–3%). The enemy is churning on interim price noise between quarterly reports,
  not intraday microstructure cost — so the bands are wide and the clock is the
  filing cycle, not the calendar.

---

## 8. Rebalancing and point-in-time discipline

- **Triggers, in priority order:** (a) a new report or re-rate is published (the
  primary clock); (b) a catalyst or price move large enough to flip a name's
  eligibility — it rallies through its Base case, or a gate trips; (c) an infrequent
  drift check (e.g. monthly) to catch names that have quietly breached the wide
  no-trade band. Day-to-day price wiggles trigger nothing.
- **Re-mark continuously, trade rarely.** Marks (μ, σ vs live price, §3.2) can update
  as often as we like for *monitoring*; *trades* fire only on the triggers above.
  This is what keeps the book honest between reports without churning it.
- **Point-in-time, for backtest and attribution:** snapshot `{report set, prices,
  resulting weights, cash}` at each rebalance. Never use a report before its
  `filedDate` (look-ahead), and keep names in the backtest even after coverage drops
  (survivorship). This snapshot store is the same one the deferred expectations /
  revisions sleeve wants — build once, serve both.

---

## 9. Benchmark, attribution, governance

**Two benchmarks, two questions.** A benchmark does three jobs — attribution (skill
vs luck), risk framing (active weights, tracking error), and the eventual marketing
bar. No single benchmark does all three well at this coverage size, so track two:

- **Primary — equal-weight of the *full* covered universe** (every name with a live
  report: BUY, HOLD *and* SELL). This isolates **selection + sizing skill**: does
  concentrating in high-conviction BUYs and holding cash on the rest beat naively
  owning everything we analyzed? It holds the coverage set fixed, which matters
  because *we chose what to cover* (a self-selected, ~22-name, tech/financial-tilted
  universe) — so it controls for that selection bias. It must include the HOLDs and
  SELLs, or we would hide the value of *avoiding* them. Not investable, not
  market-representative — a diagnostic, not a marketing number.
- **Secondary — SPY** (S&P 500 ETF): the investor's real alternative and the eventual
  product bar. Understood to be noisy as a *skill* measure at this size: beating it
  conflates rating skill with the coverage set's sector tilt vs the market.

**Two honest caveats on both.** (i) At ~22 names both benchmarks are statistically
thin — a few names drive everything, so early benchmark-relative numbers are
directional, not conclusive; they sharpen as coverage grows (the analytical → paper →
real progression). (ii) Cash is a *deliberate* position: it drags in up-markets and
cushions in down-markets by design, so the comparison must credit the risk reduction,
not just penalize the drag (report both raw and risk-adjusted active return).

**Attribution & governance.**

- **NAV & return:** compound the weighted holding-period returns plus cash drag.
- **Active return & tracking error** vs each benchmark.
- **Attribution:** contribution by name and by rating tier (does STRONG-conviction
  actually outperform mid?), by sector, and *selection vs sizing* (did we hold the
  right names, and did we size them right?).
- **Calibration loop:** compare realized returns to the scenario `μ_i`/`σ_i` that
  sized them. Systematic optimism in the authored Bull cases, or `σ` that
  under-predicts realized moves, feeds straight back into the desk's rubric.

---

## 10. Why the variables map the way they do (the reasoning, condensed)

- **`μ` (edge) in the numerator, `σ²` (risk) in the denominator** is Kelly — the
  growth-optimal answer to "how much of a bet with this edge and this risk." Both
  come from the scenarios, so the *author's own probabilities* set both the size and
  the risk of the bet.
- **`κ` (conviction) shrinks the whole bet** because it is the desk's calibrated
  trust in the view; a low-conviction +20% upside should not be sized like a
  high-conviction one. This is the Bayesian-fractional-Kelly result, and it reuses
  the 0–100 score the scoring layer already produces (so gate, moat, intrinsic and
  dispersion all flow into size through one clean channel).
- **The gate is a *filter*, not a *weight*** because distress/quality is
  non-compensatory: no amount of upside should make you hold a name that might not
  survive. This mirrors the scoring layer's one-way gate.
- **Quality (moat/composite) is a *small tilt*** because it is real but slow and
  noisy relative to price-based edge; it breaks ties, it does not drive the book.
- **Correlation is handled by *sector caps*, not a matrix,** because estimating a
  14×14 covariance from 30 daily closes is worse than useless (Michaud) — a hard
  sector cap is a robust, transparent proxy until we carry enough history.
- **Cash is sized by *what is left after Kelly*** because "nothing is cheap enough"
  is itself a position an active manager takes.

---

## 11. Honest caveats (what this outline is *not* claiming)

- **Transfer coefficient.** Long-only + caps throttle how much of the paper signal
  reaches realized return: realized IR ≤ `TC × paper IR`, `TC ≈ 0.3–0.6` for
  constrained long-only mandates (Clarke-de Silva-Thorley 2002). **Halve any
  backtest Sharpe** before believing it.
- **Thin risk inputs — but the right *kind* of risk.** `σ_i` is a coarse 3-point
  spread, so treat it as an ordering, not a calibrated vol. This is a limitation of
  *resolution*, not of *kind*: fundamental-outcome dispersion is the correct risk for
  this horizon. Realized price vol (only ~30 closes today) is a secondary
  mark-to-market check to add later, never the missing primary input.
- **No look-ahead-free backtest yet** — needs the point-in-time snapshot store (§8).
- **Small, correlated book.** ~6–10 effective bets; do not oversell diversification.
- **Reports are authored one-at-a-time,** not as a portfolio — crowding and
  correlation are the portfolio layer's job to impose, not the author's.
- **Fractional Kelly and hard caps are load-bearing,** not decorative: full Kelly on
  single equities implies multiples of NAV per name.

---

## 12. Phased roadmap

- **v1 — buildable on today's data, output-first.** Scenario-implied `μ/σ`,
  confidence-shrunk fractional Kelly, eligibility gate, hard per-name (10% knob) +
  sector caps, min-position floor, bounded-emergent cash, dual benchmark. A pure,
  deterministic, testable function of the report archive + a live price refresh, whose
  product is a **CSV/JSON target-book snapshot** (holdings, weights, cash, per-name
  `μ/σ/κ/R`-and-rationale, and benchmark stats) — "see how the portfolio looks." No
  execution, no live NAV.
- **v2 — richer risk & truth.** Longer price history (≥250–400 closes) as a
  *secondary* drawdown / mark-to-market check on the scenario risk, not a
  replacement; an optional *slow* (6–12-month) fundamental-momentum / earnings-revision
  tilt; a *light*, Ledoit-Wolf-shrunk covariance used only for sector/factor-exposure
  control (not full MVO); point-in-time snapshots → real look-ahead-free backtest &
  attribution; a short sleeve for SELL/STRONG SELL (long-short / 130-30).
- **v3 — principled blend & execution.** Black-Litterman (market-implied prior +
  our `E` as views, view-uncertainty from `1 − κ` and dispersion); factor
  neutralization; transaction-cost-aware optimizer with the turnover budget; live or
  paper NAV tracking.

---

## 13. Decisions log & remaining calibration

**Locked (Nico, this pass):**

1. **Long-only.** Short sleeve is far down the road, not v2.
2. **Benchmark = both** — equal-weight-coverage (primary, skill) + **SPY**
   (secondary, product). §9.
3. **Cash = bounded cash-emergent** — Kelly-emergent, clamped `[~1–2%, ~25–35%]`,
   breadth-driven not timing-driven. §6 step 5, §9.
4. **Max single-name weight = 10%, exposed as an alterable knob.** §7.
5. **Delivery = analytical (CSV/JSON snapshot) → paper → real**, gated on the book
   looking promising and coverage growing. §1, §12.

**Still to calibrate at build time (parameters, not architecture):**

- Holding *count* is **emergent**, not targeted — it falls out of the eligibility
  gate + Kelly + caps + cash. (With today's ~14 BUYs and a 10% cap, expect roughly
  8–12 holdings; thin early coverage will read cash-heavy — a coverage artifact, §9.)
- Eligibility thresholds: `μ_min`, `R_min`, `κ_min`, `staleness_max` (§4).
- Kelly fraction `α` (target ~0.4, i.e. sub-half-Kelly), `σ_min` floor, quality-tilt
  gains `a,b,c` and band, staleness half-life `H`.
- Cap set: `sector_max`, `w_min` (dust), `cash_floor`, `cash_ceiling`, no-trade band.

These are best set empirically against the first CSV/JSON snapshots (does the book
*look* right?) and, later, against the point-in-time backtest — not guessed up front.
