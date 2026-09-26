# Juniper Engine — Functional Reference

> A single end-to-end description of how the engine turns a published research report into
> live orders: how a *buy* is derived, how the engine interprets it, how buys and sells are
> sized and placed, and every piece of math and statistics in between.
>
> **Status:** the research → rating → portfolio path is on `main`; the trade layer + multi-broker
> (Alpaca paper / Schwab live) + Discord notifier + Linux scheduler live on branch `trade-layer`
> (unmerged, gated). Defaults quoted here are the code defaults as of 2026-09-25.
>
> **How to read the "💡 Better idea" callouts:** they mark points where a defensible alternative
> exists. They are design notes, not TODOs — none is wired in. "🚫 Not an option" callouts mark
> alternatives that are ruled out by the owner's trading rules or the live broker — don't propose them.

---

## 0. The pipeline at a glance

```
 research report                signal                 book                    trades                 orders                fills
 (scenarios, rating)   ─►  buildSignal (μ,σ,R,κ,Q) ─► sizePortfolio ─► emitTrades (hysteresis+band) ─► tradesToOrders ─► broker
 lib/synth/*, data/<t>.json     lib/portfolio/signal    lib/portfolio/sizing   lib/trade/rebalance        lib/trade/orders     lib/broker/*
                                                             │                        │  +limit.ts (pricing)      +audit, breakers
                                                        (analytical snapshot)    (ledger, locks, breakers, cron)
```

Two consumers share the same signal layer:

- **`portfolio:build`** — the *analytical* snapshot & dashboard. Prices from Yahoo. Read-only, no broker.
- **`trade:plan` / `trade:execute` / `trade:cron`** — the *trading* engine. Prices, positions, and fills
  from the broker (Alpaca paper or Schwab live). The trade layer adds hysteresis, locks, the no-trade
  band, slippage-capped limit pricing, run breakers, a broker-truth audit, and notifications on top of
  the same sizing core.

Everything below follows a single name from report to fill.

---

## 1. Where a "buy" is born — the research & rating layer

A *buy* is not decided by the engine; it is **inherited from the published report** and then re-tested
against live price. The report (`data/<ticker>.json`, authored via the `synthesize` skill) carries a
valuation with **probability-weighted scenarios** — each an `impliedPrice` and a `probability` — and a
`rating`.

### 1.1 Conviction: E, D, R  (`lib/synth/conviction.ts`)

```
fairValue        = Σ pᵢ · impliedPriceᵢ                 (probability-weighted)
E (expectedUpside) = fairValue / price − 1
D (bearDownside)   = (price − bearImpliedPrice) / price   (the scenario named "bear")
R (rewardRisk)     = E / D           (null when D ≤ 0 — no downside to divide by)
```

`E` is the reward, `D` the bear-case loss, `R` the reward earned per unit of bear-case risk. `R` is the
engine's central risk unit and recurs at every later stage.

### 1.2 The label (`deriveLabel`)

Bands are evaluated top-down; first match wins; a null `R` never satisfies a `≥` test:

```
E ≤ strongSell.maxUpside                                   → STRONG SELL
E ≤ sell.maxUpside                                         → SELL
E ≥ strongBuy.minUpside  AND R ≥ strongBuy.minRewardRisk  → STRONG BUY
E ≥ buy.minUpside        AND R ≥ buy.minRewardRisk         → BUY
else                                                      → HOLD
```

The author may publish **one notch more conservative** than the derived label (STRONG BUY→BUY→HOLD…),
never more aggressive (`conservativeNotch`).

### 1.3 The gate and decision conviction (`lib/synth/decide.ts`, `gates.ts`)

A separate scoring layer produces:

- **`rating.gate`** — a sector-aware quality gate (distress, Piotroski, accruals, moat) that yields a
  **`gatedLabel`** *ceiling*. A name can be headline-BUY but gate-capped to HOLD (e.g. RCAT, UMAC on
  earnings quality). The engine requires **both** labels to be buy-side.
- **`rating.decision.conviction`** — a **0–100** score from a penalty model over the gate + intrinsic
  reverse-DCF + moat (ROIC−WACC) + a cross-sectional composite percentile. This becomes **κ** downstream.

> 💡 **Better idea — a probability-of-reaching-target metric.** Conviction today is a static penalty
> score. A GBM first-passage ("touch") probability, `P_touch = Φ(d₊) + (H/S₀)^(2ν/σ²)·Φ(d₋)`, would add a
> *time-and-volatility-aware* estimate of actually reaching fair value. It was prototyped and deliberately
> **not** adopted as a conviction substitute (touch probability rewards volatility and is drift-sensitive),
> but it is a strong candidate as an *additional* data point rather than a replacement.

> 💡 **Better idea — widen bands under uncertainty.** Morningstar-style, the buy/sell thresholds could
> scale with the dispersion of the scenarios (a 3-point spread with 50% mass on one leg is far less certain
> than a tight one). Today the bands are fixed; uncertainty only enters later via σ, which the score sizer
> ignores.

---

## 2. The Signal — a report as numbers  (`lib/portfolio/signal.ts`)

`buildSignal(report, livePrice, sic, today, config)` re-marks the report against the **current price** and
produces the vector every later stage consumes. Let `rᵢ = impliedPriceᵢ / livePrice − 1`:

```
μ  (mu)        = Σ pᵢ · rᵢ                         expected upside (== E, but vs LIVE price)
σ  (sigma)     = √( Σ pᵢ · (rᵢ − μ)² )             scenario standard deviation
σ↓ (sigmaDown) = √( Σ_{rᵢ<0} pᵢ · rᵢ² )            downside semi-deviation
D              = max(0, −min rᵢ)                   worst-scenario loss magnitude
R              = μ / D    (null if D ≤ 0)          reward / risk
κ  (kappa)     = decision.conviction / 100         0..1
Q  (quality)   = clamp( 1 + 0.10·(pctile−50)/50 + 0.20·(moat−0.5) − 0.10·[eroding], 0.8, 1.2 )
staleness      = 0.5 ^ ( ageDays / 90 )             soft recency decay (true half-life 90d)
sector         = ⌊SIC / 100⌋   (2-digit group)
```

where `moat = {WIDE:1, NARROW:0.5, NONE:0, unknown:0.25}`, `pctile` is the composite percentile, and
`[eroding]` is 1 when the moat trend is ERODING.

Notes that matter downstream:
- **μ is re-marked to live price** every run — as price rises toward fair value, μ (and R) fall. This is
  what makes the book mechanically buy dips and trim rallies.
- **R here uses the empirically worst scenario** as the bear, which equals the report's named bear when
  that is the lowest leg (the usual case).

> 💡 **Better idea — the scenario σ is fragile.** σ and σ↓ come from a **3-point** distribution; a
> point-mass estimator of variance is noisy and error is amplified in any σ-based optimizer (Michaud). A
> blend with **trailing realized volatility** (already fetched for the touch-probability work) would give a
> more stable risk number. Note the production score sizer sidesteps this by not using σ at all (§3.2);
> only the experimental kellyTilt `invSigma` core would benefit directly.

> 💡 **Better idea — σ↓ is computed but unused.** A downside-only risk unit (Sortino-style `μ/σ↓`, or
> `R` blended with σ↓) is arguably a better "risk" than either the single bear leg or full σ. It is already
> in the Signal; nothing consumes it.

---

## 3. Interpreting the buy — eligibility & the target book  (`lib/portfolio/sizing.ts`)

The analytical book (`portfolio:build`) turns Signals into target weights. The trade layer reuses this
exact code and only swaps the *entry/exit test* for a two-sided band (§4).

### 3.1 Eligibility gate  (`lib/portfolio/eligibility.ts`)

A name is **eligible** only if *all* hold (defaults in parentheses):

```
not banned (ICE hard-ban, §3.5)
label ∈ {BUY, STRONG BUY}          AND   gatedLabel ∈ {BUY, STRONG BUY}
μ ≥ muMin (0.05)
R ≥ rMin  (0.50)          (null R fails)
κ·100 ≥ convictionMin (45)
ageDays ≤ stalenessMaxDays (120)
```

Every ineligible name is retained in the snapshot's `excluded[]` with its reasons, so the screen stays
auditable (this is what the dashboard's "Considered & excluded" panel renders).

### 3.2 The score (production sizer)  (`scoreWeight`)

```
score = μ^muExp · κ^convExp · R^rExp · staleness · (Q if useQualityTilt else 1)
      = μ¹ · κ¹ · R¹ · staleness            (defaults: all exponents 1, tilt off in the analytical snapshot)
```

Weight is then allocated *in proportion to score*, so the best names on (expected return × conviction ×
reward/risk) become the largest holdings. Exponents are tunable knobs (`--muExp/--convExp/--rExp`).

> 💡 **Better idea — the score is a heuristic, not a utility maximization.** `μ·κ·R` is a defensible
> ranking but not derived from an objective (Kelly, mean-variance, or mean-CVaR). A **mean-CVaR** allocation
> using σ↓ / the bear leg would optimize the thing the desk actually cares about (downside) rather than a
> product of factors. The tradeoff is transparency: the current score is trivially explainable per name.

### 3.3 Water-fill allocation with caps  (`allocateCapped`)

`target = 1 − cashFloor` (0.99) is distributed proportional to score, then **water-filled**:

1. Hand out remaining capacity ∝ score; any name reaching **wMax (0.10)** is clamped and frozen.
2. Any sector over **sectorMax (0.30)** is scaled to exactly the cap and frozen; the shed weight returns
   to the next pass.
3. Repeat until the remainder is placed or nothing else can absorb it.

Freed weight flows to the **best remaining names**, never leaking to cash or flattening everyone to the
cap. If the caps *cannot* absorb the target (too few names/sectors), the shortfall becomes cash — the
honest "not enough to hold under the caps" outcome, **never leverage**.

Then **dust** below `wMin` (default 0 → keep every eligible name) is dropped and survivors re-allocated to
a fixed point. `cash = 1 − Σ weights` (emergent, never a target).

### 3.4 Portfolio statistics  (`lib/portfolio/benchmark.ts`, snapshot)

```
activeWeight_i  = w_i − 1/N_universe          tilt vs a naive equal-weight of the WHOLE research universe
N_eff           = 1 / Σ w_i²                  inverse-Herfindahl effective number of names (diversification)
portfolio upside = Σ w_i · μ_i                book-level weighted expected upside
```

> ⚠️ **Read `activeWeight` correctly.** The benchmark is a **1/N equal-weight of the covered universe**,
> not the S&P 500. A name sized below 1/N legitimately shows a small negative tilt.

### 3.5 The hard ban (compliance, not a knob)  (`BANNED_TICKERS`)

`ICE` is hard-banned — the owner is an ICE employee. The ban lives **outside** `PortfolioConfig` so no
flag or override can switch it off, short-circuits eligibility, is re-checked in `sizePortfolio` (defense
in depth), and is re-checked again at the emitter and broker guard (§4, §5). ICE still surfaces in
`excluded[]` (as a BUY) so the ban stays visible every run.

### 3.6 The experimental alternative — kellyTilt  (`lib/portfolio/sizing-v2.ts`)

Injected via `--model kellyTilt`; shares eligibility, caps, dust and cash unchanged — only the ranking
differs:

```
w_raw = core · (C/50)^α · (Q/50)^β · staleness · L      core = μ·R (default) or μ/σ ;  C = κ·100
        α = convTiltExp (1.0),  β = qualTiltExp (0.6),  L = liquidity factor (large 1.0 / mid 0.9 / small 0.7)
```

`Q` here is a richer **cross-sectional composite** (ROIC, ROE-stability, FCF-conversion, balance sheet,
moat). The signature difference: the score sizer chases cheapened names hard (EVLV to the 10% cap when it
dips); kellyTilt's quality tilt damps that and stays more diversified.

> 💡 **Why μ/σ² (raw Kelly) was rejected — documented so it isn't re-tried.** On this book every name's
> `κ·μ/σ²` clears the 10% cap (V ~239%, KTOS ~35%), so it collapses to capped-equal-weight *and* ranks the
> lowest-σ names to the top — the opposite of a high-growth mandate — while amplifying 3-point-σ error.
> kellyTilt keeps the *centered* tilt on a **bounded** core instead. Still pending a point-in-time backtest
> A/B vs the score sizer and 1/N before it could become default.

---

## 4. From target book to trades — the trade layer  (`lib/trade/`)

`portfolio:build` stops at target weights. The trade layer turns *target vs current* into orders, with the
broker as the source of truth.

### 4.1 Ledger & reconcile  (`lib/trade/ledger.ts`)

The book is **derived from the broker**, not stored: `reconcile()` reads `getAccount` (equity→NAV, cash) +
`getPositions`, and **refuses to guess** — a live position with no explaining buy fill in `fills.jsonl`
throws `ReconcileError` and halts the run. `fills.jsonl` (append-only) is the one record the compliance
locks derive from.

**Orders check (`reconcileOrders`, default on).** `planRun` also fetches the broker's orders over the
lock window (`lockBusinessDays + 1` trading days back) and requires every executed order to be recorded in
`fills.jsonl` for its full quantity, joined on the **broker order id**. That catches what the position
check can't: a missed *sell* (which would leave `buyLockUntil` unset), an extra buy of a name already held,
a crash between submit and fill recording, a fill after the poll window, and manual trades in the account.
Any working (non-terminal) order also halts — this engine only sends IOC. The halt repeats on every run
until the fills are recorded, so a broker-truth CRITICAL (§6.2) can no longer be followed by a trade
against an under-set lock. To record real executions from broker truth:
`npm run trade:reconcile -- --record-missing` (appends them with `runId: "manual"`, printing each).

### 4.2 Two-sided hysteresis  (`lib/trade/hysteresis.ts`)

Entry and exit have **different bars**, keyed on whether the name is currently held, so a winner is never
sold for merely dipping below the entry bar:

```
NOT held → ENTER   iff  buy-side label + gatedLabel, μ ≥ muEnter (0.08), R ≥ rEnter (0.60),
                        κ·100 ≥ convictionMin (45), age ≤ 120d, not banned, not buy-locked
HELD     → EXIT    iff  banned, OR label/gate no longer buy-side, OR μ < muExit (0.03, "thesis played out"),
                        OR R < rExit (0.35), OR stale > 120d
         → HOLD    otherwise  (the whole band muExit..muEnter / rExit..rEnter is a no-churn zone)
```

The gap between `rEnter 0.60` and `rExit 0.35` (and `muEnter 0.08` vs `muExit 0.03`) is the **hysteresis
band** — it exists specifically because a single R gate whipsaws (raising it just relocates the knife-edge
into a denser R region). Locks turn EXIT→`DEFER_EXIT` and ENTER→`BARRED_ENTRY` (§4.4).

`resolveTradeConfig` *enforces* `rExit < rEnter` and `muExit < muEnter` at construction — the band can't be
misconfigured into an overlap.

### 4.3 The emitter — target vs current  (`lib/trade/rebalance.ts` → `emitTrades`)

1. **Freeze** held names with no current signal, and deferred exits (locked) — their weight is held, not
   traded.
2. **Re-size** the `HOLD ∪ ENTER` set with the same `sizePortfolio` core into `1 − cashFloor − frozenWeight`.
3. For each name, compare target `tw` to current `w`:
   - `ENTER` (was 0): buy `tw` (band-exempt — a new position always fires).
   - `HOLD`: `d = tw − w`; **skip if |d| ≤ tradeBand (0.025)** (`BELOW_BAND`), else `ADD` (d>0) or `TRIM` (d<0),
     unless the required side is locked (`BARRED_ADD` / `DEFER_TRIM`).
   - `EXIT`: sell the whole position.
4. **Never leverage:** if frozen + wanted buys would exceed `1 − cashFloor`, buys are scaled down
   (`buyScale`), never cash borrowed; a `plannedCash < 0` assertion is the backstop.

**Residual top-up (`topUpRecentBuys`, default off).** The 2.5pp band would leave the unfilled rest of a
partial IOC entry in cash until drift crosses it. With the knob on, a HOLD name that is **sell-locked** —
bought inside the lock window, so it can't be sold and can't churn — may ADD toward target through the
smaller `residualBand` (0.5pp). Buys only; `minOrderUsd` still applies.

**Extra daily runs (`cronTimesET`, default `["09:45"]`).** Add a later slot (e.g. `"10:40"`) to give
partial fills a second, spaced-out chance; an immediate re-run seconds later mostly meets the same book.
Each slot fires once per day with its own fire window, run id, reconcile, breakers and audit. A daily cap
`maxDayTurnoverFrac` (25% of NAV) bounds the day's runs together.

### 4.4 Locks — the whipsaw / compliance clock  (`lib/trade/locks.ts`)

**Symmetric, whole-ticker, 5 business days** (counting the transaction day → first legal opposite-side
trade on the 6th trading day). A **buy** fill populates `sellLockUntil` (can't sell for 5 days); a **sell**
fill populates `buyLockUntil`. **Same-side adds are not locked** (topping up a partial fill is legal). The
ICE ban is re-enforced here and at the broker guard (buys refused; a disposing *sell* of a banned name is
allowed).

> 🚫 **Not an option — per-lot locking.** The lock is whole-ticker by rule: the owner's trading
> restrictions apply to the whole name, so one fill freezes the ticker. Per-lot locking (trimming an old lot
> while a fresh lot is locked) would break those rules and must not be added.

---

## 5. Pricing & placing orders — execution  (`lib/trade/orders.ts`, `limit.ts`)

### 5.1 Weights → whole-share quantities  (`tradesToOrders`)

Every order is a **whole-share, slippage-capped IOC limit** order:

```
buy  qty = floor( deltaUsd · sizeMult / L )                       (sizeMult from tier-3, §5.3)
EXIT sell qty = full broker position qty                          (no dust left behind)
TRIM sell qty = min( position qty, round( −deltaUsd / mark ) )
skip (skippedDust) if  deltaUsd < minOrderUsd ($25)  or  qty ≤ 0
skip (skippedHalt)  if  computeLimit returns halt (no price / gap)
```

`deltaUsd = round2(deltaWeight · NAV)`. Decisions use the **settled prior-day close** (`markMode:"settled"`);
only the *fill* uses the live price — so the plan is backtest-reproducible while execution still crosses at
a real quote.

> 🚫 **Not an option — fractional shares.** Orders are whole-share by requirement: Schwab is the live
> broker and its API has no fractional shares (Alpaca allows fractional only with `time_in_force:"day"`,
> not IOC, and is paper-only). A high-priced name whose target is < 1 share rounds to 0 and is dropped
> (material only at small NAV); that is accepted, not a gap to close.

### 5.2 Liquidity buckets  (`bucketFor`)

`large ≥ $10B`, `mid ≥ $2B`, else `small`; unknown/`null` market cap → `mid`. Buckets drive τ, τ_max,
gap-halt, and the freshness window.

### 5.3 The limit price  (`computeLimit`)

**Anchor waterfall** (freshness gate, per-bucket `maxStaleMin` = 5 / 15 / 60 min):

```
tier 1  fresh last trade         pRef = lastTrade.price
tier 2  else fresh valid quote   pRef = ask (buy) / bid (sell)      [quote "touch"]
tier 3  else prior close         pRef = close     → BUY size ×0.5 (closeAnchorSizeMult)
none    → HALT ("no_price")
```

**Gap-halt** (on a *clean* reference — last trade if fresh, else quote **mid**, else close; never the
touch): halt if `|clean_ref − close| / close > gapHalt[bucket]` (0.10 / 0.15 / 0.25). A wide-but-clean
quote never halts on its own.

**Tolerance** τ (spread-aware, bucketed):

```
base = limitTol[bucket]              (buy: 0.0015 / 0.0035 / 0.0080;  sell: ×exitTolMult 1.5)
τ    = clamp( max(base, limitTolBeta·relSpread), limitTolMin (0.0005), limitTolMax[bucket] )
       limitTolBeta = 0.5 ;  limitTolMax = 0.0040 / 0.0100 / 0.0150 ;  relSpread clamped ≤ 0.10
```

**Hard cap** (tick-inclusive, so the cap itself is always a legal submittable price; `tick = $0.01` at
≥$1, else `$0.0001`):

```
buy:   L = min( ceil_tick(pRef·(1+τ)),  floor_tick(pRef·(1+τ_max)) )      capBound if the cap binds
sell:  L = max( floor_tick(pRef·(1−τ)), ceil_tick(pRef·(1−τ_max)) )
```

IOC means an unmarketable order (or partial) **cancels the remainder** — a **non-fill is a feature**, the
slippage cap refusing to chase.

> 💡 **Better idea — τ_max clamps inside the early-session spread.** On the first live run, ~66% of orders
> were `capBound`: `β·relSpread` wanted a wider limit than τ_max at 09:36, so the limit sat inside the
> spread and only caught thin liquidity → heavy partials. Two fixes, both cheap: **fire at 09:45** (already
> the configured `cronTimeET`; deeper/tighter spreads) and, only after ≥3–5 runs of data, consider raising
> τ_max. Do **not** tune τ on one run.

**Timeouts and unknown submits (`lib/broker/http.ts`).** Every broker/OAuth request has a deadline over
headers and body (read 10s, submit 15s, token 10s); only idempotent reads are retried (1s, 3s). An order
submit is **never** retried: a timeout, network failure, 5xx, or a Schwab 2xx with no order id raises
`SubmitOutcomeUnknownError`, and `executeOrders` looks the order up with `findSubmitted` (Alpaca by
`client_order_id`; Schwab by exact symbol/side/qty/price/type/duration since the submit, refusing to guess
between two matches) at 2s/5s/10s. Found → polled and recorded as usual. Not found → the order is recorded
as `unknown`, **no further orders are sent**, and cron halts (`submit-unknown`). If the lost order did
execute, the next run's reconcile orders-check halts until it is recorded.

**Execution telemetry.** Every run-record order carries the anchor (`pRef`, `anchorAtMs`), the τ used and
the τ the spread *wanted* before the cap (`diag.tauWanted`, `relSpread`, bid/ask, quote/trade ages), plus
`filledQty`, `filledAvgPrice` and local `submitStartAt` / `submitAckAt` / `terminalAt`. Freshness is judged
when each ticker's quote was fetched, not at run start. `npm run trade:review` reports, **per broker**
(paper never mixed with live), the fill ratio of cap-bound vs other orders, τ-wanted/τ_max percentiles per
bucket, and latency percentiles — the evidence a τ_max change must wait for (≥5 Schwab runs).

---

## 6. Statistics, risk controls & self-verification

### 6.1 Run breakers  (`lib/trade/breakers.ts`, `guards.ts`)

```
turnover breaker      Σ|qty·limitPrice| > maxRunTurnoverFrac (0.15) · NAV     → halt, submit nothing   [cron only]
consecutive-halt      ≥ consecutiveHaltLimit (3) halted runs in a row         → block further runs
reconcile-halt        unexplained broker position, or an executed order in    → halt (repeats until recorded)
                      the lock window missing from fills.jsonl
submit-unknown        an order submit whose outcome couldn't be established → stop sending, halt
notional guard        Σ|estNotionalUsd| > maxNotionalFrac (1.0) · NAV         → refuse (per-submit)     [guards]
order-count guard     > maxOrdersPerRun (40)                                  → refuse
kill switch           TRADE_DISABLED=1                                        → refuse everything
endpoint guard        broker-aware: alpaca-paper ⇒ paper host, schwab ⇒ schwab host
```

**Turnover clip (`turnoverClipEnterOnly`, default off).** When the breaker trips on a plan that only
*opens* positions (every order an ENTER buy — e.g. building the book from cash), cron sends whole orders,
largest target first, up to the cap and defers the rest (`TURNOVER_CLIP`) instead of halting; the book
fills in over several runs. Any sell/ADD/TRIM still halts, and the cap itself is never raised — so a
wrongly-read book can't turn into a full re-buy. A one-shot manual build still goes through `trade:execute`.

**Cash backstop (guards).** A buy is refused once committed buys would exceed the broker's cash + *filled*
sell proceeds − the cash floor; `executeOrders` sends sells first and skips (never sends) a buy the
backstop refuses. Both caps now measure an order as `qty × limitPrice` — what an IOC limit can spend.

### 6.2 Broker-truth audit  (`lib/trade/audit.ts` → `crossCheckBroker`)

After every execute, the day's broker orders are cross-checked against `fills.jsonl` and the run's expected
orders (joined by `clientOrderId`; on Schwab, absorbed by an in-adapter id↔cid map):

```
UNRECORDED_FILL   broker filled but no local fill        → CRITICAL (under-sets locks/ledger)
ORPHAN_FILL       local fill with no broker order        → CRITICAL
QTY_MISMATCH      recorded qty ≠ broker filledQty        → CRITICAL
PRICE_MISMATCH    recorded avg ≠ broker avg beyond eps   → warn
REJECTED          broker refused the order               → warn
MISSING_SUBMISSION expected order absent at broker        → warn
```

A CRITICAL fails `trade:execute` (non-zero exit) and, in `trade:cron`, halts with `reason:"broker-mismatch"`
+ notify. Run it read-only any time with `npm run trade:audit [-- --run <id>]`.

### 6.3 What the run persists / reports

The run record (`data/trade/runs/<id>.json`) stores marks, signals, classifications, locks, the plan, the
orders (with sector, broker status, id, submittedAt), and fills. `trade:review` produces a weekly digest
(turnover, cash, deferrals, reconciled-every-run, lock violations, cap-binds). The **Discord notifier**
(`lib/trade/notify.ts`) posts a per-run embed (orders, fills, the goal/target book via `goalBook`, cash,
audit) plus halt/auth alerts; best-effort, never fails a run.

---

## 7. Orchestration, brokers & cadence

- **`planRun` → `executeOrders`** (`lib/trade/pipeline.ts`): mark → reconcile → signals → locks → emit →
  size → (submit + poll fills). `trade:cron` (`lib/trade/cron.ts`) wraps it: kill-switch → clock →
  run-lock → consecutive/reconcile/turnover breakers → execute → broker-truth audit → notify.
- **Brokers** (`lib/broker/`): chosen by `BROKER` env via `makeBroker()` — `alpaca-paper` (default, the
  test rig) or `schwab` (LIVE). Both implement one 11-method `BrokerAdapter`; the pure core never names a
  broker. `schwab` is live-by-selection (no paper exists); the guard requires the Schwab host, breakers
  become the only guardrails, and the 7-day OAuth refresh surfaces as `halted(auth)` + alert (`trade:auth`
  to renew). Schwab credentials can also come from env (`SCHWAB_REFRESH_TOKEN`, optional
  `SCHWAB_REFRESH_OBTAINED_AT`, `SCHWAB_ACCOUNT_HASH`) for hosts with no interactive login: the env
  refresh token is tried first and `data/trade/schwab-token.json` is the fallback when it is out of date
  (a stale or rotated-away env token is remembered by fingerprint and never retried). Marks come from the broker (settled close for decisions, live trade/quote for fill anchors).
- **Scheduler:** `register-trade-cron.ps1` (Windows Task Scheduler) / `register-trade-cron.sh` (systemd
  `--user` timer or cron) — both read `cronTimeET` from `lib/trade/config.ts` (09:45 ET) and never fire a
  missed trigger late; broker from `.env.local`.
- **Rollout gate:** Phase 0 (fake dry-run) → Phase 1 (paper smoke: ≥10 runs, exact reconciliation, zero
  lock/ban violations) → Phase 2 (paper event-driven, 4 weeks clean + weekly review). Merge to `main` only
  after that.

**Re-auth warning (`lib/trade/auth-health.ts`).** On Schwab, each cron run first checks whether the
refresh token will still be alive at the next scheduled run: **critical** if it dies before then (renew
today), **warn** under `schwabAuthWarnHours` (72h, covers a weekend), **unknown** if its issue time isn't
known (env token without `SCHWAB_REFRESH_OBTAINED_AT`). Each level notifies at most once per ET day and
immediately on escalation; it never affects the run. `npm run trade:auth -- --status` prints the expiry,
and `GET /api/trade/status` reports `schwabRefreshExpiresAt`.

- **ET clock (`lib/trade/clock.ts`).** `today`, a fill's `tradingDate`, the fire window and the market-hours
  check all read America/New_York through one helper (`todayET`, `etMinutesOfDay`) — a UTC date is already
  tomorrow from 20:00 EDT, which would have run lock checks against the wrong day.
- **Market clock.** Schwab's `/markets` `isOpen` is a *trading-day* flag (true all day and night on a
  weekday — verified against live responses). `SchwabBroker.getClock` is open only inside
  `sessionHours.regularMarket`, falling back to the NYSE calendar + 09:30–16:00 ET.
- **Fire window.** `trade:cron` refuses a run that starts after `cronTimeET + maxLateMin` (20 min) as
  `late` — a missed trigger or a mid-day catch-up is skipped, never traded at an unplanned time. A
  deliberate manual run passes `trade:cron -- --now` (the market clock still applies).

---

## 8. Config reference (defaults)

| Knob | Default | Stage |
|---|---|---|
| `muMin` / `rMin` / `convictionMin` | 0.05 / 0.50 / 45 | eligibility (analytical) |
| `stalenessMaxDays` / `stalenessHalfLifeDays` | 120 / 90 | eligibility / recency |
| `muExp` / `convExp` / `rExp` | 1 / 1 / 1 | score |
| `wMax` / `sectorMax` / `wMin` | 0.10 / 0.30 / 0 | caps / dust |
| `cashFloor` / `cashCeiling` | 0.01 / 0.35 | cash |
| quality tilt `qGainComposite/qGainMoat/qPenaltyEroding/qLo/qHi` | 0.10 / 0.20 / 0.10 / 0.8 / 1.2 | quality |
| `muEnter` / `muExit` | 0.08 / 0.03 | hysteresis |
| `rEnter` / `rExit` | 0.60 / 0.35 | hysteresis |
| `tradeBand` | 0.025 | emitter |
| `lockBusinessDays` | 5 | locks |
| `minOrderUsd` / `maxOrdersPerRun` / `maxNotionalFrac` | 25 / 40 / 1.0 | guards |
| `limitTol` (buy) large/mid/small | 0.0015 / 0.0035 / 0.0080 | limit τ floor |
| `limitTolMax` large/mid/small | 0.0040 / 0.0100 / 0.0150 | limit τ ceiling |
| `limitTolBeta` / `limitTolMin` / `exitTolMult` | 0.5 / 0.0005 / 1.5 | limit τ |
| `gapHalt` large/mid/small | 0.10 / 0.15 / 0.25 | limit gap-halt |
| `maxStaleMin` large/mid/small | 5 / 15 / 60 | anchor freshness |
| `closeAnchorSizeMult` | 0.5 | tier-3 buy size |
| `maxRunTurnoverFrac` / `consecutiveHaltLimit` | 0.15 / 3 | breakers |
| `cronTimeET` | "09:45" | scheduler |
| buckets | large ≥ $10B, mid ≥ $2B, else small (null→mid) | liquidity |

`resolveTradeConfig` enforces the invariants (`rExit < rEnter`, `muExit < muEnter`, `limitTol ≤ limitTolMax ≤ 0.5`,
`gapHalt ∈ (0,1)`, positive freshness, `closeAnchorSizeMult ∈ (0,1]`, etc.) at construction.

## 9. Symbol glossary

| Symbol | Meaning |
|---|---|
| E / μ | expected upside — probability-weighted fair value vs price (E vs report price, μ vs live price) |
| D | bear-case downside magnitude (worst scenario / named bear) |
| R | reward/risk = μ / D (the engine's core risk unit; null when D ≤ 0) |
| σ / σ↓ | scenario standard deviation / downside semi-deviation |
| κ | conviction, `decision.conviction / 100` ∈ [0,1] |
| Q | quality tilt (0.8–1.2 signal-level; a richer 0–100 composite in kellyTilt) |
| L | limit price (order) **or** liquidity factor (kellyTilt) — disambiguated by context |
| τ / τ_max | slippage tolerance / its per-bucket hard cap |
| w / activeWeight | portfolio weight / tilt vs 1/N of the covered universe |
| N_eff | inverse-Herfindahl effective number of holdings |
