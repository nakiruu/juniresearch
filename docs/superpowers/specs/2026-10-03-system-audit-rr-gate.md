# System audit: should the reward/risk gate be replaced, or swapped for Shibui presets? (2026-10-03)

**Question (owner).** Should the reward/risk gate (R = μ/D) be replaced? Should any Shibui screening
presets be used in its place? Reason it through, research it and test it.

**Answer.**
- **Keep the R gate.** Its real defect was the exit at 0.35: it sells the median BUY after only a
  **+5.3%** rally, with about 10% of its upside left. The config audit already moves that exit to 0.15
  (`2026-10-03-config-audit.md`).
- **R vs a plain upside gate.** With that exit fixed, the simulation cannot tell R apart from a plain
  μ ≥ 10% / μ < 3% gate: +0.19 / −0.07pp a year, normal / bust-stressed, not significant.
- **Do not use Shibui presets as gates, as an extra filter or as a replacement for R.**
  - In the engine simulation every hard preset gate lost **0.6–4.0pp a year**.
  - The factors behind them have earned roughly zero in US stocks since 2010. Quality consistency is the one
    exception.
  - They are sparse: today 0–25 of the desk's 50 BUYs pass any one preset.
- **Presets as tilts do nothing** (±0.1pp).
- **A quant screen does beat holding everything.** A screen book on a continuous value / quality /
  momentum composite returns +1.4pp a year more than holding every name. But it only ties the desk engine
  if the desk has no skill. At the modest skill seen in human analysts' targets, the desk engine leads by
  1–3pp a year.
- **Where Shibui belongs.** Offline: the earnings capture already built, the synthesis queue, the
  calibration log, and logging a quant composite next to each report for forward testing.

## What the R gate is, exactly

R = μ/D with μ = FV/P − 1 (FV the probability-weighted fair value) and D = 1 − B/P (B the bear price). It
does four jobs:
1. it feeds the desk's label (BUY needs R ≥ 0.5, STRONG BUY R ≥ 1.0);
2. it is the entry gate (R ≥ 0.6);
3. it is the exit gate (R < 0.35, recommended 0.15);
4. it scales size (R_size).

**R is a pair of price ceilings.** For a name with D > 0, R ≥ r is the same test as μ − r·D ≥ 0. That in
turn is the same as P ≤ (FV + r·B)/(1 + r).

| Rule | Price at which it fires | On the 50 live BUYs, median vs the publication price |
|---|---|---|
| Enter: R ≥ 0.6 | P ≤ 0.625·FV + 0.375·B | +1.1% (9 names need a dip before they can be bought) |
| Enter: μ ≥ 10% | P ≤ 0.909·FV | +5.5% (all buyable at publication) |
| Exit: R < 0.35 (today) | P > 0.741·FV + 0.259·B | **+5.3%** |
| Exit: R < 0.15 (recommended) | P > 0.870·FV + 0.130·B | +10.6% |
| Exit: μ < 3% | P > 0.971·FV | +12.6% |

- **The margin of safety scales with risk.** Because the ceiling sits between fair value and the bear, the
  safety margin R demands grows with the scenario spread FV − B, which tracks volatility (D vs realized vol,
  Spearman +0.75). In effect R is a signal-to-noise test on μ. That is a defensible construction *if the
  desk's errors in μ scale with D*, which is unmeasured.
- **The entry–exit band is narrow.** It is 0.116·(FV − B), about 4–5% of the price for a typical name. Many
  BUYs sit near both edges, which is why turnover runs at 21× NAV a year.
- **R carries little that μ does not.** On the live BUYs, Spearman(R, E) is +0.51 and (R, D) is −0.32.
  Holding μ fixed, a higher R comes from a shallower bear.

## Literature

There were two reviews, with every arXiv and journal citation checked. The memos are in the session scratchpad at
`system-audit/lit-R-gate.md` and `lit-presets.md`.

**On the ratio gate:**
- **What these ratios were for.** Upside/downside ratios (upside potential, Omega, gain-loss, Rachev,
  Kappa) were built to *rank past performance*. They do not scale with position size (Cherny & Madan, RFS
  2009). The only manipulation-proof performance measure is a power-utility certainty equivalent
  (Goetzmann, Ingersoll, Spiegel & Welch, RFS 2007). Ratios have no finite moments when the denominator is
  near zero (Hinkley 1969); this is the D → 0 blow-up that the bear floor and breach rule now handle.
- **Kelly and expected utility.** These put risk into *size*, not the entry test: enter when expected excess
  return net of costs is positive, and size as α/σ² (Treynor & Black 1973; Davis & Norman 1990; Gârleanu &
  Pedersen 2013). Parameter uncertainty shrinks size, not the gate (Rising & Wyner 2012; Baker & McHale
  2013).
- **Noise.** The ratio of two noisy estimates is noisier than either. With μ̂ = 15% ± 7.5pp and
  D̂ = 20% ± 4pp, one standard deviation of R̂ runs from about 0.35 to 1.15, spanning the exit, entry and
  STRONG BUY cut-offs (review A, derived). Selecting on the highest estimates guarantees disappointment
  (Smith & Winkler 2006, the optimizer's curse; Andrews, Kitagawa & McCloskey, QJE 2024).
- **What upside skew signals.** A bull tilt in analyst scenarios reflects optimism (Joos & Piotroski, RAST
  2017). The bull–bear spread measures risk, not alpha (Joos, Piotroski & Srinivasan, JFE 2016).
  Market-measured right skew predicts *lower* returns (Xing, Zhang & Zhao 2010; Boyer, Mitton & Vorkink
  2010; Bali, Cakici & Whitelaw 2011).
- **The exit pattern.** Mechanical sells of winners look like the institutional sells that underperform
  random selling by about 80 bp a year (Akepanidtaworn, Di Mascio, Imas & Schmidt, JF 2023).
- **Literature's verdict.** R is a sound risk descriptor but a weak gate. The theoretically right gate is a
  shrunk level: posterior μ = b·(μ̂ − cost of equity)⁺ above costs, with size ∝ μ_post/σ². There is **no
  head-to-head empirical test** of ratio-gated against level-gated stock selection.

**On the presets.** Figures are post-2010 long-short %/month with t-statistics. Review B recomputed them
from Ken French, Chen–Zimmermann, Jensen–Kelly–Pedersen and AQR data.

| Preset | Underlying factor since 2010 | Literature's verdict |
|---|---|---|
| S1 value (P/E 5–20, ROE > 12%, op. margin > 8%) | E/P large-cap −0.16 (−0.6). Value fell 58% from 2006 to 2020 and is still about 32% below its peak | Not a gate |
| S2 growth (revenue > 15%, ≥ 3 of 4 beats) | Sales growth ≈ 0; 76–78% of S&P 500 firms beat each quarter | Not at all |
| S4 dividend quality | Dividend yield ≈ 0 | Not a gate. Net payout or FCF yield is better |
| S5 quality consistency | Quality-minus-junk 0.23 (1.1), gross profitability 0.30 (1.9); *stability itself* 0.05 (0.5) | Tilt only. The strongest family |
| S6 momentum + quality (SMA/RSI band) | Momentum large-cap 0.06; moving-average rules fail data-snooping tests | Not this form. 12-1 momentum as a tilt |
| P8 oversold (RSI < 30, below the band) | Short-term reversal −1.28%/month after costs; large cap −0.10 | Not at all |
| P10 Piotroski ≥ 7 | 0.03–0.16, t ≤ 0.3 | Keep only the desk's existing low-score cap |
| P11 earnings surprise | Drift gone in large caps since 2006 (Martineau 2022) | Not a raw-surprise gate |

Four further findings bear on the design:
- **Thresholds throw away information.** A pass/fail cut at a 10% pass rate keeps about 0.59× of a
  signal's correlation with returns. Composites beat stacked screens (Fitzgibbons et al. 2017).
- **Analysts and quant signals.** Analyst recommendation levels add value only when quant signals agree
  (Jegadeesh, Kim, Krische & Lee, JF 2004). Analysts are most optimistic on anomaly-short stocks
  (Engelberg, McLean & Pontiff 2020).
- **How to combine them.** The literature supports a quant *veto at the extremes* or a *tilt*, not a
  replacement.
- **Fast screens and the lock.** Technical screens flip faster than the 5-day lock: a median S6 pass streak
  of about 4 days, and P8 about 1 day.

## Test 1: each preset on its own, across the whole US market (Shibui)

- **Sample:** Shibui `stock_data_query` on US common stocks with market cap ≥ $1B. Rebalance dates are the
  first session of Feb/May/Aug/Nov, 2010–2025 (64 dates, 77,000 stock-dates).
- **Point-in-time rule:** fundamentals are used only from period end + 75 days, a conservative filing lag.
- **Measure:** excess return over the equal-weight universe on the same date, in pp.

| Preset | 2010–15 | 2016–20 | 2021–25 | Consistent? |
|---|---|---|---|---|
| S5 quality consistency | +0.52 | +0.54 | +0.57 | **Yes, the only one** |
| S1 value | −0.68 | −2.14 | +0.69 | No |
| S2 growth (revenue only) | −0.87 | +2.03 | +0.49 (medians negative) | No |
| S4 dividend (price-only, about +1pp understated) | −0.75 | −2.34 | −0.38 | No |
| S6 momentum + quality | +0.59 | −0.72 | +2.24 | No |
| Trend only (close > SMA50 > SMA200) | −0.01 | +0.95 | +1.57 | Recent only |
| P10 Piotroski ≥ 7 | +0.69 | −1.57 | +1.96 | No |
| **P8 oversold** | **−1.63** | **−2.74** | **−5.49** | Consistently *negative* |

Cells are 126-session excess returns. The 63-session results show the same signs except P8, which is briefly
positive in 2010–15, and S4 in 2021–25.

**Dips × quality.** Monthly dates; a stock-specific dip is ≥ 10% down over 21 sessions and ≥ 8pp below SPY.
Quality dips beat other dips in 2016–20 and 2021–25 (+1.6, +2.1pp at 126 sessions) but lagged in 2010–15
(−1.9pp). Low-Piotroski dips swing from +5.5 to −4.0pp across eras. So the data gives no consistent
"buy only quality dips" filter.

Shibui prices are survivor-only and exclude dividends; both caveats are stated in Shibui's own docs.

## Test 2: today's book under each preset (Shibui, 2026-10)

| Preset | Pass, all 94 names | Pass, the desk's 50 BUYs |
|---|---|---|
| S2 growth (revenue only) | 43 | 25 |
| P10 Piotroski ≥ 7 | 34 | 19 |
| S1 value | 16 | 11 |
| S5 quality consistency | 14 | 9 (AMZN, GOOGL, INTU, LRCX, MPWR, NBIX, NVDA, PLOW, VRT) |
| S4 dividend quality | 13 | 7 |
| S6 momentum + quality | 7 | 1 (NVDA) |
| P8 oversold | 0 | 0 |

As a hard gate, any preset except S2 would cut the investable set to 0–19 names, against about 37 held in the
simulation of the recommended config. Shibui's full S2 also requires earnings beats, which would pass even fewer names.

## Test 3: the production engine with each gate design (simulation)

This reuses the config audit's harness, which runs `buildSignal` → `emitTrades` → locks on real prices. The
changes:
- **Base:** the recommended config (`stalenessMaxDays` 150, `bearFloor` 0.25, `rExit` 0.15).
- **Universes:** 36 random 94-name universes, 2012–18 and 2019–26.
- **Signal models:** four models of how informative μ is (b = 0 / 0.1 / 0.2 / 0.4, with alpha above a 10%
  cost of equity for b > 0).
- **Stress:** each run is repeated with the bankruptcy stress.
- **Presets:** computed **point-in-time** inside each universe.
  - Fundamentals come from SEC XBRL `companyfacts` as known on each filing date: TTM by
    annual + YTD − prior YTD, split-adjusted market caps, and a 9-signal Piotroski score.
  - SMA, RSI and Bollinger bands come from the daily prices.
  - The composite is the average within-universe percentile of earnings yield, ROE, gross profit/assets and
    12-1 momentum.
  - Names with no fundamentals on file pass a fundamental screen (fail-open), so missing data never shows up
    as a preset effect.

Cells are the change in annual compounded return vs the R-gated base, **normal / bust-stressed**,
prior-weighted over the four signal models, in pp, with t-statistics across universes.

| Design | Result | Names held | Verdict |
|---|---|---|---|
| **Base: R gate** (enter R ≥ 0.6, exit R < 0.15) | 0 | 37 | **Keep** |
| μ-only gate (enter μ ≥ 10%, exit μ < 3%) | +0.19 (t 1.5) / −0.07 (t −0.6) | 40 | Tie |
| μ-only, enter μ ≥ 12% | +0.19 / −0.10 | 38 | Tie |
| R computed with a 25% floor on D | +0.08 / −0.12 | 32 | Tie |
| Live label (HOLD-published names may enter on a fall) | +0.13 / −0.01 | 37 | Tie |
| **Preset as an extra filter** on entry: P10 / S4 / S1 / S6 / S5 / S2 / P8 | −1.28 / −1.35 / −2.33 / −2.51 / −2.76 / −2.64 / −4.46 (normal) | 11–18 | 🚫 |
| S5 filter, also exiting when S5 fails | −2.85 / −1.90 | 13 | 🚫 |
| **Preset replacing R** (μ ≥ 10% + preset): P10 / S4 / S6 / S1 / S5 / S2 / P8 | −1.08 / −1.34 / −2.15 / −2.09 / −2.41 / −2.42 / −3.98 (normal) | 12–20 | 🚫 |
| Composite gate: veto the bottom 30% | +0.10 (t 0.2) / +0.49 (t 1.3) | 34 | 💡 Not significant; log it |
| Composite gate: top half only (filter / replace) | −0.67 / +0.01; −0.57 / +0.09 | 28–29 | 🚫 |
| Tilt: S5 +25% / P10 +25% / composite ×0.8–1.2 | −0.03 / −0.02; −0.12 / −0.02; −0.04 / −0.08 | 37 | No effect |

**Why the hard gates lose.**
- **Fewer names.** They leave 12–20 names and 5–21% cash in a 94-name universe. Volatility falls 1–3pp, but
  compounded return falls more.
- **No offsetting edge.** The factors themselves carry little edge (Test 1).
- **Desk skill is filtered away.** A filter removes desk BUYs regardless of their μ, so whatever skill the
  desk has is thrown out with them. The loss grows with b: S5 as a filter costs −2.0pp at b = 0 and −4.1pp
  at b = 0.4.
- **The momentum and oversold presets** also churn against the 5-day lock.

**Screens as the whole strategy.** These books drop the desk entirely: they hold the preset's passers in
equal weight through the same engine, caps and locks.

| Screen book | vs holding every name in equal weight | vs the desk engine at b = 0 / 0.1 / 0.2 / 0.4 |
|---|---|---|
| Composite, top 30% | **+1.40 (t 3.1) / +1.30 (t 2.9)** | +0.10 / −1.13 / −2.84 / −5.41 |
| P10 Piotroski ≥ 7 | +1.13 (t 3.0) / +0.74 (t 2.0) | −0.16 / −1.40 / −3.01 / −5.87 |
| S4 dividend | +0.07 / +0.11 | −1.03 / −2.42 / −4.21 / −7.13 |
| S5 quality | −2.12 / −2.14 (about 8 names, 23% cash) | −3.24 / −4.63 / −6.34 / −9.34 |
| S1 value | −2.51 / −2.76 | −3.69 / −5.02 / −6.73 / −9.65 |

- **How to read this.** A continuous quant composite, or a Piotroski screen, carries real information in
  this data. That information is about as large as everything the desk engine adds when the desk has *no*
  skill.
- **When the desk wins.** At b = 0.1, the low end of human-analyst evidence, the desk engine already leads
  by more than 1pp a year.
- **So screens are not a replacement.** Replacing the desk and its R gate with screens is right only if the
  desk turns out to have no skill. That is exactly what the calibration log will show within a year or two.

**Limits.**
- Survivor-only prices (partly addressed by the bust stress).
- Reports are synthetic, and alpha ∝ μ by construction. So the simulation cannot reward R for picking
  better bear cases. Nor can it punish the vol-linked part of μ that the literature calls uninformative.
- Point-in-time fundamentals cover 63–85% of name-days. The gaps are foreign filers and pre-2012 XBRL, and
  they are handled fail-open.

## Verdict on the system's signal chain

| Component | Verdict | Evidence |
|---|---|---|
| R as the entry gate (0.6) | **Keep** | Ties a μ gate in simulation. Its risk-scaled margin of safety is a defensible signal-to-noise test while μ's errors are unmeasured |
| R as the exit gate | **Fix by config: 0.35 → 0.15** | At 0.35 it sells after a +5% rally. This is one of the config audit's three changes (about +0.2 of its +0.74pp) |
| R in sizing (μ·R ≈ μ²/D) | Keep for now | Exponents tested in the config audit. The literature's α/σ² form waits on b |
| Published-label gate (only BUY-published names enter) | Keep | Letting HOLD-published names enter on price falls ties (+0.13 / −0.01) |
| Desk quality gate (distress, Piotroski ≤ 2, accruals cap) | Keep | Matches the one preset use the literature supports: a rare, severe veto |
| Shibui presets as gates | 🚫 | −0.6 to −4.0pp a year; sparse; post-2010 factors ≈ 0 |
| Shibui presets as tilts | 🚫 | No effect |
| Quant composite as a bottom-30% veto | 💡 Log, don't trade | +0.10 / +0.49, not significant; the literature supports the form |

## What would change the verdict

The right long-run gate, in theory, is a shrunk level: μ_post = b·(μ̂ − cost of equity)⁺ × staleness,
entered when it clears costs plus the band, sized ∝ μ_post/σ², exited on new information. Every input to
that rule except b already exists. So the work is measurement, not code:

1. **Log a quant composite with each report.** The calibration log should store earnings yield,
   profitability, 12-1 momentum, accruals and the composite percentile with every desk report and
   price-triggered entry, captured with the same Shibui print → save → `--apply` pattern. Then the desk's
   μ and the composite can be compared on the desk's own names (Jegadeesh et al. 2004: analyst calls add
   value where quant signals agree).
2. **Measure b, and whether D predicts μ's errors.** Fit b at d63/d126 and test whether |realized − b·μ|
   grows with D.
   - If it does, R's risk scaling is earning its keep.
   - If it does not, switch the gate to μ_post.
3. **Revisit the composite veto** once 1 and 2 have a year of data. Make it a production gate only if the
   composite still predicts within the desk's BUYs.

## Recommendation

- **No code change.** Keep the R gate.
- **Apply the config audit's `rExit` 0.15** (applied 2026-10-03, with `stalenessMaxDays` 150 and `bearFloor` 0.25). It removes the gate's one real defect, the exit after a 5%
  rally.
- **Do not wire Shibui presets into the trader.**
- **Extend the calibration log** with the quant composite and the b / D-error tests above. That is how the
  desk-vs-screens question gets settled on the desk's own record.
