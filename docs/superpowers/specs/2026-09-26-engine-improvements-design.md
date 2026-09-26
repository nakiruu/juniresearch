# Engine "Better idea" Review — Verdicts, Spec & Implementation Plan

**Date:** 2026-09-26. **Scope:** every "💡 Better idea" callout in `docs/engine.md` except the two the
owner ruled out (per-lot locks — breaks the trading-restriction rules; fractional shares — Schwab is the
live broker). **Status:** design only; nothing here is wired in.

## Method

Each idea was checked three ways:

1. **Claim vs code.** The doc's description was verified against the source (file:line cited).
2. **Is it truly better.**
   - Signal and sizing ideas were run through the repo's own `buildSignal`, `sizePortfolio` and
     `makeV2Scorer` on all 68 published reports. Each report is marked at its own `quote.currentPrice`;
     live prices were unavailable offline.
   - The baseline book is 36 eligible names, 36 held, 1.0% cash, N_eff 25.96.
   - Trade-layer ideas were judged on the code: locks and compliance, broker behaviour
     (Alpaca paper vs Schwab live), idempotency, and whether something already covers the gap.
3. **Verdict.**
   - **ADOPT** — build it.
   - **ADOPT-WITH-CHANGES** — build a modified version.
   - **DEFER** — needs data or a harness first.
   - **REJECT** — don't build it.

No `data/trade/` run records exist in the repo, so figures quoted from live runs (the "66% capBound",
the "75–80% deployed") could not be re-verified. They are reasoned about from the code instead.

## Summary

| # | Idea (engine.md §) | Verdict | Effort | Priority |
|---|---|---|---|---|
| 13 | ET-based `today` **+ Schwab clock fix** (§7) | **ADOPT** | S | **P0** |
| 7 | Orders check in reconcile (§4.1) | **ADOPT-WITH-CHANGES** | M | **P0** |
| 10 | Broker timeouts + latency timestamps (§5.3) | **ADOPT-WITH-CHANGES** | M | **P0** |
| 12 | Proactive Schwab re-auth warning (§7) | **ADOPT** | S | P1 |
| 9 | τ_max / early-session spread (§5.3) | **ADOPT-WITH-CHANGES** (instrument; don't tune) | S–M | P1 |
| 11 | Cron bootstrap / turnover breaker (§6.1) | **ADOPT-WITH-CHANGES** (clip, never exempt) | M | P1 |
| 8 | Same-session top-up loop (§4.3) | **DEFER** the loop; **ADOPT** residual band instead | S | P2 |
| 2 | Dispersion-widened rating bands (§1.3) | **ADOPT-WITH-CHANGES** (via `decide()` policy, off) | S–M | P2 |
| 1 | Touch probability (§1.3) | **ADOPT-WITH-CHANGES** (display only) | S | P3 |
| 6 | kellyTilt / raw Kelly (§3.6) | Rejection **confirmed**; kellyTilt **DEFER** (needs harness) | M–L | P3 |
| 3 | Blend σ with realized vol (§2) | **DEFER** (σ unused in production) | — | — |
| 4 | σ↓ as the risk unit (§2) | **REJECT** | — | — |
| 5 | Mean-CVaR allocation (§3.2) | **REJECT** | — | — |

**Headline:**

- **The risk-control ideas are worth more than the doc suggests.** The investigation turned up
  compliance-relevant gaps the callouts don't mention (below).
- **The signal "better ideas" mostly don't survive quantification.** With 3 scenarios per report,
  σ↓ and CVaR collapse to the bear leg D that R already uses.

### New findings not in `engine.md`

These should be fixed regardless of the ideas themselves.

1. **The Schwab clock may fail open after hours.**
   - `SchwabAdapter.getClock` returns `/markets` `isOpen` (`lib/broker/schwab.ts:77`), which is believed
     to be a *date-level* flag ("trades on this date"), not "open now". This is **unverified** — confirm
     against a real response first.
   - If confirmed, the market-clock guard on the **live** broker would pass at 21:00.
2. **The standalone `trade:audit` does not work on Schwab.**
   - The clientOrderId↔orderId map is held only in memory (`schwab.ts:53,153`).
   - A fresh process therefore sees every expected order as MISSING_SUBMISSION and every fill as
     ORPHAN_FILL (critical).
3. **A broker-truth CRITICAL is not sticky.** It bumps the halt counter once (`cron.ts:199`), and the
   next day's run proceeds. A missed sell fill can then be followed by a same-ticker buy inside the lock
   window.
4. **Manual trades in the Schwab account are invisible.** A manual sell, or a manual buy of a name
   already held, is caught by neither `reconcile` nor the audit, which filters out foreign cids
   (`audit.ts:44-47`).
5. **Schwab positions default to `[]`** (`schwab.ts:31`). If the field is ever missing, the book looks
   flat while NAV still includes the positions. Any turnover exemption must survive this.
6. **Alpaca `getOrders("all")` has no `after` bound and sorts ascending with `limit 500`**
   (`alpaca.ts:70-71`). Past 500 orders, the fill poll may never see the new order.
7. **The Windows task uses `-StartWhenAvailable`** (`register-trade-cron.ps1:26`), so a missed 09:45
   fires late. That contradicts the `.sh` comment. In-process catch-up can also trade at any open hour
   (`scheduler.ts:51-53`), and `runCron` has no fire-window guard.
8. **Tier-3 buys are double-counted by the notional guard.** The guard uses `deltaUsd`, which is taken
   before the ×0.5 size multiplier (`pipeline.ts:80`).
9. **The staleness constant is an e-folding time, not a half-life.**
   - `exp(−age/90)` (`signal.ts:52`) has a half-life of about 62 days, not 90.
   - The name `stalenessHalfLifeDays` and the engine.md text are wrong.
   - **Owner decision (2026-09-26): make it a true 90-day half-life,** `0.5^(age/90)`. See plan Task 6.1.
10. **"Realized vol already fetched" is false.** No code computes it; only 30 daily closes exist
    (`quote.history`). `docs/superpowers/specs/2026-09-25-trade-layer-phase2-design.md:89` repeats the
    claim.
11. **Band widening already exists.** `decide()` has `applyUncertaintyBands` (`decide.ts:65-76`), which
    is off by default and driven by analyst-target dispersion. engine.md §1.3 doesn't mention it.

---

## P0 — compliance & safety

### 13. `today` from ET, plus the Schwab clock fix — ADOPT (S)

**Findings**

- **The UTC-date pattern is on six trade paths:**
  - `trade-cron.ts:61`
  - `scheduler-wiring.ts:55`
  - `trade-execute.ts:16`
  - `trade-reconcile.ts:5`
  - `trade-plan.ts:9` (default)
  - `schwab.ts:94` (harmless; it widens the window)
- **An ET helper already exists** (`etDateString`, `scheduler.ts:30`). The in-process scheduler uses ET
  for `lastFiredDay` but passes a UTC `today` to `runCron`.
- **Impact:**
  - Lock *dates* are fine, because they derive from the fill's `filledAt`.
  - The lock *check* is wrong: after 20:00 EDT, `isBuyLocked(today)` compares against tomorrow, so a
    lock whose first legal day is tomorrow reads as expired.
  - Alpaca's clock blocks this after the close. Schwab's may not (finding 1).

**Spec**

- **New `lib/trade/clock.ts`:**
  - Move `partsInTZ`, `etWallToUtc` and `etDateString` out of `scheduler.ts`; `scheduler.ts` re-exports
    them.
  - Export `todayET(nowMs = Date.now()): TradingDay` and `etMinutesOfDay(nowMs)`.
- **Call sites:**
  - Replace the six call sites with `todayET()`.
  - Set the fill `tradingDate` from `todayET(Date.parse(filledAt))` (`pipeline.ts:87`).
- **Schwab `getClock`:**
  - `isOpen = flag && regularMarket[0].start ≤ now < regularMarket[0].end`.
  - If session hours are missing, fall back to the NYSE calendar plus 09:30–16:00 ET.
  - **First:** capture a real `/markets` response to confirm the flag semantics.
- **Tests:**
  - `clock.test.ts` covers the UTC-midnight/ET-evening boundary and DST.
  - `schwab.test.ts`: `isOpen:true` at 21:00 ET gives closed.
  - `cron.test.ts`: a 01:00Z `nowMs` gives the previous ET date.
- **Out of scope:** the non-trade scripts (`portfolio-build`, `facts-*`, `synth-build`,
  `lib/facts/manifest.ts`) use the same pattern. They are harmless, but switch them for consistency in
  a later pass.

### 7. Orders check in reconcile — ADOPT-WITH-CHANGES (M)

**Findings**

- The gap is wider than the doc says. `reconcile()` (`ledger.ts:23-28`) checks only that "each held
  symbol has ≥1 buy fill ever":
  - no quantities;
  - no sells;
  - no extra buys of already-held names.
- The audit covers only the current run's cids, so it misses:
  - manual trades;
  - crashes between submit and `appendFill`;
  - fills after the 60-poll window;
  - Schwab fills with missing execution legs, which are skipped silently (`pipeline.ts:86`).

**Changes vs the doc's idea**

- Join on the **broker orderId** already stored in `fills.jsonl`, not the cid. This works on Schwab and
  for manual orders.
- Check both sides and the quantities.
- Look back only over the lock window.

**Spec**

- **`reconcile(input & { brokerOrders?: BrokerOrder[]; lockWindowStart?: TradingDay })`:**
  - For each order with `filledQty > 0` dated on or after the window start, the recorded fills for that
    orderId must sum to `filledQty` (±1e-6). Otherwise throw
    `ReconcileError("broker order <id> <side> <sym> filled N, recorded M — append the fill")`.
  - Any non-terminal order also throws, since IOC orders never legitimately rest.
  - Optionally warn (not halt) when net fill qty differs from broker qty, because splits break that
    comparison.
- **`pipeline.ts` `planRun` and `trade-reconcile.ts`:**
  - `lockWindowStart = today − (lockBusinessDays + 1)` trading days.
  - Fetch with `getOrders("all", lockWindowStart)`.
- **Config:** `reconcileOrders: true` on Schwab. On Alpaca, set it to true after one clean smoke run.
- **Fix together:**
  - Give Alpaca's `getOrders` an `after` bound (finding 6).
  - Make `trade:audit` join on the run record's stored `brokerId`, or persist the Schwab cid map to
    `data/trade/schwab-cid.json` (finding 2).
- **Behaviour:**
  - Cron already turns `ReconcileError` into halt + notify, so a discrepancy now halts **every** run
    until the fill is appended. This makes finding 3 sticky.
  - A manual trade halts cron until the operator appends a `runId:"manual"` fill. That is intended,
    because it keeps the compliance clock.
- **Tests:**
  - Unrecorded sell throws.
  - Partial qty throws.
  - An order outside the window is ignored.
  - An open order throws.
  - A manual order with an unknown cid is still checked by orderId.
  - FakeBroker pipeline: an extra filled sell rejects `planRun`.
  - Schwab audit works from a fresh adapter.

### 10. Broker timeouts and latency timestamps — ADOPT-WITH-CHANGES (M)

**Findings**

- No `AbortSignal` or timeout exists anywhere in the broker/auth fetches. Node's defaults are about
  300 s.
- Only broker `submittedAt` and `filledAt` exist. There is no anchor-capture time, no quote age, and no
  local submit/ack time.
- The freshness reference `nowMs` is taken at run start (`trade-cron.ts:65`), before planning I/O.
- Submits are sequential, with up to 60 s of polling between them, so anchor age grows with order index.

**The key risk the doc missed:** a *submit* timeout leaves it unknown whether the order was placed.

- Schwab has no client order id, and the map is in memory only.
- Blindly retrying risks a double fill.
- Not detecting the fill leaves an unrecorded fill, locks set short, and a compliance breach.

**Spec**

- **`lib/broker/http.ts`:** `fetchWithTimeout(fetchImpl, url, init, ms, phase: "read"|"submit"|"token")`.
  - Uses `AbortSignal.any([init.signal, AbortSignal.timeout(ms)])`, and the body read shares the same
    signal.
  - Throws `BrokerTimeoutError{phase,url}`.
- **Knobs:** `brokerReadTimeoutMs 10000`, `brokerSubmitTimeoutMs 15000`, `tokenTimeoutMs 10000`.
- **Reads:** up to 2 retries (backoff 1 s, then 3 s).
- **Submits are never retried.** On timeout, throw `SubmitOutcomeUnknownError{clientOrderId, symbol,
  submitStartAt}`.
- **New adapter method `findSubmitted(req, sinceIso): Promise<BrokerOrder|null>`:**
  - **Alpaca:** look up by cid.
  - **Schwab:** `getOrders(after = submitStartAt − 5s)`, matched on symbol, instruction, qty, price,
    LIMIT/IOC, `enteredTime ≥ since`, and not already mapped. Retry the lookup at 2, 5 and 10 s.
  - Exactly one match: adopt it.
  - More than one: ambiguous.
- **`executeOrders` on an unknown outcome:**
  - Found: continue polling.
  - Not found or ambiguous: record `status:"unknown"`, **stop submitting the rest of the run**, and have
    cron halt with `reason:"submit-unknown"`, `bumpHalt` and a notify telling the operator to check
    Schwab order history.
- **Per-order timestamps:**
  - `anchorAtMs` (via an injected `clock()`), `quoteTsMs`, `tradeTsMs`;
  - `submitStartAt`, `submitAckAt`;
  - `brokerSubmittedAt`, `terminalAt`.
  - `trade:review` reports p50/p95 for anchor→submit, submit→ack and submit→fill.
- **Defer:** re-anchor an order whose anchor is older than `maxStaleMin[bucket]` at submit time.
- **Tests:**
  - A never-resolving fetch times out (fake timers).
  - Submit timeout, order found: the fill is recorded.
  - Submit timeout, not found: exactly one `submitOrder` call, the run stops, and the status is unknown.
  - Schwab `findSubmitted`, including the ambiguous case.
  - Cron `submit-unknown` halts.

---

## P1 — operations & execution quality

### 12. Proactive Schwab re-auth warning — ADOPT (S)

**Findings**

- `refreshObtainedAt` is already written (`schwab-auth.ts:82`) and preserved across rotation (`:72`),
  but never read.
- The only alert today comes after a failed run (`cron.ts:94`).

**Spec**

- **Pure function `refreshTokenHealth(tokens, nowMs, nextRunMs, cfg)`** returns
  `{level: ok|warn|critical|unknown, expiresAt, remainingMs}`.
  - `expiresAt = refreshObtainedAt + schwabRefreshLifetimeMs` (7 d, a knob).
  - `critical` if `expiresAt ≤ nextRunMs + 15 min`.
  - `warn` if under `schwabAuthWarnHours` (72 h, which covers weekends).
  - `unknown` if the field is missing.
- **Where it runs:**
  - `runCron` preflight, after the kill switch and before the clock check, so it also runs on closed
    days.
  - `trade-execute.ts`.
  - `getSchedulerStatus` (`schwabRefreshExpiresAt`).
  - `trade:auth --status`.
- **Dedup:** `data/trade/auth-warn.json {day, level}` — once per ET day per level, and immediately on
  escalation.
- **Tests:**
  - Level boundaries.
  - Friday check where the token expires Saturday gives critical.
  - Missing field gives unknown.
  - Notify once per day.

### 9. τ_max and the early-session spread — ADOPT-WITH-CHANGES (S–M)

**Findings**

- **Cron time.** `cronTimeET "09:45"` (`config.ts:41`) is read only by the in-process scheduler, which is
  DST-correct. Both register scripts hardcode 09:45:
  - The `.sh` systemd timer uses `America/New_York`. Its fallback and `--cron` mode use box-local time.
  - The `.ps1` uses box-local time plus `-StartWhenAvailable` (finding 7).
- **What capBound means.** `capBound` only happens when `0.5·relSpread > τ_max`: spreads above 0.8%, 2%
  and 3% for large, mid and small caps. That is implausible on NBBO for large caps at 09:36.
- **Likely cause — the feed, not the time of day:**
  - Alpaca's default **IEX** feed (`alpaca.ts:42`) gives thin, wide quotes.
  - Schwab stamps quotes that have no timestamp with `now()` (`schwab.ts:127,131`), so stale quotes pass
    the freshness gate.
  - **Paper runs must not be used to tune τ_max for Schwab.**
- **Recorded vs missing data.** `capBound` is persisted and `trade:review` counts cap-binds. But these
  are missing: `relSpread`, the τ that was wanted, bid/ask, quote age, and per-order `filledQty`
  (dropped in `mergeExecution`, `pipeline.ts:100`). So the "raise τ_max?" question can't be answered
  from the data today.
- **Spread-aware skip: REJECT.** A capped IOC that doesn't fill costs nothing and can catch hidden
  liquidity, so skipping gains nothing.
- **In-run re-quote/retry: DEFER.** It needs new cids and order-count budget.

**Spec**

- **Data capture:**
  - `LimitResult` and `OrderRequest` gain `relSpread`, `tauWanted`, `bid`, `ask`, `quoteAgeMs` and
    `tradeAgeMs`.
  - `ExecutedOrder` gains `filledQty` and `filledAvgPrice`.
- **`trade:review` `capBindStats`:**
  - Fill ratio for capBound vs non-capBound orders.
  - `tauWanted/τ_max` distribution per bucket.
  - Split by broker.
- **Fire-window guard:** `maxLateMin: 20`. `runCron` returns status `"late"` past
  `cronTimeET + maxLateMin`; manual runs pass `ignoreWindow`.
- **Scripts:** drop `-StartWhenAvailable`, or rely on the guard. Make both scripts read or assert
  `cronTimeET`.
- **Revisit τ_max** only after ≥5 **Schwab** runs, and only if capBound fill ratio is below ~50% while
  `tauWanted` sits just above τ_max.
- **Tests:**
  - `tauWanted`/`relSpread` round-trip.
  - Review fill-ratio split.
  - A late fire submits nothing.

### 11. Cron bootstrap and the turnover breaker — ADOPT-WITH-CHANGES (M)

**Findings**

- The breaker sums `|qty·limitPrice|` (`breakers.ts:17-20`), and only in cron.
- The guard sums `deltaUsd` (`pipeline.ts:80`), which is taken before the size multiplier and flooring,
  so tier-3 buys are counted about 2×.
- `trade:execute` already covers a one-time bootstrap.
- **A general ENTER or from-flat exemption is a real hole — REJECT it:**
  - A broken reconcile, or a missing Schwab `positions` key (finding 5), turns every holding into an
    ENTER, and the whole target gets re-bought.
  - A wave of new reports is exactly the case the breaker exists for.

**Spec**

1. **Clip instead of halt, for ENTER-only plans.**
   - If the breaker trips and the plan has no sells or ADDs, keep whole orders in descending
     target-weight order up to the cap.
   - Skip the rest as `TURNOVER_CLIP` and don't bump the halt counter.
   - Every run stays at or below 15% NAV, and it stays safe even if reconcile is wrong.
   - Implemented as `clipToTurnover(orders, nav, cfg)` in `breakers.ts`, applied at `cron.ts:158`.
   - Notify on every clip.
2. **Optional fast bootstrap.** `maxBootstrapTurnoverFrac: 1.0`, only when **all** of these hold:
   - `TRADE_BOOTSTRAP=1` and the config flag are set;
   - broker positions are empty;
   - `cash/equity ≥ 0.98`;
   - net fills.jsonl qty is 0 for every ticker;
   - the plan is ENTER-only.
   - Log it and notify loudly.
3. **Cash backstop in guards (worth adopting on its own for Schwab).** Refuse a buy once cumulative buy
   notional exceeds `account.cash + recorded sell proceeds − cashFloor·NAV`. This is never-leverage,
   checked against broker truth.
4. **Align the measures.** Set `estNotionalUsd = qty·limitPrice` at `pipeline.ts:80`. That is the true
   maximum an IOC limit buy can spend.

- **Tests:**
  - The clip keeps the top-weight orders and stays ≤ cap.
  - A mixed plan still trips.
  - The clip path executes without bumping the halt counter.
  - Bootstrap halts without the env flag, with positions present, or with cash below 98%.
  - Cash backstop.

---

## P2

### 8. Same-session top-up loop — DEFER the loop; ADOPT a residual band (S)

**Findings**

- The residual is abandoned because after a partial ENTER the name is HOLD, and its gap is under the
  2.5pp band (`rebalance.ts:85-92`).
- Two other causes of under-deployment are intended:
  - tier-3 halving;
  - whole-share flooring.
- The "75–80%" figure comes from Alpaca paper's *simulated* partials and may not describe Schwab IOC.

**Why not an immediate loop**

- An IOC that missed seconds ago mostly misses again, or the re-anchor chases the price.
- Pass 2 generates the **same clientOrderId** (`sha(runId|ticker|side|today)`, `orders.ts:27`), which
  Alpaca rejects.
- The turnover breaker is per-plan, not cumulative.
- Pass 2 must also re-derive locks from fills, since a pass-1 TRIM then a pass-2 ADD would be a
  violation.
- A second cron run today would **noop** anyway, because the band — not timing — is the blocker.

**Spec**

- **Residual band.** In the HOLD branch of `emitTrades`:
  - If `d > 0` and the name is sell-locked (a buy filled inside the lock window), compare against
    `cfg.residualBand` (0.005) instead of `tradeBand`.
  - This is a same-side continuation of a recent entry, and it can't churn because the name can't be
    sold yet.
  - Buys only. `minOrderUsd` still applies.
  - Knobs: `topUpRecentBuys: false`; `resolveTradeConfig` enforces `residualBand ≤ tradeBand`.
- **Optional second scheduled run** (e.g. 10:40 ET) in both register scripts. It needs no loop code:
  - a new runId, so new cids;
  - its own re-plan, locks, breakers, audit and notify.
  - Optional daily cap: `maxDayTurnoverFrac 0.25`, summed from today's run records.
- **Tests:**
  - A locked-held name with a 1pp gap gives ADD.
  - Unlocked gives BELOW_BAND.
  - The sell side never gets the exemption.
  - A second same-day FakeBroker run tops up with distinct cids.

### 2. Dispersion-widened rating bands — ADOPT-WITH-CHANGES (S–M)

**Findings**

- **The idea half-exists already** as `decide()` `applyUncertaintyBands` (finding 11). It is off, and
  its tier multipliers are 1.0/1.2/1.8/2.5.
- **Scenario σ vs report price:** median 0.23 (IQR 0.18–0.33, max 0.80). It correlates with the
  uncertainty tier at Spearman 0.55, so they are related but not redundant.
- **Label impact on the 68 reports (39 BUY, 29 HOLD today):**
  - buy-side multiplier `clamp(σ/median, 1, 2.5)`: 3 labels change (EVLV and LTRX SB→B, KTOS B→H);
  - the existing tier multiplier: 0 labels change;
  - a hurdle of 0.5σ: 8 labels change, including 4 names that lose buy-side.
- **Retroactive risk.** `validate-judgment.ts:25-31` requires the published label to be ≤ the derived
  label. Editing `deriveLabel` in place would make already-published KTOS fail validation.

**Spec**

- Keep `deriveLabel` unchanged.
- Add `DecisionInputs.uncertainty.scenarioDispersion?: number` and a policy knob
  `applyDispersionBands: false`.
- Desk config: `rating.dispersionBands {ref: 0.25, maxMult: 2.5}`.
- Effective multiplier: `max(tierMult, clamp(σ/ref, 1, maxMult))` — buy side only, and only ever moves
  toward HOLD.
- Stamp `decision.policyVersion` so old reports validate under the rules they were published with.
- **Tests:**
  - Knob off gives identical output.
  - The KTOS/EVLV fixtures change as predicted.
  - The label is never more bullish than without the knob.
  - Old-version reports still validate.

---

## P3

### 1. Touch probability — ADOPT-WITH-CHANGES, display only (S)

**Findings**

- No prototype remains in the tree or in git history.
- There is no realized-vol code (finding 10).
- P_touch was computed on the 36 eligible names (target = fair value, 30-day realized σ, T = 1 y,
  zero drift). It ranges from 0.20 to 0.77.
- Spearman correlations of P_touch:
  - with realized vol: **+0.73**;
  - with R: **−0.58**;
  - with κ: −0.35;
  - with the production score: −0.35.
- **Conclusion:** as a filter or tie-breaker it would steer the book toward high-vol names — confirmed
  harmful. It is useful only as a "how plausible is this target within a year" flag.
- The scenarios have no stated horizon, so T = 1 y is an assumption.

**Spec**

- **`lib/portfolio/touch.ts`:**
  - `realizedVol(closes, annualize = 252)` — needs ≥20 returns.
  - `touchProbability(S0, H, σ, ν, T)` — H ≤ S0 returns 1.
- The Signal gains an optional `touch`, surfaced in the snapshot, CSV and dashboard.
- Knobs: `touchHorizonYears 1`, `touchDrift "zero"`, `showTouch false`.
- A guard test proves `scoreWeight` and eligibility ignore it.
- Label it as a model output. 30 closes gives about 13% relative error on σ.

### 6. kellyTilt and raw Kelly — rejection confirmed; kellyTilt DEFER (M–L)

**Raw Kelly `κ·μ/σ²` stays rejected:**

- 36 of 36 eligible names clear the 10% cap (KTOS at 54% up to V at 424%). Even at α = 0.4 they still
  all clear it.
- Spearman with σ is −0.85, so it ranks the lowest-σ names first.
- The engine.md figures differ only because they used live prices.

**kellyTilt can't be evaluated:**

- No backtest harness exists (`run-record.ts` is only the format).
- `RunRecord.signals` omits σ, σ↓, D and the scenarios, so σ-based ideas can't be replayed later.

**Spec**

- **Now (cheap):** add `sigma`, `sigmaDown`, `D` and `scenarios` to `RunRecord.signals` so history
  accumulates.
- **Later:**
  - `lib/portfolio/backtest.ts` `replay(records, scorer, config) → {returns, turnover, nEff}`.
  - `scripts/backtest.ts` comparing score vs kellyTilt vs 1/N.
- Point-in-time history is thin (e.g. `data/nvda.json` has 3 revisions), so statistical power will be
  low for months.

### 3. Blend σ with realized vol — DEFER

- σ feeds scoring only through `sizing-v2.ts:58` when `riskCore === "invSigma"`. That mode is not the
  default and has no CLI flag. Otherwise σ is display-only.
- A 50/50 blend inside invSigma moves N_eff from 31.8 to 30.1 with 6.9% turnover. That is no production
  effect.
- **Revisit** only if invSigma is A/B'd. Then build `realizedVol` (from idea 1) on ≥252 closes and add
  `sigmaBlend = 0`.

### 4. σ↓ as the risk unit — REJECT

- 66 of 68 reports have exactly one scenario below price. There, σ↓ = √p_bear · D exactly, so
  μ/σ↓ = R/√p_bear.
- p_bear is 0.25 or 0.30 for 62 names, and it is already inside μ.
- **Measured:**
  - Spearman(R, μ/σ↓) = 0.996 overall and 0.978 among eligible names.
  - Swapping it into the score changes N_eff from 26.0 to 26.6 with 1.8% turnover.
- It adds nothing with 3 scenarios. Revisit only if reports move to 5+ scenarios.

### 5. Mean-CVaR — REJECT

- **Single-name CVaR is just D.** For α ≤ p_worst, single-name CVaR_α equals the worst-leg loss D. That
  holds for all 68 names at α ≤ 0.20.
- **Portfolio CVaR has nothing to work with.** It needs a joint distribution, and there is none:
  - Assuming comonotonic bears makes it an LP with bang-bang solutions.
    - λ = 0 or 0.5: 10 names at the cap.
    - λ = 1: 5 names plus about 50% cash.
    - λ ≥ 2: an empty book.
    - N_eff ≤ 10, vs 26 today.
  - Assuming independence would be invented.
- **Net:** it becomes a cruder, more concentrated μ − λD that drops κ and per-name explainability.

---

## Implementation plan

Order is by risk reduction per unit of effort. Each phase is its own branch/PR with tests, and it ships
to Alpaca paper before Schwab.

| Phase | Items | Why first | Effort |
|---|---|---|---|
| **1 — compliance clock** | 13 (`todayET`, Schwab `getClock` — verify flag first), 9's fire-window guard + drop `-StartWhenAvailable` | Stops live after-hours trading and wrong-day lock checks. Small and mechanical. | ~1 day |
| **2 — broker truth** | 7 (orderId-joined reconcile, Alpaca `after` bound, Schwab-safe `trade:audit`), 10 (timeouts, `SubmitOutcomeUnknown`, `findSubmitted`) | Closes every path to an unrecorded fill: manual trades, crashes, late fills, unknown submits. | ~3–4 days |
| **3 — guardrails** | 11 (align notional, cash backstop, clip-to-turnover; optional bootstrap), 12 (re-auth health) | Safer unattended operation, with no loosening of the breaker. | ~2–3 days |
| **4 — observability** | 9 (spread/τ/fill diagnostics + `capBindStats`), 10's latency timestamps, 6's `RunRecord.signals` fields | Starts collecting the data that the τ_max and kellyTilt decisions need. | ~1–2 days |
| **5 — deployment** | 8 (residual band, off → paper → on; optional 10:40 run) | Only after phase 2, so the extra orders are fully audited. | ~1 day |
| **6 — research** | 2 (dispersion bands, versioned policy), 1 (touch display), staleness naming fix (finding 9) | Affects only new reports and display, with no trading impact. | ~2 days |
| **Later / data-gated** | τ_max tuning (≥5 Schwab runs), backtest harness + kellyTilt A/B, 3 | Needs history. | — |
| **Dropped** | 4, 5 (and per-lot locks, fractional — owner rules) | Don't pass quantification. | — |

**Doc follow-up.** After each phase lands, update `docs/engine.md` in the same PR:

- Replace the callout with a description of the implemented behaviour.
- Mark 4 and 5 "🚫 Not an option" (quantified).
- Correct the half-life wording and the "realized vol already fetched" claim.
