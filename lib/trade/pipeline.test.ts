import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun, executeOrders, fillTradingDate, mergeExecution } from "./pipeline";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig } from "./config";
import { readFills } from "./fills";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { GuardContext } from "../broker/guards";
import type { OrderRequest, SizedOrders } from "./orders";

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
    // The orders check (default on) catches it first, by broker order id…
    await expect(planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r" })).rejects.toThrow(/fake-1 buy NVT filled/);
    // …and the positions check still stands on its own.
    await expect(planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg: { ...cfg, reconcileOrders: false }, runId: "r" })).rejects.toThrow(/no buy fill/);
  });
  it("halts on an executed SELL the fills log never recorded (the position is still explained by its buy)", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const bought = await b.submitOrder({ symbol: "NVT", side: "buy", qty: 10, clientOrderId: "c1", estNotionalUsd: 1_000 });
    const buyFill = { ticker: "NVT", side: "buy" as const, qty: 10, price: 100, filledAt: bought.filledAt!, tradingDate: "2026-09-25", orderId: bought.id, runId: "r0" };
    await b.submitOrder({ symbol: "NVT", side: "sell", qty: 5, clientOrderId: "", estNotionalUsd: 500 }); // e.g. a manual sell, never recorded
    await expect(planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [buyFill], today: "2026-09-25", cfg, runId: "r" })).rejects.toThrow(/sell NVT filled 5, fills.jsonl records 0/);
  });
  it("looks back only over the lock window", async () => {
    let after: string | undefined;
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const list = b.getOrders.bind(b);
    b.getOrders = async (status: "open" | "closed" | "all", a?: string) => { after = a; return list(status); };
    await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r" });
    expect(after).toBe(`${CAL[0].date}T00:00:00Z`); // the fixture calendar is shorter than lockBusinessDays + 1 → clamps to its first day
  });
});

describe("executeOrders", () => {
  it("counts each order against the notional guard at qty × limitPrice (what an IOC limit can spend), not deltaUsd", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
    const sent: number[] = [];
    const submit = b.submitOrder.bind(b);
    b.submitOrder = async (req) => { sent.push(req.estNotionalUsd); return submit(req); };
    await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath: join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl"), pollMs: 0 });
    const [o] = out.sized.orders;
    expect(sent).toEqual([o.qty * o.limitPrice]);
    expect(ctx.counters.notionalUsd).toBeCloseTo(o.qty * o.limitPrice, 9);
    expect(o.qty * o.limitPrice).not.toBeCloseTo(o.deltaUsd, 2); // whole-share flooring (and tier-3 halving) make them differ
  });
  describe("a submit with an unknown outcome (spec #10)", () => {
    const setup = async () => {
      const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
      const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
      const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
      const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
      return { b, out, ctx, fillsPath };
    };
    it("placed but the response was lost: found by lookup, fill recorded, submitted exactly once", async () => {
      const { b, out, ctx, fillsPath } = await setup();
      b.loseNextSubmitResponse("placed");
      const r = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0, resolveDelaysMs: [0, 0, 0] });
      expect(b.submitCount).toBe(1);
      expect(r.aborted).toBeUndefined();
      expect(r.fills).toHaveLength(1);
      expect(readFills(fillsPath)).toEqual(r.fills);
      expect(ctx.counters.orders).toBe(1); // counted against the run caps like any submit
    });
    it("never placed: nothing resubmitted, the run stops, the order is recorded as 'unknown'", async () => {
      const { b, out, ctx, fillsPath } = await setup();
      b.loseNextSubmitResponse("not-placed");
      const r = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0, resolveDelaysMs: [0, 0, 0] });
      expect(b.submitCount).toBe(1);
      expect(await b.getOrders("all")).toEqual([]);
      expect(r.aborted).toMatchObject({ ticker: "NVT", clientOrderId: out.sized.orders[0].clientOrderId });
      expect(r.executed).toEqual([expect.objectContaining({ status: "unknown", brokerId: "" })]);
      expect(r.fills).toEqual([]);
    });
    it("an ambiguous lookup also stops the run (never guesses)", async () => {
      const { b, out, ctx, fillsPath } = await setup();
      b.loseNextSubmitResponse("not-placed");
      let lookups = 0;
      b.findSubmitted = async () => { lookups++; const e = new Error("2 orders match"); e.name = "AmbiguousOrderError"; throw e; };
      const r = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0, resolveDelaysMs: [0, 0, 0] });
      expect(r.aborted?.detail).toMatch(/2 orders match/);
      expect(lookups).toBe(1);
    });
  });
  it("polls a working order with an `after` bound just before its submit, matched by broker id", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const submit = b.submitOrder.bind(b);
    b.submitOrder = async (req) => ({ ...(await submit(req)), status: "new" }); // broker acks as still working
    const afters: (string | undefined)[] = [];
    const list = b.getOrders.bind(b);
    b.getOrders = async (status: "open" | "closed" | "all", after?: string) => { afters.push(after); return (await list(status)).map((o) => ({ ...o, clientOrderId: "" })); }; // Schwab-like: no cid echoed
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
    const NOW = Date.parse("2026-09-25T13:46:00Z");
    const { fills } = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath: join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl"), pollMs: 0, now: () => NOW });
    expect(afters[0]).toBe("2026-09-25T13:45:00.000Z");
    expect(fills).toHaveLength(1); // found by broker id although the listing carries no clientOrderId
  });
  it("submits a limit order through the guards and appends fills carrying the trading date", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
    const { fills } = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0 });
    expect(fills).toEqual([expect.objectContaining({ ticker: "NVT", side: "buy", qty: 49, price: 100, tradingDate: "2026-09-25", runId: "r1" })]);
    expect(readFills(fillsPath)).toEqual(fills);
  });
  it("returns the terminal broker outcome per order (status/brokerId/qty), including a zero-fill", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
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
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
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

describe("executeOrders — cash backstop (spec F5)", () => {
  const D = "2026-09-25";
  const mkOrder = (o: Pick<OrderRequest, "ticker" | "side" | "qty" | "limitPrice">): OrderRequest => ({
    ...o, sector: "0", kind: "qty", timeInForce: "ioc", tier: 1, capBound: false, anchorReason: "fresh_trade",
    clientOrderId: `c-${o.ticker}-${o.side}`, reason: o.side === "buy" ? "ENTER" : "EXIT", deltaUsd: o.qty * o.limitPrice, estCostUsd: 0, bucket: "large",
  });
  /** Account holding 10 AAA @ $100 with $1,000 cash; ctx NAV $5,000 (so the notional cap never binds) → cash floor $50. */
  const setup = async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { AAA: { [D]: 100 }, BBB: { [D]: 100 } }, equity: 2_000, cash: 2_000, isOpen: true, today: D });
    await b.submitOrder({ symbol: "AAA", side: "buy", qty: 10, clientOrderId: "seed", estNotionalUsd: 1_000 });
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: { buyLockUntil: {}, sellLockUntil: {} }, today: D, nav: 5_000, cashUsd: 1_000, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
    return { b, ctx, fillsPath: join(mkdtempSync(join(tmpdir(), "cash-")), "fills.jsonl") };
  };
  const sized = (orders: OrderRequest[]): SizedOrders => ({ orders, skippedDust: [], skippedHalt: [] });

  it("sends sells first, so a buy funded by a filled sell goes through", async () => {
    const { b, ctx, fillsPath } = await setup();
    const r = await executeOrders({ adapter: b, sized: sized([mkOrder({ ticker: "BBB", side: "buy", qty: 15, limitPrice: 100 }), mkOrder({ ticker: "AAA", side: "sell", qty: 10, limitPrice: 99 })]), ctx, runId: "r", fillsPath, pollMs: 0 });
    expect(r.executed.map((e) => e.clientOrderId)).toEqual(["c-AAA-sell", "c-BBB-buy"]);
    expect(r.skippedCash).toEqual([]);
    expect(ctx.counters).toMatchObject({ sellProceedsUsd: 1_000, buyNotionalUsd: 1_500 }); // trued up to the actual fill
  });
  it("skips (never sends, never crashes) a buy whose funding sell did not fill", async () => {
    const { b, ctx, fillsPath } = await setup();
    const r = await executeOrders({ adapter: b, sized: sized([mkOrder({ ticker: "AAA", side: "sell", qty: 10, limitPrice: 101 }), mkOrder({ ticker: "BBB", side: "buy", qty: 15, limitPrice: 100 })]), ctx, runId: "r", fillsPath, pollMs: 0 });
    expect(r.skippedCash).toEqual([expect.objectContaining({ ticker: "BBB", detail: expect.stringMatching(/cash backstop/) })]);
    expect((await b.getOrders("all")).filter((o) => o.symbol === "BBB")).toEqual([]);
    expect(r.executed.map((e) => e.clientOrderId)).toEqual(["c-AAA-sell"]); // the sell was sent; it just didn't fill
  });
  it("an unfilled buy releases its cash reservation for the next buy", async () => {
    const { b, ctx, fillsPath } = await setup();
    const r = await executeOrders({ adapter: b, sized: sized([mkOrder({ ticker: "AAA", side: "buy", qty: 9, limitPrice: 99 }), mkOrder({ ticker: "BBB", side: "buy", qty: 9, limitPrice: 100 })]), ctx, runId: "r", fillsPath, pollMs: 0 });
    expect(r.skippedCash).toEqual([]); // the first IOC didn't fill (99 < 100), so its $891 came back
    expect(ctx.counters.buyNotionalUsd).toBe(900);
  });
});

describe("latency timestamps (spec #10)", () => {
  it("judges freshness when each ticker's data was captured, not at run start, and records the capture time", async () => {
    const T = Date.parse("2026-09-25T13:45:00Z");
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    b.setTrade("NVT", 100, T - 10 * 60_000); // 10 min old at run start: fresh for the mid bucket (15 min)…
    let t = T;
    const clock = () => (t += 10 * 60_000); // …but the fetch happens 10 min later, when it is 20 min old
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r", nowMs: T, clock });
    const [o] = out.sized.orders;
    expect(o.anchorAtMs).toBe(T + 10 * 60_000);
    expect(o.tier).toBe(3); // stale at capture → close-anchored
    expect(o.diag?.tradeAgeMs).toBe(20 * 60_000);
  });
  it("records submit start/ack/terminal times, filled qty and avg price on each run-record order", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } };
    let t = Date.parse("2026-09-25T13:46:00Z");
    const { executed } = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath: join(mkdtempSync(join(tmpdir(), "lat-")), "fills.jsonl"), pollMs: 0, now: () => (t += 250) });
    const [rec] = mergeExecution(out.record.orders, executed) as Record<string, unknown>[];
    expect(rec).toMatchObject({ filledQty: 49, filledAvgPrice: 100, status: "filled" });
    const [a, b2, c] = [rec.submitStartAt, rec.submitAckAt, rec.terminalAt].map((x) => Date.parse(x as string));
    expect(a).toBeLessThan(b2);
    expect(b2).toBeLessThan(c);
  });
});

describe("run record signals keep scenario risk (plan #6 prerequisite)", () => {
  it("persists price, sigma, sigmaDown, D, staleness and the report's scenarios", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r" });
    const [sig] = out.record.signals;
    expect(sig).toMatchObject({ ticker: "NVT", price: 100 });
    expect(sig.D).toBeCloseTo(0.2, 9);
    expect(sig.sigma).toBeGreaterThan(0);
    expect(sig.scenarios?.map((x) => x.impliedPrice)).toEqual([150, 120, 80]);
  });
});
