# Research E: regime signals for a growth/core sleeve split

*Scratchpad research, 2026-10-03. Repository files were not changed. The scripts are in this folder: `common.py`, `event_study.py`, `backtest.py` and `diagnostics.py`. The raw downloads are the `y_*.csv`, `fred_*.csv` and `breadth_monthly.csv` files.*

## TL;DR

1. **Shifting 70/30 to 40/60 between two equity sleeves gives almost no drawdown protection.** I tested five signal families on four proxy pairs over 13 to 36 years. None of them moved max drawdown by more than about 1.5 pp versus a static 70/30 blend, and CAGR stayed within ±0.4 pp. In 2000–02, 2008 and 2020, small/mid growth and large caps fell together, so moving weight between them barely changes the loss. No signal predicts the growth-minus-core spread for the next month: the risk-off vs risk-on difference is under 0.2 %/mo, against a standard error of 0.2 to 0.7 %/mo.
2. **The signals do carry market-direction information.** Use them to change total equity exposure, not to tilt between the two equity sleeves. In one variant, risk-off moved 30 points of growth to T-bills instead of to core. With the SPX 10-month trend signal, max drawdown fell from -52 % to -40 % in both universes. CAGR was about the same (IWO/SPY 7.1 → 7.4 %; NAESX/VFINX 10.7 → 10.4 %) and Sharpe rose by 0.03 to 0.05.
3. **Recommended rule set:** use SPX vs its 10-month SMA as the main switch, confirmed by a 2-of-3 month-end vote of trend, 1-month realized vol above 20 % and a credit-spread jump. Return to risk-on once the trend recovers. Use VIX, breadth and credit spikes as **capitulation context, not exit triggers**: in the months after they fired, returns were *higher* than average. Do not use the yield curve, VIX term structure, IWM/SPY relative trend or continuous vol-scaling to time a monthly sleeve split. See the Recommendation section.
4. **There is a data gap on credit.** FRED now serves ICE BofA HY OAS (BAMLH0A0HYM2) **only from 2023-10-03**, because ICE licensing limits FRED to 3 years. Every historical credit test here uses Moody's Baa minus the 10-year Treasury (FRED BAA10Y, 1986+) as a stand-in.

## 1. Data availability

| Source / access | Series | Reachable? | History from | Notes |
|---|---|---|---|---|
| FRED CSV `fredgraph.csv?id=` (no API key) | BAMLH0A0HYM2 (HY OAS) | Yes, HTTP 200 | **2023-10-03 only** | ICE licence limits FRED to a 3-year window, the same for BAMLC0A0CM (IG OAS). Not usable for a backtest. |
| | BAA10Y (Baa minus 10y), DBAA, DAAA | Yes | 1986-01-02 (daily) | Long-history credit stand-in. Over 2023–26 its 3-month changes correlate 0.74 with HY OAS, and HY moves are about 2.4× larger. |
| | T10Y2Y / T10Y3M | Yes | 1976-06 / 1982-01 | Daily |
| | VIXCLS / VXVCLS | Yes | 1990-01 / 2007-12 | Duplicates Yahoo ^VIX / ^VIX3M |
| | SP500 | Yes | 2016-10 only | S&P licence limits it to 10 years. Use Yahoo ^GSPC instead. |
| | DTB3 (T-bill), NFCI | Yes | 1954 / 1971 (weekly) | Risk-free rate for Sharpe |
| Yahoo chart API v8 (browser User-Agent, no cookie) | SPY | Yes. `query2` worked; `query1` returned **429** on the first burst. | 1993-01-29 | Use `period1/period2&interval=1d`. **`range=max` silently returns monthly bars** for long histories. Dividend-adjusted closes are available. |
| | IWM, IWF / IWO | Yes | 2000-05-26 / 2000-07-28 | |
| | QUAL / MTUM | Yes | 2013-07-18 / 2013-04-18 | |
| | ^GSPC, ^SP500TR, ^RUT | Yes | 1927 / 1988 / 1987-09 | |
| | ^VIX, ^VIX3M | Yes | 1990-01 / 2006-07 | |
| | NAESX, VFINX, VISGX (Vanguard index funds) | Yes | 1980 / 1980 / 1998-05 | Total-return stand-ins that predate the ETFs |
| | ^RLG (R1000 Growth), IWD | Empty / 429 | — | Not retried |
| Shibui Finance MCP (`stock_data_query`, DuckDB, 200-row cap) | SPY, IWM, IWF, IWO, RSP, SPLV, HYG, JNK | Yes | SPY 1993-01-29; IWM/IWF 2000-05-26; IWO 2000-07-28; HYG 2007-04; JNK 2007-12 | NYSE/NASDAQ only. Close prices are **split- but not dividend-adjusted**, so they understate total return. |
| | QUAL, MTUM, USMV, VXX, VIXY, any index (^GSPC, ^VIX) | **Not present** | — | QUAL, MTUM and USMV list on Cboe BZX, which the database does not cover. It holds no indices. |
| | Breadth: % of common stocks with close > `sma_200` | Yes, computed in SQL | Pulled 1996-01 to 2026-10 as month-end values, in 2 queries | **Survivor-only universe** (887 names in 1996, 4,562 now). Delisted names are missing, so past breadth is probably biased upward. The 200-row cap forces aggregation inside SQL. |

**What I would wire in:** Yahoo (or Shibui for the ETFs) for prices, and FRED for the curve and BAA10Y. HY OAS should be collected going forward from FRED, because the full ICE history is not freely available. A market-based fallback is the HYG/IEF ratio (2007+). Breadth can come from Shibui, with the survivor-bias caveat.

## 2. Event study: when did each signal fire?

Cells show **trading days relative to the S&P 500 peak / relative to the first close 10 % below the peak**, followed by **(% of peak-to-trough days the signal was on)**. Negative numbers mean the signal fired before the peak or before the -10 % point. The search window starts 63 trading days before the peak, or 504 days for the yield-curve signals. `<=` means the signal was already on when the window opened. To filter out blips, an episode must last at least 3 days, and episodes less than 21 days apart are merged. FRED inputs are lagged 1 business day. The 10m-SMA and breadth signals use month-end values only and act from the next trading day.

| signal                  | 2000-02           | 2007-09           | 2011            | 2015-16         | Q4 2018         | 2020               | 2022              |
|:------------------------|:------------------|:------------------|:----------------|:----------------|:----------------|:-------------------|:------------------|
| 10y-2y <0               | -462 / -477 (30%) | -447 / -480 (0%)  | missed          | missed          | missed          | -119 / -125 (0%)   | +127 / +93 (36%)  |
| 10y-3m <0               | -387 / -402 (21%) | -434 / -467 (0%)  | missed          | missed          | missed          | -228 / -234 (42%)  | -484 / -518 (0%)  |
| Baa-10y 3m chg>+0.40    | +5 / -10 (23%)    | -36 / -69 (53%)   | +72 / +5 (34%)  | +66 / +1 (14%)  | +64 / +19 (3%)  | +12 / +6 (50%)     | +37 / +3 (12%)    |
| Baa-10y >3.0            | +246 / +231 (25%) | +82 / +49 (72%)   | +71 / +4 (35%)  | +62 / -3 (66%)  | missed          | +17 / +11 (29%)    | missed            |
| Breadth<40% (month-end) | -37 / -52 (15%)   | +38 / +5 (78%)    | +87 / +20 (20%) | +71 / +6 (49%)  | +30 / -15 (55%) | +9 / +3 (62%)      | +20 / -14 (90%)   |
| RUT/SPX<200dSMA         | +6 / -9 (28%)     | <=-63 / -96 (65%) | +61 / -6 (45%)  | +45 / -20 (70%) | -1 / -46 (97%)  | <=-63 / -69 (100%) | <=-63 / -97 (81%) |
| RV1m>20%                | -50 / -65 (50%)   | -45 / -78 (71%)   | +67 / +0 (39%)  | +65 / +0 (26%)  | +24 / -21 (53%) | +4 / -2 (83%)      | -8 / -42 (67%)    |
| RV3m>18%                | <=-63 / -78 (70%) | -29 / -62 (92%)   | +69 / +2 (37%)  | +68 / +3 (39%)  | +52 / +7 (21%)  | +8 / +2 (67%)      | +28 / -6 (86%)    |
| SPX<10mSMA (month-end)  | +133 / +118 (76%) | +38 / +5 (89%)    | +87 / +20 (20%) | +71 / +6 (39%)  | +30 / -15 (32%) | +9 / +3 (62%)      | +39 / +5 (69%)    |
| SPX<200dSMA             | -24 / -39 (78%)   | -46 / -79 (92%)   | +65 / -2 (40%)  | +63 / -2 (51%)  | +15 / -30 (65%) | +6 / +0 (67%)      | +13 / -21 (82%)   |
| VIX/VIX3M>1             | n/a (no data)     | <=-63 / -96 (43%) | -32 / -99 (39%) | +26 / -39 (13%) | +14 / -31 (41%) | -16 / -22 (88%)    | +16 / -18 (7%)    |
| VIX>25                  | -56 / -71 (42%)   | -46 / -79 (52%)   | +63 / -4 (39%)  | +64 / -1 (13%)  | +61 / +16 (9%)  | +3 / -3 (88%)      | -25 / -59 (57%)   |

Event anchors (S&P 500 price index):
```
2000-02 peak 2000-03-24 -10% on 2000-04-14 trough 2002-10-09 depth -49.1%
2007-09 peak 2007-10-09 -10% on 2007-11-26 trough 2009-03-09 depth -56.8%
2011 peak 2011-04-29 -10% on 2011-08-04 trough 2011-10-03 depth -19.4%
2015-16 peak 2015-05-21 -10% on 2015-08-24 trough 2016-02-11 depth -14.2%
Q4 2018 peak 2018-09-20 -10% on 2018-11-23 trough 2018-12-24 depth -19.8%
2020 peak 2020-02-19 -10% on 2020-02-27 trough 2020-03-23 depth -33.9%
2022 peak 2022-01-03 -10% on 2022-02-22 trough 2022-10-12 depth -25.4%
```

**False alarms.** An episode counts as a false alarm if the S&P never gets 10 % or more below its 52-week high within the 126 trading days after the episode starts. Sample periods run 1985/86 to 2026, except VIX/VIX3M (2006+) and breadth (1996+).

| signal                  | data_from   |   episodes |   hits |   false_alarms |   FA_per_decade |   %time_on | FA_by_decade                                |
|:------------------------|:------------|-----------:|-------:|---------------:|----------------:|-----------:|:--------------------------------------------|
| SPX<200dSMA             | 1986-01-14  |         36 |     20 |             16 |             3.9 |       23.8 | 1980s:2, 1990s:6, 2000s:4, 2010s:3, 2020s:1 |
| RV1m>20%                | 1986-01-14  |         38 |     31 |              7 |             1.7 |       19.3 | 1980s:2, 1990s:1, 2000s:1, 2010s:1, 2020s:2 |
| RV3m>18%                | 1986-01-14  |         23 |     21 |              2 |             0.5 |       26   | 2000s:1, 2020s:1                            |
| VIX>25                  | 1985-01-02  |         39 |     34 |              5 |             1.2 |       15.2 | 2010s:1, 2020s:4                            |
| VIX/VIX3M>1             | 2006-07-17  |         37 |     20 |             17 |             8.4 |       10.9 | 2000s:4, 2010s:9, 2020s:4                   |
| Baa-10y 3m chg>+0.40    | 1986-04-15  |         26 |     21 |              5 |             1.2 |        8.7 | 1980s:3, 1990s:2                            |
| Baa-10y >3.0            | 1986-04-15  |         10 |      9 |              1 |             0.2 |       12.4 | 1980s:1                                     |
| 10y-3m <0               | 1985-01-02  |         12 |      7 |              5 |             1.2 |       11.6 | 1980s:1, 2000s:2, 2010s:2                   |
| 10y-2y <0               | 1985-01-02  |         10 |      6 |              4 |             1   |       11.7 | 1980s:1, 2000s:3                            |
| RUT/SPX<200dSMA         | 1986-01-14  |         34 |     16 |             18 |             4.4 |       51   | 1990s:6, 2000s:5, 2010s:4, 2020s:3          |
| SPX<10mSMA (month-end)  | 1985-02-01  |         28 |     18 |             10 |             2.4 |       22.8 | 1980s:2, 1990s:4, 2000s:1, 2010s:1, 2020s:2 |
| Breadth<40% (month-end) | 1996-02-01  |         22 |     18 |              4 |             1.3 |       21.5 | 1990s:1, 2010s:2, 2020s:1                   |

**Readings:**
- **Price trend (200d / 10m SMA)** fired in every episode. It was usually around the -10 % point, not before it. It stayed on for 65 to 92 % of the big bear markets (2000–02, 2007–09, 2022) but only 20 to 50 % of the short V-shaped ones (2011, 2015–16, 2018, 2020). The 10-month SMA gives fewer false alarms than the daily 200d (2.4 vs 3.9 per decade) at the cost of a few weeks' lag. Its worst case was 2000: the S&P chopped around and the 10m signal did not fire until October 2000 (+133 days).
- **Realized vol (RV1m > 20 %)** fired near or ahead of the -10 % point in every event and had few false alarms (1.7 per decade). RV3m > 18 % is even cleaner (0.5 per decade) but slower.
- **VIX > 25** is similar to RV1m, with 1.2 false alarms per decade, but it was on for only 9 to 13 % of the 2015–16 and Q4 2018 declines.
- **Credit (Baa-10y 3-month change > +0.40)** is the cleanest risk-off flag (1.2 false alarms per decade, on 9 % of the time). It is **late**: it fired at or after the -10 % point in 6 of 7 events. The exception was 2007, where it fired 36 days before the peak, the one case where credit led. The Baa level above 3.0 missed 2018 and 2022 entirely.
- **Yield curve** inversions led recessions by 1 to 2 years. They missed 2011, 2015–16 and 2018, and they were *off* during most of the 2007–09 and 2020 drawdowns, because the curve re-steepens as the Fed cuts. They cannot time a monthly split.
- **VIX/VIX3M > 1 (backwardation)** is too noisy, with 8.4 false alarms per decade.
- **Breadth < 40 %** gave real early warnings in 2000 (-37 days) and 2020, and caught 2022 for 90 % of the decline. It had 1.3 false alarms per decade, but its history is survivor-biased.
- **IWM/SPY relative trend** was on 51 % of the time and gave 4.4 false alarms per decade. It is a style-cycle indicator, not a drawdown indicator.

## 3. Backtests: monthly-rebalanced 70/30 blends

The setup:
- Weights are decided at each month-end close and held over the next month. The risk-off allocation is 40/60.
- Costs are **10 bps per full switch** (a 70→40 move counts as one switch). For vol-scaling, the cost is pro-rated by the size of the weight change. Drift rebalancing back to target is not charged; its turnover is shown in `tot_TO`.
- Sharpe is measured over 3-month T-bills. `sig_TO` is one-way turnover from signal changes, in % per year. `tot_TO` adds drift rebalancing. `pct_def` is the share of months spent below a 70 % growth weight.
- Signal definitions:
  - Trend: SPX below its 10-month SMA of month-end closes.
  - Vol-scaled: growth weight = 0.70 × 15 % / RV1m, clipped to [40, 70] and rounded to 10-point steps.
  - Credit: Baa-10y 3-month change above +0.40 pp.
  - 2-of-3: trend, RV1m > 20 % and the credit signal.
  - "Exit confirm 2m": once risk-off, the vote must stay below 2 for 2 consecutive month-ends before returning to risk-on.
  - "Entry confirm 2m": the vote must be at least 2 on 2 consecutive month-ends before going risk-off.
- In-sample (IS) and out-of-sample (OOS) periods split each sample at its midpoint. **Nothing was fitted on the IS half.** All thresholds are conventional round numbers chosen up front, so the split tests stability, not a fit.

### ETF: IWO growth / SPY core — full sample 2000-09..2026-09

| strategy                      | start   | end     |   CAGR |   Vol |   MaxDD |   Sharpe |   Calmar |   sig_TO |   tot_TO |   switches |   pct_def |
|:------------------------------|:--------|:--------|-------:|------:|--------:|---------:|---------:|---------:|---------:|-----------:|----------:|
| Static 70/30                  | 2000-09 | 2026-09 |    7.1 |  19.2 |   -51.6 |     0.36 |     0.14 |        0 |        6 |          0 |         0 |
| Trend: SPX<10m SMA            | 2000-09 | 2026-09 |    7.1 |  18.2 |   -51.7 |     0.37 |     0.14 |       44 |       49 |         38 |        27 |
| Vol-scaled (RV1m, tgt 15%)    | 2000-09 | 2026-09 |    6.9 |  18.4 |   -51.3 |     0.36 |     0.13 |       65 |       68 |        109 |        35 |
| Credit: Baa-10y 3m chg>+0.40  | 2000-09 | 2026-09 |    6.9 |  18.9 |   -51.3 |     0.35 |     0.13 |       25 |       31 |         22 |         8 |
| 2-of-3 vote (no confirm)      | 2000-09 | 2026-09 |    7.2 |  18.5 |   -50.4 |     0.37 |     0.14 |       46 |       51 |         40 |        19 |
| 2-of-3 vote, exit confirm 2m  | 2000-09 | 2026-09 |    6.9 |  18.4 |   -51.2 |     0.35 |     0.13 |       32 |       37 |         28 |        25 |
| 2-of-3 vote, entry confirm 2m | 2000-09 | 2026-09 |    7   |  18.8 |   -50   |     0.36 |     0.14 |       35 |       40 |         30 |        12 |
| 100% SPY (reference)          | 2000-09 | 2026-09 |    8.3 |  15.1 |   -50.8 |     0.48 |     0.16 |        0 |        0 |          0 |       100 |

### ETF: IWO growth / SPY core — split IS 2000-09..2013-08 / OOS 2013-09..2026-09

| strategy                      |   IS CAGR |   IS MaxDD |   IS Sharpe |   IS sw |   OOS CAGR |   OOS MaxDD |   OOS Sharpe |   OOS sw |
|:------------------------------|----------:|-----------:|------------:|--------:|-----------:|------------:|-------------:|---------:|
| Static 70/30                  |      3.08 |     -51.58 |        0.16 |       0 |      11.2  |      -29.04 |         0.58 |        0 |
| Trend: SPX<10m SMA            |      3.33 |     -51.68 |        0.17 |      14 |      11.04 |      -29.71 |         0.58 |       24 |
| Vol-scaled (RV1m, tgt 15%)    |      2.88 |     -51.26 |        0.15 |      58 |      11.05 |      -28.44 |         0.58 |       51 |
| Credit: Baa-10y 3m chg>+0.40  |      3.01 |     -51.35 |        0.16 |      14 |      10.9  |      -29.04 |         0.57 |        8 |
| 2-of-3 vote (no confirm)      |      3.22 |     -50.42 |        0.17 |      22 |      11.22 |      -29.16 |         0.59 |       18 |
| 2-of-3 vote, exit confirm 2m  |      2.66 |     -51.18 |        0.14 |      16 |      11.24 |      -28.75 |         0.59 |       12 |
| 2-of-3 vote, entry confirm 2m |      3.16 |     -50.01 |        0.16 |      18 |      10.89 |      -30.03 |         0.56 |       12 |

### ETF: IWM growth / SPY core — full sample 2000-07..2026-09

| strategy                      | start   | end     |   CAGR |   Vol |   MaxDD |   Sharpe |   Calmar |   sig_TO |   tot_TO |   switches |   pct_def |
|:------------------------------|:--------|:--------|-------:|------:|--------:|---------:|---------:|---------:|---------:|-----------:|----------:|
| Static 70/30                  | 2000-07 | 2026-09 |    8.2 |  18.1 |   -51.6 |     0.43 |     0.16 |        0 |        6 |          0 |         0 |
| Trend: SPX<10m SMA            | 2000-07 | 2026-09 |    8   |  17.5 |   -51.9 |     0.42 |     0.15 |       43 |       48 |         38 |        27 |
| Vol-scaled (RV1m, tgt 15%)    | 2000-07 | 2026-09 |    7.9 |  17.5 |   -51.2 |     0.42 |     0.15 |       66 |       69 |        111 |        35 |
| Credit: Baa-10y 3m chg>+0.40  | 2000-07 | 2026-09 |    8.3 |  17.9 |   -50.5 |     0.43 |     0.16 |       25 |       30 |         22 |         8 |
| 2-of-3 vote (no confirm)      | 2000-07 | 2026-09 |    8.3 |  17.7 |   -50.6 |     0.44 |     0.16 |       46 |       50 |         40 |        19 |
| 2-of-3 vote, exit confirm 2m  | 2000-07 | 2026-09 |    8   |  17.5 |   -51.3 |     0.42 |     0.16 |       33 |       38 |         29 |        25 |
| 2-of-3 vote, entry confirm 2m | 2000-07 | 2026-09 |    8.1 |  17.8 |   -50.4 |     0.42 |     0.16 |       34 |       39 |         30 |        12 |
| 100% SPY (reference)          | 2000-07 | 2026-09 |    8.4 |  15.1 |   -50.8 |     0.49 |     0.17 |        0 |        0 |          0 |       100 |

### ETF: IWM growth / SPY core — split IS 2000-07..2013-07 / OOS 2013-08..2026-09

| strategy                      |   IS CAGR |   IS MaxDD |   IS Sharpe |   IS sw |   OOS CAGR |   OOS MaxDD |   OOS Sharpe |   OOS sw |
|:------------------------------|----------:|-----------:|------------:|--------:|-----------:|------------:|-------------:|---------:|
| Static 70/30                  |      5.79 |     -51.64 |        0.3  |       0 |      10.75 |      -27.36 |         0.57 |        0 |
| Trend: SPX<10m SMA            |      5.2  |     -51.91 |        0.27 |      14 |      10.78 |      -25.31 |         0.58 |       24 |
| Vol-scaled (RV1m, tgt 15%)    |      5.29 |     -51.17 |        0.27 |      59 |      10.62 |      -25.04 |         0.57 |       51 |
| Credit: Baa-10y 3m chg>+0.40  |      5.95 |     -50.46 |        0.31 |      14 |      10.59 |      -27.36 |         0.56 |        8 |
| 2-of-3 vote (no confirm)      |      5.75 |     -50.6  |        0.3  |      22 |      10.91 |      -25.04 |         0.58 |       18 |
| 2-of-3 vote, exit confirm 2m  |      5.09 |     -51.26 |        0.26 |      17 |      10.96 |      -25.04 |         0.59 |       12 |
| 2-of-3 vote, entry confirm 2m |      5.68 |     -50.43 |        0.29 |      18 |      10.59 |      -27.36 |         0.56 |       12 |

### Long: NAESX (Vanguard small-cap idx) / VFINX (S&P 500 idx) — full sample 1990-02..2026-09

| strategy                      | start   | end     |   CAGR |   Vol |   MaxDD |   Sharpe |   Calmar |   sig_TO |   tot_TO |   switches |   pct_def |
|:------------------------------|:--------|:--------|-------:|------:|--------:|---------:|---------:|---------:|---------:|-----------:|----------:|
| Static 70/30                  | 1990-02 | 2026-09 |   10.7 |  17.1 |   -52.8 |     0.53 |     0.2  |        0 |        5 |          0 |         0 |
| Trend: SPX<10m SMA            | 1990-02 | 2026-09 |   10.6 |  16.6 |   -52.5 |     0.53 |     0.2  |       42 |       47 |         51 |        24 |
| Vol-scaled (RV1m, tgt 15%)    | 1990-02 | 2026-09 |   10.4 |  16.5 |   -52.1 |     0.52 |     0.2  |       60 |       63 |        144 |        32 |
| Credit: Baa-10y 3m chg>+0.40  | 1990-02 | 2026-09 |   10.7 |  16.9 |   -51.9 |     0.53 |     0.21 |       25 |       29 |         30 |         8 |
| 2-of-3 vote (no confirm)      | 1990-02 | 2026-09 |   10.7 |  16.7 |   -51.6 |     0.53 |     0.21 |       39 |       44 |         48 |        16 |
| 2-of-3 vote, exit confirm 2m  | 1990-02 | 2026-09 |   10.5 |  16.6 |   -52.3 |     0.52 |     0.2  |       28 |       32 |         34 |        21 |
| 2-of-3 vote, entry confirm 2m | 1990-02 | 2026-09 |   10.6 |  16.8 |   -51.5 |     0.52 |     0.21 |       29 |       34 |         36 |        10 |
| 100% SPY (reference)          | 1993-02 | 2026-09 |   10.8 |  14.7 |   -50.8 |     0.61 |     0.21 |        0 |        0 |          0 |       100 |

### Long: NAESX (Vanguard small-cap idx) / VFINX (S&P 500 idx) — split IS 1990-02..2008-05 / OOS 2008-06..2026-09

| strategy                      |   IS CAGR |   IS MaxDD |   IS Sharpe |   IS sw |   OOS CAGR |   OOS MaxDD |   OOS Sharpe |   OOS sw |
|:------------------------------|----------:|-----------:|------------:|--------:|-----------:|------------:|-------------:|---------:|
| Static 70/30                  |     11.2  |     -35.03 |        0.5  |       0 |      10.27 |      -45.82 |         0.55 |        0 |
| Trend: SPX<10m SMA            |     11.09 |     -37.88 |        0.5  |      20 |      10.2  |      -44.11 |         0.56 |       31 |
| Vol-scaled (RV1m, tgt 15%)    |     10.71 |     -38.56 |        0.48 |      68 |      10.07 |      -44.18 |         0.55 |       76 |
| Credit: Baa-10y 3m chg>+0.40  |     11.07 |     -35.94 |        0.5  |      16 |      10.29 |      -44.58 |         0.56 |       14 |
| 2-of-3 vote (no confirm)      |     11.07 |     -36.61 |        0.5  |      24 |      10.39 |      -44.11 |         0.57 |       24 |
| 2-of-3 vote, exit confirm 2m  |     10.66 |     -39.72 |        0.48 |      15 |      10.36 |      -44.11 |         0.57 |       18 |
| 2-of-3 vote, entry confirm 2m |     11.06 |     -36.04 |        0.49 |      18 |      10.1  |      -44.17 |         0.55 |       18 |

### Short: IWO growth / QUAL core — full sample 2013-08..2026-09

| strategy                      | start   | end     |   CAGR |   Vol |   MaxDD |   Sharpe |   Calmar |   sig_TO |   tot_TO |   switches |   pct_def |
|:------------------------------|:--------|:--------|-------:|------:|--------:|---------:|---------:|---------:|---------:|-----------:|----------:|
| Static 70/30                  | 2013-08 | 2026-09 |   10.8 |  18   |   -30.3 |     0.56 |     0.36 |        0 |        7 |          0 |         0 |
| Trend: SPX<10m SMA            | 2013-08 | 2026-09 |   10.6 |  17.5 |   -31.6 |     0.56 |     0.34 |       55 |       60 |         24 |        16 |
| Vol-scaled (RV1m, tgt 15%)    | 2013-08 | 2026-09 |   10.6 |  17.4 |   -30.3 |     0.56 |     0.35 |       59 |       63 |         51 |        30 |
| Credit: Baa-10y 3m chg>+0.40  | 2013-08 | 2026-09 |   10.4 |  17.8 |   -30.3 |     0.54 |     0.34 |       18 |       24 |          8 |         4 |
| 2-of-3 vote (no confirm)      | 2013-08 | 2026-09 |   10.8 |  17.7 |   -30.8 |     0.57 |     0.35 |       41 |       46 |         18 |        12 |
| 2-of-3 vote, exit confirm 2m  | 2013-08 | 2026-09 |   10.8 |  17.5 |   -30.5 |     0.57 |     0.35 |       27 |       33 |         12 |        18 |
| 2-of-3 vote, entry confirm 2m | 2013-08 | 2026-09 |   10.4 |  17.9 |   -31.5 |     0.54 |     0.33 |       27 |       33 |         12 |         6 |
| 100% SPY (reference)          | 2013-08 | 2026-09 |   14.1 |  14.4 |   -23.9 |     0.86 |     0.59 |        0 |        0 |          0 |       100 |

### Short: IWO growth / QUAL core — split IS 2013-08..2020-02 / OOS 2020-03..2026-09

| strategy                      |   IS CAGR |   IS MaxDD |   IS Sharpe |   IS sw |   OOS CAGR |   OOS MaxDD |   OOS Sharpe |   OOS sw |
|:------------------------------|----------:|-----------:|------------:|--------:|-----------:|------------:|-------------:|---------:|
| Static 70/30                  |      9.59 |     -20.63 |        0.65 |       0 |      12.03 |      -30.33 |         0.51 |        0 |
| Trend: SPX<10m SMA            |      9.85 |     -20.94 |        0.68 |      10 |      11.45 |      -31.55 |         0.5  |       13 |
| Vol-scaled (RV1m, tgt 15%)    |      9.44 |     -20.62 |        0.65 |      23 |      11.8  |      -30.33 |         0.51 |       27 |
| Credit: Baa-10y 3m chg>+0.40  |      9.51 |     -20.63 |        0.64 |       4 |      11.38 |      -30.33 |         0.49 |        4 |
| 2-of-3 vote (no confirm)      |      9.67 |     -20.94 |        0.66 |       8 |      12    |      -30.79 |         0.52 |        9 |
| 2-of-3 vote, exit confirm 2m  |      9.55 |     -19.98 |        0.66 |       6 |      12.06 |      -30.5  |         0.52 |        5 |
| 2-of-3 vote, entry confirm 2m |      9.58 |     -20.63 |        0.65 |       4 |      11.32 |      -31.48 |         0.48 |        8 |

### Threshold sensitivity (no tuning; every variant shown)

### Sensitivity — ETF: IWO growth / SPY core

| variant                         |   Full CAGR |   Full MaxDD |   Full Sharpe |   switches |   %def |   IS Sharpe |   OOS Sharpe |   IS MaxDD |   OOS MaxDD |
|:--------------------------------|------------:|-------------:|--------------:|-----------:|-------:|------------:|-------------:|-----------:|------------:|
| Static 70/30                    |        7.07 |       -51.58 |          0.36 |          0 |   0    |        0.16 |         0.58 |     -51.58 |      -29.04 |
| Trend 9m SMA                    |        7.2  |       -51.68 |          0.37 |         38 |  27.8  |        0.18 |         0.58 |     -51.68 |      -29.71 |
| Trend 10m SMA                   |        7.13 |       -51.68 |          0.37 |         38 |  27.16 |        0.17 |         0.58 |     -51.68 |      -29.71 |
| Trend 12m SMA                   |        7.15 |       -51.5  |          0.37 |         32 |  26.2  |        0.16 |         0.59 |     -51.5  |      -29.71 |
| Trend 200d SMA (month-end)      |        7.22 |       -51.68 |          0.37 |         34 |  27.8  |        0.18 |         0.59 |     -51.68 |      -29.71 |
| Vol-scale RV1m tgt 12%          |        7.01 |       -51.15 |          0.37 |        141 |  53.04 |        0.14 |         0.61 |     -51.15 |      -27.66 |
| Vol-scale RV1m tgt 15%          |        6.9  |       -51.26 |          0.36 |        109 |  35.14 |        0.15 |         0.58 |     -51.26 |      -28.44 |
| Vol-scale RV1m tgt 18%          |        6.92 |       -51.31 |          0.35 |         77 |  22.68 |        0.15 |         0.58 |     -51.31 |      -29.08 |
| Vol-scale RV3m tgt 15%          |        6.55 |       -51.25 |          0.34 |         73 |  37.06 |        0.14 |         0.56 |     -51.25 |      -29.51 |
| Credit 3m chg>+0.25             |        7.03 |       -50.57 |          0.36 |         40 |  16.61 |        0.18 |         0.56 |     -50.57 |      -29.71 |
| Credit 3m chg>+0.40             |        6.9  |       -51.35 |          0.35 |         22 |   7.67 |        0.16 |         0.57 |     -51.35 |      -29.04 |
| Credit 3m chg>+0.60             |        6.82 |       -51.24 |          0.35 |         14 |   4.47 |        0.15 |         0.56 |     -51.24 |      -29.04 |
| Credit level>3.0                |        6.8  |       -52.1  |          0.35 |         20 |  19.17 |        0.13 |         0.58 |     -52.1  |      -29.04 |
| VIX>20                          |        6.8  |       -51.38 |          0.35 |         48 |  35.78 |        0.15 |         0.57 |     -51.38 |      -28.85 |
| VIX>25                          |        6.89 |       -52.6  |          0.35 |         38 |  20.13 |        0.15 |         0.58 |     -52.6  |      -28.43 |
| VIX>30                          |        6.96 |       -51.7  |          0.36 |         28 |   9.27 |        0.15 |         0.58 |     -51.7  |      -28.17 |
| Breadth<30%                     |        6.93 |       -51.3  |          0.35 |         24 |   9.58 |        0.16 |         0.57 |     -51.3  |      -30.27 |
| Breadth<40%                     |        6.72 |       -51.8  |          0.35 |         40 |  22.04 |        0.13 |         0.58 |     -51.8  |      -29.5  |
| Breadth<50%                     |        6.61 |       -51.73 |          0.34 |         62 |  35.14 |        0.12 |         0.59 |     -51.73 |      -26.74 |
| 2-of-3 exit2, RV>18%            |        6.87 |       -51.43 |          0.36 |         32 |  28.75 |        0.13 |         0.6  |     -51.43 |      -28.75 |
| 2-of-3 exit2, RV>20%            |        6.88 |       -51.18 |          0.35 |         28 |  25.24 |        0.14 |         0.59 |     -51.18 |      -28.75 |
| 2-of-3 exit2, RV>25%            |        6.46 |       -52.93 |          0.33 |         32 |  19.17 |        0.12 |         0.56 |     -52.93 |      -30.72 |
| 2-of-3 exit2, VIX>25 as vol leg |        6.61 |       -53.03 |          0.34 |         26 |  22.36 |        0.12 |         0.58 |     -53.03 |      -28.75 |
| 2-of-3 exit2, credit>+0.25      |        7.06 |       -51.05 |          0.36 |         30 |  26.52 |        0.15 |         0.59 |     -51.05 |      -28.75 |
| Any-1-of-3 (no confirm)         |        7.14 |       -51.73 |          0.37 |         46 |  31.95 |        0.18 |         0.58 |     -51.73 |      -28.75 |
| 3-of-3                          |        6.89 |       -51.24 |          0.35 |         20 |   5.75 |        0.16 |         0.57 |     -51.24 |      -29.04 |
| Rel. trend IWM/SPY<10m SMA      |        6.82 |       -52.32 |          0.35 |         48 |  50.16 |        0.11 |         0.65 |     -52.32 |      -25.95 |

### Sensitivity — Long: NAESX (Vanguard small-cap idx) / VFINX (S&P 500 idx)

| variant                         |   Full CAGR |   Full MaxDD |   Full Sharpe |   switches |   %def |   IS Sharpe |   OOS Sharpe |   IS MaxDD |   OOS MaxDD |
|:--------------------------------|------------:|-------------:|--------------:|-----------:|-------:|------------:|-------------:|-----------:|------------:|
| Static 70/30                    |       10.73 |       -52.75 |          0.53 |          0 |   0    |        0.5  |         0.55 |     -35.03 |      -45.82 |
| Trend 9m SMA                    |       10.67 |       -52.5  |          0.53 |         53 |  24.55 |        0.5  |         0.57 |     -37.88 |      -44.11 |
| Trend 10m SMA                   |       10.64 |       -52.5  |          0.53 |         51 |  23.64 |        0.5  |         0.56 |     -37.88 |      -44.11 |
| Trend 12m SMA                   |       10.55 |       -52.51 |          0.53 |         44 |  22.27 |        0.49 |         0.56 |     -39.81 |      -44.11 |
| Trend 200d SMA (month-end)      |       10.7  |       -52.5  |          0.54 |         47 |  24.09 |        0.5  |         0.57 |     -37.88 |      -44.11 |
| Vol-scale RV1m tgt 12%          |       10.38 |       -51.96 |          0.52 |        199 |  51.14 |        0.49 |         0.56 |     -39.37 |      -44.11 |
| Vol-scale RV1m tgt 15%          |       10.39 |       -52.07 |          0.52 |        144 |  32.5  |        0.48 |         0.55 |     -38.56 |      -44.18 |
| Vol-scale RV1m tgt 18%          |       10.61 |       -51.93 |          0.53 |         99 |  20.23 |        0.5  |         0.56 |     -36.62 |      -44.24 |
| Vol-scale RV3m tgt 15%          |       10.42 |       -51.96 |          0.52 |         95 |  35    |        0.49 |         0.55 |     -39.25 |      -44.16 |
| Credit 3m chg>+0.25             |       10.59 |       -51.92 |          0.53 |         54 |  15.68 |        0.49 |         0.56 |     -33.92 |      -44.58 |
| Credit 3m chg>+0.40             |       10.68 |       -51.93 |          0.53 |         30 |   7.5  |        0.5  |         0.56 |     -35.94 |      -44.58 |
| Credit 3m chg>+0.60             |       10.68 |       -51.93 |          0.53 |         18 |   3.86 |        0.5  |         0.55 |     -35.45 |      -44.58 |
| Credit level>3.0                |       10.57 |       -52.45 |          0.52 |         20 |  13.64 |        0.5  |         0.55 |     -36.07 |      -44.11 |
| VIX>20                          |       10.38 |       -52.53 |          0.53 |         67 |  37.05 |        0.51 |         0.54 |     -38.09 |      -44.11 |
| VIX>25                          |       10.79 |       -51.67 |          0.54 |         55 |  18.18 |        0.51 |         0.56 |     -37.15 |      -44.27 |
| VIX>30                          |       10.75 |       -51.4  |          0.53 |         34 |   7.5  |        0.5  |         0.56 |     -36.56 |      -44.27 |
| Breadth<30%                     |       10.75 |       -52.12 |          0.53 |         26 |   7.5  |        0.51 |         0.56 |     -35.03 |      -44.27 |
| Breadth<40%                     |       10.66 |       -52.86 |          0.53 |         48 |  17.95 |        0.51 |         0.56 |     -36.14 |      -44.33 |
| Breadth<50%                     |       10.41 |       -52.51 |          0.52 |         68 |  30    |        0.49 |         0.55 |     -37.2  |      -44.11 |
| 2-of-3 exit2, RV>18%            |       10.48 |       -52.7  |          0.52 |         40 |  24.09 |        0.47 |         0.57 |     -41.33 |      -44.11 |
| 2-of-3 exit2, RV>20%            |       10.51 |       -52.34 |          0.52 |         34 |  21.14 |        0.48 |         0.57 |     -39.72 |      -44.11 |
| 2-of-3 exit2, RV>25%            |       10.36 |       -52.2  |          0.51 |         40 |  16.36 |        0.47 |         0.55 |     -40.54 |      -44.27 |
| 2-of-3 exit2, VIX>25 as vol leg |       10.46 |       -52.18 |          0.52 |         35 |  19.55 |        0.47 |         0.57 |     -40.63 |      -44.27 |
| 2-of-3 exit2, credit>+0.25      |       10.59 |       -52.34 |          0.53 |         36 |  22.05 |        0.48 |         0.57 |     -38.63 |      -44.11 |
| Any-1-of-3 (no confirm)         |       10.65 |       -52.53 |          0.54 |         65 |  29.55 |        0.52 |         0.55 |     -37.47 |      -44.11 |
| 3-of-3                          |       10.7  |       -51.93 |          0.53 |         22 |   4.55 |        0.5  |         0.55 |     -35.88 |      -44.58 |
| Rel. trend IWM/SPY<10m SMA      |       10.57 |       -53.01 |          0.53 |         48 |  35.68 |        0.48 |         0.57 |     -36.54 |      -46.01 |

### Diagnostics: do the signals predict the *spread* or the *market*?

### Next-month returns by signal state — IWO-SPY 2000-09..

| signal                   | state    |   months |   growth %/mo |   core %/mo |   spread %/mo |   spread s.e. |
|:-------------------------|:---------|---------:|--------------:|------------:|--------------:|--------------:|
| Trend SPX<10m            | risk-off |       85 |          0.26 |        0.26 |         -0.01 |          0.41 |
| Trend SPX<10m            | risk-on  |      228 |          0.88 |        0.95 |         -0.07 |          0.2  |
| RV1m>20%                 | risk-off |       68 |          0.23 |        0.4  |         -0.17 |          0.41 |
| RV1m>20%                 | risk-on  |      245 |          0.84 |        0.86 |         -0.02 |          0.2  |
| Baa 3m chg>+0.40         | risk-off |       24 |          2.23 |        1.73 |          0.5  |          0.73 |
| Baa 3m chg>+0.40         | risk-on  |      289 |          0.58 |        0.68 |         -0.1  |          0.19 |
| VIX>25                   | risk-off |       63 |          1.45 |        1.25 |          0.2  |          0.45 |
| VIX>25                   | risk-on  |      250 |          0.53 |        0.64 |         -0.11 |          0.2  |
| Breadth<40%              | risk-off |       69 |          1.49 |        1.12 |          0.37 |          0.37 |
| Breadth<40%              | risk-on  |      244 |          0.49 |        0.66 |         -0.17 |          0.21 |
| 2-of-3 (trend,RV,credit) | risk-off |       59 |          0.15 |        0.31 |         -0.16 |          0.44 |
| 2-of-3 (trend,RV,credit) | risk-on  |      254 |          0.84 |        0.86 |         -0.02 |          0.2  |
| IWM/SPY<10m SMA          | risk-off |      157 |          1.06 |        0.94 |          0.12 |          0.24 |
| IWM/SPY<10m SMA          | risk-on  |      150 |          0.58 |        0.73 |         -0.16 |          0.27 |

### Next-month returns by signal state — NAESX-VFINX 1990..

| signal                   | state    |   months |   growth %/mo |   core %/mo |   spread %/mo |   spread s.e. |
|:-------------------------|:---------|---------:|--------------:|------------:|--------------:|--------------:|
| Trend SPX<10m            | risk-off |      104 |          0.85 |        0.81 |          0.04 |          0.3  |
| Trend SPX<10m            | risk-on  |      336 |          1.02 |        1.02 |          0.01 |          0.16 |
| RV1m>20%                 | risk-off |       82 |          0.66 |        0.77 |         -0.11 |          0.45 |
| RV1m>20%                 | risk-on  |      358 |          1.05 |        1.01 |          0.04 |          0.14 |
| Baa 3m chg>+0.40         | risk-off |       33 |          1.93 |        1.92 |          0.01 |          0.54 |
| Baa 3m chg>+0.40         | risk-on  |      407 |          0.9  |        0.89 |          0.01 |          0.15 |
| VIX>25                   | risk-off |       80 |          1.39 |        1.57 |         -0.17 |          0.37 |
| VIX>25                   | risk-on  |      360 |          0.89 |        0.83 |          0.06 |          0.15 |
| Breadth<40%              | risk-off |       79 |          1.45 |        1.41 |          0.04 |          0.45 |
| Breadth<40%              | risk-on  |      361 |          0.88 |        0.87 |          0.01 |          0.14 |
| 2-of-3 (trend,RV,credit) | risk-off |       69 |          0.58 |        0.67 |         -0.09 |          0.36 |
| 2-of-3 (trend,RV,credit) | risk-on  |      371 |          1.06 |        1.02 |          0.03 |          0.15 |
| IWM/SPY<10m SMA          | risk-off |      157 |          1.02 |        0.94 |          0.08 |          0.2  |
| IWM/SPY<10m SMA          | risk-on  |      150 |          0.78 |        0.72 |          0.06 |          0.21 |

### Risk-off moves 30 pts of growth to T-bills (not to core)

| strategy                                     |   CAGR |   Vol |   MaxDD |   Sharpe |   switches | universe    |
|:---------------------------------------------|-------:|------:|--------:|---------:|-----------:|:------------|
| Static 70/30                                 |   7.07 | 19.16 |  -51.58 |     0.36 |          0 | IWO/SPY     |
| Trend SPX<10m -> 30pts to T-bills            |   7.43 | 15.97 |  -39.95 |     0.41 |         38 | IWO/SPY     |
| 2-of-3 (trend,RV,credit) -> 30pts to T-bills |   7.36 | 16.84 |  -45.08 |     0.4  |         40 | IWO/SPY     |
| Baa 3m chg>+0.40 -> 30pts to T-bills         |   6.56 | 18.17 |  -53.16 |     0.34 |         22 | IWO/SPY     |
| Static 70/30                                 |  10.73 | 17.1  |  -52.75 |     0.53 |          0 | NAESX/VFINX |
| Trend SPX<10m -> 30pts to T-bills            |  10.42 | 14.73 |  -40.94 |     0.56 |         51 | NAESX/VFINX |
| 2-of-3 (trend,RV,credit) -> 30pts to T-bills |  10.69 | 15.24 |  -42.08 |     0.57 |         48 | NAESX/VFINX |
| Baa 3m chg>+0.40 -> 30pts to T-bills         |  10.29 | 16.24 |  -46.17 |     0.52 |         30 | NAESX/VFINX |

**Backtest results:**
- Every switched blend lands within about ±0.4 pp CAGR, ±0.03 Sharpe and ±2 pp MaxDD of the static blend. This holds for IWO/SPY, IWM/SPY, NAESX/VFINX (1990–2026) and IWO/QUAL (2013–26), in both halves of each sample. The differences are noise.
- **The growth-minus-core spread does not depend on regime.** In every row, the conditional spread is within one to two standard errors of zero. Several "fear" signals (credit jump, VIX > 25, breadth < 40 %) were followed by **higher** next-month returns for both sleeves: the fear typically fired near the low.
- **Market-level information is real but modest.** Next-month returns for both sleeves were 0.2–0.7 %/mo lower when trend, RV or the 2-of-3 vote were risk-off. Sending the 30 points to cash instead of to core cut max drawdown by about 11 to 12 pp in both universes, with equal or better Sharpe.
- **Continuous vol-scaling churns.** It made 109 to 199 switches with no benefit, so a discrete rule is better.
- **The rules are not fragile.** Moving the trend window between 9, 10 and 12 months, or the credit threshold between +0.25 and +0.60, barely changes the result. The rules are also not *useful* for the equity-only split. The robustness check mostly confirms there is no edge to overfit.
- **IWO/QUAL (2013–26):** the static 70/30 blend had a lower Sharpe than 100 % SPY (0.56 vs 0.86) because small/mid growth lagged large caps for a decade. That is a sleeve-mix question, not a regime question.

## 4. Limitations

- **Proxy mismatch.** IWO, IWM and NAESX stand in for the growth sleeve; SPY, VFINX and QUAL stand in for core. The real sleeves are stock-picked baskets with different beta, sector and factor exposure. NAESX is small-cap *blend*, not growth. Results could change if the growth sleeve has higher beta than IWO, or if the core sleeve is a low-vol or quality basket that falls much less than SPY.
- **Short ETF histories.** IWO starts in 2000 and QUAL in 2013, so the IWO/QUAL test covers only one full bear market (2022) plus the 2020 crash. Seven events are a small sample, and 13-year halves contain only 1 to 3 events each.
- **Look-ahead controls.** Signals use only data available at each month-end close. FRED series are lagged 1 business day. Trades execute at that same month-end close, which is a slightly optimistic execution assumption. Breadth comes from today's ticker list (survivor bias). Yahoo adjusted closes are revised retroactively for dividends.
- **Credit stand-in.** BAA10Y is investment-grade and partly driven by rates. The +0.40 Baa threshold maps to roughly **+1.0 pp of HY OAS**, based on 2023–26 data only. That mapping is untested over a full cycle.
- **Not modelled:** taxes (each switch in a taxable account realises gains, which likely costs more than the 10 bps assumed), bid/ask on individual names, and the drift-rebalancing costs.

## 5. Recommendation

**Core finding:** moving weight between growth and core sleeves does not control drawdowns in these tests. If the goal of the regime overlay is downside protection, the **risk-off state needs non-equity ballast**: T-bills, short Treasuries, or a genuinely low-beta core. If the goal is to capture small-vs-large cycles, none of these signals predicted that spread.

| Signal | Use? | Definition / threshold | Role |
|---|---|---|---|
| S&P 500 vs 10-month SMA | **Yes, primary** | Month-end close < 10m SMA of month-end closes. Results were the same for 9, 10 and 12 months and for the 200d SMA. | Trend leg of the vote. Also the re-entry trigger. |
| 1-month realized vol of SPX/SPY | **Yes** | 21-day annualized vol > 20 % at month-end. 18 % and 25 % are viable. VIX > 25 is an equivalent substitute. | Vol leg of the vote. Fast and has few false alarms. |
| Credit spread change | **Yes, as confirmation** | Baa-10y 3-month change > +0.40 pp, or **HY OAS 3-month change > +1.0 pp** once enough live history exists (start logging BAMLH0A0HYM2 daily now). Level filter: HY OAS > 6 % (untested). | Credit leg of the vote. Usually late, but rarely false. |
| **Combined rule** | **Recommended** | **Risk-off when at least 2 of 3 legs are on at a month-end close.** **Back to risk-on when SPX closes a month above its 10m SMA and fewer than 2 legs are on, or after 2 consecutive month-ends below 2 votes.** At most 1 change per month. | This cut switches from about 40 to about 28 over 26 years (IWO/SPY). Performance was similar: -0.3 pp CAGR, which is within noise. |
| Risk-off action | — | Move 30 points of growth to **T-bills or short Treasuries**, or keep them in core only if core is clearly lower-beta than SPY. | This is what actually lowered max drawdown in the tests (about -52 % → -40 %). |
| VIX > 30, breadth < 30 %, credit jump at a high level | Context only | Do **not** de-risk further on these. When they are on alongside a risk-off vote, treat it as possible capitulation: be ready to re-risk on the trend signal. | Next-month returns after these readings were above average. |
| Yield curve (10y-3m, 10y-2y) | **No** for timing | — | Leads recessions by 1–2 years, missed 3 of 7 events, and is off during the crashes themselves. Report it as macro context only. |
| VIX/VIX3M backwardation | No | — | 8.4 false alarms per decade |
| IWM/SPY or IWO/IWF relative trend | No (as a regime signal) | — | On 51 % of the time, no predictive spread. If used at all, it belongs to a separate sleeve-momentum decision. |
| Continuous vol-scaling | No | — | 100+ switches, no benefit |

**Current readings, month-end Sept 2026 (data to Oct 2):** SPX is above its 10m SMA. RV1m is about 11 % and VIX about 15–16. Baa-10y is 1.49 and has fallen 0.15 over 3 months. So the vote is **0 of 3, risk-on.** Two signals to watch: breadth is 39.9 % (below 40 %, a narrow market), and **HY OAS is 3.24 %, up +0.50 pp over 3 months** while Baa-10y fell. That divergence is worth monitoring but is well below the +1.0 pp HY trigger. IWM/SPY is below its 10m SMA.
