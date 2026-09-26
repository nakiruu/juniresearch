# Multi-Broker (Alpaca-paper test / Schwab live) — Design

**Branch:** `trade-layer` (unmerged, gated). **Date:** 2026-09-25.

## Motivation

Today the trade layer is hard-wired to Alpaca Paper (`makeAlpaca()`, `PAPER_HOST`
guard, `requireAlpaca`, `--paper`-only). Nico wants a second broker: **Charles
Schwab's Trader API for LIVE trading**, selected by env, with Alpaca Paper kept
as the test rig. Mental model: **`alpaca-paper` = testing, `schwab` = live**.

Key facts established during feasibility ([sources in the investigation]):
- **Schwab has no paper trading** — its Trader API is live-only. `BROKER=schwab`
  means real orders on a funded account. This is Nico's deliberate, informed choice.
- Schwab supports the pieces we need: `IMMEDIATE_OR_CANCEL` duration (our IOC
  model), `LIMIT` orders, quotes/positions/orders/pricehistory. **No fractional
  via API** — which matches our existing whole-share rule (Ruling A′) exactly.
- **Schwab OAuth refresh tokens expire every 7 days** and can only be renewed by
  an interactive login — so fully-unattended-forever is impossible; the design
  makes the weekly re-auth a ~2-minute known touch, not a silent failure.
- **Schwab has no client-order-id** on equity orders (broker-assigned id only,
  returned in the POST `Location` header).

Nico's directive: **unattended, no per-run human confirmation** — the point of
the system is that he can't manage holdings intraday. `BROKER=schwab` in env is
the deliberate opt-in; after that it runs on the schedule like Alpaca.

## Goals

1. Select the broker by env (`BROKER=alpaca-paper` default | `schwab`) via a
   `makeBroker()` factory; the pure core, breakers, locks, audit, sizing are
   untouched (they never name a broker).
2. A `SchwabBroker implements BrokerAdapter` — live, OAuth2, tolerant zod, the
   same 11-method contract, with a `fetchImpl` seam for unit tests.
3. Generalize the safety model so it is broker-aware: Alpaca can never go live;
   Schwab is live by selection; every breaker stays a **hard limit**; no per-run
   confirmation on either scheduled path.
4. OAuth token management with automatic access-token refresh and a `trade:auth`
   command for the weekly re-auth; the run alerts (never silently dies) when
   re-auth is due.

## Non-goals

- No live validation in this build — I have no Schwab creds and will not place
  live orders. Deliverable is **code-complete + mock/unit-tested**; live auth and
  a first real-order check are Nico's, exactly as Alpaca's field names were
  deferred to a Phase-1 smoke test.
- No change to the pure core, sizing, hysteresis, locks, or the audit join logic
  (the clientOrderId impedance mismatch is absorbed inside the Schwab adapter).
- No removal of any breaker; no `--yes`/confirmation redesign beyond making the
  Schwab path not require one.

## Design

### 1. Broker selection — `makeBroker()` + `BROKER` env

- `adapter.kind` union → `"alpaca-paper" | "schwab" | "fake"`.
- `_trade-common.ts`: `makeBroker(): BrokerAdapter` reads `process.env.BROKER`
  (default `"alpaca-paper"`). `alpaca-paper` → `AlpacaPaperBroker` (unchanged);
  `schwab` → `SchwabBroker`. `makeAlpaca()` stays (used by `trade:plan --broker
  alpaca` read-only marks) but the execute/reconcile/cron/audit scripts call
  `makeBroker()`.
- Default is paper, so nothing goes live unless `BROKER=schwab` is set explicitly.

### 2. Safety model — broker-aware, breakers as hard limits

- `guards.ts` `assertOrderAllowed` becomes broker-aware:
  - `alpaca-paper` → keep the `PAPER_HOST` check (Alpaca can never be pointed live).
  - `schwab` → assert the configured base host is the Schwab host (`api.schwabapi.com`)
    and that `BROKER=schwab` was set (belt-and-suspenders against a mis-wired ctx).
  - `fake` → unchanged (skips endpoint checks).
- `trade:execute`: drop the hard "requires `--paper`" exit. Instead it prints the
  broker + mode **loudly** (`>>> LIVE — Charles Schwab <<<` for schwab,
  `paper — Alpaca` otherwise). No confirmation is forced on either path (cron and
  `--yes` semantics unchanged). `TRADE_DISABLED=1` kill-switch still hard-blocks both.
- Every breaker (turnover cap, notional cap, ICE ban, whole-ticker locks,
  consecutive-halt, reconcile-halt, broker-truth audit) is unchanged and now
  guards real money on the Schwab path — these are the automated guardrails that
  make unattended live viable.

### 3. `SchwabBroker` (`lib/broker/schwab.ts`) implements `BrokerAdapter`

Constructor: `{ tokenStore: SchwabTokenStore; clientId; clientSecret; accountHash?; traderBase?; dataBase?; fetchImpl? }`. Tolerant zod on every response (the Alpaca-client posture: field names verified against community docs but confirmed live in Nico's smoke test). `kind = "schwab"`.

Method mapping (Schwab Trader/Market-Data API):
- `getClock()` → `GET /marketdata/v1/markets?markets=equity[&date=today]` → `equity.EQ.isOpen` (+ session hours). Authoritative isOpen incl. early closes.
- `getCalendar(from,to)` → **local NYSE trading calendar** (`lib/trade/nyse-calendar.ts`) — weekends + an observed-US-market-holiday table. Schwab has no bulk calendar endpoint and per-day calls over ±135 days are too many; the calendar is broker-agnostic and correctness-critical for lock math, so it is computed locally and unit-tested. Early-close days are still trading days (correct for locks).
- `getAccount()` → `GET /trader/v1/accounts/{hash}` → `securitiesAccount.currentBalances`: `liquidationValue`→equity, `cashBalance`→cash, `buyingPower`/`availableFunds`→buyingPower.
- `getPositions()` → `GET /trader/v1/accounts/{hash}?fields=positions` → `securitiesAccount.positions[]`: `instrument.symbol`, `longQuantity`→qty, `marketValue`, `averagePrice`→avgEntryPrice. (Short/`shortQuantity` positions are out of scope — this book is long-only; a short position surfaces via reconcile as an unexplained position → halt.)
- `getOrders(status,after)` → `GET /trader/v1/accounts/{hash}/orders?fromEnteredTime&toEnteredTime&status?` → map each: `orderId`→id, Schwab `status`→`BrokerOrderStatus` (FILLED→filled, CANCELED→canceled, REJECTED→rejected, EXPIRED→expired, WORKING/QUEUED/ACCEPTED/PENDING_*/NEW→new), `filledQuantity`→filledQty, weighted avg of `orderActivityCollection[].executionLegs[]` (qty×price)→filledAvgPrice, `enteredTime`→submittedAt, latest execution time→filledAt, `orderLegCollection[0]`→symbol/side. `clientOrderId` filled from the adapter's id→cid map (see §4).
- `getLastClose(symbols,date)` → `GET /marketdata/v1/pricehistory?symbol&periodType=month&frequencyType=daily&startDate&endDate` per symbol → last `candles[].close` with `datetime` ≤ date.
- `getLatestTrade(symbol)` → `GET /marketdata/v1/quotes?symbols=` → `quote.lastPrice` + `quote.tradeTime`. `getLatestQuote` → `quote.bidPrice`/`askPrice`/`quoteTime`.
- `isFractionable(symbols)` → `false` for all (Schwab API has no fractional; matches whole-share). Constant, no call.
- `submitOrder(req)` → `POST /trader/v1/accounts/{hash}/orders` body `{ orderType:"LIMIT", session:"NORMAL", duration:"IMMEDIATE_OR_CANCEL", orderStrategyType:"SINGLE", price, orderLegCollection:[{ instruction: buy→"BUY"/sell→"SELL", quantity, instrument:{ symbol, assetType:"EQUITY" } }] }`. 201 + empty body; parse `orderId` from the `Location` header. Record `id↔clientOrderId` in the adapter map; return a `BrokerOrder` (status from a follow-up `GET orders/{id}`, or `new` if not yet terminal — executeOrders polls). `estNotionalUsd`/limit passthrough as today. **Whole-share only** (qty is integer; Ruling A′). Rejects a `notional`/fractional request (Schwab can't).
- `cancelOrder(id)` → `DELETE /trader/v1/accounts/{hash}/orders/{id}`.

### 4. The clientOrderId gap — absorbed in the adapter

Schwab has no client-order-id, but the poll loop and the broker-truth audit join
on `clientOrderId`. The adapter keeps an in-memory `Map<brokerId, clientOrderId>`
populated at `submitOrder` (we know our deterministic cid; we learn Schwab's
orderId from the `Location` header). `getOrders`/`getOrder` stamp `clientOrderId`
back onto each returned `BrokerOrder` from that map (empty string when unknown —
e.g. an order from a prior process). The core, `executeOrders`, and `audit.ts`
are unchanged. Caveat (documented): the map is per-process, so a crash between
submit and poll loses the mapping for the poll — but reconcile + the broker-truth
audit still catch any resulting fill/position discrepancy loudly, and the next
run re-derives state from the broker. Recorded fills also store the real broker
`orderId`, so the audit's fill-side join (by orderId) is unaffected.

### 5. OAuth — `lib/broker/schwab-auth.ts` + `scripts/trade-auth.ts`

- `SchwabTokenStore`: reads/writes a gitignored `data/trade/schwab-token.json`
  (`{ refreshToken, accessToken, accessExpiresAt, refreshObtainedAt }`, chmod-safe).
- `accessToken(fetchImpl)`: returns a valid access token; if `accessExpiresAt` is
  within a 60s skew, refresh via `POST /v1/oauth/token` (grant_type=refresh_token,
  Basic base64(clientId:clientSecret), x-www-form-urlencoded) and persist. If the
  refresh returns 400/401 (refresh token expired/invalid) → throw
  `SchwabAuthError` with the exact remedy (`run npm run trade:auth`).
- `scripts/trade-auth.ts` (interactive, run manually ~weekly): prints the
  authorize URL (`/v1/oauth/authorize?client_id&redirect_uri`), reads the pasted
  redirect URL, exchanges the `code` (grant_type=authorization_code) for tokens,
  resolves and stores the `accountHash` via `/accounts/accountNumbers`, writes the
  token store. Cannot be unit-tested interactively; kept thin, its exchange logic
  lives in the (tested) auth module.
- Cron/execute: a `SchwabAuthError` is caught and surfaced — cron returns
  `{status:"halted", reason:"auth"}` + `notify("Schwab re-auth needed: run npm run
  trade:auth")` + non-zero exit; `trade:execute` prints the remedy and exits 2.
  The run **alerts**, never silently no-ops.

### 6. Env / creds (`_env.ts`)

- `requireAlpaca()` unchanged. Add `requireSchwab(): { clientId; clientSecret;
  redirectUri }` reading `SCHWAB_CLIENT_ID`/`SCHWAB_CLIENT_SECRET`/
  `SCHWAB_REDIRECT_URI`. Token store path is fixed (`data/trade/schwab-token.json`,
  gitignored). `.env.example` documents all four (+ `BROKER`).

## Testing

- `nyse-calendar.test.ts`: weekends excluded; known 2026/2027 holidays excluded;
  a normal week included; `addTradingDays`/`prevTradingDay` interplay across a
  holiday.
- `schwab-auth.test.ts` (mock fetch + temp token file): valid token returned
  as-is; expired access token triggers refresh + persist; expired refresh token →
  `SchwabAuthError`.
- `schwab.test.ts` (mock fetch): every read method parses a realistic Schwab
  response into the `BrokerAdapter` shape; `submitOrder` parses the `Location`
  header into an id and records the id↔cid map; `getOrders` stamps clientOrderId
  from the map; status/side/fill mapping; `isFractionable`→false; a
  notional/fractional submit is rejected; a 401 mid-call surfaces cleanly.
- `guards.test.ts`: schwab ctx requires the Schwab host; alpaca-paper still
  requires the paper host; fake unaffected.
- `makeBroker` factory: `BROKER` unset→alpaca-paper, `=schwab`→SchwabBroker.
- Full suite stays green; `tsc` + `eslint` clean.

## Files

- Create: `lib/broker/schwab.ts` (+test), `lib/broker/schwab-auth.ts` (+test),
  `lib/trade/nyse-calendar.ts` (+test), `scripts/trade-auth.ts`.
- Modify: `lib/broker/adapter.ts` (kind), `lib/broker/guards.ts` (broker-aware),
  `scripts/_trade-common.ts` (`makeBroker`), `scripts/_env.ts` (`requireSchwab`),
  `scripts/trade-execute.ts` / `trade-reconcile.ts` / `trade-cron.ts` /
  `trade-audit.ts` (`makeBroker`, broker-aware mode print, auth-error handling),
  `lib/trade/cron.ts` (auth-halt), `package.json` (`trade:auth`),
  `.env.example` / `.gitignore` (schwab creds + token file).

## Rollout / gating

`trade-layer` stays unmerged. Nico's live bring-up: add `SCHWAB_*` to `.env.local`,
run `npm run trade:auth` once, set `BROKER=schwab`, and do a first tiny live
`trade:execute` with `TRADE_DISABLED` ready as the kill switch. Everything here is
mock-tested; the live field-name/behavior verification is that first run — the same
posture used for Alpaca's unverified endpoints.
