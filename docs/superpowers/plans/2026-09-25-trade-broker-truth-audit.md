# Broker-Truth Cross-Check + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Executed **inline (TDD)** this session by the controller who holds full context. Steps use checkbox syntax.

**Goal:** Add a pure broker-truth cross-check (broker orders vs `fills.jsonl` vs the run record), surfaced as read-only `trade:audit` and a fail-loud post-execute gate, plus persist broker status / id / submit timestamp / sector onto each run-record order.

**Architecture:** Pure core in `lib/trade/audit.ts` (no I/O), consumed by a read-only script and by the two execute paths. `getOrders` already exists on the adapter; `RunRecord.orders/fills` are loose records so new fields need no schema migration.

**Tech Stack:** TypeScript, Node, vitest, zod. Branch `trade-layer`.

**Spec:** `docs/superpowers/specs/2026-09-25-trade-broker-truth-audit-design.md`

## Global Constraints

- TDD: failing test first, minimal impl, green, commit.
- **No change** to sizing/execution behavior or to `reconcile()` position→ledger semantics. Audit is read-only/additive.
- Keep the whole suite green (baseline 1044 tests), `tsc` + `eslint` clean.
- Paper-only; never add a live path. Never relax ICE ban or lock rules.
- Commit footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS`.

---

### Task 1: Pure cross-check core

**Files:** Create `lib/trade/audit.ts`, `lib/trade/audit.test.ts`.

**Interfaces:**
- Consumes: `BrokerOrder` (`lib/broker/adapter.ts`), `Fill` (`lib/trade/fills.ts`).
- Produces: `crossCheckBroker(input) → AuditResult`, types `Discrepancy`, `DiscrepancyCode`, `AuditSeverity`, `AuditResult` (exact shapes in the spec §1).

- [ ] **Step 1:** Write `audit.test.ts` covering: clean run (ok, 0 discrepancies); `UNRECORDED_FILL` (broker filledQty>0, no fill); `ORPHAN_FILL` (fill with no broker id); `QTY_MISMATCH`; `PRICE_MISMATCH` in-eps (no flag) vs out-of-eps (warn); `REJECTED`; `MISSING_SUBMISSION`; correct partial fill (no flag); cross-run scoping (foreign clientOrderId ignored); empty run.
- [ ] **Step 2:** Run — expect fail (module missing).
- [ ] **Step 3:** Implement `crossCheckBroker` per spec §1 (scope by clientOrderId; join fills by `orderId`; `priceEps = max(0.01, 0.001*price)`; `ok = critical===0`).
- [ ] **Step 4:** Run — green.
- [ ] **Step 5:** Commit `feat(trade): pure broker-truth cross-check (audit.ts)`.

### Task 2: Observability — sector + executeOrders terminal status

**Files:** Modify `lib/trade/orders.ts` (+ `orders.test.ts`), `lib/trade/pipeline.ts` (+ `pipeline.test.ts`), `scripts/trade-execute.ts`, `lib/trade/cron.ts` (+ `cron.test.ts`).

**Interfaces:**
- `OrderRequest` gains `sector: string` (set from `t.sector` in `common`).
- `executeOrders(...)` returns `{ fills: Fill[]; executed: ExecutedOrder[] }` where `ExecutedOrder = { clientOrderId: string; brokerId: string; status: BrokerOrderStatus; filledQty: number; filledAvgPrice: number | null; submittedAt: string | null }`.
- Both call sites merge `executed` onto `record.orders` by `clientOrderId` (adds `status`, `brokerId`, `submittedAt`).

- [ ] **Step 1:** Update `orders.test.ts` to assert emitted orders carry `sector`; add `sector` to `OrderRequest` + `common` in `orders.ts`. Run green.
- [ ] **Step 2:** Update `pipeline.test.ts` for the new `executeOrders` return; change `executeOrders` to collect the terminal `BrokerOrder` per order into `executed[]` alongside `fills[]`; return `{ fills, executed }`.
- [ ] **Step 3:** Update `scripts/trade-execute.ts` and `lib/trade/cron.ts` to the new return shape and merge `executed` onto `record.orders` before `writeRunRecord`. Fix `cron.test.ts` expectations.
- [ ] **Step 4:** Full suite green; `tsc`+`eslint` clean.
- [ ] **Step 5:** Commit `feat(trade): persist sector + broker status/id/submittedAt on run-record orders`.

### Task 3: `trade:audit` read-only script

**Files:** Modify `scripts/_trade-common.ts` (add `readRunRecord` / `latestRunRecord`), create `scripts/trade-audit.ts`, modify `package.json` (`"trade:audit"`).

**Interfaces:**
- Consumes: `crossCheckBroker` (Task 1), `readFills`, `makeAlpaca`, `RUNS_DIR` (`_trade-common`).
- CLI: `[--run <id>] [--date <YYYY-MM-DD>]`, default latest run record.

- [ ] **Step 1:** Add `latestRunRecord()` / `readRunRecord(runId)` to `_trade-common.ts` (reuse `trade-review.ts`'s reader if present — extract to shared). Small unit test if a reader is extracted.
- [ ] **Step 2:** Write `scripts/trade-audit.ts`: load run record → `expected` from `record.orders` → fills filtered to `record.runId` → `getOrders("all", `${today}T00:00:00Z`)` (fallback: local `submittedAt` filter) → `crossCheckBroker` → print table + summary → `exit(1)` on any critical.
- [ ] **Step 3:** Add `"trade:audit": "tsx scripts/trade-audit.ts"` to `package.json` (match the existing trade:* script runner).
- [ ] **Step 4:** `tsc`+`eslint` clean; suite green.
- [ ] **Step 5:** Commit `feat(trade): trade:audit read-only broker-truth cross-check script`.

### Task 4: Fail-loud post-execute gate + integration test

**Files:** Modify `scripts/trade-execute.ts`, `lib/trade/cron.ts`; add an integration test (`lib/trade/audit.integration.test.ts` or extend `phase2-e2e.test.ts`).

**Interfaces:**
- Consumes: `crossCheckBroker`, `executeOrders` result, `getOrders`.

- [ ] **Step 1:** Write an integration test with `FakeBroker`: a run with one full fill + one zero-fill (canceled) → clean audit (`ok`); then hand-inject an orphan `Fill` → cross-check reports exactly one critical `ORPHAN_FILL`.
- [ ] **Step 2:** In `trade-execute.ts`, after `writeRunRecord`: fetch broker orders, `crossCheckBroker(expected=sized.orders, brokerOrders, fills)`; print discrepancies; `process.exit(1)` on any critical.
- [ ] **Step 3:** In `cron.ts`, add the same post-execute check; on critical → `notify` + log + halted/non-zero result (consistent with other breakers). Extend `cron.test.ts`.
- [ ] **Step 4:** Full suite green; `tsc`+`eslint` clean.
- [ ] **Step 5:** Commit `feat(trade): fail-loud post-execute broker-truth gate in execute + cron`.

## Self-Review

- Spec coverage: §1 core → Task 1; §2 observability → Task 2; §3 script → Task 3; §4 gate → Task 4. All covered.
- No placeholders; interfaces (`ExecutedOrder`, `OrderRequest.sector`, `AuditResult`) named consistently across tasks.
- Behavior guarantee: nothing alters sizing/limit/IOC logic or `reconcile()`; the fake's `getOrders` already returns the statuses Task 1/4 assert on.
