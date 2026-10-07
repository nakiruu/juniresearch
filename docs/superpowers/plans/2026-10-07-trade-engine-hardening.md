# Trade Engine Hardening (audit item 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (2026-10-07).** Folds in the adversarial review (APPROVE WITH CHANGES, findings F-1 … F-12). Items formerly deferred as D-1 (guard abort mid-run), D-4 (cron lock ownership) and D-6 (vitest exclude) are now in scope. D-2 (token-POST retry) stays deferred; the reason is given below.

**Goal:** Close the live-money failure modes found by the 2026-10-06 read-only audit (T-1, T-2, T-4, T-5, T-8, A-3/T-7, plus T-11, T-19, A-5) without changing what the engine decides or any active lock, so the next container pull can run the four pending exits (V, CEG, RTX, SCHW) safely.

**Architecture:** Each fix stays in the module that owns the failure:
- `locks.ts` stops counting from days the calendar does not hold.
- `http.ts`/`schwab.ts` treat 429/5xx on idempotent reads (and the idempotent cancel) as transient, with bounded, Retry-After-aware backoff. A submit is never retried.
- `executeOrders` bounds its poll loops and always tries to cancel a still-working order. It stops the run (`aborted`) when it loses track of an order or a guard refuses one mid-run.
- `runCron` counts a halt only once an order has reached the broker. Its callers alert on any escaped error.
- `trade:execute` takes cron's run-lock, owns it, re-checks it before submitting, and refuses while halted.
- State files are replaced atomically.

No sizing, hysteresis, signal or schedule logic changes. The per-order guards are untouched.

**Tech Stack:** TypeScript (Node, ESM, `tsx`), Vitest 5 (`vitest.config.mts`), ESLint 9 (`eslint-config-next`), Next 16 instrumentation hook.

**Spec:** the 2026-10-06 read-only trade-engine audit (T-1, T-2, T-4, T-5, T-8, A-3/T-7, T-11, T-15, T-16, T-17, T-19, A-5) as relayed in the owner's request for "item 1 of the audit", re-verified against `main` @ `f4f1849` on 2026-10-07, plus the adversarial review F-1 … F-12 (2026-10-07). House rules: `docs/10022026learning.md` §5. Engine reference: `docs/engine.md` §4–§8.

## Owner decisions (defaults — owner may override at STOP (a))

The owner has not answered, so the reviewer's recommendations apply as defaults:

1. **Phase-based halt counting (F-4).**
   - An error that escapes before any order reaches the broker (clock, plan or market-data reads, building the broker) is **alert-only**.
   - An error or stop after the first submit **bumps** the consecutive-halt counter. This is enforced inside `runCron` around step 8.
   - `makeBroker`'s "No Schwab tokens" and "Schwab account not linked" are auth errors.
2. **Retries:** 2 s / 5 s / 10 s for 429/5xx, with Retry-After honoured up to a 15 s cap. This applies **only together with** the F-2 poll bounds: 3 consecutive failed reads or 60 s of wall clock per poll loop. Worst case is about **110 s per broker call**, because the timeout budget and the HTTP budget are independent.
3. **Token file 0600**, with the F-5 fallback (direct write on EXDEV, or on any rename failure on Linux). `trade:auth` always runs as the container user (`nextjs`), never as root.
4. **Manual-run lock** for `trade:execute`:
   - Ownership is re-checked just before submitting.
   - A plan more than 10 minutes old is refused.
   - SIGINT, SIGTERM and SIGHUP release the lock.
   - A scheduled run that finds the lock held posts an alert (F-10).

## Global Constraints

- LIVE MONEY. The deployed container is armed (`BROKER=schwab`) on `main` and does not auto-pull. Nothing in this plan calls a broker.
- Never run any `npm run trade:*` script. Never call Schwab or Alpaca. Tests use `FakeBroker`, subclasses of it, or an injected `fetchImpl`.
- Never read or write anything under `data/trade/`. That covers token contents, fills and halt state. Every test uses `mkdtempSync(join(tmpdir(), …))`.
- **Work only in `.worktrees/trade-engine-hardening`.** Do NOT use the harness's worktree isolation (it creates `.claude/worktrees/…`, which this repo's own tooling sweeps up).
- Do not touch these:
  - `.env*` and `BANNED_TICKERS` (`lib/portfolio/eligibility.ts`);
  - `lib/broker/guards.ts`, `lib/trade/hysteresis.ts`, `lib/trade/rebalance.ts`;
  - the `lib/trade/config.ts` defaults, including `cronTimesET`, `submitCutoffET`, `maxLateMin`, `lockBusinessDays`, `maxOrdersPerRun` and `consecutiveHaltLimit`.
- An order SUBMIT is never retried. `SubmitOutcomeUnknownError` → `findSubmitted` lookup is the only recovery for a lost submit, and it stays exactly as it is.
- The semantics of any lock that is still active must not change. The owner authorised changing lock-computation code for T-1 on that condition.
- No model IDs in commits. End every commit message with the two trailer lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW`.
- No PRs, no push, no merge to `main` without the owner's approval at STOP (b).
- Windows is the dev platform. Tests must not assume POSIX file modes on `win32` (`it.skipIf(process.platform === "win32")`).
- Until Task 6 lands, run only the listed test files, never the whole suite. Today `scheduler-wiring.test.ts` appends to the real `data/trade/cron.log` (relative to the cwd).

## Review Focus

1. **A manual run's lock released after cron reclaimed it as stale.**
   - Scenario: a `trade:execute` sits at its prompt past the stale threshold, and cron reclaims the lock.
   - Expected: the manual process must not delete cron's lock when it exits, and must not submit on a lock it lost.
   - Pinned in Task 3 (`holdLock` ownership) and Task 7 (pre-submit `stillOurs`).
2. **Retry-After in the other format or out of range.**
   - Inputs: an HTTP-date, a date in the past, `0`, or `120`.
   - Expected: a bounded wait, never negative and never above the cap.
   - Pinned in Task 2.
3. **Clock skew on market data.**
   - Expected: a trade or quote stamped a few seconds in the future is still fresh. Only a stamp more than `maxStaleMin` ahead is stale.
   - Pinned in Task 9.
4. **The alert path itself failing.**
   - Expected: a throwing `notify` must never mask the original error, and nothing in the alert path may throw.
   - Pinned in Task 6.
5. **A crash leftover in `data/trade/runs/`.**
   - Expected: a temp file left by a crash mid-write must never be read as a run record by `dayTurnoverUsd`, which globs `*.json`.
   - Pinned in Task 8.

---

## Finding verification (main @ f4f1849, 2026-10-07)

Every finding is still present; none was already fixed.

| ID | Verified at | Status / correction |
|---|---|---|
| T-1 | `lib/trade/locks.ts:17-18`, `pipeline.ts:155` (calendar = today−90 … today+45 calendar days), `pipeline.ts:211` | Present. The throw is `addTradingDays: <date> is not a trading day` (`indexOnOrBefore` returns −1 before `calendar[0]`). The first live fill was 2026-09-25, and 90 days later is 2026-12-24. Extending the calendar is not viable long-term, because `nyseTradingDays` refuses dates before `COVERAGE_START` 2025-01-01. |
| T-2 | `pipeline.ts:505-518` | Present. Nothing after the submit is protected either: a failed `appendFill` leaves a working order uncancelled. |
| T-4 | `scheduler.ts:140-146`, `scheduler-wiring.ts:53-69`, `scripts/trade-cron.ts:98-102` | Present. Separately, `scheduler-wiring.test.ts` (the disabled path) appends to the real `data/trade/cron.log`. |
| T-8 | `schwab.ts:121-125`, `http.ts:62-64`, `cron.ts:318-322` | Present. Also: `scripts/trade-execute.ts:87-91` reads the audit the same unguarded way; `cancelOrder` (`schwab.ts:294-297`) is never retried; `docs/engine.md:783` says "a 429 is not retried". |
| T-5 | `scripts/trade-execute.ts` | Present: no run-lock and no halt check. |
| A-3/T-7 | `schwab-auth.ts:54-57`, `breakers.ts:87-97`, `scheduler.ts:52-56`, `run-record.ts` `writeRunRecord` | Present. The container runs as `nextjs` (`USER nextjs` in the Dockerfile), the same user for the web app and for `trade:*`. |
| T-11 | `limit.ts:72-73`, `limit.ts:78` | Present. `orders.ts:56` (`marketLegBlock`) has the same hole. |
| T-19 | `orders.ts:123-124` | Present. Two more sell-quantity paths can exceed 4 dp (`orders.ts:105-106`): a fractional-mode EXIT sends `pos.qty` raw, and a TRIM capped at `pos.qty` keeps its decimals. `schwabOrderBody` refuses more than 4 dp locally, so nothing is sold. |
| A-5 | `instrumentation-node.ts:11-26` | Present. |
| T-15 | `docs/engine.md:337` ("this engine only sends IOC") | Stale. |
| T-16 | `docs/engine.md:611` | Stale: the turnover breaker is OFF unless `TURNOVER_BREAKER` is set (`runtime.ts:44`). |
| T-17 | `docs/engine.md:710` ("one 11-method `BrokerAdapter`") | Stale: the adapter has 12 required methods plus the optional `getLatestSnapshots`. |

**Brought into this batch by the review:** D-1 (a `GuardError` mid-run escapes → Task 4), D-4 (cron releases a lock that is no longer its own → Task 3), D-6 (`vitest.config.mts` sweeps `.claude/**` → Task 0).

**Still deferred:**
- **D-2:** retry the token POST on 429/5xx. It is not small. `ensureAccessToken` has no injectable sleep, so a retry would need a new parameter threaded through `SchwabBroker`. The existing "does not fall back on a non-auth failure (5xx)" test would also have to change from one POST to four. Leave the auth path untouched in this batch.
- **D-3:** add a client-side rate limiter. About 90 `pricehistory` calls at concurrency 4 can exceed Schwab's limit of roughly 120 requests a minute. Task 2 mitigates this.
- **D-5:** write `ledger.json`, `relabel-state.json` and `auth-warn.json` atomically. They are derived or advisory files, and a torn write fails safe.

## What not to touch

- **Live state.** `data/trade/**` covers fills, the ledger, runs, halt state, scheduler state, `cron.lock`, `cron.log` and **`schwab-token.json`**. Never open, write or delete any of it, not even to clean up after a test.
- **Secrets.** `.env`, `.env.local`, `.env.example`, any secret, and the `SCHWAB_*` values.
- **Ban and guards.** `BANNED_TICKERS` / `isBannedTicker`, and every rule in `lib/broker/guards.ts`.
- **Fills log.** `lib/trade/fills.ts` (the append-only fills log) and the `appendFill` call itself.
- **Lock exclusivity.** `acquireLock`'s `wx` create is the exclusivity. Do NOT convert it to temp+rename. Task 3 only adds a random token to the body and an mtime fallback for an unparseable body.
- **Submit path.** `submitOrder` in both adapters, `findSubmitted`, `resolveUnknownSubmit`, and the `SubmitOutcomeUnknownError` handling.
- **Turnover and cash logic.** `clipToTurnover`, `turnoverBreaker`, the `dayTurnoverUsd` logic, and the cash-backstop arithmetic.
- **Decision logic.** `lib/trade/hysteresis.ts`, `rebalance.ts`, `lib/portfolio/**` and `lib/synth/**`.

## Preservation map

| Invariant | Why it cannot change | Guard test |
|---|---|---|
| ICE buy ban | `guards.ts` untouched; every submit still goes through `guardedSubmit`. A guard refusal now stops the run (`aborted: guard`) instead of escaping — still nothing placed. | existing `guards.test.ts` "refuses a buy of a banned symbol"; Task 4 guard-abort test |
| Submit idempotency | Retries are added only to GETs and the DELETE cancel; `submitOrder` untouched. | Task 2 "a 429 on submit is OrderRejected and POSTed exactly once" + existing "POSTed exactly once" |
| Cash backstop | Reservation/true-up lines are moved into a `try` unchanged; a non-terminal order keeps its full reservation. | Task 4 "every poll fails … full buy reservation kept" + existing cash-backstop describe |
| clipToTurnover | Not touched. | existing `breakers.test.ts` + `cron.test.ts` turnover-clip describe |
| TRADE_DISABLED | Step-1 check untouched. The per-submit check still refuses; cron now reports it as `halted (guard)` instead of throwing, and nothing is sent. | existing step-1 tests; updated "guard-level kill switch" test (Task 4) |
| PREVIEW_ONLY | Previews never reach step 8, so they can never bump; `trade:execute --preview` takes no lock. | existing PREVIEW_ONLY describe; Task 6 wiring test |
| Active-lock semantics | Only fills dated before `calendar[0]` are skipped, and only when `today` is ≥ n trading days into the calendar, which proves their lock expired. | Task 1 equivalence test (daily fills, n ∈ {1,5,6}, Oct 2026 – Jan 2027, weekend `today`) |
| 15:10 schedule | `scheduler.ts` timing, `config.ts` and the fire window untouched; `runOnce` still rejects on an escaped error, so re-arming is unchanged. | existing `scheduler.test.ts` (incl. "a rejecting runOnce never crashes and still re-arms") |

## File map

| File | Change |
|---|---|
| `vitest.config.mts` | exclude `.claude/**` |
| `lib/trade/locks.ts`, `pipeline.ts:211` | `locksFor(…, today)` skips pre-calendar fills with a checked proof |
| `lib/broker/http.ts`, `lib/broker/schwab.ts` | `BrokerHttpError`, `parseRetryAfter`, HTTP retry budget; Schwab GET and cancel use it |
| `lib/trade/breakers.ts` | lock body token + mtime staleness; `holdLock` (ownership); `acquireManualRun`, `manualPlanTooOld`; atomic `bumpHalt`/`clearHalt` |
| `lib/trade/pipeline.ts` | bounded polls; `aborted` reasons `poll-unavailable` / `guard`; `pollErrors`/`cancelError`/`cancelNote`; escape-cancel |
| `lib/trade/cron.ts` | `holdLock` + locked alert; `abortAlert`; halts `audit-unavailable` / `order-working` / `execute-error`; phase-based bump; `reportUnexpectedCronError` (alert-only); `pollMs` passthrough |
| `lib/trade/runtime.ts` | the two `makeBroker` Schwab setup errors become `SchwabAuthError` |
| `lib/trade/scheduler-wiring.ts`, `scripts/trade-cron.ts` | catch → alert → flush → re-throw; injectable notifier/paths |
| `scripts/trade-execute.ts` | gate before planning; ownership + plan-age check before submit; SIGHUP; abort/audit messages |
| `lib/atomic-write.ts` (new) | `writeFileAtomic` with EXDEV/Linux fallback and directory fsync |
| `lib/broker/schwab-auth.ts`, `lib/trade/scheduler.ts`, `lib/trade/run-record.ts` | atomic writes (token 0600) |
| `lib/trade/limit.ts`, `lib/trade/orders.ts` | two-sided freshness; sell quantities floored to 4 dp |
| `instrumentation-node.ts` | arm once per process |
| `docs/engine.md` | behaviour + stale lines |

---

### Task 0: Worktree, baseline, and the vitest exclude (D-6)

**Files:** Modify `vitest.config.mts:4`.

- [ ] **Step 1: Create the worktree under `.worktrees/`** (already excluded by `vitest.config.mts` and `tsconfig.json`; do not use the harness's `.claude/worktrees` isolation)

```bash
cd C:/Users/nicopc/Documents/juniresearch
git worktree add .worktrees/trade-engine-hardening -b claude/trade-engine-hardening-2026-10-07 main
cd .worktrees/trade-engine-hardening
npm ci
```

The worktree has no `data/trade/` (it is gitignored), so tests run from here cannot reach live state. Every later command runs in this directory.

- [ ] **Step 2: Baseline the touched test files** (not the whole suite — see Global Constraints)

Run: `npx vitest run lib/trade/locks.test.ts lib/trade/pipeline.test.ts lib/broker/http.test.ts lib/broker/schwab.test.ts lib/broker/schwab-auth.test.ts lib/broker/guards.test.ts lib/trade/breakers.test.ts lib/trade/cron.test.ts lib/trade/scheduler.test.ts lib/trade/limit.test.ts lib/trade/orders.test.ts lib/trade/run-record.test.ts lib/trade/runtime.test.ts instrumentation.test.ts`
Expected: all PASS.
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Exclude `.claude/**` from Vitest.** In `vitest.config.mts` line 4 change

```ts
const exclude = ["**/node_modules/**", ".next/**", ".worktrees/**"];
```
to
```ts
// .claude/** holds harness worktrees (full repo copies); without this the suite runs their stale tests too.
const exclude = ["**/node_modules/**", ".next/**", ".worktrees/**", ".claude/**"];
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run lib/trade/locks.test.ts` → PASS, and the summary reports 1 test file (not 2).

```bash
git add vitest.config.mts
git commit -m "chore(test): exclude .claude/** (harness worktrees) from vitest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 1: T-1 — `locksFor` never throws on a fill older than the loaded calendar

**Files:** Modify `lib/trade/locks.ts:1-24`, `lib/trade/pipeline.ts:211`. Test `lib/trade/locks.test.ts`, `lib/trade/pipeline.test.ts`.

**Interfaces:** Produces `locksFor(fills: Fill[], calendar: TradingDay[], lockBusinessDays: number, today: TradingDay): Locks` (new required 4th parameter).

**Why skipping is exact** (this goes into the doc comment):
- **Assumption — no gaps.** `getCalendar` returns *every* trading day in its range: `nyseTradingDays` on Schwab, Alpaca's `/calendar`. `assertCalendar` checks only the format and the ordering, not completeness, so this is an assumption.
- **The bound.** Take a fill F dated before `calendar[0]`. The days `calendar[0..n-1]` are n distinct trading days after F, so F's `lockUntil` (its n-th trading day after F) is at or before `calendar[n-1]`.
- **Why that is enough.** Locks are only read as `today < lockUntil`, through `isBuyLocked`/`isSellLocked`; `unlockOn` is read only after one of those returns true. So once `today ≥ calendar[n-1]`, the skipped lock is already expired.
- **Margin.** 90 calendar days always hold at least 56 trading days, far more than n = 5.
- **Checked, not assumed.** If a fill would be skipped while `today` is fewer than n trading days into the calendar, the function throws.

- [ ] **Step 1: Write the failing tests.** In `lib/trade/locks.test.ts`:
  - add `import { nyseTradingDays } from "./nyse-calendar";` to the imports;
  - add `const TODAY = "2026-10-02";` under `CAL`;
  - change every existing `locksFor(x, CAL, n)` to `locksFor(x, CAL, n, TODAY)`.

  Then append:

```ts
describe("locksFor — fills older than the loaded calendar (T-1)", () => {
  const days = (from: string, to: string) => nyseTradingDays(from, to).map((d) => d.date);
  const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
  /** Every calendar day, weekends and holidays included. */
  const calDays = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };

  it("the audit repro: a June fill against a July–November calendar no longer throws and sets no lock", () => {
    const cal = days("2026-07-08", "2026-11-20");
    expect(locksFor([f("buy", "2026-06-15", "OLD"), f("sell", "2026-06-15", "OLD")], cal, 5, "2026-10-07")).toEqual({ buyLockUntil: {}, sellLockUntil: {} });
  });

  it("straddles the window edge: a fill ON calendar[0] still locks, one trading day earlier is skipped", () => {
    // CAL[0] = 2026-09-21 (Mon); 2026-09-18 (Fri) is the trading day before it.
    const L = locksFor([f("buy", "2026-09-21", "EDGE"), f("buy", "2026-09-18", "PRE")], CAL, 5, TODAY);
    expect(L.sellLockUntil).toEqual({ EDGE: "2026-09-29" });
  });

  it("an in-window fill on a non-trading day still throws (fills must carry a trading date)", () => {
    expect(() => locksFor([f("buy", "2026-06-15", "OLD"), f("buy", "2026-09-24")], CAL, 5, TODAY)).toThrow(/not a trading day/);
  });

  it("fails closed when today is too early in the calendar to prove a skipped lock expired", () => {
    expect(() => locksFor([f("buy", "2026-09-18", "PRE")], CAL, 5, CAL[2])).toThrow(/predate the loaded calendar/);
  });

  it("active-lock equivalence vs a full calendar: daily fills, n ∈ {1, 5, 6}, Oct–Nov 2026 and 2026-12-20 … 2027-01-17, weekends included", () => {
    const full = days("2026-01-02", "2027-03-31");
    const tickers = ["A", "B", "C", "D", "E", "F", "G"];
    // A fill on EVERY trading day through 2027-01-15, alternating sides, rotating tickers.
    const fills: Fill[] = full.filter((d) => d <= "2027-01-15").map((d, i) => f(i % 3 === 0 ? "sell" : "buy", d, tickers[i % tickers.length]));
    const todays = [...calDays("2026-10-01", "2026-11-30"), ...calDays("2026-12-20", "2027-01-17")];
    expect(todays).toContain("2026-12-26"); // a Saturday (and the day after the Christmas holiday)
    expect(todays).toContain("2026-12-24"); // the first day the old code would have thrown on live data
    for (const n of [1, 5, 6]) {
      for (const today of todays) {
        const window = days(shift(today, -90), shift(today, 45)); // exactly what planRun loads
        const visible = fills.filter((x) => x.tradingDate <= today);
        const oldL = locksFor(visible, full, n, today);
        const newL = locksFor(visible, window, n, today);
        for (const t of tickers) {
          expect(isBuyLocked(newL, t, today), `n=${n} ${t} buy ${today}`).toBe(isBuyLocked(oldL, t, today));
          expect(isSellLocked(newL, t, today), `n=${n} ${t} sell ${today}`).toBe(isSellLocked(oldL, t, today));
          if (isBuyLocked(oldL, t, today)) expect(newL.buyLockUntil[t]).toBe(oldL.buyLockUntil[t]);
          if (isSellLocked(oldL, t, today)) expect(newL.sellLockUntil[t]).toBe(oldL.sellLockUntil[t]);
        }
      }
    }
  });
});
```

Append to `lib/trade/pipeline.test.ts` inside `describe("planRun", …)`:

```ts
  it("T-1: an old fill (before the 90-day calendar) no longer throws, and sets no lock", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const old = { ticker: "ZZZ", side: "buy" as const, qty: 1, price: 10, filledAt: "2026-06-15T19:30:00Z", tradingDate: "2026-06-15", orderId: "old-1", runId: "old" };
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [old], today: "2026-09-25", cfg, runId: "r1" });
    expect(out.locks).toEqual({ buyLockUntil: {}, sellLockUntil: {} });
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "ENTER" })]);
  });
```

- [ ] **Step 2: Run to verify they fail.** `npx vitest run lib/trade/locks.test.ts lib/trade/pipeline.test.ts` → FAIL (`addTradingDays: 2026-06-15 is not a trading day`).

- [ ] **Step 3: Implement.** Replace `lib/trade/locks.ts` lines 1-24 with:

```ts
/**
 * locks.ts — the owner's 5-business-day no-round-trip rule as data (spec §6.2).
 * A buy fill on T forbids selling that ticker before addTradingDays(T, n); a sell fill forbids
 * buying it before the same. Whole-ticker, both directions; the latest fill per side wins.
 * `lockUntil` IS the first legal day: locked iff today < lockUntil.
 *
 * Fills dated before the loaded calendar are skipped, because their lock has provably expired.
 * ASSUMPTION: the calendar has no gaps — getCalendar returns every trading day in its range
 * (nyseTradingDays, Alpaca /calendar); assertCalendar checks order, not completeness. Then for a
 * fill F < calendar[0], the days calendar[0..n-1] are n trading days after F, so F's lockUntil is at
 * or before calendar[n-1]. Locks are only read as `today < lockUntil`, so once today ≥ calendar[n-1]
 * the skipped lock is inactive. That condition is checked, not assumed: skipping while today is fewer
 * than n trading days into the calendar throws (fail closed). fills.jsonl is append-only, so without
 * the skip every run would throw once the first fill falls out of planRun's 90-day calendar.
 */
import { addTradingDays, indexOnOrBefore, type TradingDay } from "./calendar";
import type { Fill } from "./fills";

export interface Locks {
  buyLockUntil: Record<string, TradingDay>;
  sellLockUntil: Record<string, TradingDay>;
}

export function locksFor(fills: Fill[], calendar: TradingDay[], lockBusinessDays: number, today: TradingDay): Locks {
  const locks: Locks = { buyLockUntil: {}, sellLockUntil: {} };
  const first = calendar[0];
  let skipped = 0;
  for (const f of fills) {
    if (first !== undefined && f.tradingDate < first) { skipped++; continue; } // expired — see the header
    const until = addTradingDays(calendar, f.tradingDate, lockBusinessDays); // throws if tradingDate is not a trading day
    const table = f.side === "buy" ? locks.sellLockUntil : locks.buyLockUntil;
    const prev = table[f.ticker];
    if (prev == null || until > prev) table[f.ticker] = until;
  }
  if (skipped > 0 && indexOnOrBefore(calendar, today) < lockBusinessDays - 1) {
    throw new Error(`locksFor: ${skipped} fill(s) predate the loaded calendar (${first}) and today ${today} is fewer than ${lockBusinessDays} trading days into it — load a longer calendar`);
  }
  return locks;
}
```

In `lib/trade/pipeline.ts:211`: `const locks = locksFor(fills, calendar, cfg.lockBusinessDays, today);`

- [ ] **Step 4: Verify.** `npx vitest run lib/trade/locks.test.ts lib/trade/pipeline.test.ts lib/trade/hysteresis.test.ts lib/trade/rebalance.test.ts lib/broker/guards.test.ts` → PASS; `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/locks.ts lib/trade/locks.test.ts lib/trade/pipeline.ts lib/trade/pipeline.test.ts
git commit -m "fix(trade): locksFor skips fills older than the loaded calendar (T-1)

Their lock has provably expired; the condition is checked and fails closed. Active locks
are unchanged (equivalence vs a full calendar: daily fills, n in {1,5,6}, Oct 2026 - Jan 2027).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 2: T-8 (part 1) — 429/5xx on Schwab reads and cancel are retried; submits never

**Files:** Modify `lib/broker/http.ts:61-84`, `lib/broker/schwab.ts:19,27-31,89-125,294-297`. Test `lib/broker/http.test.ts`, `lib/broker/schwab.test.ts`.

**Interfaces (http.ts):**
- `class BrokerHttpError extends Error { readonly status: number; readonly retryAfterMs: number | null }`
- `isTransientHttpStatus(status: number): boolean` (429 or ≥ 500)
- `parseRetryAfter(value: string | null, nowMs: number): number | null`
- `interface RetryPolicy { httpDelaysMs?: readonly number[]; maxRetryAfterMs?: number }`
- `DEFAULT_HTTP_RETRY = { httpDelaysMs: [2_000, 5_000, 10_000], maxRetryAfterMs: 15_000 }`
- `withReadRetry(fn, delaysMs?, sleep?, isTransient?, policy?)`

**Interfaces (schwab.ts):** `SchwabOptions` gains `sleep?`, `httpRetryDelaysMs?` and `maxRetryAfterMs?`.

**Policy.** Timeouts and network errors keep their own budget: `retryDelaysMs`, default 1 s then 3 s. HTTP 429/5xx on a GET or the DELETE cancel get a separate budget. The two budgets are independent.

- **Worst case per call** is about **110 s**:
  - up to 6 attempts × the 10 s read timeout = 60 s;
  - plus 1 s + 3 s of timeout waits;
  - plus up to 3 × 15 s of HTTP waits.
- **Not retried:** any other 4xx.
- **Submits:** `submitOrder` is untouched. A 429 POST stays `OrderRejectedError` (nothing placed, the run continues). A 5xx POST stays `SubmitOutcomeUnknownError` (looked up, never resent).
- **Alpaca** is unchanged; it never throws `BrokerHttpError`.

- [ ] **Step 1: Write the failing tests.** Append to `lib/broker/http.test.ts` (import also `isTransientRead, BrokerHttpError, parseRetryAfter`):

```ts
describe("parseRetryAfter", () => {
  const NOW = Date.parse("2026-10-07T19:15:00Z");
  it("reads delta-seconds", () => { expect(parseRetryAfter("3", NOW)).toBe(3_000); expect(parseRetryAfter("0", NOW)).toBe(0); });
  it("reads an HTTP-date, never negative", () => {
    expect(parseRetryAfter("Wed, 07 Oct 2026 19:15:04 GMT", NOW)).toBe(4_000);
    expect(parseRetryAfter("Wed, 07 Oct 2026 19:14:00 GMT", NOW)).toBe(0);
  });
  it("is null when absent or unparseable", () => { expect(parseRetryAfter(null, NOW)).toBeNull(); expect(parseRetryAfter("soon", NOW)).toBeNull(); expect(parseRetryAfter(" ", NOW)).toBeNull(); });
});

describe("withReadRetry — HTTP 429/5xx (T-8)", () => {
  const rec = () => { const slept: number[] = []; return { slept, sleep: async (ms: number) => { slept.push(ms); } }; };
  const POLICY = { httpDelaysMs: [2_000, 5_000, 10_000], maxRetryAfterMs: 15_000 };
  it("isTransientRead: 429 and 5xx are transient; other 4xx are not", () => {
    expect(isTransientRead(new BrokerHttpError(429, "x"))).toBe(true);
    expect(isTransientRead(new BrokerHttpError(503, "x"))).toBe(true);
    for (const s of [400, 401, 403, 404]) expect(isTransientRead(new BrokerHttpError(s, "x"))).toBe(false);
  });
  it("retries a 429 on the HTTP schedule, honouring a longer Retry-After, then succeeds", async () => {
    const { slept, sleep } = rec(); let n = 0;
    const v = await withReadRetry(async () => { if (n++ < 2) throw new BrokerHttpError(429, "rl", n === 1 ? 4_000 : null); return "ok"; }, [1, 1], sleep, undefined, POLICY);
    expect(v).toBe("ok");
    expect(slept).toEqual([4_000, 5_000]);
  });
  it("clamps a huge Retry-After to the cap and gives up after the HTTP budget", async () => {
    const { slept, sleep } = rec(); let n = 0;
    await expect(withReadRetry(async () => { n++; throw new BrokerHttpError(429, "rl", 120_000); }, [1, 1], sleep, undefined, POLICY)).rejects.toMatchObject({ name: "BrokerHttpError", status: 429 });
    expect(n).toBe(4); expect(slept).toEqual([15_000, 15_000, 15_000]);
  });
  it("never retries a non-transient 4xx", async () => {
    const { slept, sleep } = rec(); let n = 0;
    await expect(withReadRetry(async () => { n++; throw new BrokerHttpError(400, "bad"); }, [1, 1], sleep)).rejects.toMatchObject({ status: 400 });
    expect(n).toBe(1); expect(slept).toEqual([]);
  });
  it("timeouts and HTTP errors have independent budgets (worst case = both exhausted)", async () => {
    const { slept, sleep } = rec(); let n = 0;
    await expect(withReadRetry(async () => {
      n++;
      throw n % 2 ? new BrokerTimeoutError("read", "u", 1) : new BrokerHttpError(503, "down");
    }, [1_000, 3_000], sleep, undefined, POLICY)).rejects.toThrow();
    expect(n).toBe(6); // 1 + 2 timeout retries + 3 HTTP retries
    expect(slept).toEqual([1_000, 2_000, 3_000, 5_000, 10_000]);
  });
});
```

Append to `lib/broker/schwab.test.ts`:

```ts
describe("SchwabBroker — 429/5xx on reads are retried, never on submit (T-8)", () => {
  const acct = () => json({ securitiesAccount: { currentBalances: { liquidationValue: 100000, cashBalance: 5, buyingPower: 5 }, positions: [] } });
  const mkS = (fetchImpl: typeof fetch, slept: number[]) => new SchwabBroker({ tokenStore: seededStore(), clientId: "cid", clientSecret: "s", accountHash: HASH, fetchImpl, nowMs: () => NOW, sleep: async (ms) => { slept.push(ms); } });

  it("a 429 with Retry-After waits that long and retries, then succeeds", async () => {
    const slept: number[] = []; let n = 0;
    const f = (async () => (n++ === 0 ? new Response("rate limited", { status: 429, headers: { "Retry-After": "3" } }) : acct())) as unknown as typeof fetch;
    expect((await mkS(f, slept).getAccount()).cash).toBe(5);
    expect(n).toBe(2); expect(slept).toEqual([3_000]);
  });
  it("a 429 that never clears gives up after 3 retries, with the same message as before", async () => {
    const slept: number[] = []; let n = 0;
    const f = (async () => { n++; return new Response("rate limited", { status: 429 }); }) as unknown as typeof fetch;
    await expect(mkS(f, slept).getAccount()).rejects.toThrow(/Schwab GET .*accounts.* → 429: rate limited/);
    expect(n).toBe(4); expect(slept).toEqual([2_000, 5_000, 10_000]);
  });
  it("a 503 on pricehistory is retried", async () => {
    const slept: number[] = []; let n = 0;
    const f = (async () => (n++ === 0 ? new Response("", { status: 503 }) : json({ candles: [{ close: 101, datetime: Date.parse("2026-09-25T20:00:00Z") }] }))) as unknown as typeof fetch;
    expect(await mkS(f, slept).getLastClose(["NEE"], "2026-09-25")).toEqual({ NEE: 101 });
    expect(slept).toEqual([2_000]);
  });
  it("a 400 on a read is not retried", async () => {
    const slept: number[] = []; let n = 0;
    const f = (async () => { n++; return new Response("bad", { status: 400 }); }) as unknown as typeof fetch;
    await expect(mkS(f, slept).getAccount()).rejects.toThrow(/→ 400/);
    expect(n).toBe(1); expect(slept).toEqual([]);
  });
  it("a 429 on submit is OrderRejected and POSTed exactly once (no submit retry)", async () => {
    const slept: number[] = []; const posts: string[] = [];
    const f = (async (url: string, init: RequestInit = {}) => { if ((init.method ?? "GET") === "POST") { posts.push(url); return new Response("rate limited", { status: 429, headers: { "Retry-After": "1" } }); } return acct(); }) as unknown as typeof fetch;
    await expect(mkS(f, slept).submitOrder({ symbol: "NEE", side: "sell", qty: 1, limitPrice: 75, timeInForce: "ioc", clientOrderId: "c1", estNotionalUsd: 75 })).rejects.toMatchObject({ name: "OrderRejectedError" });
    expect(posts).toHaveLength(1); expect(slept).toEqual([]);
  });
  it("cancelOrder retries a 429 (a DELETE is idempotent) and tolerates a 404", async () => {
    const slept: number[] = []; const dels: number[] = [];
    const f = (async () => { dels.push(1); return dels.length === 1 ? new Response("", { status: 429 }) : new Response(null, { status: 404 }); }) as unknown as typeof fetch;
    await expect(mkS(f, slept).cancelOrder("1001")).resolves.toBeUndefined();
    expect(dels).toHaveLength(2); expect(slept).toEqual([2_000]);
  });
});
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/broker/http.test.ts lib/broker/schwab.test.ts` → FAIL (missing exports; no `sleep` option; no retry).

- [ ] **Step 3: Implement `lib/broker/http.ts`.** Replace lines 61-84 (`isTransientRead` through the end of `withReadRetry`) with:

```ts
/**
 * A non-2xx answer to an idempotent broker request (a GET, or the DELETE cancel). 429 and 5xx are
 * transient (rate limit, broker hiccup); every other status is definitive. Never thrown for a submit.
 */
export class BrokerHttpError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = "BrokerHttpError";
  }
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Retry-After as delta-seconds or an HTTP-date → ms to wait (never negative); null when absent or unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null;
}

/** Transient read failures worth another try: our deadline, a network-level fetch failure, or an HTTP 429/5xx. */
export function isTransientRead(e: unknown): boolean {
  return (e instanceof BrokerTimeoutError && e.phase === "read") || e instanceof TypeError
    || (e instanceof BrokerHttpError && isTransientHttpStatus(e.status));
}

/**
 * Transient token-refresh failures: our token deadline, or a network-level fetch failure. A refresh-token
 * grant places no order and can be repeated safely; an HTTP answer (400/401 = dead token, 5xx) is not retried.
 */
export function isTransientToken(e: unknown): boolean {
  return (e instanceof BrokerTimeoutError && e.phase === "token") || e instanceof TypeError;
}

/** HTTP-status retries (429/5xx): a budget of their own, independent of the timeout/network budget. */
export interface RetryPolicy { httpDelaysMs?: readonly number[]; maxRetryAfterMs?: number }
export const DEFAULT_HTTP_RETRY = { httpDelaysMs: [2_000, 5_000, 10_000], maxRetryAfterMs: 15_000 } as const;

/**
 * Retry an idempotent read (or, with isTransientToken, a token refresh) on transient failure only. Never wrap
 * a submit in this. Timeouts/network errors use `delaysMs`; an HTTP 429/5xx (BrokerHttpError) uses
 * policy.httpDelaysMs, waiting the server's Retry-After instead when it is longer, capped at maxRetryAfterMs.
 * The budgets are independent: with the defaults a call makes at most 6 attempts (≈110 s worst case at a
 * 10 s read timeout).
 */
export async function withReadRetry<T>(
  fn: () => Promise<T>, delaysMs: readonly number[] = [1_000, 3_000],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  isTransient: (e: unknown) => boolean = isTransientRead, policy: RetryPolicy = {},
): Promise<T> {
  const httpDelays = policy.httpDelaysMs ?? DEFAULT_HTTP_RETRY.httpDelaysMs;
  const maxRetryAfter = policy.maxRetryAfterMs ?? DEFAULT_HTTP_RETRY.maxRetryAfterMs;
  let netTries = 0, httpTries = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e)) throw e;
      if (e instanceof BrokerHttpError) {
        if (httpTries >= httpDelays.length) throw e;
        const base = httpDelays[httpTries++];
        await sleep(e.retryAfterMs != null ? Math.min(Math.max(e.retryAfterMs, base), maxRetryAfter) : base);
      } else {
        if (netTries >= delaysMs.length) throw e;
        await sleep(delaysMs[netTries++]);
      }
    }
  }
}
```

Change the header comment's last sentence to: `Only idempotent reads (and the idempotent DELETE cancel) go through withReadRetry; a 429/5xx on them is retried with bounded, Retry-After-aware backoff.`

- [ ] **Step 4: Implement `lib/broker/schwab.ts`.**

Line 19:
```ts
import { AmbiguousOrderError, BrokerHttpError, BrokerTimeoutError, OrderRejectedError, DEFAULT_TIMEOUTS, SubmitOutcomeUnknownError, fetchWithTimeout, parseRetryAfter, withReadRetry, type RetryPolicy } from "./http";
```

`SchwabOptions`:
```ts
export interface SchwabOptions {
  tokenStore: SchwabTokenStore; clientId: string; clientSecret: string; accountHash: string;
  traderBase?: string; dataBase?: string; fetchImpl?: typeof fetch; nowMs?: () => number;
  timeouts?: { readMs?: number; submitMs?: number }; retryDelaysMs?: readonly number[];
  /** 429/5xx retry schedule for reads and cancels (default DEFAULT_HTTP_RETRY) and the Retry-After cap. Never used for a submit. */
  httpRetryDelaysMs?: readonly number[]; maxRetryAfterMs?: number;
  /** Injected wait for retries (tests record it instead of sleeping). */
  sleep?: (ms: number) => Promise<void>;
}
```

Constructor, after `this.submitMs = …;`:
```ts
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.retryPolicy = { httpDelaysMs: opts.httpRetryDelaysMs, maxRetryAfterMs: opts.maxRetryAfterMs };
```
Field declarations next to `readMs`/`submitMs`:
```ts
  private readonly sleep: (ms: number) => Promise<void>; private readonly retryPolicy: RetryPolicy;
```

`get` (lines 120-125):
```ts
  /** An idempotent GET: bounded, retried on timeout/network failure and on HTTP 429/5xx (Retry-After-aware). */
  private async get<T>(schema: z.ZodType<T>, url: string): Promise<T> {
    const res = await withReadRetry(async () => {
      const r = await fetchWithTimeout(this.fetchImpl, url, { headers: { Authorization: await this.authHeader(), accept: "application/json" } }, this.readMs, "read");
      if (!r.ok) throw new BrokerHttpError(r.status, `Schwab GET ${url} → ${r.status}: ${r.text.slice(0, 300)}`, parseRetryAfter(r.headers.get("retry-after"), this.now()));
      return r;
    }, this.opts.retryDelaysMs, this.sleep, undefined, this.retryPolicy);
    return schema.parse(JSON.parse(res.text));
  }
```

`cancelOrder` (lines 294-297):
```ts
  /** DELETE is idempotent (a repeat finds the order already gone: 404, or a definitive 4xx), so it retries like a read. */
  async cancelOrder(id: string): Promise<void> {
    await withReadRetry(async () => {
      const res = await fetchWithTimeout(this.fetchImpl, `${this.trader}/accounts/${this.opts.accountHash}/orders/${id}`, { method: "DELETE", headers: { Authorization: await this.authHeader() } }, this.readMs, "read");
      if (!res.ok && res.status !== 404) throw new BrokerHttpError(res.status, `Schwab DELETE order ${id} → ${res.status}`, parseRetryAfter(res.headers.get("retry-after"), this.now()));
    }, this.opts.retryDelaysMs, this.sleep, undefined, this.retryPolicy);
  }
```
Do NOT touch `submitOrder` or `findSubmitted`.

- [ ] **Step 5: Verify.** `npx vitest run lib/broker/http.test.ts lib/broker/schwab.test.ts lib/broker/schwab-auth.test.ts lib/broker/alpaca.test.ts lib/broker/guards.test.ts` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add lib/broker/http.ts lib/broker/http.test.ts lib/broker/schwab.ts lib/broker/schwab.test.ts
git commit -m "fix(broker): retry 429/5xx on Schwab reads and cancel with bounded Retry-After backoff (T-8)

Independent timeout and HTTP budgets (about 110 s worst case per call). Submits are never retried.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 3: Lock ownership (D-4) and locked/stale handling (F-10)

**Files:** Modify `lib/trade/breakers.ts:7,123-153` and `lib/trade/cron.ts` (step 3 and the `finally`). Test `lib/trade/breakers.test.ts` and `lib/trade/cron.test.ts`.

**Interfaces:**
- **Produces:**
  - `interface LockHandle { readonly body: string; stillOurs(): boolean; release(): void }`
  - `holdLock(path: string, staleMs?: number): LockHandle | null`
- **Changes:**
  - `acquireLock` writes `${pid} ${iso} ${8 hex}`. Parsing still reads field 1, so old two-field bodies stay compatible.
  - An unparseable body is judged by the file's mtime.
  - Cron releases only its own lock and alerts when it finds the lock held.

- [ ] **Step 1: Write the failing tests.** Append to `lib/trade/breakers.test.ts` (import `holdLock`, and `existsSync, utimesSync` from `node:fs`):

```ts
describe("holdLock — ownership (D-4) and mtime staleness (F-10)", () => {
  const lockPath = () => join(mkdtempSync(join(tmpdir(), "own-")), "cron.lock");
  it("holds, reports ownership, and releases its own lock", () => {
    const p = lockPath(); const h = holdLock(p)!;
    expect(h.stillOurs()).toBe(true);
    h.release();
    expect(existsSync(p)).toBe(false);
  });
  it("never releases a lock someone else now holds (e.g. reclaimed as stale)", () => {
    const p = lockPath(); const h = holdLock(p)!;
    writeFileSync(p, `99999 ${new Date().toISOString()} beef`);
    expect(h.stillOurs()).toBe(false);
    h.release(); h.release();
    expect(readFileSync(p, "utf8")).toMatch(/^99999 /);
  });
  it("two holders in one process get different bodies", () => {
    const p1 = lockPath(), p2 = lockPath();
    expect(holdLock(p1)!.body).not.toBe(holdLock(p2)!.body);
  });
  it("an unparseable lock body is judged by its mtime: fresh → held, older than the threshold → reclaimed", () => {
    const p = lockPath();
    writeFileSync(p, "garbage");
    expect(holdLock(p)).toBeNull();
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    utimesSync(p, old, old);
    expect(holdLock(p)).not.toBeNull();
  });
});
```

Append to `lib/trade/cron.test.ts` inside `describe("runCron")`:

```ts
  it("F-10: a held lock is alerted (the slot is skipped) and left untouched", async () => {
    const paths = mkPaths(); const notified: string[] = [];
    writeFileSync(paths.lock, `12345 ${new Date().toISOString()}`);
    expect(await runCron(mkDeps({ paths, notify: (m) => notified.push(m) }))).toEqual({ status: "locked" });
    expect(notified).toEqual([expect.stringMatching(/holds the run lock \(12345 /)]);
  });

  it("D-4: cron never deletes a lock that is no longer its own", async () => {
    const paths = mkPaths();
    const foreign = `77777 ${new Date().toISOString()} feed`;
    const r = await runCron(mkDeps({ paths, loadInputs: async () => { writeFileSync(paths.lock, foreign); return { reports: [], sics: {}, marketCapUsd: {}, fills: [] }; } }));
    expect(r.status).toBe("noop");
    expect(readFileSync(paths.lock, "utf8")).toBe(foreign);
  });
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/breakers.test.ts lib/trade/cron.test.ts` → FAIL.

- [ ] **Step 3: Implement in `lib/trade/breakers.ts`.** Add `statSync` to the `node:fs` import and `import { randomBytes } from "node:crypto";`. In `acquireLock`, write the body with a token (both `writeFileSync(path, …, { flag: "wx" })` calls):

```ts
const lockBody = () => `${process.pid} ${new Date().toISOString()} ${randomBytes(4).toString("hex")}`;
```
(use `lockBody()` in both places), and replace the staleness check:

```ts
    let lockMs = Date.parse(existing.split(" ")[1] ?? "");
    // An unparseable body (garbage, a torn write) is judged by the file's age instead of being held forever.
    if (!Number.isFinite(lockMs)) { try { lockMs = statSync(path).mtimeMs; } catch { return false; } }
    if (Date.now() - lockMs <= staleMs) return false;
```

Append:

```ts
export interface LockHandle { readonly body: string; stillOurs(): boolean; release(): void }

/**
 * acquireLock plus ownership: remembers the exact body it wrote, so `release` removes the lock only while it is
 * still ours (a run that outlived staleMs may have had it reclaimed), and `stillOurs` lets a long manual run
 * re-check before it submits. null = held by someone else.
 */
export function holdLock(path: string, staleMs: number = DEFAULT_LOCK_STALE_MS): LockHandle | null {
  if (!acquireLock(path, staleMs)) return null;
  let body = "";
  try { body = readFileSync(path, "utf8"); } catch { /* vanished: never ours to release */ }
  const stillOurs = () => { try { return body !== "" && readFileSync(path, "utf8") === body; } catch { return false; } };
  return { body, stillOurs, release: () => { if (stillOurs()) { try { rmSync(path); } catch { /* already gone */ } } } };
}
```

- [ ] **Step 4: Implement in `lib/trade/cron.ts`.**
  - Import `holdLock` in place of `acquireLock, releaseLock`, and add `readFileSync` to the `node:fs` import.
  - Replace step 3 with:

```ts
  const lockAlreadyPresent = existsSync(paths.lock);
  const lock = holdLock(paths.lock, DEFAULT_LOCK_STALE_MS);
  if (!lock) {
    let holder = "";
    try { holder = readFileSync(paths.lock, "utf8").trim(); } catch { /* released meanwhile */ }
    notify(`cron: skipped — another trade run holds the run lock (${holder || "holder unknown"}). Nothing was sent this slot; a manual trade:execute holds it until it exits.`);
    appendLog(paths.log, logLine(today, runId, "locked"));
    return { status: "locked" };
  }
```
  - Change `finally { releaseLock(paths.lock); }` to `finally { lock.release(); }`.

- [ ] **Step 5: Verify.** `npx vitest run lib/trade/breakers.test.ts lib/trade/cron.test.ts` → PASS (existing lock tests unchanged: fresh lock → `locked`, untouched; stale reclaimed then released; worker race). `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add lib/trade/breakers.ts lib/trade/breakers.test.ts lib/trade/cron.ts lib/trade/cron.test.ts
git commit -m "fix(trade): cron releases only its own run lock; alert when the lock is held; mtime staleness for a garbled lock (D-4, F-10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 4: T-2 + F-1/F-2/F-6/F-7 — bounded polls; stop the run when an order is lost or a guard refuses

**Files:**
- Modify `lib/trade/pipeline.ts`:
  - `:9` (import `GuardError`);
  - `:386-406` (`ExecutedOrder`, `SubmitAbort`);
  - `:427-446` (options);
  - `:482-533` (submit catch and post-submit block);
  - `:538-548` (`mergeExecution`).
- Modify `lib/trade/cron.ts`: the `aborted` branch, `abortAlert`, and `pollMs` in `CronDeps`.
- Modify `scripts/trade-execute.ts`: the abort message.
- Test `lib/trade/pipeline.test.ts` and `lib/trade/cron.test.ts`.

**Interfaces (produced):**
- `type AbortReason = "submit-unknown" | "poll-unavailable" | "guard"`
- `interface SubmitAbort { reason: AbortReason; ticker: string; clientOrderId: string; detail: string }`
- `ExecutedOrder` gains `pollErrors?: number`, `cancelError?: string` and `cancelNote?: string`.
- `executeOrders` options gain `pollErrorLimit?: number` (default 3) and `pollBudgetMs?: number` (default 60 000).
- `abortAlert(a: SubmitAbort, source: string): string`, exported from `cron.ts`.
- `CronDeps.pollMs?: number`

**Behaviour:**
- **One poll.** A failed `getOrders` read counts as "status unknown". The last known state is kept.
- **Bounded loops (F-2).** Each poll loop (the window, then the settle after the cancel) stops early after 3 consecutive failed reads or 60 s of wall clock on `now`. The cancel is always attempted when the window ends non-terminal.
- **Lost order (F-1).** If the order is still not known terminal and any read failed, `executeOrders` stops and returns `aborted: { reason: "poll-unavailable" }`. Cron then writes the record, tries the audit, bumps the counter and alerts. It does not use the "UNKNOWN submit outcome" wording. If the order was eventually seen terminal, the run continues.
- **Cancel reply errors (F-6).** A cancel that errored but whose order then went terminal is kept as `cancelNote: "cancel reply error; order terminal — …"`, not `cancelError`.
- **Guard refusals (F-7).** A non-cash `GuardError` mid-run (the kill switch, a lock, the ban, a run cap) stops the run like `aborted` (`reason: "guard"`). Nothing was placed for that order. Cron records the run, audits and halts. It bumps only if an earlier order already reached the broker (F-4).
- **Escapes.** Anything else that escapes after a submit first cancels the order (best effort) if it is not terminal, then re-throws.
- **Cash backstop.** The lines are unchanged.
- **Worst case per order.** About 60 s for the window, plus one in-flight poll (≤ about 110 s), the cancel (≤ about 110 s), about 60 s for the settle and one more in-flight poll: about 7.5 min absolute worst for the single order that triggers it. F-1 then stops the run, and the 15:50 cutoff still bounds every submit.

- [ ] **Step 1: Write the failing tests.** Append to `lib/trade/pipeline.test.ts`:

```ts
describe("executeOrders — bounded polls, lost orders, guard aborts (T-2, F-1, F-2, F-6, F-7)", () => {
  const D = "2026-09-25";
  const mk = (o: Partial<OrderRequest> & Pick<OrderRequest, "ticker" | "side" | "qty" | "limitPrice">): OrderRequest => ({
    sector: "0", kind: "qty", type: "limit", timeInForce: "ioc", tier: 1, capBound: false, anchorReason: "ok",
    clientOrderId: `c-${o.ticker}-${o.side}`, reason: "ENTER", deltaUsd: o.qty * o.limitPrice, estCostUsd: 0, bucket: "large", ...o,
  });
  const ctxFor = (over: Partial<GuardContext> = {}): GuardContext => ({ brokerKind: "fake", configuredBaseUrl: "memory://", locks: { buyLockUntil: {}, sellLockUntil: {} }, today: D, nav: 100_000, cashUsd: 50_000, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 }, ...over });
  const sized = (orders: OrderRequest[]): SizedOrders => ({ orders, skippedDust: [], skippedHalt: [] });
  const fillsPath = () => join(mkdtempSync(join(tmpdir(), "poll-")), "fills.jsonl");
  const two = () => sized([mk({ ticker: "AAA", side: "buy", qty: 10, limitPrice: 100.5 }), mk({ ticker: "BBB", side: "buy", qty: 10, limitPrice: 100.5 })]);

  /** Schwab-like: orders rest until cancelled. The first `pollFailures` getOrders calls throw (Infinity = always). */
  class FlakyPollBroker extends FakeBroker {
    cancels: string[] = []; submits: string[] = []; polls = 0;
    private resting = new Map<string, BrokerOrder>();
    constructor(private readonly o: { pollFailures: number; cancelFails?: boolean; cancelThenThrow?: boolean; partialOnCancel?: number; workingPartial?: boolean }) {
      super({ calendar: CAL, closes: { AAA: { [D]: 100 }, BBB: { [D]: 100 } }, equity: 50_000, cash: 50_000, isOpen: true, today: D });
    }
    async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
      this.submits.push(req.symbol);
      const base: BrokerOrder = { id: `r-${this.resting.size + 1}`, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "new", qty: req.qty ?? null, notional: null, filledQty: 0, filledAvgPrice: null, filledAt: null, submittedAt: `${D}T19:15:00Z` };
      const o = this.o.workingPartial ? { ...base, status: "partially_filled" as const, filledQty: 3, filledAvgPrice: 100, filledAt: `${D}T19:15:01Z` } : base;
      this.resting.set(o.id, o);
      return o;
    }
    async getOrders(): Promise<BrokerOrder[]> {
      this.polls++;
      if (this.o.pollFailures-- > 0) throw new Error("Schwab GET …/orders → 429: rate limited");
      return [...this.resting.values()];
    }
    async cancelOrder(id: string): Promise<void> {
      this.cancels.push(id);
      if (this.o.cancelFails) throw new Error("Schwab DELETE order → 503");
      const o = this.resting.get(id)!; const q = this.o.partialOnCancel ?? 0;
      this.resting.set(id, { ...o, status: "canceled", filledQty: q, filledAvgPrice: q ? 100 : null, filledAt: q ? `${D}T19:15:09Z` : null });
      if (this.o.cancelThenThrow) throw new Error("Schwab DELETE order → 502 (reply lost)");
    }
  }

  it("transient poll errors, then the order is seen terminal: partial fill recorded, the run carries on", async () => {
    const b = new FlakyPollBroker({ pollFailures: 3, partialOnCancel: 3 });
    const r = await executeOrders({ adapter: b, sized: two(), ctx: ctxFor(), runId: "r", fillsPath: fillsPath(), pollMs: 0, iocPolls: 2 });
    expect(r.aborted).toBeUndefined();
    expect(b.submits).toEqual(["AAA", "BBB"]);
    expect(r.executed[0]).toMatchObject({ status: "canceled", filledQty: 3, pollErrors: 3 });
    expect(r.fills.map((f) => [f.ticker, f.qty])).toEqual([["AAA", 3], ["BBB", 3]]);
  });

  it("F-1/F-2: every read fails → each loop stops after 3 errors, the cancel is still sent, and the run STOPS (poll-unavailable) keeping the full buy reservation", async () => {
    const b = new FlakyPollBroker({ pollFailures: Infinity });
    const ctx = ctxFor();
    const r = await executeOrders({ adapter: b, sized: two(), ctx, runId: "r", fillsPath: fillsPath(), pollMs: 0 }); // default iocPolls 8
    expect(b.polls).toBe(6);                 // 3 in the window, 3 in the settle loop — not 8 + 30
    expect(b.cancels).toEqual(["r-1"]);
    expect(b.submits).toEqual(["AAA"]);      // BBB never sent
    expect(r.aborted).toMatchObject({ reason: "poll-unavailable", ticker: "AAA" });
    expect(r.aborted!.detail).not.toMatch(/unknown outcome/i);
    expect(r.executed[0]).toMatchObject({ status: "new", terminalAt: null, pollErrors: 6 });
    expect(ctx.counters.buyNotionalUsd).toBeCloseTo(1_005, 6);
  });

  it("F-1: reads and cancel both fail → poll-unavailable, with the cancel failure kept on the order", async () => {
    const b = new FlakyPollBroker({ pollFailures: Infinity, cancelFails: true });
    const r = await executeOrders({ adapter: b, sized: two(), ctx: ctxFor(), runId: "r", fillsPath: fillsPath(), pollMs: 0 });
    expect(r.aborted).toMatchObject({ reason: "poll-unavailable" });
    expect(r.aborted!.detail).toMatch(/cancel failed: .*503/);
    expect(r.executed[0].cancelError).toMatch(/503/);
  });

  it("F-2: the wall-clock budget ends the window early (on the injected clock)", async () => {
    const b = new FlakyPollBroker({ pollFailures: 0 });
    let t = Date.parse(`${D}T19:15:00Z`);
    const r = await executeOrders({ adapter: b, sized: sized([mk({ ticker: "AAA", side: "buy", qty: 10, limitPrice: 100.5 })]), ctx: ctxFor(), runId: "r", fillsPath: fillsPath(), pollMs: 0, now: () => (t += 25_000) });
    expect(b.polls).toBe(3); // 2 window polls inside 60 s at 25 s a tick, then 1 settle poll that sees it canceled
    expect(b.cancels).toEqual(["r-1"]);
    expect(r.executed[0]).toMatchObject({ status: "canceled" });
  });

  it("F-6: a cancel whose reply errored but whose order then settled is a note, not a cancel failure", async () => {
    const b = new FlakyPollBroker({ pollFailures: 0, cancelThenThrow: true });
    const r = await executeOrders({ adapter: b, sized: sized([mk({ ticker: "AAA", side: "buy", qty: 10, limitPrice: 100.5 })]), ctx: ctxFor(), runId: "r", fillsPath: fillsPath(), pollMs: 0, iocPolls: 1 });
    expect(r.aborted).toBeUndefined();
    expect(r.executed[0].cancelError).toBeUndefined();
    expect(r.executed[0].cancelNote).toMatch(/^cancel reply error; order terminal — .*502/);
  });

  it("an error escaping after submit (fill not recordable) cancels the still-working order before re-throwing", async () => {
    const b = new FlakyPollBroker({ pollFailures: 0, cancelFails: true, workingPartial: true });
    const badFills = join(mkdtempSync(join(tmpdir(), "poll-")), "no-such-dir", "fills.jsonl");
    await expect(executeOrders({ adapter: b, sized: sized([mk({ ticker: "AAA", side: "buy", qty: 10, limitPrice: 100.5 })]), ctx: ctxFor(), runId: "r", fillsPath: badFills, pollMs: 0, iocPolls: 1 })).rejects.toThrow(/ENOENT/);
    expect(b.cancels).toEqual(["r-1", "r-1"]); // the loop's cancel, then the escape's best-effort cancel
  });

  it("F-7: a guard refusal mid-run stops the run (reason guard) with partial results — nothing placed for that order", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { AAA: { [D]: 100 }, BBB: { [D]: 100 } }, equity: 50_000, cash: 50_000, isOpen: true, today: D });
    const ctx = ctxFor({ cfg: { ...cfg, maxOrdersPerRun: 1 } });
    const r = await executeOrders({ adapter: b, sized: two(), ctx, runId: "r", fillsPath: fillsPath(), pollMs: 0 });
    expect(r.aborted).toMatchObject({ reason: "guard", ticker: "BBB", detail: expect.stringMatching(/maxOrdersPerRun/) });
    expect(r.executed.map((e) => e.clientOrderId)).toEqual(["c-AAA-buy"]);
    expect(b.submitCount).toBe(1);
  });

  it("F-7: a cash-backstop refusal is still a skip, not an abort", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { AAA: { [D]: 100 } }, equity: 50_000, cash: 50_000, isOpen: true, today: D });
    const r = await executeOrders({ adapter: b, sized: sized([mk({ ticker: "AAA", side: "buy", qty: 10, limitPrice: 100.5 })]), ctx: ctxFor({ cashUsd: 0 }), runId: "r", fillsPath: fillsPath(), pollMs: 0 });
    expect(r.aborted).toBeUndefined();
    expect(r.skippedCash).toHaveLength(1);
  });

  it("mergeExecution carries pollErrors / cancelError / cancelNote only when present", () => {
    const [a, c] = mergeExecution([{ clientOrderId: "a" }, { clientOrderId: "c" }], [
      { clientOrderId: "a", brokerId: "1", status: "filled", filledQty: 1, filledAvgPrice: 1, submittedAt: null },
      { clientOrderId: "c", brokerId: "2", status: "new", filledQty: 0, filledAvgPrice: null, submittedAt: null, pollErrors: 4, cancelError: "503", cancelNote: "n" },
    ]) as Record<string, unknown>[];
    expect(a).not.toHaveProperty("pollErrors"); expect(a).not.toHaveProperty("cancelNote");
    expect(c).toMatchObject({ pollErrors: 4, cancelError: "503", cancelNote: "n" });
  });
});
```

In `lib/trade/cron.test.ts`, add `import type { BrokerOrder, SubmitOrderRequest } from "../broker/adapter";`. Replace the existing "guard-level kill switch" test body's assertion

```ts
    await expect(runCron(mkDeps({ … }))).rejects.toThrow(/TRADE_DISABLED/);
```
with
```ts
    const notified: string[] = [];
    expect(await runCron(mkDeps({
      paths, adapter, disabled: false, env: { TRADE_DISABLED: "1" } as unknown as NodeJS.ProcessEnv, notify: (m) => notified.push(m),
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }),
    }))).toEqual({ status: "halted", reason: "guard" });
    expect(notified.some((m) => /guard refused NVT.*TRADE_DISABLED/.test(m))).toBe(true);
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 }); // nothing reached the broker → alert-only (F-4)
```
(keep its three existing `expect`s on fills, broker orders and the released lock), and append inside `describe("runCron")`:

```ts
  it("F-1: an order the run lost track of halts (poll-unavailable): record written, counter bumped, no 'UNKNOWN outcome' wording", async () => {
    class LostBroker extends FakeBroker {
      private placed: BrokerOrder[] = [];
      async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
        this.submitCount++;
        const o: BrokerOrder = { id: `l-${this.placed.length + 1}`, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "new", qty: req.qty ?? null, notional: null, filledQty: 0, filledAvgPrice: null, filledAt: null, submittedAt: `${TODAY}T19:15:00Z` };
        this.placed.push(o); return o;
      }
      async getOrders(): Promise<BrokerOrder[]> { if (this.submitCount > 0) throw new Error("Schwab GET …/orders → 503"); return [...this.placed]; }
      async cancelOrder(): Promise<void> { /* accepted; we never see the outcome */ }
    }
    const paths = mkPaths(); const notified: string[] = [];
    const adapter = new LostBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: TODAY });
    const r = await runCron(mkDeps({ paths, adapter, pollMs: 0, notify: (m) => notified.push(m), loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }) }));
    expect(r).toEqual({ status: "halted", reason: "poll-unavailable" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(notified.some((m) => /lost track of the NVT order/.test(m))).toBe(true);
    expect(notified.some((m) => /UNKNOWN outcome/.test(m))).toBe(false);
    expect(readdirSync(paths.runs)).toHaveLength(1);
    expect(existsSync(paths.lock)).toBe(false);
  });
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/pipeline.test.ts lib/trade/cron.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/trade/pipeline.ts`.**

Line 9: `import { CashBackstopError, GuardError, guardedSubmit, type GuardContext } from "../broker/guards";`

`ExecutedOrder` — add:
```ts
  /** Fill polls whose order-list read failed (each treated as "status unknown, keep the last state"). Absent = none. */
  pollErrors?: number;
  /** The cancel of a still-working order failed AND the order was never seen terminal afterwards. */
  cancelError?: string;
  /** The cancel call errored but the order then settled — informational only (F-6). */
  cancelNote?: string;
```

Replace `SubmitAbort`:
```ts
/** Why a run stopped submitting: an unknown submit outcome, an order the run lost track of, or a guard refusal mid-run. */
export type AbortReason = "submit-unknown" | "poll-unavailable" | "guard";
export interface SubmitAbort { reason: AbortReason; ticker: string; clientOrderId: string; detail: string }
```

Options — add after `iocPolls?: number; marketPolls?: number;`:
```ts
  /** Each poll loop (window, then settle after the cancel) stops after this many failed reads in a row (default 3)… */
  pollErrorLimit?: number;
  /** …or after this much wall clock on `now` (default 60 s). The cancel is always attempted after the window. */
  pollBudgetMs?: number;
```
and destructure `pollErrorLimit = 3, pollBudgetMs = 60_000`.

In the submit `catch`, after the `OrderRejectedError` branch and before `if (!(e instanceof SubmitOutcomeUnknownError)) throw e;`:
```ts
      // Any other guard refusal mid-run (kill switch, a lock, the ban, a run cap): nothing was placed for this order.
      // Stop like an unknown submit, so the caller records the run, audits what did go out, and halts (F-7).
      if (e instanceof GuardError) return { fills, executed, skippedCash, rejected, skippedLegs, skippedCutoff, aborted: { reason: "guard", ticker: o.ticker, clientOrderId: o.clientOrderId, detail: e.message } };
```
(`CashBackstopError extends GuardError`, so its branch must stay first.) In the unknown-submit return add `reason: "submit-unknown"` to `aborted`.

Replace the post-submit block (from `const submitAckAt` through `if (o.leg === "whole") wholeFilled.set(…)`) with:

```ts
    const submitAckAt = new Date(now()).toISOString();
    let pollErrors = 0;
    let cancelError: string | undefined;
    /** One fill poll; false when the order-list read failed (status unknown — the last known state is kept). */
    const poll = async (): Promise<boolean> => {
      await sleep(pollMs);
      const id = order.id;
      try {
        order = (await adapter.getOrders("all", pollAfter)).find((x) => x.id === id || x.clientOrderId === o.clientOrderId) ?? order;
        return true;
      } catch {
        pollErrors++;
        return false;
      }
    };
    /** Poll up to n times until terminal; stop early after pollErrorLimit failed reads in a row or pollBudgetMs of wall clock. */
    const pollUntilTerminal = async (n: number) => {
      const deadline = now() + pollBudgetMs;
      let streak = 0;
      for (let k = 0; k < n && !TERMINAL_STATUSES.has(order.status) && streak < pollErrorLimit && now() < deadline; k++) {
        streak = (await poll()) ? 0 : streak + 1;
      }
    };
    try {
      await pollUntilTerminal(o.type === "limit" && o.timeInForce === "ioc" ? iocPolls : marketPolls);
      if (!TERMINAL_STATUSES.has(order.status)) {
        // Emulated IOC / stuck market order: cancel whatever is still working — always, even when reads are failing —
        // then wait for the broker to settle it (a partial fill before the cancel is kept and recorded).
        try { await adapter.cancelOrder(order.id); } catch (e) { cancelError = e instanceof Error ? e.message : String(e); }
        await pollUntilTerminal(30);
      }
      const terminal = TERMINAL_STATUSES.has(order.status);
      const cancelFields = cancelError ? (terminal ? { cancelNote: `cancel reply error; order terminal — ${cancelError}` } : { cancelError }) : {};
      executed.push({ clientOrderId: o.clientOrderId, brokerId: order.id, status: order.status, filledQty: order.filledQty, filledAvgPrice: order.filledAvgPrice, submittedAt: order.submittedAt, submitStartAt, submitAckAt,
        terminalAt: terminal ? new Date(now()).toISOString() : null, ...(pollErrors ? { pollErrors } : {}), ...cancelFields });
      // True up the cash backstop: a buy reserved qty × limit at submit; it actually spent filledQty × avg
      // (an IOC that didn't fill releases its reservation). A sell raises cash only for what filled. A
      // working order that never went terminal keeps its full reservation (conservative).
      const spent = order.filledQty * (order.filledAvgPrice ?? 0);
      if (o.side === "buy" && terminal) ctx.counters.buyNotionalUsd += spent - Math.abs(req.estNotionalUsd);
      if (o.side === "sell") ctx.counters.sellProceedsUsd += spent;
      if (order.filledQty > 0 && order.filledAvgPrice != null && order.filledAt) {
        const fill: Fill = { ticker: o.ticker, side: o.side, qty: order.filledQty, price: order.filledAvgPrice, filledAt: order.filledAt, tradingDate: fillTradingDate(order.filledAt), orderId: order.id, runId };
        appendFill(fillsPath, fill);
        fills.push(fill);
      }
      if (o.leg === "whole") wholeFilled.set(`${o.side}|${o.ticker}`, order.filledQty);
      // F-1: not known to be finished, and the broker's order list could not be read — it may still be working or
      // have filled. Stop sending; the caller records the run, audits and halts.
      if (!terminal && pollErrors > 0) {
        return { fills, executed, skippedCash, rejected, skippedLegs, skippedCutoff, aborted: { reason: "poll-unavailable", ticker: o.ticker, clientOrderId: o.clientOrderId,
          detail: `order ${order.id} last seen ${order.status}; ${pollErrors} order-list read(s) failed${cancelError ? `; cancel failed: ${cancelError}` : ""}` } };
      }
    } catch (e) {
      // Nothing above should throw now (poll and cancel failures are caught); if anything does — a disk error
      // recording a fill, a bug — never leave this order working at the broker: cancel it, best effort, then re-throw.
      if (!TERMINAL_STATUSES.has(order.status)) { try { await adapter.cancelOrder(order.id); } catch { /* best effort */ } }
      throw e;
    }
```

`mergeExecution` — add after `terminalAt: …`:
```ts
      ...(e.pollErrors ? { pollErrors: e.pollErrors } : {}), ...(e.cancelError ? { cancelError: e.cancelError } : {}), ...(e.cancelNote ? { cancelNote: e.cancelNote } : {}),
```

- [ ] **Step 4: Implement `lib/trade/cron.ts`.**
  - Add to `CronDeps`: `pollMs?: number;` (doc: "Fill-poll interval for executeOrders (tests pass 0); unset → 1 s").
  - Pass `pollMs: deps.pollMs` into `executeOrders`.
  - Import `type SubmitAbort` from `./pipeline`, then add:

```ts
/** The halt alert for a run that stopped submitting (executeOrders' `aborted`). Shared with trade:execute. */
export function abortAlert(a: SubmitAbort, source: string): string {
  switch (a.reason) {
    case "submit-unknown":
      return `${source} halted: order submit for ${a.ticker} has an UNKNOWN outcome (${a.detail}). Check the broker's order history; if it executed, run \`npm run trade:reconcile -- --record-missing\`, then clear the halt state to resume.`;
    case "poll-unavailable":
      return `${source} halted: lost track of the ${a.ticker} order — the broker's order list could not be read (${a.detail}). It may still be working or may have filled. Remaining orders were NOT sent. Check the broker's order history; if it executed, run \`npm run trade:reconcile -- --record-missing\`, then clear the halt state to resume.`;
    case "guard":
      return `${source} halted: a guard refused ${a.ticker} mid-run (${a.detail}). Nothing was placed for it; remaining orders were NOT sent.`;
  }
}
```

Replace the `if (aborted) { … }` block:
```ts
    if (aborted) {
      // Phase-based (F-4): count it only if something may have reached the broker. A guard refusal of the very first
      // order sent nothing; an unknown submit or a lost order always may have.
      if (aborted.reason !== "guard" || ctx.counters.orders > 0) bumpHalt(paths.haltState);
      notify(abortAlert(aborted, "cron"));
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: aborted.reason }));
      return { status: "halted", reason: aborted.reason };
    }
```
(The existing submit-unknown test keeps passing: same reason, same wording.)

- [ ] **Step 5: `scripts/trade-execute.ts`.** Replace the body of `if (aborted) { … }` with:
```ts
  const msg = abortAlert(aborted, "trade:execute");
  notifier.message(msg); await notifier.flush(); console.error(msg); process.exit(1);
```
and import `abortAlert` from `../lib/trade/cron`.

- [ ] **Step 6: Verify.** `npx vitest run lib/trade/pipeline.test.ts lib/trade/cron.test.ts lib/trade/e2e.test.ts lib/trade/phase2-e2e.test.ts lib/broker/guards.test.ts` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit**

```bash
git add lib/trade/pipeline.ts lib/trade/pipeline.test.ts lib/trade/cron.ts lib/trade/cron.test.ts scripts/trade-execute.ts
git commit -m "fix(trade): bounded fill polls; stop the run when an order is lost or a guard refuses mid-run (T-2, F-1, F-2, F-6, F-7)

Poll read failures no longer escape; each poll loop stops after 3 failed reads or 60 s; the cancel
is always sent; a non-terminal order with failed reads aborts as poll-unavailable; a guard refusal
mid-run aborts as guard. Cash backstop unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 5: T-8 (part 2) + F-1 + F-4 — after submits, cron never ends "executed" on doubt, and counts post-submit errors

**Files:** Modify `lib/trade/cron.ts` (`runCron` step 8 through the end, plus a new `catch`) and `scripts/trade-execute.ts` (audit tail). Test `lib/trade/cron.test.ts`.

**New halt reasons:** `audit-unavailable`, `order-working`, `execute-error`.

**Order of checks after `executeOrders`:**
1. Write the run record.
2. Try the audit read.
3. `aborted` (Task 4).
4. Audit unavailable.
5. Audit critical.
6. Any order still working.
7. Otherwise clean: `clearHalt` and `executed`.

**Phase-based counting (F-4):**
- A throw after `ctx.counters.orders > 0` is caught inside `runCron`. It returns `halted (execute-error)`, bumps the counter and alerts.
- A throw before any order went out is re-thrown, as today. Task 6 makes that path alert-only.

- [ ] **Step 1: Write the failing tests.** Append to `lib/trade/cron.test.ts` inside `describe("runCron")`:

```ts
  it("T-8: the broker-truth read fails after execution → halted (audit-unavailable), counter bumped, alert names the run, fills + record kept", async () => {
    const paths = mkPaths(); const adapter = mkBroker();
    const orig = adapter.getOrders.bind(adapter);
    adapter.getOrders = (async (status: "open" | "closed" | "all", after?: string) => {
      if (adapter.submitCount > 0) throw new Error("Schwab GET …/orders → 429: rate limited");
      return orig(status, after);
    }) as typeof adapter.getOrders;
    const notified: string[] = [];
    const r = await runCron(mkDeps({ paths, adapter, notify: (m) => notified.push(m), loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }) }));
    expect(r).toEqual({ status: "halted", reason: "audit-unavailable" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(readFills(paths.fills).length).toBeGreaterThan(0);
    expect(readdirSync(paths.runs)).toHaveLength(1);
    expect(notified.some((m) => /broker-truth check could not read/.test(m) && /trade:audit -- --run r-cron-1/.test(m))).toBe(true);
    expect(existsSync(paths.lock)).toBe(false);
  });

  it("F-1: an order still working after a failed cancel (reads fine) halts (order-working) — never 'executed', never clearHalt", async () => {
    class StuckBroker extends FakeBroker {
      private stuck: BrokerOrder[] = [];
      async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
        this.submitCount++;
        const o: BrokerOrder = { id: `s-${this.stuck.length + 1}`, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "new", qty: req.qty ?? null, notional: null, filledQty: 0, filledAvgPrice: null, filledAt: null, submittedAt: `${TODAY}T19:15:00Z` };
        this.stuck.push(o); return o;
      }
      async getOrders(): Promise<BrokerOrder[]> { return [...this.stuck]; }
      async cancelOrder(): Promise<void> { throw new Error("Schwab DELETE order → 503"); }
    }
    const paths = mkPaths(); bumpHalt(paths.haltState); // a prior halt must NOT be cleared by this run
    const adapter = new StuckBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: TODAY });
    const notified: string[] = [];
    const r = await runCron(mkDeps({ paths, adapter, pollMs: 0, notify: (m) => notified.push(m), loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }) }));
    expect(r).toEqual({ status: "halted", reason: "order-working" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 2 });
    expect(notified.some((m) => /still working at the broker/.test(m) && /NVT/.test(m))).toBe(true);
    const [rec] = readdirSync(paths.runs);
    expect(readFileSync(join(paths.runs, rec), "utf8")).toMatch(/"cancelError": "Schwab DELETE order → 503"/);
  });

  it("F-4: an error after an order reached the broker is caught: halted (execute-error), counter bumped, alerted, lock released", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cron-"));
    const paths = { ...mkPaths(), fills: join(dir, "no-such-dir", "fills.jsonl") }; // appendFill fails AFTER the fill
    const notified: string[] = [];
    const r = await runCron(mkDeps({ paths, notify: (m) => notified.push(m), loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }) }));
    expect(r).toEqual({ status: "halted", reason: "execute-error" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(notified.some((m) => /error after orders were sent/.test(m) && /ENOENT/.test(m))).toBe(true);
    expect(existsSync(paths.lock)).toBe(false);
  });

  it("F-4: an error before any order went out is re-thrown and does not touch the counter", async () => {
    const paths = mkPaths();
    await expect(runCron(mkDeps({ paths, loadInputs: async () => { throw new Error("disk gone"); } }))).rejects.toThrow(/disk gone/);
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 });
    expect(existsSync(paths.lock)).toBe(false);
  });
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/cron.test.ts` → FAIL.

- [ ] **Step 3: Implement in `lib/trade/cron.ts`.**
  - Add `import { TERMINAL_STATUSES, type BrokerOrderStatus } from "../broker/adapter";`.
  - Just after the lock is held (before the existing `try {`), declare `let ordersSent = (): boolean => false;`.
  - Right after `const ctx: GuardContext = { … };` add `ordersSent = () => ctx.counters.orders > 0;`.

Replace step 9 (from `const brokerIdByCid` through the final `return { status: "executed", … }`) with:

```ts
    const brokerIdByCid = new Map(executed.filter((e) => e.status !== "rejected").map((e) => [e.clientOrderId, e.brokerId || undefined])); // a rejected order never reached the book
    let audit: ReturnType<typeof crossCheckBroker> | null = null;
    let auditReadError = "";
    try {
      audit = crossCheckBroker({
        expected: out.sized.orders.filter((o) => brokerIdByCid.has(o.clientOrderId)).map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side, brokerId: brokerIdByCid.get(o.clientOrderId) })),
        brokerOrders: await adapter.getOrders("all", `${today}T00:00:00Z`),
        fills,
      });
    } catch (e) {
      auditReadError = e instanceof Error ? e.message : String(e);
    }
    // 9b. The run stopped submitting (Task 4). Unchanged precedence: first.
    if (aborted) {
      if (aborted.reason !== "guard" || ctx.counters.orders > 0) bumpHalt(paths.haltState);
      notify(abortAlert(aborted, "cron"));
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: aborted.reason }));
      return { status: "halted", reason: aborted.reason };
    }
    // 9c. The broker's orders could not be read (after retries): this run's fills are unverified. Fills and the run
    // record are already written; halt so a human runs the audit before the next slot trades on them.
    if (!audit) {
      bumpHalt(paths.haltState);
      notify(`cron halted: the broker-truth check could not read the broker's orders (${auditReadError}). ${fills.length} fill(s) were recorded and the run record is written. Run \`npm run trade:audit -- --run ${runId}\` once the broker answers; if it is clean, clear the halt state.`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "audit-unavailable" }));
      return { status: "halted", reason: "audit-unavailable" };
    }
    if (!audit.ok) {
      bumpHalt(paths.haltState);
      notify(`cron halted: broker-truth check found ${audit.critical} critical discrepancy(ies) — ${audit.discrepancies.filter((d) => d.severity === "critical").map((d) => `${d.code} ${d.ticker}`).join(", ")}`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "broker-mismatch" }));
      return { status: "halted", reason: "broker-mismatch" };
    }
    // 9d. An order still working after its cancel (the audit passes a working order with 0 filled) is not a clean
    // run: never clear the halt counter over it.
    const working = executed.filter((e) => e.brokerId && !TERMINAL_STATUSES.has(e.status as BrokerOrderStatus));
    if (working.length) {
      bumpHalt(paths.haltState);
      notify(`cron halted: ${working.length} order(s) still working at the broker after the cancel attempt — ${working.map((e) => `${out.sized.orders.find((x) => x.clientOrderId === e.clientOrderId)?.ticker ?? "?"} ${e.brokerId} (${e.status}${e.cancelError ? `; cancel failed: ${e.cancelError}` : ""})`).join(", ")}. Check the broker; a DAY order expires at the close, and the next run's reconcile halts until it is terminal and recorded.`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "order-working" }));
      return { status: "halted", reason: "order-working" };
    }
    clearHalt(paths.haltState);
    appendLog(paths.log, logLine(today, runId, "executed", { ...summaryFields(out), haltSkip: out.sized.skippedHalt.length }));
    deps.notifySummary?.(summaryFromRun(out, "executed", fills, audit, skippedCutoff));
    if (out.sized.skippedHalt.length) {
      notify(`cron: ${out.sized.skippedHalt.length} order(s) skipped by the per-ticker halt — ${out.sized.skippedHalt.map((h) => `${h.ticker} (${h.reason})`).join(", ")}`);
    }
    return { status: "executed", orders: out.sized.orders.length, fills: fills.length };
```

Change the outer `try { … } finally { lock.release(); }` to `try { … } catch (e) { … } finally { lock.release(); }`:

```ts
  } catch (e) {
    // Phase-based (F-4): before any order reached the broker, the caller alerts (alert-only). After, this is a
    // halted run — count it, alert, and never let it escape (the scheduler would otherwise treat it as pre-trade).
    if (!ordersSent()) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    let counter = "";
    try { counter = ` · halt counter now ${bumpHalt(paths.haltState).consecutive}`; } catch (be) { counter = ` · halt counter NOT bumped (${(be as Error).message})`; }
    try { notify(`cron halted: error after orders were sent — ${msg}${counter}. Check the broker's order history and run \`npm run trade:audit -- --run ${runId}\` before the next slot.`); } catch { /* never mask */ }
    try { appendLog(paths.log, logLine(today, runId, "halted", { reason: "execute-error" })); } catch { /* never mask */ }
    return { status: "halted", reason: "execute-error" };
  } finally {
```

- [ ] **Step 4: `scripts/trade-execute.ts` audit tail.** Replace everything from `const brokerIdByCid` to the end of the file with:

```ts
const brokerIdByCid = new Map(executed.filter((e) => e.status !== "rejected").map((e) => [e.clientOrderId, e.brokerId || undefined]));
let audit: ReturnType<typeof crossCheckBroker> | null = null;
let auditReadError = "";
try {
  audit = crossCheckBroker({
    expected: out.sized.orders.filter((o) => brokerIdByCid.has(o.clientOrderId)).map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side, brokerId: brokerIdByCid.get(o.clientOrderId) })),
    brokerOrders: await adapter.getOrders("all", `${today}T00:00:00Z`),
    fills,
  });
} catch (e) {
  auditReadError = e instanceof Error ? e.message : String(e);
}
if (audit) {
  for (const d of audit.discrepancies) console.error(`  [${d.severity.toUpperCase()}] ${d.code} ${d.ticker}${d.orderId ? ` (${d.orderId})` : ""} — ${d.detail}`);
  notifier.runSummary(summaryFromRun(out, "executed", fills, audit, skippedCutoff));
}
const stop = async (msg: string) => { notifier.message(msg); await notifier.flush(); console.error(msg); process.exit(1); };
if (aborted) await stop(abortAlert(aborted, "trade:execute"));
if (!audit) await stop(`trade:execute: the broker-truth check could not read the broker's orders (${auditReadError}). ${fills.length} fill(s) recorded; run record ${path}. Run \`npm run trade:audit -- --run ${runId}\` before the next run.`);
if (!audit!.ok) await stop(`Broker-truth check FAILED: ${audit!.critical} critical discrepancy(ies). Investigate before the next run.`);
const stillWorking = executed.filter((e) => e.brokerId && !TERMINAL_STATUSES.has(e.status as BrokerOrderStatus));
if (stillWorking.length) await stop(`trade:execute: ${stillWorking.length} order(s) still working at the broker after the cancel attempt — ${stillWorking.map((e) => `${e.brokerId} (${e.status}${e.cancelError ? `; cancel failed: ${e.cancelError}` : ""})`).join(", ")}. Check the broker before the next run.`);
console.log(`Broker-truth check ${audit!.warn ? `OK with ${audit!.warn} warning(s)` : "clean"}.`);
await notifier.flush();
```
Also add `import { TERMINAL_STATUSES, type BrokerOrderStatus } from "../lib/broker/adapter";`. (`stop` never returns: `process.exit`.)

- [ ] **Step 5: Verify.** `npx vitest run lib/trade/cron.test.ts lib/trade/audit.test.ts lib/trade/audit.integration.test.ts lib/trade/phase2-e2e.test.ts` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add lib/trade/cron.ts lib/trade/cron.test.ts scripts/trade-execute.ts
git commit -m "fix(trade): halt (not crash, not 'executed') on audit-read failure, a still-working order, or an error after submits (T-8, F-1, F-4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 6: T-4 + F-4 — an escaped scheduled-run error is alerted (alert-only); Schwab setup errors are auth errors

**Files:**
- Modify `lib/trade/cron.ts` (new helper), `lib/trade/scheduler-wiring.ts:38-80`, `scripts/trade-cron.ts:98-103`, and `lib/trade/runtime.ts:9,71-72`.
- Test `lib/trade/cron.test.ts`, `lib/trade/scheduler-wiring.test.ts` and `lib/trade/runtime.test.ts`.

**Interfaces:**
- `reportUnexpectedCronError(e: unknown, o: { source: string; notify: (m: string) => void }): void` — never throws, never touches the halt counter.
- `buildSchedulerDeps(env?: NodeJS.ProcessEnv, opts?: { notifier?: TradeNotifier; paths?: Partial<CronDeps["paths"]> }): SchedulerDeps`

Since Task 5, anything that escapes `runCron` happened before any order reached the broker. So it is alert-only: pre-trade trouble does not block tomorrow's run. `runOnce` re-throws after alerting, so `startScheduler`'s catch keeps its exact behaviour: log, status "error", re-arm, and the slot is not stamped. `makeBroker`'s missing-token and unlinked-account errors become `SchwabAuthError`, so the alert reads as a re-auth instruction.

- [ ] **Step 1: Write the failing tests.**

Append to `lib/trade/cron.test.ts` (import `reportUnexpectedCronError`):

```ts
describe("reportUnexpectedCronError (T-4, F-4: alert-only)", () => {
  it("alerts with the source and message, says nothing was sent, and never touches a counter", () => {
    const msgs: string[] = [];
    reportUnexpectedCronError(new Error("Schwab GET … → 503"), { source: "scheduler", notify: (m) => msgs.push(m) });
    expect(msgs).toEqual([expect.stringMatching(/^scheduler: run stopped before any order was sent — Schwab GET … → 503\./)]);
  });
  it("a SchwabAuthError reads as a re-auth instruction", () => {
    const msgs: string[] = [];
    reportUnexpectedCronError(new SchwabAuthError("No Schwab tokens. Run: npm run trade:auth"), { source: "scheduler", notify: (m) => msgs.push(m) });
    expect(msgs[0]).toMatch(/^scheduler: Schwab re-auth needed — No Schwab tokens/);
  });
  it("never throws, even when notify throws", () => {
    expect(() => reportUnexpectedCronError(new Error("x"), { source: "s", notify: () => { throw new Error("discord down"); } })).not.toThrow();
  });
});
```

Replace `lib/trade/scheduler-wiring.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSchedulerDeps } from "./scheduler-wiring";
import { readHaltState } from "./breakers";
import type { TradeNotifier } from "./notify";

/** Every run path in a temp dir — these tests must never touch data/trade (the old disabled test wrote data/trade/cron.log). */
const tmpPaths = () => {
  const d = mkdtempSync(join(tmpdir(), "wiring-"));
  return { lock: join(d, "cron.lock"), haltState: join(d, "halt.json"), log: join(d, "cron.log"), fills: join(d, "fills.jsonl"), runs: join(d, "runs"), authWarn: join(d, "auth-warn.json"), relabelState: join(d, "relabel.json") };
};
const recNotifier = () => {
  const messages: string[] = []; let flushed = 0;
  const notifier: TradeNotifier = { message: (m) => { messages.push(m); }, runSummary: () => {}, allocation: () => {}, flush: async () => { flushed++; } };
  return { notifier, messages, flushes: () => flushed };
};

describe("buildSchedulerDeps", () => {
  it("with TRADE_DISABLED=1, runOnce returns 'disabled', needs no broker keys, and logs to the injected path", async () => {
    const paths = tmpPaths();
    const deps = buildSchedulerDeps({ TRADE_DISABLED: "1", BROKER: "alpaca-paper" } as unknown as NodeJS.ProcessEnv, { paths, notifier: recNotifier().notifier });
    expect(deps.broker).toBe("alpaca-paper");
    expect(typeof deps.now()).toBe("number");
    expect((await deps.runOnce()).status).toBe("disabled");
    expect(existsSync(paths.log)).toBe(true);
  });

  it("T-4: an error escaping runOnce is alerted, flushed and re-thrown; the halt counter is untouched (pre-trade)", async () => {
    const paths = tmpPaths(); const n = recNotifier();
    const deps = buildSchedulerDeps({ BROKER: "nope" } as unknown as NodeJS.ProcessEnv, { paths, notifier: n.notifier });
    await expect(deps.runOnce()).rejects.toThrow(/BROKER=nope is not a known broker/);
    expect(n.messages).toEqual([expect.stringMatching(/^scheduler: run stopped before any order was sent — BROKER=nope is not a known broker/)]);
    expect(n.flushes()).toBe(1);
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 });
  });
});
```

Append to `lib/trade/runtime.test.ts` (import `SchwabAuthError` from `../broker/schwab-auth`):

```ts
  it("F-4: an unlinked Schwab account is a SchwabAuthError (re-auth), not a plain error", () => {
    if (existsSync(runtime.SCHWAB_TOKEN_PATH)) return; // a real linked account on this machine supplies the hash
    const env = { BROKER: "schwab", SCHWAB_CLIENT_ID: "x", SCHWAB_CLIENT_SECRET: "y", SCHWAB_REFRESH_TOKEN: "r" } as unknown as NodeJS.ProcessEnv;
    expect(() => runtime.makeBroker(env)).toThrow(SchwabAuthError);
  });
```
(`existsSync` is already imported there; check and add if not.)

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/cron.test.ts lib/trade/scheduler-wiring.test.ts lib/trade/runtime.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

`lib/trade/cron.ts` — append:
```ts
/**
 * An error that escaped runCron (the in-app scheduler or the trade:cron CLI). runCron catches everything that happens
 * after an order reached the broker (it halts with "execute-error"), so anything escaping happened before any order
 * was sent: alert only — pre-trade trouble (a read outage, a token to renew) must not block tomorrow's run. Never throws.
 */
export function reportUnexpectedCronError(e: unknown, o: { source: string; notify: (m: string) => void }): void {
  const msg = e instanceof Error ? e.message : String(e);
  const text = e instanceof SchwabAuthError
    ? `${o.source}: Schwab re-auth needed — ${msg}. Nothing was sent this slot.`
    : `${o.source}: run stopped before any order was sent — ${msg}. Nothing was traded this slot; check cron.log. The next slot runs as usual.`;
  try { o.notify(text); } catch { /* an alert must never mask the error */ }
}
```

`lib/trade/runtime.ts` — `import { SchwabAuthError, SchwabTokenStore, currentRefreshObtainedAt, refreshSeedFromEnv } from "../broker/schwab-auth";`, and lines 71-72:
```ts
    if (!accountHash) throw new SchwabAuthError("Schwab account not linked. Run: npm run trade:auth (or set SCHWAB_ACCOUNT_HASH)");
    if (!tokenStore.envSeed && !tokenStore.read()) throw new SchwabAuthError("No Schwab tokens. Run: npm run trade:auth (or set SCHWAB_REFRESH_TOKEN)");
```

`lib/trade/scheduler-wiring.ts`:
```ts
import { runCron, reportUnexpectedCronError, type CronDeps, type CronResult } from "./cron";
import { makeNotifier, type TradeNotifier } from "./notify";

export interface SchedulerWiringOptions {
  /** Tests inject a recording notifier; default: Discord webhook (if set) + the run log. */
  notifier?: TradeNotifier;
  /** Tests point every run path at a temp dir; default: the data/trade constants. */
  paths?: Partial<CronDeps["paths"]>;
}

export function buildSchedulerDeps(env: NodeJS.ProcessEnv = process.env, opts: SchedulerWiringOptions = {}): SchedulerDeps {
  const cfg = resolveTradeConfig(tradeConfigFromEnv(env));
  const broker = env.BROKER ?? "alpaca-paper";
  const disabled = env.TRADE_DISABLED === "1";
  const paths: CronDeps["paths"] = { lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH, log: CRON_LOG_PATH, fills: FILLS_PATH, runs: RUNS_DIR, authWarn: AUTH_WARN_PATH, relabelState: RELABEL_STATE_PATH, ...opts.paths };
  const notifier = opts.notifier ?? makeNotifier({
    webhookUrl: env.DISCORD_WEBHOOK_URL,
    onLog: (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      mkdirSync(dirname(paths.log), { recursive: true });
      appendFileSync(paths.log, line + "\n");
      console.error(line);
    },
  });

  // Lazily build the adapter per fire so a token refreshed between runs is picked up.
  const runOnce = async (): Promise<CronResult> => {
    try {
      const adapter = disabled ? unreachableAdapter() : makeBroker(env);
      const configuredBaseUrl = disabled ? "" : brokerBaseUrl(adapter);
      const nowMs = Date.now();
      const today = todayET(nowMs); // one clock read for both, and the ET trading date (not UTC)
      const result = await runCron({
        adapter, cfg, today, nowMs, runId: newRunId(today), configuredBaseUrl, paths,
        refreshObtainedAt: disabled ? undefined : schwabRefreshObtainedAt(env),
        clock: Date.now,
        loadInputs: async () => { const m = await loadReportsAndMeta(); return { ...m, fills: readFills(paths.fills) }; },
        notify: notifier.message, notifySummary: notifier.runSummary, disabled, env,
        previewOnly: isPreviewOnly(env), turnoverBreaker: isTurnoverBreakerOn(env), notifyAllocation: notifier.allocation,
      });
      await notifier.flush();
      return result;
    } catch (e) {
      // Alert like trade:cron's CLI, then re-throw so startScheduler keeps its path: log, status "error", re-arm.
      reportUnexpectedCronError(e, { source: "scheduler", notify: notifier.message });
      await notifier.flush();
      throw e;
    }
  };
```
(`marketOpenNow` and the returned object unchanged.)

`scripts/trade-cron.ts` — import `reportUnexpectedCronError` and replace the `notifier.message(\`trade:cron: unexpected error — …\`)` line with `reportUnexpectedCronError(err, { source: "trade:cron", notify: notifier.message });`.

- [ ] **Step 4: Verify.** `npx vitest run lib/trade/cron.test.ts lib/trade/scheduler-wiring.test.ts lib/trade/scheduler.test.ts lib/trade/runtime.test.ts` → PASS; `npx tsc --noEmit` → 0. From here the full suite no longer writes `data/trade/cron.log`.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/cron.ts lib/trade/cron.test.ts lib/trade/scheduler-wiring.ts lib/trade/scheduler-wiring.test.ts scripts/trade-cron.ts lib/trade/runtime.ts lib/trade/runtime.test.ts
git commit -m "fix(trade): alert on an error escaping the scheduled run; Schwab setup errors are auth errors (T-4, F-4)

Pre-trade escapes are alert-only (post-submit errors are counted inside runCron). The wiring
test no longer writes data/trade/cron.log.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 7: T-5 + F-3 — manual `trade:execute` holds the run-lock, re-checks it, and refuses a stale plan

**Files:** Modify `lib/trade/breakers.ts` and `scripts/trade-execute.ts`. Test `lib/trade/breakers.test.ts`.

**Interfaces:**
- `type ManualRunGate = { ok: true; release: () => void; stillOurs: () => boolean } | { ok: false; reason: string }`
- `acquireManualRun(paths: { lock: string; haltState: string }, cfg: TradeConfig, staleMs?: number): ManualRunGate`
- `MANUAL_PLAN_MAX_AGE_MS = 600_000`; `manualPlanTooOld(plannedAtMs: number, nowMs: number, maxAgeMs?: number): boolean`

The lock is taken **before planning**. A plan made before a scheduled run traded, then submitted after it, would double-trade. Just before `executeOrders`, the script also checks that:
- the lock still holds this run's own body (F-3);
- the plan is no more than 10 minutes old (F-3).

`--preview` takes no lock, so a preview never blocks the scheduler. The gate never writes the halt counter. SIGINT, SIGTERM and SIGHUP release the lock.

- [ ] **Step 1: Write the failing tests.** Append to `lib/trade/breakers.test.ts` (import `acquireManualRun, manualPlanTooOld, MANUAL_PLAN_MAX_AGE_MS`):

```ts
describe("acquireManualRun (T-5, F-3)", () => {
  const P = () => { const d = mkdtempSync(join(tmpdir(), "manual-")); return { lock: join(d, "cron.lock"), haltState: join(d, "halt.json") }; };

  it("takes the run lock, owns it, and releases it", () => {
    const p = P(); const g = acquireManualRun(p, C);
    expect(g.ok).toBe(true);
    if (g.ok) { expect(g.stillOurs()).toBe(true); g.release(); }
    expect(existsSync(p.lock)).toBe(false);
  });
  it("refuses while another run holds a fresh lock, and leaves that lock alone", () => {
    const p = P(); expect(acquireLock(p.lock)).toBe(true);
    const before = readFileSync(p.lock, "utf8");
    expect(acquireManualRun(p, C)).toEqual({ ok: false, reason: expect.stringMatching(/holds the run lock/) });
    expect(readFileSync(p.lock, "utf8")).toBe(before);
  });
  it("refuses while the consecutive-halt breaker is tripped, releases its lock, and never touches the counter", () => {
    const p = P();
    for (let i = 0; i < C.consecutiveHaltLimit; i++) bumpHalt(p.haltState);
    expect(acquireManualRun(p, C)).toEqual({ ok: false, reason: expect.stringMatching(/consecutive halted run/) });
    expect(existsSync(p.lock)).toBe(false);
    expect(readHaltState(p.haltState)).toEqual({ consecutive: C.consecutiveHaltLimit });
  });
  it("refuses on an unreadable halt file", () => {
    const p = P(); writeFileSync(p.haltState, "garbage");
    expect(acquireManualRun(p, C)).toEqual({ ok: false, reason: expect.stringMatching(/halt state is unreadable/) });
    expect(existsSync(p.lock)).toBe(false);
  });
  it("after a stale reclaim the manual run sees it no longer owns the lock and never deletes the new holder's", () => {
    const p = P(); const g = acquireManualRun(p, C);
    writeFileSync(p.lock, `99999 ${new Date().toISOString()} cafe`); // cron reclaimed it
    if (g.ok) { expect(g.stillOurs()).toBe(false); g.release(); }
    expect(readFileSync(p.lock, "utf8")).toMatch(/^99999 /);
  });
  it("a plan older than 10 minutes is too old to submit", () => {
    expect(MANUAL_PLAN_MAX_AGE_MS).toBe(600_000);
    expect(manualPlanTooOld(0, 600_000)).toBe(false);
    expect(manualPlanTooOld(0, 600_001)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/breakers.test.ts` → FAIL.

- [ ] **Step 3: Implement in `lib/trade/breakers.ts`** (append):

```ts
export type ManualRunGate = { ok: true; release: () => void; stillOurs: () => boolean } | { ok: false; reason: string };

/**
 * The manual `trade:execute` gate: hold the SAME exclusive run-lock as cron from before planning (a plan made before
 * a scheduled run traded and submitted after it would double-trade), then refuse while the consecutive-halt breaker
 * is tripped or unreadable. Read-only on the counter. The caller re-checks `stillOurs()` just before submitting.
 */
export function acquireManualRun(paths: { lock: string; haltState: string }, cfg: TradeConfig, staleMs: number = DEFAULT_LOCK_STALE_MS): ManualRunGate {
  const lock = holdLock(paths.lock, staleMs);
  if (!lock) return { ok: false, reason: `another trade run holds the run lock (${paths.lock}) — wait for it to finish (a lock older than ${Math.round(staleMs / 60_000)} min is reclaimed)` };
  let state: HaltState;
  try {
    state = readHaltState(paths.haltState);
  } catch (e) {
    lock.release();
    return { ok: false, reason: `halt state is unreadable — ${(e as Error).message}` };
  }
  if (haltBlocked(state, cfg)) {
    lock.release();
    return { ok: false, reason: `${state.consecutive} consecutive halted run(s) (limit ${cfg.consecutiveHaltLimit}) — investigate, then clear the halt state to resume` };
  }
  return { ok: true, release: lock.release, stillOurs: lock.stillOurs };
}

/** A manual plan answered later than this is refused: the market and the book have moved on (F-3). */
export const MANUAL_PLAN_MAX_AGE_MS = 10 * 60_000;
export function manualPlanTooOld(plannedAtMs: number, nowMs: number, maxAgeMs: number = MANUAL_PLAN_MAX_AGE_MS): boolean {
  return nowMs - plannedAtMs > maxAgeMs;
}
```

- [ ] **Step 4: Wire `scripts/trade-execute.ts`.** Replace lines 13-26 (the `_trade-common` import through `const notifier = …`; the old notifier line is removed) with:

```ts
import { has, isPreviewOnly, loadReportsAndMeta, makeBroker, brokerBaseUrl, readFills, CRON_LOCK_PATH, FILLS_PATH, HALT_STATE_PATH, LEDGER_PATH, RUNS_DIR } from "./_trade-common";
import { etInstantOn, todayET } from "../lib/trade/clock";
import { acquireManualRun, manualPlanTooOld, MANUAL_PLAN_MAX_AGE_MS, type ManualRunGate } from "../lib/trade/breakers";

const args = process.argv.slice(2);
// --preview, or PREVIEW_ONLY=true in the environment: plan + post the allocation, never submit.
const preview = has(args, "--preview") || isPreviewOnly();
if (process.env.TRADE_DISABLED === "1" && !preview) { console.error("TRADE_DISABLED=1 — refusing to submit (use --preview to plan only)."); process.exit(2); }
const cfg = resolveTradeConfig(tradeConfigFromEnv());
const notifier = makeNotifier({ webhookUrl: process.env.DISCORD_WEBHOOK_URL });
// A run that may submit holds cron's run-lock from BEFORE planning (no overlap with the scheduler, no double-submit)
// and refuses while the consecutive-halt breaker is tripped. Released on every exit path; a preview takes no lock.
let gate: Extract<ManualRunGate, { ok: true }> | null = null;
if (!preview) {
  const g = acquireManualRun({ lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH }, cfg);
  if (!g.ok) {
    const msg = `trade:execute refused — ${g.reason}`;
    console.error(msg); notifier.message(msg); await notifier.flush(); process.exit(2);
  }
  gate = g;
  process.once("exit", g.release);
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) process.once(sig, () => { g.release(); process.exit(code); });
}
const today = todayET();
const adapter = makeBroker();
const baseUrl = brokerBaseUrl(adapter);
const mode = adapter.kind === "schwab" ? ">>> LIVE — Charles Schwab (real money) <<<" : "paper — Alpaca (test)";
console.log(`Broker: ${adapter.kind}  ${mode}`);
```

After the `planRun` try/catch (right after `out` is assigned), add `const plannedAtMs = Date.now();`. Immediately before `const cutoffMs = etInstantOn(today, cfg.submitCutoffET);` add:

```ts
// F-3: submit only on a fresh plan, under a lock that is still ours (a prompt left open can outlive both).
if (gate) {
  const refuse = async (msg: string) => { console.error(msg); notifier.message(msg); await notifier.flush(); process.exit(2); };
  if (manualPlanTooOld(plannedAtMs, Date.now())) await refuse(`trade:execute refused — the plan is ${Math.round((Date.now() - plannedAtMs) / 60_000)} min old (limit ${MANUAL_PLAN_MAX_AGE_MS / 60_000}). Nothing was sent; re-run trade:execute for a fresh plan.`);
  if (!gate.stillOurs()) await refuse(`trade:execute refused — the run lock (${CRON_LOCK_PATH}) is no longer this run's (it was reclaimed by another run). Nothing was sent.`);
}
```
Do not run the script.

- [ ] **Step 5: Verify.** `npx vitest run lib/trade/breakers.test.ts lib/trade/cron.test.ts` → PASS; `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add lib/trade/breakers.ts lib/trade/breakers.test.ts scripts/trade-execute.ts
git commit -m "fix(trade): trade:execute holds the run-lock, re-checks it and the plan age before submitting, refuses while halted (T-5, F-3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 8: A-3/T-7 + F-5 — atomic state writes with a safe fallback; token file 0600

**Files:**
- Create `lib/atomic-write.ts` and `lib/atomic-write.test.ts`.
- Modify `lib/broker/schwab-auth.ts:16-17,54-57`, `lib/trade/breakers.ts` (`bumpHalt`/`clearHalt`), `lib/trade/scheduler.ts:52-56` and `lib/trade/run-record.ts` (`writeRunRecord`).
- Test `lib/broker/schwab-auth.test.ts`.

**Interface:** `writeFileAtomic(path: string, data: string, opts?: { mode?: number; dirMode?: number }, log?: (m: string) => void): void`

**How the write works:**
- **Temp file.** The temp is a sibling, `<path>.tmp-<pid>-<hex>`. Its name never ends in `.json`, so `dayTurnoverUsd`/`latestRunRecord` never read a crash leftover.
- **Default mode.** `0o666` before umask, the same as `writeFileSync`, so only the token's permissions change.
- **dirMode** applies only to directories the call creates.
- **Rename retries (Windows).** A rename that fails with `EPERM/EACCES/EBUSY` is retried up to 4 times, 25 ms apart.
- **Fallback (F-5).** On `EXDEV` (any platform), or on any other rename failure on Linux, it falls back to a direct `writeFileSync` to the target (plus `chmod`) and logs it. A torn write is better than losing a rotated refresh token.
- **Directory fsync (F-5, Linux).** After a successful rename the directory is fsynced. A filesystem that refuses a directory fsync is ignored.
- **Untouched.** `acquireLock` and `appendFill`.

- [ ] **Step 1: Write the failing tests.** Create `lib/atomic-write.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, writeFileSync: vi.fn(real.writeFileSync), renameSync: vi.fn(real.renameSync) };
});
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write";
import { dayTurnoverUsd } from "./trade/breakers";

const dir = () => fs.mkdtempSync(join(tmpdir(), "atomic-"));
const errno = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });

describe("writeFileAtomic", () => {
  it("writes, replaces, creates the parent, and leaves no temp file", () => {
    const d = dir(); const p = join(d, "sub", "state.json");
    writeFileAtomic(p, "one"); writeFileAtomic(p, "two");
    expect(fs.readFileSync(p, "utf8")).toBe("two");
    expect(fs.readdirSync(join(d, "sub"))).toEqual(["state.json"]);
  });
  it("a write that dies midway leaves the previous file intact and removes its temp file", () => {
    const d = dir(); const p = join(d, "halt.json");
    writeFileAtomic(p, '{"consecutive":1}');
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw errno("ENOSPC"); });
    expect(() => writeFileAtomic(p, '{"consecutive":2}')).toThrow(/ENOSPC/);
    expect(fs.readFileSync(p, "utf8")).toBe('{"consecutive":1}');
    expect(fs.readdirSync(d)).toEqual(["halt.json"]);
  });
  it("F-5: a rename refused with EXDEV falls back to a direct write and logs it (any platform)", () => {
    const d = dir(); const p = join(d, "token.json"); const logs: string[] = [];
    writeFileAtomic(p, "old");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw errno("EXDEV"); });
    writeFileAtomic(p, "new", {}, (m) => logs.push(m));
    expect(fs.readFileSync(p, "utf8")).toBe("new");
    expect(logs).toEqual([expect.stringMatching(/EXDEV.*wrote the file directly/)]);
    expect(fs.readdirSync(d)).toEqual(["token.json"]);
  });
  it.skipIf(process.platform !== "linux")("F-5: on Linux any rename failure falls back to a direct write", () => {
    const d = dir(); const p = join(d, "state.json"); const logs: string[] = [];
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw errno("EIO"); });
    writeFileAtomic(p, "x", {}, (m) => logs.push(m));
    expect(fs.readFileSync(p, "utf8")).toBe("x");
    expect(logs).toHaveLength(1);
  });
  it("a crash leftover is never read as a run record (temp names don't end in .json)", () => {
    const d = dir();
    writeFileAtomic(join(d, "r1.json"), JSON.stringify({ today: "2026-10-07", orders: [{ filledQty: 2, filledAvgPrice: 10 }] }));
    fs.writeFileSync(join(d, "r2.json.tmp-123-abcd"), "{ torn");
    expect(dayTurnoverUsd(d, "2026-10-07")).toBe(20);
  });
  it.skipIf(process.platform === "win32")("applies the requested mode exactly (POSIX), also on the fallback path", () => {
    const p = join(dir(), "token.json");
    writeFileAtomic(p, "{}", { mode: 0o600 });
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw errno("EXDEV"); });
    writeFileAtomic(p, "{}", { mode: 0o600 }, () => {});
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });
});
```

Append to `lib/broker/schwab-auth.test.ts` (add `readdirSync, statSync` to its `node:fs` import and `dirname` from `node:path`):

```ts
describe("SchwabTokenStore.write (A-3)", () => {
  const pathOf = (s: SchwabTokenStore) => (s as unknown as { path: string }).path;
  it("round-trips and leaves no temp file next to the token", () => {
    const store = tmpStore(); store.write(seed({ refreshToken: "R9" }));
    expect(store.read()!.refreshToken).toBe("R9");
    expect(readdirSync(dirname(pathOf(store)))).toEqual(["token.json"]);
  });
  it.skipIf(process.platform === "win32")("the token file is owner-only (0600)", () => {
    const store = tmpStore(); store.write(seed());
    expect(statSync(pathOf(store)).mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/atomic-write.test.ts lib/broker/schwab-auth.test.ts` → FAIL.

- [ ] **Step 3: Create `lib/atomic-write.ts`**

```ts
/**
 * atomic-write.ts — replace a small state file all-or-nothing: write a sibling temp file, fsync it, rename it over the
 * target, fsync the directory (Linux). A crash mid-write leaves the old file, never a torn one — which for the Schwab
 * token would lose a rotated refresh token, and for halt state would read as "corrupt" and halt.
 *
 * The temp name ends in random hex, never ".json", so a crash leftover is never read as a run record. `mode` applies
 * to the new file (default 0o666 before umask, as writeFileSync; Windows ignores all but the write bit). `dirMode`
 * applies only to directories this call creates.
 *
 * Fallback (F-5): a filesystem that cannot rename here (EXDEV — e.g. an Unraid user share spanning disks — or any
 * rename failure on Linux) gets a direct write to the target instead, logged: losing the update is worse than a torn
 * write. Windows keeps throwing after its retries (dev only).
 */
import { chmodSync, closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** Windows: a target briefly held open (antivirus, the indexer) fails the rename with one of these. */
const RETRYABLE_RENAME = new Set(["EPERM", "EACCES", "EBUSY"]);

export function writeFileAtomic(path: string, data: string, opts: { mode?: number; dirMode?: number } = {}, log: (m: string) => void = (m) => console.warn(m)): void {
  mkdirSync(dirname(path), { recursive: true, ...(opts.dirMode != null ? { mode: opts.dirMode } : {}) });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    const fd = openSync(tmp, "wx", opts.mode ?? 0o666);
    try {
      if (opts.mode != null && process.platform !== "win32") fchmodSync(fd, opts.mode);
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  try {
    renameWithRetry(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code !== "EXDEV" && process.platform !== "linux") throw e;
    log(`[atomic-write] rename onto ${path} failed (${code || (e as Error).message}); wrote the file directly instead`);
    writeFileSync(path, data);
    if (opts.mode != null && process.platform !== "win32") chmodSync(path, opts.mode);
    return;
  }
  fsyncDir(dirname(path));
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !RETRYABLE_RENAME.has(code) || attempt >= 4) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // 25 ms, synchronous
    }
  }
}

/** Make the rename itself durable (Linux). Some filesystems (FUSE) refuse a directory fsync — the rename is done either way. */
function fsyncDir(dir: string): void {
  if (process.platform !== "linux") return;
  try {
    const fd = openSync(dir, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* best effort */ }
}
```

- [ ] **Step 4: Use it.**
  - **`lib/broker/schwab-auth.ts`.**
    - Line 16 becomes `import { existsSync, readFileSync } from "node:fs";`.
    - Remove the `dirname` import (line 17).
    - Add `import { writeFileAtomic } from "../atomic-write";`.
    - Replace `write`:
```ts
  /** Atomic (a crash can't lose a rotated refresh token) and owner-only: 0600 file, 0700 if the directory is created here. */
  write(t: SchwabTokens): void {
    writeFileAtomic(this.path, JSON.stringify(t, null, 2) + "\n", { mode: 0o600, dirMode: 0o700 });
  }
```
  - **`lib/trade/breakers.ts`.** Make `bumpHalt` and `clearHalt` use `writeFileAtomic(path, JSON.stringify(…))`, dropping their `mkdirSync`. `acquireLock` keeps `mkdirSync`/`writeFileSync`.
  - **`lib/trade/scheduler.ts`.** Change `writeSchedulerState` to `writeFileAtomic(STATE_FILE(dir), JSON.stringify(s, null, 2) + "\n");`. Drop the `mkdirSync`, `writeFileSync` and `dirname` imports if they are now unused.
  - **`lib/trade/run-record.ts`.** Change `writeRunRecord` to `const path = join(dir, \`${rec.runId}.json\`); writeFileAtomic(path, JSON.stringify(RunRecord.parse(rec), null, 2) + "\n"); return path;`. Drop the unused `mkdirSync`/`writeFileSync`.

- [ ] **Step 5: Verify.** `npx vitest run lib/atomic-write.test.ts lib/broker/schwab-auth.test.ts lib/broker/schwab.test.ts lib/trade/breakers.test.ts lib/trade/scheduler.test.ts lib/trade/run-record.test.ts lib/trade/cron.test.ts` → PASS (POSIX-only tests skipped on Windows); `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add lib/atomic-write.ts lib/atomic-write.test.ts lib/broker/schwab-auth.ts lib/broker/schwab-auth.test.ts lib/trade/breakers.ts lib/trade/scheduler.ts lib/trade/run-record.ts
git commit -m "fix(trade): atomic token/halt/scheduler/run-record writes with EXDEV/Linux fallback and dir fsync; token 0600 (A-3/T-7, F-5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 9: T-11 — a future-stamped trade/quote is not "fresh"

**Files:** Modify `lib/trade/limit.ts:72-81` and `lib/trade/orders.ts:56`. Test `lib/trade/limit.test.ts` and `lib/trade/orders.test.ts`.

This applies `liveMark`'s rule (`pipeline.ts:102`): a print is fresh if it is within `maxStaleMin` of capture, on either side.
- Normal clock skew (seconds) stays fresh.
- Only a print stamped more than the window into the future changes. It falls to the next tier (the quote, then the settled close) and blocks the market leg (`stale_quote`).

- [ ] **Step 1: Write the failing tests.** Append to `lib/trade/limit.test.ts` (it already imports `computeLimit` and `DEFAULT_TRADE_CONFIG as C`):

```ts
describe("freshness is two-sided (T-11)", () => {
  const NOW = 1_700_000_000_000;
  const base = { side: "buy" as const, marketCapUsd: 50e9, nowMs: NOW, cfg: C }; // large bucket: maxStaleMin 5
  it("a trade stamped 30 s in the future (clock skew) is still tier 1", () => {
    expect(computeLimit({ ...base, mkt: { lastTrade: { price: 50, tsMs: NOW + 30_000 }, quote: null, close: 50 } }).tier).toBe(1);
  });
  it("a trade stamped 10 min in the future is not fresh: tier 3 at the close", () => {
    expect(computeLimit({ ...base, mkt: { lastTrade: { price: 51, tsMs: NOW + 10 * 60_000 }, quote: null, close: 50 } })).toMatchObject({ tier: 3, pRef: 50 });
  });
  it("a quote stamped 10 min in the future is not fresh either", () => {
    expect(computeLimit({ ...base, mkt: { lastTrade: null, quote: { bid: 49.9, ask: 50.1, tsMs: NOW + 10 * 60_000 }, close: 50 } }).tier).toBe(3);
  });
});
```

In `lib/trade/orders.test.ts` extend the import to `import { tradesToOrders, clientOrderId, marketLegBlock } from "./orders";`, then append:

```ts
describe("marketLegBlock — a future-stamped quote is stale (T-11)", () => {
  const diag = (quoteAgeMs: number) => ({ relSpread: 0.0004, tauWanted: 0.0015, bid: 49.99, ask: 50.01, quoteAgeMs, tradeAgeMs: 0 });
  it("blocks a quote 10 min in the future, allows a few seconds of skew", () => {
    expect(marketLegBlock(diag(-10 * 60_000), "large", cfg)).toBe("stale_quote");
    expect(marketLegBlock(diag(-5_000), "large", cfg)).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/limit.test.ts lib/trade/orders.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `lib/trade/limit.ts` lines 72-81:

```ts
/** Fresh = within staleMs of the capture instant on EITHER side (a far-future stamp is no fresher than a stale one), as liveMark. */
const fresh = (tsMs: number, nowMs: number, staleMs: number) => Number.isFinite(tsMs) && Math.abs(nowMs - tsMs) <= staleMs;

const lastFresh = (m: Mkt, nowMs: number, staleMs: number) =>
  !!m.lastTrade && m.lastTrade.price > 0 && fresh(m.lastTrade.tsMs, nowMs, staleMs);

function anchor(m: Mkt, nowMs: number, staleMs: number, side: "buy" | "sell"): { pRef: number; tier: 1 | 2 | 3 } | null {
  if (lastFresh(m, nowMs, staleMs)) return { pRef: m.lastTrade!.price, tier: 1 };
  const q = quoteMetrics(m.quote);
  if (m.quote && q.valid && fresh(m.quote.tsMs, nowMs, staleMs)) return { pRef: side === "buy" ? m.quote.ask : m.quote.bid, tier: 2 };
  if (m.close > 0) return { pRef: m.close, tier: 3 };
  return null;
}
```

`lib/trade/orders.ts:56`:
```ts
  if (Math.abs(diag.quoteAgeMs) > cfg.maxStaleMin[bucket] * 60_000) return "stale_quote"; // either side: a future stamp is not fresh
```

- [ ] **Step 4: Verify.** `npx vitest run lib/trade/limit.test.ts lib/trade/orders.test.ts lib/trade/pipeline.test.ts lib/trade/pipeline.live.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/limit.ts lib/trade/limit.test.ts lib/trade/orders.ts lib/trade/orders.test.ts
git commit -m "fix(trade): execution freshness is two-sided, like liveMark (T-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 10: T-19 + F-9 — a sell never asks for more than is held, nor more than 4 decimals

**Files:** Modify `lib/trade/orders.ts:105-106,124` and the header comment. Test `lib/trade/orders.test.ts`.

**Fractional mode (the default).** Every sell quantity is floored to 4 dp:
- EXIT: `floor4(pos.qty)`.
- TRIM: `floor4(Math.min(pos.qty, −deltaUsd / mark))` (F-9).
- The remainder leg: `floor4(qty − whole)`.

**What stays identical.** A position held to ≤ 4 dp gives byte-identical orders; that covers everything the engine itself bought, since buys are already `floor4`'d. Whole-share mode and buys are unchanged.

**What changes for a position with more decimals.** It used to fail in one of two ways:
- the remainder rounded up past the holding (40.99996 held → limit 40 + market 1.0000);
- or `schwabOrderBody` refused the raw 5-dp quantity locally, so nothing was sold.

Now it sells 40.9999 (or 2.9999) and leaves under 0.0001 sh, which later runs see as dust.

- [ ] **Step 1: Write the failing tests.** Append inside `describe("tradesToOrders — hybrid …")` in `lib/trade/orders.test.ts`:

```ts
  it("T-19: a sub-$200 EXIT of a 5-dp position is one market sell floored to 4 dp (Schwab refuses more decimals)", () => {
    // 2.9999 × L 49.88 ≈ $150 < marketOnlyBelowUsd ($200) → one market order. Before: 2.99996 sent raw → refused locally.
    const { orders } = tradesToOrders({ ...hb, positions: { A: { qty: 2.99996, marketValue: 150 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0015, targetWeight: 0, deltaWeight: -0.0015 })]) });
    expect(orders.map((o) => [o.type, o.qty])).toEqual([["market", 2.9999]]);
  });
  it("T-19: a large EXIT of a 5-dp position splits into whole shares + a floored remainder that never exceeds the position", () => {
    const { orders } = tradesToOrders({ ...hb, positions: { A: { qty: 40.99996, marketValue: 2050 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0205, targetWeight: 0, deltaWeight: -0.0205 })]) });
    expect(orders.map((o) => [o.type, o.qty])).toEqual([["limit", 40], ["market", 0.9999]]);
    expect(orders.reduce((a, o) => a + o.qty, 0)).toBeLessThanOrEqual(40.99996);
  });
  it("F-9: a TRIM capped at a 5-dp position is floored too", () => {
    // $1,000 / $50 = 20 sh wanted > 2.99996 held → capped, then floored.
    const { orders } = tradesToOrders({ ...hb, positions: { A: { qty: 2.99996, marketValue: 150 } },
      plan: plan([trade({ side: "sell", reason: "TRIM", currentWeight: 0.0015, targetWeight: 0.0005, deltaWeight: -0.01 })]) });
    expect(orders.map((o) => o.qty)).toEqual([2.9999]);
  });
  it("T-19 guard: a 4-dp position (everything the engine buys) gives the same orders as before", () => {
    const { orders } = tradesToOrders({ ...hb, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    expect(orders.map((o) => [o.type, o.qty])).toEqual([["limit", 33], ["market", 0.4]]);
  });
```

- [ ] **Step 2: Verify failure.** `npx vitest run lib/trade/orders.test.ts -t "T-19|F-9"` → the first three FAIL; the guard PASSES.

- [ ] **Step 3: Implement** in `lib/trade/orders.ts` (lines 105-106):

```ts
      qty = t.reason === "EXIT" ? (cfg.fractionalShares ? floor4(pos.qty) : pos.qty)
        : cfg.fractionalShares ? floor4(Math.min(pos.qty, -deltaUsd / mark)) : Math.min(pos.qty, Math.round(-deltaUsd / mark));
```
Line 124:
```ts
    const frac = t.side === "sell" ? floor4(qty - whole) : round4(qty - whole); // a sell never rounds up past what is held
```
In the header comment, change "An EXIT sells the exact broker qty." to "An EXIT sells the broker qty (floored to 4 dp in fractional mode — the most Schwab takes); a sell quantity never exceeds the position."

- [ ] **Step 4: Verify.** `npx vitest run lib/trade/orders.test.ts lib/trade/pipeline.test.ts lib/trade/e2e.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/orders.ts lib/trade/orders.test.ts
git commit -m "fix(trade): floor every fractional-mode sell quantity to 4 dp; never above the position (T-19, F-9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 11: A-5 — the scheduler arms once per process

**Files:** Modify `instrumentation-node.ts`. Create `instrumentation-node.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `instrumentation-node.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from "vitest";

const { stop, startScheduler, buildSchedulerDeps } = vi.hoisted(() => {
  const stop = vi.fn();
  return { stop, startScheduler: vi.fn(() => ({ stop })), buildSchedulerDeps: vi.fn(() => ({})) };
});
vi.mock("./lib/trade/scheduler-wiring", () => ({
  buildSchedulerDeps, startScheduler,
  getSchedulerStatus: () => ({ broker: "fake", nextRunISO: null }),
}));
import { registerNode } from "./instrumentation-node";

const prev = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
  Object.assign(process.env, prev);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.removeListener(sig, stop);
  delete (globalThis as { __tradeSchedulerRegistered?: boolean }).__tradeSchedulerRegistered;
  startScheduler.mockClear(); buildSchedulerDeps.mockReset(); buildSchedulerDeps.mockImplementation(() => ({}));
});

describe("registerNode (A-5)", () => {
  it("arms one scheduler and one pair of signal listeners per process, however often it is called", async () => {
    process.env.NEXT_RUNTIME = "nodejs"; process.env.TRADE_SCHEDULER_ENABLED = "1";
    const before = process.listenerCount("SIGTERM");
    await registerNode(); await registerNode();
    expect(startScheduler).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGTERM") - before).toBe(1);
  });
  it("a failed arm can be retried by a later call", async () => {
    process.env.NEXT_RUNTIME = "nodejs"; process.env.TRADE_SCHEDULER_ENABLED = "1";
    buildSchedulerDeps.mockImplementationOnce(() => { throw new Error("no keys"); });
    await registerNode();
    expect(startScheduler).not.toHaveBeenCalled();
    await registerNode();
    expect(startScheduler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify failure.** `npx vitest run instrumentation-node.test.ts` → FAIL (armed twice).

- [ ] **Step 3: Implement.** Replace `registerNode` in `instrumentation-node.ts`:

```ts
/** One scheduler per process: Next may call register() again (a dev reload, a second module graph). */
const g = globalThis as unknown as { __tradeSchedulerRegistered?: boolean };

export async function registerNode(): Promise<void> {
  if (!shouldArm(process.env)) {
    if (process.env.NEXT_RUNTIME === "nodejs") console.log("[scheduler] disabled (set TRADE_SCHEDULER_ENABLED=1 to arm)");
    return;
  }
  // A second arm would start a second timer (two runs per slot, the run-lock turning one into "locked") and stack
  // SIGTERM/SIGINT listeners. The flag is set before the await so concurrent calls can't both arm, and cleared on
  // failure so a later call can retry.
  if (g.__tradeSchedulerRegistered) { console.log("[scheduler] already armed in this process — not arming again"); return; }
  g.__tradeSchedulerRegistered = true;
  try {
    const { buildSchedulerDeps, startScheduler, getSchedulerStatus } = await import("./lib/trade/scheduler-wiring");
    const { stop } = startScheduler(buildSchedulerDeps(process.env));
    for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, stop);
    const s = getSchedulerStatus();
    console.log(`[scheduler] armed, broker=${s.broker}, next=${s.nextRunISO}`);
  } catch (e) {
    g.__tradeSchedulerRegistered = false;
    // Never take the web server down because the trader couldn't arm (e.g. missing broker keys).
    console.error(`[scheduler] failed to arm — serving pages without it: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

- [ ] **Step 4: Verify.** `npx vitest run instrumentation-node.test.ts instrumentation.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add instrumentation-node.ts instrumentation-node.test.ts
git commit -m "fix(trade): arm the in-app scheduler once per process (A-5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 12: `docs/engine.md` — new behaviour and the stale lines (T-15, T-16, T-17, F-12)

**Files:** Modify `docs/engine.md`. Every "replace" below quotes the current line exactly, backticks included.

- [ ] **Step 1: §4.1, line 337 (T-15).** Replace exactly
  `Any working (non-terminal) order also halts — this engine only sends IOC. The halt repeats on every run`
  with
  ``Any working (non-terminal) order also halts. Every order the engine sends ends inside its own run — an IOC on Alpaca; on Schwab a DAY limit or market order that the run cancels if it is still working (§5.1) — so a working order at the next run means a cancel failed or something else is trading the account. The halt repeats on every run``

- [ ] **Step 2: §4.4.** Insert after line 482 (the end of the first paragraph):
  ``**Old fills.** `planRun` loads the calendar from today − 90 calendar days, and `fills.jsonl` is append-only. A fill dated before the loaded calendar is skipped: assuming the calendar has no gaps (every trading day in its range), such a fill's lock ends at or before the calendar's n-th day, long past (90 days hold ≥ 56 trading days; n = 5). `locksFor` checks this and throws rather than skip when today is fewer than n trading days into the calendar. A lock that is still active is computed exactly as before.``

- [ ] **Step 3: §5.1.**
  - Replace line 500 exactly
    `          = full broker position qty                EXIT (no dust left behind)`
    with
    `          = broker position qty, floor4 in fractional mode   EXIT (leaves < 0.0001 sh at most)`.
  - In line 501, change `min( position qty, floor4( −deltaUsd / mark ) )` to `floor4( min( position qty, −deltaUsd / mark ) )`.
  - After line 506 insert `sell remainder = floor4( qty − floor(qty) ), so whole + remainder never exceeds the position`.
  - Replace lines 517-521 (from `**IOC on Schwab is emulated.**` to ``is recorded as `rejected` and the run continues.``) with:
  ``**IOC on Schwab is emulated.** Schwab has no `IMMEDIATE_OR_CANCEL` duration (400 "Invalid value"; only DAY / GOOD_TILL_CANCEL / FILL_OR_KILL). An "ioc" limit goes in as DAY; `executeOrders` polls `iocPolls` (8 × 1 s), cancels the unfilled rest, and waits for the broker to settle it (a partial fill is kept). A market order gets `marketPolls` (30) before the same cancel. Each poll loop stops early after 3 failed order-list reads in a row or 60 s of wall clock, and the cancel is always sent. If an order is still not known to be finished and its reads failed, the run stops (`poll-unavailable`): cron records the run, audits and halts. An order the broker reports still working after its cancel halts the run too (`order-working`). A guard refusal mid-run (kill switch, a lock, the ban, a run cap) stops the run as `guard`; a cash-backstop refusal is still just a skip. A definitive reject (4xx, or an order the adapter refuses to send) is recorded as `rejected` and the run continues.``

- [ ] **Step 4: §6.1 (T-16).**
  - Replace line 611 exactly with
    `turnover breaker      Σ|qty·limitPrice| > maxRunTurnoverFrac (0.15) · NAV     → halt, submit nothing   [cron; OFF unless TURNOVER_BREAKER=1]`.
  - After line 616 (`submit cutoff …`) insert:
```
poll-unavailable      an order not known finished and its order-list reads failed → stop sending, halt
guard (mid-run)       a guard refuses an order after the run started           → stop sending, halt (counted only if an order already went out)
audit-unavailable     the post-execution broker-orders read fails              → halt + alert (fills/record kept)
order-working         an order still working after its cancel                  → halt (never cleared as "executed")
execute-error         an error after an order reached the broker               → halt + alert (counted)
pre-trade error       anything failing before any order is sent                → alert only (not counted)
manual run gate       trade:execute (not --preview) holds cron's run-lock      → refuse if held / halted; re-check ownership + plan age (≤ 10 min) before submit
```
  - After the closing fence of that block, add: ``The turnover breaker is off in production (owner, 2026-10-01): a scheduled run trades the whole plan unless `TURNOVER_BREAKER` is set; the per-order guards (locks, ban, cash backstop, order-count and notional caps) always apply.``

- [ ] **Step 5: §6.2.** Replace lines 671-672 exactly (``A CRITICAL fails `trade:execute` (non-zero exit) and, in `trade:cron`, halts with `reason:"broker-mismatch"` `` / ``+ notify. Run it read-only any time with `npm run trade:audit [-- --run <id>]`.``) with:
  ``A CRITICAL fails `trade:execute` (non-zero exit) and, in `trade:cron`, halts with `reason:"broker-mismatch"` + notify. If the broker's orders cannot be read for the check (after retries), cron halts with `reason:"audit-unavailable"` and `trade:execute` exits non-zero, both with an alert naming the run. Run it read-only any time with `npm run trade:audit [-- --run <id>]`.``

- [ ] **Step 6: §7 (T-17, F-12).**
  - **Line 710.** Replace ``Both implement one 11-method `BrokerAdapter`;`` with ``Both implement one `BrokerAdapter` (12 methods plus the optional batched `getLatestSnapshots`);``. Match the backticks exactly.
  - **New bullet after the Brokers bullet:**
    ``- **Rate limits and retries (`lib/broker/http.ts`).** Reads (GET) and the Schwab cancel (DELETE, idempotent) retry a timeout or network error twice (1 s, 3 s) and, independently, an HTTP 429 or 5xx three times (2 s, 5 s, 10 s, or the server's Retry-After when longer, capped at 15 s) — about 110 s worst case per call. Other 4xx are final. An order submit is never retried: a 429 on submit is a definitive reject (nothing placed, the run continues) and a 5xx or timeout is an unknown outcome resolved by looking the order up.``
  - **Scheduler bullet list, three new items:**
    - `An error that escapes a scheduled run is alerted (Discord). It is never counted: anything after an order reached the broker is caught inside runCron and halts there. The scheduler then re-arms as before, and it arms once per process.`
    - ``A run that finds the run-lock held posts an alert and skips the slot. A run releases the lock only while it is still its own, and a lock whose body cannot be parsed counts as stale once its file is older than 60 min.``
    - ``A manual `trade:execute` (not `--preview`) holds the run-lock from before planning until it exits (SIGINT/SIGTERM/SIGHUP included). Before submitting it re-checks that the lock is still its own and that the plan is at most 10 min old. A manual run left open across 15:10 makes that day's scheduled run skip, with an alert.``
  - **Line 783.** Replace ``closes would run into the broker's market-data rate limit; a 429 is not retried.`` with ``closes would run into the broker's market-data rate limit; a 429 is retried with backoff (above, about 110 s worst case per call), which slows a run but does not fail it.``

- [ ] **Step 7: Commit.** `git diff --stat` shows only `docs/engine.md`.

```bash
git add docs/engine.md
git commit -m "docs(engine): retry policy, bounded polls and run stops, phase-based halts, lock ownership, manual run gate; fix stale IOC/breaker/adapter lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
```

---

### Task 13: Full verification, then STOP (a)

- [ ] **Step 1: Full suite** (safe since Task 6; `.claude/**` excluded since Task 0): `npx vitest run` → all PASS, 0 failed. Record the totals.
- [ ] **Step 2: Types:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Lint:** `npx eslint vitest.config.mts lib/atomic-write.ts lib/atomic-write.test.ts lib/broker lib/trade scripts/trade-execute.ts scripts/trade-cron.ts instrumentation-node.ts instrumentation-node.test.ts` → 0 errors. Then run `npm run lint` and confirm it shows no new errors compared with `main`.
- [ ] **Step 4: Nothing live touched.** `git status --porcelain` → clean, nothing under `data/`. `git log --oneline main..HEAD` → 13 commits (Tasks 0–12).
- [ ] **Step 5: Whole-branch review** (superpowers:requesting-code-review). Focus on:
  - submit idempotency;
  - the cash-backstop lines inside the new `try`;
  - each `aborted` path and its counter rule (F-4);
  - `holdLock` ownership in cron and in `trade:execute`;
  - `locksFor` equivalence;
  - `writeFileAtomic`'s fallback.

## STOP (a) — code and tests on the branch; nothing merged

Report the branch, the 13 commits, and the vitest, tsc and eslint results. Then restate the four **Owner decisions** above as defaults the owner may override:
1. Phase-based halt counting.
2. 2/5/10 s retries with a 15 s cap, plus the poll bounds (about 110 s per call).
3. Token 0600, with the EXDEV/Linux fallback, and `trade:auth` only as `nextjs`.
4. The manual-run lock, with the ownership and plan-age checks and the locked alert.

Do not merge, push, or pull anything into the container.

---

## STOP (b) — before merge to `main` (owner approves)

**Owner questions (answer before the pull):**
1. **Is the Schwab account a margin account or a cash account?** In a cash account, unsettled proceeds can block a same-day buy that the cash backstop allowed. That buy would come back as a broker reject. In a margin account, an over-sell could become a short; T-19/F-9 now prevents that for fractional quantities.
2. **Is dividend reinvestment on?** DRIP creates positions with more than 4 decimals, the case T-19/F-9 now floors. It also creates broker-side buys with no matching fill in `fills.jsonl`, which makes reconcile halt until they are recorded with `trade:reconcile -- --record-missing`.
3. **What Unraid path backs `./data/trade`?** Recommended: a path on `/mnt/cache/...`, or a share kept on a single pool, rather than a `/mnt/user` share that spans disks. That way the atomic rename never hits EXDEV and the F-5 fallback stays a safety net, not the normal path.
4. **Run a preview before the pull and confirm the plan has 40 orders or fewer** (`maxOrdersPerRun`). A plan above 40 now stops at the 41st order as `halted (guard)`; before this change the run crashed at that point. This is an owner-run, read-only command in the container, e.g. `npm run trade:execute -- --preview`.
5. **Owner-run, read-only check:** does Schwab accept a fractional MARKET sell worth under $1? Test with `previewOrder`, which places nothing, on a ~0.001 sh sell. If not, a tiny sell remainder comes back `rejected` (nothing placed, the run continues) and stays as dust.

Once approved:

```bash
cd C:/Users/nicopc/Documents/juniresearch
git checkout main
git merge --no-ff claude/trade-engine-hardening-2026-10-07 -m "Merge trade engine hardening (audit item 1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GtWKytJZWdc3hi9EDpqwDW"
npx vitest run
npx tsc --noEmit
```

Push only on the owner's word (`git push origin main`). Then run `git worktree remove .worktrees/trade-engine-hardening`.

### Safe-to-pull note (for the owner)

**When to pull.** Pull outside 15:10–15:50 ET on a trading day (the morning is best), with no Schwab orders working. Before pulling, check `GET /api/trade/status`: armed, `nextRunISO` at 15:10 ET, and the `lastRun` status. Also check that the halt counter is below 3. A restart before 15:10 only arms for the slot; it does not trade at boot. Run `trade:auth` only as the container's default user (`nextjs`), never with `docker exec -u root`, so the 0600 token stays readable by the app.

**What the next 15:10 run does with the four pending exits (V, CEG, RTX, SCHW):**
- **Decision: unchanged.**
  - No signal, hysteresis, rebalance or guard code changed.
  - Each name is EXIT, or DEFER_EXIT if a buy fill in the last 5 trading days still sell-locks it, exactly as today.
  - All live fills date from 2026-09-25 on, so they all sit inside the 90-day calendar, and the T-1 change has no effect until about 2026-12-24.
- **Quantities.** EXIT sells the broker quantity.
  - For a position held to ≤ 4 decimals, the orders are identical to today's: a whole-share τ-capped DAY limit (polled, then cancelled) plus a market remainder only if the limit leg filled; or one market sell under $200.
  - With more decimals (see the DRIP question), the sell is floored to 4 dp instead of being refused or over-asked.
- **Order.** Sells still go first. A buy funded by a sell passes the cash backstop only on proceeds that actually filled.
- **Broker hiccups.**
  - A 429/5xx on a read waits and retries (about 110 s worst case per call) instead of failing the run.
  - A failed fill poll no longer crashes the run. If the order is then seen finished, the run continues.
  - If it is not, and the order list stayed unreadable, the run stops after that order (`poll-unavailable`): remaining orders are not sent, the record is written, the counter goes up, and Discord tells you what to check.
  - The 15:50 cutoff still stops new submits.
- **Other stops, each alerted:**
  - an order still working after its cancel (`order-working`);
  - the post-trade audit read failing (`audit-unavailable` — run `npm run trade:audit -- --run <id>`);
  - a guard refusing mid-run (`guard`, e.g. more than 40 orders);
  - an error after an order went out (`execute-error`).

  None of these end as "executed", and none clear the halt counter.
- **Pre-trade trouble** (a read outage before any order, a token to renew): Discord alert only. The counter is untouched, and the next slot runs normally.
- **Lock.** A held lock now posts an alert. A run never deletes a lock it no longer owns.
- **Token file.** At the first access-token refresh after the restart, `schwab-token.json` is rewritten atomically with mode 0600 (or written directly with a logged warning if the share cannot rename).
- **Manual runs.** Don't run `trade:execute` between 15:10 and 15:50. If you do, it refuses while the scheduled run holds the lock. If yours starts first, the scheduled run skips that day and alerts. A manual plan more than 10 minutes old is refused at submit.

**Optional owner-run smoke (read-only, after the pull, outside the window):** `npm run trade:audit` in the container. It only reads Schwab. Nothing in this plan runs it for you.

### Risks and rollback

| Risk | Mitigation |
|---|---|
| Retry waits slow a run near the 15:50 cutoff | The cutoff is checked before every submit; sells go first, so a cutoff only leaves cash; buys move to the next day. |
| A single lost order can take ~7.5 min worst case (bounded polls + one in-flight read and the cancel at ~110 s each) | F-1 then stops the run; the order can only fill at or inside its τ-capped limit; the cancel is always sent. |
| A stop after submits (`poll-unavailable`, `order-working`, `audit-unavailable`, `execute-error`) counts toward the 3-halt block | Each is alerted with what to check; one clean run clears the counter. Pre-trade errors never count. |
| Token file becomes 0600 / owner change | Same container user for every reader; `trade:auth` only as `nextjs`. |
| Bind mount on a `/mnt/user` share spanning disks | F-5 direct-write fallback (logged); owner moves it to `/mnt/cache` or a single-pool share (STOP (b) Q3). |
| A plan > 40 orders now halts as `guard` | Pre-pull preview (STOP (b) Q4). |

**Rollback:** `git revert -m 1 <merge-sha>` on `main`, push on the owner's word, then pull and rebuild outside the 15:10–15:50 window. No data migration is needed:
- state files keep their format;
- lock bodies gain a third field that the old parser ignores;
- run-record orders may carry the optional `pollErrors`/`cancelError`/`cancelNote`, which the old loose schema ignores;
- the token file stays 0600 (harmless).
