import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile, weightsOf, positionsOf, readLedger, writeLedger, ReconcileError } from "./ledger";
import type { Fill } from "./fills";

const buy = (ticker: string): Fill => ({ ticker, side: "buy", qty: 1, price: 1, filledAt: "2026-09-21T15:00:00Z", tradingDate: "2026-09-21", orderId: "o", runId: "r" });
const acct = { equity: 100_000, cash: 20_000 };
const pos = (symbol: string, qty: number, marketValue: number) => ({ symbol, qty, marketValue, avgEntryPrice: marketValue / qty });

describe("reconcile", () => {
  it("builds the ledger from broker account + positions and derives weights", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000), pos("MP", 600, 30_000)], fills: [buy("NVT"), buy("MP")] });
    expect(l.nav).toBe(100_000);
    expect(weightsOf(l)).toEqual({ NVT: 0.5, MP: 0.3 });
    expect(positionsOf(l)).toEqual({ NVT: { qty: 100, marketValue: 50_000 }, MP: { qty: 600, marketValue: 30_000 } });
  });
  it("halts on a broker position the fills log cannot explain", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [] }))
      .toThrow(ReconcileError);
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [] }))
      .toThrow(/NVT.*no buy fill/);
  });
  it("accepts an empty book and drops zero-qty positions", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("X", 0, 0)], fills: [] });
    expect(l.positions).toEqual([]);
  });
  it("drops a negative-qty broker position just like a zero-qty one", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("X", -5, -100)], fills: [] });
    expect(l.positions).toEqual([]);
  });
  it("rejects a non-positive equity", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: { equity: 0, cash: 0 }, positions: [], fills: [] })).toThrow(ReconcileError);
  });
});

describe("ledger file", () => {
  it("round-trips through disk and reads null when absent", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "sub", "ledger.json");
    expect(readLedger(p)).toBeNull();
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [buy("NVT")] });
    writeLedger(p, l);
    expect(readLedger(p)).toEqual(l);
  });
});
