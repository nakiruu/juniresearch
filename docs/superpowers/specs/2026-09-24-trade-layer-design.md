# Trade Layer — Design (v1: Alpaca Paper)

**Status:** design (spec). Lives on branch `trade-layer`, which stays **unmerged until
the layer is confirmed working and sane** (§11 defines "working and sane").
**Brokerage:** Alpaca **Paper** first. No real capital is in scope for this spec.

**One-sentence goal:** turn the portfolio engine's target book into a stream of
*compliant, low-turnover trades* against a live ledger — so the book is traded on
fundamental events, never on daily price noise, and every emitted order is legal under
the owner's ICE trading restrictions by construction.

## 0. Why this exists (the audit that motivates it)

The portfolio engine (`lib/portfolio/`) is a pure function: report archive + live price
→ target weights. It is a good *analytical* artifact and was designed as one
(`docs/portfolio/01-conceptual-outline.md` §1: "no live execution in v1"). But an audit
on 2026-09-24 found three things that must change before any capital, paper or real,
follows it:

1. **There is no trade layer.** Every `portfolio:build` is a full re-optimization with
   no memory of the prior book. The design doc explicitly promised the opposite (§7
   "trade a name only when … its weight drifts past a *wide* no-trade band"; §8
   "re-mark continuously, trade rarely … day-to-day price wiggles trigger nothing").
   Measured on the three dated snapshots, price re-marking alone churns **12–22% of
   NAV per day** on names the book *kept*. That is a daily-rebalance signature on a
   12-month-horizon signal.
2. **The reward/risk gate is doing the wrong job on exit.** `R = (FV − P)/(P − Bear)`
   collapses steeply as price rises toward fair value — i.e. exactly when a thesis is
   *working*. RL, LLY and HON were all dropped on `R < 0.5` alone while their expected
   upside μ was still ≥ 5%. As an exit rule R sells winners on the way up.
3. **The owner's compliance rule is a feature, not a constraint.** The 5-business-day
   no-round-trip rule (§6) is precisely the turnover discipline the design wanted.
   Enforced in the math, it costs ~nothing against a 12-month alpha and removes the
   model's own worst (noise) trades.

Everything below serves those three findings. Nothing here changes *what* the desk
rates, and the sizing *math* (`sizePortfolio`'s water-fill, per-name and sector caps) is
reused unchanged — what changes is the *set* it sizes (hysteresis-filtered, §5), the
*target* it fills (lock-reduced, §7.3), and one already-computed input it was ignoring
(the quality tilt, §5.4).

## 1. Framing decisions

- **Pure core, thin edges. [DECIDED]** Every decision — eligibility with hysteresis,
  compliance locks, trade emission, order sizing — is a pure, deterministic, unit-tested
  function of `(ledger, signals, config, calendar, today)`. Only two thin edges do I/O:
  the broker adapter (§8) and the run scripts (§10). This is the same architecture as
  the scoring and portfolio layers and is what makes compliance *provable* rather than
  *checked*.
- **The broker is the source of truth for positions and fills. [DECIDED]** The local
  ledger is a derived cache plus the one thing the broker cannot compute for us: the
  compliance lock clocks. Every run starts by reconciling from the broker. There is no
  second, drifting copy of the book.
- **Plan is the default; execute is opt-in and paper-only. [DECIDED]** `trade:plan`
  never submits. `trade:execute` requires an explicit `--paper` flag, refuses any
  non-paper endpoint, and in Phase 1 requires interactive confirmation. There is no
  `--live` flag in this version of the code at all.
- **Long-only, event-driven, low turnover. [DECIDED, inherited]** Unchanged from the
  portfolio design. The natural clock is a new report or a re-rate; a monthly drift
  check is the only calendar trigger.
- **Compliance is enforced twice. [DECIDED]** The ICE ticker ban and the 5-day locks
  are applied in the pure trade emitter *and* re-checked inside the broker adapter's
  `submitOrder`, mirroring the existing `BANNED_TICKERS` defense-in-depth pattern in
  `lib/portfolio/eligibility.ts` / `sizing.ts`.

## 2. Architecture and file map

```
lib/portfolio/            (existing, pure)  signals → eligibility → sizing → TARGET
   signal.ts              + markMode: previous settled close (§4)
   eligibility.ts         + two-sided enter/exit rules (§5); existing gate kept as ENTER
   sizing.ts              + quality tilt wired into scoreWeight (§5.4)

lib/trade/                (new, pure)
   ledger.ts              Ledger type; reconcile(brokerPositions, fillsLog) → Ledger
   calendar.ts            tradingDays list helpers; addTradingDays(date, n)
   locks.ts               locksFor(fillsLog, calendar, today, cfg) → { buyLockUntil, sellLockUntil } per ticker
   hysteresis.ts          classify(signal, held, locks, cfg) → ENTER | HOLD | EXIT | DEFER_EXIT | BARRED_ENTRY
   rebalance.ts           emitTrades(ledger, target, locks, cfg) → TradePlan   (§7)
   orders.ts              tradesToOrders(plan, nav, prices, cfg) → Order[]      (§9)
   costs.ts               estimated round-trip bps by liquidity bucket (reporting + hurdle)
   run-record.ts          the point-in-time run record the backtest replays (§14)

lib/broker/               (new, thin)
   adapter.ts             interface BrokerAdapter (§8.1)
   alpaca.ts              Alpaca Paper implementation (§8.2)
   fake.ts                in-memory adapter for tests and dry runs
   guards.ts              submit-time re-checks: paper-endpoint, ICE ban, locks, caps

scripts/
   trade-plan.ts          npm run trade:plan        (default: plan only, prints + records)
   trade-execute.ts       npm run trade:execute -- --paper [--yes]
   trade-reconcile.ts     npm run trade:reconcile   (broker → ledger, no orders)

data/trade/               (runtime state, gitignored)
   ledger.json            derived cache (§3)
   fills.jsonl            append-only fills log — the lock clocks derive from this (§3)
   runs/<date>-<id>.json  point-in-time run records (§14)
```

`sizePortfolio` keeps its signature; the trade layer calls it with a *reduced target*
(§7.3) so the existing water-fill, per-name cap and sector cap are reused unchanged.

## 3. State: the ledger

```ts
interface Fill  { ticker; side: "buy"|"sell"; qty; price; filledAt: ISO; tradingDate: YYYY-MM-DD; orderId; runId }
interface Lot   { ticker; qty; cost; tradingDate }               // FIFO by tradingDate
interface Ledger {
  asOf: YYYY-MM-DD;
  nav: number;                 // broker account equity
  cash: number;                // broker cash
  positions: { ticker; qty; marketValue; avgCost; lots: Lot[] }[];
  weights: Record<ticker, number>;   // marketValue / nav, derived
}
```

- `reconcile()` rebuilds `positions`, `nav`, `cash`, `weights` **from the broker** on
  every run. If the broker shows a position the fills log does not explain (a manual
  trade, a corporate action), the run **halts with a reconciliation error** rather than
  guessing lock dates. The operator resolves it by appending the missing fill to
  `fills.jsonl` (the only manual edit the design permits).
- `fills.jsonl` is append-only and is the compliance-relevant record: **every lock clock
  is a pure function of it** (§6). The broker's own order history is the external
  audit trail; the two must agree at reconcile time.
- Lots are tracked FIFO by trading date only so that "when did we last buy/sell X" is
  answerable; no tax-lot accounting beyond that in v1.

## 4. Marking: previous settled close

The current `livePrice()` in `scripts/portfolio-build.ts` returns the last close in a
10-day window, which **during market hours is the intraday last** — so a run at 10:00
and a run at 15:00 mark the whole book differently. Replace with:

- `markMode = "settled"` (default): the close of the **most recent completed trading
  day** per the trading calendar (§6.1). Deterministic for a given `today`; the same
  plan at any hour of a day yields the same marks.
- `markMode = "live"` is retained only for the analytical `portfolio:build` snapshot,
  never for trading.

This removes time-of-day noise from μ, R and the no-trade band. It does not remove
day-to-day movement — that is what hysteresis (§5) and the band (§7) are for.

## 5. Eligibility with hysteresis

The existing single-threshold gate becomes a two-sided state machine keyed on whether
the name is **currently held** (ledger qty > 0). All thresholds are config (§12).

### 5.1 ENTER (not held → candidate to buy)
All of: `label ∈ {BUY, STRONG BUY}` · `gatedLabel ∈ {BUY, STRONG BUY}` (or null) ·
`μ ≥ muEnter` (0.08) · `R ≥ rEnter` (0.60) · `conviction ≥ convictionMin` (45) ·
`ageDays ≤ stalenessMaxDays` (120) · not banned · **not in a buy-lock** (§6).
A name that passes everything except the buy-lock is classified `BARRED_ENTRY` and
recorded with the unlock date; it is re-evaluated next run.

### 5.2 HOLD (held → keep) — the default
A held name stays held unless an EXIT condition fires. Passing below the *enter*
thresholds does **not** cause a sale. This asymmetry is the whole point.

### 5.3 EXIT (held → sell the full position)
Any of: `label ∉ BUY-side` · `gatedLabel ∉ BUY-side` · `μ < muExit` (0.03 — rallied to
target, thesis played out) · `R < rExit` (0.35 — asymmetry has genuinely collapsed) ·
`ageDays > stalenessMaxDays` · banned.
If the name is **in a sell-lock** the exit is classified `DEFER_EXIT`: the position is
frozen at its current weight, the deferral and unlock date are recorded, and the exit
re-fires automatically on the first legal run. Exits are always the full position;
there is no partial exit on hysteresis.

**Why R exits at 0.35 and not 0.6.** R is an *entry* selectivity measure. As an exit
trigger it fires precisely as a thesis works (price → fair value), which is selling
winners. The exit that means "the thesis played out" is `μ < muExit`; R only exits when
the asymmetry has genuinely inverted. The 0.25-wide band (0.60 in / 0.35 out) cannot be
crossed by a routine ±4% day.

### 5.4 Sizing input — the quality tilt, wired
`lib/portfolio/signal.ts` already computes `quality ∈ [0.8, 1.2]` from composite
percentile, moat width and an eroding-moat penalty (design §5), but
`sizing.ts:scoreWeight` never uses it. Change: `score *= s.quality` (behind
`useQualityTilt`, default true). One line; makes the moat/composite signals the scoring
layer produces actually influence size, as designed.

## 6. Compliance: the owner's trading restrictions

The portfolio owner is an ICE employee and is subject to two rules. Both are hard
constraints of the trade emitter and are re-checked at the broker boundary.

### 6.0 The ICE ticker ban (existing)
`BANNED_TICKERS = {ICE}` in `lib/portfolio/eligibility.ts` is unchanged and remains
outside config. The trade layer adds a second check: `guards.ts` makes
`submitOrder` throw on a banned symbol, whatever the plan said.

### 6.1 Trading calendar
"Business day" means an **NYSE trading day**. The calendar comes from the broker
(`GET /v2/calendar`, which encodes holidays and early closes) and is cached to
`data/trade/calendar.json`; the pure functions receive it as a sorted list of
`YYYY-MM-DD` strings. `addTradingDays(d, n)` steps forward `n` entries in that list.

### 6.2 The 5-business-day no-round-trip rule
Owner's statement of the rule: *after selling a stock, it cannot be bought until 5
business days pass, counting the day of the transaction; and likewise the other
direction.* The spec treats this as a **symmetric whole-ticker window**:

- A **buy** fill of X on trading date T sets `sellLockUntil[X] = addTradingDays(T, lockBusinessDays)`.
  No sell order for X may be submitted on any trading day **before** that date.
- A **sell** fill of X on trading date T sets `buyLockUntil[X] = addTradingDays(T, lockBusinessDays)`.
  No buy order for X may be submitted on any trading day before that date.
- Locks are **whole-ticker**: adding to an existing position restarts its sell-lock;
  trimming a position starts a buy-lock on the whole name. (Per-lot locks would be less
  restrictive; whole-ticker is the conservative reading and is what v1 implements.)
- The lock clock starts on the **fill's trading date**, not the order date.

**Day-count convention — must be confirmed by the owner with compliance before Phase 1.**
Two readings of "5 business days pass, counting the transaction day":

| Reading | Example (buy fills Mon) | `lockBusinessDays` |
|---|---|---|
| Transaction day is day 1; after 5 days pass, day 6 is legal | Mon…Fri are days 1–5 → first legal sell **next Mon** | **5** |
| Five *full* days must elapse after the transaction day | first legal sell **next Tue** | **6** |

The parameter is `lockBusinessDays` and the **default is 6** — the stricter reading —
until the owner confirms 5 is the compliant count. Being one day too conservative costs
nothing against a 12-month horizon; being one day too aggressive is a compliance breach.

### 6.3 Interaction with the model — and why it does not cost return
- The lock binds only when the model wants to reverse a trade within the window — a
  whipsaw. On a 12-month fundamental signal a whipsaw is noise, and a forced 5-day hold
  or 5-day re-entry delay has ~zero expected cost. The hysteresis band (§5) is designed so
  that such reversals should be rare in the first place; the lock is the backstop.
- The one real cost: a position that breaks within days of entry cannot be cut until the
  window passes. Mitigation is structural — entries follow the report cycle, which is
  post-filing, so the book never buys into a scheduled earnings print. Residual tail risk
  is accepted and recorded (§14) so it can be measured.
- When a lock blocks a wanted trade, the capital that trade would have used stays in
  cash (never leverage) and the trade is retried on the first legal run.

## 7. Trade emission (`rebalance.ts:emitTrades`)

Pure. Inputs: `ledger`, `signals` (marked per §4), `locks`, `calendar`, `today`, `cfg`.
Output: a `TradePlan` — a list of intended position changes with a reason code each,
plus everything skipped or deferred and why.

1. **Classify** every signal via §5 → `ENTER | HOLD | EXIT | DEFER_EXIT | BARRED_ENTRY`,
   plus `INELIGIBLE` for non-held names that fail ENTER for a non-lock reason.
2. **Freeze set** = `DEFER_EXIT` names (sell-locked). Their current weights are held
   fixed and subtracted from the investable target.
3. **Size the rest.** Call the existing `sizePortfolio` on `{HOLD ∪ ENTER}` with
   `target = 1 − cashFloor − Σ frozenWeights`. The water-fill, `wMax`, `sectorMax` and
   the (now wired) quality tilt are reused unchanged.
4. **No-trade band** on every `HOLD` name: trade only if `|w_target − w_current| >
   tradeBand` (0.025). Below the band the name is left alone. Above it, the trade is the
   full delta to target. A required *increase* on a name in a buy-lock is skipped
   (`BARRED_ADD`); a required *decrease* on a name in a sell-lock is skipped
   (`DEFER_TRIM`); both are retried on the first legal run.
5. **Exits** are full-position sells; **entries** are buys to target weight.
6. **Cash discipline.** Σ buy notional ≤ cash + Σ sell proceeds (paper settles
   instantly; a real account is T+1 and would need a settlement check — out of scope).
   Never leverage. If locks or bars leave capital unplaced, cash rises above the floor;
   that is the honest outcome and is reported, not "fixed".
7. **Ban** — any trade in a banned ticker is impossible by construction and is asserted.
8. **Cost report.** `costs.ts` attaches an estimated round-trip cost (bps, by liquidity
   bucket: large-cap ~8 bps, mid ~15, small/volatile ~30) to every trade for the run
   record. v1 uses it for **reporting and a floor** (skip trades under `minOrderUsd`);
   the band is the binding hurdle. A Grinold-Kahn alpha-vs-cost hurdle is a v2 refinement
   once the backtest can estimate realized alpha.

The plan is deterministic: the same inputs produce the same plan, and a plan is
re-runnable without double-submission (§9.4).

## 8. Broker adapter

### 8.1 Contract (`lib/broker/adapter.ts`)
```ts
interface BrokerAdapter {
  kind: "alpaca-paper" | "fake";
  getClock(): Promise<{ isOpen: boolean; nextOpen: ISO; nextClose: ISO }>;
  getCalendar(from, to): Promise<{ date: YYYY-MM-DD; open: HH:MM; close: HH:MM }[]>;
  getAccount(): Promise<{ equity: number; cash: number; buyingPower: number }>;
  getPositions(): Promise<{ symbol; qty; marketValue; avgEntryPrice }[]>;
  getOrders(status: "open"|"closed"|"all", after?: ISO): Promise<BrokerOrder[]>;
  getLastClose(symbols: string[], tradingDate): Promise<Record<symbol, number>>;
  submitOrder(o: OrderRequest): Promise<BrokerOrder>;     // wrapped by guards.ts
  cancelOrder(id): Promise<void>;
}
```
`fake.ts` implements this in memory (instant fills at the mark) for unit/e2e tests and
for Phase 0 dry runs.

### 8.2 Alpaca Paper mapping
Base URL `https://paper-api.alpaca.markets`; credentials from `.env.local`
(`APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`; add both to `.env.example`, never commit).
Endpoint mapping (`/v2/clock`, `/v2/calendar`, `/v2/account`, `/v2/positions`,
`/v2/orders`, market data bars for the settled close) is the standard Alpaca Trading
API. **The exact request/response shapes, fractional-share eligibility per symbol,
notional-order support, and rate limits are to be verified against the current Alpaca
docs at build time**, not assumed from this document.

### 8.3 Guards (`lib/broker/guards.ts`) — applied to every `submitOrder`
- **Paper-only:** refuse unless the configured base URL is the paper endpoint. No
  override exists in this version.
- **Ban:** refuse a banned symbol.
- **Locks:** recompute locks from `fills.jsonl` and refuse a buy inside a buy-lock or a
  sell inside a sell-lock — even if the plan somehow contained one.
- **Caps:** refuse if the run has exceeded `maxOrdersPerRun` (40) or
  `maxNotionalPerRun` (config; default = 1.0 × NAV, i.e. never more than the book).
- **Kill switch:** refuse everything if `TRADE_DISABLED=1`.

## 9. Order sizing and execution

1. **NAV** = broker account equity at run start. `target$ = w × NAV`,
   `Δ$ = target$ − current marketValue`.
2. **Buys** use **notional** market orders for `Δ$` (fractional-eligible symbols), so a
   weight maps to dollars without rounding dust. For a symbol that is not
   fractional-eligible, `qty = floor(Δ$ / mark)`.
3. **Sells:** an EXIT sells the broker's exact position `qty` (never a computed number,
   so no residual dust); a trim sells `round(Δ$ / mark)` whole shares.
4. **Idempotency:** `client_order_id = sha256(runId | ticker | side | tradingDate)[0:32]`.
   Re-executing the same plan the same day is a no-op at the broker.
5. **Market hours only:** if `getClock().isOpen` is false the run records the plan and
   submits nothing; v1 never submits into extended hours or queues for the open.
6. **Order type:** market, `time_in_force = day`. Limit orders and execution
   algorithms are out of scope.
7. **Fills:** after submission, poll until `filled` / `canceled` / `rejected` (paper
   fills immediately in hours). Record each fill to `fills.jsonl` with the
   **fill's trading date** — the lock clock starts there. A partially filled DAY order at
   the close is recorded for the filled quantity; the unfilled remainder is simply
   re-planned next run.
8. **Minimums:** skip any trade with `|Δ$| < minOrderUsd` (25).

## 10. Cadence and triggers

| Trigger | Action |
|---|---|
| A report is published or re-rated (`synth:build` publishes `data/<ticker>.json`) | run `trade:plan`; in Phase ≥1, `trade:execute --paper` |
| A held name's eligibility flips per §5 *and survives the band* | same |
| Monthly drift check (first trading day of the month) | `trade:plan` to catch quiet band breaches |
| Any other day | **nothing** — no daily runs, no price-move triggers |

`trade:reconcile` may run any time; it only reads the broker and updates the ledger.
Wiring the report trigger automatically is Phase 2 (§11); in Phases 0–1 the operator
runs the scripts after each publish.

## 11. Safety and rollout — what "working and sane" means

| Phase | Adapter | Submits? | Exit criteria (all must hold) |
|---|---|---|---|
| **0 — dry run** | `fake` | never | ≥ 10 planned runs across ≥ 2 weeks; **zero** ban/lock violations in any plan; retained-name turnover per run ≤ `tradeBand`-consistent levels (order of a few % of NAV, not 12–22%); every deferral/bar carries a correct unlock date; run records replay deterministically |
| **1 — paper, confirmed** | Alpaca Paper | with interactive confirm | ≥ 10 executed runs; broker positions reconcile exactly to the ledger every run; zero guard refusals caused by the plan (a refusal means the emitter is wrong); zero orders in any lock window (verified from Alpaca order history vs `fills.jsonl`) |
| **2 — paper, event-driven** | Alpaca Paper | automatically on report events | 4 weeks clean; weekly review of turnover, cash, and deferrals |
| **3 — real capital** | — | — | **Out of scope.** A separate decision and a separate spec (settlement, live guards, sizing to real NAV). |

**The `trade-layer` branch merges to `main` only when Phase 1's criteria are met.**
Until then it is reviewed and iterated on the branch.

## 12. Configuration additions

Added to `PortfolioConfig` (or a new `TradeConfig` extending it — the plan decides):

| Key | Default | Meaning |
|---|---|---|
| `muEnter` / `muExit` | 0.08 / 0.03 | expected-upside band (enter above / exit below) |
| `rEnter` / `rExit` | 0.60 / 0.35 | reward/risk band |
| `tradeBand` | 0.025 | no-trade band on held names (absolute weight) |
| `lockBusinessDays` | **6** (conservative; see §6.2) | trading days from fill to first legal opposite-side trade |
| `markMode` | `"settled"` | previous completed trading day's close |
| `useQualityTilt` | true | multiply `scoreWeight` by `quality` |
| `minOrderUsd` | 25 | skip dust trades |
| `maxOrdersPerRun` / `maxNotionalPerRun` | 40 / 1.0 × NAV | run-level sanity caps |
| `muExp` | 1 (unchanged) | growth-tilt candidate; **1.5 is to be tested in the backtest, not defaulted** |

`rMin` (0.5) and `muMin` (0.05) remain for the analytical `portfolio:build` snapshot,
which is unchanged. The trade layer uses the band pair, not the single gate.

## 13. Testing

TDD throughout; every pure module gets a vitest file beside it.

- `hysteresis.test.ts` — the full transition table: not-held × {passes enter, fails
  enter on μ, on R, on gate, on lock}; held × {clean hold, below-enter-but-above-exit
  (must HOLD), each exit condition, exit while sell-locked (must DEFER)}.
- `locks.test.ts` — fill on Monday/Friday, across a weekend, across a listed holiday,
  both directions, whole-ticker restart on add-to-position, `lockBusinessDays` 5 vs 6,
  and the exact first-legal date in each case.
- `rebalance.test.ts` — frozen weights reduce the target; a buy-locked entry is barred and
  its capital lands in cash; a sell-locked trim is deferred; the band suppresses small
  deltas and passes large ones; cash never negative; a banned ticker can never appear.
- `orders.test.ts` — notional vs qty paths, exit uses broker qty exactly, dust skipped,
  deterministic `client_order_id`.
- `sizing.test.ts` (existing) — extended for the quality tilt.
- `ledger.test.ts` — reconcile halts on an unexplained broker position.
- End-to-end: `fake.ts` runs a multi-day scenario (enter, whipsaw attempt blocked by
  lock, deferred exit executing on the first legal day) and asserts the fills log.
- Alpaca adapter: a manual smoke against Paper in Phase 1 — not in CI.

## 14. Backtest hook — what every run records

`data/trade/runs/<date>-<runId>.json` (gitignored) stores, point-in-time: the marks and
`markMode`, every signal's μ/R/κ/quality/age, each name's §5 classification and reason,
the locks in force, the sized target, the emitted plan, the executed fills, and every
skip/deferral with its unlock date. Together with `fills.jsonl` and the existing dated
portfolio snapshots this is the store the look-ahead-free backtest (design §8/§11)
replays. **The backtest itself is a separate piece**; this spec only guarantees the
trade layer records enough to make it possible — and it is the prerequisite for ever
tuning `rEnter`, `muExp`, or the band on evidence rather than on three days of data.

## 15. Out of scope (v1)

Real capital; a short sleeve; limit orders, VWAP/TWAP or any execution algorithm;
extended-hours trading; T+1 settlement modelling; tax-lot accounting; multiple
accounts; mean-variance or covariance-based sizing (per DeMiguel/Michaud, still the
wrong tool at this asset count); per-lot locks; automatic trigger wiring (Phase 2).

## 16. Open decisions for the owner

0. **Symmetry of the rule** (§6.2): the owner's statement was worded for the sell→buy
   direction ("cannot buy a stock I sold until 5 business days pass"); the spec assumes
   the buy→sell direction is restricted identically (no selling within the window after
   a buy) and enforces both. If compliance restricts only re-buys after a sell, the
   sell-lock and `DEFER_EXIT` (§5.3) are dropped and the design simplifies. **Confirm.**
1. **Day-count convention** (§6.2): confirm with compliance whether `lockBusinessDays`
   is 5 or 6. The spec ships 6 until told otherwise.
2. **Whole-ticker locks** (§6.2): confirm the conservative reading is acceptable, or
   whether compliance permits per-lot treatment.
3. **Quality tilt on by default** (§5.4): proposed yes.
4. **Dust floor** (`wMin`): stays 0 for now (owner's prior call); revisit with the backtest.
5. **Growth tilt** (`muExp` 1.5): backtest candidate only, not a default.
6. **Reconciliation halt** (§3): confirm halting on an unexplained position is the wanted
   behaviour over auto-adopting it.

## 17. Decisions log

- 2026-09-24 — Owner: write the trade layer up; keep it on its own branch until confirmed
  working and sane; first brokerage is Alpaca Paper.
- 2026-09-24 — Spec: pure core / thin edges; broker is source of truth; plan-by-default,
  paper-only execute with no live flag; two-sided hysteresis (R exits at 0.35, not 0.6);
  5-business-day locks enforced in emitter and adapter with a conservative 6-day default;
  settled-close marks; quality tilt wired; merge gated on Phase 1.
