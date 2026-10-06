# Audit: would LightGBM improve the system? (2026-10-03)

**Question (owner).** Audit whether adding LightGBM would improve the system.

**Answer.** **No. Do not add it.** No code change, and no Python dependency.
- **What it needs.** LightGBM is a supervised learner, so it needs a large set of labelled outcomes. The desk
  produces outcomes slowly, and none have arrived yet.
- **Where it could go.** Seven components could take a model. Two have enough data to test: the pre-synthesis
  screen and a market-wide quant composite. LightGBM lost or tied in both.
- **Desk outcomes.**
  - The desk's own predictions (μ, R, κ, the label bands) have **zero** realized outcomes. The calibration log
    shows 0 of 100 points at d21, because the first report is dated 2026-09-11.
  - Even a one-parameter linear check of μ needs about four years of quarterly cohorts to reach t = 2.
- **The screen.** On the 94 published reports, LightGBM beats Street upside alone by **+0.03 AUC under nested CV**,
  winning 60% of folds. That is noise at n = 94. A 4-feature logistic regression puts the same number of BUYs in
  the first 40 reports written, and the screen only orders the queue; it never skips.
- **The quant composite.** The test used 100,594 point-in-time US stock-dates, 2014–2026 out of sample, 49 dates
  and about 1,300 names ≥ $1B per date.
  - LightGBM **ties a linear model on the same features** (rank IC +0.003, t 0.2).
  - Both fitted models **lose to the fixed equal-weight composite** the system audit already uses: −0.015 IC and
    −1.2pp a year on the top 30%.
  - LightGBM won 2014–19, then lost 4pp a year to the fixed composite in 2020–26.
  - Its scores churn more: rank autocorrelation between rebalances is 0.68–0.76, against 0.86.
- **The literature agrees.** In large caps, net of costs, trees add little or nothing over linear models (§4).

## 1. Where LightGBM could plug in

LightGBM learns f(features) → label from many examples. Each candidate component is listed with the label it would
learn and how many labels exist.

| Component | What a model would learn | Labels today | Verdict |
|---|---|---|---|
| **The desk's μ → realized return.** This would drive calibration, the μ·κ·R score, the κ penalty weights and the label bands. | d63/d126 excess return per report | **0.** The earliest report is 2026-09-11, so the first d126 outcomes arrive about March 2027. | 🚫 Blocked on data. Fit the system audit's single slope b first. |
| **Pre-synthesis screen** (`lib/screen/screen.ts`) | Whether the desk publishes BUY or HOLD | 94 reports | 🚫 Tested (§2). +0.03 AUC, not significant. It only orders the queue. |
| **Quant composite.** It feeds Q (±10% of score through the composite percentile), the bottom-30% veto the system audit proposed (to be logged, not traded), and the forward-test log. | Cross-sectional forward returns | About 100k market stock-dates | 🚫 Tested (§3). Loses to fixed equal weights. |
| **Bear-breach bands** (0.5 / 0.9, `lib/trade/breach.ts`) | 6-month return after a breach | 7,237 events in the event study (not in the repo) | 🚫 Not tested. A three-bucket sign rule on one input is valued for being robust. `engine.md` §4.2 already defers re-fitting the bands to the desk's own breaches. |
| **Regime / sleeve overlay** | Market state | n/a | 🚫 Already rejected. ML regime models were reviewed in `2026-10-03-sleeve-research/A-regime-overlays.md`. |
| **Execution** (IOC fill odds, limit τ) | Fill or no fill | 73 fills in the first 11 sessions | 🚫 Too few fills. A non-fill is the slippage cap working as intended. |
| **Grounding, lint, editorial gate, Shibui cross-check** | A violation | A handful of incidents (FOUR, BAM) | 🚫 These are exact rules, not predictions. A classifier would swap a hard guarantee for a recall rate. |

**How long until the desk has enough labels.** With about 100 names in a cohort, one cross-section's rank IC has a
standard error of about 1/√99 ≈ 0.10.
- Detecting an IC of 0.05 at t = 2 takes (2 × 0.10 / 0.05)² ≈ 16 independent quarterly cohorts, about four years.
  That holds even for a one-parameter linear test.
- A tree ensemble has many more effective parameters, so it needs far more.
- So the plan in `2026-10-03-system-audit-rr-gate.md` (fit b at d63/d126, then test whether D predicts the errors)
  is the right estimator for the data the desk will have.

## 2. Test A — the screen, on the desk's own reports

**Setup.**
- **Sample and label:** the 94 published reports: BUY-side (50) or HOLD (44).
- **Features:** 16, all available before synthesis.
  - Street upside at the report date.
  - Street upside in today's Shibui snapshot.
  - Analyst count, buy share and target dispersion.
  - Forward P/E, forward PEG, FCF yield, earnings-quality flags and market cap.
  - Position in the 52-week range.
  - Piotroski, distress, moat, the reverse-DCF margin of safety and the composite percentile.
- **Validation:** 5-fold stratified CV repeated 40 times. Nested CV picks the LightGBM configuration inside each fold.
- **Script:** `2026-10-03-lightgbm-audit/screen_test.py`, with `screen_nested.py`.

| Model | CV AUC | BUYs in the first 20 / 40 written |
|---|---|---|
| Street upside at the report date, no fit | 0.789 | 13.1 / 30.0 |
| Logistic: Street + 52-week position + buy share + Piotroski | 0.808 | 15.2 / 31.8 |
| Logistic (L2): all 16 | 0.807 | — |
| LightGBM: all 16, best of 4 configurations | 0.828 | 17.0 / 31.9 |
| **LightGBM: all 16, nested CV (honest)** | **0.819** (Street in the same folds 0.786; wins 60% of folds) | — |
| *Random order / perfect* | *0.5 / 1.0* | *10.6 / 21.3 · 20 / 40* |

- **What it amounts to.** The honest gain is +0.03 AUC with a fold standard deviation of about 0.1.
- **Trees vs features.** The 4-feature logistic matches LightGBM's top 40. So the trees add nothing a linear model
  doesn't.
- **What it would buy.** About two BUYs written earlier among the first 40, in a queue that never skips a filing.
- **It fails the screen's own bar.** `screen.ts` did not adopt Piotroski, which moved AUC 0.821 → 0.824, for the same
  reason.

## 3. Test B — a market-wide quant composite, point-in-time

This is the one place with enough data to train a tree model. It answers a concrete question. The system audit
recommended logging a quant composite next to every report and keeping a bottom-30% veto under review. **Should that
composite be a LightGBM model instead of fixed equal-weight ranks?**

**Data.** Built by `2026-10-03-lightgbm-audit/fetch_frames.py`, `fetch_prices.py`, `build_panel.py` and
`add_paths.py`.
- **Universe:** 4,371 current NYSE/Nasdaq SEC filers with at least 3 years of XBRL net income.
- **Prices:** Yahoo daily split- and dividend-adjusted closes.
- **Fundamentals:** SEC XBRL `frames`, annual flows and year-end balance sheets.
  - Each value becomes usable **120 days after its period end**.
  - Market cap is filed shares × price. Where that disagrees with the public float, it comes from the float.
- **Panel:**
  - Rebalance at the first session of Feb/May/Aug/Nov, 2010–2026.
  - Filters: price ≥ $3, market cap ≥ $300M and dollar volume ≥ $1M a day.
  - Size: 100,594 stock-dates and 65 dates. Out-of-sample tests start in 2014, so 49 test dates with about 1,300
    names ≥ $1B on each.
- **Features:** 20 standard characteristics, ranked within each date:
  - value: E/P, B/M, S/P, FCF/P;
  - quality: GP/A, ROE, operating margin, accruals;
  - investment and growth: asset growth, sales growth;
  - balance sheet: leverage, current ratio;
  - price: 12-1 and 6-1 momentum, 1-month reversal, 52-week-high ratio;
  - risk: 252-day volatility and β;
  - size: log market cap, log dollar volume.
- **Target:** the 126-session forward total return, ranked within each date. A robustness run uses 63 sessions.

**Models.** All are retrained every January on dates whose forward window closed at least 190 days earlier (an
embargo against overlap). Script: `compare.py`.
- **EW4:** the system audit's composite. It is the mean percentile of E/P, ROE, GP/A and 12-1 momentum, with **no
  fitting**.
- **Ridge:** a linear model on all 20 ranks. **ridge4** uses only EW4's four inputs.
- **LightGBM:**
  - three capacities: 7, 31 and 63 leaves, with 300–600 trees;
  - one version early-stopped on the last 8 training dates;
  - **lgb4:** the 31-leaf model on EW4's four inputs only. This is the clean "trees vs linear on the same inputs"
    test.

**Measures** (`evaluate.py`):
- the rank IC on each date;
- the top and bottom 30% by score, as excess return over the slice's equal-weight mean, in pp a year;
- t-statistics with a Newey-West lag of 1, because the windows overlap;
- a **bust stress**, as in the config audit, for survivor-only prices. A name that falls ≥ 50% inside the window
  busts with probability 10% / 20% / 30% (≥ $10B / $2–10B / smaller) and returns −70%. The expected value is used.

**Results, ≥ $1B, 2014–2026** (`results-f126.txt`):

| Model | Rank IC | Top 30% (stressed) | Bottom 30% (stressed) | Score autocorrelation |
|---|---|---|---|---|
| **EW4, fixed** | **0.044 (t 2.8)** | **+1.00 (t 1.1)** | **−1.22 (t −1.0)** | **0.86** |
| ridge4 | 0.026 (t 1.4) | +0.62 | −0.22 | 0.85 |
| lgb4 | 0.026 (t 2.2) | +0.28 | +0.38 | 0.68 |
| Ridge, 20 features | 0.025 (t 1.3) | −1.15 | +0.90 | 0.83 |
| LightGBM, 31 leaves | 0.029 (t 1.9) | −0.17 | +0.53 | 0.76 |
| LightGBM, 7 leaves | 0.026 (t 1.5) | −0.41 | +1.10 | 0.81 |
| LightGBM, 63 leaves | 0.015 (t 1.3) | −0.52 | +1.03 | 0.66 |
| LightGBM, early-stopped | 0.022 (t 1.2) | −0.83 | +1.52 | 0.79 |

Paired, per date:

| Comparison | Rank IC | Top 30% (stressed), pp/yr |
|---|---|---|
| **lgb4 − ridge4** (trees vs linear, same 4 inputs) | +0.000 (t 0.0) | −0.34 (t −0.5) |
| **LightGBM − ridge** (same 20 inputs) | +0.003 (t 0.2) | +0.98 (t 0.9) |
| **LightGBM − EW4** | −0.015 (t −0.8) | −1.16 (t −1.0) |
| **lgb4 − EW4** | −0.018 (t −1.2) | −0.72 (t −0.8) |

**By era, ≥ $1B.** LightGBM is the 31-leaf model.

| Era | EW4 IC / top 30% | LightGBM IC / top 30% | LightGBM − EW4, top 30% |
|---|---|---|---|
| 2014–19 | 0.020 / +0.23 | 0.046 / +1.96 (t 2.1) | +1.73 (t 1.4) |
| 2020–26 | 0.066 / +1.73 | 0.012 / −2.21 | **−3.94 (t −2.6)** |

**Robustness.** The same picture holds in each of these runs:
- ≥ $300M and ≥ $10B slices;
- trained on ≥ $1B names only (`results-f126-train-1b.txt`);
- the 63-session horizon (`results-f63.txt`);
- raw, stressed, winsorized (1/99) and median returns.

No full-period run puts LightGBM significantly above ridge on IC: the best is +0.014, t 1.3. No full-period run puts it above
EW4.

**What it means for the system.**
- **No nonlinear structure to learn.** On EW4's own inputs, trees and a linear fit are identical out of sample
  (IC +0.000).
  - Early stopping kept only 1–77 trees (1–104 across all runs) on a time-ordered holdout.
  - Gain importance is flat across the 20 features (top: volatility at 8%).
  - The model finds no nonlinear structure stronger than noise.
- **Fitting is the problem, and trees make it worse.**
  - Both fitted models learned 2010s relations (low volatility and quality worked) that failed in 2020–26, while fixed
    equal weights held up.
  - This is the 1/N result applied to signals: estimation error outweighs the gain from optimized weights
    (DeMiguel, Garlappi & Uppal 2009).
  - **A backtest that stopped in 2019 would have recommended LightGBM** (+1.7pp a year over EW4). That is exactly how
    this decision goes wrong.
- **The veto would get worse.** LightGBM's bottom 30% beat the universe (+0.53pp stressed). A veto on it would cut
  names that did *better* than average. EW4's bottom 30% lagged by 1.22pp.
- **More churn.** Tree scores reshuffle more between rebalances (0.68–0.76 vs 0.86). That means more turnover against
  the 5-day whole-ticker lock, in a book that already turns over about 17× NAV a year.
- **The tilt wouldn't notice anyway.** The production tilt moves score by at most ±10% through the composite
  percentile, and the system audit found composite tilts worth ±0.1pp.

## 4. Literature

Checked on publisher, NBER, SSRN, arXiv or OpenAlex pages. Anything not confirmed is marked.

- **Gu, Kelly & Xiu (RFS 2020)**, figures from NBER w25398, not re-checked against the published tables:
  - **Prediction:** monthly out-of-sample R² was 0.16% for OLS-3 and 0.34% for gradient-boosted trees (GBRT).
    Among the top 1,000 stocks by size it was 0.31% vs 0.52%.
  - **Significance:** the Diebold-Mariano test of GBRT against OLS-3 is 1.28, not significant.
  - **Turnover:** 144% a month for GBRT against 58% for OLS-3.
  - **The value-weighted long leg:** GBRT earned 1.17%/month (Sharpe 0.69), below OLS-3's 1.34% (0.79).
- **Avramov, Cheng & Metzker (Management Science 2023):**
  - Dropping microcaps cuts ML's value-weighted alpha by 66%, to an insignificant 0.31%/month.
  - No signal survives once distressed firms are excluded.
  - Outside microcaps, break-even costs (0.26–0.54%) sit below realistic costs.
- **Leung, Lohre, Mischlich, Shea & Stroh (JFDS 2021)**, abstract only: boosting beats linear models statistically,
  but "economic gains tend to be more limited and critically dependent on the ability to take risk and implement
  trades efficiently."
- **Blitz, Hanauer, Hoogteijling & Howard (JFDS 2023):** ML on 1-month returns has net performance "close to zero"
  after 2004. **Cakici, Fieberg, Metko & Zaremba (JFDS 2023)** find no "substantial economic gains within most of the
  US market in the past two decades." Their large-cap alpha figures are [unverified] and are not used here.
- **Israel, Kelly & Moskowitz (JIM 2020):** return prediction "is a small data problem". How rich a model can be is
  limited by the number of return observations, and their correlation shrinks the effective count further.
- **Ke et al. (NIPS 2017), the LightGBM paper:** an engineering result (up to 20× faster at about the same accuracy).
  It has no finance evidence.
- **Analyst-forecast ML.**
  - van Binsbergen, Han & Lopez-Lira (RFS 2023) carry an **Expression of Concern** (RFS 2026).
  - Zhang, Zhu & Linnainmaa (RFS 2025) trace its alpha to look-ahead bias: "Linear models yield as accurate forecasts
    and superior trading profits."

**Literature's verdict.** In large caps, net of costs, gradient-boosted trees add little or nothing over linear
signals, and they trade more. The one finance setting where trees reliably help is small, illiquid stocks with
short horizons, which is outside this book's mandate.

## 5. What adding it would cost

- **No Node binding.** The repo is pure TypeScript and the trader is a headless Next.js process. LightGBM has no
  maintained first-party Node binding. The options are:
  - train in Python and walk the exported trees in TypeScript (about 100 lines plus parity tests);
  - add `onnxruntime-node` as a native dependency in the Docker image.
- **Every option adds ongoing work:**
  - a Python toolchain;
  - model files and their versions;
  - checks that features computed in Python training match the TypeScript inputs;
  - the Shibui print → save → `--apply` capture for every input, because the trader cannot query Shibui.
- **Not large, but not free.** Today it would buy a worse composite.

## 6. Limits of this audit

- **Survivor-only prices:** Yahoo, like Shibui, lacks delisted names. The bust stress does not change any ranking.
- **Restated values:** SEC `frames` carry the latest-filed value for a period, so restatements leak slightly into
  values, though not into timing. This is the same for every model.
- **Approximate market caps:** shares or public float.
- **One feature set:** 20 standard characteristics. The desk's own `composite.ts` (peer-relative value from Yahoo peer
  multiples) cannot be rebuilt historically, so EW4 stands in for it, as in the system audit.
- **Hyperparameters:** four tree configurations including early stopping, none tuned on test data. More tuning adds
  selection risk; the like-for-like lgb4 test is the clean read.
- **Not tested:** the breach bands, execution, and the editorial or grounding gates. The reasons are in §1.

## 7. What would change the verdict

1. **The calibration log matures.** That means at least about 16 quarterly cohorts at d126 (around 2030), with a
   significant linear b.
   - Then test whether residual errors have structure a linear calibration misses, for example μ × volatility or
     μ × D.
   - A monotone-constrained GBM would be the challenger to a linear model, never a replacement for it without a
     walk-forward win.
2. **The synthesis queue starts skipping filings,** so screen accuracy would cost reports. Re-run `screen_nested.py`
   once there are at least 300 reports.
3. **A market-wide quant sleeve is approved.** It isn't: the system audit rejected screens as a replacement. Re-run
   Test B against EW4 then.

## Recommendation

- **Do not add LightGBM.** No code change and no Python dependency.
- **Build the quant-composite log from fixed equal-weight ranks.** When the system audit's log is built, use EW4-style
  ranks rather than fitted weights. Out of sample, 2014–2026, fitted models lost to fixed weights, linear and trees
  alike.
- **Keep the measurement plan.** It is the only route to desk labels that any model could learn from: b at
  d63/d126, and whether D predicts μ's errors.

## Reproduce

Python 3.11 with `lightgbm scikit-learn pandas scipy pyarrow`. SEC needs `EDGAR_CONTACT` set.

```bash
# Test A: reads only committed data
python3 docs/superpowers/specs/2026-10-03-lightgbm-audit/screen_test.py
python3 docs/superpowers/specs/2026-10-03-lightgbm-audit/screen_nested.py
# Test B, from an empty work directory (downloads about 0.4 GB, roughly 6 minutes)
S=docs/superpowers/specs/2026-10-03-lightgbm-audit
mkdir -p work && cd work && curl -sA "juniresearch/0.1 ($EDGAR_CONTACT)" https://www.sec.gov/files/company_tickers_exchange.json -o tickers.json
python3 ../$S/fetch_frames.py && python3 ../$S/fetch_prices.py && python3 ../$S/build_panel.py && python3 ../$S/add_paths.py
python3 ../$S/compare.py 3e8 f126 && python3 ../$S/evaluate.py preds_3_f126.parquet f126
python3 ../$S/compare.py 1e9 f126 && python3 ../$S/evaluate.py preds_10_f126.parquet f126
python3 ../$S/compare.py 3e8 f63  && python3 ../$S/evaluate.py preds_3_f63.parquet f63
```
