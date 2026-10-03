# Dynamic growth/core sleeve plan and automated watchlist manager

**Status:** plan only. No code is written, and nothing here is in effect until the owner approves it.
**Date:** 2026-10-03.
**Sources:** five research reports in [`2026-10-03-sleeve-research/`](2026-10-03-sleeve-research/):

| Report | Topic |
|---|---|
| A | Academic evidence on regime overlays (32 sources) |
| B | Evidence on the two sleeves (37 sources) |
| C | Where the plan plugs into the engine |
| D | Watchlist turnover and research throughput (21 sources) |
| E | Signal data and backtests, 1990–2026 |

Citations below point into those reports.

The owner's answers to the four open questions:

1. The split should be dynamic and change with conditions, chosen from the research.
2. The watchlist has no maximum size. Holdings will be capped later.
3. Archive removed reports; don't delete them.
4. No names are pinned.

---

## 0. The answer in one page

| Decision | Choice | Main reason |
|---|---|---|
| How to state the split | **By weight of invested capital, not name count.** Count is used only as a diversification floor. | A growth name carries about 1.5× a core name's volatility, so counts misstate risk (B §c). |
| Strategic (average) split | **Roughly 47% growth / 46% core / 7% T-bills over a cycle.** It comes from the overlay below, not a fixed target. | At 50/50 by weight, growth carries about 60% of portfolio risk. That keeps the portfolio growth-led, as the owner wants. Going heavier on growth isn't supported: the premium for this growth recipe is uncertain (about 1–3%/yr gross, roughly half net), and small/mid growth lagged large quality for the past decade (B §c, E §3). |
| Dynamic overlay | **Three states driven by a 3-signal vote at month-end:** S&P 500 trend, realized volatility and credit-spread widening. | Each leg has robust evidence and rarely misfires (A §2–6, E §2). Using three graded states means one false alarm only moves the portfolio halfway. |
| What the overlay moves | **Growth weight goes partly into core and partly into T-bills.** It is not a pure growth↔core swap. | **This is the central finding.** Swapping growth for core alone left max drawdown within ±2 pp of the static mix in every test (about −51% either way), because both sleeves fall together. Moving 30 points to T-bills on the trend signal cut max drawdown from about −52% to about −40% with equal or better Sharpe (E §3). |
| Core sleeve definition | **Hardened to be real ballast:** low beta, leverage cap, sector cap, and ROIC stability instead of "every quarter". | Otherwise a $50B+ high-ROIC screen fills with long-duration mega-cap tech that falls with growth. MSCI USA Quality lost 22.7% in 2022 against 19.5% for the market (B §b, A §failure modes). |
| Growth sleeve definition | **Add a dilution cap, a profitability floor, an accruals check and an asset-growth guard.** Demote "uptrend" to a risk guard. | The small-growth corner's poor returns come from unprofitable, heavily investing, share-issuing firms, not from growth as such (Fama-French 2015; Hou-Xue-Zhang; Novy-Marx 2013 — B §a). |
| Watchlist entry and exit | **Maintenance threshold at about 2/3 of the entry threshold, plus a 2-check confirmation for soft fails.** A **hard exit** in one check below 1/2, or on a thesis break. | Novy-Marx & Velikov: buy-top-10%/hold-to-top-20% cut turnover 41% and costs 42%, beating every other cost fix tested. MSCI, FTSE and Russell all use bands (D §1). |
| Cadence | **Weekly admission scan. Quarterly maintenance per name, after its 10-Q/10-K. Monthly overlay state.** | Matches how fast each signal decays: revenue and earnings surprises fade in about 6 months, quality changes slowly, trend needs month-end data (D §4, A §2). |
| Additions | **1–2 a week, ranked by screen percentile × P(BUY) × freshness.** Names with Street upside below 10% get a short triage note, not a full report. | Research capacity is the binding limit. Alpha is concentrated in top-ranked ideas ("Best ideas"). The owner's own calibration shows Street upside below 10% predicts a HOLD with AUC 0.82 (D §3). |
| List size | **No cap**, per the owner. The add rate bounds the list in practice: by Little's law, list size ≈ add rate × average time on the list. | — |
| Holdings once capped | **Growth 20–30 (target 25), core 15–25 (target 20), total 35–55.** | Statman's 30–40 floor, rising idiosyncratic volatility, Bessembinder's skew, and Best Ideas' finding that alpha decays down the ranking (B §d). |
| Removed reports | **Archive with metadata.** | Deleting recreates survivorship bias, and the archive is how report upside (μ) gets calibrated (D §5). |
| Pins | None. | Owner decision. |

**State today (month-end September 2026): 0 of 3 votes, so risk-on.** The S&P is above its 10-month average, 1-month realized volatility is about 11% and the Baa spread is falling. Two readings to watch: breadth is 39.9%, and the HY spread has widened 0.50 pp over 3 months against a 1.0 pp trigger (E §5).

---

## 1. Why the obvious design fails

The intuitive version is "70/30 growth/core in good times, rotate to 40/60 in bad times". Report E tested exactly that, on four proxy pairs over 1990–2026, split into in-sample and out-of-sample halves:

| Pair (growth / core) | Static 70/30 max drawdown | Best switched blend max drawdown | Sharpe difference |
|---|---|---|---|
| IWO / SPY, 2000–26 | −51.6% | −50.0% | ±0.01 |
| NAESX / VFINX, 1990–26 | −52.8% | −51.5% | 0.00 |
| IWO / QUAL, 2013–26 | −30.3% | −30.3% | +0.01 |

- **The two sleeves fall together.** Report E also tested whether any signal predicts the growth-minus-core spread for the next month. None did: every difference was within 1–2 standard errors of zero.
- **The signals do predict the market as a whole.** Next-month returns for both sleeves were 0.2–0.7%/month lower in risk-off states.
- **So the lever has to change equity exposure, not just the mix of equities.** Report A reaches the same conclusion from the literature. Moving 25 points of growth into core cuts portfolio beta by only about 0.10, worth about 3–4 points in a −35% market. Every large drawdown cut in the literature comes from moving toward cash (Faber; Hurst-Ooi-Pedersen; the jump-model papers).

This is why the overlay below includes a T-bill leg, and why the core sleeve has to be made more defensive.

## 2. The dynamic overlay

### 2.1 Signals (month-end, using only data available at the close)

| Leg | Definition | Evidence | Why this and not an alternative |
|---|---|---|---|
| **Trend** | S&P 500 total-return month-end close below its 10-month simple moving average | Faber 1900–2005: max drawdown −84% → −50% at 0.67 round trips a year. Hurst-Ooi-Pedersen: trend is positive in 8 of the 10 largest 60/40 drawdowns, which average about 15 months, so the lag is tolerable. In report E the leg fired in all 7 drawdowns since 2000, with 2.4 false alarms per decade. | The 9-, 10- and 12-month windows and the 200-day average give identical results (E §3), so there is no parameter to overfit. Daily signals double the false alarms (3.9 per decade) for no gain. |
| **Volatility** | 21-day realized volatility of the S&P 500 in the top quintile of its expanding history (about 20% annualized today) | Bongaerts-Kang-van Dijk's conditional volatility targeting is the one volatility-timing form that survives out of sample. It "consistently enhances Sharpe ratios and reduces drawdowns" with low turnover (A §1). In report E it was fast and clean, with 1.7 false alarms per decade. | Continuous volatility scaling (Moreira-Muir) fails out of sample (Cederburg et al. 2020, 103 strategies) and churned 109–199 switches in report E for no benefit. A quintile threshold adjusts to the volatility of the era, where a fixed 20% would not. |
| **Credit** | 3-month widening in the HY spread (ICE BofA HY OAS, FRED `BAMLH0A0HYM2`) above 1.0 pp. Until enough HY history is logged, use Baa−10y (FRED `BAA10Y`) above 0.40 pp, which mapped to about 1.0 pp of HY over 2023–26. | It has the best economic grounding (Gilchrist-Zakrajšek's excess bond premium) and rarely misfires: 1.2 false alarms per decade (A §6, E §2). | It is usually late (6 of 7 events), so it serves as a confirming vote, never a trigger on its own. FRED only serves 3 years of HY history, so **daily HY logging must start now** (E §1). |

**Context only, never a vote:**
- **The yield curve.** It leads recessions by 1–2 years and missed 3 of 7 drawdowns.
- **VIX above 30 or breadth below 30%.** Next-month returns after these readings were *above* average, because they tend to fire near lows. When they appear alongside a risk-off vote, read them as possible capitulation and get ready to re-risk.
- **VIX term structure.** 8.4 false alarms per decade.
- **Small- vs large-cap relative trend.** No predictive power for the spread.

### 2.2 States and target weights (share of invested capital, after the cash floor)

| Votes | State | Growth | Core | T-bills | Approximate portfolio beta* | Share of time (backtests) |
|---|---|---|---|---|---|---|
| 0 | **Risk-on** | 55% | 45% | 0% | about 1.20 | about 65–70% |
| 1 | **Caution** | 40% | 50% | 10% | about 1.04 | about 10–15% |
| 2–3 | **Defensive** | 25% | 50% | 25% | about 0.83 | about 15–20% |

\*Assumes growth beta 1.4 and hardened-core beta 0.95 (B §c).

**Why these numbers:**
- **The defensive state cuts beta by about 0.37 against risk-on,** about 13 points in a −35% market. That matches report E's measured gain from moving 30 points to T-bills: about 11–12 pp less max drawdown.
- **The time-weighted average is roughly 47/46/7.** That is the strategic split in §0: growth-led by risk, about even by weight. The share-of-time estimates come from report E's 1-vote and 2-of-3 time-in-state figures, so treat them as approximate.
- **Core never drops below 45%.** Its stability is the point of having it. The overlay mainly moves the high-beta sleeve.
- **Graded states instead of one switch.** One leg alone (trend misfires 2.4 times a decade) moves only to Caution, so a false alarm costs about half as much.
  - **Evidence for the 2-of-3 rule:** sending 30 points to T-bills on it cut max drawdown about as much as trend alone on NAESX/VFINX (−42% vs −41%). It did less well on IWO/SPY (−45% vs −40%).
  - **What isn't tested yet:** the graded 3-state version itself. Validation stage 1 (§6) must compare it head to head with trend-only. If trend-only wins in both the in-sample and held-out periods, adopt trend-only with the same weights.

**What the T-bill leg holds:** a T-bill ETF such as SGOV or BIL, or cash sweep. The engine needs a "ballast instrument" path for this, because today a holding without a report freezes as NO_SIGNAL (C §6).

### 2.3 Transition rules (anti-whipsaw)

1. **Evaluate once a month,** at the month-end close. Act at the next scheduled `trade:cron` run. Never act intra-month: the evidence base is monthly, and the daily signals mostly add false alarms.
2. **De-risking takes effect immediately:** at most one state step per month, except that 3 votes at once go straight to Defensive.
3. **Re-risking needs confirmation.** Step up one state only after 2 consecutive month-ends with fewer votes, or after the S&P closes a month back above its 10-month average with fewer than 2 votes (E §5). Never jump from Defensive to Risk-on in one month.
4. **Rebound guard against momentum crashes.** If the S&P's 24-month return is negative when the vote clears, re-risk **core first**: add the T-bill weight back to core for one month before restoring growth. Also re-run the growth admission screen before adding growth weight. Daniel & Moskowitz show winner-style portfolios crash right after bear-market bottoms (−74% in August 1932, −46% in April 2009) as junk rallies. A revenue-acceleration growth sleeve behaves like a winner portfolio (A §3).
5. **Glide limit.** Overlay trades are capped at **10% of NAV per run and 15 points of sleeve weight per month.** The run-level turnover breaker is off in production (C §2), so without this cap a state change would go through the LIVE account in one run.
6. **Dead band.** Skip overlay trades when a sleeve is within ±3 points of its target. Drift inside the band is left alone.

**Expected activity:** 1–2 state changes a year on average, 28–40 switches over 26 years in report E's tests.

### 2.4 How this fits the owner's doctrine (decision required)

`docs/portfolio/01-conceptual-outline.md` §1 and §13.3 say cash is a bottom-up lever, "never a top-down market-timing bet the desk has no edge on". The T-bill leg conflicts with that wording, so **adopting this plan amends the doctrine**. The case for amending it:

- **No return edge is claimed.** The evidence says trend and volatility rules reduce risk reliably but do not reliably add return (Faber's in-sample results; Huang et al. and Zakamulin out of sample — A §2). The overlay is justified on drawdown alone, which is what the owner asked the core sleeve to do ("control downswings").
- **The doctrine's own exception allows it.** `docs/scoreconcepts/10.md` §2 already allows conditional bear-case sizing *as a desk policy, not a model*. A fixed, pre-registered 3-vote rule with no fitted parameters is a desk policy.
- **The alternative, a growth↔core swap only, keeps the doctrine but delivers nothing.** Report E measured it at ±2 pp of drawdown. Keeping it would mean adding complexity and tax drag for no protection.

If the owner declines the amendment, the fallback is **Option B**: keep 100% equity, apply the same states as a growth↔core swap only (55/45 → 35/65), and rely on the hardened core for whatever protection it gives. That is still worth doing, because a genuinely low-beta core does fall less. But the plan should say plainly that the drawdown benefit will be small.

## 3. Sleeve definitions

### 3.1 Growth sleeve (US, $300M–$20B)

| Rule | Entry | Maintenance (about 2/3 of entry) | Evidence |
|---|---|---|---|
| Revenue growth | YoY growth above 15% in each of the last 4 quarters | TTM above 10%, and no quarter below 5% | Growth rarely persists (Chan-Karceski-Lakonishok), so maintenance must be looser or names churn out. |
| Fundamental momentum | Positive revenue or EPS surprise, or acceleration, at the last report | — (used for ranking only) | Jegadeesh-Livnat: strongest in small firms. Earnings momentum subsumes price momentum (Novy-Marx 2015). |
| Cash profitability | TTM operating cash flow above 0 **and** OCF at least net income | TTM OCF above 0 | Sloan accruals; QMJ (B §b). |
| **Profitability floor (new)** | Gross profits/assets in the top half of the screen universe | Top 2/3 | Novy-Marx 2013. Hou-Xue-Zhang: small high-ROE low-investment stocks earn 1.39%/month, against −0.07% for small low-ROE high-investment. |
| **Dilution cap (new)** | Net share growth of 5% or less YoY, including stock comp; no secondary offering or stock-funded M&A in the last 12 months | 7.5% or less | Strongest single fix: Pontiff-Woodgate, Daniel-Titman. Net issuance survives costs in Novy-Marx & Velikov. |
| **Asset-growth guard (new)** | Total-asset growth not in the top decile, unless matched by revenue | — | Cooper-Gulen-Schill; Fama-French: "high investment alone might be the prime problem" for small stocks. |
| Trend | **Risk guard only:** exclude names more than 25% below their 200-day average | — | Price momentum adds little after earnings momentum and brings crash risk (Novy-Marx 2015; Daniel-Moskowitz). It sets queue priority, not admission. |
| Anti-lottery | Exclude the top decile of 1-year idiosyncratic volatility and prices under $5 | — | Fama-French 2016: high-volatility and heavy-issuance stocks share the "junk" profile. |

**Hard exits (one check, no confirmation):**
- revenue growth below 0% YoY;
- net share growth above 10%;
- OCF turning negative together with a going-concern or covenant flag;
- the report's own thesis-break trigger firing.

### 3.2 Core sleeve (US, $50B+), hardened as ballast

| Rule | Entry | Maintenance | Evidence |
|---|---|---|---|
| ROIC | 8-quarter average above 12%, with no single quarter below 8% | 8-quarter average above 9% | QMJ rewards *stability*. A single-quarter miss shouldn't force turnover (B §b). |
| Growth | TTM revenue growth at least 3% | TTM at least 0% | The old "4% every quarter" rule tilts core toward long-duration tech, the 2022 failure mode (B §b). |
| **Beta (new)** | 2-year weekly beta, Blume-shrunk toward 1, of 1.0 or less | 1.15 or less | This is what makes core fall less than growth. Without it the two sleeves are both just equity. Note that the engine's industry-based beta proxy is wrong by up to 1.1 for some names (from the earlier Shibui review). |
| **Leverage (new)** | Net debt/EBITDA of 2.5× or less (excluding financials) | 3.5× or less | QMJ safety leg. Betting-against-beta is weak when funding tightens, so leverage matters most in the stress state (A §4). |
| **Payout (new)** | Net payout (dividends + buybacks − issuance) of 0 or more | — | QMJ payout leg; also the reverse of the growth dilution cap. |
| **Sector cap (new)** | No sector above 35% of the core sleeve by weight | 40% | Stops core turning into mega-cap tech. |
| Price | **Removed from admission.** The single-stock 200-day test moves to queue priority. | — | Market-level trend is handled by the overlay. A per-stock price gate on quality names mostly adds churn. |

### 3.3 Moving between sleeves

- A growth name that passes $20B stays in growth until it passes **$30B**. Then it moves to core only if it meets the core rules; otherwise it leaves at its next maintenance check.
- A core name that falls below $50B stays until it drops below **$35B**.
- These are the same band mechanics used in index construction (D §1), applied to the sleeve boundary so a name doesn't flip sleeves every quarter.

## 4. Watchlist manager mechanics

| Item | Rule | Why |
|---|---|---|
| Admission scan | Weekly, using the Shibui connector through the existing "script prints SQL → agent runs it → raw saved → script parses" pattern | Shibui can't be called from Node (C §3). Weekly cadence catches new 10-Qs without paying for daily scans of slow fundamentals. |
| Maintenance check | Per name, within 7 days of each new 10-Q/10-K | Fundamentals change quarterly (D §4). |
| Soft fail | Two consecutive failed maintenance checks → removal. The first fail puts the name on probation. | D §1. Index providers rely on band width; the 2-check confirmation is extra protection because each report is expensive. |
| Hard fail | Removal on one check (see the hard-exit rules in §3.1) | Without it, names would linger after their edge is gone (D §2). |
| Ranking | priority = screen percentile × P(BUY) × freshness, where freshness halves at about 3 months. Re-screen anything waiting more than 6–8 weeks. | Best Ideas (D §3). |
| Triage gate | Street upside below 10% → a one-page triage note instead of a full report | The owner's own ROC (AUC 0.82). Report D's illustrative estimate cuts the HOLD share from about 45% to about 28%. **Use the gate to save cost, never as an alpha signal**: Street targets overshoot realized returns by about 15% on average (Bradshaw et al. 2013). |
| Add rate | 1–2 names a week. The queue holds no more than 2 weeks of report capacity. | Sized to synthesis throughput. A bigger queue just goes stale. |
| Sleeve balance | Fill whichever sleeve is furthest below its count floor first (growth 20, core 15) | Both sleeves need enough names to diversify before weights mean anything (B §d). |
| Removal by state | **No report:** drop the entry, its `seen.json` entry and its raw data. **Report, not held:** archive. **Held:** never auto-remove; flag it for re-synthesis so a downgrade exits through the normal trade path. | Removal doesn't sell anything (C §1). The only clean exit for a held name is a downgraded report. |
| Archive record | Removal date and reason; last rating and rating history; report μ and Street upside at each rating; P(BUY); screen state at entry and at each failed check; realized returns at 1, 3, 6 and 12 months after removal; re-admission flag; data and screen versions | This makes μ calibration possible (the pipeline audit's biggest risk, S3), lets the triage gate be audited, and lets band width be tuned from re-admission churn (D §5). |
| Entry metadata | `sleeve`, `addedAt`, `source` (manual or screen), `presetsHit`, `status` (active, probation or archived), `failStreak` | These are optional fields. Existing readers (`detect`, `facts-prepare`) ignore them. |

## 5. Engine integration (design only)

1. **Overlay module.**
   - **Inputs:**
     - S&P 500 total-return history from Yahoo, keyless (`lib/prices/yahoo.ts` can already fetch it);
     - FRED CSVs for `BAA10Y` and `BAMLH0A0HYM2`, keyless;
     - a new local history store of at least 260 daily closes.
   - **Output:** `data/regime/<YYYY-MM>.json` with the votes, the state and the target sleeve weights.
   - Everything runs locally, so `trade:cron` can use it without a Claude connector (C §3).
2. **Sizing.**
   - Add a `sleeve` field per name, from the watchlist metadata.
   - In `lib/trade/rebalance.ts:56-71` and `lib/portfolio/sizing.ts:132-141`, call `allocateCapped` once per sleeve, with target = sleeve weight × (1 − cash floor − frozen weight − T-bill weight). Existing per-name (`wMax` 0.10) and sector (0.30) caps apply inside each sleeve.
   - Frozen weight (locked, DEFER_EXIT) counts toward its sleeve's total, so locks are respected, not overridden.
3. **Ballast path.** A whitelisted T-bill ETF is allowed without a report, sized only by the overlay and never frozen as NO_SIGNAL.
4. **Locks are unchanged.** The 5-business-day whole-ticker lock (the employer rule) applies to overlay trades exactly as it does to any other trade. The overlay works around locked weight and never changes lock logic. **Any future change involving locks goes to the owner first.**
5. **Reporting.** `trade-review` shows the state, the votes, the sleeve weights against their targets, and the glide progress.

## 6. Validation before anything goes live

| Stage | What | Pass criteria |
|---|---|---|
| 1. Backtest | Expanding-window backtest on Ken French portfolios from 1963: profitable small-growth vs large high-profitability / low-beta portfolios as sleeve proxies, plus the T-bill leg. Hold out 2015–2025. Compare against static 50/50, a trend-only rule and the 3-state rule. Use 10 bp costs and a one-day delay. | Max drawdown improves by **8 pp or more** against static 50/50. Sharpe is no more than 0.03 worse. Average state changes stay at **2 a year or fewer**. The result holds in both the in-sample and held-out periods. **No threshold tuning**: if it fails, it fails. |
| 2. Screen backtest | The actual admission rules on Shibui history | Treat results as an **upper bound**. Shibui has no delisted names, which overstates small-cap returns by about 5 pp a year. Impute delisting returns between 0% and −100% (Shumway; D §4). |
| 3. Shadow | Compute and log the state every month for 3 months, with no trades | The logged states match a hand check. Start HY OAS logging on day 1. |
| 4. Paper | Alpaca paper runs with the overlay on, for 1–2 months | The glide limit, ballast path and lock interplay behave as designed. |
| 5. Live | Schwab | Owner sign-off. |

## 7. Known failure modes (and what would change the plan)

- **Fast V-shaped crashes** (1987, March 2020) happen inside a month. The rule de-risks late and re-risks late. This is accepted: the evidence base protects against slow bears, which are most of the big drawdowns (Hurst-Ooi-Pedersen: about 15-month average).
- **Rate-driven bears** (2022). Quality underperformed too. The hardened core's beta and leverage caps are the mitigation. If the stage-1 backtest shows core falling about as far as growth in 2022, **lower core's beta cap to 0.9**.
- **Choppy sideways markets.** Trend whipsaws: Faber lagged in about 40% of years. The graded states and confirmation rules limit the cost, but don't remove it.
- **Junk rallies after bottoms.** The rebound guard (§2.3, rule 4) addresses this.
- **Taxes.** The engine has no tax-lot logic (C §4). Each move into T-bills realizes gains. At 1–2 state changes a year this is modest, but it is real. A later phase should trim the highest-cost-basis lots first. **Owner input needed:** is the Schwab account taxable?
- **Overfitting.** Every threshold is a literature default. The 10-month window and the credit band were checked for robustness (E §3), and the volatility quintile adapts on its own. Nothing is tuned to the owner's data.
- **μ is uncalibrated.** Sizing *within* each sleeve still relies on report upside, which hasn't been validated. The overlay is deliberately independent of μ, so it works even if μ is noisy.

## 8. Rollout phases

0. **Clean up drift.**
   - 16 stale `seen.json` entries;
   - orphan folders CC, PAYS, SMCI, AMBQ and KVHI;
   - ASTE, ESOA and LPLA have no report.

   Also classify the current list into sleeves to see today's mix, and start daily HY OAS and S&P logging.
1. **Watchlist manager in proposal-only mode** (4–6 weeks). It writes proposals and the owner reviews them.
2. **Automatic adds** within the 1–2/week limit. Automatic removals only for names without a report.
3. **Validation stages 1–3,** run in parallel with phase 2.
4. **Sleeve-aware sizing and the ballast path,** on Alpaca paper.
5. **Live overlay at Schwab** after sign-off.

## 9. Decisions needed from the owner

1. **The doctrine amendment in §2.4.** Approve the T-bill leg (recommended), or take Option B (equity-only swap, small benefit).
2. **Is the Schwab account taxable?** This decides whether tax-lot-aware trimming moves up in priority.
3. **The T-bill instrument:** SGOV, BIL, or cash sweep.
