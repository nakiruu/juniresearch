# Review of `engineaudit.md` — what holds, what makes money, what changed (2026-10-03)

**Scope.** An external "aggressive audit" of the engine made seven claims and proposed three fixes.
Each was checked against the code, measured on the live book and on Shibui price history, and checked
against the literature it cites. The question for every item is the owner's: **would it raise realized
profit** (compounded return), not only a risk statistic?

**Status.** One code change, on the sizing path only: the **bear floor on D**. Finding F1 found it; the audit
did not. Everything else is a verdict, recorded in `docs/engine.md` as a 🚫 or 💡 callout so it is not
re-proposed.

## Method and its limits

- **Book.** All 92 published reports, marked at their own `quote.currentPrice` (as in the 2026-09-26
  review). This gives 49 eligible names, 49 held, 1.0% cash, N_eff 32.7.
  - The live-price variant uses the latest Shibui close from the calibration log (2026-10-01).
  - Realized vol and daily ES/β come from Shibui (252 sessions to 2026-10-01). FactPack β is the Blume-adjusted measured beta.
- **Timing overlays.** Tested on SPY (1994–2026) and IWM (2001–2026) with Shibui daily closes.
  - Price returns only. Cash earns 0 and dividends are missing. The two biases roughly offset, by about 2%/yr on the uninvested share.
- **No backtest of the score itself.**
  - Reports exist only since 2026-09-12, and the calibration log has 0 names at the 21-session horizon.
  - The audit's "point-in-time backtest … can be run today with the data already on disk" is false.
    `smid_log_returns_wide.csv` does not exist in this repo or its history.
  - Any claim below about μ is therefore conditional on μ's information content b, where realized excess ≈ b·μ.
    The calibration log (`npm run calibration:log`) is the only route to measuring b.
- Past-year risk statistics under today's weights carry look-ahead bias. They are used for **risk**, never
  for return.

## Summary

| # | Audit claim | Holds? | Profit effect of the proposed fix | Verdict |
|---|---|---|---|---|
| 1 | Caps are not a factor model; true N_eff < weight N_eff | **Yes.** DR² ≈ 4.4 vs N_eff 32.7. But equal weight is 4.6: it is the market factor, not the caps. SIC-2 does hide a 30.8% AI-hardware theme | Theme cap trims the highest-μ cluster. Unknown | 💡 defer (GICS group / cluster cap) |
| 2 | Score has no volatility penalty; not Kelly | **Mechanism wrong.** D tracks vol (ρ +0.75), so R is vol-neutral. **Outcome partly right:** the score leans to vol via μ (ρ +0.34) | ≈ 0 at face-value μ; positive only if b ≪ 1 | 💡 defer, gated on calibration |
| 3 | Should test volatility targeting | Confuses time-series vol targeting with a cross-sectional low-vol tilt | Time-series: −1.7pp/yr (SPY), −1.8pp/yr (IWM) unlevered | 🚫 |
| 4 | No covariance / beta measurement | **Partly.** β is measured per name (FactPack) but never aggregated | Measurement only | Noted (book β 1.44 realized, 1.14 Blume) |
| 5 | Band is not a stop-loss; add a drawdown breaker | **Wrong in a way that matters.** A crash *raises* μ (the engine buys); there *is* a stop, at the bear price (F1) | Breaker: −2.2pp/yr (SPY), −2.4pp/yr (IWM) | 🚫 breaker; F1 fixed |
| 6 | No regime awareness | True | High-vol overlay: −1.7 to −1.8pp/yr | 🚫 |
| 7 | No ES; use historical daily ES overlay | ES at 3-scenario resolution = D (as the engine says). The audit's example is wrong | −0.9pp model μ, −17% vol. Data-unsafe | 🚫 as specified; folds into #2 |
| fix 3 | Run the point-in-time backtest today | False: no data | — | Calibration log is the path |

**New, and the only code change: F1, the bear-price discontinuity.** The audit missed it.

## F1. R explodes near the bear price, then the name is dumped (fixed: bearFloor)

**Mechanism.** `buildSignal` re-marks every scenario to the live price: D = max(0, −min rᵢ) and R = μ/D.
- **Falling toward the bear:** μ rises and D → 0. The score μ·κ·R = κ·μ²/D → ∞ and the name goes to the
  10% cap.
- **One tick below the bear:** D = 0, R is null and `classify` EXITs the position (`hysteresis.ts`, tested as
  "EXITs on a null R").
- **Net effect:** the book reaches maximum size on exactly the stock about to trip a full exit.

**Measured on the real book, at live closes.**
- **BAC:** published with a 15.9% bear cushion, it fell 9.7% in 17 days and now sits 6.9% above its bear. Its
  target weight went **0.93% → 7.12%**, because its score rose 10× (μ 11% → 23%, D 15.9% → 6.9%).
- **Tracing BAC down:**

  | Distance above bear | +15% | +10% | +5% | +2% | +0.5% | −0.5% |
  |---|---|---|---|---|---|---|
  | Weight | 1.7% | 4.3% | **10% (cap)** | 10% | 10% | **0%** |

- **How often this matters.** Bears are shallow against realized vol: median held D ≈ 0.6 × annual vol. Under a
  driftless GBM at each name's realized vol, the median holding touches its bear with probability **23% within a
  quarter, 41% within six months and 58% within a year** (weight-average 29% / 46% / 62%). Reports go stale at
  120 days.

**Why this is model error, not edge.**
- The 3-point distribution puts zero probability below the bear, so "D → 0" reads as a riskless bet. Kelly
  agrees with the blow-up only under that literal, false distribution.
- The desk already rejects that reading at publication. `rating.bearFloor` 0.15 says "a bear scenario is a
  real scenario, not a formality" (`validate-judgment.ts`).
- Statistically, 1/D̂ is convex, so a score in μ̂²/D̂ is biased upward exactly where D̂ is small and noisy
  (Jensen; Smith & Winkler 2006, the optimizer's curse). μ also enters twice, through μ and through R.
- Optimism compresses D as it inflates μ. In Morgan Stanley's bull/base/bear valuations (Joos, Piotroski &
  Srinivasan 2016, *JFE*), realized returns trailed the base case by 6.2%, and the bull–bear spread *narrows*
  as base-case optimism rises. A score in μ²/D squares the optimism.
- Re-marked μ after a fall uses a stale target. Targets are sticky and chase price, and individual stocks
  show intermediate (3–12-month) momentum. So the re-marked μ of a fallen name overstates, and the blow-up
  concentrates capital where that error is largest.

**Fix.** `R_size = μ / max(D, bearFloor) = R · min(1, D/bearFloor)`, with `bearFloor` 0.15 = the desk floor,
in both sizers (`sizingRewardRisk` in `lib/portfolio/sizing.ts`; the kellyTilt μ·R core).
- Changes **nothing** at publication prices: 0.00% turnover, since every D ≥ 0.15.
- Changes 4.8% of the book at live prices, almost all BAC (7.12% → 3.51%).
- The floored score still rises monotonically as a name falls, so dip-buying is kept (BAC 3.8× its report
  weight). It never reaches the cap from the bear artifact alone: 6.4% at 0.5% above the bear, against 10%
  unfloored.
- Eligibility and the hysteresis gates keep the raw R, so **no entry or exit decision changes**. The floor
  shapes how much is held, never whether. `--bearFloor 0` restores the old behaviour.
- **Profit case.** It removes a structural concentration into names approaching their worst case, where the
  stale-target error is largest. Expected return is unchanged under any distribution with mass beyond the
  bear; variance and the size of the loss at the stop are lower. The case does not depend on measuring b.

**Not changed: the bear-breach exit itself (owner decision).** The exit now *says* what it is ("price at or
below the bear case"). Whether to keep it is a separate question:
- **Evidence against keeping it.** It is a tight stop: about a 0.6σ move from the report price. Kaminski &
  Lo (2014, *JFM*) show a stop raises expected return only when returns are positively autocorrelated at its
  horizon. Lo & Remorov (2017, *JFM*) find tight stops on individual US stocks underperform buy-and-hold.
  Short-term reversal (Jegadeesh 1990) points the same way.
- **Evidence for keeping it.** Intermediate momentum, and the chance that a breach reflects news the report
  lacks.
- **The design-consistent alternative.** Freeze a breached name (hold, no adds) and flag it for
  re-synthesis. The next report then decides, with an exit only if it is not re-underwritten within N days.
- It changes live exits, so it is the owner's call. Post-breach returns can be logged as breaches accumulate.

## 1. Concentration and factor risk

- **Claim.** The caps are a point constraint, and true diversification is lower than N_eff.
- **Book measurements** (trailing year, today's weights):
  - Volatility 22.2%; β to SPY 1.44; correlation 0.84; daily ES95 −2.81%; maximum drawdown −13.6%.
  - Diversification ratio Σwσ/σ_p = 2.10, so DR² ≈ **4.4 independent bets**, against weight N_eff 32.7.
  - Equal weight on the same 49 names gives DR 2.14 (DR² 4.6).
- **Reading.** The claim is true but generic. Average pairwise correlation is ≈ 0.2, so any long-only stock
  book is mostly one market factor, whatever its caps (Choueifaty & Coignard 2008; Meucci 2009).
- **The specific gap is classification.** SIC 2-digit splits one theme across sectors.
  - Semis, electronic components and data-center power (AIP, AVGO, LRCX, MPWR, NVDA, LASR, VSH, VICR, VRT,
    LTRX, EVLV) hold **30.8%**, across SIC 35/36/37. The largest SIC-2 sector is 21.3%. GICS IT is 29.7%.
  - These names carry daily β of 2.1–3.6.
- **Citations.**
  - Jagannathan & Ma (2003) is correctly cited but concerns minimum-variance portfolios built from a
    covariance estimate. The engine has none, so the caps are only ad-hoc shrinkage toward equal weight.
  - The "2026 arXiv" papers are Shinzato (arXiv 1605.06845, 2016: i.i.d. returns, no factor structure) and
    Caner & Fan (arXiv 2402.17523, 2024). Caner & Fan does not claim weight constraints leave factor
    exposure; it compares estimation error.
- **Verdict.** 💡 defer a GICS industry-group or correlation-cluster cap. At face-value μ it trims the
  highest-μ cluster, which costs expected return. Its value depends on b, like #2.

## 2. Kelly and the missing volatility penalty

- **Claim.** The score has no σ, so high- and low-vol names with equal μ, κ, R get equal weight. Promote
  kellyTilt or add a vol penalty.
- **The mechanism claim is wrong.** D is a downside-risk denominator and tracks realized vol:
  - Spearman +0.75 across 90 names, +0.74 among holdings.
  - So R = μ/D is vol-neutral (−0.06).
- **The outcome is partly right.** Authored μ rises with vol among holdings (+0.63). So μ·R = μ²/D leans
  toward volatile names (+0.34): book-weighted vol is 48% against 45% for equal weight.
- **Kelly arithmetic.** For a two-outcome bet, Kelly is f* = μ/(u·d) (MacLean, Thorp & Ziemba 2010).
  - The score/Kelly ratio is κ·μ·u. Relative to Kelly, the score over-weights high-upside names.
  - A uniform fractional-Kelly multiplier cancels in a normalized book. Only name-specific shrinkage changes
    weights: per Rising & Wyner (2012), shrink harder where estimation variance is larger.
- **What growth theory penalizes.** For a diversified long-only book, growth g = wᵀμ − ½wᵀΣw. The marginal
  condition is μᵢ − Cov(rᵢ, r_p) = const.
  - The penalty is covariance with the book, ≈ λ·βᵢ with λ = β_book·σ²_m ≈ 0.04. It is not the name's own vol.
  - β is already measured in every FactPack.
- **Measured effect** (bands give expected log growth vs production, in pp/yr):

  | Variant | Book μ | Vol | b = 1 | b = 0.5 | b = 0.25 |
  |---|---|---|---|---|---|
  | Production | 21.1% | 22.2% | — | — | — |
  | β-penalty (λ 0.04) | 21.7% | 21.8% | +0.7 / +0.8 | +0.4 / +0.5 | +0.2 / +0.3 |
  | ES overlay (#7) | 20.2% | 18.4% | −0.1 / +0.7 | +0.3 / +1.2 | +0.6 / +1.4 |
  | Equal weight | 17.5% | 20.4% | −3.2 / −2.8 | −1.4 / −1.0 | −0.5 / −0.1 |

  - Each cell gives the past-year vol (calm: SPY 13%) / long-run vol (SPY 18.8%) value.
  - The β-penalty is 5% turnover against production, with β 1.40 realized.
  - The ES overlay is 17% turnover.
- **Reading.**
  - At face-value μ the current risk tilt is roughly growth-consistent: the claimed upsides dwarf variance
    drag.
  - Risk-aware tilts help when μ is overstated, and more if the overstatement grows with vol.
  - All the gains are < 1.5pp/yr. That is far below what months of live data can detect, and it rests on
    one year of covariance.
- **What the literature says about b.**
  - **Levels are too high.**
    - Brav & Lehavy (2003, *JF*): 12-month targets average 28% above price; target/price is 1.37 for small
      caps vs 1.23 for large.
    - Bradshaw, Brown & Huang (2013, *RAST*): implied returns exceed realized by ~15%; 38% of targets are met
      at 12 months.
    - Green, Hand & Sikochi (2024, *RAST*): claimed undervaluation turns into realized return at **16–18
      cents per dollar**, so b ≈ 0.17 for sell-side targets.
  - **The bias grows with risk.**
    - Dechow & You (2020, *TAR*): beta and idiosyncratic-vol mispricing drive the predictable optimism.
    - Engelberg, McLean & Pontiff (2020, *JAE*): forecasts exceed realized returns by 34% on anomaly-short
      stocks.
    - Joos et al. (2016): bull–bear spreads are wider for high-β, small and high-IVOL names, and optimism
      narrows them.
  - **Relative ranks carry information that levels do not.**
    - Da & Schaumburg (2011, *JFM*): ranking target-implied returns *within sector* earned 177 bp/month, but
      79 bp (t 0.86) across all stocks.
    - Farago, Hjalmarsson & Zeng (2023 WP): ranks within each analyst predict; consensus levels do not.
  - **Low vol by itself is not a return source.**
    - Raw returns are roughly flat across beta deciles (Frazzini & Pedersen 2014: 0.91% vs 0.97%/month) and
      across most of the vol range (Ang et al. 2006).
    - The raw low-vol spread is insignificant after 2000 (Detzel et al. 2023, *CFR*). It concentrates in
      small, unprofitable, overpriced names (Novy-Marx 2014; Stambaugh, Yu & Yuan 2015).
    - A risk tilt earns money here only by correcting a μ that overstates more for risky names.
- **Sensitivity to b.** Growth-optimal sizing with realized ≈ b·μ penalizes model μ by (λ/b)·β:

  | b | λ/b | Turnover vs production | Blume β | Weighted name vol | N_eff |
  |---|---|---|---|---|---|
  | 1 | 0.04 | 5% | 1.11 | 48% | 28.8 |
  | 0.5 | 0.08 | 15% | 1.06 | 47% | 22.9 |
  | 0.17 | 0.24 | 31% | 0.91 | 41% | 16.5 (43 of 49 names → ~0) |

  - The right book swings from today's to a radically different one across plausible b.
  - At low b an additive penalty is the wrong form: it ranks on a noisy μ residual. The robust answer is
    heavier shrinkage toward equal or low-risk weights (Smith & Winkler; Rising & Wyner).
  - So b must be *measured* for this desk. LLM-authored scenarios that see the consensus are not sell-side
    targets, and the sell-side anchor can inform the prior but cannot settle the question.
- **Citation problems.**
  - "Kelly Betting Can Be Too Conservative" (Hsieh, Barmish & Gubner, arXiv 1710.01786) argues the
    opposite of the audit's use.
  - The "3× Kelly … median e-value exactly 0" quote is from a clinical-trials e-value paper (Zampieri, arXiv
    2512.04366). There it reads "≈ 0", and the baseline is not Kelly.
  - "Conformal Kelly" (arXiv 2608.01494): the 27.7% → 20.3% drawdown cut came from a separate leverage
    overlay, in-sample. Out of sample (2022+) the strategies earned 8.5% and 7.0% a year, below passive
    benchmarks.
- **Verdict.** 💡 defer until the calibration log gives b at d63/d126 on ≥ 10 names. Fit realized excess on
  E, and also on E × realized vol, to see whether the shortfall grows with vol.
  - b ≳ 0.7: keep the score.
  - b ≈ 0.3–0.7 or a vol gradient: shrink μ name-by-name (harder for volatile names) and add the β term.
  - b ≲ 0.3: move toward equal or low-risk weights, with μ used as a sector-relative rank (Da & Schaumburg).
  - The external prior (b ≈ 0.17, bias rising with risk) leans toward acting. The size and direction of the
    change depend entirely on b, though, so acting before it is measured would be a guess.
  - kellyTilt stays experimental. It cannot be A/B'd without history, a point the 2026-09-26 review already
    made.

## 3. Volatility targeting

- **Claim.** The engine wrongly dismisses volatility targeting. Its alpha is "trendy".
- **Two different things are conflated.**
  - **Time-series vol targeting** scales total exposure against market vol. Without leverage it can only hold
    cash in high-vol states.
  - **The cross-sectional low-vol tilt** is #2.
- **Time series, measured.**
  - Returns are not lower in high-vol states: SPY 10.6% vs 10.5%, IWM 13.4% vs 7.0% (annualized, 50-day vol
    above vs below its 1-year median).
  - Halving exposure in those states cost **1.7pp/yr** (SPY) and **1.8pp/yr** (IWM). It cut maximum drawdown
    56% → 45% and 60% → 37%.
- **Literature.**
  - **Moreira & Muir (2017, *JF*).** The vol-managed market has a 0.52 Sharpe (vs 0.42), but its weights reach
    2.6× at P90. Capped at 1×, Sharpe is still 0.52 while expected excess return falls to 5.6% against ~7.7%
    buy-and-hold.
  - **Cederburg et al. (2020, *JFE*).** Real-time vol management lowers certainty-equivalent return in 72 of
    103 strategies.
  - **Liu, Tang & Zhou (2019).** Moreira & Muir's scaling constant has look-ahead bias.
  - **Barroso & Detzel (2021).** Costs remove the gain outside the market factor.
  - **Hood & Raughtigan, "Volatility Targeting Is Trendy" (*JPM* 2025; SSRN 4773781).** It exists. US vol-target
    alpha falls 62% (3.15% → 1.19%, insignificant) once trend is controlled. The 0.35 trend beta is from an
    index-futures panel. Trend exposure conflicts with a contrarian book.
- **Self-contradiction.** The audit calls the hysteresis band "a trend-following mechanism", then describes it
  as value mean-reversion. It is the latter: μ is re-marked to price, so falls are bought and rallies sold.
- **Verdict.** 🚫

## 4. Covariance and beta measurement

- **Claim.** The engine cannot answer "what is the portfolio's β?".
- **Partly false.** Every FactPack carries measured β (2y weekly vs SPY, Blume-adjusted; `lib/facts/beta.ts`)
  for the cost of equity. Σwβ is one line. On the book:
  - 1.14 (Blume, shrunk toward 1).
  - 1.44 (realized daily over the past year, driven by the AI-hardware cluster).
- It is not reported. Reporting would help the owner read risk but does not change profit.
- **Verdict.** Noted. A `beta` column in the snapshot is a cheap follow-up if wanted.

## 5. Stop-loss and the drawdown breaker (the audit's "single highest-value fix")

- **Claim 1:** "if the market crashes and all names' μ fall simultaneously, the engine will exit everything."
  - **Inverted.** Fair values are fixed until re-rated, so a falling price raises μ and R. The engine buys.
  - It exits on rallies (μ < 3%), on downgrades, and at the bear price (F1).
- **Claim 2:** the engine has no stop-loss. It has one, at the bear price, and it is tight (F1).
- **The breaker.** Measured, halving exposure while the 10% → 5% drawdown state is on:

  | | Buy & hold CAGR | With breaker | Annual return in state vs out | State on |
  |---|---|---|---|---|
  | SPY, 1994–2026 | 9.14% | 6.96% | 13.0% vs 8.5% | 45% of days |
  | IWM, 2001–2026 | 7.37% | 4.96% | 14.5% vs 4.6% | 54% of days |

  - Forward returns are *higher* after drawdowns, so the breaker de-risks exactly when they are best.
  - The audit's version (halve new entries, raise bars) is milder but has the same sign. It also fights the
    engine's own μ re-marking.
- **Theory.**
  - Kaminski & Lo (2014): the stopping premium is ≤ 0 under a random walk and negative under mean reversion.
  - Grossman & Zhou (1993) and Kardaras, Obłój & Platen: a hard drawdown floor α costs growth by a factor (1 − α).
  - Perold & Sharpe (1988): buy-the-dip constant-mix beats portfolio insurance in reverting markets.
- **Citations.**
  - Daniel & Moskowitz (2016) momentum crashes come from the *short losers leg* crashing up after declines,
    which is a gain for a dip-buyer.
  - The "1%/2%/3% → cut 20/30/50%" rule is from a minute-bar BTC strategy with 4× leverage (Li et al., arXiv
    2512.02227, 2025), not a 2026 equity paper.
  - The commodity stop-loss study (Fan & Zhang 2024, *J. Futures Markets*) is long-short trending futures,
    the one case where Kaminski & Lo predict stops help.
  - The cool-down paper (arXiv 2609.12793) uses one index, one 365-day window and no ablation.
- **Verdict.** 🚫 breaker. If a guard is wanted, key it to **signal failure**, not price: e.g. a large share
  of holdings breaching bears, or realized vs predicted μ diverging. Then freeze adds pending re-synthesis.

## 6. Regime detection

- The proposal (raise `muEnter` 0.08 → 0.10 and `rEnter` 0.60 → 0.70 when SPY 50-day vol > 1-year median) is a
  milder form of #3. Its measured return cost is −1.7 to −1.8pp/yr at full strength.
- The cited "orchestration framework" regime factors (1.8, 2.5, 0.7, 0.8) come from the same BTC minute-bar LLM
  paper (17-day window, 17 trades). Its own stock test returned 20.4% against 47.5% for equal weight.
- Kritzman, Page & Turkington (2012) is a multi-asset Markov-switching model on turbulence, inflation and
  growth. It is not a single-stock entry hurdle.
- **Verdict.** 🚫

## 7. Expected Shortfall

- **The audit's example is wrong.** "Bear −30% at 10% vs at 40% probability … R is identical": a 40% bear
  probability lowers μ, so it lowers R. R is identical only if the other legs are moved to hold μ fixed. Even
  then, ES at α = 5% on 3 points is D for both, so ES would not separate them either.
- **The overlay.** Historical daily ES from 252 closes is ≈ 2.3× daily σ, so it is an inverse-vol tilt at a
  1-day horizon on a 12-month thesis. Three practical defects:
  - Shibui/Yahoo closes are split- but not spin-adjusted. DD's Qnity spin is a −57.5% "day" (2025-11-03).
  - SOLS has 231 sessions and NVT is not in Shibui.
  - The headless trade layer cannot call Shibui (a connector).
- **Effect on the book.** −0.9pp model μ, −17% vol, β 1.44 → 1.23, maximum drawdown −13.6% → −10.9%. Whether
  that is profit is question #2 (b).
- **Citations.**
  - Han, Wang, Wang & Wu (*Math. Finance* 2024) is an axiomatic characterization of ES. It does not claim that
    high N_eff can hide tail concentration.
  - The Man Group note is a practitioner piece on signal-level allocation, not stock sizing.
- **Verdict.** 🚫 as specified; the economic question folds into #2.

## Citation audit (13 audit citations)

Four hold as cited: #1 Jagannathan & Ma, #9 ES factor models (Hou et al., arXiv 2609.10587), #10 Man note,
#12 regime vol forecasting (Fang & Ślepaczuk, arXiv 2606.09478, CSI 300). One, the cool-down paper, is
accurate but weak. The rest have the wrong year (2), the wrong paper (7), a merged source (5), or a claim the
paper does not make (3, 6, 8).

## Owner decisions and follow-ups

1. **Merge the bear floor** (this branch). It changes live sizing, not entries or exits.
2. **Bear-breach policy:** keep the exit, or freeze and re-synthesize (F1).
3. **Keep running `calibration:log`.** Every deferred item (#1 theme cap, #2 risk-aware tilt) is gated on b.
   - The first d21 cells fill around late October, d63 around December.
   - Add one regression when they do: realized excess on E and on E × realized vol (`realizedVol252` is
     already logged).
   - Test μ as a within-sector rank against its level (Da & Schaumburg).
4. Optional: report book β (Σwβ) and DR in the snapshot.
