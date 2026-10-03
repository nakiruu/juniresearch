# Dynamic growth/core sleeve plan and automated watchlist manager

**Status:** plan only, revision 2. No code is written, and nothing here is in effect until the owner approves it.
**Date:** 2026-10-03.

**Revision 2** follows an adversarial review that re-ran the overlay on report E's data. That review is in [`2026-10-03-sleeve-research/F-critique.md`](2026-10-03-sleeve-research/F-critique.md). The changes from revision 1 are listed in §10.

**Evidence:** five research reports in [`2026-10-03-sleeve-research/`](2026-10-03-sleeve-research/):
- A: academic evidence on regime overlays (32 sources).
- B: evidence on the two sleeves (37 sources).
- C: where the plan plugs into the engine.
- D: watchlist turnover and research throughput (21 sources).
- E: signal data and backtests, 1990–2026.

Report F, the critique, is in the same folder.

**The owner's brief and answers:**
- The brief: "a growth-oriented portfolio with some high-cap moderate-growth names to control downswings".
- (1) The split should be dynamic and change with conditions, based on the research.
- (2) There is no maximum watchlist size; holdings will be capped later.
- (3) Archive rather than delete.
- (4) No names are pinned.

---

## 0. The answer in one page

| Decision | Choice | Main reason |
|---|---|---|
| How the split is stated | **By weight of invested capital, not by name count.** Counts are only a diversification floor. | A growth name carries about 1.5× the volatility of a core name, so counting names misstates risk (B §c). |
| What makes it dynamic | **A two-state rule.** If the S&P 500 total return is above its 10-month average at month-end, use **Risk-on: 55% growth / 45% core / 0% T-bills**. If it is below, use **Defensive: 25% growth / 50% core / 25% T-bills**. | This is the simplest rule that worked. In the critic's re-test it matched or beat a graded 3-signal design on max drawdown, Sharpe and CAGR, in both proxy pairs and both halves, with about 55% of the state changes (F, test tables). |
| What the overlay moves | **Growth weight goes into T-bills, and a little into core.** It is not a pure growth↔core swap. | **This is the central finding.** A pure swap left max drawdown within about ±2 pp of a static mix, around −51% either way, because both sleeves are equities and fall together. The T-bill leg is what cut the drawdown (E §3; confirmed in F). |
| Average split over a cycle | **Roughly 48% growth / 46% core / 6% T-bills.** This falls out of the rule; it is not a separate target. | It is growth-led by risk, as the brief asks. At 55/45, growth carries about two-thirds of portfolio risk. |
| Expected trade-off (stated up front) | **About 7–10 pp less max drawdown in slow bears** (2000–02, 2008). **Almost nothing in V-shaped or choppy markets** (2020, 2015–16). **About 0.2–1.5 pp a year of return given up** against a static mix, before tax. | This is the critic's re-test (F, C3). The overlay is insurance against slow bears, not a return engine. |
| Volatility and credit signals | **Logged and shown as context. Not votes.** | They added at most about 0.5 pp of drawdown benefit and about 75% more state changes. After a credit-spread risk-off signal, next-month returns were *higher* (E diagnostics; F, I3). |
| Core sleeve | **Hardened to work as ballast:** a beta cap, a leverage cap, a sector cap, and stable ROIC rather than "every quarter". | Without it, a $50B+, high-ROIC screen fills with long-duration mega-cap tech that falls with growth. MSCI USA Quality lost 22.7% in 2022, against 19.5% for the market (B §b). |
| Growth sleeve | **Add a dilution cap, a profitability floor, an accruals check and an asset-growth guard.** Price uptrend becomes a risk guard only. | The small-growth corner's poor returns come from firms that are unprofitable, invest heavily and issue shares, not from growth as such (Fama-French 2015; Hou-Xue-Zhang; Novy-Marx 2013 — B §a). |
| Per-name caps | **At most 4% of NAV for a growth name and 6% for a core name.** This replaces the shared 10% `wMax`. | B suggests 2.5% and 5%. A 2.5% cap with about 25 growth names forces near-equal weights and switches off conviction sizing. At 4%, a failed growth name that loses 60% costs about 2.4% of NAV. |
| Watchlist entry and exit | **Maintenance threshold at about 2/3 of the entry threshold,** plus a 2-check confirmation for soft fails. A one-check **hard exit** below 1/2 of entry or on a thesis break. | A buy/hold spread cut turnover by 41% and costs by 42% on average across 23 anomalies (Novy-Marx & Velikov). MSCI, FTSE and Russell all use bands (D §1). |
| Cadence | **Weekly admission scan.** Quarterly maintenance per name after its 10-Q/10-K. Overlay checked monthly. | Matched to how fast each signal decays (D §4; A §2). |
| Additions | **1–2 a week,** ranked by screen percentile × P(BUY) × freshness. Names with Street upside below 10% get a triage note, not a full report. | Research capacity is the binding limit, and alpha is concentrated in top-ranked ideas (D §3). |
| List size | **No cap.** | The owner's answer. The add rate bounds it in practice. |
| Holdings once capped | **Growth 20–30 (target 25). Core 15–25 (target 20).** | Statman, Bessembinder and "Best ideas" (B §d). |
| Removed names | **Archive everything with metadata,** including raw data for names that never got a report. | Deleting recreates survivorship bias. The archive is also how report upside (μ) gets calibrated (D §5). |

**State today (month-end September 2026): Risk-on.** The S&P 500 is above its 10-month average. Context readings:
- 1-month realized volatility is about 11%.
- The Baa spread over 10-year Treasuries is falling.
- The HY spread is up 0.50 pp over 3 months.
- Breadth is 39.9%, so the market is narrow (E §5).

---

## 1. Why the obvious design fails

The intuitive design is "70/30 growth/core in good times, rotate to 40/60 in bad times". Report E tested exactly that on three proxy pairs from 1990 to 2026, with in-sample and out-of-sample halves:

| Pair (growth / core) | Static 70/30 max drawdown | Best switched blend max drawdown |
|---|---|---|
| IWO / SPY, 2000–26 | −51.6% | −50.0% |
| NAESX / VFINX, 1990–26 | −52.8% | −51.5% |
| IWO / QUAL, 2013–26 | −30.3% | −30.3% |

- **Over full samples**, every switched rule landed within about ±2 pp of drawdown and ±0.03 Sharpe of the static mix.
- **In one half-sample (NAESX in-sample)**, several swap variants made the drawdown *worse*, by up to 6 pp.
- **No signal predicted the growth-minus-core return spread.** Every conditional spread was within 1–2 standard errors of zero (E diagnostics).
- **Signals did predict the market as a whole.** Next-month returns for both sleeves were 0.2–0.7%/month lower in risk-off states.

**So the lever has to change equity exposure, not just which equities are held.** Report A reaches the same conclusion from the literature. Moving 25 points from growth to core cuts portfolio beta by only about 0.10, worth about 3–4 pp in a −35% market. Every large drawdown cut in the literature comes from moving toward cash (Faber; Shu-Yu-Mulvey's statistical jump model).

## 2. The dynamic overlay

### 2.1 The rule

| Item | Specification |
|---|---|
| Signal | S&P 500 total-return index (`^SP500TR`) month-end close against the simple average of the last 10 month-end closes. |
| States | **Risk-on** (close ≥ average): growth 55% / core 45% / T-bills 0%. **Defensive** (close < average): growth 25% / core 50% / T-bills 25%. These are shares of NAV after the 1% cash floor. |
| Timing | Evaluate at the month-end close. Start trading at the next scheduled `trade:cron` run. Never act intra-month. |
| Glide | Move at most **15 points of growth weight per month**, so a full switch takes 2 months. This is the only rate limit. |
| Instrument | A T-bill ETF, **SGOV or BIL**, bought through the engine so reconcile sees the fills. A Schwab bank sweep yields well below these (about 4% today), which would cost about 0.25% a year at a 6% average T-bill weight. |

**Why this rule and not something richer:**
- **The plan pre-registered a tie-break, and trend-only won it.** Revision 1 said: "if trend-only wins in both halves, adopt trend-only". It did.
- **Critic's re-test (F, daily simulation, 10 bp costs), full sample:**

  | Rule | IWO/SPY 2000–26: CAGR / max DD / Sharpe / changes per year | NAESX/VFINX 1990–26: same |
  |---|---|---|
  | **Trend-only (this rule)** | 7.39% / −46.8% / 0.38 / 1.5 | 10.45% / −47.3% / 0.52 / 1.4 |
  | Graded 3-state with trend, volatility and credit votes (revision 1) | 7.27% / −46.6% / 0.37 / 2.6 | 10.24% / −47.9% / 0.51 / 2.6 |
  | Static mix at the same average exposure (47/46/7) | 7.30% / −53.4% / 0.36 / 0 | 10.49% / −54.1% / 0.50 / 0 |
  | Static 50/50 | 7.51% / −56.1% / 0.36 / 0 | 10.88% / −57.3% / 0.50 / 0 |

- **The extra machinery measured as nothing.** Volatility quintiles, credit votes, confirmation paths, the rebound guard, dead bands and two glide limits made no measurable difference. With 4 parameters instead of about 12, there is less to overfit and less to break on a LIVE account.

**Evidence base for the trend rule:**
- **Faber, S&P 500 1900–2005 (in-sample):** max drawdown fell from −84% to −50%, at 0.67 round trips a year. The rule lagged buy-and-hold in about 40% of years.
- **Report E (2000–2026):** the 10-month signal fired in all 7 drawdowns, with 2.4 false alarms per decade. A daily 200-day average gave 3.9 false alarms.
- **Shu-Yu-Mulvey's jump model (arXiv:2402.05272):** more sophisticated regime detection also cuts drawdowns out of sample. But it needs a fitted model, and the simple rule captures most of the benefit here.
- **Hurst-Ooi-Pedersen's century of trend evidence:** it concerns diversified long/short futures and transfers only partly to a long-only S&P filter (A §2). It is supporting context, not direct evidence.
- **No return edge is claimed.** Out-of-sample critiques (Huang et al.; Zakamulin) find that trend rules reduce risk but do not reliably add return. That matches the trade-off in §0.

### 2.2 Context signals (shown, never acted on)

| Signal | Why it is only context |
|---|---|
| 1-month realized volatility, VIX | Fast and with few false alarms. As a vote, it added changes but no measurable benefit (F). Continuous volatility scaling fails out of sample (Cederburg et al. 2020, across 103 strategies). |
| HY spread 3-month change (FRED `BAMLH0A0HYM2`), Baa−10y | Next-month returns were *higher* after it fired. As a T-bill trigger it made drawdowns *worse* on IWO/SPY (−53.2% vs −51.6%) (E; F, I3). **Start logging HY daily now.** FRED serves only 3 years of history, so this is cheap insurance for any future re-test. |
| Yield curve | Leads recessions by 1–2 years and missed 3 of 7 drawdowns. |
| Breadth (share of stocks above their 200-day average) | Survivor-biased in Shibui. Context only. |

### 2.3 Safety rules for a LIVE overlay

1. **Stale or missing data holds the last state.** If the S&P history fetch fails, is older than 3 trading days at evaluation, or the month-end run is missed, there is no transition and the owner is alerted.
2. **There is a kill switch and a manual pin.** The `OVERLAY_ENABLED` flag defaults to off, and a manual state pin overrides the signal. With the overlay disabled, the engine runs exactly as it does today.
3. **The owner is notified before any change trades.** A state change triggers a notification before its first trade.
4. **It runs locally only,** on the Unraid runner. It never runs from the cloud (`docs/10022026learning.md` §5).
5. **The turnover breaker stays as the owner set it.** The glide uses its own clipper (§5), never `TURNOVER_BREAKER`, because `clipToTurnover` halts any plan that contains a sell. Three halts would block all LIVE trading during a drawdown (F, C2).
6. **Locks are untouched.** The 5-business-day whole-ticker lock (the employer rule) applies to overlay trades exactly as to any other trade. **Any change involving locks goes to the owner first.**

### 2.4 Doctrine: a plain amendment (owner decision)

`docs/portfolio/01-conceptual-outline.md` §1 says cash is a bottom-up lever, "never a top-down market-timing bet the desk has no edge on".

**Adopting the T-bill leg amends that sentence.** Revision 1 argued that `scoreconcepts/10.md` §2 already allowed it. That was a misreading: 10.md §2 allows raising the bear-case floor for indebted names, which is a name-level valuation input, not a portfolio allocation (F, I1). The honest case:

- **What changes:** cash becomes a rule-based, pre-registered *risk* allocation, not a return bet.
- **This keeps the doctrine's concern:** the evidence supports a risk edge (smaller drawdowns in slow bears), not a return edge. The plan claims no return edge, and it states the cost (§0).
- **It is what the brief asks for:** "control downswings". The research shows this is the only lever among those tested that measurably does that.

**If the owner declines,** the honest fallback is **no overlay**. Hold a static, exposure-chosen mix (for example 55/45), and keep the hardened core and the watchlist manager.

A growth↔core-only swap is *not* recommended as a fallback. It added changes and tax drag with no measurable drawdown benefit (E; F).

### 2.5 The strategic choice: whose split?

Report B recommends a more defensive base: **core 60 / growth 40**, with growth moving within 25–55. It calls 50/50 "the most defensible growth-heavy ceiling", on risk-balance grounds (the inverse-volatility point is about 39% growth).

This plan's Risk-on 55/45 sits above that ceiling. The reason is that the owner's brief is explicitly growth-oriented, and the overlay supplies the drawdown control that B's lower base would otherwise provide.

**The owner chooses:**

| Option | Risk-on | Defensive | Average | Character |
|---|---|---|---|---|
| **A (recommended for the stated brief)** | 55 / 45 / 0 | 25 / 50 / 25 | about 48 / 46 / 6 | Growth-led. Risk-on volatility about 20% in B's §c model. |
| **B (report B's base)** | 40 / 60 / 0 | 20 / 55 / 25 | about 36 / 59 / 5 (estimated, not backtested) | Balanced risk. Risk-on volatility about 18.6% in B's model. |

## 3. Sleeve definitions

### 3.1 Growth sleeve (US, $300M–$20B)

| Rule | Entry | Maintenance (about 2/3 of entry) | Evidence |
|---|---|---|---|
| Revenue growth | Above 15% year-on-year in each of the last 4 quarters | TTM above 10%, and no quarter below 5% | Growth rarely persists (Chan-Karceski-Lakonishok). A looser maintenance threshold avoids churn. |
| Fundamental momentum | Positive revenue or EPS surprise, or acceleration, at the last report | Used for ranking only | Jegadeesh-Livnat: strongest in small firms. Earnings momentum subsumes price momentum (Novy-Marx 2015). |
| Cash profitability | TTM operating cash flow (OCF) above 0 **and** OCF ≥ net income | TTM OCF above 0 | Sloan accruals; quality-minus-junk (B §b). |
| **Profitability floor (new)** | Gross profits/assets in the top half of the screen universe | Top 2/3 | Novy-Marx 2013. Hou-Xue-Zhang: small, high-ROE, low-investment firms earn 1.39%/month, against −0.07% for small, low-ROE, high-investment firms. |
| **Dilution cap (new)** | Net share growth ≤5% year-on-year, including stock-based pay. No secondary offering or stock-funded M&A in the last 12 months. | ≤7.5% | The strongest single fix (Pontiff-Woodgate; Daniel-Titman). Net issuance survives costs (Novy-Marx & Velikov). |
| **Asset-growth guard (new)** | Total-asset growth not in the top decile, unless matched by revenue | — | Cooper-Gulen-Schill. Fama-French: for small stocks, "high investment alone might be the prime problem". |
| Price trend | **Risk guard only:** exclude names more than 25% below their 200-day average | — | Price momentum adds little once earnings momentum is counted, and it carries crash risk after market bottoms (Novy-Marx 2015; Daniel-Moskowitz). |
| Anti-lottery | Exclude the top decile of 1-year idiosyncratic volatility, and prices under $5 | — | Fama-French 2016: these stocks share the "junk" profile. |

**Hard exits (one check, no confirmation):**
- revenue growth below 0% year-on-year;
- net share growth above 10%;
- negative OCF together with a going-concern or covenant flag;
- the report's thesis-break trigger.

### 3.2 Core sleeve (US, $50B+), hardened as ballast

| Rule | Entry | Maintenance | Evidence |
|---|---|---|---|
| ROIC | 8-quarter average above 12%, with no quarter below 8% | 8-quarter average above 9% | Quality-minus-junk rewards stability (B §b). |
| Growth | TTM revenue growth ≥3% | TTM ≥0% | "4% every quarter" tilts core toward long-duration tech, which was the 2022 failure mode. |
| **Beta (new)** | 2-year weekly beta, Blume-shrunk, ≤1.0 | ≤1.15 | This makes core fall less than growth. The engine's industry-based beta proxy is off by up to about 1.1 for some names. MSCI USA Quality's beta is about 0.93 *before* this cap, so the hardened core should come in at about 0.85–0.9. |
| **Leverage (new)** | Net debt/EBITDA ≤2.5× (financials excluded) | ≤3.5× | The safety leg of quality-minus-junk. Low-beta stocks suffer when funding tightens (A §4). |
| **Payout (new)** | Net payout (dividends + buybacks − issuance) ≥0 | — | Payout leg of quality-minus-junk. |
| **Sector cap (new)** | No sector above 35% of core weight | 40% | Stops core turning into a mega-cap-tech basket. |
| Price | **Removed from admission.** The single-stock 200-day test moves to queue priority. | — | Market trend is handled by the overlay. |

### 3.3 Sleeve boundaries and unassigned names

- **Migration bands:**
  - A growth name stays growth until it passes **$30B**. It then moves to core only if it passes the core rules; otherwise it leaves at its next maintenance check.
  - A core name stays core until it falls below **$35B**.
- **Unassigned names:** a covered name above $20B that was never in growth, or a name above $50B that fails the core rules, is **core-eligible only if it passes the core rules**. Otherwise it is **not sleeve-eligible**. It keeps its report and is archived at its next check. It is never forced into a sleeve.
- **Unfilled sleeve weight:** if a sleeve lacks enough eligible BUY names, its unfilled weight goes first to the other sleeve, up to that sleeve's own target plus 10 points. Anything left goes to T-bills. Total T-bills, including the overlay leg, are reported against the existing `cashCeiling` of 0.35.

## 4. Watchlist manager mechanics

| Item | Rule | Why |
|---|---|---|
| Admission scan | Weekly, using the Shibui connector through the existing pattern: a script prints SQL, an agent runs it, the raw output is saved, and a script parses it. | Shibui cannot be called from Node (C §3). |
| Maintenance check | Per name, within 7 days of each new 10-Q or 10-K | Fundamentals change quarterly (D §4). |
| Soft fail | 2 consecutive failed checks → removal. The first fail puts the name on probation. | D §1. Reports are expensive, so the extra confirmation is worth having. |
| Hard fail | Removal on one check (see §3.1) | Stops names lingering after their edge is gone (D §2). |
| Ranking | Priority = screen percentile × P(BUY) × freshness. Freshness halves at about 3 months. Re-screen anything waiting more than 6–8 weeks. | "Best ideas" (D §3). |
| Triage gate | Street upside below 10% → a one-page triage note | The owner's ROC (AUC 0.82). An illustrative cut takes the HOLD share from about 45% to about 28%. **Use it to save cost, never as an alpha signal:** Street targets miss realized prices by about 45% on average (Bradshaw et al. 2013). |
| Add rate | 1–2 names a week. The queue holds at most 2 weeks of report capacity. | Sized to synthesis throughput. |
| Sleeve balance | Fill the sleeve furthest below its count floor (growth 20, core 15) first | Both sleeves need enough names to diversify (B §d). |
| Removal by state | **No report:** move the entry, its `seen.json` keys and its raw data to the archive. **Report, not held:** archive. **Held:** never auto-removed. Flag it for re-synthesis, so a downgrade exits through the normal trade path. | Removing a name from the watchlist does not sell it (C §1). |
| Archive record | Removal date and reason; last rating and rating history; report μ and Street upside at each rating; P(BUY); screen state at entry and at each failed check; realized returns at 1, 3, 6 and 12 months; a re-admission flag; data and screen versions. | Calibrates μ, audits the triage gate, and tunes band width (D §5). |
| Entry metadata | Optional fields: `sleeve`, `addedAt`, `source`, `presetsHit`, `status`, `failStreak` | Existing readers ignore them. |

## 5. Engine integration (design only)

These corrections come from the critique (F, C2 and I5):

1. **Per-sleeve target.** target_s = w_s × (1 − cashFloor) − frozen_s.
   - frozen_s is the locked or deferred weight *in that sleeve only*.
   - The T-bill weight is **not** subtracted again; the state weights already sum to 100% including T-bills.
   - Call `allocateCapped` once per sleeve, in `lib/trade/rebalance.ts:56-71` and `lib/portfolio/sizing.ts:132-146`. Each call uses that sleeve's `wMax` (4% growth, 6% core).
2. **Global sector pass.** After the per-sleeve calls, apply the 30% `sectorMax` across **both sleeves combined**.
   - Without this pass, one sector could reach 60% of NAV, because the cap is applied separately inside each call.
   - Freed weight is re-filled within the same sleeve.
3. **Sleeve-level band.** A sleeve shift spread across about 25 names is about 0.6 pp per name, which is below the 2.5 pp per-name `tradeBand`. Nothing would trade, and the T-bill buy would be scaled to zero (`rebalance.ts:92-125`).
   - Fix: when a sleeve's overlay target moves by 2 points or more, every name in the sleeve is rescaled and is **exempt from the per-name band** for that run.
   - At all other times the 2.5 pp band applies as today.
4. **A glide clipper that can sell.** It moves sleeve targets along the 15-points-a-month path and caps overlay gross trades at **10% of NAV per run**.
   - It is a new function and never halts.
   - It is separate from `clipToTurnover`, which halts any plan containing a sell.
5. **Ballast classification.** A whitelisted T-bill ETF gets its own class in `emitTrades`. It is sized only by the overlay and is never frozen as NO_SIGNAL.
   - Today a held ETF without a report counts toward `frozenWeight` (`rebalance.ts:47-51`). It would then be deducted twice if the ballast path were only half built.
6. **Inputs.**
   - `^SP500TR` history from Yahoo (`lib/prices/yahoo.ts`, no key needed), kept in a new local store of 260 or more daily closes.
   - FRED CSVs for the context signals.
   - All local, so `trade:cron` needs no Claude connector.
7. **Output and reporting.** `data/regime/<YYYY-MM>.json` holds the state, the signal and the context readings. `trade-review` shows the state, sleeve weights against their targets, and glide progress.
8. **Unit tests before Alpaca paper:**
   - band exemption;
   - per-sleeve target arithmetic;
   - the sell-capable clipper;
   - ballast classification;
   - the global sector pass;
   - stale-data hold.

## 6. Validation before anything goes live

| Stage | What | Pass criteria (pre-registered; no tuning) |
|---|---|---|
| 1. Backtest | Expanding-window backtest on Ken French portfolios from 1963. Proxies: profitable small growth vs large high-profitability low-beta stocks, plus T-bills. Hold out 2015–2025. Use 10 bp costs and a 1-day delay. Run with and without taxes. Re-run the 9-, 10- and 12-month window sensitivity **on the T-bill version**. | **The benchmark is a static mix at the same average exposure, not 50/50.** Rule against benchmark: <br>• **Mean of the 5 worst drawdowns improves by ≥5 pp.** <br>• **Monthly 5% CVaR and the Ulcer index both improve.** <br>• **CAGR give-up ≤0.5 pp a year.** <br>• **≤2 state changes a year.** <br>• Holds in both halves. <br>A single max drawdown is not used as the gate, because each half contains only one or two bears. |
| 2. Screen backtest | The admission rules on Shibui history | Treated as an **upper bound.** Survivorship overstates small-cap results by about 5 pp a year. Impute delisting returns across 0% to −100% (D §4). |
| 3. Shadow | Compute and log the state monthly for 3 months, with no trades | The logged states match a hand check. |
| 4. Paper | Alpaca paper with the overlay on, for 1–2 months | The glide, band exemption, ballast path, sector pass and lock interplay behave as designed. |
| 5. Live | Schwab | Owner sign-off. |

**Already known from F's re-test on ETF proxies:** trend-only against the same-exposure static mix improved max drawdown by 6.6 pp (IWO/SPY) and 6.8 pp (NAESX/VFINX), with CAGR within ±0.1 pp. Its weakest half was the IWO/SPY out-of-sample half, at +3.1 pp, where the only bear was the V-shaped 2020 crash. That is why the gate uses multi-episode measures.

## 7. Known failure modes

- **Fast V-shaped crashes** (1987, March 2020). The rule de-risks late and re-risks late; the 2020 benefit in F's re-test was only about 3 pp. This is accepted: the rule targets slow bears.
- **Choppy markets.** The rule whipsaws; Faber's version lagged in about 40% of years. Expect several small losing round trips per decade, and a deeper drawdown in 2015–16 (−1.1 pp in F).
- **Rate-driven bears** (2022). Quality stocks fell too. The mitigation is the hardened core's beta and leverage caps. If stage 1 shows core falling as far as growth in 2022, lower the core beta cap to 0.9.
- **Taxes and wash sales.** The engine has no tax-lot logic (C §4). A de-risk at one month-end followed by a re-risk at the next can rebuy loss lots within 30 days, which triggers the wash-sale rule. The 5-day employer lock does not prevent this.
  - **Owner input is needed: is the Schwab account taxable?**
  - If it is: run stage 1 after tax, and consider a separate 30-day wash-sale check on loss lots. That check would sit alongside the employer lock logic, not change it, and it needs owner sign-off.
- **μ is uncalibrated.** Sizing within each sleeve still relies on report upside. The overlay is deliberately independent of μ.

## 8. Rollout phases

0. **Clean up drift:**
   - 16 stale `seen.json` entries;
   - orphan folders CC, PAYS, SMCI, AMBQ and KVHI, which are archived, not deleted;
   - ASTE, ESOA and LPLA, which have no report.

   Also classify the current list into sleeves to see today's mix, and start daily logging of `^SP500TR` and HY OAS.
1. **Run the watchlist manager in proposal-only mode.** It **stays proposal-only until validation stage 2 has reported.** `trade:cron` already ENTERs any fresh BUY, so automatic adds would put untested admission rules in front of the LIVE book (F, I7).
2. **Automatic adds** within the 1–2-a-week limit. Automatic removals only for names without a report.
3. **Validation stages 1–3,** with the overlay off (`OVERLAY_ENABLED` false).
4. **Sleeve-aware sizing, the ballast path and the overlay** on Alpaca paper.
5. **Live overlay at Schwab** after sign-off.

## 9. Decisions needed from the owner

1. **Doctrine (§2.4):** amend the cash sentence to allow the rule-based T-bill leg (recommended), or decline it and run no overlay.
2. **Strategic option (§2.5):** A, growth-led 55/45 ↔ 25/50/25 (recommended for the stated brief), or B, report B's balanced 40/60 ↔ 20/55/25.
3. **Is the Schwab account taxable?**
4. **T-bill instrument:** SGOV or BIL. The cash sweep is not recommended.

## 10. Changes from revision 1

**Overlay:**
- The graded 3-state, 3-vote overlay is replaced by a two-state trend rule. The plan's own tie-break selected it (F, C1).
- Volatility and credit are demoted to context. The credit signal's adverse diagnostics are now disclosed (F, I3).
- The rebound guard, confirmation paths, dead band and second glide limit are removed; none measured as useful.

**Engine:**
- The sizing formula is fixed: no double subtraction of T-bills, and frozen weight is per sleeve.
- Added a sleeve-level band exemption, a sell-capable glide clipper, ballast classification, a global sector pass, rules for unassigned names, and per-sleeve name caps (F, C2 and I2/I5).

**Validation:**
- The gate is now against a same-exposure benchmark, uses multi-episode metrics and has an explicit return-cost budget (F, C3).
- The expected trade-off is stated in §0.

**Doctrine:** the argument now stands as a plain amendment. The misread "exception" and the misattributed section are removed, and the fallback is "no overlay" (F, I1).

**Strategic split:** report B's 40/60 is shown as an explicit option (F, I2).

**Rollout and safety:**
- Added the kill switch, stale-data hold, notification before trading, and local-only running (F, I6).
- The watchlist manager stays proposal-only until the screen backtest (F, I7).
- Wash-sale risk is stated (F, I8).
- Raw data for names without a report is archived, not deleted.

**Corrections:**
- Switch counts, the "every test" claim and the Hurst-Ooi-Pedersen applicability are corrected.
- The robustness claim is limited to what was tested (F, I4/I9).
