# Trading pipeline audit — strategy, execution, function (2026-09-28)

> **Status:** owner approved 1 = hybrid, 2 = emulated IOC, 3 = ADD/TRIM floor `max($5, 1% NAV)`.
> **2026-10-01:** owner lowered the ADD/TRIM floor to `max($1, 0.5% NAV)`, tunable via `TRADE_MIN_USD` / `TRADE_MIN_NAV_PCT`; the turnover breaker is off unless `TURNOVER_BREAKER=true`.
> Implemented: C1, C2, C3, S1 (§5 items 1–3). Not yet done: S2 relative band, S3 μ-vs-realized tracking.

Scope: `lib/portfolio/*` (signals, eligibility, sizing), `lib/trade/*` (hysteresis, rebalance, orders, limit,
pipeline, cron, scheduler, ledger, locks), `lib/broker/*` (Schwab, Alpaca, guards, http). Evidence was
gathered read-only against the live Schwab account. Every order check used Schwab's `previewOrder`
endpoint, which validates an order and places nothing. The order list was re-read afterwards and showed
0 new orders.

**Locks are out of scope for change.** Nothing below alters the 5-business-day, whole-ticker, symmetric
lock. The one proposal that affects how *often* locks are triggered (§4, Q3) is a question for the owner.

---

## 1. Critical findings

### C1. Schwab rejects every engine order: `IMMEDIATE_OR_CANCEL` is not a valid Schwab duration
- The engine sends every order as a LIMIT order with `timeInForce: "ioc"`. `SchwabBroker.submitOrder` maps
  that to `duration: "IMMEDIATE_OR_CANCEL"`.
- Previewing the engine's exact body (`LIMIT IOC buy 1 EVLV`) returns
  **HTTP 400 `Invalid value 'IMMEDIATE_OR_CANCEL'`**. `IOC`, `IMMEDIATE` and `FOK` are also invalid.
- Valid durations are `DAY`, `GOOD_TILL_CANCEL` and `FILL_OR_KILL`. `FILL_OR_KILL` is accepted only during
  regular hours: outside them the preview says "IOC/FOK orders are not accepted".
- Consequence:
  - A 4xx is a definitive reject, so nothing is ever placed.
  - `executeOrders` rethrows the error, so the run crashes on its first order.
  - No run record is written and the halt counter is not bumped.
  - Every live Schwab run would do the same. Every Schwab order in the account so far was entered
    manually (tag `API_TOS:IPHONE`); the engine has never placed one.
- Fix options:
  - **(a) Emulated IOC (recommended):** submit a DAY limit, poll for ~5–10 s, cancel the remainder, then
    poll until terminal. This keeps partial fills.
  - **(b) `FILL_OR_KILL`:** all-or-nothing. For 1–5-share orders it is almost identical to IOC and is the
    smaller code change, but at larger sizes it gives up partial fills.
- Either way, a DAY order that is still working when the run ends must be cancelled, or the next
  reconcile halts on "working order".

### C2. One rejected order crashes the whole run
- Any non-`SubmitOutcomeUnknownError` exception (a 4xx, the whole-share guard) propagates out of
  `executeOrders` and `runCron` (they have only `finally`). The rest of the run is lost:
  - the remaining orders are not sent;
  - no run record is written;
  - there is no broker-truth audit;
  - there is no halt bump.
- Fills from earlier orders in the run *are* already in `fills.jsonl`, so locks stay correct.
- Fix: catch a definitive reject per order, record it as `rejected` with the broker's message, notify,
  and continue or stop by policy. Nothing was placed, so continuing is safe.

### C3. A full exit of a fractional position crashes the run
- Known issue. `EXIT` sells `pos.qty` exactly (for example 1.5647 LTRX) and the whole-share guard throws.
- It is superseded by §3: Schwab **does** accept a fractional MARKET sell. The preview of
  `MARKET SELL 1.5647 LTRX` was ACCEPTED.

---

## 2. What Schwab's API accepts (measured with `previewOrder`, 2026-09-27)

| Order | Result |
|---|---|
| MARKET buy 0.5 EVLV (~$2.40) | ACCEPTED |
| MARKET buy 0.2178 EVLV (~$1.05, 4 dp) | ACCEPTED |
| MARKET buy 0.05 EVLV (~$0.24) | REJECTED: "fractional orders … minimum of $1" |
| MARKET buy 0.12345 EVLV (5 dp) | REJECTED (max 4 dp) |
| MARKET buy 0.01 AMZN / 0.1 AIP | ACCEPTED |
| MARKET sell 0.0896 EVLV, 1.5647 LTRX | ACCEPTED |
| LIMIT buy 0.05 EVLV | 400: "Orders with less than 1 shares must be of type MARKET" |
| LIMIT buy 1.5 / 2.5 EVLV | ACCEPTED in preview (fractional part not yet proven in a live fill) |
| MARKET with IOC | 400 (no IOC for any order type) |

Rules:
- A fractional quantity works on the API with MARKET orders, up to 4 dp and at least $1 notional.
- Sub-share LIMIT orders are refused.
- LIMIT orders of 1 share or more with a fractional part passed preview. Treat that as unproven until a
  live fill confirms it.

---

## 3. Order type and account size: bps and feasibility

### Measured execution cost of your market orders
The test compared all 47 FILLED MARKET orders in the last 20 days with the typical price
((H+L+C)/3) of the 1-minute bar they printed in. **Median 0.6 bps, mean 2.2 bps, worst 31 bps (SOLS), then
13 bps (LTRX).** No fill came close to the engine's τ_max caps (40 / 100 / 150 bps for large / mid / small).

- The engine's limits are *marketable*: a buy is priced at ask × (1 + τ), with τ ≥ 15 / 35 / 80 bps. They
  pay the same spread a market order pays.
- A limit adds **tail protection** (a capped worst price in a fast market). It saves nothing on a normal
  fill.
- At current order sizes that protection was worth **≈ 0 bps** in the sample.
- The cost model (`ROUND_TRIP_BPS` 8 / 15 / 30) is conservative against these measurements.

### Portfolio coverage at different account sizes
Today's target book: 27 names, 99% invested, weight-averaged model μ **22.3%/yr**.

"Forgone" is the model-expected return on weight left in cash. It is an upper bound: see the caveat below.

| NAV | Whole shares + $25 min (today) | Fractional market | Hybrid (whole part limit, remainder market) | Share of hybrid notional sent as market |
|---|---|---|---|---|
| $100 | 0% invested, 0 names, forgone **2,203 bps** | 98.9%, 27 names, 2 bps | 98.5%, 16 bps | 90% |
| $500 | 14.4%, 2 names, **1,745 bps** | 99.0%, 1 bp | 99.0%, 1 bp | 84% |
| $1,000 | 25.2%, 4 names, **1,498 bps** | 99.0%, 0 | 99.0%, 0 | 73% |
| $2,500 | 41.7%, 11 names, **1,127 bps** | 99.0% | 99.0% | 58% |
| $5,000 | 61.3%, 17 names, **722 bps** | 99.0% | 99.0% | 38% |
| $10,000 | 79.0%, 21 names, **343 bps** | 99.0% | 99.0% | 20% |
| $25,000 | 92.0%, 27 names, **128 bps** | 99.0% | 99.0% | 7% |
| $100,000 | 97.4%, 27 names, **28 bps** | 99.0% | 99.0% | 2% |

**Caveat.** μ is the reports' probability-weighted upside, not realized alpha, and it has not been
backtested. Even if you keep only a quarter of it, whole-share-only is roughly **4–5.5% a year** behind at
$100–$500 NAV. In dollars at $100 NAV that is small, about $5–20 a year. What matters is that the engine
cannot run the strategy at all until about $25k.

**Execution cost of fractional market orders:** ~2 bps a trade (measured). At 100–200% annual turnover
that is about **2–4 bps a year**. That is two to three orders of magnitude below the coverage gain at
small NAV.

### The sliding scale you asked about
**Feasible.** The hybrid split produces it naturally. Each order is split into:
- the **whole-share part**, sent as a LIMIT (emulated IOC, C1a), which keeps τ-capped tail protection
  where size makes it matter;
- the **fractional remainder** (≥ $1), sent as MARKET, as Schwab requires.

The market share of notional falls on its own as NAV grows: 90% at $100, 58% at $2.5k, 20% at $10k, 2% at
$100k.

This is better than an explicit NAV-based dial. Limit protection matters by *order size against
liquidity*, which is known per order, not by account size. Two optional refinements:
- `marketOnlyBelowUsd` (e.g. $200): send an order this small entirely at market rather than splitting it
  into two orders.
- A market-order spread gate: skip or defer if the quoted spread is wider than about 1% (large/mid) or
  about 2.5% (small). This replaces τ_max as the tail guard for the market part. The existing gap-halt
  and freshness gates still apply.

---

## 4. Other strategy and function findings (not blocking)

| # | Finding | Impact | Suggested fix |
|---|---|---|---|
| S1 | `minOrderUsd` is a fixed $25 | Blocks every trade below ~$500 NAV | Make it NAV-relative, e.g. `max($1, 0.5% NAV)` with fractional orders, or `$25` without. **See Q3 because it changes how often locks fire.** |
| S2 | `tradeBand` is a fixed 2.5 pp | For names targeted at 1–2.5% the band is as big as the position, so they are never topped up or trimmed until they drift a whole position's worth | Relative band, e.g. `max(0.75 pp, 25% × target)` |
| S3 | μ is uncalibrated | The largest strategy risk: sizing trusts the report upside | Log predicted μ against realized 3/6/12-month return per name in `trade:review`; recalibrate later (backtest harness, deferred) |
| S4 | No liquidity-aware per-name cap | EVLV (~$4.80 small-cap) holds the full 10%, and AIP is hard-to-borrow; fine at today's size | Only binds above ~$1M; defer |
| F1 | A DAY order left working after a run | Would halt the next reconcile | Cancel on timeout (part of C1) |
| F2 | `timeInForce` typed as `"ioc"` only | Can't express MARKET or FOK | Widen `OrderRequest` to `{ type: "limit" \| "market", tif }` |
| F3 | Fractional quantities in `fills.jsonl` / reconcile | Already float-safe (the manual fractional fills reconcile cleanly) | Add a 4-dp rounding guard on qty |

---

## 5. Recommended change set (awaiting approval)

1. **C1 + C2:** Schwab emulated IOC (DAY limit, poll, cancel, confirm terminal), plus a per-order
   definitive-reject path. *Needed before any live Schwab run, whatever else is decided.*
2. **Hybrid execution:** whole-share limit plus fractional market remainder, with `marketOnlyBelowUsd` and
   a spread gate. Fixes C3, and exits sell the exact position.
3. **S1 / S2:** NAV-relative dust floor and relative band. Values follow the owner's answer to Q3.
4. **S3:** add μ-versus-realized tracking to `trade:review`.

## 6. Questions for the owner

- **Q1.** Items 2–3 reverse the earlier "whole shares only" rule, now that the API is shown to take
  fractional MARKET orders. Confirm the reversal?
- **Q2.** For C1: emulated IOC (keeps partial fills) or FILL_OR_KILL (simpler, all-or-nothing)?
- **Q3 (lock-related).** Locks are unchanged. But every fill starts a 5-day, both-sides lock on that
  ticker, and fractional orders mean far more trades actually fill. With a $1 minimum, a $2 top-up would
  freeze selling that whole ticker for 5 business days. Proposed: keep a real minimum trade size, e.g.
  `max($5, 1% NAV)` for adds and trims (ENTER and EXIT unaffected), so that trivial rebalances never start
  a lock. Which floor do you want?
