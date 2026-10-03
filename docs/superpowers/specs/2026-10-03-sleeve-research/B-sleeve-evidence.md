# Research B: what the evidence says about the Growth and Core sleeves

Prepared 2026-10-03. Literature research only; no backtest was run. Every source below was fetched in this session. Each entry says how it was checked: **[PDF]** means the full text was read, **[ABS]** means only the abstract or metadata was read (Crossref, NBER or publisher page), and **[FS]** means an index factsheet or practitioner note. Each entry also gives its evidence type: IS = in-sample, OOS = out-of-sample (later period, earlier period or other markets), G = gross of costs, N = net of costs.

Sleeve definitions as given:
- **GROWTH**: US companies with market cap of $300M–$20B, revenue growth above 15% year on year in each of the last 4 quarters, positive trailing-12-month operating cash flow (OCF), and a confirmed uptrend.
- **CORE**: US companies with market cap of $50B or more, ROIC above 12% in each of the last 8 quarters, revenue growth above 4% in each quarter, and price above the 200-day moving average (200DMA).

---

## (a) Annotated bibliography

### A. The small-growth problem and the filters that address it

1. **Fama & French (2015), "A five-factor asset pricing model", JFE 116:1–22.** [PDF] https://tevgeniou.github.io/EquityRiskFactors/bibliography/FiveFactor.pdf
   - Sample: July 1963–December 2013. The microcap, lowest-book-to-market (B/M) portfolio has the lowest return in the size × B/M grid: 0.26%/month excess, against 1.15% for microcap value. In the size-B/M-OP sort, small stocks in the lowest B/M and lowest profitability quartiles earn only 0.03%/month. Microcaps in the highest-investment quintile earn 0.35%/month.
   - The authors call these portfolios "lethal" for the model. Their returns "behave like those of firms that invest a lot despite low profitability", and the authors add that "for small stocks, high investment alone might be the prime problem."
   - Robustness: IS and G. This is the clearest statement that the weak returns of the small-growth corner come from *unprofitable, heavily investing* firms, not from growth as such.
   - Context: Ken French data-library description of the 6 size/B/M portfolios ("Small Growth" corner): https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/six_portfolios.html [ABS]

2. **Fama & French (2016), "Dissecting anomalies with a five-factor model", RFS (SSRN 2503174).** [ABS] https://doi.org/10.2139/ssrn.2503174
   - Negative RMW and CMA exposure (unprofitable firms that invest aggressively) "help explain the low average stock returns associated with high β, large share issues, and highly volatile returns."
   - This links issuance, high beta and lottery-like volatility into a single "junk" profile. IS, G.

3. **Novy-Marx (2013), "The other side of value: The gross profitability premium", JFE 108:1–28.** [PDF] https://mysimon.rochester.edu/novy-marx/research/OSoV.pdf
   - Sample: July 1963–December 2010, financial firms excluded. The gross-profits/assets high-minus-low spread is 0.31%/month (t=2.49). The FF3 alpha is 0.52%/month (t=4.49), because the strategy is a *growth* tilt with a negative HML loading.
   - Among the largest stocks the spread is 26bp/month (t=1.88), with a Sharpe of 0.27. Profitable firms "tend to be growth firms", and "proﬁtable growth ﬁrms are quite large."
   - Unprofitable growth stocks underperform growth stocks as a whole by 19bp/month. Large-cap tests are in Appendix A.6.
   - Robustness: IS and G. Turnover is low because GP/A is persistent.
   - Implication: profitability is the single most direct fix for the small-growth corner, and it does not fight a growth tilt.

4. **Asness, Frazzini & Pedersen, "Quality minus junk" (2013 draft; published in Review of Accounting Studies 24:34–112, 2019).** [PDF of the 2013 draft] http://www.efalken.com/LowVolClassics/Asness_Frazzini_Pedersen_QMJ.pdf
   - Samples: US 1956–2012, and 24 countries 1986–2012.
   - Quality is defined as profitability, growth (5-year growth in profitability), safety (low beta, volatility and leverage) and payout (which includes low net issuance).
   - US QMJ alphas are 55, 68 and 66bp/month against the 1-, 3- and 4-factor models (t = 7.27, 11.10, 11.20). Globally they are 52, 61 and 45bp/month. Returns are positive in 23 of 24 countries.
   - QMJ has a *negative* market beta and negative size exposure. It does well in severe bear markets ("flight to quality"), with a mildly convex payoff concentrated in the profitability component (quadratic t=2.0).
   - The price of quality was lowest in the internet bubble, and a low price of quality predicts high future QMJ returns.
   - Robustness: IS, with OOS across countries; G.
   - The Springer page for the published version redirected to a login and was not read.

5. **Asness, Frazzini, Israel, Moskowitz & Pedersen (2015 draft), "Size matters, if you control your junk".** [PDF] https://jacobslevycenter.wharton.upenn.edu/wp-content/uploads/2015/05/Size-Matters-if-You-Control-Your-Junk.pdf
   - Once quality/junk is controlled for, a significant size premium appears. It is stable over time, not concentrated in microcaps, and robust across markets.
   - Implication: *quality-screened* small/mid caps are the right place for the Growth sleeve. Unscreened small caps carry the junk drag. IS, G.

6. **Cooper, Gulen & Schill (2008), "Asset growth and the cross-section of stock returns", JF 63:1609–1651.** [ABS via Crossref] https://doi.org/10.2139/ssrn.760967
   - Year-on-year total-asset growth strongly predicts lower future returns, "even on large capitalization stocks."
   - Original decile spreads, as quoted by Hou-Xue-Zhang (#16): −1.05%/month value-weighted and −1.73%/month equal-weighted. Hou-Xue-Zhang's own replication with NYSE breakpoints and value weights gives −0.46%/month (t=−2.92).
   - Robustness: IS; the effect survives but shrinks. G.

7. **Pontiff & Woodgate (2008), "Share issuance and cross-sectional returns", JF 63:921–945.** [ABS via Crossref] https://doi.org/10.1111/j.1540-6261.2008.01335.x
   - After 1970, share issuance predicts returns cross-sectionally (negatively), and is "more statistically significant than the individual predictive ability of size, book-to-market, or momentum."
   - The effect is *not* significant before 1970.
   - Robustness: IS; the earlier-period test is effectively OOS and fails. G.

8. **Daniel & Titman (2006; NBER w9743, 2003), "Market reactions to tangible and intangible information".** [PDF] https://www.nber.org/system/files/working_papers/w9743/w9743.pdf
   - Past *internally funded* growth in sales, earnings, cash flow or book value does not predict returns. A composite share-issuance measure (SEOs, employee stock options, stock-financed M&A, minus buybacks and dividends) *does* predict returns, negatively.
   - Implication: what predicts returns is not past growth but *how the growth was funded*. Dilution-funded growth is the problem. IS, G.

9. **Sloan (1996), "Do stock prices fully reflect information in accruals and cash flows about future earnings?", The Accounting Review 71:289–315.** [ABS via Crossref] https://doi.org/10.2308/tar-9608042309
   - High-accrual earnings are less persistent, and investors "fixate" on earnings.
   - Original hedge return (quoted by Hou-Xue-Zhang): −10.4%/year (t=−4.71). Hou-Xue-Zhang's value-weighted replication gives only −0.27%/month (t=−2.13).
   - **Decay:** Green, Hand & Soliman (2009/2011), "Going, going, gone? The demise of the accruals anomaly" [ABS] https://doi.org/10.2139/ssrn.1501020, find US accrual hedge returns "decayed ... to the point that they are no longer positive."
   - Robustness: weak OOS. G.

10. **Mohanram (2005), "Separating winners from losers among low book-to-market stocks using financial statement analysis", Review of Accounting Studies 10:133–170.** [ABS via Crossref] https://doi.org/10.2139/ssrn.403180
    - G-SCORE combines earnings and cash-flow profitability, cash flow above earnings (low accruals), stability of earnings and sales growth, and R&D, capex and advertising intensity. It separates growth-stock winners from losers.
    - The result holds across size, price and analyst-following partitions, after momentum, B/M, accruals and size controls, and the strategy is positive in all years.
    - Follow-up: Li & Mohanram, "Fundamental analysis: combining the search for quality with the search for value" [PDF] https://www.ivey.uwo.ca/media/3775546/mohanram.pdf, finds that FSCORE and GSCORE hedge returns rise when combined with valuation (V/P or PEG).
    - Robustness: IS, G. This is the most directly relevant "fix" paper for a growth sleeve.

11. **Kumar (2009), "Who gambles in the stock market?", JF 64:1889–1933.** [ABS via Crossref] https://doi.org/10.1111/j.1540-6261.2009.01483.x
    - Lottery-type stocks (low price, high idiosyncratic volatility and skewness) underperform. Retail demand for them rises in downturns.
    - This supports the "lottery" reading of the small-growth corner. IS, G.

### B. Earnings and revenue momentum, and growth persistence

12. **Bernard & Thomas (1989), "Post-earnings-announcement drift: delayed price response or risk premium?", Journal of Accounting Research 27:1–36.** [metadata only, via Crossref] https://doi.org/10.2307/2491062
    - The classic post-earnings-announcement drift (PEAD) paper. Only the bibliographic record was confirmed; the abstract and numbers were not available. For quantification, use Hou-Xue-Zhang (#16) and Novy-Marx & Velikov (#19).

13. **Chordia & Shivakumar (2006), "Earnings and price momentum", JFE 80:627–656.** [ABS of the SSRN version via Crossref] https://doi.org/10.2139/ssrn.342581
    - "Price momentum is captured by the systematic component of earnings momentum." The earnings-surprise portfolio (PMN) subsumes past returns. IS, G.

14. **Novy-Marx (2015), "Fundamentally, momentum is fundamental momentum", NBER w20984.** [PDF] https://www.nber.org/system/files/working_papers/w20984/w20984.pdf
    - Earnings-surprise measures subsume past performance.
    - Price momentum controlled for earnings surprises loses performance but keeps its high volatility.
    - Earnings momentum controlled for past returns keeps its average return, with lower volatility and "eliminates the crashes."
    - Implication: a "confirmed uptrend" filter adds crash risk without independent alpha. Fundamental momentum (surprises and acceleration) is the signal worth paying for. IS, G.

15. **Jegadeesh & Livnat (2006), "Revenue surprises and stock returns", Journal of Accounting and Economics 41:147–171.** [PDF of the 2004 manuscript] https://pages.stern.nyu.edu/~jlivnat/JAE%20submission.pdf
    - Sample: 1987–2003, about 166k firm-quarters. Revenue surprises predict returns *after controlling for earnings surprises*, and analysts under-react to them.
    - The 6-month post-announcement drift from revenue surprises is significant **for small firms but not for large firms**. Original high-minus-low quintile 6-month abnormal return: 4.42% (equal-weighted; quoted by Hou-Xue-Zhang).
    - Hou-Xue-Zhang's value-weighted, NYSE-breakpoint replication of the 6-month revenue-surprise spread gives only 0.14%/month (t=1.01), which is insignificant.
    - Implication: revenue-surprise or acceleration signals are real mainly in smaller and less liquid names, which suits the Growth sleeve, but they are fragile under value weighting.

16. **Hou, Xue & Zhang (2020), "Replicating anomalies", RFS 33:2019–2133 (NBER w23394).** [PDF + ABS] https://www.nber.org/system/files/working_papers/w23394/w23394.pdf
    - Across 452 anomalies, using NYSE breakpoints and value weights, 65% fail at |t|<1.96 and 82% fail at the multiple-testing hurdle of 2.78.
    - Relevant replications:
      - SUE (earnings surprise) at a 1-month horizon: 0.47%/month. At 6 and 12 months: 0.19% and 0.11% (t = 1.65 and 1.00), which are insignificant.
      - Revenue surprise (6-month): 0.14% (t=1.01).
      - GP/assets: 0.38% (t=2.62). GP/lagged assets: 0.16% (t=1.04), which they read as GP/A being partly an investment effect.
      - Operating profits/book equity (Ope): 0.25% (t=1.2).
      - Investment/assets: −0.46% (t=−2.92). Operating accruals: −0.27% (t=−2.13).
    - **Key 18-portfolio fact (size × I/A × ROE):** small, low-investment, high-ROE stocks earn **1.39%/month**, the highest of the 18. Small, high-investment, low-ROE stocks earn **−0.07%/month**, the lowest. The I/A spread is largest among small, low-ROE stocks (0.74%) and only 0.09% among big, high-ROE stocks.
    - Robustness: this paper *is* the robustness check. G.

17. **Chan, Karceski & Lakonishok (2003), "The level and persistence of growth rates", JF 58:643–684 (NBER w8282).** [ABS] https://www.nber.org/papers/w8282
    - "Scant persistence in growth beyond chance, and limited ability to identify firms with high future long-term growth." Analyst long-term growth forecasts (IBES) are over-optimistic and add little.
    - The NBER PDF uses encoded fonts and could not be read, so no tables are quoted.
    - **OOS replication (practitioner deck, not peer-reviewed):** Ben Graham Centre (Ivey) / Verdad, "Persistence and predictability of growth" (February 2026) [PDF] https://www.ivey.uwo.ca/media/rtdj1eoj/persistence-and-predictability-of-growth.pdf
      - US 1997–2022: 5.9% of firms post above-median revenue growth 5 years in a row, against 3.1% expected by chance. For EBITDA the figure is 4.5%.
      - Among firms *starting in the top revenue-growth quartile*, 8.0% stay above median for 5 years (against 3.1%). For EBITDA, EBIT and EBT the figures are about chance (3.6–4.0%).
      - Results are similar in Europe and Japan.
    - Implication: revenue growth is *slightly* persistent and earnings growth is not. A "4 straight quarters above 15%" admission rule picks a set that will churn quickly, so the sleeve must expect high turnover.

### C. Out-of-sample decay and trading costs (applies to both sleeves)

18. **McLean & Pontiff (2016), "Does academic research destroy stock return predictability?" (SSRN 2080900; published in JF 2016).** [ABS] https://doi.org/10.2139/ssrn.2080900
    - Across 56 characteristics, out-of-sample decay is about 15% (statistical bias) and post-publication decay is about 50%.
    - **Planning rule: assume about half of any published premium.**

19. **Novy-Marx & Velikov (2016), "A taxonomy of anomalies and their trading costs", RFS 29:104–147 (NBER w20721).** [PDF + ABS] https://www.nber.org/system/files/working_papers/w20721/w20721.pdf
    - Most anomalies with one-sided turnover below 50%/month keep significant *net* spreads. Few higher-turnover anomalies do.
    - Annual-rebalance strategies (profitability, asset growth, accruals) usually cost under 10bp/month. Among mid-turnover monthly strategies, "only the net issuance, earnings momentum [CAR3] ... and momentum" survive net.
    - A buy/hold spread (hysteresis) is the most effective cost mitigation. N.

20. **Linnainmaa & Roberts (2018), "The history of the cross section of stock returns" (NBER w22894).** [PDF] https://www.nber.org/system/files/working_papers/w22894/w22894.pdf
    - Before 1963, the profitability and investment factors earn about 2–9bp/month (t<1), against 25–30bp (t≈3.4–3.6) over 1963–2014.
    - Only 8 of 36 anomalies are significant before 1963. The FF3-adjusted profitability alpha is 25bp (t=1.90).
    - Robustness: OOS backward in time; profitability and investment are fragile.

### D. Large-cap quality, low beta and defensiveness

21. **Frazzini & Pedersen (2014), "Betting against beta", JFE (NBER w16601).** [PDF] https://www.nber.org/system/files/working_papers/w16601/w16601.pdf
    - US BAB Sharpe ratio is 0.75 over 1926–2009, about twice that of value. Alphas are positive in each 20-year sub-period, and the effect appears in 19 other markets and other asset classes.
    - Mechanism: leverage-constrained investors bid up high-beta assets.
    - Robustness: IS, with OOS across markets; G. BAB is a leveraged long/short factor and is *not* directly a long-only sleeve.

22. **Baker, Bradley & Wurgler (2011), "Benchmarks as limits to arbitrage: understanding the low-volatility anomaly", FAJ 67(1).** [PDF] https://pages.stern.nyu.edu/~jwurgler/papers/faj-benchmarks.pdf
    - Over 1968–2008, $1 in the lowest-volatility quintile grew to $59.55, against $0.58 for the highest-volatility quintile. By beta: $60.46 against $3.77.
    - Among large caps: by volatility $53.81 against $7.35; by beta $78.66 against $4.70.
    - Low-risk portfolios combined "high average returns and small drawdowns." The paper names lottery preference and benchmarking as causes.
    - Robustness: IS, G (no costs).

23. **Asness, Frazzini & Pedersen (2012), "Leverage aversion and risk parity", FAJ 68(1):47–59.** [PDF] https://pages.stern.nyu.edu/~lpederse/papers/LeverageAversionRP.pdf
    - Leverage aversion makes safer assets earn higher *risk-adjusted* returns. The ex-post tangency portfolio overweights the safer asset.
    - This is the theory behind giving the lower-beta Core sleeve a larger capital weight than its "return potential" alone suggests.

24. **Bouchaud, Ciliberti, Landier, Simon & Thesmar (2016), "The excess returns of 'quality' stocks: a behavioral anomaly", arXiv:1601.04478.** [ABS] https://arxiv.org/abs/1601.04478
    - Quality returns are abnormally high after risk adjustment and "not prone to crashes." Analysts systematically underestimate the future profitability of high-quality firms.

25. **MSCI index factsheets (data as of 2026-08-31).** [FS] Pre-launch history is back-tested; returns are gross or net as noted.
    - **MSCI USA Quality** (large/mid; ROE, earnings stability, low leverage). Launched December 2012; back-tested to 1994. https://www.msci.com/documents/10199/255599/msci-usa-quality-index.pdf
      - Beta to MSCI USA: 0.93. 10-year SD 15.38% (MSCI USA 15.59%).
      - Sharpe since 1994: 0.74 (MSCI USA 0.61).
      - **Max drawdown 44.03% (2007-10-10 to 2009-03-09), against 54.91% for MSCI USA.**
      - 2022: −22.67% (MSCI USA −19.46%; quality *underperformed* in the rate shock). 2020: +22.92% (MSCI USA +21.37%).
    - **MSCI USA Small Cap Growth** (data since December 2000). https://www.msci.com/documents/10199/255599/msci-usa-small-cap-growth-index-usd-net.pdf
      - 10-year SD 20.46%. Sharpe since 2000: 0.47.
      - **Max drawdown 57.47% (2007-10 to 2009-03).**
      - 2022: −24.95%. 2020: +33.65%. 2021: +11.34% (MSCI USA +26.45%).
    - **MSCI USA Small Cap Quality** (since December 2000). https://www.msci.com/documents/10199/255599/msci-usa-small-cap-quality-index-usd-net.pdf
      - Beta 0.91 to small caps. Max drawdown 54.53%, against 59.82% for the parent. 2022: −13.60% (parent −17.55%). Since-2000 return 11.12%/year against 9.82%.
    - **iShares Russell 2000 Growth ETF (IWO)** page: 3-year equity beta **1.43**, 3-year SD 21.28% (as of 2026-08-31). [FS] https://www.ishares.com/us/products/239709/ishares-russell-2000-growth-etf

26. **MSCI blog, Virgaonkar, Mendiratta & Varsani (2 April 2020), "Factors in focus: risk sentiment and factor dynamics in a crisis".** [FS] https://www.msci.com/research-and-insights/blog-post/factors-in-focus-risk-sentiment-and-factor-dynamics-in-a-crisis
    - In Q1 2020, low volatility and quality outperformed in all three months, and momentum was defensive. Value and yield lagged.

27. **Man Group, Bond & Zhao (2020), "Questioning quality".** [FS] https://www.man.com/insights/questioning-quality
    - Quality (CMA- and RMW-type) earned about 4%/year alpha over 1963–2009, with the best risk-adjusted performance in recessions. After the financial crisis it decayed: asset-growth quality returned −1.7%/year over 2009–2019.
    - CMA–HML correlation was 0.68 over 1963–2020.
    - This is a warning that quality can lag for a decade.

### E. Correlations in crises and the behaviour of trend filters

28. **Ang & Chen (2002), "Asymmetric correlations of equity portfolios", JFE (SSRN 219495).** [ABS] https://doi.org/10.2139/ssrn.219495
    - Correlations with the market are much higher on the downside, about 11.6% above what normality implies. Asymmetry is greater for *small, value and past-loser* stocks.
    - Implication: growth/core diversification shrinks exactly in sell-offs.

29. **Longin & Solnik (2001), "Extreme correlation of international equity markets", JF 56:649–676.** [ABS] https://doi.org/10.1111/0022-1082.00340
    - Correlation "increases in bear markets, but not in bull markets." It tracks the market trend, not volatility as such.

30. **Daniel & Moskowitz (2016), "Momentum crashes", JFE 122:221–247 (NBER w20439).** [PDF] https://www.nber.org/system/files/working_papers/w20439/w20439.pdf
    - Momentum crashes happen in "panic states, following market declines and when market volatility is high," and coincide with rebounds.
    - March–May 2009: the past-loser decile gained 163% while winners gained 8%. July–August 1932: losers +232%, winners +32%.
    - Implication: an uptrend-filtered sleeve lags hard in V-shaped junk rallies (2009, late 2020).

31. **Faber (2007, updated 2013), "A quantitative approach to tactical asset allocation".** [PDF] https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf
    - Index-level rule: hold the S&P 500 while it is above its 10-month SMA, which is roughly the 200DMA.
    - Over 1901–2012, the compound return is 10.18% against 9.32% for buy-and-hold.
    - Drawdowns fall: 1929–32 from 83.66% to 42.24%; 2000–02 from 44.73% to 16.52%; and the 2008–09 drawdown of 50.95% was avoided.
    - The rule underperforms in about half of all years. The 2006–2012 update is real-time OOS.
    - **Caveat: this is index timing, not stock selection.** At single-stock level a 200DMA rule is a price-momentum screen and inherits #14 and #30.

### F. Number of holdings and concentration

32. **Statman (1987), "How many stocks make a diversified portfolio?", JFQA 22:353–363.** [ABS] https://www.cambridge.org/core/journals/journal-of-financial-and-quantitative-analysis/article/abs/how-many-stocks-make-a-diversified-portfolio/CE5CDF2C7225FC1E0EDE3E700A3C66A7
    - At least 30 randomly chosen stocks are needed for a borrowing investor and 40 for a lending investor, not about 10.

33. **Campbell, Lettau, Malkiel & Xu (2001), "Have individual stocks become more volatile?" (NBER w7590).** [ABS] https://www.nber.org/papers/w7590
    - Firm-level volatility rose relative to market volatility over 1962–97, so "the number of stocks needed to achieve a given level of diversification has increased."

34. **Domian, Louton & Racine (2007), "Diversification in portfolios of individual stocks: 100 stocks are not enough", Financial Review 42(4):557–570.** [ABS] https://doi.org/10.2139/ssrn.906686 (bibliographic record: https://profiles.laps.yorku.ca/publications/diversification-in-portfolios-of-individual-stocks-100-stocks-are-not-enough/)
    - Over 20-year horizons drawn from 1,000 large US stocks, shortfall risk keeps falling above 100 stocks. Adding names reduces it more than industry diversification does.

35. **Bessembinder (2018), "Do stocks outperform Treasury bills?", JFE 129:440–457.** [PDF of the accepted manuscript] https://r.jordan.im/download/investing/bessembinder2018.pdf
    - Most CRSP stocks have lifetime returns below T-bills. The best-performing 4% explain the market's entire net wealth creation since 1926.
    - This "helps to explain why poorly diversified active strategies most often underperform."
    - Implication: concentration in a *growth* sleeve raises the odds of missing the rare compounders.

36. **Antón, Cohen & Polk (2021 draft; originally Cohen, Polk & Silli 2010, LSE FMG DP 624), "Best ideas".** [PDF] https://personal.lse.ac.uk/polk/research/BestIdeas.pdf
    - Managers' highest-conviction positions beat the market by about 2.8–4.5%/year. The six-factor alpha is about 37bp/month (t≈3.4).
    - "The vast majority of the other stocks managers hold do not exhibit signiﬁcant outperformance."
    - Robustness: IS, G. Conviction is measured from professional fund managers' overweights, not from a screen.

37. **Goetzmann & Kumar (2001/2008), "Equity portfolio diversification" (NBER w8686).** [PDF] https://www.nber.org/system/files/working_papers/w8686/w8686.pdf
    - In more than 40,000 retail accounts (1991–96), most investors were under-diversified and took large idiosyncratic risk.

---

## (b) Implications for the admission filters

### GROWTH sleeve

The evidence puts the weak returns of small growth stocks on three features: **low profitability, heavy investment or asset growth, and dilution** (FF 2015; HXZ; Daniel-Titman; Pontiff-Woodgate). It does not blame growth as such. The current filters handle only one of these, through positive OCF. The 15% revenue-growth rule *pushes toward* the high-investment corner, so dilution and asset-growth guards matter more here than anywhere else.

**Keep**
- **Market cap of $300M–$20B.** The floor keeps out microcaps, where the problem is worst (FF 2015 Table 1; Kumar).
- **Positive TTM OCF.** This is a cash-profitability and low-accrual proxy, consistent with Novy-Marx, QMJ, Sloan and Mohanram.

**Add, in priority order**
1. **A dilution cap.** Net share-count growth should be at most about 3–5% year on year, including stock-based-comp dilution. Exclude companies with a secondary offering or stock-financed M&A in the last 12 months. This is the strongest single fix: Pontiff-Woodgate, Daniel-Titman, and net issuance survives costs in Novy-Marx & Velikov.
2. **A profitability floor.** Use gross profits/assets in the top half of the universe, or positive and rising operating margin (Novy-Marx; HXZ small-high-ROE cell). Positive OCF alone admits low-margin cash-burners funded by working capital.
3. **An asset-growth guard.** Exclude the top decile or quintile of asset growth, or companies whose asset growth far exceeds revenue growth (Cooper-Gulen-Schill; HXZ: small, high-I/A, low-ROE = −0.07%/month).
4. **An accrual check.** Require OCF ≥ net income, or a low accrual ratio. This is a cheap quality guard. Its standalone premium has decayed (Green-Hand-Soliman), so use it as a screen, not a ranking signal.
5. **A fundamental-momentum trigger.** Admit on a *positive* recent earnings or revenue surprise or on revenue acceleration (Jegadeesh-Livnat: strongest in small firms; Chordia-Shivakumar; Novy-Marx 2015).
   - Use it as the "uptrend confirmation" instead of, or ahead of, price trend.
   - Rank on it at quarterly earnings dates, not monthly, to keep turnover affordable (Novy-Marx & Velikov).
6. **An anti-lottery guard.** Exclude the top decile of idiosyncratic volatility or maximum daily return (Kumar; BBW; FF 2016).

**Reconsider**
- **"Revenue growth above 15% in *each* of 4 quarters."** Growth level barely persists (CKL; Ivey OOS: top-quartile revenue growers have about an 8% chance of staying above median for 5 years). Past *level* of growth is not priced (Daniel-Titman).
  - Recommendation: loosen it to TTM growth above 15% **and** at least 3 of 4 quarters above 15%, plus a surprise or acceleration condition.
  - Use exit hysteresis, for example sell only if TTM growth falls below about 10%, so names do not churn on one soft quarter.
- **"Confirmed uptrend."** Price momentum adds little once earnings momentum is controlled for, and it brings crash risk in rebounds (Novy-Marx 2015; Daniel-Moskowitz).
  - Keep a *light* trend condition as a risk guard, for example price above a rising 200DMA.
  - Do not treat trend as the alpha source, and do not let it alone force a sale in a V-shaped market.

**Bottom line for Growth.** No paper tests the exact "profitable, accelerating, non-diluting small/mid growth" combination as a sleeve. The pieces are each robust IS:
- small, low-investment, high-ROE stocks earn 1.39%/month (HXZ 18-portfolio grid);
- quality restores the size premium (Asness et al. 2015);
- G-SCORE separates growth winners from losers (Mohanram).

After value-weighting and publication decay (HXZ; McLean-Pontiff), a reasonable *planning* premium over the small/mid growth index is modest: roughly 1–3%/year gross. Plan for close to half that net of costs. It should come from avoiding the junk corner more than from picking winners.

### CORE sleeve

**Keep**
- **Market cap of $50B or more.**
- **ROIC above 12%.** Consistent with profitability and quality (Novy-Marx; QMJ; MSCI Quality back-test: maximum drawdown 44% against 55% for the market).

**Modify**
- **ROIC above 12% "in every one of the last 8 quarters".** Make it an 8-quarter *average* above 12% with a floor of about 8% in any single quarter. QMJ rewards *stability*, and a single-quarter miss should not force turnover (Novy-Marx & Velikov hysteresis).
- **Revenue growth above 4% "in each quarter".** This is the least evidence-backed filter in the sleeve. QMJ's growth leg is 5-year profitability growth, not revenue in every quarter.
  - The rule tilts Core toward long-duration growth names. That makes Core more correlated with the Growth sleeve, and it was the 2022 failure mode: MSCI USA Quality returned −22.7% against −19.5% for MSCI USA.
  - Recommendation: TTM revenue growth above 0–4%, or 3 of 4 quarters.
- **Price above the 200DMA.** As a single-stock rule this is a momentum screen. It forces sales of quality names in flash crashes (Q1 2020) and buy-backs higher, and Faber's evidence is for *index* timing.
  - Recommendation: move it to the overlay. Use a buffer, for example exit only after 2–4 weekly closes below the 200DMA or a close more than 5% below it, and do not use it as an admission gate.

**Add**
1. **A low-beta or low-volatility tilt.** Prefer names with 3-year beta at or below about 1.1, or rank on volatility (BAB; BBW; QMJ safety). This is the main lever that makes Core *defensive* rather than just large.
2. **A leverage cap**, for example net debt/EBITDA at or below about 3×, in line with QMJ safety and the MSCI Quality methodology.
3. **Net payout of zero or more**, meaning buybacks plus dividends outweigh issuance. This is the mirror image of Pontiff-Woodgate.
4. **A sector cap of about 30–35% of the sleeve**, so Core does not turn into a second technology or "quality growth" basket.
5. **Optional: a valuation guard.** QMJ shows the price of quality varies and a low price predicts high returns, and Li-Mohanram show that quality combined with value beats quality alone.

---

## (c) Recommended strategic base split

**Recommendation: CORE 60% / GROWTH 40% of invested capital (a weight target, not a count target). Let the overlay move Growth within a band of about 25–55%.**

**Reasoning**

1. **Risk budget.** The figures below are planning assumptions taken from the factsheets above, not a backtest:

   | Input | Growth sleeve | Core sleeve |
   |---|---|---|
   | Volatility | about 25% | about 16% |
   | Beta | about 1.4 | about 0.95 |
   | Max drawdown (planning) | about 60% | about 44% |

   | Source of the assumption | Growth sleeve | Core sleeve |
   |---|---|---|
   | Volatility | Small-cap growth index 20–21% SD, plus extra idiosyncratic risk from about 25 names | MSCI USA Quality 15.4% |
   | Beta | IWO 1.43 | 0.93 |
   | Max drawdown | Index 57.5%, plus concentration | MSCI USA Quality 44% (GFC) |

   - Normal-period correlation between the sleeves is assumed at about 0.8.
   - With two assets, an equal-risk (risk-parity) split is inverse-volatility: 16/(16+25) ≈ **39% Growth / 61% Core**.
   - At 40/60 the Growth sleeve supplies about 51% of portfolio variance. A growth-oriented owner therefore gets half the risk budget in growth while holding a minority of the capital.

2. **Return evidence does not justify more.** The unfiltered small-growth corner is the worst FF portfolio. The filtered version's edge is IS, decays about 50% after publication, and is small under value weighting (HXZ). The leverage-aversion and BAB literature (AFP 2012; Frazzini-Pedersen; BBW) says the *safer* sleeve tends to have the better Sharpe ratio. A mean-variance optimiser with honest inputs, giving Growth an expected return similar to or only slightly above Core, would sit *at or below* 40% Growth.

3. **Drawdown control is the owner's stated constraint.** The approximate blend profiles below use the same assumptions. Drawdown is a linear approximation that assumes both sleeves hit their GFC-type troughs together; Ang-Chen and Longin-Solnik say to assume this.

   | Growth / Core | Vol | Beta | Growth share of risk | Approx. max drawdown |
   |---|---|---|---|---|
   | 20 / 80 | 17.1% | 1.04 | about 26% | about 47% |
   | 30 / 70 | 17.8% | 1.09 | about 39% | about 49% |
   | **40 / 60** | **18.6%** | **1.13** | **about 51%** | **about 50%** |
   | 50 / 50 | 19.5% | 1.18 | about 62% | about 52% |
   | 60 / 40 | 20.5% | 1.22 | about 72% | about 54% |
   | 70 / 30 | 21.5% | 1.27 | about 81% | about 55% |
   | 80 / 20 | 22.6% | 1.31 | about 88% | about 57% |

   - Moving the split changes *volatility and beta* far more than it changes *crash drawdown*, because both sleeves are long-only equity and correlations rise in crashes.
   - Drawdown control therefore has to come mainly from the **overlay** (index-level trend or volatility rules à la Faber, and cash), not from the static mix.
   - The static split should be set for *normal-time risk share*. That argues for about 40% Growth, not 60–80%.

4. **The utility framing.** A growth-oriented owner who wants downswings controlled is best served by a base where Growth already holds half the risk at 40% weight, with the overlay allowed to raise Growth toward 55% in confirmed uptrends and cut it toward 25% in stress.
   - If the owner insists on a growth-heavy base, **50/50 is the most defensible ceiling**: Growth then carries about 62% of the risk and beta is about 1.18.
   - 60/40, 70/30 or 80/20 in favour of Growth makes the portfolio essentially a high-beta small/mid growth fund with about 72–88% of its risk in one sleeve.

**Are count targets a good proxy?** No.
- Count is a proxy for weight only if every position across both sleeves is equal-weighted.
- Even then it is a poor proxy for *risk*, because a Growth name carries about 1.5× the volatility and roughly 2× the idiosyncratic risk of a Core name.
- Set and monitor the **weight** target, rebalance on weight drift beyond about ±5 percentage points, and treat counts only as the diversification constraint in (d).
- If positions are equal-weighted within each sleeve, Growth positions will be smaller per name than Core positions under a 40/60 split with more Growth names, which is the intended result.

---

## (d) Recommended holdings range per sleeve once holdings are capped

| Sleeve | Recommended count | Per-name weight within sleeve | Single-name cap (whole portfolio) |
|---|---|---|---|
| GROWTH | **20–30** (target 25) | about 3–5% of the sleeve | 2.5% |
| CORE | **15–25** (target 20) | about 4–7% of the sleeve | 5% |
| **Total** | **35–55** | | |

**Justification**
- **Statman / CLMX / DLR.** Random diversification needs 30–40 or more names, and more as idiosyncratic volatility has risen. A total of 35–55 meets the Statman floor at portfolio level.
- **Arithmetic** (assumptions, not sourced). Residual risk of an equal-weighted sleeve is about σ_idio/√N.
  - Growth names (σ_idio about 45%): 25 names give about 9% residual volatility. 16 names give about 11%, and 36 give about 7.5%.
  - Core names (σ_idio about 22%): 20 names give about 5%, and 15 give about 5.7%.
  - Growth names cluster in technology, healthcare and software, so the effective N is lower than the count. Growth therefore needs *more* names than Core.
- **Bessembinder.** Returns in small/mid growth are highly skewed. Too few names raises the chance of missing the rare compounders, which argues against going below about 20 in Growth.
- **Best ideas.** Conviction matters. Above about 30 names in Growth, the marginal names tend to dilute alpha.
  - With no conviction score, rank by the (b) composite (surprise + profitability + low dilution) and keep the top 25.
- **Core** names are large and lower-volatility. With 15–25 names the sleeve keeps its defensive character without becoming a costly closet index.
- **Costs.** Use hysteresis: admit at a top-rank threshold and drop only at a looser one (Novy-Marx & Velikov). Without it, the strict quarterly filters will generate high turnover.

---

## (e) Open risks

1. **No direct test of the combined Growth recipe.** Every component is IS and G. Value-weighted replications (HXZ) and earlier-period tests (Linnainmaa-Roberts: profitability and investment are insignificant before 1963) are much weaker. Accruals have decayed to about zero. Plan for about half the published premium.
2. **The two sleeves can fail together.**
   - In 2022 MSCI USA Quality *underperformed* the market (−22.7% against −19.5%), and small-cap growth fell −25%. A rate or duration shock hits both, especially if Core's revenue-growth rule tilts it toward technology.
   - In the financial crisis both drew down 44–57%. Downside correlations rise (Ang-Chen; Longin-Solnik).
   - Diversification between the sleeves is relative (about 13 percentage points less drawdown for Core), not absolute.
3. **Junk rallies and momentum crashes.** QMJ has negative beta and lags in V-shaped rebounds. Uptrend and 200DMA filters lag or whipsaw at turning points (Daniel-Moskowitz: losers +163% in March–May 2009). Both sleeves' trend gates can leave the portfolio under-invested at the start of a rebound.
4. **A decade-long quality drought is possible.** Man Group reports asset-growth quality at −1.7%/year over 2009–2019. The quality premium is time-varying and depends on how richly quality is priced (QMJ).
5. **Turnover and tax drag.** Strict "each quarter" rules on growth and ROIC, combined with weak growth persistence (CKL; Ivey OOS), produce high churn. Net results depend on hysteresis and on trading at earnings dates (Novy-Marx & Velikov). Taxes in a taxable account were not modelled.
6. **Inputs for (c) are assumptions.** The volatility, beta, correlation and drawdown inputs come from index factsheets, partly back-tested (MSCI Quality before 2012). A concentrated 20–30-name sleeve can deviate a lot from them.
   - The 2000–02 small/mid-growth drawdown could not be verified from a fetched source; MSCI small-cap series start in December 2000. It is likely to have been worse than the 57% GFC figure used here.
   - Recommended next step: validate (c) with a backtest using Ken French size/B/M and size/OP/Inv portfolios before locking the split.
7. **Sources checked only by abstract or metadata.** Bernard & Thomas (metadata only), Sloan, Cooper-Gulen-Schill, Pontiff-Woodgate, Chordia-Shivakumar, Mohanram, Statman, DLR, Ang-Chen and CLMX were confirmed only at abstract or metadata level. Their headline numbers either come from HXZ's re-quotation or are not quoted.
   - The QMJ figures come from the 2013 working-paper draft, not the 2019 published version.
   - The CKL out-of-sample figures come from a practitioner deck, not a refereed paper.
8. **Regime and structure change.** Since 2010 large-cap returns have been concentrated in a few mega-caps. Market-cap thresholds ($20B and $50B) drift with the market, so the "small/mid" and "large" sleeves may overlap or leave gaps over time. Index the thresholds, for example to percentiles of market cap.
