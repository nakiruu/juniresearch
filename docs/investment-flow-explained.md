# How Juniper evaluates investments, builds a portfolio, and trades

Juniper makes three separate decisions: **Is the stock attractive? How much should the portfolio own? Is a trade justified and executable now?**

This guide describes repository defaults inspected on November 14, 2026, not verified settings on a running deployment. Examples are illustrative unless identified as stored report data. For the detailed technical reference, see [engine.md](engine.md).

The flow is: research → rating and financial-health gate → live-price checks → target portfolio → trading plan → execution and audit. Each scheduled run repeats the price and portfolio checks; research refreshes update the underlying forecasts separately.

## 1. Research establishes what the stock might be worth

The project gathers filings, financial statements, market prices and estimates. An AI/analyst supplies the investment argument and three scenarios:

| Illustrative scenario | Future price | Probability |
|---|---:|---:|
| Bull | $150 | 25% |
| Base | $120 | 50% |
| Bear | $70 | 25% |

The code calculates a probability-weighted fair value:

`25% × $150 + 50% × $120 + 25% × $70 = $115`

At a current price of $100:

- Expected upside: **15%**.
- Bear-case downside: **30%**.
- Reward/risk: **15% ÷ 30% = 0.50**.

That qualifies as a **Buy**. The arithmetic is deterministic, but the forecasts and probabilities are judgment calls and can be wrong.

## 2. Upside and downside determine the rating

The [rating logic](../lib/synth/conviction.ts) uses thresholds from [desk.json](../data/desk/desk.json):

| Rating | Expected upside | Additional requirement |
|---|---:|---|
| Strong Buy | At least 20% | Reward/risk ≥1.0 |
| Buy | At least 10% | Reward/risk ≥0.5 |
| Hold | No other band qualifies | — |
| Sell | −5% or worse | — |
| Strong Sell | −20% or worse | — |

Strong Sell takes precedence over Sell; Strong Buy takes precedence over Buy. The author can choose one step toward Hold from the calculated rating, but cannot publish a more aggressive call. The publication rules also require a bear scenario at least 15% below the publication price.

This evaluates the **investment at its price**, rather than simply whether the company is good. A strong business can be unattractive if its price already assumes too much success.

Examples from stored reports, not current market quotes:

| Stock | Report price as of | Expected upside | Bear-case loss | Published rating |
|---|---|---:|---:|---|
| Broadcom | Sep 11, 2026 | +21.6% | 30.9% | Buy: reward/risk 0.70 is insufficient for Strong Buy |
| Intel | Sep 15, 2026 | +3.5% | 38.2% | Hold: too little expected reward |
| Expensify | Oct 2, 2026 | −7.9% | 32.9% | Sell: expected value below price |

## 3. Financial health and confidence provide cross-checks

| Check | Plain-language question |
|---|---|
| Debt and liquidity | Can the business meet its obligations? |
| Financial strength | Are profitability and balance-sheet trends healthy? |
| Earnings quality | Do reported profits turn into cash? |
| Competitive advantage | Can the company sustain strong returns? |
| Cash-flow valuation | Does a separate valuation support the scenario-based call? |
| Relative metrics | How do valuation, margins, growth and momentum look? |

These produce two distinct outputs:

- **A gate-adjusted rating:** weak finances can cap the recommendation at Hold or Sell. The health checks account for sector differences, such as banks and utilities.
- **A confidence score:** starts at 100 and loses points for conflicting evidence, uncertainty or missing inputs.

Confidence means confidence in the recommendation. A high-confidence Sell remains a Sell.

**The distinction between report and trading behavior matters:** the current report build uses an advisory decision policy, so these cross-checks do not automatically override the headline rating. However, the portfolio and trading layers enforce the separate gate-adjusted rating. A headline Buy can therefore be excluded from purchases or trigger an exit if its gate-adjusted rating is not Buy-side.

Sources: [decision policy](../lib/synth/decide.ts), [financial-health gates](../lib/synth/gates.ts), [report build](../scripts/synth-build.ts).

## 4. Current prices determine whether an opportunity still qualifies

The trading engine keeps the report's scenario prices fixed but recalculates upside and downside using current market prices. The portfolio signal uses the lowest scenario price for downside, normally the named bear scenario.

Using the same $115 fair value and $70 bear case:

| Current price | Expected upside | Reward/risk | Interpretation |
|---|---:|---:|---|
| $100 | 15.0% | 0.50 | Below trading entry requirement |
| $95 | 21.1% | 0.80 | Potential entry |
| $113 | 1.8% | 0.05 | Expected reward largely exhausted |

A report-level Buy does **not** automatically cause a purchase. The live trading entry rules are:

| New-position requirement | Default |
|---|---:|
| Expected upside | ≥8% |
| Reward/risk | ≥0.60 |
| Confidence | ≥45/100 |
| Report age | ≤150 days |
| Published and gate-adjusted ratings | Buy or Strong Buy |

The gate-adjusted rating is checked when present. Restrictions, trading locks and stale-news checks must also pass. The repository explicitly bans ICE because of an employer holding restriction.

The read-only analytical portfolio uses slightly different thresholds: **5% upside and 0.50 reward/risk**. Its displayed allocation can therefore differ from the executable trading portfolio.

Sources: [signals](../lib/portfolio/signal.ts), [analytical eligibility](../lib/portfolio/eligibility.ts), [trading classifications](../lib/trade/hysteresis.ts).

## 5. Portfolio sizing decides how much to own

Eligible stocks receive a sizing score approximately equal to:

`Expected upside × confidence × adjusted reward/risk × freshness × quality adjustment`

More upside, greater confidence and better reward relative to downside generally earn more weight. Older research receives less weight. The trading configuration applies a modest quality adjustment bounded between **0.8× and 1.2×**.

Research freshness halves after **90 days**. This reduces a report's score relative to fresher research; it does not automatically halve its portfolio weight.

For sizing, the engine assumes at least **25% downside**, even if the scenarios imply less. This prevents a stock approaching its bear-case price from appearing almost risk-free and receiving an enormous allocation. This floor changes sizing, not the raw reward/risk used for entry tests.

Capital is distributed proportionally to scores, subject to:

| Allocation constraint | Default |
|---|---:|
| Maximum target per stock | 10% |
| Maximum target per sector group | 30% |
| Minimum cash reserve | 1% |
| Borrowing to fund purchases | Not allowed |

Sector groups use the first two digits of the company's SIC classification. For a $10,000 portfolio, a stock target cannot exceed $1,000. When a stock or sector reaches its cap, remaining capital is redistributed to other qualifying names. If too few stocks qualify or the caps prevent deployment, the remainder stays in cash.

These are target-allocation constraints. Actual holdings can differ because prices move, orders only partially fill, or locks delay adjustments.

Sources: [portfolio configuration](../lib/portfolio/config.ts), [sizing](../lib/portfolio/sizing.ts), [trade configuration](../lib/trade/config.ts).

## 6. Target holdings are compared with actual holdings

Each run reads broker positions and decides among four trade actions:

| Action | Meaning |
|---|---|
| Enter | Start a position |
| Add | Increase an existing position |
| Trim | Reduce an existing position |
| Exit | Sell the position |

The engine avoids trading every small change. For existing holdings, the target generally must differ from the current allocation by **more than 2.5 percentage points**:

- Own 5%; target becomes 6% → no trade.
- Own 5%; target becomes 8% → potential add.
- Own 5%; target becomes 2% → potential trim.

The minimum add/trim amount is the larger of **$1 or 0.5% of portfolio value**. On $10,000, that is $50. Exits do not have this minimum.

Entry and exit use different thresholds to avoid repeatedly buying and selling around the same cutoff. An existing holding normally exits if:

- Expected upside falls below **3%**.
- Reward/risk falls below **0.15**.
- Its headline or gate-adjusted rating stops being Buy-side.
- Its research becomes older than **150 days**.
- A holding restriction applies.

Falling below the 45-point confidence entry threshold is not itself an explicit exit trigger, although confidence still affects sizing.

Sources: [classification rules](../lib/trade/hysteresis.ts), [rebalance logic](../lib/trade/rebalance.ts).

## 7. Falling markets and broken investment cases receive different treatment

When a held stock reaches or falls below its bear-case price, the engine estimates how much of the decline is company-specific versus explained by SPY and the stock's beta.

| Estimated company-specific share of decline | Default response |
|---|---|
| Below 50% | Keep eligible for holding and sizing |
| 50% to below 90% | Freeze: no adding or trimming |
| 90% or more | Exit, subject to locks |

For example, with beta 1, a stock falling 30% while the market falls 25% is mostly market-driven. A stock falling 30% while the market is flat is company-specific.

This is a numerical attribution estimate, not proof of the cause. It applies only when the bear breach is the sole exit reason. A downgrade or expired report still triggers an exit. Missing attribution inputs leave the ordinary bear-breach exit in place.

For new purchases, another check blocks a stock that has fallen at least **5%**, whose decline is predominantly company-specific, and whose available recent earnings result missed expectations. The earnings result must be no more than **120 days** old. This prevents some purchases based on research that has not absorbed bad news. Missing inputs mean this particular entry check does not block a purchase.

Sources: [bear-breach attribution](../lib/trade/breach.ts), [stale-news entry check](../lib/trade/stale-entry.ts).

## 8. Actual fills start a five-trading-day reversal lock

- After buying, selling is blocked for five trading days.
- After selling, buying is blocked for five trading days.
- Additional same-direction fills restart the opposite-direction clock.

A Monday purchase ordinarily cannot be sold until the following Monday, assuming no market holidays. The restriction applies to the whole ticker, not just the purchased lot.

**Even an exit signal can be deferred by this lock.** The system records the reason and unlock date. A holding with no current research signal is frozen rather than automatically liquidated.

Sources: [locks](../lib/trade/locks.ts), [rebalance logic](../lib/trade/rebalance.ts).

## 9. The plan becomes broker orders

The execution layer supports Alpaca paper trading and Schwab live trading. It converts allocation changes into dollars and share quantities:

`$10,000 portfolio × 3% additional allocation = $300 purchase`

With fractional trading enabled by default:

- Orders below **$200** generally use a market order.
- Larger orders generally split into a whole-share limit order and a fractional market remainder.
- Market legs require a sufficiently fresh quote and acceptable bid/ask spread.
- Limit prices allow bounded price movement; an unfilled remainder is cancelled rather than chased indefinitely.

On Schwab, the immediate-or-cancel behavior is emulated by submitting a day limit order, checking its status and cancelling its unfilled remainder. Partial fills are retained and recorded.

**Sells execute first.** Purchases may use available cash and proceeds from sales that actually filled, rather than assuming planned sales succeeded.

Before submission, guards check cash, locks, banned tickers, order counts, notional limits and the kill switch. Large price gaps or unsuitable pricing data can prevent a ticker's execution. Decision prices normally use a fresh last trade, then a fresh quote midpoint, then the prior settled close as fallback. The source is recorded.

If an order submission times out, the engine investigates whether the broker accepted it. It does not blindly submit the same order again. If the outcome remains unknown, it stops further submissions.

Sources: [order sizing](../lib/trade/orders.ts), [limit pricing](../lib/trade/limit.ts), [execution pipeline](../lib/trade/pipeline.ts), [submission guards](../lib/broker/guards.ts).

## 10. Repeated runs and research refreshes maintain the portfolio

When enabled, the default scheduled run is **3:10 p.m. Eastern on trading days**, with no new submissions at or after **3:50 p.m.** The default schedule skips early-close days because the market is already closed at the scheduled time.

Each run:

1. Reconciles broker holdings and recent orders with local fill records.
2. Refreshes market prices.
3. Recalculates attractiveness and target allocations.
4. Applies exit rules, locks, trade thresholds and execution guards.
5. Sends qualifying orders.
6. Records actual fills and audits them against broker records.

The audit checks for missing fills, unexplained holdings and quantity discrepancies. Critical mismatches halt trading. Run records retain prices, decisions, skips, orders and fills; configured notifications report outcomes and problems.

A configurable turnover breaker can limit trading to **15% of portfolio value per run**, but production entry points leave it **off unless explicitly enabled**. It should not be treated as an unconditional protection. When enabled, an oversized buy-only plan can be clipped to its budget and the remaining purchases deferred; a plan containing sells is halted instead of clipped.

Research maintenance is separate from daily trading. The engine can flag a report whose current-price rating would differ from its published rating for three consecutive run days, but **it does not automatically rewrite that report or promote a published Hold into a Buy**.

Research freshness is therefore central: prices and allocations update automatically, while the underlying assumptions remain in force until the research is rebuilt or rewritten.

Sources: [scheduler wiring](../lib/trade/scheduler-wiring.ts), [scheduled run](../lib/trade/cron.ts), [broker audit](../lib/trade/audit.ts), [rating refresh flags](../lib/trade/relabel.ts).
