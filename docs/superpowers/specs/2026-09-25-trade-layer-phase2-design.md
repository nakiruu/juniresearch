# Trade Layer — Phase 2 Design: event-driven auto-execution (Alpaca Paper)

**Date:** 2026-09-25
**Status:** Approved (owner, this session, incl. execution-layer review); ready for writing-plans
**Author:** Nico (Juniper Finance Research Desk) with Claude
**Builds on:** `2026-09-24-trade-layer-design.md` (v1). This spec covers ONLY what Phase 2 adds; v1 §§1–9, 12–14 stand unless amended here.

## 0. Context

v1 built the trade layer through **Phase 1** (paper, interactive confirm): the pure signal → eligibility → sizing → target path, the ledger/fills/compliance-locks, two-sided hysteresis, the emitter, the Alpaca Paper adapter, and the manual scripts `trade:plan`, `trade:execute --paper`, `trade:reconcile`. v1 §11 defines **Phase 2** as "paper, event-driven" — trades submit automatically on report events, the interactive confirm is removed, a weekly review runs, and the exit gate is "4 weeks clean." This spec defines how, and upgrades the order type from plain market to **slippage-capped limit**.

## 1. Scope

**Adds:** (a) an automatic trigger + runtime; (b) slippage-capped limit execution replacing plain market orders (amends v1 §9, removes "limit orders" from v1 §15); (c) unattended-run safety (circuit breakers); (d) observability for the weekly review; (e) the scheduler artifact and the Phase-2 exit gate.

**Unchanged:** the decision path (signals, gate/hysteresis, sizing, emitter), **settled-close marking** (v1 §4), the ledger / locks / compliance (v1 §3, §6), the run record (v1 §14).

**Out of scope (still):** real capital; a continuous-monitoring / intraday execution engine; VWAP/TWAP or any execution algorithm; extended hours; short sleeve. See §10.

## 2. Trigger & runtime — one scheduled market-open job (Approach A)

A single job runs each trading morning shortly after the open (`cronTimeET`, default **09:45 ET**, after the opening auction settles) and performs **reconcile → plan → execute-if-any**.

It is **event-driven in effect**: the emitter computes the target from the *current* set of published reports plus live broker positions and trades only the deltas beyond the no-trade band, so a morning with no re-rating since the last run yields an empty plan and submits nothing — honoring v1 §10's "other days: nothing." The monthly drift check needs no special case: the job plans every trading day and the band suppresses noise.

**Decision/fill separation (preserves the backtest).** The *decision* (gate, sizing, target) uses the **previous settled close** (v1 §4, unchanged), so every run is deterministic and look-ahead-free for the v1 §14 backtest. Only the *fill* uses a live price — the slippage-capped-limit reference in §4. The backtest replays decisions on settled data; execution realism is a separate layer.

**Where it runs.** Windows Task Scheduler on the desk machine, where the Alpaca keys and the local `data/trade/` ledger + fills state already live. Cloud (`/schedule`) was rejected: it would require shipping secrets and syncing local trade state off-machine for a single paper account — more surface area, no benefit.

## 3. The `trade:cron` wrapper

One command the scheduler invokes: `npm run trade:cron`. Steps, in order:

1. `TRADE_DISABLED=1` → log and exit 0 (kill switch, existing).
2. Fetch the **Alpaca clock**; if the market is not open → log "closed, no-op" and exit 0. The broker clock is authoritative — no local holiday calendar needed for the trigger.
3. Acquire a **run-lock** (`data/trade/cron.lock`); if already held → log and exit 0. Released on exit.
4. **Reconcile** (broker → ledger). An unexplained position mismatch → **HALT** (submit nothing), alert, record (v1 §3).
5. **Plan** — emit the trade plan on settled marks (v1 §7).
6. **Circuit-breaker checks** on the plan (§5). Any trip → **HALT the run**, submit nothing, alert.
7. If the plan has orders and nothing halted → **execute `--paper --yes`** through the guards, as slippage-capped limit orders (§4).
8. Write the run record (v1 §14) and append a one-line summary to the run log (§6); notify **only** on a halt / guard refusal / breaker trip.

## 4. Slippage-capped limit execution (amends v1 §9; removes "limit orders" from v1 §15)

Plain market orders are replaced by **slippage-capped limit** orders: a limit priced through the touch so it fills immediately in normal conditions, but with a **hard, tick-inclusive ceiling** on the fill price. It is *not* guaranteed marketable — if the spread is wider than the tolerance it may not fill, which is the intended entry-price discipline (hence "slippage-capped," not "marketable"). Anchored on a **fresh** last trade, with quote/close fallbacks.

**Anchor selection (`P_ref`) with a freshness gate.** Each run fetches the latest trade (price + timestamp) and latest quote (bid/ask + timestamp) per name. Priority:
1. **Last trade** `P_last`, if `now − trade_ts ≤ maxStale[bucket]` (default 5 / 15 / 60 min for large / mid / small) — primary anchor.
2. **Quote touch** — `ask` (buy) / `bid` (sell) — if the last trade is stale/absent and the quote is *valid* and fresh (same `maxStale`).
3. **Previous settled close** `C` — tier-3 fallback (see the tier-3 sizing rule).
4. none available → **HALT the name** (never trade price-blind).

**Quote validity (for the anchor and for `relSpread`):**
```
quote_valid = bid > 0 AND ask > 0 AND ask ≥ bid
mid         = (ask + bid) / 2
relSpread   = quote_valid ? min( (ask − bid) / mid , 0.10 ) : 0     // clamped at 10%
```
An invalid quote (missing IEX bid, crossed, zero) contributes `relSpread = 0` and cannot serve as the anchor — this stops a phantom 200% spread from forcing `τ` to the cap.

**Tolerance `τ` (a fraction), bucketed, spread-aware, capped per bucket:**
```
τ_entry = clamp( max( τ_bucket , limitTolBeta · relSpread ) , limitTolMin , τ_max[bucket] )
τ_exit  = clamp( max( exitTolMult · τ_bucket , limitTolBeta · relSpread ) , limitTolMin , τ_max[bucket] )
```
`τ_bucket`, `τ_max[bucket]`, and the bucket itself come from **one** liquidity-bucket lookup (market-cap large/mid/small) **shared with the gap-halt and `maxStale`** — they must never drift to different bucket definitions. `exitTolMult` (default 1.5) makes exits a touch wider than entries — a stuck exit leaves risk on the book — but still bucket-capped, so a forced small-cap exit costs at most `τ_max` small.

**Limit price — the hard cap (tick-inclusive):**
```
BUY:   target = ceil_to_tick ( P_ref · (1 + τ) )
       capPx  = floor_to_tick( P_ref · (1 + τ_max[bucket]) )
       L      = min(target, capPx)
SELL:  target = floor_to_tick( P_ref · (1 − τ) )
       capPx  = ceil_to_tick ( P_ref · (1 − τ_max[bucket]) )
       L      = max(target, capPx)
tick = $0.01 for P ≥ $1.00, else $0.0001
```
`floor_to_tick(P_ref·(1+τ_max)) ≤ P_ref·(1+τ_max)` always, so **`L` is a provable, tick-inclusive cap** — a low-priced name can no longer overshoot `τ_max` by a tick (the audit's "ceil breaks the cap"). `ceil_to_tick(target)` sits at/above the intended aggressive price, so when it is under the cap the order is marketable at target; when it bumps the cap we submit **at `capPx`** — "marketable up to the cap, not one tick more" — a real fill chance rather than a skip. IOC is the single release valve. `floor_to_tick`/`ceil_to_tick` are no-ops when `P_ref` is already on-tick, and the IEX last trade always is.

**Time in force: `ioc` for entries.** Fill immediately at ≤ `L` or cancel — no resting order that could fill later intraday into a decline without re-gating. (v1's `"day"` already prevented *overnight* resting; IOC closes the *intraday* resting-fill gap.) The "re-enters next run's plan and re-gates" guarantee holds only under IOC.

**Buy vs sell sizing.** Buys size **notional → qty**: `qty = floor(targetNotional / L)` (conservative — deploys ≤ target). Sells are **qty-based**: a full exit sells the exact broker position quantity (v1 §9); a trim sells the qty delta. Both use the slippage-capped limit (sells bid-anchored, `τ_exit`).

**Gap-halt — on a clean reference, not the quote touch:**
```
gap_ref = fresh P_last ? P_last : (quote_valid ? mid : C)
if |gap_ref − C| / C > gapHaltPct[bucket]  →  HALT the name, flag for review
```
Using `gap_ref` (never the ask/bid touch) stops a merely wide quote from masquerading as a gap. `gapHaltPct` uses the **same bucket lookup** as `τ` (default 10 / 15 / 25% large / mid / small). Optional deferred refinement: a vol-adjusted threshold `|gap_ref − C| > k · dailyVol · √days` using the 30-day realized vol the desk already computes.

**Tier-3 (close-anchored) sizing rule.** When `P_ref` falls back to the previous settled close, the anchor may be 15+ hours stale. Do **not** widen `τ` (that pays up for stale information). Instead **halve the notional** for that name that run (`closeAnchorSizeMult` = 0.5; a trim/exit is unaffected) and tag the fill reason `close_anchored`. This should be exceptional (< ~1% of fills on any name); a name that hits it routinely means its bucket's `maxStale` is mis-tuned.

**Worst-case fill (corrected).** A buy fills at ≤ `capPx = floor_to_tick(P_ref·(1 + τ_max[bucket]))` — a true per-bucket, tick-inclusive ceiling (large 40 bps, mid 100, small 150). A market order has none. **Non-fill is a feature:** a name that gapped past `L` doesn't fill, doesn't overpay, and re-enters next run's gate at the new price.

**Audit logging.** Each attempted fill logs `P_ref` and its tier, `ask_at_submit`, `τ`, `L`, `capPx`, whether the cap bound, and the fill/no-fill/halt reason code, so the weekly review can see how often the cap binds per name (a name binding more than a few % of runs is in the wrong bucket).

**Calibration caveat.** Alpaca Paper on the IEX feed does not simulate NBBO fills, and the v1 §14 backtest validates only the *decision* layer (settled marks). So the bucket `τ` values are **provisional and deliberately conservative**; fill-quality calibration is deferred to the Phase-3 live pilot (§10), not drawn from paper.

## 5. Unattended-run safety — circuit breakers

- **Kill switch:** `TRADE_DISABLED=1` (existing).
- **Per-run caps (existing v1 §12):** `maxOrdersPerRun` 40; `maxNotionalPerRun` 1.0 × NAV.
- **Reconcile-halt (existing v1 §3):** broker ≠ ledger → halt the run.
- **Gap-halt (per name, §4):** > `gapHaltPct[bucket]` move of `gap_ref` vs settled close → skip that name.
- **NEW — Turnover breaker:** total plan notional > `maxRunTurnoverFrac` × NAV (default 15%) → halt the whole run and alert. v1 §11 Phase-0 expects a few % turnover per run; 15% means the emitter or the marks are wrong.
- **NEW — Consecutive-halt breaker:** the job halts `consecutiveHaltLimit` (default 3) trading days running → stop trying until manually cleared, loud alert.
- **Paper-only guard (existing v1 §8.3):** refuse any non-paper base URL.

## 6. Observability & the weekly review

- Each run appends one line to `data/trade/cron.log`: date, runId, market-open?, #orders, notional, cash %, cap-bind count, and any halt/breaker with its reason. Full detail stays in the run records (v1 §14).
- **Notification** (channel TBD, §11) fires **only** on a halt, guard refusal, breaker trip, or consecutive-halt. Clean runs are silent (log only).
- **Weekly review** (a Phase-2 exit criterion) reads the run records + log and checks: turnover per run within band; cash within `[cashFloor, cashCeiling]`; every deferral/bar carried a correct unlock date; broker reconciled every run; **zero orders in a lock window** (Alpaca order history vs `fills.jsonl`); cap-bind frequency per name (mis-bucketed names). A `trade:review -- --since <date>` helper prints this digest.

## 7. Configuration additions (extend `TradeConfig`)

| Key | Default | Meaning |
|---|---|---|
| `cronTimeET` | `"09:45"` | scheduled run time (after the opening auction) |
| `limitTol{Large,Mid,Small}` | 0.0015 / 0.0035 / 0.0080 | entry `τ` floor by bucket (15 / 35 / 80 bps) |
| `limitTolMax{Large,Mid,Small}` | 0.0040 / 0.0100 / 0.0150 | per-bucket `τ` hard cap (40 / 100 / 150 bps) |
| `limitTolBeta` | 0.5 | spread-cushion coefficient (`β·relSpread`) |
| `limitTolMin` | 0.0005 | `τ` floor clamp (5 bps) |
| `exitTolMult` | 1.5 | sell `τ` = `exitTolMult × τ_bucket`, then bucket-capped |
| `gapHalt{Large,Mid,Small}` | 0.10 / 0.15 / 0.25 | per-bucket gap-halt vs settled close |
| `maxStale{Large,Mid,Small}` | 5 / 15 / 60 (min) | last-trade / quote freshness by bucket |
| `closeAnchorSizeMult` | 0.5 | notional multiplier when anchored on settled close (tier 3) |
| `maxRunTurnoverFrac` | 0.15 | run-level turnover breaker |
| `consecutiveHaltLimit` | 3 | stop after this many halted days |

Liquidity buckets reuse the existing market-cap large/mid/small thresholds — **one lookup** shared by `τ`, `τ_max`, `gapHalt`, and `maxStale`. Limit-pricing constants are provisional (see §4 calibration caveat).

## 8. Testing

Pure/unit (vitest, TDD as v1 §13):
- `limitPrice(P_ref, τ, τ_max, side, tick)` — the `min(ceil(target), floor(cap))` / `max(...)` construction; low-priced name where `ceil(target) > capPx` submits at `capPx` and **never exceeds `P_ref·(1+τ_max)`**; on-tick `P_ref` is a no-op; $1.00 tick boundary and sub-penny.
- `tolerance(bucket, relSpread, side, cfg)` — floor vs spread term, per-bucket cap, entry vs `exitTolMult` path; small-cap exit ≤ 150 bps.
- anchor + freshness — stale last → fresh quote → close → HALT, per bucket; invalid quote (missing bid / crossed / zero) → `relSpread=0`, not an anchor; `relSpread` clamp at 10%.
- gap-halt on `gap_ref` (not the touch) — a wide quote does not false-halt; a real gap halts; per-bucket thresholds; shared bucket lookup with `τ`.
- tier-3 close-anchored → notional halved and reason `close_anchored`.
- buy notional→qty vs sell qty (full exit = broker qty exactly; trim = delta).
- `trade:cron` orchestration with `FakeBroker` + a fake clock — closed-market no-op; run-lock blocks a double-run; reconcile-halt; turnover breaker; consecutive-halt breaker; empty plan submits nothing; entries carry `tif="ioc"`.
- audit-log fields present (P_ref/tier, ask_at_submit, τ, L, capPx, cap-bound, reason).

Manual (Phase 2, not CI): a Paper smoke confirming the live latest-trade/quote (with timestamps) + clock endpoints and one real slippage-capped-limit fill.

## 9. Adapter additions

`BrokerAdapter` gains `getLatestTrade(symbol)` → `{ price, ts }` and `getLatestQuote(symbol)` → `{ bid, ask, ts }` (timestamps required for the §4 freshness gate); `getClock()` already exists (v1 Task 10). Alpaca: `GET {dataBaseUrl}/v2/stocks/{sym}/trades/latest` and `/quotes/latest` (IEX feed), tolerantly parsed. `FakeBroker` returns injected price/quote/clock (with controllable timestamps) for tests.

## 10. Out of scope (Phase 2) — and when to reconsider

- **Continuous price monitoring / an intraday execution engine** (resting or timed limit orders keyed off a live feed to "optimize entry"). Rejected for this strategy: the edge is fundamental and long-horizon, so intraday timing is noise against ±20–50% scenario ranges; **fill risk outweighs slippage** (a resting limit that misses leaves you underexposed to your best-rated name); and it contradicts settled-close marking and v1 §10's "no price-move triggers." **Reconsider only if** (a) the book takes on materially illiquid names where even bucketed slippage-capped limits pay large impact, or (b) turnover rises enough that execution cost is a measurable drag in the backtest. Its own spec, separate from real capital.
- **Live fill-quality calibration / pilot** — belongs to Phase 3 (real capital). Until then bucket `τ`'s stay conservative (§4 caveat).
- VWAP/TWAP or other execution algorithms; extended hours; real capital; a short sleeve — as v1 §15.

## 11. Open decisions

1. `cronTimeET` **09:45 ET** (after the auction) vs 09:35.
2. Notification **channel** (push / email / none); default behavior (silent except halts) is settled.
3. `maxNotionalPerRun` stays 1.0 × NAV, or tighten for unattended runs.

## Decisions log

- 2026-09-25 — Owner: Phase 2 = **Approach A** (one scheduled market-open job) + **slippage-capped limit execution**.
- 2026-09-25 — Execution-layer review resolved: hard cap via `L = min(ceil(target), floor(cap))` (tick-inclusive, provable, submits at cap floor rather than skipping); per-bucket `maxStale` freshness gate; quote-validity conditions + `relSpread` clamp at 10%; gap-halt on a clean `gap_ref`, not the quote touch; **`tif="ioc"` for entries**; explicit buy(notional→qty) vs sell(qty) split; renamed "marketable limit" → "slippage-capped limit"; `exitTolMult` 1.5, bucket-capped; **bucket-specific** `τ_max` 40/100/150 bps and `gapHaltPct` 10/15/25% (one shared bucket lookup); **tier-3 close-anchored → 0.5× notional + reason tag**; fill-quality calibration deferred to the Phase-3 live pilot.
