# Discord Notifier — Design

**Branch:** `trade-layer` (unmerged, gated). **Date:** 2026-09-25.

## Motivation

The trade layer runs unattended (Alpaca paper today, Schwab live soon). `notify()`
currently only writes a log line + stderr, so an unattended halt (weekly Schwab
re-auth, a breaker, a broker-mismatch) is invisible until someone reads a file —
which defeats the "I can't watch it intraday" goal. Nico wants a **Discord**
channel that reports not just halts but the whole run: **orders, fills, the goal
(target) portfolio, cash/NAV, and the broker-truth audit result** — "anything I'd
like to know."

## Goals

1. A pluggable Discord notifier (incoming webhook via `DISCORD_WEBHOOK_URL`) that
   never fails a trade run (best-effort; a Discord outage is logged, not thrown).
2. Two message shapes: **alerts** (halts/auth/errors — plain, red) and **run
   summaries** (rich embed: status, orders, fills, goal book, cash, audit).
3. Emitted from both scheduled paths (`trade:cron`, `trade:execute`); a daily
   `noop` run still posts a short heartbeat so Nico knows it ran.
4. No webhook configured → log-only (today's behavior, byte-identical).

## Non-goals

- No change to the pure core's decision logic. The notifier is injected (like the
  existing `notify`); `runCron` gains one optional dep, no new required behavior.
- Not a two-way bot (no commands from Discord) — outbound telemetry only.
- Data goes only to Nico's own configured webhook.

## Design

### Module `lib/trade/notify.ts` (pure formatting + thin transport)

```ts
export interface DiscordPayload { content?: string; embeds?: unknown[] }
export interface RunSummaryInput {
  today: string; runId: string; broker: string; status: string; // executed | noop | plan
  nav: number; cash: number;
  goal: { ticker: string; weight: number }[];   // the intended resulting book
  orders: { ticker: string; side: string; qty: number; limitPrice: number; reason: string }[];
  fills: { ticker: string; qty: number; price: number }[];
  skipped: { ticker: string; reason: string }[];
  audit?: { ok: boolean; critical: number; warn: number };
}
export interface TradeNotifier { message(text: string): void; runSummary(s: RunSummaryInput): void; flush(): Promise<void> }

export function goalBook(currentWeights: Record<string, number>, trades: { ticker: string; reason: string; targetWeight: number }[]): { ticker: string; weight: number }[];
export function summaryFromRun(out: PlanRunOutput, status: string, fills: Fill[], audit?: AuditResult): RunSummaryInput;
export function runEmbed(s: RunSummaryInput): DiscordPayload;   // pure
export function alertEmbed(text: string): DiscordPayload;       // pure
export async function postDiscord(url: string, payload: DiscordPayload, fetchImpl?: typeof fetch): Promise<void>; // never throws
export function makeNotifier(opts: { webhookUrl?: string; onLog?: (line: string) => void; fetchImpl?: typeof fetch }): TradeNotifier;
```

- **`goalBook`** — the intended book after the run: start from current weights, apply
  each trade (ENTER/ADD/TRIM → `targetWeight`, EXIT → remove), sort desc. This is the
  "goal portfolio."
- **`summaryFromRun`** — pure adapter from a `PlanRunOutput` (+ fills + audit) to
  `RunSummaryInput`; used by both `runCron` and `trade:execute` so the shape is
  identical. `goal` from `goalBook(weightsOf(out.ledger), out.plan.trades)`; `orders`
  from `out.sized.orders`; `skipped` merges `skippedHalt` + `skippedDust`.
- **`runEmbed`** — a Discord embed: title `"{status} · {broker} · {today}"`, color
  green (executed clean) / yellow (warnings or noop) / red (audit critical);
  fields for Cash/NAV (+deployed %), Orders (code block, top ~15 + "+N more"),
  Fills, Goal book (top ~15), Skips, Audit line. Respects Discord limits (field
  value ≤ 1024 chars, ≤ 25 fields, embed ≤ 6000; truncate with a "+N more" tail).
- **`alertEmbed`** — a red embed / plain content for a one-line halt or error.
- **`postDiscord`** — POST JSON; on 429 read `retry_after` and retry once; any
  failure is caught and swallowed (logged via console.error) — the notifier must
  never break a run.
- **`makeNotifier`** — `message`/`runSummary` run `onLog(...)` synchronously
  (preserving the cron.log + stderr behavior) and, if `webhookUrl` is set, enqueue
  the POST promise; `flush()` awaits `Promise.allSettled` of the queue. No webhook
  → enqueue nothing (log-only).

### Wiring

- **`runCron` (lib/trade/cron.ts):** add optional `deps.notifySummary?: (s: RunSummaryInput) => void`. Call it on the **executed** and **noop** paths with `summaryFromRun(out, status, fills?, audit?)`. `CronResult` is unchanged (no test churn); existing tests that omit `notifySummary` are unaffected.
- **`scripts/trade-cron.ts`:** `const notifier = makeNotifier({ webhookUrl: process.env.DISCORD_WEBHOOK_URL, onLog: appendToCronLogAndStderr })`; `notify: notifier.message`, `notifySummary: notifier.runSummary`; `await notifier.flush()` before mapping the exit code (so POSTs complete before `process.exit`).
- **`scripts/trade-execute.ts`:** build `summaryFromRun(out, "executed", fills, audit)` after the run and `notifier.runSummary(...)`; use `notifier.message(...)` on the auth/failure branches; `await notifier.flush()` before exit.
- **`_env` / `.env.example`:** document `DISCORD_WEBHOOK_URL` (a secret; lives in `.env.local`). No `.gitignore` change (`.env.*` already ignored).

## Testing

- `notify.test.ts` (pure + mock fetch): `goalBook` applies ENTER/ADD/TRIM/EXIT and sorts; `runEmbed` colors by status/audit and truncates long lists; `alertEmbed` shape; `postDiscord` posts once on 200, retries once on 429 then gives up, and **never throws** on a network error; `makeNotifier` with no webhook makes zero POSTs (log-only) and `flush()` resolves; with a webhook, `message`/`runSummary` enqueue and `flush()` awaits them.
- `cron.test.ts`: an executed run calls `notifySummary` once with a summary whose orders/fills match; a run with no `notifySummary` dep still behaves identically (regression).
- Full suite green; `tsc` + `eslint` clean.

## Files

- Create: `lib/trade/notify.ts`, `lib/trade/notify.test.ts`.
- Modify: `lib/trade/cron.ts` (+`cron.test.ts`), `scripts/trade-cron.ts`, `scripts/trade-execute.ts`, `.env.example`.

## Rollout

`trade-layer` stays unmerged/gated. Nico adds `DISCORD_WEBHOOK_URL` (a channel
webhook) to `.env.local`; every run then posts to that channel. Absent the var,
behavior is unchanged.
