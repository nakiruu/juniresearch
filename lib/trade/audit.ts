/**
 * audit.ts — the broker-truth cross-check (spec 2026-09-25-trade-broker-truth-audit).
 * Pure, no I/O. reconcile() (ledger.ts) proves the broker's POSITIONS are explained by
 * buy fills; this proves each ORDER's execution is faithfully recorded — or was rejected,
 * or never reached the broker. The caller fetches the day's broker orders and the run's
 * fills; this only compares them.
 *
 * Join keys: clientOrderId is deterministic per (run, ticker, side, day) and encodes the
 * runId, so it scopes broker orders to exactly this run. fills.jsonl stores the broker
 * orderId. Chain: expected.clientOrderId → brokerOrder(clientOrderId, id) → fill.orderId.
 */
import type { BrokerOrder } from "../broker/adapter";
import type { Fill } from "./fills";

export type AuditSeverity = "critical" | "warn";
export type DiscrepancyCode =
  | "UNRECORDED_FILL"    // broker executed qty>0 but no matching fills.jsonl entry — under-sets locks/ledger
  | "ORPHAN_FILL"        // fills.jsonl entry with no matching broker order in this run
  | "QTY_MISMATCH"       // recorded qty ≠ broker filledQty
  | "PRICE_MISMATCH"     // recorded avg price ≠ broker filledAvgPrice beyond eps
  | "REJECTED"           // broker refused the order (buying-power, wash-trade, …)
  | "MISSING_SUBMISSION"; // expected order not present at the broker

export interface Discrepancy {
  code: DiscrepancyCode; severity: AuditSeverity; ticker: string;
  clientOrderId?: string; orderId?: string; detail: string;
}
export interface AuditResult {
  ok: boolean; critical: number; warn: number; discrepancies: Discrepancy[];
  checked: { expected: number; brokerMatched: number; fills: number };
}

const QTY_EPS = 1e-6;

export function crossCheckBroker(input: {
  expected: { clientOrderId: string; ticker: string; side: "buy" | "sell" }[];
  brokerOrders: BrokerOrder[];
  fills: Fill[]; // caller pre-filters to this run's runId
  priceEps?: number;
}): AuditResult {
  const { expected, brokerOrders, fills } = input;
  const d: Discrepancy[] = [];

  const expectedByCid = new Map(expected.map((e) => [e.clientOrderId, e]));
  // Scope broker orders to THIS run — a foreign clientOrderId (another run, a manual order)
  // is not this run's business and would be a false positive.
  const scoped = brokerOrders.filter((o) => expectedByCid.has(o.clientOrderId));
  const scopedIds = new Set(scoped.map((o) => o.id));
  const brokerByCid = new Map(scoped.map((o) => [o.clientOrderId, o]));

  const fillsByOrderId = new Map<string, Fill[]>();
  for (const f of fills) {
    const arr = fillsByOrderId.get(f.orderId);
    if (arr) arr.push(f); else fillsByOrderId.set(f.orderId, [f]);
  }

  let brokerMatched = 0;
  for (const e of expected) {
    const o = brokerByCid.get(e.clientOrderId);
    if (!o) {
      d.push({ code: "MISSING_SUBMISSION", severity: "warn", ticker: e.ticker, clientOrderId: e.clientOrderId, detail: "expected order not found at the broker" });
      continue;
    }
    brokerMatched++;
    if (o.status === "rejected") {
      d.push({ code: "REJECTED", severity: "warn", ticker: e.ticker, clientOrderId: e.clientOrderId, orderId: o.id, detail: "broker rejected the order" });
      continue; // a rejected order carries filledQty 0
    }
    const executedQty = o.filledQty;
    if (executedQty <= QTY_EPS) continue; // legitimately unfilled (IOC canceled / expired)
    const recs = fillsByOrderId.get(o.id) ?? [];
    if (recs.length === 0) {
      d.push({ code: "UNRECORDED_FILL", severity: "critical", ticker: e.ticker, clientOrderId: e.clientOrderId, orderId: o.id, detail: `broker filled ${executedQty} but no fill recorded — lock/ledger under-set` });
      continue;
    }
    const recordedQty = recs.reduce((a, f) => a + f.qty, 0);
    if (Math.abs(recordedQty - executedQty) > QTY_EPS) {
      d.push({ code: "QTY_MISMATCH", severity: "critical", ticker: e.ticker, clientOrderId: e.clientOrderId, orderId: o.id, detail: `recorded qty ${recordedQty} ≠ broker filledQty ${executedQty}` });
      continue;
    }
    if (o.filledAvgPrice != null) {
      const eps = input.priceEps ?? Math.max(0.01, 0.001 * o.filledAvgPrice);
      const recordedAvg = recs.reduce((a, f) => a + f.qty * f.price, 0) / recordedQty;
      if (Math.abs(recordedAvg - o.filledAvgPrice) > eps) {
        d.push({ code: "PRICE_MISMATCH", severity: "warn", ticker: e.ticker, clientOrderId: e.clientOrderId, orderId: o.id, detail: `recorded avg $${recordedAvg.toFixed(4)} ≠ broker $${o.filledAvgPrice.toFixed(4)} (eps $${eps.toFixed(4)})` });
      }
    }
  }

  // Orphan fills: a recorded fill (already scoped to the run by the caller) whose orderId is
  // not one of this run's broker orders — the fill references something the broker didn't do.
  for (const f of fills) {
    if (!scopedIds.has(f.orderId)) {
      d.push({ code: "ORPHAN_FILL", severity: "critical", ticker: f.ticker, orderId: f.orderId, detail: "recorded fill has no matching broker order in this run" });
    }
  }

  const critical = d.filter((x) => x.severity === "critical").length;
  return { ok: critical === 0, critical, warn: d.length - critical, discrepancies: d, checked: { expected: expected.length, brokerMatched, fills: fills.length } };
}
