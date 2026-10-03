# Research D: Watchlist turnover, hysteresis, signal decay and funnel economics

Prepared 2026-10-03. Research only; no repo changes.

Verification standard: every source in section (a) was fetched during this session, and the claim attributed to it was read in the fetched text (abstract page, methodology PDF or working-paper PDF). Where only bibliographic data could be confirmed, the entry says so. Numbers marked **[illustrative]** are worked examples, not findings from the literature.

---

## (a) Annotated bibliography (verified)

### A. Hysteresis, buffers and banding

1. **Novy-Marx, R. & Velikov, M. (2016). "A Taxonomy of Anomalies and Their Trading Costs." *Review of Financial Studies* 29(1).** NBER WP 20721: https://www.nber.org/papers/w20721 (full PDF: https://www.nber.org/system/files/working_papers/w20721/w20721.pdf)
   - Abstract: "Introducing a buy/hold spread, which allows investors to continue to hold stocks that they would not actively trade into, is the single most effective simple cost mitigation strategy."
   - Section 5.3 defines an "sS" rule from Arrow et al. inventory theory. Under the "10%/20%" rule a stock is bought only when it enters the top 10%, and it is sold only when it leaves the top 20%. In percentile terms the hold zone is twice as wide as the entry zone.
   - The rationale they give is that there is "not much of a difference in expected returns between stocks in the 75-80% range … and those in the 80-85% range". Selling a name that drifts just below the cutoff throws away a close substitute.
   - Results across 23 anomalies: turnover falls 41% and trading costs fall 42% on average, while gross returns fall only slightly, so net returns rise. Figure 5 (momentum) shows that as the sS spread widens, cost savings grow faster than gross-spread losses, so net Sharpe rises. Combining all mitigation techniques (60% turnover cut) "generally do[es] not improve on the single mitigation technique of the buy/hold spread."
   - Table 3 also serves as decay evidence (see B). Monthly one-sided turnover is 1.96% for gross profitability, 22% for ROE, 34.5% for 12-1 momentum and about 35% for PEAD (SUE).

2. **DeMiguel, V., Martín-Utrera, A., Nogales, F. J. & Uppal, R. (2020). "A Transaction-Cost Perspective on the Multitude of Firm Characteristics." *RFS* 33(5): 2180–2222.** https://ideas.repec.org/a/oup/rfinst/v33y2020i5p2180-2222..html
   - Transaction costs raise the number of jointly significant characteristics from 6 to 15, because "the trades in the underlying stocks required to rebalance different characteristics often cancel out."
   - Relevance: a multi-preset composite (the "≥2 presets" rule) is naturally lower-turnover than any single preset. That supports admitting on a combined score rather than on one screen.

3. **Gârleanu, N. & Pedersen, L. H. (2013). "Dynamic Trading with Predictable Returns and Transaction Costs." *Journal of Finance* 68(6).** NBER WP 15205: https://www.nber.org/papers/w15205
   - The optimal policy is to "aim in front of the target" and "trade partially towards the current aim". "Predictors with slower mean reversion (alpha decay) get more weight."
   - Relevance: when acting is costly (here the cost is a research report), slow-decaying signals (quality) should drive membership more than fast-decaying ones (momentum, earnings surprise).

4. **Ma, C. & Smith, P. (2025). "On the Effect of Alpha Decay and Transaction Costs on the Multi-period Optimal Trading Strategy." arXiv:2502.04284.** https://arxiv.org/abs/2502.04284
   - Uses an MDP formulation in which signals decay and trading is costly. It shows that maximizing each period's reward myopically is suboptimal when "frequent trading results in consistent negative cash outflows".
   - This is theoretical support for inaction regions, which is what a band is.

5. **MSCI (Dec 2022). *MSCI Global Investable Market Indexes Methodology*, §3.1.5.1 and §3.1.6.2.** https://www.msci.com/eqb/methodology/meth_docs/MSCI_GIMIMethodology_Dec2022.pdf
   - Buffer zones are used "to … help control index turnover". At semi-annual reviews the buffers are "2/3rd of and 1.5 times the Market Size-Segment Cutoff" (shown as −33% / +50%). At quarterly reviews the buffers are wider: "one half of and 1.8 times".
   - Existing constituents may stay if they fail investability thresholds "but still meet 2/3rd of the threshold."
   - A Small Cap Entry Buffer admits newcomers "only to the extent that they replace current constituents" that fell out. This is a capacity-constrained admission rule.
   - **Takeaway:** maintenance threshold = 2/3 of the entry threshold. Use a wider band at the more frequent (quarterly) check than at the main review.

6. **FTSE Russell (Aug 2026). *Russell US Equity Indexes Construction and Methodology* v7.2, §6.10 and §8.8.** https://www.lseg.com/content/dam/ftse-russell/en_us/documents/ground-rules/russell-us-indexes-construction-and-methodology.pdf
   - Incumbents stay in their index if they are within a cumulative-market-cap band of ±2.5% around the #200, #500 and #1000 breakpoints (±0.5% at #2000).
   - Style banding: if a company's composite value score moves ≤ ±0.10, its score is frozen, which "has proved to reduce turnover caused by smaller, less meaningful movements while continuing to allow the larger, more meaningful changes."
   - Companion history: *Four Decades of Russell Reconstitution* (https://www.lseg.com/content/dam/ftse-russell/en_us/documents/research/four-decades-russell-reconstitution.pdf) records that banding was introduced in 2007 to reduce "unnecessary index turnover".

7. **FTSE Russell (Sep 2026). *FTSE UK Index Series Ground Rules* v17.3.** https://www.lseg.com.cn/content/dam/ftse-russell/en_us/documents/ground-rules/ftse-uk-index-series-ground-rules.pdf
   - FTSE 100: a company is inserted if it has "Risen to 90th or above" and deleted if it has "Fallen to 111th or below". FTSE 250 uses 325th and 376th. Reviews are quarterly.
   - This is a rank band of roughly ±10% of the list size, decided on a single review with no multi-quarter confirmation.

### B. Signal decay and holding periods

8. **Jegadeesh, N. & Titman, S. (1993). "Returns to Buying Winners and Selling Losers." *JF* 48(1): 65–91.** https://ideas.repec.org/a/bla/jfinan/v48y1993i1p65-91.html
   - Momentum earns significant returns "over three- to twelve-month holding periods", but "part of the abnormal returns generated in the first year after portfolio formation dissipates in the following two years."

9. **Jegadeesh, N. & Titman, S. (2001). "Profitability of Momentum Strategies: An Evaluation of Alternative Explanations." *JF* 56(2).** NBER WP 7159: https://www.nber.org/papers/w7159
   - "Significant return reversals 4 to 5 years after the formation date," but none in years 2–3. Momentum alpha is a 12-month phenomenon at most.

10. **Chan, L. K. C., Jegadeesh, N. & Lakonishok, J. (1996). "Momentum Strategies." *JF*.** NBER WP 5375: https://ideas.repec.org/p/nbr/nberwo/5375.html
    - "Past return and past earnings surprise each predict large drifts in future returns after controlling for the other." Analysts' forecasts "respond sluggishly". This is evidence of a gradual-information market, and it means earnings momentum and price momentum are distinct signals.

11. **Jegadeesh, N. & Livnat, J. (2006). "Revenue Surprises and Stock Returns." *Journal of Accounting and Economics* 41(1–2): 147–171.** Bibliographic record: https://ideas.repec.org/a/eee/jaecon/v41y2006i1-2p147-171.html; author PDF: https://pages.stern.nyu.edu/~jlivnat/JAE%20submission.pdf
    - Revenue surprises (SURGE) predict post-announcement abnormal returns after controlling for earnings surprises. Over six months the high-SURGE group earns +1.82% and the low-SURGE group −2.63%. "The post-announcement drift generally tapers off after six months." Analysts take "at least five or six months" to incorporate revenue news.
    - This is the closest evidence for the "revenue acceleration" preset: roughly a two-quarter half-life of usefulness.

12. **Bernard, V. L. & Thomas, J. K. (1989). "Post-Earnings-Announcement Drift: Delayed Price Response or Risk Premium?" *Journal of Accounting Research* 27: 1–36.** https://ideas.repec.org/a/bla/joares/v27y1989ip1-36.html
    - Only the bibliographic record was confirmed; no abstract text could be fetched. It is cited as the canonical PEAD source. The drift-length claim in this report rests on items 1 and 11, not on this entry.

13. **Asness, C., Frazzini, A. & Pedersen, L. H. (2019). "Quality Minus Junk." *Review of Accounting Studies* 24(1).** https://research.cbs.dk/en/publications/quality-minus-junk-2/
    - High-quality stocks (profitable, growing, safe) earn significant risk-adjusted returns in the US and 24 other countries. "A low price of quality predicts a high future return of QMJ."
    - Quality's slow decay is not claimed in the abstract. The evidence for it is item 1's turnover table: gross profitability turns over about 2% a month, so it is effectively annual.

### C. Concentrating research on top-ranked ideas

14. **Cohen, R., Polk, C. & Silli, B. (2008/2010). "Best Ideas." LSE FMG DP 624.** https://researchonline.lse.ac.uk/id/eprint/24471/1/Best%20ideas(published).pdf (NBER conference version: https://conference.nber.org/confer/2008/bff08/polk.pdf)
    - A manager's highest-conviction stock outperforms the market and the rest of the portfolio "by approximately 39 to 127 basis points per month depending on the benchmark."
    - Figure 3: alpha estimates "monotonically decline as we move down manager's rankings." Industry structure pushes managers to add stocks "that are not outperformers."
    - **Implication:** spend scarce research capacity on the top of the ranked queue, and do not dilute it by over-admitting.

15. **Bradshaw, M. T., Brown, L. D. & Huang, K. (2013). "Do Sell-Side Analysts Exhibit Differential Target Price Forecasting Ability?" *Review of Accounting Studies* 18(4).** https://ideas.repec.org/a/spr/reaccs/v18y2013i4d10.1007_s11142-012-9216-5.html
    - 12-month target-implied returns exceed realized returns by 15% on average. Absolute errors average 45%. Only 38% of targets are met at 12 months (64% at some point within the horizon).
    - **Implication:** Street upside predicts your report's rating well (AUC 0.82), but it is a noisy return predictor. Use it as a cost filter, not as an alpha signal. It is also the reason to archive and calibrate your own upside numbers (see E).

### D. Survivorship and delisting bias

16. **Shumway, T. (1997). "The Delisting Bias in CRSP Data." *JF* 52(1): 327–340.** https://scholarsarchive.byu.edu/facpub/9278/
    - Delistings for bankruptcy and other negative reasons "are generally surprises". Correct delisting returns are missing for most of them, and "the omitted delisting returns are large."
    - The commonly used −30% imputation for NYSE/AMEX performance delistings is widely attributed to this paper. I could not confirm the exact figure in the fetched abstract, so treat it as convention.

17. **Shumway, T. & Warther, V. A. (1999). "The Delisting Bias in CRSP's Nasdaq Data and Its Implications for the Size Effect." *JF* 54(6).** https://ideas.repec.org/a/bla/jfinan/v54y1999i6p2361-2379.html
    - Missing Nasdaq delisting returns "are large and negative on average". The authors impute **−55%** for performance-related delistings. After the correction, there is no Nasdaq size effect.
    - This is directly relevant to the small/mid growth sleeve.

18. **Beaver, W., McNichols, M. & Price, R. (2007). "Delisting Returns and Their Effect on Accounting-Based Market Anomalies." *JAE* 43(2–3): 341–368.** https://ideas.repec.org/a/eee/jaecon/v43y2007i2-3p341-368.html
    - Bibliographic record confirmed (no abstract on the page). It is the standard reference for merging delisting returns into accounting-anomaly backtests.

19. **Harris, J., Panchapagesan, V. & Werner, I. (2008). "Off but Not Gone: A Study of Nasdaq Delistings." Dice Center WP 2008-06.** https://files.fisher.osu.edu/department-finance/public/2008-06.pdf
    - Studies what happens to stocks after Nasdaq delisting, building on Shumway (1997) and Shumway & Warther (1999). Cited for context only.

20. **Brown, S., Goetzmann, W., Ibbotson, R. & Ross, S. (1992). "Survivorship Bias in Performance Studies." *RFS* 5(4): 553–580.** https://ideas.repec.org/a/oup/rfinst/v5y1992i4p553-80.html
    - Truncating a sample by survival creates spurious predictability. In this context, a screen backtested only on survivors will look predictive partly because of that truncation.

21. **Ranse, H. S. (2026). "Survivorship Bias in Emerging Market Small-Cap Indices: Evidence from India's NIFTY Smallcap 250." arXiv:2603.19380.** https://arxiv.org/abs/2603.19380
    - Backtesting on survivors only overstates annual returns by **4.94 pp (23.3%)** and Sharpe by 0.097. This is a recent order-of-magnitude estimate for a small-cap universe. It is a single-author preprint, so weight it accordingly.

---

## (b) Recommendations

### 1. Entry/exit hysteresis

**Verdict on the planned design.** A looser maintenance threshold is well supported: it is the core of every index provider's rules and of Novy-Marx & Velikov's most effective cost fix. The 2-quarter confirmation is *not* standard practice. MSCI, FTSE and Russell all decide on one review and get their hysteresis from band width alone. Band plus confirmation stacks two delays, which matters for the growth sleeve, where signals decay in about 6 months. Keep the confirmation, but scope it as follows.

| Parameter | Recommendation | Justification |
|---|---|---|
| Entry rule | Pass ≥2 presets at **entry** thresholds, **and** composite rank in the top ~10% of the sleeve universe | NMV 10% buy threshold. A multi-signal composite has inherently lower turnover (DeMiguel et al.). |
| Maintenance band, ratio form | For "higher-is-better" ratio criteria, maintenance threshold = **2/3 × entry threshold**. For "lower-is-better" criteria (e.g. leverage, valuation), use **1.5 × entry**. | MSCI SAIR buffers (2/3 and 1.5×) and MSCI's 2/3 rule for existing constituents. |
| Maintenance band, rank form | Stay while the composite is in the **top ~20%**, i.e. a hold zone about 2× the entry zone in percentile terms. For a capped list, enter at rank ≤ 0.9N and exit at rank ≥ 1.1N. | NMV 10%/20%. FTSE 100 uses 90/111. |
| Maintenance preset count | Stay while passing **≥1 preset** at maintenance thresholds (entry requires 2) | This is preset-count hysteresis, consistent with the sS logic. |
| Confirmation (soft fail) | **2 consecutive failed checks** at the maintenance threshold before removal | Acceptable once the band exists, because a report is expensive to redo if the name re-enters. Keep it. |
| Hard-exit floor (new) | Remove on **one** check if the name falls below **1/2 × entry** (ratio form) or the bottom 50% by rank, or on a thesis-breaking event (going-concern doubt, delisting notice, M&A target) | MSCI's quarterly buffer is set at 1/2 and 1.8× entry. This stops a decayed name from lingering 6+ months. |
| Optimal width | No universal optimum. NMV show net performance keeps improving as the sS spread widens over the range they test, until the hold zone dilutes exposure. Because a report costs much more than a trade, **lean wide**: a 2× hold zone, or 2/3 of the entry threshold. Tune it on your own archive (see 5) by measuring how often a removed name gets re-admitted within 4 quarters. If more than ~20% are re-admitted [illustrative target], the band is too narrow. | NMV §5.3 and Fig. 5; index-provider practice clusters at −33%/+50% and about ±10% rank. |

### 2. Check cadence and expected residency (signal decay)

| Signal / preset | Decay evidence | Admission check | Removal check | Expected residency |
|---|---|---|---|---|
| Revenue acceleration / revenue surprise | Drift tapers after about 6 months (Jegadeesh & Livnat) | **Event-driven**: re-score within a week of each 10-Q/10-K | At each subsequent filing (effectively quarterly) | 2–3 quarters unless the signal renews |
| Earnings momentum / PEAD | ~35%/month turnover (NMV). Drift is distinct from price momentum (CJL 1996). | Event-driven, on filing/announcement | Quarterly (post-filing) | 2–3 quarters |
| Price momentum | 3–12 month horizon; partial reversal in years 2–5 (JT 1993/2001); ~35%/month turnover | Weekly scan acceptable | Monthly is the natural cadence. If momentum is only a supporting preset, quarterly is fine. | ≤ 4 quarters |
| Quality (profitability, safety) | ~2%/month turnover for gross profitability, effectively annual (NMV); QMJ robust | Weekly scan for new candidates is fine | **Quarterly check, semi-annual decision** (like MSCI's SAIR versus its wider QIR band) | 4–8+ quarters |

Operationally:
- Run a **weekly** admission scan that picks up new filings.
- Run the **removal** test per name after each new filing, so it is quarterly per name but staggered.
- Core-quality removals should need the 2-fail confirmation. Growth-sleeve removals should rely more on the hard floor, because their alpha horizon is about two quarters.
- Following Gârleanu-Pedersen, weight the slow-decaying quality presets more heavily in the *maintenance* decision and the fast-decaying ones more heavily in *admission* timing (catch them fresh).

### 3. Funnel economics: add rate, queue and waste reduction

**Size the list with Little's law: list size L = add rate λ × average residency W.** "No maximum size" combined with a positive net add rate means the list grows without bound, and the report backlog grows with it. Set a **soft cap per sleeve** sized to the eventual holdings limit. A reasonable starting point is about 2× the intended positions per sleeve [illustrative], since roughly half of reports are BUY.

When a sleeve is full, a newcomer is admitted only if it **beats the weakest incumbent by a margin**. This is the analog of MSCI's Small Cap Entry Buffer ("only to the extent that they replace current constituents") and of FTSE's 90/111 rank band.

**Weekly add rate.** λ ≤ (weekly report capacity − refresh load) × (1 − expected HOLD rate)⁻¹ is the upper bound if only BUYs are meant to occupy slots. In steady state, λ ≈ L / W.

Worked example [illustrative]:
- Two sleeves of 20 names each, so L = 40.
- Blended residency of about 3 quarters, so W ≈ 39 weeks.
- That gives λ ≈ 1 net add per week.
- With a 45% HOLD rate, that needs about 1.8 reports per week for new names.

**Recommendation: 1–2 adds per week in steady state.** During the initial build, use the full report capacity, but cap the queue (work in progress) at about 2 weeks of capacity.

**Queue prioritization rule.** Score each candidate as:

priority = composite screen percentile × P(BUY) × freshness

- **Composite screen percentile:** number of presets passed and margin over the thresholds. Best Ideas shows that alpha concentrates in, and declines monotonically down, the ranking.
- **P(BUY):** taken from the owner's calibration model, with Street upside as the main input.
- **Freshness:** decays with days since the triggering filing, over a horizon of about 6 months (Jegadeesh & Livnat), so a revenue-acceleration name loses priority if it waits a quarter.

Two further queue rules:
- Re-screen any candidate that has waited more than 6–8 weeks before writing its report.
- Tie-break toward the sleeve that is further below its target size.

**Reducing wasted (HOLD) reports.**
1. **Gate.** Candidates with Street upside below 10% do not get a full report. Route them to a cheap triage note (one page: screen pass, upside, catalyst check), or hold them in a "watch-only" state until upside reopens.
   - Worked example [illustrative; the owner must plug in the real confusion matrix at the 10% cutoff]: if the gate catches 60% of eventual HOLDs and wrongly drops 15% of eventual BUYs, then per 100 candidates you write 65 reports instead of 100. The HOLD share falls from 45% to about 28%, and you lose about 8 BUYs.
   - Choose the cutoff from the ROC curve by the cost ratio (report cost versus value of a missed BUY), not by default.
2. **Caveat (Bradshaw et al. 2013).** Street targets are optimistic by about 15% and have about 45% absolute error. Use the gate only to save cost. Do not raise Street upside into the screen itself, or the pipeline will herd toward consensus. Audit the gated-out names: track their realized returns from the archive (see 5) to check that the gate is not discarding winners.
3. **Revisit HOLDs only on an upside or price trigger** (e.g. upside crosses 15%) rather than re-writing the full report on a calendar.

### 4. Survivorship and look-ahead in backtesting the screens (Shibui lacks delisted names)

- **Caveat on any Shibui backtest:** returns are biased upward, and the screens will look more predictive than they are (Brown et al. 1992). The bias is largest in the small/mid growth sleeve. Shumway & Warther find that a −55% Nasdaq delisting correction erases the Nasdaq size effect. A recent small-cap estimate puts the overstatement at about 5 pp a year (Ranse 2026). Report Shibui backtests as **upper bounds**.
- **Corrections, in order of preference:**
  1. Source point-in-time universes that include delisted names (e.g. CRSP/Compustat or another vendor with dead tickers), at least for validation.
  2. If you cannot, reconstruct historical membership where possible.
  3. Impute delisting returns for names that vanish for performance reasons: about −30% (NYSE/AMEX convention) and −55% (Nasdaq; Shumway & Warther 1999). Run a sensitivity test from 0 to −100%.
- **Look-ahead controls:**
  - Use fundamentals as of the filing date (lag by the actual filing or acceptance timestamp, not the period end).
  - Use as-first-reported values rather than restated ones.
  - Use Street targets as of the decision date.
  - Use only the screen definitions that were frozen before the test window.

### 5. Archive, do not delete

**Why archive.**
- It is the only way to calibrate the report's own upside predictions and BUY/HOLD ratings against realized returns. Bradshaw et al. show that target-price accuracy cannot be assumed.
- It lets you measure re-admission churn, which is the input for tuning band width (see 1).
- It lets you audit the Street-upside gate (see 3).
- It builds a survivorship-free record of your own decisions. Deleting removed reports recreates exactly the survivorship bias in D.

**Metadata to keep for each archived report:**
- Identifiers: ticker, permanent ID (CIK/FIGI), sleeve.
- Dates: admission date, report date(s), removal date.
- **Removal reason:** soft-fail ×2, hard floor, event, cap displacement, or delisting, plus the delisting code if any.
- The failed criteria and their values at each failed check.
- Screen state at admission: presets passed, composite rank, margins.
- **Last rating** and the full rating history.
- Report upside and target, and Street upside, both at report date.
- The P(BUY) score used for queueing.
- Price at report date and at removal.
- **Realized return after removal and after the report date** at 1, 3, 6 and 12 months, both raw and versus the sleeve benchmark. These are filled in later by a scheduled job.
- Whether the name was re-admitted, and when.
- Data vendor and screen version hashes, for reproducibility.

**Retention:** keep everything indefinitely; it costs little.
