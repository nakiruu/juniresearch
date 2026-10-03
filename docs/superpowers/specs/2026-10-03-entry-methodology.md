# How to enter buys — timing, execution, selection, and Shibui (2026-10-03)

**Question (owner).** What is the best way to enter buys? The 5-business-day lock and the sub-$1,000 NAV are
binding constraints. Evidence should come from academic sources, including arXiv, and from Shibui, and the
note should also cover how Shibui is best used for this.

**Answer in one paragraph.** How and when to buy is already close to optimal: full size, at the first
decision after the trigger, as a fractional market order around 15:10 ET. Every alternative tested
(pullback limits, waiting, waiting for an up day, staging, calendar timing) ties or loses. What can still
earn money is *which* price-triggered entries to take. One filter held across all three eras: **do not buy a
stock-specific fall after a negative earnings surprise — the report is stale; re-write it first.** It is
built (`staleEntryGate`, `lib/trade/stale-entry.ts`, `docs/engine.md` §4.2), fed by a committed Shibui earnings
capture (`npm run trade:earnings`). Shibui's role is offline: stamp the inputs at capture time, refresh them between
reports, and run the evidence log. The trader cannot query it at 15:10.

## How the engine enters today

- **Trigger.** A name not held becomes ENTER when μ ≥ 8%, R ≥ 0.6, κ ≥ 45, the label is buy-side and the
  report is ≤ 120 days old (`hysteresis.ts`). There are two ways in:
  - **At publication.** The desk's BUY needs E ≥ 10% at the report price, so most BUYs enter immediately.
  - **On a price fall.** 9 of the 51 current buy-side reports published with R in [0.5, 0.6). These enter on the
    first ~1–2% dip, since the desk's BUY needs R ≥ 0.5 but entry needs 0.6. Re-entries after an exit and names
    that rallied and came back are also price-triggered.
- **Size.** Full target weight in one order (`emitTrades`). Adds are allowed but push the sell lock out.
- **Execution.** At NAV < $1,000 every order is under `marketOnlyBelowUsd` ($200). So every entry is a
  **fractional market DAY order** at 15:10–15:30 ET, sent only with a fresh quote whose spread is
  ≤ `marketMaxSpread`.

## Method

**Shibui event study.** Universe: US common stocks with market cap ≥ $2B at the anchor and ≥ 240 sessions of
history.
- **Synthetic report:** the first session after each 10-Q/10-K filing (`sec_filings`, first filing per period).
- **Price trigger:** the first close ≥ 8% below that price within 88 days. Variants use 5% and 12%.
- **Cause:** the breach rule's split, share = residual/total since the report, with trailing-252d β
  (`breach.ts`).
- **Surprise:** the latest `earnings_quarterly.surprise_percent` on or before the trigger.
- **Returns:** close-to-close, minus SPY over the same window. Each group is compared with the baseline: entries
  on the report day itself.
- **Eras:** filings in 2010–15, 2016–20 and 2021–25. There are about 23,000 price triggers and 52,000
  report-day entries.

**Literature.** Four parallel reviews covered execution, entry signals, event and calendar timing, and
small-account sizing. They read primary sources where possible and mark abstract-only sources. Their memos sit
in the session scratchpad; citations used below are the verified ones unless marked.

## 1. How to buy: keep the current mechanics

| Alternative | Shibui (2021–25, 63-day excess vs SPY) | Literature | Verdict |
|---|---|---|---|
| Buy at the decision (current) | −1.16 (price triggers), −1.85 (report day) | — | **Keep** |
| Limit 0.5–4% below for 1–5 days, buy at market if unfilled | −1.15 to −1.48 (report day: −1.94 to −2.14) | Handa & Schwartz 1996; Harris & Hasbrouck 1996; Linnainmaa 2010 (JF) | 🚫 Ties at best |
| Same limit, keep cash if unfilled | −1.78 to −2.75 | same | 🚫 Loses 0.6–1.6pp |
| Why limits fail | Filled names go on −1.9 to −4.1pp from the buy-now price; unfilled names +0.2 to +2.8pp | Adverse selection: limits fill on bad news | — |
| Wait 5 / 10 sessions | The price drifts **up** on average: +0.35/+0.13, −0.22/−0.22, +0.15/+0.34pp | Alpha decay ≈ 1.7 bp/day (Di Mascio, Lines & Naik); upside alpha is front-loaded in month 1 (Da & Schaumburg 2011) | 🚫 |
| Wait for the first up day | −0.88 vs −0.85 (it misses the quick rebounders, which return +7.8%) | — | 🚫 Tie |
| Half now, half later | Same evidence as waiting; each add also restarts the sell lock | Gârleanu & Pedersen 2013 (trade fully to target when costs ≈ 0); Constantinides 1979; Vanguard 2012 (lump sum wins ~⅔) | 🚫 |
| Market-on-close | Can't be tested on daily data | Close misses the 4:00 midpoint by 2.7 bp in large caps (Bogousslavsky & Muravyev 2023). Neither broker takes fractional close orders | 🚫 ≤ 1 bp, not available |
| Next open | Gives up the overnight return | Open spreads have *widened* since 2010 (Bogousslavsky & Muravyev); overnight premium (Lou, Polk & Skouras 2019) | 🚫 Costs 3–10 bp |
| Calendar: turn of month, weekday, pre-FOMC, pre-earnings | Next earnings ≤ 14 days, minus none, 126d: +0.15 / −1.35 / +2.45 | Turn of month measured under T+3 (Etula et al. 2020); pre-FOMC 49 → 9 bp (Kurov et al. 2021); earnings premium ≈ 0 in US large caps after 2004 | 🚫 |

**Cost at this size.** The order is about a millionth of daily volume, so impact is zero. The cost is the
spread net of broker price improvement. In a real-money study, Schwab's effective spread was 0.229× the quoted
spread (Huang, Jorion, Lee & Schwarz 2024, FEDS). That is about 0.3–1 bp in large caps, 1–4 bp in mid caps and
3–12 bp in small caps. The 2026-09-28 audit measured ~2 bp a trade on this account's fractional orders. Optimal-execution models (Almgren–Chriss, Guéant–Lehalle, RL execution on arXiv) solve
problems this book does not have.

**Report latency.** Over the first 10 sessions after the filing, beat names gain only 0–0.3pp on miss names. So
a week between the filing and the report costs little. The literature puts the real clock at the **press
release**: accounting-signal returns arrive mostly in the first 30 days after the information is public
(Bowles, Reed, Ringgenberg & Thornock 2024, JF, "Anomaly Time"). Measure latency from the 8-K item 2.02, not
from the 10-Q.

## 2. Which price-triggered entries to take

### The filter that held: stale on bad news

Excess return over 126 days vs SPY, **minus the report-day baseline**, for 8% price triggers:

| Era | All triggers | Market-driven | Stock-specific | Stock-specific, last surprise beat | **Stock-specific, last surprise missed** |
|---|---|---|---|---|---|
| 2010–15 (n 4,789 / 529) | +0.05 | +2.42 | −1.36 | −0.43 | **−3.57** |
| 2016–20 (n 6,530 / 768) | +0.96 | +0.61 | +0.49 | +1.36 | **−1.82** |
| 2021–25 (n 11,827 / 1,291) | +1.24 | +5.37 | −1.10 | −0.34 | **−3.51** |

- **Miss minus beat, within stock-specific dips:** −3.14 / −3.18 / −3.17pp at 126 days, and −2.49 / −1.33 /
  −2.34pp at 63 days. About 11% of triggers fall in this cell.
- **Dip depth:** the same at 5% (−3.09) and 12% (−3.38) dips, 2021–25.
- **By year:** negative in 12 of 16 years, and in 10 of the 11 years with ≥ 100 misses. The equal-weight yearly
  mean is −2.5pp (t ≈ 3). **It faded in 2024–25 (−0.9, +0.2).**
- **Turnover:** the effect is sharper in quiet, low-turnover slides (−4.3 / −2.9 / −3.7pp). High-turnover drops
  rebound. This matches "continuous information persists, discrete jumps reverse" (Da, Gurun & Warachka 2014,
  "Frog in the Pan").

**Why it should work.** The trigger is "price falls until μ ≥ 8%" with the scenario prices frozen until the
next report. In the analyst-target literature that is the worst cell: high upside made by a price fall while
the target is stale.
- Palley, Steffen & Zhang (Management Science): high-upside, high-dispersion stocks with poor past returns earn
  1.9% over 12 months, against 13.3% for low-upside peers.
- Brav & Lehavy 2003: gaps close through target cuts, not price.
- Raw upside is a weak or negative predictor in large caps (Han, Kang & Kim 2022; Da & Schaumburg 2011
  across sectors, t = 0.86).
- News-driven moves drift (Chan 2003; Savor 2012). A miss followed by a stock-specific slide is the case where
  the report most likely has not absorbed the news.

**It is also the breach rule's mirror.** The engine exits a stock-specific fall through the bear. It should not
open one on the way down when the latest earnings were a miss.

**The rule (built 2026-10-03).** A not-held name is BARRED ("stale on bad news — needs a fresh report") when all
three hold:
- the decision mark is ≥ 5% below the report price (smaller falls are noise for the cause split);
- `classifyBreach` on that fall says `stock` (share ≥ 0.9; same inputs as the breach rule);
- the latest earnings surprise is negative.

Any missing input lets the entry through. The name is pushed up the re-synthesis queue.

**Expected value.** Small. About 1–2 gated entries a year, each avoiding about 3pp over 6 months on a 6–10%
weight, comes to roughly **+0.1 to +0.4pp of NAV a year**. It needs one new input (the last surprise) and costs
nothing in trades.

**Caveats.**
- Synthetic reports, not the desk's own.
- Survivor-only prices. Delisted losers are missing, which makes the miss cell look *better* than it was.
- Clustering: 2014–15 and 2019–23 carry much of it.
- About a dozen variants were tested. This one was motivated by the literature and the breach study in advance.

### Filters tested and rejected (inconsistent across eras)

126-day differences in pp, listed 2010–15 / 2016–20 / 2021–25.

| Filter | Result | Literature prior | Verdict |
|---|---|---|---|
| 12–1 momentum: negative minus positive (all dips) | −4.80 / **+1.82** / −2.55 | Asness 1997; Daniel & Moskowitz 2016 (losers rebound in panics). Big-cap momentum ≈ 0 since 2010 (French data, t = 0.19) | 🚫 Flips sign |
| Stock-specific with negative momentum, vs baseline | −6.05 / **+0.68** / −3.36 | — | 🚫 Subsumed by the surprise rule |
| High turnover (21d/252d ≥ 1.5) minus low, stock-specific | **+4.56 / +5.98 / +1.43** | Medhat & Schmeling 2022: high-turnover dips continue | 🚫 The opposite here: deferring them would cost |
| Lottery screen (max daily return ≥ 8% in 21d), non-stock-specific | +5.97 / +14.56 / −1.60 | Bali, Cakici & Whitelaw 2011 | 🚫 Flips sign |
| Next earnings ≤ 14 days | +0.15 / −1.35 / +2.45 | Earnings premium ≈ 0 in large caps; Johnson & So 2018 | 🚫 |
| Insider open-market buy in the last 90 days, stock-specific | +1.18 / +0.65 / +3.6 (n 263 / 448 / 562) | Cohen, Malloy & Pomorski 2012: mostly small caps, decayed | 💡 Right sign, too small. Log it |
| Price below its 200-day average (2021–25 only) | No consistent sign at 63 vs 126 days | Trend factor insignificant after 2001 | 🚫 |

### Deferred to the desk's own data (calibration)

- **Post-miss reports at publication.** They lag post-beat reports by −1.63 / −1.60 / −1.80pp over 126 days.
  The desk may already price the miss into its scenarios; the calibration log will tell. No haircut yet.
- **Sector-relative μ.** Relative upside predicts and raw upside does not: Da & Schaumburg (within sector,
  177 vs 79 bp/month); Farago et al. (within an analyst's coverage, 0.47%/month, t = 2.7, working paper). This
  is the first sizing experiment once realized returns exist, alongside measuring μ's information content b
  (engine-audit review).

## 3. Sub-$1,000 specifics

- **Market orders are right at this size.** The current spread gate is the only protection worth having.
- **Fees.**
  - Current rates: SEC Section 31 is $20.60 per $1M since 2026-04-04; FINRA TAF is $0.000195/share but $0 from
    2026-10-01 to 2026-12-31; CAT is ~$0.000003/share.
  - Alpaca sums each fee per account per day and rounds up to $0.01, which is negligible.
  - Schwab does not disclose its rounding. If it rounds per trade, a $20 sell pays 5 bp. **Check one live Schwab
    confirmation.** At the 2.5pp band (≈ $22 at $900 NAV) trims are already ≥ $20, so no change is expected.
- **Schwab fractional eligibility is settled.** Secondary sources describe the retail Stock Slices product as
  S&P 500 only with a $5 minimum. The API is different: the 2026-09-27 `previewOrder` checks accepted fractional
  MARKET buys in EVLV and AIP and a fractional sell in LTRX, none of them S&P 500 names, from $1
  (`2026-09-28-pipeline-audit.md` §2). That audit measured fractional execution at ~2 bp a trade. Keep watching
  run notes for `rejected` orders.
- **Concentration.** Keep the 10% cap and ≥ 10 names. Best-ideas alpha is real (Antón, Cohen & Polk), but at an
  unmeasured, modest IC, concentration lowers the IR. Concentrated households beat diversified ones only above
  ~$100k (Ivković, Sialm & Weisbenner 2008).
- **Cash drag.** Cash costs cash share × equity premium (10% cash ≈ 40–80 bp/yr). The book holds about 1% cash
  today, so an ETF sleeve is not worth building. Revisit if cash stays above 10%.
- **Turnover breaker.** It is off by default. If it is turned on, its 15% per-run cap halts any one-for-one swap
  at 10% positions (≈ 20% turnover). Set it to ≥ 25% or keep it off.
- **Account mechanics.** The 5-day lock also prevents good-faith violations in a cash account and any day trade.
- **Wash sales.** A re-buy within 30 days of a loss sale defers the loss (IRS Pub. 550). Brokers track this per
  account only, so Alpaca and Schwab must be tracked together.

## 4. Using Shibui well

Shibui is a Claude connector, not an HTTP API. The trader container cannot query it at 15:10. Every
Shibui-derived input must be **captured and stamped offline**, the same print → save → `--apply` pattern as
`facts:beta`, `facts:crosscheck`, `screen` and `calibration:log`.

| Use | What | Value |
|---|---|---|
| **1. Stamp at capture** | Add `lastEarnings` (report date, EPS actual/estimate, surprise %) and `nextEarningsDate` to the FactPack. Shibui carries the forward calendar (4,293 future rows to 2026-12-09) | Inputs for the stale-report gate and a "report predates the latest earnings" flag |
| **2. Refresh between reports** | A short capture over held and candidate names for any earnings since their report | The dangerous case is a miss *after* the report. This catches it |
| **3. Queue by staleness** | Have `screen` rank re-synthesis by (a) gated or stale-on-bad-news names and (b) days since the 8-K 2.02 press release (`sec_filings` is near real time) | Blocked names get a fresh report fast; latency is measured from the right clock |
| **4. Evidence log** | Tag each `calibration:log` point with trigger type (publication vs price), cause share, surprise sign and turnover | Re-tests the gate on the desk's own entries; measures μ's b and IC, the most valuable unknown |
| **5. Reproducible study** | Commit this note's event-study SQL as a print/apply script and re-run it quarterly | Out-of-sample check. The effect faded in 2024–25 |
| Not worth it | Intraday timing (no intraday data), spread estimates (live quotes are better), Street-target history (snapshot only), momentum, lottery and turnover filters (tested above) | — |

## Ranked recommendations

1. **Keep the entry mechanics unchanged:** full size, first decision, fractional market order at 15:10, spread
   gate. No limits, waiting or staging. Strong evidence; the alternatives cost 0–3pp per entry.
2. **Check Schwab's fee rounding on one live confirmation.** Per-trade rounding to the cent would cost 5 bp on
   a $20 sell. With the 2.5pp band no change is expected, but it is the one cost at this NAV not yet measured.
3. **Done: the stale-on-bad-news gate and the Shibui earnings capture** (§2, §4.1). Still open: queue gated
   names for re-synthesis (§4.3). About +0.1 to +0.4pp
   of NAV a year; consistent evidence, fading lately; no trading cost.
4. **Extend the calibration log** (§4.4–4.5). This is how every deferred item, sector-relative μ above all, gets
   decided on the desk's own data.
