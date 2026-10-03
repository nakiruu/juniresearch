# Research A: Conditional growth/core allocation (regimes, volatility, trend, factor timing, macro)

Prepared 2026-10-03. Literature research only; nothing in the repo was changed.

**Question.** What does the evidence say about conditionally shifting weight between a high-beta GROWTH sleeve (small/mid-cap, $300M–$20B, accelerating revenue) and a defensive CORE sleeve (large caps of $50B+ with high ROIC and moderate growth)? Which rule is most defensible?

**Verification legend.**
- [P] means I read the number in the primary text: a PDF I downloaded and extracted, or the abstract on the official landing page.
- [A] means the abstract or landing page was verified but the number comes from the abstract only.
- [S] means the paper's existence is verified but the specific number comes from a secondary or search excerpt. Treat [S] numbers as indicative.
- IS = in-sample, OOS = out-of-sample, gross/net = before/after costs.

---

## Read this first: the lever is weaker than it looks

Both sleeves are 100% equity. Moving weight between them changes portfolio beta only by `Δw × (β_growth − β_core)`.

Example: assume a small/mid growth sleeve with β≈1.3 and a mega-cap quality sleeve with β≈0.9. These are planning assumptions, not measured values. Shifting 25 pp from growth to core then lowers beta by about 0.10. In a −35% market drawdown that saves roughly 3–4 pp, plus whatever flight-to-quality alpha the core earns (QMJ evidence below).

Almost all of the large drawdown cuts in this literature come from moving to **cash or T-bills**, not from moving between equity styles:
- Faber cut S&P maximum drawdown from −84% to −50%.
- Shu et al. cut it from −55% to −27%.

So the recommendation in (c) includes an optional T-bill leg in the defensive state. Without it, expect the dynamic split to soften drawdowns by single-digit percentage points, not halve them.

---

## (a) Annotated bibliography

### 1. Volatility-managed portfolios

**Moreira & Muir (2017), "Volatility-Managed Portfolios," *Journal of Finance* 72(4):1611–1644.** NBER w22208: https://www.nber.org/papers/w22208 (PDF read).
- **Rule:** scale exposure each month by c/σ²(previous month's realized variance).
- **Market results, 1926–2015 [P]:**
  - Annualized alpha 4.86% (text rounds to 4.9%).
  - Appraisal ratio 0.33.
  - About 25% higher Sharpe than buy-and-hold.
- **Other assets:** the result is also positive for value, momentum, profitability, ROE, investment and FX carry.
- **Costs [P]:** alpha stays positive with 1–14 bp costs (their Table). The full-variance version has high turnover and uses leverage of up to several times.
- **Robustness:**
  - The headline alphas come from spanning regressions with full-sample scaling constants c, so they are effectively in-sample.
  - The strategy is not implementable unlevered.
  - Critiques follow below.

**Cederburg, O'Doherty, Wang & Yan (2020), "On the performance of volatility-managed portfolios," *JFE* 138(1):95–117.** DOI 10.1016/j.jfineco.2020.04.015; RePEc: https://econpapers.repec.org/RePEc:eee:jfinec:v:138:y:2020:i:1:p:95-117 [S].
- **Test:** 103 equity strategies, run as real-time, OOS-implementable versions.
- **Result:**
  - The volatility-managed version beat the unmanaged one in 53 cases and lost in 50.
  - Only 8 had significant Sharpe-ratio gains.
  - The spanning-regression alphas do not translate into real-time Sharpe gains.
- **Robustness:** high. This is the main reason not to treat volatility scaling as free alpha.

**Liu, Tang & Zhou (2019), "Volatility-Managed Portfolio: Does It Really Work?," *JPM* 46(1).** DOI 10.3905/jpm.2019.1.107; https://www.ssrn.com/abstract=3283395 [A].
- **Result:**
  - The market-level Moreira–Muir result carries a look-ahead bias, from the full-sample scaling constant.
  - Once corrected, maximum drawdowns reach 68–93% in almost all cases (leverage).
  - The strategy beats the market only in the 2008 crisis.
- **Lesson:** cap leverage at ≤1 and estimate everything on expanding windows.

**Barroso & Detzel (2021), "Do limits to arbitrage explain the benefits of volatility-managed portfolios?," *JFE* 140(3):744–767.** https://econpapers.repec.org/article/eeejfinec/v_3a140_3ay_3a2021_3ai_3a3_3ap_3a744-767.htm [A].
- **Net-of-cost results** (five cost-mitigation schemes):
  - Volatility-managed **factors other than the market** have about zero alpha and lower Sharpe.
  - The **volatility-managed market** stays profitable after costs, but only in high-sentiment periods.
- **Relevance:** volatility timing at the aggregate-equity level is the one version that survives costs. That is the level at which a growth/core shift operates.

**Harvey, Hoyle, Korgaonkar, Rattray, Sargaison & Van Hemert (2018), "The Impact of Volatility Targeting," *JPM* 45(1):14–33.** https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3175538 [A].
- **Sharpe effect:** volatility targeting raises Sharpe only for **risk assets (equity, credit)**, through the leverage effect. The effect is negligible for bonds, FX and commodities.
- **Tail effect:** it reduces left-tail extremes across **all** asset classes.
- **Relevance:** it supports conditioning an equity-beta decision on volatility.

**Bongaerts, Kang & van Dijk (2020), "Conditional Volatility Targeting," *FAJ* 76(4):54–71.** DOI 10.1080/0015198X.2020.1790853; PDF: https://repub.eur.nl/pub/130215 [P].
- **Conventional volatility targeting:**
  - It does not consistently improve risk-adjusted returns in international equity markets.
  - It can **overshoot** the target, which *raises* maximum drawdown and tail risk.
  - On US factors it hurt size, value and investment.
  - For US momentum it raised Sharpe by 0.16 and cut maximum drawdown by 7.4 pp from 51.3%.
- **Their fix (implementable, expanding window):** sort last month's realized volatility against all prior months into quintiles.
  - Cut exposure only in the top quintile and raise it only in the bottom quintile.
  - Stay unscaled in quintiles 2–4.
- **Outcome:** the fix "consistently enhances Sharpe ratios and reduces drawdowns and tail risks, with low turnover and leverage" in major equity markets. It is robust to using quartiles or fixed volatility ratios.
- **This is the template I recommend for the volatility input.**

**Wang & Yan (2021), "Downside risk and the performance of volatility-managed portfolios," *JBF* 131:106198.** https://www.sciencedirect.com/science/article/abs/pii/S0378426621001576 [A/P].
- Scaling by **downside** volatility beats scaling by total volatility in spanning tests, Sharpe comparisons and **real-time** strategies.
- Tested on 9 factors and 94 anomalies.
- The gain comes from return timing: downside volatility negatively predicts returns.

**DeMiguel, Martín-Utrera & Uppal (2024), "A Multifactor Perspective on Volatility-Managed Portfolios," *JF* 79(6):3859–3891.** https://ideas.repec.org/a/bla/jfinan/v79y2024i6p3859-3891.html [A].
- A *conditional multifactor* portfolio beats its unconditional counterpart **OOS and net of costs**.
- Factor risk prices fall with market volatility.
- This rehabilitates volatility conditioning at the portfolio level, not factor by factor.

**Verdict for section 1.**
- Cutting **aggregate equity** exposure in **extreme** high-volatility months is the defensible version. It is moderately robust OOS and net of costs.
- Continuous inverse-variance scaling with leverage, and per-factor scaling, do not hold up out of sample.

### 2. Trend and time-series momentum filters

**Faber (2007; updated 2013), "A Quantitative Approach to Tactical Asset Allocation," *Journal of Wealth Management*.** PDF read: https://www.trendfollowing.com/whitepaper/CMT-Simple.pdf [P].
- **Rule:** hold the asset at month-end if price > 10-month SMA, otherwise cash.
- **S&P 500 total return, 1900–2005 (timing vs buy-and-hold) [P]:**

| Metric | Timing | Buy-and-hold |
|---|---|---|
| CAGR | 10.66% | 9.75% |
| Volatility | 15.38% | 19.91% |
| Sharpe | 0.43 | 0.29 |
| Maximum drawdown | −49.98% | −83.66% |
| Worst year | −26.69% | −43.86% |

- **Trading:** invested 70% of the time, with 0.67 round trips per year. It **underperformed in about 40% of years**.
- **Five-asset version:** fewer than one round trip per asset per year. The average losing trade was −3.9% over about 3.2 months, against average wins of +27.9% over about 19.5 months.
- **Robustness:** mostly IS. The SMA length was chosen on this history, and the gains come from avoiding slow bears (1929–32, 2000–02, 2008). The cost drag is small because trading is infrequent; the whipsaw cost appears as the frequent small losing trades.

**Moskowitz, Ooi & Pedersen (2012), "Time Series Momentum," *JFE* 104(2):228–250.** https://research.cbs.dk/en/publications/time-series-momentum/ [A].
- **Setup:** 58 liquid futures (equity indices, FX, commodities, bonds).
- **Findings:**
  - Returns persist for 1–12 months and partially reverse at longer horizons.
  - A diversified TSMOM portfolio earns substantial alpha with little factor exposure.
  - It "performs best during extreme markets."

**Hurst, Ooi & Pedersen (2017), "A Century of Evidence on Trend-Following Investing," *JPM*.** AQR landing page: https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing. Working-paper PDF read [P]: https://www.trendfollowing.com/whitepaper/Century_Evidence_Trend_Following.pdf
- **1880–2013, net of simulated transaction costs [P]:**
  - Gross return 14.9%/yr; **11.2% net of 2/20 fees**.
  - Volatility 9.7%; net Sharpe 0.77.
  - Correlation 0.00 to US equities.
- **Decade by decade:** positive in every decade. The weakest net Sharpe was 0.13 (1910s); 2000–2013 was 0.62.
- **Crises:** positive in **8 of the 10 largest 60/40 drawdowns**.
- **Mechanism, which is key for lag:** the average peak-to-trough length of those drawdowns was **~15 months**. Most bears unfold slowly enough for a trend signal to catch.
- **Robustness:** high for diversified long/short futures. It transfers only partly to a long-only single-market equity filter.

**Huang, Li, Wang & Zhou (2020), "Time-series momentum: Is it there?," *JFE* 135(3):774–794.** https://ideas.repec.org/a/eee/jfinec/v135y2020i3p774-794.html [A].
- Asset-by-asset tests find little evidence of TSMOM predictability, IS or OOS.
- The pooled t-stat fails bootstrap critical values.
- TSMOM profits are close to a strategy based on the historical mean.
- **Lesson:** treat trend as a **risk-reduction** device (it avoids prolonged bears), not as a return forecaster.

**Zakamulin, "The Real-Life Performance of Market Timing with Moving Average and Time-Series Momentum Rules" (SSRN 2242795) and *Market Timing with Moving Averages* (Palgrave, 2017).** https://doi.org/10.2139/ssrn.2242795 [S].
- OOS tests with realistic costs over 1870–2010 find that MA/TSMOM timing performance is **substantially overstated** by in-sample backtests.
- Remaining benefit: lower drawdown and volatility; Sharpe gains are modest.

### 3. Momentum crashes

**Daniel & Moskowitz (2016), "Momentum Crashes," *JFE* 122(2):221–247.** NBER w20439: https://www.nber.org/papers/w20439 (PDF read) [P].
- **Sample:** 1927:01–2013:03. WML Sharpe 0.71 vs market 0.40. WML monthly skew −4.70.
- **Worst WML months [P]:**

| Month | WML | Contemporaneous market | Prior 2-year market |
|---|---|---|---|
| Aug 1932 | −74.36% | +36.49% | −67.77% |
| Jul 1932 | −60.98% | | |
| Apr 2009 | −45.52% | +10.20% | −40.62% |
| Mar 2009 | −42.28% | | |
| Aug 2009 | −30.54% | | |

- **Crash conditions:** crashes happen in "panic states." These follow market declines (bear indicator: cumulative market return over the **past 24 months < 0**) with high volatility, at the moment the market **rebounds**.
- **Mechanism:** past losers carry high conditional beta, which behaves like a call option.
- **After the 2009 bottom:** from 8 Mar 2009 to 28 Mar 2013 losers earned more than twice the profit of winners.
- **Dynamic weighting:** weighting on forecast mean and variance roughly doubles Sharpe. Across markets and asset classes, dynamic momentum reaches Sharpe 1.18.
- **Robustness:**
  - The international and asset-class extension serves as an OOS test.
  - The weights use full-sample regression coefficients, so the headline number is partly IS.
- **Relevance:** a growth sleeve selected on accelerating revenue and price strength behaves like a winner portfolio. It is most at risk of lagging just after a bear-market bottom, when low-quality, high-beta "losers" rip.

**Barroso & Santa-Clara (2015), "Momentum has its moments," *JFE* 116(1):111–120.** DOI 10.1016/j.jfineco.2014.11.010; https://novaresearch.unl.pt/en/publications/momentum-has-its-moments/ [A].
- **Method:** scale WML by trailing 6-month realized volatility.
- **Result:** it "virtually eliminates crashes and nearly doubles the Sharpe ratio."
- **Specific numbers [S]:**
  - Sharpe rises from 0.53 to 0.97.
  - Excess kurtosis falls from 18.24 to 2.68.
  - Worst month improves from −78.96% to −28.40%.

### 4. Factor timing, quality and defensive factors

**Asness, Chandra, Ilmanen & Israel (2017), "Contrarian Factor Timing is Deceptively Difficult," *JPM* 43(5):72–87.** DOI 10.3905/jpm.2017.43.5.072; https://www.ssrn.com/abstract=2928945 [A].
- Value-spread timing of value, momentum and defensive factors mostly adds intermittent, sub-optimal **extra value exposure**.
- It reduces diversification and **detracts from multi-style portfolios**.
- **Lesson:** do not shift growth/core on valuation spreads.

**Haddad, Kozak & Santosh (2020), "Factor Timing," *RFS* 33(5):1980–2018.** NBER w26708: https://www.nber.org/papers/w26708 [A/S].
- **Method:** book-to-market predicts the top principal components of 50 anomaly portfolios.
- **Result:** OOS monthly R² is about 4% [S], and timing substantially improves on static factor investing.
- **Robustness:** it works for **market-neutral long/short PCs**, with heavy shrinkage. It is not directly transferable to a two-sleeve long-only tilt.

**Asness, Frazzini & Pedersen (2019), "Quality minus junk," *Review of Accounting Studies* 24(1):34–112.** DOI 10.1007/s11142-018-9470-2; https://research.cbs.dk/en/publications/quality-minus-junk-2/. Working-paper PDF read [P].
- **Sample:** US 1956–2012; 24 countries 1986–2012.
- **Behaviour in downturns [P]:**
  - QMJ has **negative market beta**, and its returns "are high during market downturns."
  - "Rather than exhibiting crash risk, if anything QMJ exhibits a mild positive convexity … it benefits from flight to quality."
  - The convexity is driven mostly by **profitability**; its quadratic t-stat is 2.0.
  - The pattern is robust to down quarters and down years.
- **Relevance:** a high-ROIC core sleeve should beat a junkier, high-beta growth sleeve in drawdowns. This is the economic case for the core as ballast.

**Frazzini & Pedersen (2014), "Betting Against Beta," *JFE* 111(1).** NBER w16601: https://www.nber.org/papers/w16601 [A].
- BAB earns significant risk-adjusted returns in US equities, 20 international markets, Treasuries, credit and futures.
- **Regime behaviour:** "when funding constraints tighten, betas are compressed towards one, and the return of the BAB factor is low."
- **Lesson:** defensive (low-beta) tilts can **underperform in the acute liquidity phase** of a crisis, even though they help over the full drawdown.

**Ilmanen, Israel, Lee, Moskowitz & Thapar (2021), "How Do Factor Premia Vary Over Time? A Century of Evidence," *JOIM*.** https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3400998 [A].
- Covers value, momentum, carry and defensive across six asset classes over about 100 years.
- Time variation in premia is **largely unrelated to macro risk** (recession and the like), which makes macro-based factor timing hard.

### 5. Regime detection (HMM, jump models, ML)

**Kritzman, Page & Turkington (2012), "Regime Shifts: Implications for Dynamic Strategies," *FAJ* 68(3):22–39.** https://ideas.repec.org/a/taf/ufajxx/v68y2012i3p22-39.html [A].
- Two-state Markov-switching models are fitted to the *drivers*: turbulence, inflation and growth, not to returns.
- **OOS-tested** dynamic risk-premium scaling and stock/bond/cash allocation beat static mixes, especially for loss-averse investors.
- An erratum was issued in Sept 2012.

**Nystrup, Hansen, Madsen & Lindström (2015), "Regime-Based Versus Static Asset Allocation: Letting the Data Speak," *JPM* 42(1):103–109.** https://jpm.pm-research.com/content/42/1/103.abstract [A].
- Even **without forecasting skill**, a regime-switching model with time-varying parameters makes a static stock/bond portfolio sub-optimal.

**Nystrup, Lindström & Madsen (2020), "Learning hidden Markov models with persistent states by penalizing jumps," *Expert Systems with Applications* 150:113307.** DOI 10.1016/j.eswa.2020.113307 [A].
- Maximum-likelihood HMMs switch unrealistically fast.
- Clustering temporal features with a **jump penalty** yields persistent states.

**Shu, Yu & Mulvey (2024), "Downside Risk Reduction Using Regime-Switching Signals: A Statistical Jump Model Approach."** arXiv:2402.05272; *Journal of Asset Management*, DOI 10.1057/s41260-024-00376-x. PDF read [P].
- **Test design:** fully online, OOS 1990–2023. 10 bp one-way costs, 1-day trading delay. Features come only from returns. The jump penalty is tuned by rolling time-series cross-validation.
- **0/1 strategy results [P]:**

| Index | Metric | Buy-and-hold | HMM | Jump model |
|---|---|---|---|---|
| S&P 500 | Return | 10.2% | 8.5% | **11.2%** |
| S&P 500 | Volatility | 18.2% | 11.3% | 13.1% |
| S&P 500 | Sharpe | 0.48 | 0.54 | **0.68** |
| S&P 500 | Maximum drawdown | −55.2% | −28.9% | **−26.6%** |
| S&P 500 | Turnover/yr | 0% | 141% | 44% |
| DAX | Sharpe | 0.30 | 0.35 | 0.44 |
| DAX | Maximum drawdown | −72.7% | −40.5% | −39.4% |
| Nikkei 225 | Sharpe | 0.12 | 0.19 | 0.31 |
| Nikkei 225 | Maximum drawdown | −79.1% | −48.6% | −45.3% |

- **Regime shifts per year (1982–2023) [P]:**
  - Unsmoothed HMM: 8.5.
  - Jump model: 2.7 to 0.4, depending on the penalty λ.
- **Delay robustness [P]:** with a 10-day delay, the jump model keeps Sharpe 0.70 on the S&P. HMM performance decays faster, especially on DAX and Nikkei.
- **Robustness:**
  - This is the best look-ahead-free, net-of-cost regime evidence I found.
  - Limits: a single author group; a 0/1 equity-or-cash switch; hyperparameters chosen by CV on the strategy's own Sharpe.

**Shu, Yu & Mulvey (2024), "Dynamic Asset Allocation with Asset-Specific Regime Forecasts,"** arXiv:2406.09578 [A].
- Jump-model regime labels plus gradient-boosted-tree forecasts, applied to 12 assets over 1991–2023.
- Beats minimum-variance, mean-variance and equal-weight.

**Shu & Mulvey (2024), "Dynamic Factor Allocation Leveraging Regime-Switching Signals,"** arXiv:2410.14841 [A].
- **Setup:** sparse jump models per factor (value, size, momentum, **quality**, **low volatility**, growth) on long-only indices, feeding Black–Litterman.
- **Result:** information ratio vs the market rises from about 0.05 to about 0.4; Sharpe improves and maximum drawdown falls.
- **Relevance:** the closest academic analogue to a long-only growth-vs-quality tilt. It is a single study.

**Other arXiv regime/ML papers checked (low evidentiary weight):**
- **arXiv:2603.04441** (Boukardagha 2026): Wasserstein HMM; Sharpe 2.18 and maximum drawdown −5.4% over a short recent window. Single author, short sample, self-reported.
- **arXiv:2107.05535** (Werge 2021): sticky-feature HMM.
- **arXiv:2108.05801** (Akioyamen et al. 2021): PCA plus k-means regimes from macro data.
- **Common weakness:** short samples, no independent replication, frequent hyperparameter search. They do **not** show that ML beats simple trend or volatility rules net of costs.
- **Consistent finding across them:** persistence and turnover control matter more than classifier sophistication.

### 6. Macro and credit signals

**Gilchrist & Zakrajšek (2012), "Credit Spreads and Business Cycle Fluctuations," *AER* 102(4):1692–1720.** https://www.aeaweb.org/articles?id=10.1257%2Faer.102.4.1692; NBER w17021 [A].
- The **excess bond premium (EBP)** is the part of corporate spreads not explained by default risk.
- It carries essentially all the predictive content of credit spreads for activity.
- EBP shocks orthogonal to the current economy cause significant declines in activity **and equity prices**.
- **Lead time:** a predictor of activity over the next several quarters. It is not a calibrated equity-drawdown timer.
- The Fed publishes the EBP monthly (with a lag). High-yield OAS from FRED is the practical daily proxy; HY OAS is my substitution, not GZ's measure.

**Estrella & Mishkin (1996), "The Yield Curve as a Predictor of U.S. Recessions," FRBNY *Current Issues* 2(7).** https://www.newyorkfed.org/medialibrary/media/research/current_issues/ci2-7.pdf (PDF read) [P].
- The 10y–3m spread predicts recessions **2–6 quarters ahead**. The headline model forecasts 4 quarters out.
- **Implication:** the lead is long and variable, so an inversion is a poor month-level trigger for equity de-risking.

**Resnick & Shoesmith (2002), "Using the Yield Curve to Time the Stock Market," *FAJ* 58(3):82–90.** DOI 10.2469/faj.v58.n3.2540 [A].
- A probit on the 10y+ minus 3m spread forecasts **bear markets**.
- The timing strategy beat buy-and-hold on mean excess return with lower total and systematic risk.

**Chen (2009), "Predicting recessions and bear markets," *Journal of Banking & Finance* (via secondary summaries) [S].**
- The term spread and inflation are the most useful bear-market predictors, both IS and OOS.
- Sample: 1957–2007.

**Nyberg (2013), "Predicting bear and bull stock markets with dynamic binary time series models," *JBF* 37(9):3351–3363.** https://ideas.repec.org/a/eee/jbfina/v37y2013i9p3351-3363.html [A].
- Dynamic probits with the yield spread and other macro variables predict S&P bull and bear states over 1957–2010.

**Zaremba, Szyszka, Karathanasopoulos & Mikutowski (2021), "Herding for profits: Market breadth and the cross-section of global equity returns," *Economic Modelling* 97:348–364.** https://ideas.repec.org/a/eee/ecmode/v97y2021icp348-364.html [A].
- Breadth (rising minus falling stocks) predicts **cross-country and industry** returns across 64 markets, 1973–2018.
- The effect is robust to trend-following signals.
- It is weak support for using breadth as a **US drawdown timer**; I found no strong peer-reviewed OOS evidence for that use.

**Section 6 summary.**
- Credit spreads have the best economic grounding and a lead of months to quarters.
- The yield curve has a 2–6 quarter recession lead, which is too long and variable to trade monthly. It has also given notable false or very early signals; 2022–24 is a widely noted example.
- Breadth is cross-sectional evidence only.
- Use macro signals as **confirmation**, not as primary triggers.

---

## (b) Ranked candidate conditional rules

| Rank | Rule | Signal and threshold logic | Expected drawdown benefit | Cost and whipsaw drag | Evidence strength |
|---|---|---|---|---|---|
| 1 | **Trend filter on the broad market** (Faber/TSMOM) | De-risk if S&P 500 TR < 10-month SMA **and/or** 12-month excess return < 0, at month-end | Large in slow bears (1929–32, 2000–02, 2008). Faber cut equity maximum drawdown from −84% to −50%; with T-bills it roughly halves drawdown. Little help in fast crashes (1987-type, Feb–Mar 2020) | About 0.6–0.7 round trips/yr. Underperforms in about 40% of years; many small whipsaw losses (about −4% each). Lag of 1–3 months after the top | **Strong.** A century of data across many assets. OOS Sharpe gains are smaller than in-sample (Zakamulin; Huang et al.); the drawdown reduction is the robust part |
| 2 | **Conditional (extreme-quintile) volatility scaling** of equity beta | Last month's realized volatility (or downside volatility) in the top quintile of its expanding history means de-risk; bottom quintile means mild re-risk; otherwise neutral | Moderate. It reacts faster than trend in volatility spikes and cuts tails | Low, because it acts only in extremes. Risk: it de-risks *after* the spike and can miss V-shaped rebounds | **Moderate.** Market-level survives costs (Barroso & Detzel); conditional form is robust internationally (Bongaerts et al.); continuous or factor-level versions fail OOS (Cederburg et al.; Liu et al.) |
| 3 | **Persistence-penalized regime model** (statistical jump model) on market returns and volatility features | Bear state when the online jump model says so; λ tuned by rolling CV | Large. OOS S&P maximum drawdown −55% → −27%, Sharpe 0.48 → 0.68, net of 10 bp costs | About 44%/yr turnover on the S&P; robust to 1–10 day delays | **Moderate-low.** Rigorous OOS design but one research group; complexity and tuning risk |
| 4 | **Momentum-crash / rebound guard** (Daniel & Moskowitz) | If the 24-month market return < 0 **and** volatility is high, do **not** overweight recent winners or high-momentum growth on re-entry; re-risk through broad or refreshed exposure | Avoids the "winners lag the rip" episodes (1932, 2009) | Rarely active; little cost | **Strong as a guard** (1927–2013 plus international); weaker as a standalone timing rule |
| 5 | **Credit-stress confirmation** (HY OAS / EBP) | 3-month change in HY OAS above about +1.0–1.5 pp, or OAS above its trailing 80th percentile, adds a defensive vote | Months-ahead warning in credit-led bears (2000–02, 2007–09); weaker in rate- or valuation-led bears | Low turnover, but false alarms (e.g. energy-led spread spikes) | **Moderate for economics, weak as a tested trading rule.** My thresholds are judgment calls, not taken from a paper |
| 6 | **Yield-curve inversion** | 10y–3m < 0 means a defensive tilt | Lead of 2–6 quarters; often too early | Can sit defensive through strong late-cycle rallies | **Weak-moderate** for equity timing |
| 7 | Plain Gaussian HMM | Bear-state probability > 0.5 | Similar drawdown cut to the jump model | Turnover 141–290%/yr; delay-sensitive | **Weak.** Dominated by the jump model and by simple rules |
| 8 | Valuation or contrarian factor timing (value spreads) | Tilt toward the cheaper sleeve | None reliable | Reduces diversification | **Weak/negative** (Asness et al. 2017) |
| 9 | ML classifiers (arXiv) | Various | Self-reported large gains | Unknown | **Very weak.** Short samples, not replicated |
| 10 | Market breadth | % of stocks above their 200-day moving average, advance/decline line | Unproven for US drawdowns | — | **Weak** (cross-sectional evidence only) |

---

## (c) Recommended rule: "Trend-led, volatility-and-credit-confirmed, hysteretic three-state split"

### Why this design
- **Trend** is the input with the longest and broadest evidence of drawdown reduction. Its main flaw is lag, and it misses fast crashes.
- **Extreme-quintile volatility** is the only volatility rule that survives OOS and costs at the market level. It covers part of the fast-crash gap.
- **Credit** adds an economically grounded early-warning vote.
- Requiring **agreement** for the strongest moves, plus asymmetric confirmation, targets whipsaw.
- The guard from Daniel & Moskowitz addresses the one known risk specific to a momentum- or growth-like sleeve.
- I deliberately keep HMM and ML out of the live rule. If the owner wants a model, a statistical jump model can be run **in parallel as a shadow check** for 12–24 months before being given a vote.

### Inputs (all measured at the last trading day of the month, using only data available then)

1. **Trend, T ∈ {+1, 0, −1}.**
   - Let A = S&P 500 total return index vs its 10-month SMA of month-end values.
   - Let B = the 12-month S&P 500 return minus T-bills.
   - T = +1 if A is above the SMA by **more than +2%** and B > 0.
   - T = −1 if A is below the SMA by **more than −2%** and B < 0.
   - Otherwise T = 0.
   - The ±2% band is a whipsaw buffer. It is a judgment parameter; test 1–3%.
   - Optionally compute the same on the Russell 2000 or S&P 400 for the growth sleeve's own trend, and use the *worse* of the two.
2. **Volatility, V ∈ {+1, 0, −1}.**
   - Measure annualized realized volatility of daily S&P 500 returns over the last 21 trading days. Downside semivolatility is a reasonable alternative (Wang & Yan).
   - Rank it against the **expanding** history of monthly values (start from at least 20 years of data, e.g. 1990+).
   - Top quintile gives V = −1, bottom quintile V = +1, otherwise V = 0 (Bongaerts et al.).
3. **Credit, C ∈ {0, −1}.**
   - Use the ICE BofA US High Yield OAS, available daily on FRED as BAMLH0A0HYM2.
   - C = −1 if OAS has widened by **≥ 1.25 pp over the last 3 months** or sits above its trailing 5-year 80th percentile. Otherwise C = 0.
   - Thresholds are judgment calls; calibrate on 1997+ data, holding out 2015–2025.
4. **Bear-rebound flag, R.**
   - R = 1 if the trailing 24-month S&P 500 return < 0 (Daniel & Moskowitz bear indicator).

### States and bands

The bands assume the owner's neutral is about 50/50; scale proportionally if the strategic split differs.

| State | Growth / Core | Optional T-bills | Entry condition |
|---|---|---|---|
| **Risk-on** | 65 / 35 | 0% | T = +1 **and** V = +1 **and** C = 0 **and** R = 0 |
| **Base** | 50 / 50 | 0% | Default |
| **Defensive** | 25 / 75 | 0–20% (recommended 15%, taken pro rata) | T = −1, **or** at least 2 of {T ≤ 0, V = −1, C = −1} |

Why these widths:
- **Defensive band:** a 25 pp shift is enough to matter, roughly −0.1 beta under the β assumptions above. It still keeps the growth sleeve alive, which avoids sell-everything tax events and keeps the selection pipeline's alpha in play.
- **Risk-on band:** kept narrower (+15 pp) because the evidence for *adding* risk in calm, uptrending markets is weaker than the evidence for cutting it in stress. Bongaerts' bottom-quintile up-scaling is the support.
- **T-bill leg:** the 15% T-bills in Defensive are the part that actually halves drawdowns in the literature. Without it, the expected maximum-drawdown improvement versus static 50/50 is in the low single digits of percentage points.

### Hysteresis and confirmation

- **Entering Defensive:** act on the *first* qualifying month-end. Drawdown protection is the goal, and Hurst et al.'s ~15-month average bear length means a one-month confirmation costs little.
- **Leaving Defensive:** require **two consecutive** month-ends without the Defensive condition, plus T ≥ 0. Then step to **Base**, never straight to Risk-on.
- **Entering Risk-on:** require the Risk-on condition on **two consecutive** month-ends, and at least 3 months since leaving Defensive.
- **Rebound guard (R = 1 at exit from Defensive):**
  - Move from Defensive to Base in **two equal monthly steps**.
  - **Re-run the growth-sleeve screen** at re-entry rather than restoring the pre-bear winners.
  - Block Risk-on until R = 0.
  - This targets the 1932- and 2009-type episodes in which beaten-down high-beta names led and prior winners lagged.
- **Partial adjustment and no-trade zone:**
  - Move at most 15 pp per month toward a target.
  - Skip trades smaller than 5 pp in sleeve weight.
  - These are judgment parameters that cut turnover.

### Rebalance cadence

- **Signals:** evaluate monthly, at month-end, and execute on the next trading day. Shu et al. show that 1–10 day delays cost little for persistent signals.
- **Emergency rule:** no intra-month trading on regime signals. The evidence that daily signals beat monthly ones net of costs is weak, and intra-month moves magnify whipsaw.
- **Contributions:** route new contributions and dividends toward the target first, to reduce taxable sales.

### Expected behaviour (from the literature, not a backtest of this exact rule)

- **Time in each state:** Defensive about 15–25% of months, Risk-on about 20–30%, Base the rest. This is extrapolated from Faber's ~30% time out and Bongaerts' quintile design.
- **Switches:** about 1–2 state changes per year.
- **Turnover:** sleeve-shift turnover of roughly 25–60% of one sleeve per year. Costs are negligible at Schwab's $0 commissions; **taxes are the main drag** in a taxable account.
- **Drawdowns:** meaningful reduction only in slow, credit-led bears. In V-shaped crashes, expect little benefit and possible underperformance on the rebound.

### Why it beats the alternatives

- **Static split:** no drawdown adaptation. The evidence (Nystrup et al. 2015; Kritzman et al. 2012) favours regime-aware allocation even with modest skill.
- **Continuous volatility targeting:** fails OOS and can overshoot and raise drawdowns (Cederburg et al.; Liu et al.; Bongaerts et al.).
- **HMM or ML regime models:** higher turnover, delay sensitivity, overfitting risk, and no replicated OOS advantage over simple rules for a single equity-beta decision. The jump model is the exception worth monitoring.
- **Valuation-based tilting:** documented to detract (Asness et al.).
- **Macro-only rules:** leads of 2–6 quarters are too long and too variable.

### Validation before going live (instructions for the pipeline owner; no code written here)

- Backtest with **expanding-window** quintiles and percentiles only.
- Hold out 2015–2025 entirely.
- Report each metric gross and net, after taxes if the account is taxable:
  - maximum drawdown;
  - Calmar ratio;
  - time spent in each state;
  - number of whipsaws, defined as a reversal within 3 months.
- Compare against:
  - static 50/50;
  - trend-only;
  - volatility-only;
  - the recommended composite.
- Adopt the composite only if it beats trend-only on Calmar in the holdout.

---

## (d) Main failure modes

1. **Fast V-shaped crashes** (Oct 1987, Feb–Mar 2020). Trend triggers after most of the fall, and the volatility quintile triggers at the bottom. The rule then sits defensive through the rebound. Mitigations: the two-step exit and the 2-month confirmation limit, but do not eliminate, the give-up.
2. **Sideways, choppy markets** (2011, 2015–16, Q4 2018-type episodes). Repeated small whipsaws account for the "underperforms in about 40% of years" seen in Faber. The ±2% band, partial adjustment and confirmations reduce this but cannot remove it.
3. **Momentum / junk-rally crash on the rebound** (Daniel & Moskowitz). After a bear, low-quality, high-beta losers lead. Both a winner-tilted growth sleeve and a quality core can lag the index, the core because QMJ is short junk. The rebound guard re-screens the growth sleeve; accept some tracking error.
4. **The core sleeve is not actually defensive.** $50B+ large caps today include high-beta, long-duration mega-cap tech. In a rate-driven bear (2022-type) both sleeves fall together and switching does little. Mitigations: enforce a beta and quality screen on the core (high ROIC, low leverage; QMJ says profitability and safety drive the crash protection), and keep the T-bill leg available.
5. **Liquidity-crunch phase.** BAB and defensive tilts can underperform when funding tightens (Frazzini & Pedersen), and quality can briefly fall with everything else.
6. **Look-ahead and overfitting.**
   - Full-sample scaling constants (Liu et al.), tuned thresholds and regime-model hyperparameters all inflate backtests.
   - Keep the parameter count small (about 6), use round thresholds, use expanding windows, and keep a strict holdout.
7. **Macro signal breakdown.** The yield curve inverted for a long stretch in 2022–24 without an immediate NBER recession. Credit spreads can be suppressed by central-bank backstops. That is why macro gets only a confirming vote.
8. **Taxes and implementation.** In a taxable Schwab account, each defensive shift can realize short-term gains in the growth sleeve. Use contributions and dividends, tax-lot selection, and the no-trade band, or run the overlay in a tax-advantaged account if available.
9. **Regime of the evidence itself.** Most trend and volatility evidence covers indices and futures. The growth sleeve is a concentrated small/mid-cap stock portfolio with idiosyncratic risk the market signals do not see. Stock-level stop rules are a separate question.
10. **Behavioural override.** The rule will feel wrong at turning points: defensive at the bottom, risk-on near tops. Pre-commit to it in writing.

---

## Source list (all verified by fetching a landing page, abstract or PDF)

- Moreira & Muir 2017 — https://www.nber.org/papers/w22208
- Cederburg et al. 2020 — DOI 10.1016/j.jfineco.2020.04.015 (https://econpapers.repec.org/RePEc:eee:jfinec:v:138:y:2020:i:1:p:95-117)
- Liu, Tang & Zhou 2019 — DOI 10.3905/jpm.2019.1.107 (https://www.ssrn.com/abstract=3283395)
- Barroso & Detzel 2021 — https://econpapers.repec.org/article/eeejfinec/v_3a140_3ay_3a2021_3ai_3a3_3ap_3a744-767.htm
- Harvey et al. 2018 — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3175538
- Bongaerts, Kang & van Dijk 2020 — https://repub.eur.nl/pub/130215 (DOI 10.1080/0015198X.2020.1790853)
- Wang & Yan 2021 — DOI 10.1016/j.jbankfin.2021.106198
- DeMiguel, Martín-Utrera & Uppal 2024 — https://ideas.repec.org/a/bla/jfinan/v79y2024i6p3859-3891.html
- Faber 2007/2013 — https://www.trendfollowing.com/whitepaper/CMT-Simple.pdf
- Moskowitz, Ooi & Pedersen 2012 — https://research.cbs.dk/en/publications/time-series-momentum/
- Hurst, Ooi & Pedersen 2017 — https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing
- Huang, Li, Wang & Zhou 2020 — https://ideas.repec.org/a/eee/jfinec/v135y2020i3p774-794.html
- Zakamulin — https://doi.org/10.2139/ssrn.2242795
- Daniel & Moskowitz 2016 — https://www.nber.org/papers/w20439
- Barroso & Santa-Clara 2015 — DOI 10.1016/j.jfineco.2014.11.010
- Asness, Chandra, Ilmanen & Israel 2017 — DOI 10.3905/jpm.2017.43.5.072
- Haddad, Kozak & Santosh 2020 — https://www.nber.org/papers/w26708
- Asness, Frazzini & Pedersen 2019 — DOI 10.1007/s11142-018-9470-2
- Frazzini & Pedersen 2014 — https://www.nber.org/papers/w16601
- Ilmanen et al. 2021 — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3400998
- Kritzman, Page & Turkington 2012 — https://ideas.repec.org/a/taf/ufajxx/v68y2012i3p22-39.html
- Nystrup et al. 2015 — https://jpm.pm-research.com/content/42/1/103.abstract
- Nystrup, Lindström & Madsen 2020 — DOI 10.1016/j.eswa.2020.113307
- Shu, Yu & Mulvey 2024 — arXiv:2402.05272
- Shu, Yu & Mulvey 2024 — arXiv:2406.09578
- Shu & Mulvey 2024 — arXiv:2410.14841
- Boukardagha 2026 — arXiv:2603.04441
- Werge 2021 — arXiv:2107.05535
- Akioyamen et al. 2021 — arXiv:2108.05801
- Gilchrist & Zakrajšek 2012 — https://www.aeaweb.org/articles?id=10.1257%2Faer.102.4.1692
- Estrella & Mishkin 1996 — https://www.newyorkfed.org/medialibrary/media/research/current_issues/ci2-7.pdf
- Resnick & Shoesmith 2002 — DOI 10.2469/faj.v58.n3.2540
- Nyberg 2013 — https://ideas.repec.org/a/eee/jbfina/v37y2013i9p3351-3363.html
- Zaremba et al. 2021 — https://ideas.repec.org/a/eee/ecmode/v97y2021icp348-364.html
- Chen 2009 — existence via secondary summaries only [S]; verify before citing externally.
