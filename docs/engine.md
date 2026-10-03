# Juniper Engine — Functional Reference

> A single end-to-end description of how the engine turns a published research report into
> live orders: how a *buy* is derived, how the engine interprets it, how buys and sells are
> sized and placed, and every piece of math and statistics in between.
>
> **Status:** the research → rating → portfolio path and the trade layer (Alpaca paper / Schwab live,
> Discord notifier, schedulers) are on `main`. The 2026-09-26 engine review
> (`docs/superpowers/specs/2026-09-26-engine-improvements-design.md`) and its six-phase plan are
> implemented; defaults quoted here are the code defaults after it. Opt-in behaviour is marked
> "default off".
>
> **How to read the callouts:** "💡" marks a defensible alternative that is still *not* built (deferred,
> usually waiting on data). "🚫 Not an option" marks an alternative that was ruled out — by the owner's
> trading rules, the live broker, or because it didn't survive quantification — don't propose it again.
> Adopted ideas are described in place as normal text.

---

## 0. The pipeline at a glance

```
 research report                signal                 book                    trades                 orders                fills
 (scenarios, rating)   ─►  buildSignal (μ,σ,R,κ,Q) ─► sizePortfolio ─► emitTrades (hysteresis+band) ─► tradesToOrders ─► broker
 lib/synth/*, data/<t>.json     lib/portfolio/signal    lib/portfolio/sizing   lib/trade/rebalance        lib/trade/orders     lib/broker/*
                                                             │                        │  +limit.ts (pricing)      +audit, breakers
                                                        (analytical snapshot)    (ledger, locks, breakers, cron)
```

Two consumers share the same signal layer:

- **`portfolio:build`** — the *analytical* snapshot & dashboard. Prices from Yahoo. Read-only, no broker.
- **`trade:plan` / `trade:execute` / `trade:cron`** — the *trading* engine. Prices, positions, and fills
  from the broker (Alpaca paper or Schwab live). The trade layer adds hysteresis, locks, the no-trade
  band, slippage-capped limit pricing, run breakers, a broker-truth audit, and notifications on top of
  the same sizing core.

Everything below follows a single name from report to fill.

---

## 1. Where a "buy" is born — the research & rating layer

A *buy* is not decided by the engine; it is **inherited from the published report** and then re-tested
against live price. The report (`data/<ticker>.json`, authored via the `synthesize` skill) carries a
valuation with **probability-weighted scenarios** — each an `impliedPrice` and a `probability` — and a
`rating`.

### 1.1 Conviction: E, D, R  (`lib/synth/conviction.ts`)

```
fairValue        = Σ pᵢ · impliedPriceᵢ                 (probability-weighted)
E (expectedUpside) = fairValue / price − 1
D (bearDownside)   = (price − bearImpliedPrice) / price   (the scenario named "bear")
R (rewardRisk)     = E / D           (null when D ≤ 0 — no downside to divide by)
```

`E` is the reward, `D` the bear-case loss, `R` the reward earned per unit of bear-case risk. `R` is the
engine's central risk unit and recurs at every later stage.

### 1.2 The label (`deriveLabel`)

Bands are evaluated top-down; first match wins; a null `R` never satisfies a `≥` test:

```
E ≤ strongSell.maxUpside                                   → STRONG SELL
E ≤ sell.maxUpside                                         → SELL
E ≥ strongBuy.minUpside  AND R ≥ strongBuy.minRewardRisk  → STRONG BUY
E ≥ buy.minUpside        AND R ≥ buy.minRewardRisk         → BUY
else                                                      → HOLD
```

The author may publish **one notch more conservative** than the derived label (STRONG BUY→BUY→HOLD…),
never more aggressive (`conservativeNotch`).

### 1.3 The gate and decision conviction (`lib/synth/decide.ts`, `gates.ts`)

A separate scoring layer produces:

- **`rating.gate`** — a sector-aware quality gate (distress, Piotroski, accruals, moat) that yields a
  **`gatedLabel`** *ceiling*. A name can be headline-BUY but gate-capped to HOLD (e.g. RCAT, UMAC on
  earnings quality). The engine requires **both** labels to be buy-side.
- **`rating.decision.conviction`** — a **0–100** score from a penalty model over the gate + intrinsic
  reverse-DCF + moat (ROIC−WACC) + a cross-sectional composite percentile. This becomes **κ** downstream.
  The intrinsic discount rate and the moat WACC share one cost of equity, `rf + β·ERP`, where β is the
  FactPack's **measured beta** (2y weekly vs SPY, Blume-adjusted, clamped [0.3, 2.5]; `lib/facts/beta.ts`,
  captured from Shibui Finance) and the SIC sector proxy only when none was captured.

> 💡 **Deferred — point-in-time FactPacks (goodwill basis).** A pack's statement columns mix bases after a
> spin-off (DD's FY23+ revenue is restated for the Qnity spin, FY21–22 as reported; T's FY21 includes
> WarnerMedia). Goodwill is stamped on the latest-filed (restated) basis, so for the years in
> `goodwillRestated` the moat's ex-goodwill ROIC can mix bases; `moatRead` flags them. Rebuilding the
> statements from SEC would not fully fix it — a 10-K recasts only 3 years of income statement and 2 of
> balance sheet, so the oldest years of a 5-year history stay pre-spin in any filing — and neither goodwill
> basis changed a moat verdict (measured 2026-10). Instead both engines drop pre-spin years with one rule,
> `portfolioBreakIndex` (a > 20% revenue drop in a pack whose history a later 10-K restated): DD, GE, MDU,
> MMM today. A cyclical collapse with no restatement (ZBRA 2023, MP, UEC) is kept as evidence. Revisit the
> rebuild only if a moat or DCF verdict is found to hinge on mixed-basis years.

> 💡 **Deferred — re-building published reports.** `rating.decision` (conviction, moat, intrinsic) is
> persisted in each `data/<ticker>.json` when `synth:build` runs, and the portfolio reads κ from there.
> The 2026-10 scoring changes (measured beta, the reverse-DCF fixes, robust DCF penalty, SBC/goodwill/TTM
> FCF capture, the Shibui input check and TTM SBC) therefore reach sizing only when a report is re-built
> (`synth:build <T> <ACC> --date <original date>`). Measured against the stored decisions, a re-build would
> move 46 convictions (42 up, 4 down: DSP, GE, RDVT, VRT). FOUR and DSP's published reports were also written
> on an overstated FCF (docs/superpowers/specs/2026-10-03-crosscheck-input-review.md) and need re-synthesis, not
> just a re-build. Held back by the owner until a deliberate rollout.

**P(touch fair value) — display only (`lib/portfolio/touch.ts`).** A GBM first-passage probability,
`P = Φ((νT−b)/σ√T) + e^{2νb/σ²}·Φ((−b−νT)/σ√T)` with `b = ln(FV/S₀)`, σ from the report's ~30 recent
closes, T = `touchHorizonYears` (1) and drift `touchDrift` (0). Signals carry it as `touch`; the snapshot
shows it (`pTouchFV` in the CSV). It is **never** a sizing, eligibility or tie-break input: on the
published reports it tracks realized volatility (Spearman +0.73) and runs against R (−0.58), so ranking on
it would tilt the book toward volatile names. Read it as "is this target plausible within a year?"

**Wider bullish bands under uncertainty (`decide()` policy, both off by default).**
`applyUncertaintyBands` scales the BUY / STRONG BUY minimum upside by the uncertainty tier (×1 / 1.2 /
1.8 / 2.5, driven by analyst-target dispersion and other risk points); `applyDispersionBands` scales it by
the author's own scenario dispersion, `clamp(σ / 0.25, 1, 2.5)`. They combine by max and can only lower a
label. Both live in the advisory `decide()` layer: the published label is still validated against the
fixed `deriveLabel` bands, so turning either on never invalidates a published report. On the current 68
reports, dispersion bands would change one label (EVLV STRONG BUY → BUY, already published as BUY).

---

## 2. The Signal — a report as numbers  (`lib/portfolio/signal.ts`)

`buildSignal(report, livePrice, sic, today, config)` re-marks the report against the **current price** and
produces the vector every later stage consumes. Let `rᵢ = impliedPriceᵢ / livePrice − 1`:

```
μ  (mu)        = Σ pᵢ · rᵢ                         expected upside (== E, but vs LIVE price)
σ  (sigma)     = √( Σ pᵢ · (rᵢ − μ)² )             scenario standard deviation
σ↓ (sigmaDown) = √( Σ_{rᵢ<0} pᵢ · rᵢ² )            downside semi-deviation
D              = max(0, −min rᵢ)                   worst-scenario loss magnitude
R              = μ / D    (null if D ≤ 0)          reward / risk
κ  (kappa)     = decision.conviction / 100         0..1
Q  (quality)   = clamp( 1 + 0.10·(pctile−50)/50 + 0.20·(moat−0.5) − 0.10·[eroding], 0.8, 1.2 )
staleness      = 0.5 ^ ( ageDays / 90 )             soft recency decay (true half-life 90d)
sector         = ⌊SIC / 100⌋   (2-digit group)
```

where `moat = {WIDE:1, NARROW:0.5, NONE:0, unknown:0.25}`, `pctile` is the composite percentile, and
`[eroding]` is 1 when the moat trend is ERODING.

Notes that matter downstream:
- **μ is re-marked to live price** every run — as price rises toward fair value, μ (and R) fall. This is
  what makes the book mechanically buy dips and trim rallies.
- **R here uses the empirically worst scenario** as the bear, which equals the report's named bear when
  that is the lowest leg (the usual case).
- **Near the bear price, R explodes.** Re-marking shrinks D as the price falls: at the bear price D = 0 and
  R = μ/D → ∞; below it R is null. The desk floor guarantees D ≥ 15% only at the *publication* price (median
  held D is ~0.6× the name's annual realized vol, so a bear touch is routine — ~58% within a year for the
  median holding under GBM). The sizers therefore floor D (§3.2) and the gates read a null R as a bear breach,
  which holds, freezes or exits a held name by the cause of its fall (§4.2).

> 💡 **Deferred — the scenario σ is fragile.** σ and σ↓ come from a **3-point** distribution; a
> point-mass estimator of variance is noisy. A blend with trailing realized volatility would steady it —
> but σ feeds production nowhere (the score sizer ignores it; only the unexposed kellyTilt `invSigma` core
> reads it), so this waits until invSigma is actually A/B'd, and then on ≥252 closes rather than the ~30
> the reports carry (`realizedVol` now exists in `lib/portfolio/touch.ts`).

> 🚫 **Not an option — σ↓ as the risk unit.** With 3 scenarios and one leg below price (66 of 68
> reports), σ↓ = √p_bear · D exactly, so μ/σ↓ = R/√p_bear: Spearman(R, μ/σ↓) = 0.996, and swapping it into
> the score moves 1.8% of the book. It adds no information over R. Revisit only if reports move to 5+
> scenarios.

---

## 3. Interpreting the buy — eligibility & the target book  (`lib/portfolio/sizing.ts`)

The analytical book (`portfolio:build`) turns Signals into target weights. The trade layer reuses this
exact code and only swaps the *entry/exit test* for a two-sided band (§4).

### 3.1 Eligibility gate  (`lib/portfolio/eligibility.ts`)

A name is **eligible** only if *all* hold (defaults in parentheses):

```
not banned (ICE hard-ban, §3.5)
label ∈ {BUY, STRONG BUY}          AND   gatedLabel ∈ {BUY, STRONG BUY}
μ ≥ muMin (0.05)
R ≥ rMin  (0.50)          (null R fails)
κ·100 ≥ convictionMin (45)
ageDays ≤ stalenessMaxDays (120)
```

Every ineligible name is retained in the snapshot's `excluded[]` with its reasons, so the screen stays
auditable (this is what the dashboard's "Considered & excluded" panel renders).

### 3.2 The score (production sizer)  (`scoreWeight`)

```
R_size = μ / max(D, bearFloor)            = R · min(1, D / bearFloor)      (sizingRewardRisk; bearFloor 0.15)
score  = μ^muExp · κ^convExp · R_size^rExp · staleness · (Q if useQualityTilt else 1)
       = μ¹ · κ¹ · R_size¹ · staleness     (defaults: all exponents 1, tilt off in the analytical snapshot)
```

Weight is then allocated *in proportion to score*, so the best names on (expected return × conviction ×
reward/risk) become the largest holdings. Exponents are tunable knobs (`--muExp/--convExp/--rExp`).

**The bear floor (`bearFloor`, default 0.15 = the desk's `rating.bearFloor`).** Without it, μ·R = μ²/D: as a
name slides toward its bear price the score explodes and the name goes to the cap a few percent above the
bear, then exits one tick below it (§4.2). Measured 2026-10-03: BAC, 9.7% lower 17 days after publication
(6.9% above its bear), moved from 0.9% to 7.1% of the book; traced down, it hits the 10% cap 5% above the
bear. The 3-point scenarios put zero mass below the bear, so "D → 0" is model error, not a riskless bet — the
desk already refuses to publish a bear less than 15% below the price. Flooring D at the same depth keeps a
falling name's score rising (μ still grows, BAC 0.9% → 3.5%) but finite and continuous. It changes nothing at
publication prices (every D ≥ 0.15) and only sizing: eligibility and the hysteresis gates keep the raw R.
At or below the bear (D = 0, R null) R_size = μ/bearFloor, its value just above — reached only by a
market-driven breach the trade layer holds (§4.2); a null R fails eligibility, so the analytical book never
sees it. `--bearFloor 0` restores the raw R (the trade layer then needs `breachPolicy: "exit"`).

> 🚫 **Not an option — mean-CVaR allocation.** Single-name CVaR at α ≤ p_bear *is* the bear-leg loss D
> (already in R), and a portfolio CVaR needs a joint scenario distribution the reports don't have. Assuming
> comonotonic bears makes it an LP whose solution is bang-bang — 10 names at the cap, or 5 names and ~50%
> cash at λ = 1 (N_eff ≤ 10 vs 26 today) — a cruder, more concentrated μ − λD that drops κ and per-name
> explainability. The `μ·κ·R` score stays.

> 🚫 **Not an option — a historical Expected Shortfall (or inverse-vol) overlay from daily returns**
> (`w × min(1, ES_target/ES_i)`, ES from 252 daily closes). Daily ES is ≈ 2.3× daily σ, so this is an inverse-vol
> tilt on a horizon (one day) that is not the thesis horizon (~12 months). The data is unsafe as an input:
> Shibui/Yahoo closes are split- but not spin-adjusted (DD's Qnity spin prints as a −57.5% day and inflates its
> ES), new listings (SOLS) and names Shibui lacks (NVT) have short or no history, and the headless trade layer
> cannot call Shibui. It also does not answer the critique it was proposed for: D already tracks realized vol
> (Spearman +0.75), so R is vol-neutral (−0.06). On the 2026-10-03 book it cut model book μ by 0.9pp (21.1% →
> 20.2%) for 17% less trailing vol — only worth having if μ is overstated for volatile names, which is the
> question below.

> 💡 **Deferred — a risk-aware tilt, gated on calibration.** The score leans toward volatile names (Spearman
> +0.34 with realized vol among holdings; book vol 48% vs 45% equal-weight) because authored μ rises with vol
> (+0.63) while R does not. Growth-optimal sizing penalizes a name's covariance with the book (≈ λ·βᵢ, λ =
> β_book·σ²_m ≈ 0.04), not its own vol, and the FactPacks already carry measured β. At face-value μ that
> penalty barely moves the book (5% turnover, β 1.14 → 1.11), because the claimed upsides dwarf the variance
> drag. It matters only if μ's information content b (realized excess ≈ b·μ) is well below 1. The evidence
> points that way for sell-side targets:
> - claimed undervaluation is realized at 16–18¢ per $ (Green, Hand & Sikochi 2024), on upside *above* the analyst's
>   cost of equity (≈ 11%) and mostly within two quarters;
> - optimism grows with β, idiosyncratic vol and small size (Brav & Lehavy 2003; Dechow & You 2020).
>
> But the right book swings widely across b. The penalty in model-μ units is λ/b, so at b ≈ 0.17 the change
> is 31% turnover and 43 of 49 names go to ~0. That is too large to set from a prior. Decide once the
> calibration log (`lib/calibration/realized.ts`) gives a slope b, and a vol gradient, at d63/d126 on ≥ 10 names.
> Details: `docs/superpowers/specs/2026-10-03-engine-audit-review.md` §3.

### 3.3 Water-fill allocation with caps  (`allocateCapped`)

`target = 1 − cashFloor` (0.99) is distributed proportional to score, then **water-filled**:

1. Hand out remaining capacity ∝ score; any name reaching **wMax (0.10)** is clamped and frozen.
2. Any sector over **sectorMax (0.30)** is scaled to exactly the cap and frozen; the shed weight returns
   to the next pass.
3. Repeat until the remainder is placed or nothing else can absorb it.

Freed weight flows to the **best remaining names**, never leaking to cash or flattening everyone to the
cap. If the caps *cannot* absorb the target (too few names/sectors), the shortfall becomes cash — the
honest "not enough to hold under the caps" outcome, **never leverage**.

Then **dust** below `wMin` (default 0 → keep every eligible name) is dropped and survivors re-allocated to
a fixed point. `cash = 1 − Σ weights` (emergent, never a target).

### 3.4 Portfolio statistics  (`lib/portfolio/benchmark.ts`, snapshot)

```
activeWeight_i  = w_i − 1/N_universe          tilt vs a naive equal-weight of the WHOLE research universe
N_eff           = 1 / Σ w_i²                  inverse-Herfindahl effective number of names (diversification)
portfolio upside = Σ w_i · μ_i                book-level weighted expected upside
```

> ⚠️ **Read `activeWeight` correctly.** The benchmark is a **1/N equal-weight of the covered universe**,
> not the S&P 500. A name sized below 1/N legitimately shows a small negative tilt.

> ⚠️ **N_eff counts names, not bets.** On the 2026-10-03 book (49 names, N_eff 32.7) the trailing-year
> diversification ratio Σwσ/σ_p was 2.10, so DR² ≈ 4.4 independent bets. Book beta to SPY was 1.44, and
> correlation with SPY 0.84. An equal-weight book of the same names scores DR² ≈ 4.6. The caps are not at
> fault: every long-only stock book is mostly one market factor. Sector caps are a coarse proxy for the
> rest. SIC 2-digit splits one theme across "sectors". On that book, semis, electronic components and
> data-center power (AIP, AVGO, LRCX, MPWR, NVDA, LASR, VSH, VICR, VRT, LTRX, EVLV) held 30.8%, across SIC
> 35/36/37. The largest SIC-2 sector was 21.3%, so the 30% cap never bound on the theme.

> 💡 **Deferred — a GICS industry-group (or correlation-cluster) cap.** Would bind the theme above. Profit
> effect unknown: it trims the highest-μ cluster, so at face-value μ it costs expected return. Revisit with
> the risk-aware tilt, once calibration says how far to trust μ.

### 3.5 The hard ban (compliance, not a knob)  (`BANNED_TICKERS`)

`ICE` is hard-banned — the owner is an ICE employee. The ban lives **outside** `PortfolioConfig` so no
flag or override can switch it off, short-circuits eligibility, is re-checked in `sizePortfolio` (defense
in depth), and is re-checked again at the emitter and broker guard (§4, §5). ICE still surfaces in
`excluded[]` (as a BUY) so the ban stays visible every run.

### 3.6 The experimental alternative — kellyTilt  (`lib/portfolio/sizing-v2.ts`)

Injected via `--model kellyTilt`; shares eligibility, caps, dust and cash unchanged — only the ranking
differs:

```
w_raw = core · (C/50)^α · (Q/50)^β · staleness · L      core = μ·R_size (default) or μ/σ ;  C = κ·100
        α = convTiltExp (1.0),  β = qualTiltExp (0.6),  L = liquidity factor (large 1.0 / mid 0.9 / small 0.7)
```

`Q` here is a richer **cross-sectional composite** (ROIC, ROE-stability, FCF-conversion, balance sheet,
moat). The signature difference: the score sizer chases cheapened names hard (EVLV to the 10% cap when it
dips); kellyTilt's quality tilt damps that and stays more diversified.

> 💡 **Why μ/σ² (raw Kelly) was rejected — documented so it isn't re-tried.** On this book every name's
> `κ·μ/σ²` clears the 10% cap (V ~239%, KTOS ~35%), so it collapses to capped-equal-weight *and* ranks the
> lowest-σ names to the top — the opposite of a high-growth mandate — while amplifying 3-point-σ error.
> kellyTilt keeps the *centered* tilt on a **bounded** core instead. Still pending a point-in-time backtest
> A/B vs the score sizer and 1/N before it could become default.

---

## 4. From target book to trades — the trade layer  (`lib/trade/`)

`portfolio:build` stops at target weights. The trade layer turns *target vs current* into orders, with the
broker as the source of truth.

### 4.1 Ledger & reconcile  (`lib/trade/ledger.ts`)

The book is **derived from the broker**, not stored: `reconcile()` reads `getAccount` (equity→NAV, cash) +
`getPositions`, and **refuses to guess** — a live position with no explaining buy fill in `fills.jsonl`
throws `ReconcileError` and halts the run. `fills.jsonl` (append-only) is the one record the compliance
locks derive from.

**Orders check (`reconcileOrders`, default on).** `planRun` also fetches the broker's orders over the
lock window (`lockBusinessDays + 1` trading days back) and requires every executed order to be recorded in
`fills.jsonl` for its full quantity, joined on the **broker order id**. That catches what the position
check can't: a missed *sell* (which would leave `buyLockUntil` unset), an extra buy of a name already held,
a crash between submit and fill recording, a fill after the poll window, and manual trades in the account.
Any working (non-terminal) order also halts — this engine only sends IOC. The halt repeats on every run
until the fills are recorded, so a broker-truth CRITICAL (§6.2) can no longer be followed by a trade
against an under-set lock. To record real executions from broker truth:
`npm run trade:reconcile -- --record-missing` (appends them with `runId: "manual"`, printing each).

### 4.2 Two-sided hysteresis  (`lib/trade/hysteresis.ts`)

Entry and exit have **different bars**, keyed on whether the name is currently held, so a winner is never
sold for merely dipping below the entry bar:

```
NOT held → ENTER   iff  buy-side label + gatedLabel, μ ≥ muEnter (0.08), R ≥ rEnter (0.60),
                        κ·100 ≥ convictionMin (45), age ≤ 120d, not banned, not buy-locked
HELD     → EXIT    iff  banned, OR label/gate no longer buy-side, OR μ < muExit (0.03, "thesis played out"),
                        OR R < rExit (0.35), OR stale > 120d
         → HOLD    otherwise  (the whole band muExit..muEnter / rExit..rEnter is a no-churn zone)
         → HOLD / FREEZE / EXIT  when a bear breach (R null, D = 0) is the ONLY exit reason: by its cause (below)
```

The gap between `rEnter 0.60` and `rExit 0.35` (and `muEnter 0.08` vs `muExit 0.03`) is the **hysteresis
band** — it exists specifically because a single R gate whipsaws (raising it just relocates the knife-edge
into a denser R region). Locks turn EXIT→`DEFER_EXIT` and ENTER→`BARRED_ENTRY` (§4.4). `FREEZE` keeps a held
name exactly as it is — no add, no trim — and is never touched by a lock (it never trades).

`resolveTradeConfig` *enforces* `rExit < rEnter` and `muExit < muEnter` at construction — the band can't be
misconfigured into an overlap.

**The bear breach — held, frozen or exited by its cause (`lib/trade/breach.ts`).** When the live price falls to
or below the report's bear implied price, D = 0 and R is null. Exiting every such name is a stop-loss at the bear,
and a tight one: median held D is ~0.6× annual realized vol, so under GBM the median holding touches its bear
with probability ~23% within a quarter and ~58% within a year — and the exit sells at the point of highest
re-marked μ. What follows a breach depends on *why* the price got there, so `breachPolicy: "byCause"` (default)
splits the fall since the report into the part the market explains and the rest:

```
total    = P / P0 − 1                    P = the decision mark, P0 = report price (quote.currentPrice, as of meta.asOf)
market   = β · (SPY / SPY0 − 1)          β = FactPack measured beta, else the SIC proxy (betaFor)
residual = total − market
share    = residual / total              stock-specific share; > 1 if SPY rose, < 0 if SPY fell more than β explains

share < breachMarketShareMax (0.5)       → HOLD    market-driven: sized through the floor (R_size = μ/bearFloor), keeps buying
0.5 ≤ share < breachStockShareMin (0.9)  → FREEZE  mixed: weight held, no add, no trim, until the report is re-written
share ≥ 0.9                              → EXIT    stock-specific: DEFER_EXIT while sell-locked, never added to meanwhile
```

Evidence: an event study of 7,237 US-stock bear breaches 2010–2025 (≥ $2B; bear ≈ 0.6σ below a quarterly
report price). Over the next 6 months vs a typical stock, market-driven breaches returned **+3.5pp** (+5pp
measured from day 6), mixed **−0.8pp**, stock-specific **−3.3pp** (−3.8pp from day 6), with or without earnings
news — the same signs in 2010–15, 2016–20 and 2021–25. The tight-stop evidence (Kaminski & Lo 2014; Lo & Remorov
2017: stops on single stocks underperform unless returns trend at the stop horizon) holds for the market-driven
breaches; the stock-specific ones keep trending down, so for them the exit stands.

The rule applies only when the breach is the **sole** exit reason — a downgrade, a gate trip, staleness or the
ban still exits — and only with every input in hand. No SPY close for either date (or a broker error), no beta
(neither measured nor a SIC), a report priced after the mark, or any non-finite number leaves the plain exit,
reason `R — < exit 0.35 (price at or below the bear case)`: **missing data never holds a name.** SPY is read only
when a held name is in breach and only under `byCause`: the close on/before the report's price date, and the
SPY at the decision mark from the same source as the stock marks (`spyDecisionMark` in `planRun`). In a live run
(§5.1), that is SPY's own live mark: fresh trade → quote mid → settled close, large-cap freshness and gap. So an
intraday stock price is never measured against yesterday's SPY. The
run record keeps each cause (`breaches`), its notes say why a breach had none, and the Discord run summary and
allocation post list every held breach (`BAC market-driven (32%) — holding`) — each is a report the market has
passed, so each wants a re-synthesis. The cause is re-measured every run, so a FREEZE lifts by itself when the
price recovers above the bear, a new report resets the targets, or the fall's cause shifts; the 5-day locks
apply unchanged (buying a market-driven breach starts a sell lock like any buy). `breachPolicy: "exit"` restores the plain exit for
every breach (and is required with `bearFloor 0`, since a market-driven hold is sized through the floor).

> 💡 **Deferred — re-fit the 0.5 / 0.9 bands on our own breaches.** The thresholds come from the event study
> above, not from this book. Once the calibration log (`lib/calibration/realized.ts`) has post-breach d63/d126
> returns on enough held breaches, check the three buckets' signs before tuning the bands.

**Stale-on-bad-news entry gate (`staleEntryGate`, default on; `lib/trade/stale-entry.ts`).** This is the breach
rule's mirror on the way *in*. A not-held name that would ENTER is classified `STALE_ENTRY` instead, and not
bought, when all three hold:

```
P / P0 − 1 ≤ −staleEntryMinFall (5%)          fallen since the report price (smaller moves are noise for the split)
classifyBreach(P, P0, SPY, SPY0, β) = stock    the same cause split as above, share ≥ breachStockShareMin (0.9)
latest earnings surprise < 0                   from data/earnings/latest.json, ≤ staleEntryEarningsMaxDays (120) old
```

Its reason reads `stale on bad news: down 9% since the report, stock-specific (share 104%), last earnings missed
(−12.0% on 2026-08-05) — re-write the report`. The trader cannot query Shibui, so the earnings come from a committed
capture: `npm run trade:earnings -- --query` prints the call, the saved response goes to `--apply`, and the file
ships with the reports on the next rebuild. Refresh it after each earnings season.
- **Fail-open.** No earnings on file, an old result, no report price, no beta, or no SPY close all let the
  entry through. A gate that could not check is noted in the run record.
- **SPY reads.** SPY is read only for a not-held name already ≥ 5% down with a recent miss, sharing the breach
  rule's per-run reads.
- **Where it shows.** The run record keeps `staleEntries`; Discord lists them under "Not bought, stale on bad
  news — re-write these reports". A new report resets P0 and lifts the bar.
- **Evidence.** US stocks ≥ $2B, 8% stock-specific falls after a 10-Q/10-K (Shibui). Over the next 126 sessions
  vs SPY, a prior miss lagged a prior beat by −3.1 / −3.2 / −3.2pp in 2010–15 / 2016–20 / 2021–25. The same held
  at 5% and 12% falls. It was negative in 12 of 16 years but **faded in 2024–25**. Expected book effect is
  small, roughly +0.1 to +0.4pp of NAV a year. Momentum, turnover, lottery and pre-earnings filters were tested
  and rejected (`docs/superpowers/specs/2026-10-03-entry-methodology.md`).

### 4.3 The emitter — target vs current  (`lib/trade/rebalance.ts` → `emitTrades`)

1. **Freeze** held names with no current signal, deferred exits (locked), and `FREEZE` names (a mixed bear
   breach, §4.2; skip code `FREEZE`, target = current weight) — their weight is held, not traded.
2. **Re-size** the `HOLD ∪ ENTER` set with the same `sizePortfolio` core into `1 − cashFloor − frozenWeight`.
3. For each name, compare target `tw` to current `w`:
   - `ENTER` (was 0): buy `tw` (band-exempt — a new position always fires).
   - `HOLD`: `d = tw − w`; **skip if |d| ≤ tradeBand (0.025)** (`BELOW_BAND`), else `ADD` (d>0) or `TRIM` (d<0),
     unless the required side is locked (`BARRED_ADD` / `DEFER_TRIM`).
   - `EXIT`: sell the whole position.
4. **Never leverage:** if frozen + wanted buys would exceed `1 − cashFloor`, buys are scaled down
   (`buyScale`), never cash borrowed; a `plannedCash < 0` assertion is the backstop.

**Residual top-up (`topUpRecentBuys`, default off).** The 2.5pp band would leave the unfilled rest of a
partial IOC entry in cash until drift crosses it. With the knob on, a HOLD name that is **sell-locked** —
bought inside the lock window, so it can't be sold and can't churn — may ADD toward target through the
smaller `residualBand` (0.5pp). Buys only; `minOrderUsd` still applies.

**Extra daily runs (`cronTimesET`, default `["15:10"]`).** More slots are possible (each must sit before
`submitCutoffET`, 15:50 ET), e.g. to give partial fills a second, spaced-out chance; an immediate re-run
seconds later mostly meets the same book. The default deliberately keeps **one** decision a day (§7: extra
scans add noise trades that the 5-day lock then freezes). Each slot fires once per day with its own fire
window, run id, reconcile, breakers and audit. A daily cap `maxDayTurnoverFrac` (25% of NAV) bounds the
day's runs together.

### 4.4 Locks — the whipsaw / compliance clock  (`lib/trade/locks.ts`)

**Symmetric, whole-ticker, 5 business days** (counting the transaction day → first legal opposite-side
trade on the 6th trading day). A **buy** fill populates `sellLockUntil` (can't sell for 5 days); a **sell**
fill populates `buyLockUntil`. **Same-side adds are not locked** (topping up a partial fill is legal). The
ICE ban is re-enforced here and at the broker guard (buys refused; a disposing *sell* of a banned name is
allowed).

> 🚫 **Not an option — per-lot locking.** The lock is whole-ticker by rule: the owner's trading
> restrictions apply to the whole name, so one fill freezes the ticker. Per-lot locking (trimming an old lot
> while a fresh lot is locked) would break those rules and must not be added.

---

## 5. Pricing & placing orders — execution  (`lib/trade/orders.ts`, `limit.ts`)

### 5.1 Weights → quantities: hybrid limit + market  (`tradesToOrders`)

*Changed 2026-09-28 (owner-approved, see `docs/superpowers/specs/2026-09-28-pipeline-audit.md`).* Schwab's
API **does** take fractional quantities, but only on MARKET orders (≥ $1 for a buy, ≤ 4 dp; verified with
`previewOrder`). So each trade becomes:

```
qty       = floor4( deltaUsd · sizeMult / L )     buys  (sizeMult from tier-3, §5.3)
          = full broker position qty                EXIT (no dust left behind)
          = min( position qty, floor4( −deltaUsd / mark ) )   TRIM
order     = one MARKET order of qty                 if qty·L < marketOnlyBelowUsd ($200)
          = LIMIT floor(qty) (IOC, τ-capped) + MARKET remainder     otherwise
market leg needs a fresh quote (bucket maxStaleMin) with spread ≤ marketMaxSpread (1% / 1% / 2.5%);
           otherwise only the whole-share limit is sent (a held sell remainder is reported)
market BUY leg < $1 is dropped (broker minimum); a market remainder is sent only if its limit leg filled
skip (skippedDust) if  |deltaUsd| < floor:  ENTER $1 · ADD/TRIM max($1, 0.5% NAV) · EXIT none
                       (ADD/TRIM floor from env: TRADE_MIN_USD, TRADE_MIN_NAV_PCT)
skip (skippedHalt)  if  computeLimit returns halt (no price / gap), or nothing sendable without a market leg
```

The market share of notional falls as NAV grows (≈ 90% at $100, 20% at $10k, 2% at $100k), so small accounts
run almost entirely on market orders and larger ones mostly on τ-capped limits. The ADD/TRIM floor exists
because **every fill starts the 5-business-day, both-sides lock**: a trivial rebalance must not freeze a
ticker. `fractionalShares: false` restores the old whole-share-limit behaviour (`minOrderUsd` $25).

**IOC on Schwab is emulated.** Schwab has no `IMMEDIATE_OR_CANCEL` duration (400 "Invalid value"; only
DAY / GOOD_TILL_CANCEL / FILL_OR_KILL). An "ioc" limit goes in as DAY; `executeOrders` polls `iocPolls`
(8 × 1 s), cancels the unfilled rest, and waits for the broker to settle it (a partial fill is kept). A
market order gets `marketPolls` (30) before the same cancel. A definitive reject (4xx, or an order the
adapter refuses to send) is recorded as `rejected` and the run continues.

`deltaUsd = round2(deltaWeight · NAV)`. **Decisions use the run's live price** (`markMode:"live"`, the
15:10 ET run — §7): per ticker the fresh last trade, else the fresh quote mid, else the settled prior-day
close, with the source recorded (run record `markSources`). The `mark` above (TRIM qty) is that decision
mark. The settled prior close stays the **execution reference** (`Mkt.close`: gap-halt and the tier-3
anchor, §5.3) and is recorded as `refCloses`, so a replay reads the marks the run actually used.
`markMode:"settled"` restores prior-close decisions (backtest-reproducible from closes alone).

> 🚫 **Not an option — entering with a pullback limit, a wait, a confirmation day, or in stages.** Measured on
> ~12k Shibui price triggers (2021–25, 63-day excess vs SPY):
> - Buying at the decision: −1.16. A limit 0.5–4% below for 1–5 days, then market if unfilled: −1.15 to −1.48.
>   The same limit with cash if unfilled: −1.78 to −2.75. Filled names go on to lag (−1.9 to −4.1pp) and
>   unfilled ones run (+0.2 to +2.8pp): limits fill on bad news (Linnainmaa 2010).
> - Waiting 5–10 sessions does not buy a lower price on average, and waiting for an up day ties.
> - With orders ~10⁻⁶ of daily volume, staging only delays the alpha (Gârleanu & Pedersen 2013) and each add
>   restarts the sell lock.
>
> Full size at the first decision, as the fractional market order above, stays. See
> `docs/superpowers/specs/2026-10-03-entry-methodology.md`.

### 5.2 Liquidity buckets  (`bucketFor`)

`large ≥ $10B`, `mid ≥ $2B`, else `small`; unknown/`null` market cap → `mid`. Buckets drive τ, τ_max,
gap-halt, and the freshness window.

### 5.3 The limit price  (`computeLimit`)

**Anchor waterfall** (freshness gate, per-bucket `maxStaleMin` = 5 / 15 / 60 min):

```
tier 1  fresh last trade         pRef = lastTrade.price
tier 2  else fresh valid quote   pRef = ask (buy) / bid (sell)      [quote "touch"]
tier 3  else prior close         pRef = close     → BUY size ×0.5 (closeAnchorSizeMult)
none    → HALT ("no_price")
```

**Gap-halt** (on a *clean* reference — last trade if fresh, else quote **mid**, else close; never the
touch): halt if `|clean_ref − close| / close > gapHalt[bucket]` (0.10 / 0.15 / 0.25). A wide-but-clean
quote never halts on its own.

**Tolerance** τ (spread-aware, bucketed):

```
base = limitTol[bucket]              (buy: 0.0015 / 0.0035 / 0.0080;  sell: ×exitTolMult 1.5)
τ    = clamp( max(base, limitTolBeta·relSpread), limitTolMin (0.0005), limitTolMax[bucket] )
       limitTolBeta = 0.5 ;  limitTolMax = 0.0040 / 0.0100 / 0.0150 ;  relSpread clamped ≤ 0.10
```

**Hard cap** (tick-inclusive, so the cap itself is always a legal submittable price; `tick = $0.01` at
≥$1, else `$0.0001`):

```
buy:   L = min( ceil_tick(pRef·(1+τ)),  floor_tick(pRef·(1+τ_max)) )      capBound if the cap binds
sell:  L = max( floor_tick(pRef·(1−τ)), ceil_tick(pRef·(1−τ_max)) )
```

IOC means an unmarketable order (or partial) **cancels the remainder** — a **non-fill is a feature**, the
slippage cap refusing to chase.

> 💡 **Deferred — τ_max vs the early-session spread.** On the first (paper) run ~66% of orders were
> `capBound`: the spread wanted a wider limit than τ_max. Paper quotes are IEX (thin, wide), so that figure
> may be a data artifact, not the time of day. That run fired at 09:45 ET; runs now fire at 15:10, when
> spreads are tighter, so judge only runs at the new time. Raise `limitTolMax[bucket]` only after
> ≥5 **Schwab** runs, and only if `trade:review` shows cap-bound orders filling below ~50% while
> τ-wanted/τ_max sits just above 1. Never tune τ on paper.

**Timeouts and unknown submits (`lib/broker/http.ts`).** Every broker/OAuth request has a deadline over
headers and body (read 10s, submit 15s, token 10s); only idempotent reads are retried (1s, 3s). An order
submit is **never** retried: a timeout, network failure, 5xx, or a Schwab 2xx with no order id raises
`SubmitOutcomeUnknownError`, and `executeOrders` looks the order up with `findSubmitted` (Alpaca by
`client_order_id`; Schwab by exact symbol/side/qty/price/type/duration since the submit, refusing to guess
between two matches) at 2s/5s/10s. Found → polled and recorded as usual. Not found → the order is recorded
as `unknown`, **no further orders are sent**, and cron halts (`submit-unknown`). If the lost order did
execute, the next run's reconcile orders-check halts until it is recorded.

**Execution telemetry.** Every run-record order carries the anchor (`pRef`, `anchorAtMs`), the τ used and
the τ the spread *wanted* before the cap (`diag.tauWanted`, `relSpread`, bid/ask, quote/trade ages), plus
`filledQty`, `filledAvgPrice` and local `submitStartAt` / `submitAckAt` / `terminalAt`. Freshness is judged
when each ticker's quote was fetched, not at run start. `npm run trade:review` reports, **per broker**
(paper never mixed with live), the fill ratio of cap-bound vs other orders, τ-wanted/τ_max percentiles per
bucket, and latency percentiles — the evidence a τ_max change must wait for (≥5 Schwab runs).

---

## 6. Statistics, risk controls & self-verification

### 6.1 Run breakers  (`lib/trade/breakers.ts`, `guards.ts`)

```
turnover breaker      Σ|qty·limitPrice| > maxRunTurnoverFrac (0.15) · NAV     → halt, submit nothing   [cron only]
consecutive-halt      ≥ consecutiveHaltLimit (3) halted runs in a row         → block further runs
reconcile-halt        unexplained broker position, or an executed order in    → halt (repeats until recorded)
                      the lock window missing from fills.jsonl
submit-unknown        an order submit whose outcome couldn't be established → stop sending, halt
submit cutoff         now ≥ submitCutoffET (15:50 ET) before a submit        → send nothing more, record the rest
notional guard        Σ|estNotionalUsd| > maxNotionalFrac (1.0) · NAV         → refuse (per-submit)     [guards]
order-count guard     > maxOrdersPerRun (40)                                  → refuse
kill switch           TRADE_DISABLED=1                                        → refuse everything
endpoint guard        broker-aware: alpaca-paper ⇒ paper host, schwab ⇒ schwab host
```

**Turnover clip (`turnoverClipBuyOnly`, default on).** When the breaker trips on a **buy-only** plan
(every order a buy — ENTER *or* ADD, no sells — e.g. building the book from cash and topping up
underweights on a first rebalance), cron sends whole orders, largest target first, up to the cap and
defers the rest (`TURNOVER_CLIP`) instead of halting; the book converges to target over several runs.
Any SELL (TRIM or EXIT) still halts the whole plan, and the cap itself is never raised — so a
wrongly-read book can't turn into a full re-buy. A one-shot manual build still goes through `trade:execute`.

**Cash backstop (guards).** A buy is refused once committed buys would exceed the broker's cash + *filled*
sell proceeds − the cash floor; `executeOrders` sends sells first and skips (never sends) a buy the
backstop refuses. Both caps now measure an order as `qty × limitPrice` — what an IOC limit can spend.

> 🚫 **Not an option — a portfolio drawdown circuit breaker** (e.g. after a 10% drawdown halve new entries
> and raise the entry bars until it recovers to 5%). It throttles buying exactly when re-marked μ is highest
> across the book, fighting the engine's own dip-buying. It also cuts exposure when forward returns have
> been highest. Measured on Shibui, halving exposure while the 10%→5% state is on:
>
> | | Buy & hold | With breaker | Annual return in the state vs out of it |
> |---|---|---|---|
> | SPY, 1994–2026 | 9.1% CAGR | 7.0% | 13.0% vs 8.5% |
> | IWM, 2001–2026 | 7.4% | 5.0% | 14.5% vs 4.6% |
>
> The state was on 45–54% of days. The audit's milder version has the same sign.
>
> The cited support does not apply here. Daniel & Moskowitz (2016) momentum crashes are the *short* losers
> leg rebounding after declines, which is a gain for a dip-buying book. The "1%/2%/3% → cut 20/30/50%" rule
> comes from a minute-bar BTC strategy (arXiv 2512.02227).

> 🚫 **Not an option — a volatility-regime overlay or time-series vol targeting** (e.g. raise `muEnter`/`rEnter`
> when SPY's 50-day vol is above its 1-year median). Returns are not lower in high-vol states. SPY returned
> 10.6% in them vs 10.5% in calm states, and IWM 13.4% vs 7.0%. Halving exposure in them cost 1.7pp/yr (SPY)
> and 1.8pp/yr (IWM). Vol-managed portfolios raise Sharpe only by levering up in calm periods (Moreira & Muir
> 2017). Under no-leverage that becomes "lower alphas", and out of sample the gain mostly disappears
> (Cederburg et al. 2020). This engine never levers, so the overlay can only cost return.

### 6.2 Broker-truth audit  (`lib/trade/audit.ts` → `crossCheckBroker`)

After every execute, the day's broker orders are cross-checked against `fills.jsonl` and the run's expected
orders (joined by `clientOrderId`; on Schwab, absorbed by an in-adapter id↔cid map):

```
UNRECORDED_FILL   broker filled but no local fill        → CRITICAL (under-sets locks/ledger)
ORPHAN_FILL       local fill with no broker order        → CRITICAL
QTY_MISMATCH      recorded qty ≠ broker filledQty        → CRITICAL
PRICE_MISMATCH    recorded avg ≠ broker avg beyond eps   → warn
REJECTED          broker refused the order               → warn
MISSING_SUBMISSION expected order absent at broker        → warn
```

A CRITICAL fails `trade:execute` (non-zero exit) and, in `trade:cron`, halts with `reason:"broker-mismatch"`
+ notify. Run it read-only any time with `npm run trade:audit [-- --run <id>]`.

### 6.3 What the run persists / reports

The run record (`data/trade/runs/<id>.json`) stores the decision marks with their sources (`markSources`:
trade / quote / close) and the settled reference closes (`refCloses`), signals, classifications, locks, bear-breach
causes (`breaches`, §4.2), the plan, the orders (with sector, broker status, id, submittedAt), fills, and notes
(live-mark fallbacks, skips — including orders not sent because the submit cutoff passed). `trade:review` produces a
weekly digest (turnover, cash, deferrals, reconciled-every-run, lock violations, cap-binds). The **Discord notifier**
(`lib/trade/notify.ts`) posts a per-run embed (orders, fills, the goal/target book via `goalBook`, cash, audit, held
bear breaches to re-write) plus halt/auth alerts; best-effort, never fails a run.

---

## 7. Orchestration, brokers & cadence

- **`planRun` → `executeOrders`** (`lib/trade/pipeline.ts`): mark → reconcile → signals → locks → emit →
  size → (submit + poll fills). `trade:cron` (`lib/trade/cron.ts`) wraps it: kill-switch → clock →
  run-lock → consecutive/reconcile/turnover breakers → execute → broker-truth audit → notify.
- **Brokers** (`lib/broker/`): chosen by `BROKER` env via `makeBroker()` — `alpaca-paper` (default, the
  test rig) or `schwab` (LIVE). Both implement one 11-method `BrokerAdapter`; the pure core never names a
  broker. `schwab` is live-by-selection (no paper exists); the guard requires the Schwab host, breakers
  become the only guardrails, and the 7-day OAuth refresh surfaces as `halted(auth)` + alert (`trade:auth`
  to renew). Schwab credentials can also come from env (`SCHWAB_REFRESH_TOKEN`, optional
  `SCHWAB_REFRESH_OBTAINED_AT`, `SCHWAB_ACCOUNT_HASH`) for hosts with no interactive login: the env
  refresh token is tried first and `data/trade/schwab-token.json` is the fallback when it is out of date
  (a stale or rotated-away env token is remembered by fingerprint and never retried). Marks come from the broker (live trade / quote mid for the 15:10 decision, with the settled prior close
  as fallback and as the execution reference; live trade/quote for fill anchors).
- **Scheduler:** the in-app scheduler is the automation. `instrumentation.ts` → `lib/trade/scheduler.ts`,
  armed at server start when `.env.local` sets `TRADE_SCHEDULER_ENABLED=1` (the Docker `trader` service loads it).
  - It fires `runCron` at each `cronTimesET` slot (15:10 ET), ET-explicit, on NYSE trading days only, and DST-correct
    (19:10Z in EDT, 20:10Z in EST, verified across the 2026-11-01 change).
  - `cronTimesET` is compiled into the server build, so a change takes effect on rebuild and restart.
  - A boot before the slot arms for it. A boot inside the fire window (slot + `maxLateMin`) catches up once; later
    boots are refused as `late`.
  - `data/trade/scheduler-state.json` (`lastFiredDay` / `lastFiredSlot`) stops a slot firing twice in a day.
  - `GET /api/trade/status` reports `nextRunISO`.
  - Broker from `.env.local`.
  - `scripts/register-trade-cron.ps1` / `.sh` (OS-level Task Scheduler / systemd timers that read the same
    `cronTimesET`) are **legacy** and not used by the deployment. Run one scheduler, never both.
- **Rollout gate:** Phase 0 (fake dry-run) → Phase 1 (paper smoke: ≥10 runs, exact reconciliation, zero
  lock/ban violations) → Phase 2 (paper event-driven, 4 weeks clean + weekly review). Merge to `main` only
  after that.

**Re-auth warning (`lib/trade/auth-health.ts`).** On Schwab, each cron run first checks whether the
refresh token will still be alive at the next scheduled run: **critical** if it dies before then (renew
today), **warn** under `schwabAuthWarnHours` (72h, covers a weekend), **unknown** if its issue time isn't
known (env token without `SCHWAB_REFRESH_OBTAINED_AT`). Each level notifies at most once per ET day and
immediately on escalation; it never affects the run. `npm run trade:auth -- --status` prints the expiry,
and `GET /api/trade/status` reports `schwabRefreshExpiresAt`.

- **ET clock (`lib/trade/clock.ts`).** `today`, a fill's `tradingDate`, the fire window and the market-hours
  check all read America/New_York through one helper (`todayET`, `etMinutesOfDay`) — a UTC date is already
  tomorrow from 20:00 EDT, which would have run lock checks against the wrong day.
- **Market clock.** Schwab's `/markets` `isOpen` is a *trading-day* flag (true all day and night on a
  weekday — verified against live responses). `SchwabBroker.getClock` is open only inside
  `sessionHours.regularMarket`, falling back to the NYSE calendar + 09:30–16:00 ET.
- **Fire window.** `trade:cron` refuses a run that starts after `cronTimeET + maxLateMin` (15:10 + 20 min =
  15:30 ET) as `late` — a missed trigger or a catch-up is skipped, never traded at an unplanned time. A
  deliberate manual run passes `trade:cron -- --now` (the market clock still applies).
- **Submit cutoff (`submitCutoffET`, 15:50 ET).** `executeOrders` checks the clock before every submit; at or
  after the cutoff it sends nothing more and returns the rest as `skippedCutoff` — run-record notes, an alert,
  and the run summary's skipped list. A run that starts late with many orders (an emulated IOC polls ~8 s, a
  market order up to 30 s) therefore never submits into the close. Sells go first, so a cutoff can only leave
  cash, never leverage. Both `trade:cron` and `trade:execute` apply it.
- **Early-close days.** On a 13:00 ET close (the day after Thanksgiving, Christmas Eve; ~3 a year) the broker
  clock reads closed at 15:10, so `trade:cron` exits `closed` and nothing trades that day — accepted, not
  special-cased.

**The late-day live decision (owner-approved 2026-10).** The book is slow (12-month fundamental targets), so
the engine keeps exactly **one** decision a day and makes it at **15:10 ET on live prices** instead of at
09:45 on the prior day's settled close:

- *Why not more scans:* acting a few hours sooner on a 12-month signal is worth < 1 bp a trade (Di Mascio,
  Lines & Naik on alpha decay), while every extra scan adds noise trades that the 5-day lock then freezes.
- *Why not the open:* spreads are widest 09:30–10:00 and narrow through the day (Upson & Van Ness 2017;
  Bogousslavsky & Muravyev 2023), and opening prices of attention-grabbing stocks carry a premium that
  reverses (Berkman et al. 2012, JFQA; the overnight/intraday split in Lou, Polk & Skouras 2019, JFE).
- *Why late, live:* the same information is acted on ~18 hours sooner than waiting for tomorrow's settled
  close; down-day names are bought ahead of the documented last-half-hour reversal (Baltussen, Da &
  Soebhag); and the fill lands a session earlier, so the lock — counted in trading days from the fill date —
  clears a session earlier too. The lock itself is unchanged.
- *Marks and fallback (`planRun`, `liveMark`):* live marks apply only when the run is today's ET session
  (`today === todayET(nowMs)`, a trading day, 09:30–16:00). Per ticker (report tickers ∪ held): the last
  trade if fresh, else the quote mid (bid > 0, ask ≥ bid) if fresh — fresh means within the bucket's
  `maxStaleMin` of capture, the execution path's rule — else the settled prior close. A live price beyond
  the bucket's `gapHalt` from that close is set aside for the close too (execution would halt that name on
  the same print, so deciding on it would only re-size the rest of the book). A failed live read never fails
  the run: that name decides on the close and execution re-reads it. Every fallback is recorded
  (`markSources`, notes). The settled closes are always fetched first and stay execution's reference; the
  decision's own trade/quote snapshot is reused as the execution anchor (one read per ticker per run).
  The snapshot is **batched** when the broker supports it (`getLatestSnapshots`: one Schwab `/quotes` or Alpaca
  `/v2/stocks/snapshots` request per 200 tickers). Without batching, ~90 per-ticker reads on top of the settled
  closes would run into the broker's market-data rate limit; a 429 is not retried. If the batch fails, every
  name decides on its settled close (recorded). The run never falls back to per-ticker reads.
  Outside today's session — `trade:plan --date`, pre/post-market, a holiday — the run marks settled, exactly
  as before.
- *Revert:* `cronTimesET: ["09:45"]` and `markMode: "settled"` in `lib/trade/config.ts`, then rebuild and restart
  the app (`docker compose up -d --build`) so the in-app scheduler picks it up.
- *Deploying the change:* deploy outside market hours. If the old 09:45 slot already fired that day,
  `lastFiredSlot` is "09:45", so the new 15:10 slot also fires: two decisions that one day. The 5-day locks still
  apply across them.

---

## 8. Config reference (defaults)

| Knob | Default | Stage |
|---|---|---|
| `muMin` / `rMin` / `convictionMin` | 0.05 / 0.50 / 45 | eligibility (analytical) |
| `stalenessMaxDays` / `stalenessHalfLifeDays` | 120 / 90 | eligibility / recency |
| `muExp` / `convExp` / `rExp` | 1 / 1 / 1 | score |
| `bearFloor` | 0.15 (= desk `rating.bearFloor`) | score (floor on D in R_size) |
| `wMax` / `sectorMax` / `wMin` | 0.10 / 0.30 / 0 | caps / dust |
| `cashFloor` / `cashCeiling` | 0.01 / 0.35 | cash |
| quality tilt `qGainComposite/qGainMoat/qPenaltyEroding/qLo/qHi` | 0.10 / 0.20 / 0.10 / 0.8 / 1.2 | quality |
| `muEnter` / `muExit` | 0.08 / 0.03 | hysteresis |
| `rEnter` / `rExit` | 0.60 / 0.35 | hysteresis |
| `breachPolicy` | "byCause" (`"exit"` = sell every bear breach) | hysteresis (bear breach) |
| `breachMarketShareMax` / `breachStockShareMin` | 0.5 / 0.9 | bear breach: HOLD below / FREEZE between / EXIT at or above |
| `staleEntryGate` / `staleEntryMinFall` / `staleEntryEarningsMaxDays` | true / 0.05 / 120 | entry: STALE_ENTRY on a ≥ 5% stock-specific fall after an earnings miss ≤ 120 days old |
| `tradeBand` | 0.025 | emitter |
| `lockBusinessDays` | 5 | locks |
| `minOrderUsd` / `maxOrdersPerRun` / `maxNotionalFrac` | 25 / 40 / 1.0 | guards |
| `limitTol` (buy) large/mid/small | 0.0015 / 0.0035 / 0.0080 | limit τ floor |
| `limitTolMax` large/mid/small | 0.0040 / 0.0100 / 0.0150 | limit τ ceiling |
| `limitTolBeta` / `limitTolMin` / `exitTolMult` | 0.5 / 0.0005 / 1.5 | limit τ |
| `gapHalt` large/mid/small | 0.10 / 0.15 / 0.25 | limit gap-halt |
| `maxStaleMin` large/mid/small | 5 / 15 / 60 | anchor freshness |
| `closeAnchorSizeMult` | 0.5 | tier-3 buy size |
| `maxRunTurnoverFrac` / `consecutiveHaltLimit` | 0.15 / 3 | breakers |
| `cronTimeET` / `cronTimesET` | "15:10" / ["15:10"] | scheduler (one late-day decision) |
| `markMode` | "live" (15:10 live marks; "settled" = prior close) | decision marks |
| `maxLateMin` | 20 (15:10 → 15:30 ET) | fire window |
| `submitCutoffET` | "15:50" | no submit at or after it |
| buckets | large ≥ $10B, mid ≥ $2B, else small (null→mid) | liquidity |

> 💡 **Audited 2026-10-03** (`docs/superpowers/specs/2026-10-03-config-audit.md`): literature plus a simulation of this
> engine over 36 real-price universes. Recommended, pending the owner: `stalenessMaxDays` 150, `rExit` 0.15 and, optionally,
> `bearFloor` 0.25 (+0.74pp/yr together). Every other default sits at a flat optimum or waits on μ's measured
> information content. `muEnter`, `muExit` and `convictionMin` never bind: the R gates fire first.

`resolveTradeConfig` enforces the invariants (`rExit < rEnter`, `muExit < muEnter`, `limitTol ≤ limitTolMax ≤ 0.5`,
`gapHalt ∈ (0,1)`, positive freshness, `closeAnchorSizeMult ∈ (0,1]`, `0 < breachMarketShareMax < breachStockShareMin ≤ 1.5`,
`byCause` ⇒ `bearFloor > 0`, `staleEntryMinFall ∈ (0,1)`, `staleEntryEarningsMaxDays` a positive integer, `submitCutoffET` before 16:00 and after every slot, etc.) at construction.

## 9. Symbol glossary

| Symbol | Meaning |
|---|---|
| E / μ | expected upside — probability-weighted fair value vs price (E vs report price, μ vs live price) |
| D | bear-case downside magnitude (worst scenario / named bear) |
| R | reward/risk = μ / D (the engine's core risk unit; null when D ≤ 0) |
| R_size | R for sizing only: μ / max(D, bearFloor) — finite as the price nears the bear (μ / bearFloor at or below it) |
| share | a bear breach's stock-specific share of the fall since the report: (total − β·SPY return) / total |
| σ / σ↓ | scenario standard deviation / downside semi-deviation |
| κ | conviction, `decision.conviction / 100` ∈ [0,1] |
| Q | quality tilt (0.8–1.2 signal-level; a richer 0–100 composite in kellyTilt) |
| L | limit price (order) **or** liquidity factor (kellyTilt) — disambiguated by context |
| τ / τ_max | slippage tolerance / its per-bucket hard cap |
| w / activeWeight | portfolio weight / tilt vs 1/N of the covered universe |
| N_eff | inverse-Herfindahl effective number of holdings |
