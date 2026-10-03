# Config audit: the best configuration for the trader (2026-10-03)

**Question (owner).** Audit every trader config knob against the academic literature, including arXiv, and
find the best configuration.

**Status: applied 2026-10-03** (`lib/portfolio/config.ts`, `lib/trade/config.ts`; tests and docs updated). It reaches the
trader on the next rebuild.

**Answer in one paragraph.** Change three values, all config-only:

| Knob | Today | Recommended |
|---|---|---|
| `stalenessMaxDays` | 120 | **150** |
| `rExit` | 0.35 | **0.15** |
| `bearFloor` | 0.15 | **0.25** |

The test was a simulation that runs the production engine (`buildSignal` → `emitTrades` → locks) day by day
over real 2012–2026 prices, in 36 random 94-name US universes. It used four assumptions about how much
information the desk's μ carries, and was run with and without synthetic bankruptcies.

- **Gain.** The three changes together add **+0.74pp of compounded return a year (t 3.9)**, and **+0.72pp (t 5.0)**
  under the bankruptcy stress.
- **Robustness.** The gain holds in both eras and under all four signal assumptions. It also holds on 12 universes
  kept out of the selection (+0.69pp).
- **Turnover.** Annual turnover falls from 21× to 17× NAV, and trades from about 830 to 690 a year.

Every other knob stays as it is, for one of four reasons:
- it sits on a flat optimum;
- it never binds;
- the literature and the simulation disagree in a way only the desk's own track record can settle;
- it only wins on survivor-only price data and loses once delisted losers are modelled.

Three knobs do nothing in practice: `muEnter` 0.08, `muExit` 0.03 and `convictionMin` 45 never bind (§4).
The mandatory 5-day lock costs nothing; it slightly beats a 1-day lock (§8).

## The recommended configuration

| Knob | Today | Recommended | Why | Evidence |
|---|---|---|---|---|
| `stalenessMaxDays` | 120 | **150** | The gap between the Q3 10-Q and the 10-K is 112–137 days under SEC deadlines, plus the desk's lag. A 120-day cap force-exits good names in that window. Each forced exit then restarts the 5-day lock and is usually followed by a re-buy. | The mechanism and the literature agree (signal half-life ≈ 80–140 days; little predictive value after about 180 days). Simulation: positive alone and inside the package. Strong. |
| `rExit` | 0.35 | **0.15** | Hold a name that has rallied until its re-marked upside is nearly gone (R < 0.15 ≈ μ below 4–5% at typical D). R exits were about 70% of all exits. The wider band also avoids selling winners into 3–12-month momentum. | 0.15–0.25 is a flat optimum. 0.15 was chosen on 2012–18 and was best on 2019–26. Consistent with the literature's exit near μ ≈ 3–4%. Moderate–strong. |
| `bearFloor` | 0.15 | **0.25** | A bear case less than 25% below the price is not a credible worst case. Morgan Stanley's bear cases average −27% (median −24.7%), and realized valuation errors average 40%. A high R produced by a small D is mostly optimism. | Literature (A) recommends 0.20–0.25. Simulation: adds +0.34 (t 2.0) normal and +0.15 (t 1.1) stressed on top of the other two. It tilts the book toward higher-downside names (below). **The weakest of the three.** |

Everything else stays at today's value. `muEnter` could go to 0.10 to match the desk's BUY bar, but it does
nothing either way (§4).

**What it does to today's book.** I compared target books built from cash on the 94 live reports at the
2 Oct closes. One-way turnover between the two books is 8.7%. Most per-name changes are about 1pp, inside the
2.5pp band, so switching would trigger few trades. All of the change comes from the bear floor: weight moves from
low-downside names (SCHW, NEE, BAC, RTX, WFC, about −1pp each) to higher-downside names (KTOS, NBIX, CHWY, AIP,
LASR, +0.7–1.1pp). That is the direction the sizing literature warns about: more volatility drag (§5). It is why
the floor ranks third.

## Method

**Literature.** Three parallel reviews covered:
- **A:** the signal's information content, its decay, and entry/exit bands;
- **B:** sizing, caps, cash and quality;
- **C:** rebalancing, the lock, stops, breakers and execution.

Every arXiv ID was checked on its abstract page and journal papers on an abstract or index page. Anything not
confirmed is marked [unverified] in the memos, which are in the session scratchpad
(`config-audit/lit-{A,B,C}*.md`). Two corrections to earlier notes came out of this:
- **Green, Hand & Sikochi (RAST 2024).** Their 16–18¢ per $ applies to upside *above the analyst's cost of
  equity (≈ 11%)*. It is realized mostly within two quarters, with quarterly slopes of 0.06, 0.05, 0.02 and
  0.01. It is not a slope on raw μ starting from zero.
- **Joos and co-authors.** Joos, Piotroski & Srinivasan (JFE 2016) show the bull–bear spread measures *risk*. The
  optimism result ("tilt toward the bull case") is Joos & Piotroski (RAST 2017).

One paper must not be cited: Kim, Muhn & Nikolaev (arXiv 2407.17866, LLM financial statement analysis) was
**withdrawn** on 2025-02-20.

**Simulation.** It drives the production engine, not a model of it.

- **Prices.** Yahoo daily adjusted closes for about 2,600 randomly sampled US listings plus SPY.
- **Universes.** Each universe has 94 names, stratified by dollar volume to match the desk's mix (≈ 60% large,
  20% mid, 20% small).
- **Sample.**
  - Two eras: 2012–18 (era A) and 2019–26 (era B).
  - 12 universes per era for selection, plus 6 per era held out for validation.
  - The desk's own 94 names were run as a separate universe. It is reported but never used for decisions, because
    those names were picked in 2026 and carry hindsight.
- **Synthetic reports.** Each report is published after each quarter-end with a realistic filing lag: 28–50 days
  after Q1–Q3 and 55–90 days after Q4.
  - Scenario shapes (returns, probabilities, conviction, quality inputs, gate ceiling) are resampled from the 90
    real desk reports. Templates are matched on volatility and scaled by the desk's measured D-to-vol elasticity
    (0.41).
  - The desk's 15% bear rule is enforced, and labels come from the desk's E/R bands.
  - β is the trailing-year Blume β, used for the breach split.
- **Information content.** The unknown is μ's information content. Each report carries a true alpha of
  b·(ln(1+μ) − ln(1+m₀)), delivered over 12 months with a 63-session half-life. It was run under four models:

  | Model | b | m₀ | Prior weight |
  |---|---|---|---|
  | M0 (no skill) | 0 | 0 | 30% |
  | M1 (sell-side-like, upside above cost of equity) | 0.1 | 10% | 30% |
  | M2 | 0.2 | 10% | 25% |
  | M3 (optimistic) | 0.4 | 10% | 15% |

  The weights follow review A's prior of b ≈ 0–0.10 for an LLM desk, against 0.16–0.18 for human analysts on
  upside above the cost of equity.
- **Execution.** Decisions and fills both use the close (standing in for the 15:10 live mark), at 2 bp a trade.
  The 5-day whole-ticker lock, the floors, sells before buys and the cash backstop are all applied. NAV-relative
  floors make the results scale-free.
- **Bankruptcy stress.** Yahoo, like Shibui, is survivor-only: delisted losers are missing, which flatters any
  setting that buys falling or volatile names. In the stress run, a name entering a ≥ 50% drawdown goes bust with
  probability 10% (large), 20% (mid) or 30% (small). A bust falls 70% over 20 sessions and is then delisted. That
  gives about 7.5 busts per 94-name universe over 7 years (≈ 1%/yr of names, the upper end of historical
  performance-delisting rates).
- **Scoring.** Every setting is compared with the default on the *same* universe, reports and alpha. The score is
  the prior-weighted difference in annual log growth, with t-statistics across universes.
- **Sweeps.**
  - Round 1: about 100 single-knob settings over 13 universes.
  - Round 2: 106 settings over 25 universes, normal and stressed (20,200 runs).
  - Round 3: refinements around the winning package.
  - Round 4: the final candidates on the 12 held-out universes.

**How realistic the baseline is.**
- **Activity.** The default engine runs about 830 trades a year, 21× NAV of turnover, and holds about 31 names with
  about 4% cash. The live account made 73 fills in its first 11 sessions, including the initial build. So the
  engine's high activity is real, not an artefact of the simulation.
- **Return at b = 0.** It trails an equal-weight book of the same universe by 0.7%/yr. At M1 it leads by 0.7%/yr.

**What the simulation cannot settle.**
- κ and Q are random relative to returns by construction, so conviction and quality knobs show only what they cost
  when uninformative.
- Alpha ∝ μ, so it cannot answer the literature's claim that the volatility-linked part of μ carries no
  information.
- There is no point-in-time earnings data, so the stale-entry gate is off in the simulation; its own event study
  stands.
- Daily closes say nothing about intraday execution.

## Results by knob

Each cell is the change in annual compounded return against today's default, **normal / bust-stressed**, in pp,
over the 24 selection universes (round 2) unless marked. t-statistics are across universes. Bold marks the
chosen value.

### 1. Exit band: `rExit`, `muExit`

| `rExit` | 0.10 | **0.15** | 0.20 | 0.25 | 0.30 | 0.35 (today) | 0.45 |
|---|---|---|---|---|---|---|---|
| Alone | +0.22 / +0.42 | +0.31 / +0.28 | +0.26 / +0.34 | +0.14 / +0.09 | +0.01 / −0.01 | 0 | +0.11 / +0.23 |
| In the package, `bearFloor` 0.25 (round 3) | +0.73 / +0.46 | **+0.76 / +0.74** | +0.78 / +0.63 | +0.72 / +0.46 | +0.49 / +0.48 | — | — |

- **Shape of the optimum.** Flat between 0.15 and 0.25. 0.15 tied for best on era A and was best on era B.
- **Why it works.** A lower exit keeps names that have rallied but still have upside. With the package, exits fall
  from 227 to 167 a year and the book holds about 37 names instead of 31.
- **Literature.** Review A puts the zero-alpha level near the cost of equity and the exit about 4–6 points below
  entry, with μ ≈ 3–4%. Selling into strength also fights 3–12-month momentum (Jegadeesh & Titman 1993;
  residual momentum, Blitz, Huij & Martens 2011).
- **`muExit` does not bind.** For a report published as a BUY (E ≥ 10%, D ≥ 15%), μ < 3% needs a price above the
  publication price, where D > 15% and so R < 0.2. So R < 0.35 always fires first. On the 50 live buy-side
  reports, `muExit` binds before `rExit` for 0 names. With `rExit` 0.15, `muExit` starts to bind only for names whose D is still
  below 20% when μ reaches 3%. Keep 0.03.

### 2. Staleness: `stalenessMaxDays`, `stalenessHalfLifeDays`

| `stalenessMaxDays` | 100 | 130 | 140 | **150** | ≥ 160 |
|---|---|---|---|---|---|
| Alone | +0.11 / +0.32 (era A −0.57) | +0.11 / +0.05 | +0.23 / +0.20 | +0.18 / +0.13 | +0.21 / +0.20 (never binds) |

- **Effect.** Raising the cap stops forced exits in the 10-K gap. At 120 days, about 13 names a year were exited
  as stale and usually re-bought weeks later.
- **Why 150.** Results for 140–160 are the same within noise. 150 covers the longest legal gap (a non-accelerated
  filer's Q3 10-Q on 14 Nov to its 10-K on 31 Mar is 137 days) plus some desk lag. It also stays under the
  literature's ~180-day ceiling.
- **Literature.** Half-lives are about 80–110 days for analyst undervaluation (GHS) and 115–140 days for
  accounting signals after release (Bowles, Reed, Ringgenberg & Thornock, JF 2024). Half the alpha accrues by
  month 4 (Di Mascio, Lines & Naik).
- **Half-life.** Flat: 30 / 60 / 120 / 180 days give −0.01…+0.17 normal and +0.05…+0.16 stressed. The literature
  says 90 (range 75–120). **Keep 90.**

### 3. Bear floor: `bearFloor`

| `bearFloor` | 0 (+ plain exit) | 0.10 | 0.15 (today) | 0.20 | **0.25** | 0.30 | 0.40 |
|---|---|---|---|---|---|---|---|
| Alone | −0.84 / −0.54 | −0.21 / −0.13 | 0 | +0.26 / +0.04 | +0.37 / +0.06 | +0.49 / +0.13 | +0.52 / +0.22 |
| With `stalenessMaxDays` 150 + `rExit` 0.15 (pooled, 36 universes) | — | — | +0.39 / +0.57 | — | **+0.74 / +0.72** | — | — |
| With `stalenessMaxDays` 150 + `rExit` 0.25 (round 3, 24 universes) | — | — | — | +0.40 / +0.44 | +0.72 / +0.46 | +0.77 / +0.42 | — |

- **What the numbers show.** (0.35 inside the `rExit` 0.25 package: +0.76 / +0.49.)
  - The floor is clearly needed: removing it costs 0.5–0.8pp.
  - Raising it helps normally, but helps much less under the bankruptcy stress.
  - On the held-out universes it added nothing (+0.68 with it vs +0.69 without, averaging normal and stressed).
  - Pooled over 36 universes it adds +0.34 (t 2.0) normal and +0.15 (t 1.1) stressed.
- **Cost of a higher floor.** It shifts weight toward higher-downside, more volatile names (see "What it does to today's
  book").
- **The two literature camps.**
  - **For** a higher floor: shallow bears are optimism, not safety (Joos & Piotroski 2017; Bradshaw, Brown &
    Huang 2013).
  - **Against**: under a flat security market line, low-volatility names deserve *more* weight (Frazzini &
    Pedersen 2014; review B).
- **Verdict.** 0.25 is the recommended value, but it is the optional third change. Take it if you accept the
  argument that bear cases are realistic only at about 25% depth. Skip it and the other two still give
  +0.39 / +0.57.
- **Desk floor unchanged.** The desk's publication floor (`rating.bearFloor` 0.15) stays. This floor is only the
  sizer's, so the comment in `lib/portfolio/config.ts` would change to say they no longer match.

### 4. Entry: `muEnter`, `rEnter`, `convictionMin`

- **`muEnter` 0.08 never binds.**
  - Entry needs R ≥ 0.6, i.e. μ ≥ 0.6·D. Above the publication price D ≥ 15%, so μ ≥ 9%. Below it, μ > E ≥ 10%.
  - On the 50 live buy-side reports it binds before `rEnter` for 0 names.
  - Simulation: 0.06 changes nothing; 0.10 / 0.12 / 0.13 / 0.15 give −0.04…+0.11 normal and −0.04…+0.15 stressed.
    0.20 cuts the book to 21 names.
  - Review A argues for 0.12, but at that level the gate binds only for names whose D is below 20%.
  - **Keep 0.08** (or set 0.10 to match the desk's BUY bar; it is cosmetic either way).
- **`rEnter` 0.6 is at the optimum.** 0.4 / 0.5 / 0.75 give −0.06…0.00 normal and +0.01…+0.10 stressed. 1.0 cuts
  the book to 24 names. Inside the package, 0.5 and 0.75 both lose against 0.6 (+0.53 and +0.49 vs +0.59 robust).
  **Keep.**
- **`convictionMin` 45 never binds.**
  - No live buy-side report has conviction below 45: six are below 55 and fifteen below 65.
  - 55 and 65 in the simulation (+0.2…+0.5, t ≤ 1.2, the book shrinks to 24–29 names) only show the effect of
    concentrating when κ is random.
  - The literature supports conviction filters (best ideas beat other holdings by 2.8–4.5%/yr: Antón, Cohen &
    Polk; Cohen, Polk & Silli), but κ is not validated.
  - **Keep.** Revisit as a percentile cut once the calibration log can test κ.

### 5. Sizing and construction

| Knob | Tested | Result (normal / stressed) | Verdict |
|---|---|---|---|
| Score exponents (μ, κ, R) = 1, 1, 1 | μ 0.5 / 1.5 / 2; R 0 / 0.5 / 1.5; κ 0 / 0.5 / 2; R only (μ 0); equal weight | μ 0.5: −0.22 / −0.19; μ 2: +0.27 / +0.09; R only: −0.47 / +0.08; R 0: −0.59 / −0.44; κ: ±0.1; **equal weight −1.46 / −0.28** | **Keep 1/1/1.** The literature (B) says drop the second μ (μ·R ∝ μ²/D favors volatile names, and the vol-linked part of μ is the least informative: Engelberg, McLean & Pontiff 2020; Dechow & You 2020; GHS). The simulation's alpha ∝ μ, so it cannot test that. Whether to cut μ depends on b and its vol gradient, which is already the deferred "risk-aware tilt" in `docs/engine.md` §3.2 |
| `wMax` 0.10 | 0.05 / 0.075 / 0.125 / 0.15 / 0.20 | 0.15: +0.44 / **−0.40**; 0.20: +0.60 / **−0.53**; 0.075: 0.00 / +0.41; 0.05: −0.88 / +0.01 | **Keep.** Bigger caps win only on survivor data and lose once busts are modelled. That is the survivorship signature. The literature says about 3× equal weight (6–7%) plus an N_eff floor (Jagannathan & Ma 2003; DeMiguel et al. 2009). 10% is the balance |
| `wMin` 0 | 0.5% / 0.75% / 1% / 1.5% / 2% | 1.5%: +0.41 / +0.28 alone, but ≈ 0 inside the package (+0.61 vs +0.59); 2% cuts to 21 names | **Keep 0.** No academic support; the gain is concentration and disappears once the package is in |
| `sectorMax` 0.30 (SIC-2) | 0.20 / 0.25 / 0.40 / none | −0.05…+0.30, t ≤ 1.3 | **Keep.** Flat. A GICS or cluster cap stays deferred (`docs/engine.md` §3.4) |
| `cashFloor` 0.01 | 0 / 0.03 | 0: +0.12 / +0.12; 0.03: −0.15 / −0.07 | **Keep 0.01.** Cash averages about 4% anyway, set by the band (§6), not the floor |
| `useQualityTilt` (±20%) | off | +0.27 / +0.18: the cost of a ±20% tilt when Q is random | **Keep.** The literature puts the quality premium at about +0.1–0.2%/yr for this tilt (Asness, Frazzini & Pedersen 2019; Novy-Marx 2013), so roughly break-even. Test Q in the calibration log |

### 6. Rebalancing: `tradeBand`, trade floors, partial trading

| `tradeBand` | 0.5% | 0.75% | 1% | 1.5% | 2% | **2.5%** | 3% | 4% | 6% |
|---|---|---|---|---|---|---|---|---|---|
| Alone | +0.41 / +0.05 | +0.40 / +0.02 | +0.26 / +0.23 | +0.24 / +0.08 | +0.08 / +0.06 | 0 | — | +0.05 / +0.30 | −0.56 / −0.03 |
| In the package, `rExit` 0.25 variant (round 3) | — | — | — | +0.53 / +0.39 | +0.56 / +0.39 | **+0.72 / +0.46** | +0.54 / +0.44 | — | — |

- **Keep 2.5%.**
  - Alone, narrower bands gain only in the normal run and only in era B. Inside the package, 2.5% is the best of
    1.5–3%.
  - Theory agrees on the level. The correct no-trade formula is Δ = (3c/2γ · w²(1−w)² · (1+|e|)²)^{1/3}
    (Gerhold, Guasoni, Muhle-Karbe & Schachermayer arXiv 1108.1167; Muhle-Karbe, Reppen & Soner arXiv
    1612.01302). Here e ≈ −10 is the sizer's own price elasticity. At c = 2 bp, w = 5% and γ = 3 it gives
    **≈ 2.5–3.0pp**.
  - The optimum is flat: a band 1.5× too wide costs 1.19× the minimum loss.
- **`minTradeNavFrac`** 0.5% is inert for ADD/TRIM: any trade back to target already exceeds the 2.5pp band
  (0 and 1% both ≈ ±0.1). **Keep.**
- **Partial trading** (half the gap) and a **weight-scaled band** (∝ w^{2/3}) are the literature's refinements
  (Gârleanu & Pedersen 2013; Martin arXiv 1204.6488).
  - Simulated: partial +0.18 / +0.38 (era A −0.19); w^{2/3} +0.17 / +0.26. Neither is significant normally.
  - 🚫 **Not worth code.**
- **`topUpRecentBuys`** off: review C's toy model shows a 0.5pp top-up inside the lock adds losses and trades.
  **Keep off.**

### 7. Bear-breach thresholds: `breachMarketShareMax` / `breachStockShareMin` (0.5 / 0.9)

| Setting | Normal / stressed |
|---|---|
| `breachPolicy: "exit"` | −0.69 (t −3.2) / −0.27 |
| 0.3 / 0.9 | −0.01 / +0.04 |
| 0.5 / 0.7 | −0.32 / +0.04 |
| **0.5 / 0.9 (today)** | 0 |
| 0.7 / 0.9 | +0.23 / +0.17 (on top of the package, pooled 36: +0.23 t 1.8 / +0.15 t 1.3) |
| 0.5 / 1.2 | +0.12 / **−1.03 (t −4.8)** |
| 0.7 / 1.2 | +0.45 / **−0.71 (t −2.9)** |

- **Keep `byCause` 0.5 / 0.9.** Selling every breach is clearly worse.
- **Holding stock-specific breaches longer fails the stress.** That is exactly where busts sit, and it confirms
  the event study's −3.3pp for stock-specific breaches.
- **Treating 50–70%-market breaches as HOLD rather than FREEZE** (0.7 / 0.9) is a small, non-significant gain. It
  belongs to the already-deferred re-fit on our own breaches (`docs/engine.md` §4.2).
- **Literature.** No paper supports specific cut-offs. Review C found no cause-conditional stop study. Stops help
  only where returns continue (Kaminski & Lo 2014; Lo & Remorov 2017). News versus no-news is the
  better-supported split (Chan 2003; Savor 2012; Da, Liu & Schaumburg 2014). An industry factor would stop sector
  moves being counted as stock-specific.

### 8. Breakers, guards and the lock

- **Turnover breaker** (off unless `TURNOVER_BREAKER`).
  - Daily turnover under today's config: median 6% of NAV, 99th percentile 38%.
  - **17% of days exceed the 15% per-run cap**, and 5% exceed 25%. With the package: 12% and 3%.
  - Switched on as configured, it would halt about one run in six. Every halt is a plan with a sell, because
    buy-only plans are clipped.
  - **Keep it off.** If it is ever turned on, set `maxRunTurnoverFrac` ≥ 0.40 and `maxDayTurnoverFrac` ≥ 0.40 so
    it guards only against anomalies. The literature supports turnover *penalties*, bands and partial trading,
    not halts (Olivares-Nadal & DeMiguel 2018; Novy-Marx & Velikov 2016).
- **`maxOrdersPerRun` 40.** After the build, the busiest simulated day had 30 trades (typical peak 18–26). It
  never exceeded 40. **Keep.**
  - Note: a 41st order throws a `GuardError` out of `executeOrders` mid-run, not a clean skip. It is unreachable at
    today's book size, but would matter if the desk's coverage roughly doubled.
- **The 5-day lock.** Fixed by rule; measured for information only. A 1-day lock does *worse* (−0.14pp at b = 0,
  −0.31pp at b = 0.2) and raises turnover from 21× to 24×. The lock works as a turnover brake on the sizer's
  10× contrarian elasticity, so the compliance rule is not costing money.
- **`consecutiveHaltLimit` 3, `maxNotionalFrac` 1.0, `maxLateMin` 20, `submitCutoffET` 15:50.** These are
  operational, with no performance trade-off. **Keep.**

### 9. Execution knobs (inert or only gates at this NAV)

- **Always market orders below about $2,000 NAV.** Every order is under `marketOnlyBelowUsd` ($200) until a full
  10% position exceeds $200. So `limitTol*`, `limitTolBeta`, `limitTolMin` and `exitTolMult` only act when a market
  leg is blocked and a whole-share IOC is the fallback.
- **Gates that still apply:**
  - `marketMaxSpread` (1% / 1% / 2.5%) and `maxStaleMin` (5 / 15 / 60 min) gate every market order.
  - `gapHalt` and `closeAnchorSizeMult` act through `computeLimit`.
- **Cost model.** One-way cost ≈ (effective/quoted) · quoted spread/2. Schwab's effective/quoted ratio is 0.23 on
  real odd-lot orders (Huang, Jorion, Lee & Schwarz, FEDS 2024-080). So a 1% spread costs about 11 bp and 2.5%
  about 29 bp. The gates are loose but harmless.
- **Cost sensitivity.** At 21× turnover each extra 1 bp of cost is about −0.2pp a year: 10 bp costs today's config
  −1.6pp a year. At 10 bp the package (its `rExit` 0.25 variant) still beats the default by about 0.8pp a year.
- **One real gap: a spread or freshness gate can block a sub-share EXIT.** At this NAV most positions are
  under one share. When the market leg is blocked and there is no whole share, nothing is sent and the exit
  waits a day. Review C: never let a spread gate block a risk exit. 💡 Small follow-up: let an EXIT's fractional
  market leg through a wide spread, or widen the gate for exits.
- **Leave unchanged:** `fractionalShares`, `minEnterUsd` ($1, the broker minimum) and `minOrderUsd` (whole-share
  mode only).

### 10. Ideas from the literature, tested and rejected

| Idea | Source | Simulated (normal / stressed) | Verdict |
|---|---|---|---|
| Cap μ in the score at 0.35 / 0.5 | Palley, Steffen & Zhang 2025; review A | −0.13 / −0.21; +0.05 / −0.05 | 🚫 |
| Half credit for μ created by a price fall | Review A (stale targets) | k = 0.5: +0.02 / +0.16; k = 0: **−0.79** / +0.02 | 🚫 The dip re-marking earns its keep |
| Inverse-downside tilt D^−0.5 / D^−1 | Review B (μ/D² ≈ mean-variance) | 0.00 / +0.03; −0.25 / −0.09 | 🚫 |
| Beta tilt β^−0.5 | Frazzini & Pedersen 2014; review B | −0.17 / −0.05 | 🚫 |
| Partial rebalancing; w^{2/3} band | Gârleanu & Pedersen; Martin | §6 | 🚫 |
| Equal weight | DeMiguel, Garlappi & Uppal 2009 | −1.46 / −0.28 | 🚫 |

Each idea could still win if μ's information is concentrated differently than the simulation assumes. The vol
tilts in particular are unresolved and stay with the deferred risk-aware tilt.

### 11. Knobs that do nothing today

| Knob | Why |
|---|---|
| `muEnter` 0.08, `muExit` 0.03 | The R gates always fire first for reports published as BUY (§1, §4) |
| `convictionMin` 45 | No buy-side report sits below it |
| `minTradeNavFrac` 0.5% (ADD/TRIM) | Smaller than the 2.5pp band |
| `muMin`, `rMin` | Analytical snapshot only (`portfolio:build`) |
| `cashCeiling`, `minNamesForCeiling` | Read only by `trade:review`'s display, never by sizing |
| `alpha`, `sigmaMin` | Legacy Kelly knobs, unused |
| `touchHorizonYears`, `touchDrift` | Display-only P(touch) |
| `limitTol*`, `exitTolMult` | Fallback path only at NAV < ~$2,000 (§9) |
| `maxRunTurnoverFrac`, `maxDayTurnoverFrac` | Breaker off unless `TURNOVER_BREAKER` (§8) |

## What only the desk's own record can settle

The configurations that remain open all depend on μ's information content b, which no literature measures for
an LLM desk. Review A's prior is b ≈ 0–0.10. With 45 names, the standard error of b is about 0.2 per year of
12-month data, so the calibration log should measure at 1–3 months:
- the slope of excess returns on μ at publication, and on the part of μ added by price moves since publication;
- the decay of that slope by report age;
- whether κ and Q add to μ;
- whether μ's volatility-linked part carries information.

These four answers settle:
- the score exponents, i.e. whether to drop the second μ;
- the vol and beta tilts;
- a percentile conviction filter;
- a GICS or cluster cap;
- the breach bands.

## Ranked recommendations

1. **`stalenessMaxDays` 120 → 150.** It stops forced exits in the 10-K gap. The mechanism, the SEC calendar, the
   literature and the simulation all agree.
2. **`rExit` 0.35 → 0.15.** It holds rallied names to near fair value, with fewer exits and less turnover. Together
   with item 1: +0.39 / +0.57pp a year.
3. **`bearFloor` 0.15 → 0.25 (optional).** The package rises to +0.74 / +0.72pp a year (t 3.9 / 5.0), and +0.69 on
   held-out universes. The floor's own share is +0.34 / +0.15 and was zero on the held-out set. It also shifts
   the book toward more volatile names.
4. **Leave everything else.** In particular:
   - `wMax` (bigger caps fail the bust stress);
   - the breach bands (holding stock-specific breaches fails the stress);
   - `tradeBand` 2.5% (optimal inside the package and in theory);
   - the score exponents (pending b);
   - the turnover breaker off (it would halt 1 run in 6; if ever on, set it to ≥ 40%).
5. **Small code follow-ups:**
   - let a risk EXIT through the spread gate (§9);
   - turn a 41st order into a clean skip instead of a thrown `GuardError` (§8);
   - extend the calibration log to measure b, the drift component, decay by age, κ and Q.

Applying items 1–3 means three values in `lib/portfolio/config.ts` (`stalenessMaxDays`, `bearFloor`) and
`lib/trade/config.ts` (`rExit`), the matching tests and docs, and a rebuild of the trader.
