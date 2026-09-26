# Discord Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Executed **inline (TDD)** this session. Steps use checkbox syntax.

**Goal:** A best-effort Discord webhook notifier that posts run summaries (orders, fills, goal book, cash, audit) and halt/auth alerts from the scheduled trade paths.

**Architecture:** Pure formatting + a thin never-throwing transport in `lib/trade/notify.ts`, injected into `runCron` (optional dep) and used directly by `trade:execute`. No decision-logic change.

**Tech Stack:** TypeScript, Node, vitest, native fetch (injectable). Branch `trade-layer`.

**Spec:** `docs/superpowers/specs/2026-09-25-discord-notifier-design.md`

## Global Constraints

- TDD; whole suite stays green (baseline 1086), `tsc`+`eslint` clean.
- The notifier NEVER throws / never fails a trade run (best-effort; Discord outage is logged).
- No webhook configured → log-only, behavior byte-identical to today.
- `CronResult` unchanged (avoid cron-test churn); `notifySummary` is an optional dep.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS`.

---

### Task 1: `lib/trade/notify.ts` (pure formatting + transport + notifier)

**Files:** Create `lib/trade/notify.ts`, `lib/trade/notify.test.ts`.

**Interfaces:** `DiscordPayload`, `RunSummaryInput`, `TradeNotifier`, and `goalBook`, `summaryFromRun`, `runEmbed`, `alertEmbed`, `postDiscord`, `makeNotifier` (exact signatures in spec §Design).

- [ ] Step 1: Tests — `goalBook` (ENTER/ADD replace, EXIT removes, sorted desc); `runEmbed` color by status + audit-critical, truncates >15 orders/holdings with "+N more", stays within field limits; `alertEmbed`; `postDiscord` (200 one call; 429 → one retry using `retry_after`; network error → resolves, no throw); `makeNotifier` no-webhook → 0 POSTs + `flush()` resolves, with-webhook → `message`/`runSummary` enqueue and `flush()` awaits. Run→fail.
- [ ] Step 2: Implement. `postDiscord` wraps fetch in try/catch (never throws); `makeNotifier` keeps a pending-promise array, `onLog` runs synchronously. `summaryFromRun` uses `weightsOf(out.ledger)` + `goalBook`. Run→pass.
- [ ] Step 3: `tsc`+`eslint` clean. Commit `feat(trade): Discord notifier — run summaries + alerts (best-effort webhook)`.

### Task 2: Wire into runCron + scripts + env

**Files:** Modify `lib/trade/cron.ts` (+`cron.test.ts`), `scripts/trade-cron.ts`, `scripts/trade-execute.ts`, `.env.example`.

**Interfaces:** `CronDeps.notifySummary?: (s: RunSummaryInput) => void`; called on executed + noop with `summaryFromRun(...)`.

- [ ] Step 1: `cron.test.ts` — a captured-`notifySummary` receives one summary on an executed run whose `orders`/`fills` match; existing tests (no `notifySummary`) unchanged. Run→fail (dep not wired).
- [ ] Step 2: Add optional `notifySummary` to `CronDeps`; call `deps.notifySummary?.(summaryFromRun(out, "executed", fills, audit))` on the executed path and `...(out, "noop", [])` on the noop path. Run→pass.
- [ ] Step 3: `scripts/trade-cron.ts` — build the notifier (webhook from env, `onLog` = the existing cron.log+stderr writer), pass `notify`/`notifySummary`, `await notifier.flush()` before the exit-code mapping. `scripts/trade-execute.ts` — notifier for the summary + auth/failure alerts + `flush()` before exit. `.env.example` — `DISCORD_WEBHOOK_URL`.
- [ ] Step 4: Full suite green; `tsc`+`eslint` clean. Commit `feat(trade): post Discord run summaries + alerts from cron/execute`.

## Self-Review

- Spec coverage: module → T1; wiring/env → T2; heartbeat (noop) → T2; never-throw → T1 tests. Covered.
- No-webhook path preserves current behavior (T1 log-only test). `CronResult` untouched. Types (`RunSummaryInput`) consistent across notify.ts, cron.ts, trade-execute.ts.
