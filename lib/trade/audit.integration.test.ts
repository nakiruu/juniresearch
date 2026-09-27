import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeBroker } from "../broker/fake";
import type { GuardContext } from "../broker/guards";
import { resolveTradeConfig } from "./config";
import { executeOrders } from "./pipeline";
import { crossCheckBroker } from "./audit";
import type { OrderRequest, SizedOrders } from "./orders";
import type { Fill } from "./fills";

const TODAY = "2026-09-25";
const cfg = resolveTradeConfig();

const order = (o: Partial<OrderRequest> & { ticker: string; clientOrderId: string; limitPrice: number }): OrderRequest => ({
  sector: "35", side: "buy", kind: "qty", qty: 1, timeInForce: "ioc", tier: 1, capBound: false,
  anchorReason: "ok", reason: "ENTER", deltaUsd: 100, estCostUsd: 0.1, bucket: "large", ...o,
});

describe("broker-truth cross-check over real executeOrders output", () => {
  // AAA's IOC limit ($105) is marketable at the $100 close → fills; BBB's ($95) is not → canceled, zero fill.
  const broker = () => new FakeBroker({ calendar: [], closes: { AAA: { [TODAY]: 100 }, BBB: { [TODAY]: 100 } }, equity: 10_000, cash: 10_000, isOpen: true, today: TODAY });
  const sized: SizedOrders = {
    orders: [order({ ticker: "AAA", clientOrderId: "cA", limitPrice: 105 }), order({ ticker: "BBB", clientOrderId: "cB", limitPrice: 95 })],
    skippedDust: [], skippedHalt: [],
  };
  const ctx = (nav: number): GuardContext => ({ brokerKind: "fake", configuredBaseUrl: "memory://", locks: { buyLockUntil: {}, sellLockUntil: {} }, today: TODAY, nav, cashUsd: nav, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } });

  it("a filled order + a canceled zero-fill reconcile clean against the broker", async () => {
    const b = broker();
    const fillsPath = join(mkdtempSync(join(tmpdir(), "audit-")), "fills.jsonl");
    const { fills, executed } = await executeOrders({ adapter: b, sized, ctx: ctx(10_000), runId: "r1", fillsPath, pollMs: 0 });
    expect(fills).toHaveLength(1);                                   // AAA filled
    expect(executed.map((e) => e.status).sort()).toEqual(["canceled", "filled"]);

    const r = crossCheckBroker({
      expected: sized.orders.map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side })),
      brokerOrders: await b.getOrders("all"),
      fills,
    });
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.checked).toEqual({ expected: 2, brokerMatched: 2, fills: 1 });
  });

  it("an orphan fill (no matching broker order) is flagged critical", async () => {
    const b = broker();
    const fillsPath = join(mkdtempSync(join(tmpdir(), "audit-")), "fills.jsonl");
    const { fills } = await executeOrders({ adapter: b, sized, ctx: ctx(10_000), runId: "r1", fillsPath, pollMs: 0 });
    const orphan: Fill = { ticker: "ZZZ", side: "buy", qty: 5, price: 10, filledAt: `${TODAY}T15:30:00Z`, tradingDate: TODAY, orderId: "ghost-1", runId: "r1" };

    const r = crossCheckBroker({
      expected: sized.orders.map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side })),
      brokerOrders: await b.getOrders("all"),
      fills: [...fills, orphan],
    });
    expect(r.ok).toBe(false);
    expect(r.critical).toBe(1);
    expect(r.discrepancies).toEqual([expect.objectContaining({ code: "ORPHAN_FILL", severity: "critical", ticker: "ZZZ", orderId: "ghost-1" })]);
  });
});
