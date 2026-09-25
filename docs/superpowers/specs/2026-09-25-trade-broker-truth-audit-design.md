# Broker-Truth Cross-Check + Run-Record Observability — Design

**Branch:** `trade-layer` (unmerged, Phase-1 gated). **Date:** 2026-09-25.

## Motivation

The first unattended paper run (`2026-09-25-3d5ce0f3`) was audited. Every check
that reads only local artifacts (`fills.jsonl`, the run record) passed — but
**nothing confirms Alpaca actually executed what `fills.jsonl` records.**
`reconcile()` (`lib/trade/ledger.ts`) cross-checks broker *positions* against
*buy fills* only (the unexplained-position halt); it never inspects the day's
**orders**. So these would all go uncaught:

- an order the broker **rejected** (buying-power, wash-trade, etc.);
- a **partial fill** whose recorded qty/price differs from the broker's;
- an **orphan fill** in `fills.jsonl` with no matching broker execution;
- a fill the poll loop **failed to record** (crash / 60-poll timeout) —
  which silently under-sets the whole-ticker lock clock.

This is the deferred Phase-2 item #1 ("make reconcile fetch `getOrders` and halt
on any executed order absent from `fills.jsonl`"). The audit also showed the run
record omits fields that would make each run self-auditing: broker **order
status**, **sector** (needed a snapshot join), and **submit timestamps**.

`getOrders(status, after?)` already exists on the adapter and returns full
status / `filledQty` / `filledAvgPrice` / `submittedAt` (the fill-poll loop uses
it). So the work is a cross-check layer + observability fields, not new broker
plumbing.

## Goals

1. A **pure** broker-truth cross-check comparing the run's broker orders against
   `fills.jsonl` and the run record's expected orders.
2. Surface it read-only as **`trade:audit`** (exit non-zero on any critical
   discrepancy), and enforce it as a **fail-loud post-execute gate** in
   `trade:execute` and `trade:cron`.
3. Persist **broker status, broker id, submit timestamp, and sector** onto each
   run-record order.

## Non-goals

- Do **not** change `reconcile()`'s position→ledger semantics (kept a pure
  derive; the order-level truth is a distinct concern living in `audit.ts`).
- Do **not** change execution behavior (IOC / limits / sizing) — audit only.
- Do **not** auto-repair discrepancies — fail loud; the operator appends the
  missing fill or investigates the reject.
- No tolerance/τ recalibration (that waits for more run data).

## Design

### 1. Core — `lib/trade/audit.ts` (pure, no I/O)

```ts
export type AuditSeverity = "critical" | "warn";
export type DiscrepancyCode =
  | "UNRECORDED_FILL"   // broker executed qty>0 but no matching fills.jsonl entry — critical
  | "ORPHAN_FILL"       // fills.jsonl entry with no matching broker execution — critical
  | "QTY_MISMATCH"      // recorded qty ≠ broker filledQty — critical
  | "PRICE_MISMATCH"    // recorded price ≠ broker filledAvgPrice beyond eps — warn
  | "REJECTED"          // broker status "rejected" — warn (order refused; surface why)
  | "MISSING_SUBMISSION"; // expected order absent from the broker — warn
export interface Discrepancy {
  code: DiscrepancyCode; severity: AuditSeverity; ticker: string;
  clientOrderId?: string; orderId?: string; detail: string;
}
export interface AuditResult {
  ok: boolean; critical: number; warn: number; discrepancies: Discrepancy[];
  checked: { expected: number; brokerMatched: number; fills: number };
}
export function crossCheckBroker(input: {
  expected: { clientOrderId: string; ticker: string; side: "buy" | "sell" }[];
  brokerOrders: BrokerOrder[];
  fills: Fill[];              // caller pre-filters to this run's runId
  priceEps?: number;         // default 0.01 (1 cent) OR 0.1% of price, whichever larger
}): AuditResult;
```

**Join keys.** `clientOrderId` is deterministic per (run, ticker, side, day) and
encodes the runId, so it scopes cleanly to the run. `fills.jsonl` stores the
broker `orderId`. Chain: `expected.clientOrderId → brokerOrder(clientOrderId,
id) → fill.orderId`.

**Algorithm.**
- `scoped = brokerOrders.filter(o => expected has o.clientOrderId)` — exactly
  this run's broker orders (other runs' same-day orders have different
  clientOrderIds and are ignored).
- For each `expected` order:
  - no matching broker order → `MISSING_SUBMISSION` (warn).
  - broker `status === "rejected"` → `REJECTED` (warn).
  - `executedQty = broker.filledQty`; if `> 0`:
    - fills with `orderId === broker.id`; sum recorded qty.
    - none → `UNRECORDED_FILL` (critical);
    - else `|recordedQty − executedQty| > 1e-6` → `QTY_MISMATCH` (critical);
    - else broker `filledAvgPrice != null` and `|recordedPrice − filledAvgPrice|
      > eps` → `PRICE_MISMATCH` (warn).
- For each `fill` (already scoped to the run by the caller) whose `orderId` is
  not a scoped broker order id → `ORPHAN_FILL` (critical).
- `ok = critical === 0`.

`UNEXPECTED_ORDER` is intentionally omitted from v1: per-run scoping would make
another same-day run's orders look "unexpected," a false positive. Orphan-fill
detection already covers the recording side.

### 2. Observability — run-record order fields

- **sector:** add `sector: string` to `OrderRequest` (`lib/trade/orders.ts`);
  set from `t.sector` in `common`. `planRun` already writes `sized.orders` into
  `record.orders`, so sector then persists automatically. EXIT/TRIM sells carry
  it too.
- **status / brokerId / submittedAt:** `executeOrders` currently returns only
  `Fill[]` and discards the terminal `BrokerOrder`. Change its return to
  `{ fills: Fill[]; executed: ExecutedOrder[] }` where
  `ExecutedOrder = { clientOrderId; brokerId: string; status: BrokerOrderStatus;
  filledQty: number; filledAvgPrice: number | null; submittedAt: string | null }`.
  `trade:execute` and `trade:cron` merge `executed[]` onto `record.orders`
  (match by `clientOrderId`) before `writeRunRecord`. `RunRecord.orders` is a
  loose record — no schema change.
- Both call sites of `executeOrders` (`scripts/trade-execute.ts`,
  `lib/trade/cron.ts`) are updated for the new return shape.

### 3. `scripts/trade-audit.ts` (read-only)

- Args: `[--run <runId>] [--date <YYYY-MM-DD>]`; default = latest run record in
  `RUNS_DIR` (helper `readRunRecord`/`latestRunRecord` in `_trade-common.ts` —
  extract if `trade-review.ts` already has one, else add).
- `expected = record.orders.map(o => ({ clientOrderId, ticker, side }))`.
- `fills = readFills(FILLS_PATH).filter(f => f.runId === record.runId)`.
- `brokerOrders = makeAlpaca().getOrders("all", `${record.today}T00:00:00Z`)`;
  if the adapter ignores `after`, filter locally by `submittedAt >= record.today`.
- `crossCheckBroker(...)`; print a per-discrepancy table + a summary line;
  **exit 1 on any critical**, else 0 (warnings print but don't fail).
- Never writes. Requires Alpaca keys (paper); refuses cleanly if absent.

### 4. Fail-loud post-execute gate

- `trade:execute`: after `writeRunRecord`, fetch broker orders and run
  `crossCheckBroker`. On any critical → print loudly and `process.exit(1)`
  (fills are already recorded; this is an alert, not a rollback). Warnings print.
- `trade:cron`: same check as a post-execute step; on critical →
  `notify(...)` + log + return a halted/non-zero result, consistent with the
  other cron breakers.

## Testing

- **`audit.test.ts` (exhaustive, pure):** clean run (all matched, `ok`);
  UNRECORDED_FILL; ORPHAN_FILL; QTY_MISMATCH; PRICE_MISMATCH within/outside eps;
  REJECTED; MISSING_SUBMISSION; partial fill recorded correctly (no
  discrepancy); cross-run scoping (another run's broker orders ignored);
  empty run (no orders, no fills → ok).
- **orders/pipeline:** `OrderRequest` carries sector; `executeOrders` returns
  `{ fills, executed }` with terminal status; existing fixtures updated.
- **Integration (fake broker):** a run with one full fill, one zero-fill
  (canceled), and one hand-injected orphan fill → cross-check flags exactly the
  orphan as critical; a clean run passes. Post-execute gate exits non-zero when
  a critical is present.

## Files

- Create: `lib/trade/audit.ts`, `lib/trade/audit.test.ts`,
  `scripts/trade-audit.ts`.
- Modify: `lib/trade/orders.ts` (sector), `lib/trade/pipeline.ts`
  (`executeOrders` return), `scripts/trade-execute.ts` (merge + gate),
  `lib/trade/cron.ts` (merge + gate), `scripts/_trade-common.ts`
  (`readRunRecord` helper), `package.json` (`trade:audit`).

## Rollout / gating

Unchanged: `trade-layer` stays unmerged behind the Phase-1 paper smoke + Phase-2
4-weeks-clean gate. This work makes the smoke test *self-verifying* against the
broker — run `trade:audit` after each paper run; a clean audit is part of the
"exact reconciliation" §11 criterion.
