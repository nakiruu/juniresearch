import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun, executeOrders } from "./pipeline";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig } from "./config";
import { readFills } from "./fills";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { GuardContext } from "../broker/guards";

const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((date) => ({ date, open: "09:30", close: "16:00" }));
const closes = (p: number) => Object.fromEntries(CAL.map((d) => [d.date, p]));
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 });
const nvt = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] }); // at 100: mu +21%, R 1.05

describe("planRun", () => {
  it("marks at the previous settled close, reconciles an empty book, and plans an ENTER", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: { ...closes(100), "2026-09-25": 999 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    expect(out.markDate).toBe("2026-09-24");
    expect(out.marks).toEqual({ NVT: 100 });                       // not the 999 intraday print
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "ENTER" })]);
    expect(out.sized.orders).toEqual([expect.objectContaining({ ticker: "NVT", kind: "notional", notional: 9_900 })]);
    expect(out.record.runId).toBe("r1");
  });
  it("halts on a broker position the fills log cannot explain", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 9_000, isOpen: true, today: "2026-09-25" });
    await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_000, clientOrderId: "manual", estNotionalUsd: 1_000 }); // a trade the log never saw
    await expect(planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r" })).rejects.toThrow(/no buy fill/);
  });
});

describe("executeOrders", () => {
  it("submits through the guards and appends fills carrying the trading date", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0 } };
    const fills = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0 });
    expect(fills).toEqual([expect.objectContaining({ ticker: "NVT", side: "buy", qty: 99, price: 100, tradingDate: "2026-09-25", runId: "r1" })]);
    expect(readFills(fillsPath)).toEqual(fills);
  });
});
