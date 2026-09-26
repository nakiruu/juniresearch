import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun, executeOrders, fillTradingDate } from "./pipeline";
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
  it("marks at the previous settled close, reconciles an empty book, and plans an ENTER as a close-anchored (tier 3) limit order", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: { ...closes(100), "2026-09-25": 999 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    expect(out.markDate).toBe("2026-09-24");
    expect(out.marks).toEqual({ NVT: 100 });                       // not the 999 intraday print
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "ENTER" })]);
    // no live trade/quote on the fake -> anchored to the settled $100 close (tier 3), sized down by closeAnchorSizeMult (0.5):
    // tau=limitTol.mid=0.0035 -> L=100.35; qty=floor(9_900 * 0.5 / 100.35)=49
    expect(out.sized.orders).toEqual([expect.objectContaining({
      ticker: "NVT", kind: "qty", qty: 49, limitPrice: 100.35, timeInForce: "ioc", tier: 3, anchorReason: "close_anchored", bucket: "mid",
    })]);
    expect(out.sized.skippedHalt).toEqual([]);
    expect(out.record.runId).toBe("r1");
  });
  it("anchors to a fresh live last trade (tier 1, full size) instead of the settled close when nowMs is close to it", async () => {
    const NOW = Date.parse("2026-09-25T14:00:00.000Z");
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    b.setTrade("NVT", 105, NOW); // fresh (within maxStaleMin.mid=15min), 5% above the $100 close (under gapHalt.mid=0.15)
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1", nowMs: NOW });
    // tau=limitTol.mid=0.0035 on pRef=105 -> L=105.37; sizeMult=1 (tier 1, not close-anchored) -> qty=floor(9_900/105.37)=93
    expect(out.sized.orders).toEqual([expect.objectContaining({ ticker: "NVT", kind: "qty", qty: 93, limitPrice: 105.37, tier: 1, anchorReason: "ok" })]);
  });
  it("halts a trade via computeLimit's gap-halt: skippedHalt (not an order), surfaced in the run-record notes", async () => {
    const NOW = Date.parse("2026-09-25T14:00:00.000Z");
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    b.setTrade("NVT", 200, NOW); // fresh, but 100% above the $100 close -> exceeds gapHalt.mid (0.15)
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1", nowMs: NOW });
    expect(out.sized.orders).toEqual([]);
    expect(out.sized.skippedHalt).toEqual([{ ticker: "NVT", reason: "gap" }]);
    expect(out.record.notes.some((n) => n.includes("NVT") && n.toLowerCase().includes("gap"))).toBe(true);
  });
  it("halts on a broker position the fills log cannot explain", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 9_000, isOpen: true, today: "2026-09-25" });
    await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_000, clientOrderId: "manual", estNotionalUsd: 1_000 }); // a trade the log never saw
    await expect(planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r" })).rejects.toThrow(/no buy fill/);
  });
});

describe("executeOrders", () => {
  it("submits a limit order through the guards and appends fills carrying the trading date", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0 } };
    const { fills } = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0 });
    expect(fills).toEqual([expect.objectContaining({ ticker: "NVT", side: "buy", qty: 49, price: 100, tradingDate: "2026-09-25", runId: "r1" })]);
    expect(readFills(fillsPath)).toEqual(fills);
  });
  it("returns the terminal broker outcome per order (status/brokerId/qty), including a zero-fill", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0 } };
    const { executed } = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0 });
    expect(executed).toEqual([expect.objectContaining({ clientOrderId: out.sized.orders[0].clientOrderId, status: "filled", filledQty: 49, submittedAt: expect.any(String) })]);
    expect(executed[0].brokerId).toMatch(/^fake-/);
  });
  it("an IOC limit the live price has since moved away from cancels with zero fill", async () => {
    // settled close (the anchor) is $100, but the intraday print at execution time is $999 -> the
    // slippage-capped $100.35 limit is no longer marketable, so the fake IOC cancels unfilled.
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: { ...closes(100), "2026-09-25": 999 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    expect(out.sized.orders[0]).toEqual(expect.objectContaining({ limitPrice: 100.35 }));
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0 } };
    const { fills } = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0 });
    expect(fills).toEqual([]);
    expect(readFills(fillsPath)).toEqual([]);
  });
});

describe("fillTradingDate — the lock clock starts on the fill's ET date", () => {
  it("uses the ET date, not the UTC date, for an evening-UTC timestamp", () => {
    expect(fillTradingDate("2026-03-10T00:30:00Z")).toBe("2026-03-09"); // 20:30 EDT on the 9th
    expect(fillTradingDate("2026-09-28T13:45:00+0000")).toBe("2026-09-28"); // Schwab's offset format
  });
  it("falls back to the literal date prefix for an unparseable timestamp", () => {
    expect(fillTradingDate("garbage")).toBe("garbage".slice(0, 10));
  });
});
