# Engine Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. Execute phases in order; tasks inside a phase are ordered by dependency.

**Goal:** Implement every item the engine review adopted. Three kinds of work:

- the compliance and broker-truth fixes;
- the guardrail and observability work;
- the deployment and research features.

Nothing a verdict dropped is built. Every behaviour change is gated behind a config knob, stays off until
paper-validated, and must not weaken locks, the ICE ban or never-leverage.

**Spec:** `docs/superpowers/specs/2026-09-26-engine-improvements-design.md`. The idea numbers (#1–#13)
and finding numbers (F1–F11) used below refer to that spec.

**Tech stack:** TypeScript, zod, vitest, tsx; `BrokerAdapter` (`lib/broker/adapter.ts`) with the Alpaca
paper, Schwab live and Fake implementations.

## Global Constraints

**Process**

- **TDD.** Write the failing test, write the minimal implementation, go green, then commit.
- **Verification.** One `*.test.ts` beside each module. Before each commit, the whole suite must be
  green (`npm test`) and `npx tsc --noEmit` and `npm run lint` must be clean.
- **Branching.** One branch per phase, off `main`, each with its own PR.
- **Validation.** Each phase is validated on **Alpaca paper** (≥3 cron runs, clean audit) before it is
  turned on for Schwab.

**Never, in any task**

- Weaken or bypass whole-ticker, symmetric, 5-business-day locks.
- Relax the ICE hard ban.
- Allow leverage.
- Add fractional shares or per-lot locks.
- **Retry an order submit.**

**Behaviour gating**

- A new knob that changes trading behaviour ships **off** or at a value that reproduces today's
  behaviour, unless the task says otherwise. The exceptions are safety tightenings: the clock fix, the
  reconcile check and the fire-window guard.
- `resolveTradeConfig` validates every new knob.

**Other rules**

- **Pure core, injected I/O.** New logic goes in pure functions. `cron.ts` and `pipeline.ts` take clocks
  and paths as dependencies, never calling `Date.now()` or reading `process.env` directly.
- **Commit footer:** the session's standard `Co-Authored-By` / `Claude-Session` lines.
- **Docs in the same PR.** When a phase lands, update the matching `docs/engine.md` callout to describe
  the implemented behaviour.

## Phase map

| Phase | Branch | Tasks | Ideas / findings | Est. |
|---|---|---|---|---|
| 1 Compliance clock | `engine/p1-clock` | 1.1–1.5 | #13, F1, F7 (fire window) | 1 d |
| 2 Broker truth | `engine/p2-broker-truth` | 2.1–2.7 | #7, #10, F2–F4, F6 | 3–4 d |
| 3 Guardrails | `engine/p3-guardrails` | 3.1–3.5 | #11, #12, F5, F8 | 2–3 d |
| 4 Observability | `engine/p4-observability` | 4.1–4.4 | #9, #10 (latency), #6 (record fields) | 1–2 d |
| 5 Deployment | `engine/p5-deployment` | 5.1–5.3 | #8 | 1 d |
| 6 Research & display | `engine/p6-research` | 6.1–6.4 | #2, #1, F9, F10, F11 | 2 d |
| Later (data-gated) | — | L.1–L.3 | τ_max tuning, #6 harness, #3 | — |

---

## Phase 1 — Compliance clock

> **Status: implemented 2026-09-26** (`37df4b8`, `0ee0ad6`, `6fd0950`, `5a7c7fa`; fixtures `46f5d35`). Task 1.1 confirmed F1: `isOpen` is a trading-day flag. The paper/Schwab exit checks below remain to be run on the server.

### Task 1.1: Confirm the Schwab `/markets` semantics (spike, no code merged)

**Files:**
- Create `lib/broker/__fixtures__/schwab-markets-open.json`
- Create `lib/broker/__fixtures__/schwab-markets-afterhours.json`

- [x] **Step 1:** With live Schwab creds, run
  `GET /marketdata/v1/markets?markets=equity` at about 10:00 ET and again at about 20:00 ET on a trading
  day. Use a throwaway `tsx` snippet that reuses `SchwabAdapter.get`. Save both responses as fixtures,
  scrubbed of account data.
- [x] **Step 2:** Record the finding in the PR description. The question is whether `isOpen` stays
  `true` after hours.
  - **Yes:** F1 is confirmed and Task 1.3 is mandatory.
  - **No:** keep Task 1.3 anyway, as defence in depth.
- [x] **Step 3:** Commit the fixtures: `test(schwab): capture /markets fixtures for clock semantics`.

### Task 1.2: `lib/trade/clock.ts` — the one ET clock

**Files:**
- Create `lib/trade/clock.ts` and `lib/trade/clock.test.ts`
- Modify `lib/trade/scheduler.ts`: move `partsInTZ`, `etWallToUtc` and `etDateString` out, and
  re-export them.

**Interfaces:**

```ts
export function etDateString(ms: number): TradingDay;   // moved, unchanged
export function todayET(nowMs?: number): TradingDay;     // = etDateString(nowMs ?? Date.now())
export function etMinutesOfDay(nowMs: number): number;   // 0..1439 ET wall-clock minutes
export function etWallToUtc(day: TradingDay, hhmm: string): number; // moved, unchanged
```

- [x] **Step 1:** Write tests.
  - `todayET(Date.parse("2026-03-09T03:30:00Z")) === "2026-03-08"` (EDT evening).
  - `todayET(Date.parse("2026-01-15T04:59:00Z")) === "2026-01-14"` (EST 23:59).
  - `todayET(Date.parse("2026-01-15T05:01:00Z")) === "2026-01-15"`.
  - `etMinutesOfDay` at 09:45 ET in both EDT and EST returns `585`.
  - The existing `scheduler.test.ts` stays green unmodified.
- [x] **Step 2:** Run the tests and confirm they fail. Then implement by moving the helpers and adding
  the two new functions. Run again and confirm green.
- [x] **Step 3:** Commit: `refactor(trade): extract ET clock helpers to clock.ts`.

### Task 1.3: Schwab `getClock` checks session hours (F1)

**Files:**
- Modify `lib/broker/schwab.ts`: the `Markets` zod schema and `getClock()` (lines 75–79)
- Modify `lib/broker/schwab.test.ts`

**Interfaces:**
- `Markets` gains optional `sessionHours.regularMarket: {start: string; end: string}[]`.
- `getClock()` sets `isOpen = flag && start ≤ now < end`.
- If `sessionHours` is absent, fall back to
  `nyseTradingDays(todayET(now), todayET(now)).length === 1 && 570 ≤ etMinutesOfDay(now) < 960`.
- `nextOpen` and `nextClose` are populated from `start`/`end` when present.

- [x] **Step 1:** Write tests, using the Task 1.1 fixtures and an injected `now`.
  - 10:00 ET → open.
  - 20:00 ET with `isOpen:true` → **closed**.
  - `isOpen:false` → closed.
  - Missing `sessionHours` at 10:00 on a trading day → open.
  - Missing `sessionHours` on a holiday → closed.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `fix(schwab): market clock requires regular-session hours, not just a trading date`.

### Task 1.4: Replace every UTC `today` on the trade path (#13)

**Files:**
- `scripts/trade-cron.ts:61`
- `lib/trade/scheduler-wiring.ts:55`
- `scripts/trade-execute.ts:16`
- `scripts/trade-reconcile.ts:5`
- `scripts/trade-plan.ts:9`
- `lib/broker/schwab.ts:94`
- `lib/trade/pipeline.ts:87` (the fill's `tradingDate`)

**Steps**

- [x] **Step 1:** Write tests.
  - `pipeline.test.ts`: a FakeBroker fill with `filledAt: "2026-03-10T00:30:00Z"` gets
    `tradingDate === "2026-03-09"`.
  - `scheduler-wiring` (or `cron.test.ts`) test: a run constructed at `nowMs = 2026-03-10T01:00Z` passes
    `today === "2026-03-09"`.
- [x] **Step 2:** Replace each call site with `todayET()` or `todayET(nowMs)`. For fills use
  `todayET(Date.parse(order.filledAt))`. Where the value feeds `runCron`, derive `today` from the same
  injected `nowMs` so both come from one clock read.
- [x] **Step 3:** Run `grep -rn "toISOString().slice(0, *10)" lib/trade lib/broker scripts/trade-*`. The
  only remaining hits should be pure date-arithmetic helpers (`shiftDays`, `shift`, calendar loops),
  each with a comment saying why UTC is correct there.
- [x] **Step 4:** Commit: `fix(trade): derive today and fill tradingDate from ET, not UTC`.

### Task 1.5: Fire-window guard + scheduler script fixes (F7)

**Files:**
- `lib/trade/config.ts`: add `maxLateMin: number` (default 20); validate `0 < maxLateMin ≤ 390`.
- `lib/trade/cron.ts`: add `CronStatus` `"late"` and `CronDeps.ignoreWindow?: boolean`.
- `scripts/trade-cron.ts`: add a `--now` flag that sets `ignoreWindow: true`.
- `scripts/register-trade-cron.ps1`
- `scripts/register-trade-cron.sh`

**Steps**

- [x] **Step 1:** Add `cron.test.ts` cases.
  - `nowMs` at 09:50 ET → proceeds.
  - 10:06 ET → `{status:"late"}`, nothing submitted, a log line written, no halt bump.
  - 10:06 ET with `ignoreWindow` → proceeds.
- [x] **Step 2:** Implement. The check goes after the kill switch and before the clock:
  `etMinutesOfDay(nowMs) > hhmm(cfg.cronTimeET) + cfg.maxLateMin` → `"late"`.
- [x] **Step 3:** Update the scripts.
  - `.ps1`: remove `-StartWhenAvailable`.
  - Both scripts: read `cronTimeET` from `lib/trade/config.ts` (grep the literal) or accept `-At` and
    assert it equals the config.
  - `.sh`: fix the comment at line 78.
- [x] **Step 4:** Commit: `feat(trade): fire-window guard; scheduler scripts no longer fire missed runs late`.

**Phase 1 exit:**
- On paper: a manual `trade:cron` at 21:00 ET returns `late`/`closed`.
- Schwab (read-only) `getClock` after hours returns closed.
- Update `engine.md` §7 (`today` callout → implemented).

---

## Phase 2 — Broker truth

> **Status: implemented 2026-09-26** (`48c13fb`, `12c2593`, `432d0c1`, `5588a1c`, `172fdce`, `eaf4093`).
> Deviations: timeouts are adapter options (`timeouts`, defaults in `lib/broker/http.ts`) rather than
> `TradeConfig` knobs, since `makeBroker` has no config; `trade:reconcile -- --record-missing` replaces
> hand-written manual fills; a Schwab 2xx without an order id is also treated as an unknown outcome.
> Not yet verified live: Schwab's order JSON carrying `price`/`orderType`/`duration` (used by
> `findSubmitted`) — check read-only against a real order listing before relying on it.

### Task 2.1: Bound Alpaca `getOrders` (F6)

**Files:** `lib/broker/alpaca.ts:70-71`, `lib/trade/pipeline.ts:83`, `alpaca.test.ts`.

- [x] **Step 1:** Test that the fill poll passes `after` and that the URL contains `after=` and
  `direction=desc`.
- [x] **Step 2:** Change the poll to `adapter.getOrders("all", submitStartIso)`, where `submitStartIso`
  is taken just before submit minus 60 s. In Alpaca, switch to `direction: "desc"`.
- [x] **Step 3:** Commit: `fix(alpaca): bound order polling window so new orders are always visible`.

### Task 2.2: Schwab-safe standalone audit (F2)

**Files:** `scripts/trade-audit.ts`, `lib/trade/audit.ts`, `audit.test.ts`.

**Interfaces:**
- `crossCheckBroker` input `expected[]` gains an optional `brokerId`.
- Scoping becomes: an order is in scope if `clientOrderId ∈ expected` **or** `id ∈ expected.brokerId`.

**Steps**

- [x] **Step 1:** Write tests.
  - Broker orders with `clientOrderId: ""` (Schwab from a fresh process) but ids matching
    `expected.brokerId` produce a clean audit.
  - A foreign order (neither cid nor id) is still ignored.
- [x] **Step 2:** Implement. `trade-audit.ts` builds `expected` from `record.orders[].brokerId`, which
  `mergeExecution` already writes.
- [x] **Step 3:** Commit: `fix(audit): scope by broker id so trade:audit works on Schwab out-of-process`.

### Task 2.3: Orders-aware `reconcile()` (#7)

**Files:** `lib/trade/ledger.ts`, `ledger.test.ts`.

**Interfaces:**

```ts
export function reconcile(input: {
  asOf: string; account: {...}; positions: {...}[]; fills: Fill[];
  brokerOrders?: BrokerOrder[];      // absent → today's behaviour exactly
  lockWindowStart?: TradingDay;      // orders with trading date < this are ignored
}): Ledger;
```

**Rules, when `brokerOrders` is given:**

1. **Open orders.** Any order with `!TERMINAL_STATUSES.has(status)` throws
   `ReconcileError("open broker order <id> <side> <sym> — IOC orders never rest; cancel or wait")`.
2. **Filled orders.** For each order with `filledQty > 0` and
   `todayET(Date.parse(filledAt ?? submittedAt)) ≥ lockWindowStart`:
   - Compute `recorded = Σ fills.filter(f => f.orderId === o.id).qty`.
   - If `|recorded − filledQty| > 1e-6`, throw
     `ReconcileError("broker order <id> <side> <sym> filled <N>, fills.jsonl records <M> — append the fill (runId \"manual\" for a manual trade)")`.
3. **Manual orders.** An order with an unknown clientOrderId is checked all the same, because the join
   is on `orderId`.

**Steps**

- [x] **Step 1:** Write tests, using the existing `pos()`/`buy()` helpers plus a new `order()` helper.
  - Unrecorded sell → throws.
  - Partial recorded qty → throws.
  - Order before the window → ignored.
  - Open order → throws.
  - Manual order (`clientOrderId: ""`) recorded under `runId:"manual"` → passes.
  - `brokerOrders` absent → identical to today (the existing tests stay unchanged).
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `feat(trade): reconcile cross-checks broker orders in the lock window by orderId`.

### Task 2.4: Wire the orders check into `planRun` and `trade:reconcile`

**Files:**
- `lib/trade/config.ts`: add `reconcileOrders: boolean`, default `true`.
- `lib/trade/pipeline.ts`: `planRun`, at about line 42.
- `scripts/trade-reconcile.ts`
- `pipeline.test.ts`, `cron.test.ts`

**Steps**

- [x] **Step 1:** Write tests.
  - A FakeBroker with an extra filled sell not in the fills → `planRun` rejects with `ReconcileError`.
  - In cron, that halts with `reason:"reconcile"` **on every subsequent run** until the fill is appended.
    This proves F3 is fixed.
- [x] **Step 2:** Implement. `lockWindowStart = calendar[idx(today) − (cfg.lockBusinessDays + 1)]`, using
  the existing calendar helpers. When `cfg.reconcileOrders` is set, fetch
  `adapter.getOrders("all", lockWindowStart + "T00:00:00Z")` and pass it in.
- [x] **Step 3:** Add a `docs/engine.md` §4.1 note on how the operator appends a manual fill. Add
  `--manual` support to the fill-append helper in `_trade-common.ts` if it exists; otherwise document the
  JSONL line to write.
- [x] **Step 4:** Commit: `feat(trade): planRun reconciles against the lock-window order history`.

### Task 2.5: `fetchWithTimeout` + read retries (#10)

**Files:**
- Create `lib/broker/http.ts` and `http.test.ts`
- Modify `alpaca.ts`, `schwab.ts`, `schwab-auth.ts` and `scripts/trade-auth.ts` to route every fetch
  through it.
- Modify `config.ts`: add `brokerReadTimeoutMs 10000`, `brokerSubmitTimeoutMs 15000` and
  `tokenTimeoutMs 10000`. Pass them to the adapter constructors via `makeBroker`.

**Interfaces:**

```ts
export class BrokerTimeoutError extends Error { phase: "read" | "submit" | "token"; url: string }
export async function fetchWithTimeout(f: typeof fetch, url: string, init: RequestInit, ms: number, phase: Phase): Promise<Response>;
export async function withReadRetry<T>(fn: () => Promise<T>, delaysMs?: number[] /* [1000, 3000] */): Promise<T>;
```

- The body read must use the same `AbortSignal` (`AbortSignal.any`).
- `withReadRetry` retries only on `BrokerTimeoutError` with phase `read`, or on a network `TypeError`.
  It never retries on an HTTP 4xx.

**Steps**

- [x] **Step 1:** Write tests with fake timers.
  - A never-resolving fetch throws `BrokerTimeoutError` after `ms`.
  - A body that stalls after the headers also times out.
  - A read retries twice, then throws.
  - A 400 is not retried.
- [x] **Step 2:** Implement and wire it in. **The submit paths use `phase:"submit"` and are never
  wrapped in `withReadRetry`.**
- [x] **Step 3:** Commit: `feat(broker): per-request timeouts; bounded retries for idempotent reads only`.

### Task 2.6: Unknown submit outcome — `findSubmitted` (#10)

**Files:**
- `lib/broker/adapter.ts`: add the interface method.
- `alpaca.ts`, `schwab.ts`, `fake.ts` and their tests.

**Interfaces:**

```ts
export class SubmitOutcomeUnknownError extends Error { clientOrderId: string; symbol: string; submitStartAt: string }
// BrokerAdapter:
findSubmitted(req: SubmitOrderRequest, sinceIso: string): Promise<BrokerOrder | null>; // throws AmbiguousOrderError on >1 match
```

**Implementations:**

- **Alpaca:** `GET /v2/orders:by_client_order_id?client_order_id=`. A 404 returns `null`.
- **Schwab:** `getOrders("all", since − 5 s)`, filtered on:
  - symbol, instruction, `quantity`, `price`;
  - `orderType LIMIT`, `duration IMMEDIATE_OR_CANCEL`;
  - `enteredTime ≥ since − 5 s`;
  - id not already in the cid map.

  One match: add it to the map and return it. More than one: throw.
- **Fake:** exposes a `dropNextSubmitResponse` test hook.

**Steps**

- [x] **Step 1:** Write the adapter tests.
  - Alpaca: found, and 404 → null.
  - Schwab: exact match, no match, two matches → ambiguous, and an already-mapped id is excluded.
- [x] **Step 2:** Implement. On `BrokerTimeoutError{phase:"submit"}`, `submitOrder` throws
  `SubmitOutcomeUnknownError`.
- [x] **Step 3:** Commit: `feat(broker): findSubmitted — resolve a timed-out submit without resubmitting`.

### Task 2.7: `executeOrders` + cron handle unknown submits

**Files:** `lib/trade/pipeline.ts` (`executeOrders`), `lib/trade/cron.ts`, `pipeline.test.ts`,
`cron.test.ts`.

**Behaviour.** When `SubmitOutcomeUnknownError` is caught, call `findSubmitted` at 2, 5 and 10 s.

- **Found:** continue the normal poll and fill path.
- **Not found or ambiguous:**
  - push `ExecutedOrder{status:"unknown"}`;
  - **stop submitting the remaining orders**;
  - return `{…, aborted: "submit-unknown"}`.

Cron then:
- writes the run record;
- runs the audit anyway;
- calls `bumpHalt`;
- notifies: `"submit outcome unknown for <sym> <side> <qty> — check broker order history, append any fill, then clear halt"`;
- returns `{status:"halted", reason:"submit-unknown"}`.

`BrokerOrderStatus` gets `"unknown"` added locally, in the `ExecutedOrder` type only.

**Steps**

- [x] **Step 1:** Write tests with a Fake that drops the submit response.
  - The order exists at the broker → the fill is recorded and the run completes.
  - The order does not exist → `submitOrder` was called **exactly once**, later orders were not
    submitted, and cron halts with `submit-unknown`.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `feat(trade): never resubmit — unknown submit outcome halts the run for operator review`.

**Phase 2 exit:**
- Paper: ≥3 clean cron runs with `reconcileOrders: true`.
- A deliberate manual paper trade halts the next run, and appending a `runId:"manual"` fill clears it.
- `trade:audit` passes against a Schwab run record (read-only).
- Update `engine.md` §4.1 and §5.3 (latency callout, partly: timeouts done).

---

## Phase 3 — Guardrails

> **Status: implemented 2026-09-26 except the optional Task 3.4** (`636a3da`, `6fb868a`, `bcd6251`, `7b71c08`).
> Task 3.4 (fast bootstrap) was deliberately skipped: the ENTER-only clip (3.3) builds a book from cash
> over several runs within the cap, and `trade:execute` covers a one-shot manual build — a flag that
> raises the cap to 100% would only add a bypass. Additions beyond the spec: `executeOrders` sends sells
> before buys and skips (rather than crashing on) a cash-refused buy. Open: whether Schwab resets the
> 7-day clock when it rotates a refresh token (the code keeps the original issue time, so warnings would
> only ever come early).

### Task 3.1: Align notional measures (#11, F8)

**Files:** `lib/trade/pipeline.ts:80`, `guards.test.ts`, `pipeline.test.ts`.

- [x] **Step 1:** Write tests.
  - The `estNotionalUsd` passed to `guardedSubmit` equals `qty × limitPrice`.
  - For a tier-3 (×0.5) buy, the guard's counted notional is about half of `deltaUsd`.
- [x] **Step 2:** Implement: `estNotionalUsd: o.qty * o.limitPrice`.
- [x] **Step 3:** Commit: `fix(trade): guard notional counts what an IOC limit can actually spend`.

### Task 3.2: Cash backstop in guards (F5)

**Files:**
- `lib/broker/guards.ts`: `GuardContext` gains `cashUsd: number`, and `counters` gains
  `buyNotionalUsd` and `sellNotionalUsd`.
- `cron.ts` and `trade-execute.ts`, where the ctx is built.
- `guards.test.ts`

**Rule.** A buy is refused when:

```
counters.buyNotionalUsd + est > cashUsd + counters.sellNotionalUsd − cfg.cashFloor·nav
```

The refusal message is `"cash backstop: buy would exceed broker cash"`. `sellNotionalUsd` is credited
only from **filled** sells. `executeOrders` updates it after each fill, so an unfilled IOC sell never
funds a buy.

**Steps**

- [x] **Step 1:** Write tests.
  - A buy within cash passes.
  - A buy over cash throws.
  - A filled sell credits cash.
  - An unfilled sell does not.
  - A sell is never refused by the backstop.
- [x] **Step 2:** Implement. `cashUsd` comes from `out.ledger.cash`, which is broker truth.
- [x] **Step 3:** Commit: `feat(guards): never-leverage cash backstop checked against broker cash`.

### Task 3.3: Clip-to-turnover for ENTER-only plans (#11)

**Files:**
- `lib/trade/breakers.ts`
- `lib/trade/rebalance.ts`: add `SkipCode` `"TURNOVER_CLIP"`.
- `lib/trade/config.ts`: add `turnoverClipEnterOnly: boolean`, default **false**; turn it on after the
  paper phase.
- `lib/trade/cron.ts:158`
- `breakers.test.ts`, `cron.test.ts`

**Interfaces:**

```ts
export function clipToTurnover<T extends { qty: number; limitPrice: number; reason: string; targetWeight: number; ticker: string }>(
  orders: T[], nav: number, cfg: TradeConfig): { kept: T[]; clipped: T[] } | null; // null = not clippable (any non-ENTER order)
```

- Orders are sorted by `targetWeight` descending, then greedily kept while cumulative
  `qty·limitPrice ≤ maxRunTurnoverFrac·nav`.
- Whole orders only; an order is never resized.
- In cron, on a trip:
  - If the knob is on and `clipToTurnover` returns non-null: execute `kept`, add `clipped` to
    `record.plan.skipped` as `TURNOVER_CLIP`, **do not bump halt**, and notify with the count and value
    deferred.
  - Otherwise: halt as today.

**Steps**

- [x] **Step 1:** Write tests.
  - The clip keeps the top-weight orders and stays ≤ cap.
  - A single order bigger than the cap gives an empty `kept`, which cron treats as noop + notify.
  - A mixed ENTER/ADD plan returns `null`, so it halts.
  - The knob off halts exactly as today.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `feat(trade): clip ENTER-only plans to the turnover cap instead of halting`.

### Task 3.4: Guarded fast bootstrap (optional, #11)

**Files:**
- `lib/trade/breakers.ts`: `bootstrapAllowed(input): {ok: boolean; why: string[]}`
- `config.ts`: `maxBootstrapTurnoverFrac 1.0`, `bootstrapMinCashFrac 0.98`
- `cron.ts`, `trade-cron.ts` (reads `TRADE_BOOTSTRAP === "1"` into `CronDeps.bootstrap`)

**Conditions — all must hold:**
- `deps.bootstrap` is set;
- broker positions are empty;
- `cash/equity ≥ bootstrapMinCashFrac`;
- the net filled qty per ticker in fills.jsonl is 0 for every ticker;
- every order is an ENTER.

If they hold, the turnover cap for this run is `maxBootstrapTurnoverFrac`, and cron sends a loud notify.

**Steps**

- [ ] **Step 1:** Write tests: one case for each failing condition (each halts), plus the all-pass case,
  which executes.
- [ ] **Step 2:** Implement and go green.
- [ ] **Step 3:** Commit: `feat(trade): opt-in, fully-guarded cron bootstrap from flat`.

### Task 3.5: Schwab refresh-token health (#12)

**Files:**
- `lib/broker/schwab-auth.ts`: `refreshTokenHealth`
- `lib/trade/cron.ts`: preflight
- `scripts/trade-auth.ts`: `--status`
- `lib/trade/scheduler.ts`: `SchedulerStatus.schwabRefreshExpiresAt`
- `config.ts`: `schwabRefreshLifetimeMs 7·86400000`, `schwabAuthWarnHours 72`
- Tests

**Interfaces:**

```ts
export function refreshTokenHealth(t: SchwabTokens | null, nowMs: number, nextRunMs: number,
  cfg: { schwabRefreshLifetimeMs: number; schwabAuthWarnHours: number }):
  { level: "ok" | "warn" | "critical" | "unknown"; expiresAt: number | null; remainingMs: number | null };
```

- `critical` if `expiresAt ≤ nextRunMs + 15 min`.
- `warn` if `remainingMs < warnHours`.
- `unknown` if `refreshObtainedAt` is missing.

**Where it runs:**
- **Cron preflight.** Only when `adapter.kind === "schwab"`, after the kill switch and before the clock,
  so it also runs on closed days. `CronDeps` gains `authHealth?: () => Health`, injected by
  `trade-cron.ts`.
- **Dedup.** Via `paths.authWarn` (`data/trade/auth-warn.json {day, level}`): notify once per ET day per
  level, and immediately when the level escalates.

**Steps**

- [x] **Step 1:** Write tests.
  - The level boundaries.
  - On a Friday, a token expiring Saturday 10:00 is critical, because the next run is Monday.
  - A missing field gives unknown.
  - In cron, two runs on the same day notify once, and an escalation notifies again.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Confirm the rotation semantics. `ensureAccessToken` keeps the old `refreshObtainedAt`
  when Schwab rotates the refresh token (spread at line 72). If Schwab resets the 7-day clock on
  rotation, set `refreshObtainedAt: nowMs` whenever `r.refresh_token` differs. Check against a real
  refresh response, and cover the chosen behaviour with a test.
- [x] **Step 4:** Commit: `feat(schwab): proactive refresh-token expiry warnings`.

**Phase 3 exit:**
- Paper: a from-flat account with `turnoverClipEnterOnly` builds over several runs without halts.
- A seeded mixed plan over the cap still halts.
- `trade:auth --status` prints the expiry.
- Update `engine.md` §6.1 and §7.

---

## Phase 4 — Observability

> **Status: implemented 2026-09-26** (`7f4417c`, `93ef59b`, `85e3d9c`, and the run-record commit after it).
> Data collection for the τ_max revisit (L.1) starts with the first Schwab run on this code; the backtest
> harness (L.2) starts accumulating scenario-risk history from the same point.

### Task 4.1: Limit diagnostics on every order (#9)

**Files:** `lib/trade/limit.ts` (`LimitResult`), `lib/trade/orders.ts` (`OrderRequest`), `limit.test.ts`,
`orders.test.ts`.

**Fields added:** `relSpread: number | null`, `tauWanted: number`, `bid`, `ask`, `quoteAgeMs`,
`tradeAgeMs` (all `number | null`).

- [x] **Step 1:** Write tests: `tauWanted = max(base, β·relSpread)` before the clamp, and
  `capBound ⇔ tauWanted > τ_max`.
- [x] **Step 2:** Implement: thread the fields through `tradesToOrders`.
- [x] **Step 3:** Commit: `feat(trade): persist spread/τ/quote-age diagnostics per order`.

### Task 4.2: Fill quantities + latency timestamps on executed orders (#9, #10)

**Files:**
- `lib/trade/pipeline.ts`: `ExecutedOrder`, `mergeExecution`, `planRun` (anchor capture) and
  `executeOrders`.
- `pipeline.test.ts`

**Fields and wiring:**
- `mergeExecution` also copies `filledQty`, `filledAvgPrice`, `submitStartAt`, `submitAckAt` and
  `terminalAt`.
- `planRun` records `anchorAtMs[ticker]` via an injected `clock: () => number` (default `Date.now`).
- The `nowMs` passed to `computeLimit` becomes the per-ticker anchor time, not the run start. This fixes
  the early freshness reference.

**Steps**

- [x] **Step 1:** Write tests with an injected clock: the order-record timestamps are monotonic, and
  freshness is evaluated at anchor time.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `feat(trade): per-order latency timestamps and filled qty in the run record`.

### Task 4.3: `trade:review` cap-bind and latency stats

**Files:** `scripts/trade-review.ts`, `trade-review.test.ts`.

**Output, per broker:**
- fill ratio for capBound vs non-capBound orders;
- `tauWanted/τ_max` p50/p90 per bucket;
- p50/p95 for anchor→submit, submit→ack and submit→terminal.

Paper and Schwab are always reported separately.

- [x] **Step 1:** Write tests with synthetic run records: the stats are correct and the brokers are not
  mixed.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `feat(review): cap-bind fill ratios and latency percentiles by broker`.

### Task 4.4: Richer `RunRecord.signals` (#6 prerequisite)

**Files:** `lib/trade/run-record.ts`, `lib/trade/pipeline.ts:54`, `run-record.test.ts`.

**Fields added, all optional in zod for back-compat:** `sigma`, `sigmaDown`, `D`, and
`scenarios: {p, impliedPrice}[]`.

- [x] **Step 1:** Write tests: an old record still parses, and a new record round-trips.
- [x] **Step 2:** Implement and go green.
- [x] **Step 3:** Commit: `feat(trade): run record keeps scenario risk fields for future replay`.

**Phase 4 exit:**
- `trade:review` on a week of paper runs shows the new sections.
- Record the start date of Schwab data collection in `engine.md` §5.3. The τ_max revisit requires ≥5
  Schwab runs after it.

---

## Phase 5 — Deployment (#8)

### Task 5.1: Residual band for recent entries

**Files:**
- `lib/trade/config.ts`: add `topUpRecentBuys: boolean` (default **false**) and `residualBand: number`
  (0.005). Validate `0 < residualBand ≤ tradeBand`.
- `lib/trade/rebalance.ts`, in the HOLD branch (lines 91–99).
- `rebalance.test.ts`

**Rule.** In the HOLD branch, if all of the following hold:
- `cfg.topUpRecentBuys`;
- `d > 0`;
- `isSellLocked(locks, t, today)`;
- `d > cfg.residualBand`;
- the name is not buy-locked;

then emit `ADD` with a trade note `residual`. The existing sell side and the unlocked path are untouched.

**Steps**

- [ ] **Step 1:** Write tests.
  - Knob on, sell-locked held name, 1pp gap → ADD.
  - Same, but not sell-locked → BELOW_BAND.
  - A sell-side gap never gets the exemption.
  - Knob off → exactly today's behaviour.
  - A buy-locked name is never added (it can't be both, but assert it).
- [ ] **Step 2:** Implement and go green. `minOrderUsd` dust handling in `orders.ts` still applies
  unchanged.
- [ ] **Step 3:** Commit: `feat(trade): opt-in residual band tops up recent entries`.

### Task 5.2: Optional second daily run

**Files:**
- `lib/trade/config.ts`: add `cronTimesET: string[]` (default `[cronTimeET]`). Keep `cronTimeET` as an
  alias for the first entry.
- `lib/trade/scheduler.ts`: arm the next of `cronTimesET`; `lastFiredDay` becomes
  `lastFired: {day, slot}`, with a state-file migration that treats the old shape as slot 0.
- Both register scripts: one trigger per time.
- `cron.ts`: the fire-window guard checks the nearest slot.

**Steps**

- [ ] **Step 1:** Write tests.
  - Two slots fire once each per day.
  - A missed slot does not catch up past its window.
  - Old state migrates.
  - A second FakeBroker run on the same day uses new clientOrderIds (a new runId).
- [ ] **Step 2:** Implement and go green.
- [ ] **Step 3:** Commit: `feat(trade): support multiple daily cron slots`.

### Task 5.3: Daily turnover cap across runs

**Files:**
- `lib/trade/breakers.ts`: `dayTurnover(runsDir, today): number`, which sums
  `filledQty·filledAvgPrice` over today's run records (needs Task 4.2).
- `config.ts`: `maxDayTurnoverFrac 0.25`.
- `cron.ts`, applied together with the per-run breaker.

**Steps**

- [ ] **Step 1:** Write tests: a second run that would push the day over the cap halts, or clips when
  ENTER-only.
- [ ] **Step 2:** Implement and go green.
- [ ] **Step 3:** Commit: `feat(trade): cumulative daily turnover cap`.

**Phase 5 exit:**
- Paper: `topUpRecentBuys` on for 2 weeks.
- Measure invested % after entry weeks against the phase-2 baseline, using the Phase 4 stats.
- Enable on Schwab only if deployment improves and the day-turnover cap never trips unexpectedly.

---

## Phase 6 — Research & display

### Task 6.1: Staleness becomes a true 90-day half-life (F9) — **decided: owner chose a true half-life**

**Decision (2026-09-26).** Keep the knob name `stalenessHalfLifeDays` and the value 90, and change the
formula so the name is accurate:

```
staleness = exp(−ageDays · ln2 / stalenessHalfLifeDays)      // = 0.5 ^ (ageDays / 90)
```

**Behaviour change.** Every report's staleness multiplier rises, and older reports rise the most:

| ageDays | before `exp(−a/90)` | after `0.5^(a/90)` |
|---|---|---|
| 0 | 1.000 | 1.000 |
| 30 | 0.717 | 0.794 |
| 60 | 0.513 | 0.630 |
| 90 | 0.368 | 0.500 |
| 120 (eligibility max) | 0.264 | 0.397 |

Weights are allocated in proportion to score, so the effect is a *relative* shift of weight toward older
reports. For example, the ratio between a 0-day and a 120-day report falls from 3.8× to 2.5×. This hits
the score sizer (`sizing.ts:33`) and `kellyTilt` (`sizing-v2.ts:63`) equally.

The following are unchanged:
- eligibility, hysteresis and exits, which use `stalenessMaxDays`, not the multiplier;
- the 120-day cutoff;
- caps, locks and bands.

**Files:**
- `lib/portfolio/signal.ts:52`
- `lib/portfolio/config.ts:23`: fix the comment
- `lib/portfolio/signal.test.ts`
- `docs/engine.md` §2 (the `staleness` line)

**Steps**

- [ ] **Step 1: Write the failing test.** In `signal.test.ts`, with a fixture report dated 90 days
  before `today`, `buildSignal(...).staleness` is `toBeCloseTo(0.5, 9)`. At 0 days it is `1`, and at
  180 days it is `toBeCloseTo(0.25, 9)`.
- [ ] **Step 2:** Run it and confirm it fails (it currently returns 0.3679).
- [ ] **Step 3: Implement.**
  - Set `const staleness = Math.pow(0.5, ageDays / config.stalenessHalfLifeDays);`.
  - Change the `config.ts` comment to `// soft recency decay half-life in days: staleness = 0.5^(age/h) (e.g. 90)`.
- [ ] **Step 4: Check for other assertions.** Run the full suite. Existing tests inject `staleness`
  directly (`sizing.test.ts`, `sizing-v2.test.ts`, `hysteresis.test.ts`, …), so no other assertion should
  move. Fix any snapshot or golden that encodes a computed staleness, and mention it in the PR.
- [ ] **Step 5: Measure the impact.**
  - Run `npm run portfolio:build` (or the scratchpad harness from the review) at the same `--date`
    before and after the change.
  - Record in the PR: N_eff, cash, the largest weight changes and total one-way turnover.
  - The expected effect is small, since most reports are under 60 days old. If turnover is above 5%,
    flag it to the owner before merging.
- [ ] **Step 6: Update the docs.**
  - `engine.md` §2: `staleness = 0.5^(ageDays / 90)   soft recency decay (true half-life 90d)`.
  - Update the `stalenessHalfLifeDays` row in the §8 table if it's worded as e-folding.
- [ ] **Step 7:** Commit: `fix(portfolio): staleness decays with a true 90-day half-life`.

**Rollout.** This changes the target book, so it can trigger rebalancing trades. Merge it on a day when
the next cron run can be watched. The no-trade band (2.5pp) should absorb most of the shift.

### Task 6.2: Dispersion-widened rating bands (#2)

**Files:**
- `lib/synth/decide.ts`: `DecisionPolicy.applyDispersionBands` (default false in `SAFE_DEFAULTS`), and
  `DecisionInputs.uncertainty.scenarioDispersion?: number`.
- The desk config `rating.dispersionBands {ref: 0.25, maxMult: 2.5}`.
- `scripts/synth-build.ts`: compute the scenario σ vs report price and pass it in.
- `lib/synth/validate-judgment.ts`: honour `decision.policyVersion`.
- `lib/report.schema.ts`: optional `decision.policyVersion`.
- `decide.test.ts`, `validate-judgment` tests.

**Rule.** `mult = max(tierMultOrOne, clamp(σ/ref, 1, maxMult))`, applied to `buy`/`strongBuy.minUpside`
only.

**Steps**

- [ ] **Step 1:** Write tests.
  - The knob off gives identical output for every fixture.
  - A KTOS-like fixture (σ high, E just over the band) goes BUY → HOLD.
  - An EVLV-like fixture goes SB → B.
  - The label is never more bullish than with the knob off (property test over a grid).
  - A report without `policyVersion` validates exactly as today.
- [ ] **Step 2:** Implement and go green. Stamp `policyVersion: 2` only when the knob is on.
- [ ] **Step 3:** Commit: `feat(synth): opt-in scenario-dispersion band widening, versioned`.
- [ ] **Step 4:** Update `engine.md` §1.3. Mention the existing `applyUncertaintyBands` (F11) and the new
  knob.

### Task 6.3: Touch probability, display only (#1)

**Files:**
- Create `lib/portfolio/touch.ts` and `touch.test.ts`
- `lib/portfolio/signal.ts`: optional `touch`
- `lib/portfolio/snapshot.ts`: the snapshot and CSV
- The dashboard component that renders the holdings table: a column shown only when `showTouch`
- `config.ts`: `touchHorizonYears 1`, `touchDrift 0`, `showTouch false`

**Interfaces:**

```ts
export function realizedVol(closes: number[], annualize?: number): number | null; // ≥20 log-returns
export function touchProbability(S0: number, H: number, sigma: number, nu: number, T: number): number; // H ≤ S0 → 1
```

**Steps**

- [ ] **Step 1:** Write tests.
  - The closed form agrees with a seeded Monte Carlo (10k paths) within 0.02.
  - Monotonic in σ.
  - `H ≤ S0` returns 1.
  - Fewer than 20 closes → null.
  - **Guard test:** `scoreWeight` and eligibility give identical results with and without `touch`.
- [ ] **Step 2:** Implement and go green. Label the column "P(touch FV, 1y, model)".
- [ ] **Step 3:** Commit: `feat(portfolio): display-only touch probability`.

### Task 6.4: Doc corrections (F10, F11; #4/#5 verdicts)

**Files:** `docs/engine.md`, `docs/superpowers/specs/2026-09-25-trade-layer-phase2-design.md:89`.

- [ ] **Step 1:**
  - Replace the §2 σ↓ callout and the §3.2 mean-CVaR callout with "🚫 Not an option" notes carrying the
    quantified reason (Spearman 0.996; CVaR reduces to D).
  - Fix the "realized vol already fetched" claims.
  - Mention `applyUncertaintyBands` in §1.3.
- [ ] **Step 2:** Commit: `docs(engine): record rejected ideas and correct stale claims`.

---

## Later — data-gated (not scheduled)

- **L.1 τ_max revisit.**
  - **Trigger:** ≥5 Schwab runs with Phase 4 data.
  - **Rule:** raise `limitTolMax[bucket]` only if the capBound fill ratio is below 50% **and** the
    `tauWanted/τ_max` p50 is below 1.5 (just over the cap, not a wide-spread outlier).
  - One bucket at a time, via config only.
- **L.2 Backtest harness + kellyTilt A/B.**
  - `lib/portfolio/backtest.ts` `replay(records, scorer, cfg) → {returns, turnover, nEff}`, plus
    `scripts/backtest.ts`, comparing score vs kellyTilt vs 1/N.
  - **Trigger:** ≥3 months of run records with the Task 4.4 fields.
- **L.3 σ blend (#3).** Only if invSigma enters an A/B. Reuse `realizedVol` from Task 6.3 on ≥252
  closes and add `sigmaBlend` (default 0).

## Not built

These ideas were dropped in the review:

- σ↓ as the risk unit (#4)
- mean-CVaR (#5)
- the immediate same-session top-up loop (#8)
- skipping orders by spread (#9)
- a general ENTER/from-flat turnover exemption (#11)
- per-lot locks and fractional shares (owner rules)

## Self-Review

**Spec coverage.** Every ADOPT / ADOPT-WITH-CHANGES item and every finding maps to a task:

| Spec item | Task(s) |
|---|---|
| #13 | 1.2, 1.4 |
| F1 | 1.1, 1.3 |
| F7 | 1.5 |
| F6 | 2.1 |
| F2 | 2.2 |
| #7, F3, F4 | 2.3, 2.4 |
| #10 | 2.5–2.7, 4.2 |
| #11, F8 | 3.1, 3.3, 3.4 |
| F5 | 3.2 |
| #12 | 3.5 |
| #9 | 1.5, 4.1–4.3 |
| #6 | 4.4, L.2 |
| #8 | 5.1–5.3 |
| F9 | 6.1 |
| #2 | 6.2 |
| #1 | 6.3 |
| F10, F11, #4, #5 | 6.4 |

DEFER items live in Later.

**Safety invariants.** No task touches `locks.ts` semantics, `isBannedTicker`, or the never-leverage
scaling in `emitTrades`.

- Every new behaviour knob that could add orders — `topUpRecentBuys`, `turnoverClipEnterOnly`,
  bootstrap, `cronTimesET` — defaults off or to today's single slot.
- The tightenings default on: the clock fix, `reconcileOrders`, the fire window and the cash backstop.
- Submits are never retried (Tasks 2.5–2.7 assert exactly one `submitOrder` call).

**Dependencies:**

| Task | Needs |
|---|---|
| 2.4 | 2.3 |
| 2.7 | 2.5, 2.6 |
| 5.3 | 4.2 |
| 5.2 | 1.5 |
| 6.3 | nothing (its `realizedVol` is reused by L.3) |

All other tasks within a phase are independent and can run in parallel.
