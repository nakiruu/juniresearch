# Multi-Broker (Alpaca-paper / Schwab-live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Executed **inline (TDD)** this session. Steps use checkbox syntax.

**Goal:** Add a Schwab live-trading broker selectable by env (`BROKER=alpaca-paper|schwab`), keeping the pure core, breakers, locks, and audit untouched.

**Architecture:** `SchwabBroker implements BrokerAdapter` behind a `makeBroker()` factory; OAuth token manager with weekly-re-auth alerting; a local NYSE calendar; the clientOrderId impedance mismatch absorbed inside the adapter. Broker-aware safety guard; breakers stay hard limits; no per-run confirmation.

**Tech Stack:** TypeScript, Node, vitest, zod, native fetch (injectable `fetchImpl`). Branch `trade-layer`.

**Spec:** `docs/superpowers/specs/2026-09-25-multi-broker-schwab-live-design.md`

## Global Constraints

- TDD; failing test first. Whole suite stays green (baseline 1060), `tsc`+`eslint` clean.
- Pure core / sizing / hysteresis / locks / `audit.ts` join logic UNCHANGED.
- Default `BROKER` = `alpaca-paper` → existing behavior byte-identical.
- No live validation in this build (mock/unit tests only). Tolerant zod on every Schwab response.
- Schwab = whole-share only (Ruling A′); no fractional/notional path.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS`.

---

### Task 1: Broker selection + broker-aware guard + env

**Files:** Modify `lib/broker/adapter.ts`, `lib/broker/guards.ts` (+`guards.test.ts`), `scripts/_trade-common.ts`, `scripts/_env.ts`.

**Interfaces:**
- `adapter.kind: "alpaca-paper" | "schwab" | "fake"`.
- `guards.ts`: add `SCHWAB_HOST = "api.schwabapi.com"`; `assertOrderAllowed` — for `alpaca-paper` keep PAPER_HOST check; for `schwab` require `configuredBaseUrl.includes(SCHWAB_HOST)`; `fake` unaffected.
- `_env.ts`: `requireSchwab(): { clientId; clientSecret; redirectUri }`.
- `_trade-common.ts`: `makeBroker(): BrokerAdapter` (env `BROKER`, default alpaca-paper). (SchwabBroker import wired in Task 5 once it exists; Task 1 can stub the schwab branch to `throw new Error("schwab adapter not wired yet")` then Task 5 replaces it — OR do the makeBroker schwab branch in Task 5. Plan: add the `alpaca-paper` factory now, schwab branch in Task 5.)

- [ ] Step 1: `guards.test.ts` — schwab ctx w/ non-Schwab host throws; w/ Schwab host passes; alpaca-paper unchanged. Run→fail.
- [ ] Step 2: widen `kind` union; add `SCHWAB_HOST` + broker-aware branch in `assertOrderAllowed`. Run→pass.
- [ ] Step 3: add `requireSchwab` to `_env.ts`; `makeBroker()` (alpaca-paper + fake-not-here; schwab branch stubbed to throw pending Task 5). Run `tsc`.
- [ ] Step 4: Commit `feat(broker): broker-aware guard + BROKER env selector (alpaca-paper default)`.

### Task 2: Local NYSE trading calendar

**Files:** Create `lib/trade/nyse-calendar.ts`, `lib/trade/nyse-calendar.test.ts`.

**Interfaces:**
- Produces: `nyseTradingDays(from: string, to: string): BrokerCalendarDay[]` (weekends excluded; observed US-market holidays excluded from a maintained table covering ≥ current year ±1; each day `{date, open:"09:30", close:"16:00"}`). Consumed by `SchwabBroker.getCalendar` (Task 5).

- [ ] Step 1: Test — a normal week yields Mon–Fri; a weekend excluded; 2026 holidays (New Year, MLK, Presidents, Good Friday, Memorial, Juneteenth, Independence(obs), Labor, Thanksgiving, Christmas) excluded; range spanning a holiday drops exactly it; result feeds `addTradingDays`/`prevTradingDay` correctly across a holiday. Run→fail.
- [ ] Step 2: Implement with a `HOLIDAYS: Set<string>` table (2025–2028 observed dates) + weekend filter + a guard that throws if `to` exceeds the table's coverage (fail-loud, not silently wrong). Run→pass.
- [ ] Step 3: Commit `feat(trade): local NYSE trading calendar (weekends + observed holidays)`.

### Task 3: Schwab OAuth token manager

**Files:** Create `lib/broker/schwab-auth.ts`, `lib/broker/schwab-auth.test.ts`.

**Interfaces:**
- `class SchwabAuthError extends Error`.
- `interface SchwabTokens { refreshToken; accessToken; accessExpiresAt: number; refreshObtainedAt: number }`.
- `class SchwabTokenStore { constructor(path); read(): SchwabTokens | null; write(t): void }`.
- `ensureAccessToken(store, creds:{clientId,clientSecret}, fetchImpl, nowMs?): Promise<string>` — returns a valid access token; refreshes (POST `/v1/oauth/token`, grant_type=refresh_token, Basic auth, form-encoded) within 60s skew and persists; throws `SchwabAuthError("run npm run trade:auth")` on 400/401 or missing store.
- `exchangeCode(code, creds, redirectUri, fetchImpl): Promise<{tokens, }>` (grant_type=authorization_code) — used by `trade:auth`.
- `TOKEN_ENDPOINT = "https://api.schwabapi.com/v1/oauth/token"`, `AUTHORIZE_ENDPOINT`.

- [ ] Step 1: Tests (mock fetch + temp file): valid unexpired token returned without a network call; near-expiry triggers refresh + persists new access/expiry; refresh 401 → `SchwabAuthError` w/ remedy; `exchangeCode` parses tokens. Run→fail.
- [ ] Step 2: Implement store + `ensureAccessToken` + `exchangeCode` (tolerant zod on the token response; Basic header base64(clientId:clientSecret)). Run→pass.
- [ ] Step 3: Commit `feat(broker): Schwab OAuth token store + refresh with re-auth alerting`.

### Task 4: SchwabBroker — read methods + clientOrderId map

**Files:** Create `lib/broker/schwab.ts`, `lib/broker/schwab.test.ts`.

**Interfaces:**
- `class SchwabBroker implements BrokerAdapter { kind="schwab" }`; ctor `{ tokenStore, clientId, clientSecret, accountHash, traderBase?, dataBase?, fetchImpl?, nowMs? }`.
- Read methods: `getClock`, `getAccount`, `getPositions`, `getOrders`, `getLastClose`, `getLatestTrade`, `getLatestQuote`, `isFractionable`. Private `authedFetch` (adds `Authorization: Bearer <ensureAccessToken>`), tolerant zod per endpoint. Private `cidByBrokerId: Map<string,string>` + `stampCid(order)`.

- [ ] Step 1: Tests (mock fetch): each read method maps a realistic Schwab JSON into the adapter shape (account balances, positions longQuantity, orders status/side/filledQty/weighted-avg, quotes last/bid/ask, pricehistory last close, clock isOpen); `isFractionable`→all false; a 401 surfaces via SchwabAuthError from the auth layer. Run→fail.
- [ ] Step 2: Implement read methods + `authedFetch` + zod schemas + `stampCid`. Run→pass.
- [ ] Step 3: Commit `feat(broker): SchwabBroker read methods (accounts/orders/quotes/history)`.

### Task 5: SchwabBroker — submit/cancel + getCalendar + wire makeBroker

**Files:** Modify `lib/broker/schwab.ts` (+test), `scripts/_trade-common.ts` (makeBroker schwab branch).

**Interfaces:**
- `submitOrder(req)`: POST order body per spec §3; parse `orderId` from `Location`; record `cidByBrokerId.set(orderId, req.clientOrderId)`; return `BrokerOrder` (follow-up GET for status, else `new`). Reject `req.notional`/non-integer qty. `cancelOrder(id)`: DELETE.
- `getCalendar(from,to)` → `nyseTradingDays(from,to)`.
- `_trade-common.ts`: `makeBroker()` schwab branch constructs `SchwabBroker` from `requireSchwab()` + `SchwabTokenStore(SCHWAB_TOKEN_PATH)` + stored `accountHash`.

- [ ] Step 1: Tests: `submitOrder` parses Location→id, stores cid map, `getOrders` then stamps clientOrderId; a fractional/notional submit rejects; `cancelOrder` issues DELETE; `getCalendar` delegates to the NYSE calendar. Run→fail.
- [ ] Step 2: Implement submit/cancel/getCalendar; wire `makeBroker()` schwab branch (replace the Task-1 stub). Run→pass; `tsc`.
- [ ] Step 3: Commit `feat(broker): SchwabBroker submit/cancel + calendar + makeBroker wiring`.

### Task 6: Scripts — trade:auth, broker-aware execute/cron/reconcile/audit

**Files:** Create `scripts/trade-auth.ts`; modify `scripts/trade-execute.ts`, `scripts/trade-reconcile.ts`, `scripts/trade-cron.ts`, `scripts/trade-audit.ts`, `lib/trade/cron.ts` (+`cron.test.ts`), `package.json`, `.env.example`, `.gitignore`.

**Interfaces:**
- `trade:auth` → interactive OAuth (authorize URL → paste redirect → `exchangeCode` → resolve accountHash via `/accounts/accountNumbers` → write token store).
- `trade-execute`/`reconcile`/`cron`/`audit`: `makeAlpaca()`→`makeBroker()`; drop `trade-execute`'s hard `--paper` requirement → broker-aware loud mode print; catch `SchwabAuthError` → remedy + exit. `trade-audit` no-keys guard becomes broker-aware.
- `cron.ts`: catch `SchwabAuthError` around planRun/execute → `{status:"halted", reason:"auth"}` + notify.

- [ ] Step 1: `cron.test.ts` — a SchwabAuthError thrown by a stub adapter's read → `{status:"halted", reason:"auth"}` + notify + lock released. Run→fail.
- [ ] Step 2: cron auth-halt; wire `makeBroker()` + broker-aware guards/prints across the four scripts; `trade-auth.ts`; `package.json` `"trade:auth"`; `.env.example` (`BROKER`,`SCHWAB_*`) + `.gitignore` (`schwab-token.json` under `data/trade/` already ignored — confirm). Run→pass.
- [ ] Step 3: Full suite green; `tsc`+`eslint` clean.
- [ ] Step 4: Commit `feat(trade): trade:auth + broker-aware execute/cron/reconcile/audit (Schwab live via BROKER=schwab)`.

## Self-Review

- Spec coverage: §1 selection→T1/T5, §2 safety→T1/T6, §3 read→T4, submit→T5, §4 cid-map→T4/T5, §5 auth→T3/T6, §6 env→T1/T6, calendar→T2. Covered.
- Types consistent: `SchwabTokens`, `ensureAccessToken`, `BrokerOrder.clientOrderId` stamping, `nyseTradingDays`, `makeBroker` used identically across tasks.
- Default-paper invariant preserved (T1 makeBroker default). Core untouched.
