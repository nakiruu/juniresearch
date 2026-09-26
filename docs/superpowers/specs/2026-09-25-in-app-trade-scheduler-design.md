# In-App Trade Scheduler + Operable Container — Design

**Branch:** `trade-layer` (unmerged, gated). **Date:** 2026-09-25.

## Motivation

The trade layer is triggered today by an OS scheduler — `register-trade-cron.ps1`
(Windows Task Scheduler) / `register-trade-cron.sh` (systemd/cron) — which runs
`npm run trade:cron` at 09:45 ET. Nico is deploying to an **Unraid server** and
wants the automation to live **inside the app** (one `docker compose up`), not as an
external OS cron job. He also, from the Unraid container terminal, needs to run the
trade CLI by hand (`trade:reconcile`, `trade:plan`, `trade:audit`, and especially the
interactive `trade:auth` for Schwab's weekly OAuth).

The current production image can do neither. `Dockerfile`'s `runner` stage ships the
minimal `output: "standalone"` bundle — `server.js` + traced server deps only. It
contains no `scripts/`, no `tsx`, no project `package.json` scripts, no broker
secrets, and no writable `data/trade/`. So `npm run trade:reconcile` in that
container fails with `ENOENT: /package.json`, and even with the right cwd there is no
`trade:*` script and no `tsx` to run it. This is by design (the image was built as a
secretless, read-only render site).

This design adds (1) an **in-process scheduler** that arms inside the Next server via
`instrumentation.ts` and calls the existing `runCron`, and (2) a **full-app `trader`
image** so the same container serves `/research`, auto-trades on schedule, **and** is
operable by `docker exec`. A small **status route** gives read-only visibility.

## Goals

1. **In-process scheduling.** The Next server, on boot, arms a scheduler that fires
   `runCron` at `cfg.cronTimeET` (09:45 ET), DST-aware, with no dependency on the host
   timezone. No OS cron needed.
2. **Catch-up on boot** (Nico's choice): if today is a trading day, the market is open
   now, and no run has fired today, run once immediately; otherwise arm for the next
   09:45 ET. `runCron`'s market-clock guard, run-lock and breakers remain the real net.
3. **Explicit, deliberate arming.** The scheduler starts only when
   `TRADE_SCHEDULER_ENABLED=1` — a flag *separate* from `TRADE_DISABLED`. Deploying the
   code never auto-arms trading. Broker stays env-driven (`BROKER`, default
   `alpaca-paper`); Schwab live is a config change, per the existing rollout gate.
4. **Operable container.** A `trader` image contains the full app + `scripts/` + `tsx`,
   so `docker exec -it juni npm run trade:{reconcile,plan,execute,audit,auth}` works,
   with `data/trade/` on a persistent writable volume.
5. **Read-only status surface** (Nico's choice): a token-gated
   `GET /api/trade/status` returning armed state, broker mode, kill-switch state, next
   scheduled run, and the last run's outcome.

## Non-goals

- **No change to the pure core's decision or `runCron` logic.** The scheduler is a
  *clock* that calls the existing, fully-guarded orchestrator; it adds no new trading
  behavior. `scripts/trade-cron.ts` and the two OS-scheduler scripts keep working
  unchanged (they remain valid alternatives).
- **No HTTP trigger to fire a run.** The status route is read-only; the scheduler owns
  timing. Keeps the network surface observability-only.
- **No web UI, no multi-worker/cluster logic** (single standalone Node process), **no
  new broker.**
- Data (status, Discord summaries) goes only to Nico's own configured endpoints.

## Design

### 1. Extract shared runtime wiring → `lib/trade/runtime.ts`

`runCron`'s dependencies (`makeBroker`, `loadReportsAndMeta`, `brokerBaseUrl`, and the
`data/trade` path constants) live today in `scripts/_trade-common.ts`, which is
CLI-only and runs under `tsx`. The compiled Next server cannot import from `scripts/`.

Move the **non-CLI, reusable** helpers into a new `lib/trade/runtime.ts`:

```ts
// lib/trade/runtime.ts — importable by BOTH scripts/_trade-common.ts and the Next server.
export const TRADE_DIR: string;            // "data/trade"
export const FILLS_PATH, LEDGER_PATH, RUNS_DIR, CRON_LOCK_PATH, CRON_LOG_PATH,
             HALT_STATE_PATH, SCHWAB_TOKEN_PATH: string;
export function makeBroker(): BrokerAdapter;            // reads BROKER env → alpaca-paper | schwab
export function brokerBaseUrl(adapter: BrokerAdapter): string;
export function loadReportsAndMeta(): Promise<{ reports: Report[];
             sics: Record<string, number|null>; marketCapUsd: Record<string, number|null> }>;
export function readFills(path: string): Fill[];
export function latestRunRecord(): RunRecord | null;
```

`scripts/_trade-common.ts` re-exports these (keeps its CLI-only extras: `flag`, `has`,
`makeFakeBroker`, `weekdayCalendar`, etc.), so every existing script and test is
untouched. Single source of truth for broker selection; no duplicated env logic.

### 2. Scheduler core → `lib/trade/scheduler.ts` (pure + testable)

Injectable clock/now (mirrors `cron.ts` taking `nowMs`), so the timing logic is unit
tested with no real timers, fs, or network.

```ts
export interface SchedulerState { lastFiredDay: string | null }   // persisted at data/trade/scheduler-state.json

/** Next `HH:MM` America/New_York wall-clock as a UTC epoch-ms, DST-aware (Intl, not host TZ).
 *  Skips forward over non-trading days using nyseTradingDays(). */
export function nextRunAtET(nowMs: number, hhmm: string): number;

/** Boot decision: run now iff not fired today AND market open now. */
export function shouldCatchUp(a: { lastFiredDay: string | null; todayET: string; marketOpen: boolean }): boolean;

export interface SchedulerStatus {
  armed: boolean; broker: string; tradeDisabled: boolean;
  nextRunISO: string | null;
  lastRun: { id: string; at: string; status: string; orders?: number; fills?: number } | null;
}
export function getSchedulerStatus(): SchedulerStatus;    // in-memory singleton, read by the status route

export interface SchedulerDeps {
  runOnce: () => Promise<CronResult>;   // wraps runCron with freshly-built deps (adapter, cfg, loadInputs, notify…)
  marketOpenNow: () => Promise<boolean>;// adapter.getClock().isOpen (broker truth)
  cfg: TradeConfig; broker: string; env: NodeJS.ProcessEnv;
  now: () => number;                    // injected clock
  setTimer: (fn: () => void, ms: number) => { clear: () => void };  // injected (real setTimeout in prod)
}
export function startScheduler(deps: SchedulerDeps): { stop: () => void };
```

`startScheduler`:
1. Read `SchedulerState`; compute `todayET`.
2. If `shouldCatchUp(...)` → `runOnce()`, stamp `lastFiredDay = todayET`.
3. Arm `setTimer` for `nextRunAtET(now, cfg.cronTimeET)`; on fire → `runOnce()`, stamp
   state, **re-arm** for the following day (recompute each time — never `setInterval`,
   for DST correctness). Update the in-memory `SchedulerStatus` on every transition.
4. `stop()` clears the timer (wired to `SIGTERM`/`SIGINT` for clean container stop).

Each `runOnce` still enters `runCron`, so the run-lock (`CRON_LOCK_PATH`), the
market-closed guard, the consecutive-halt/reconcile/turnover breakers, and the
per-submit kill-switch all apply. A missed/late/duplicated arming cannot double-trade:
the run-lock + `lastFiredDay` are two independent guards.

### 3. Trigger → `instrumentation.ts` (thin wiring, mirrors `scripts/trade-cron.ts`)

Next runs `instrumentation.ts`'s `register()` once on server boot.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;          // never the edge runtime
  if (process.env.TRADE_SCHEDULER_ENABLED !== "1") { console.log("[scheduler] disabled"); return; }
  const { startScheduler, buildSchedulerDeps, getSchedulerStatus } = await import("./lib/trade/scheduler-wiring");
  const deps = await buildSchedulerDeps(process.env);          // makeBroker(), resolveTradeConfig(), notifier, runOnce
  const { stop } = startScheduler(deps);
  for (const sig of ["SIGTERM","SIGINT"] as const) process.on(sig, stop);
  const s = getSchedulerStatus();
  console.log(`[scheduler] armed, broker=${s.broker}, next=${s.nextRunISO}`);
}
```

`lib/trade/scheduler-wiring.ts` builds `runOnce` = assemble `CronDeps` from
`lib/trade/runtime.ts` + `makeNotifier` and call `runCron` (byte-for-byte the same
dependency assembly `scripts/trade-cron.ts` does today). Keeping wiring out of
`instrumentation.ts` keeps the boot hook trivial and the logic in `lib/` (testable).

### 4. Status route → `app/api/trade/status/route.ts`

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";     // read fs each call, never cached
export async function GET(req: Request) {
  const token = process.env.TRADE_STATUS_TOKEN;
  if (!token) return Response.json({ error: "status route not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
  return Response.json(getSchedulerStatus());
}
```

Missing token env ⇒ 503 (never open by default). Reads the in-memory singleton +
`latestRunRecord()`; no trigger/control. Cheap because the scheduler runs in the same
process — the payoff of the in-process choice.

### 5. Deploy — `trader` image, compose, volume, env

**Dockerfile:** keep the existing lean `runner` (standalone) stage for anyone wanting
the secretless public-site-only image. Add a **`trader`** stage = full app:

```dockerfile
FROM node:24-alpine AS trader
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=deps /app/node_modules ./node_modules       # ALL deps incl. tsx (not --omit=dev) — CLI needs it
COPY . .                                                 # source: scripts/, lib/, package.json (the trade:* scripts)
RUN npm run build
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs \
 && mkdir -p data/trade && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]                                     # next start → instrumentation arms the scheduler
```

`docker exec -it juni npm run trade:reconcile` (etc.) now works because `scripts/` +
`tsx` + the `trade:*` scripts are present. (`output: "standalone"` stays in
`next.config.ts`; `next start` reads `.next` normally and the standalone artifact is
simply unused by this stage.)

> **Decision to confirm at review:** keep dev deps in the runtime image (simple, larger)
> vs. promote `tsx` to a production `dependency` and `npm ci --omit=dev` (leaner image,
> a `package.json` change). Recommend the former for v1 — it's a private single-tenant
> image and it keeps `next build` + the CLI trivially working.

**docker-compose.yml:** the deployed service targets `trader` and gains secrets +
persistence:

```yaml
services:
  web:
    build: { context: ., dockerfile: Dockerfile, target: trader }
    image: juniresearch-trader
    ports: ["58472:3000"]
    env_file: .env.local          # BROKER, APCA_*/SCHWAB_*, TRADE_SCHEDULER_ENABLED,
                                   # TRADE_STATUS_TOKEN, DISCORD_WEBHOOK_URL, TRADE_DISABLED?
    volumes:
      - ./data/trade:/app/data/trade   # fills.jsonl (append-only compliance ledger) + schwab-token.json persist here
    restart: unless-stopped            # pairs with catch-up-on-boot
```

The host `./data/trade` must be writable by uid 1001. `.dockerignore` already excludes
`data/trade` from the build context, so the volume — not the image — owns that state.

**Schwab auth in-container:** `docker exec -it juni npm run trade:auth` runs the
interactive OAuth; the token lands on the mounted volume and survives restarts. Re-run
weekly when the 7-day refresh token expires (the notifier already alerts on the failed
run). Documented in `README.Docker.md`.

### 6. Config / env summary (added to `.env.example`)

```bash
# TRADE_SCHEDULER_ENABLED=1   # arm the in-app 09:45 ET scheduler (separate from TRADE_DISABLED). Unset → inert.
# TRADE_STATUS_TOKEN=<secret> # bearer token for GET /api/trade/status. Unset → route returns 503.
```

`cronTimeET` continues to come from `resolveTradeConfig()` (default "09:45"), so the
in-app scheduler and the OS scripts read the same value.

## Testing

- `lib/trade/scheduler.ts` (pure, injected clock/timer — no real time/fs/network):
  - `nextRunAtET` across a **DST spring-forward and fall-back** boundary, and across a
    weekend/holiday (next fire skips to the next trading day).
  - `shouldCatchUp` truth table (fired-today × market-open).
  - `startScheduler`: catch-up path fires `runOnce` once and stamps state; armed path
    fires on timer and re-arms; `stop()` clears the timer; a double arming does not
    double-fire (state guard).
  - `SchedulerState` read/write round-trip (temp dir).
- `app/api/trade/status/route.ts`: no token → 503; wrong token → 401; correct token →
  200 with the `getSchedulerStatus()` shape.
- `instrumentation.ts`: smoke — `TRADE_SCHEDULER_ENABLED` unset ⇒ `startScheduler` not
  called; edge runtime ⇒ not called.
- `lib/trade/runtime.ts` extraction is covered by the existing cron/e2e suites (they
  import the same helpers); assert the full suite stays green.
- No live broker or Docker calls in the test suite; the Docker `trader` stage is
  validated by a one-time manual `docker build --target trader` + `docker exec` smoke
  during rollout.

## Rollout

1. Land the code behind `TRADE_SCHEDULER_ENABLED` (default off) — deploying is inert.
2. On Unraid, build the `trader` image; `docker exec` smoke: `trade:reconcile` (reads
   the broker), `trade:audit` — no scheduler armed yet.
3. Set `BROKER=alpaca-paper` + `TRADE_SCHEDULER_ENABLED=1`; observe ≥10 clean scheduled
   paper runs (catch-up + timed), status route + Discord summaries correct, zero
   lock/ban violations. This is Phase 1 of the trade-layer rollout gate, now driven
   in-app.
4. Only after the 4-week paper window (Phase 2) does `BROKER=schwab` get considered —
   preceded by an in-container `trade:auth`. Merge to `main` after that.
