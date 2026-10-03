import { describe, it, expect } from "vitest";
import { planRun } from "./pipeline";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig, type TradeConfig } from "./config";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { Report } from "../report.schema";
import type { Fill } from "./fills";

// Weekdays Jun 1 → Nov 30, 2026: planRun loads today−90 … today+45, and the 09-01 buy's lock must be datable.
const CAL = (() => {
  const out: { date: string; open: string; close: string }[] = [];
  for (let t = Date.parse("2026-06-01T00:00:00Z"); t <= Date.parse("2026-11-30T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), open: "09:30", close: "16:00" });
  }
  return out;
})();
const TODAY = "2026-09-25";      // a Friday; settled marks → markDate Thu 09-24
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 });
// Bear $80; the report was priced at $100 on `asOf`.
const nvt = (asOf = "Sep 22, 2026"): Report => {
  const r = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] });
  return { ...r, meta: { ...r.meta, asOf }, quote: { currentPrice: 100 } } as unknown as Report;
};

/** A book holding 10 NVT bought on `buyOn` (default 09-01: recorded, long out of its lock), NVT closing at `mark` since. */
async function heldBook(o: { mark: number; spy?: Record<string, number>; buyOn?: string }) {
  const buyOn = o.buyOn ?? "2026-09-01";
  const nvtCloses: Record<string, number> = { "2026-09-01": 100, "2026-09-22": 95, "2026-09-24": o.mark, "2026-09-25": o.mark };
  const b = new FakeBroker({ calendar: CAL, closes: { NVT: nvtCloses, ...(o.spy ? { SPY: o.spy } : {}) }, equity: 10_000, cash: 10_000, isOpen: true, today: buyOn });
  const bought = await b.submitOrder({ symbol: "NVT", side: "buy", qty: 10, clientOrderId: "c0", estNotionalUsd: 1_000 });
  const fills: Fill[] = [{ ticker: "NVT", side: "buy", qty: 10, price: bought.filledAvgPrice!, filledAt: bought.filledAt!, tradingDate: buyOn, orderId: bought.id, runId: "r0" }];
  b.setToday(TODAY);
  const spyReads: string[] = [];
  const read = b.getLastClose.bind(b);
  b.getLastClose = async (symbols: string[], date: string) => { if (symbols.includes("SPY")) spyReads.push(date); return read(symbols, date); };
  return { b, fills, spyReads };
}
const plan = async (o: { mark: number; spy?: Record<string, number>; buyOn?: string; c?: TradeConfig; report?: Report; betas?: Record<string, number | null>; sics?: Record<string, number | null> }) => {
  const { b, fills, spyReads } = await heldBook(o);
  const out = await planRun({ adapter: b, reports: [o.report ?? nvt()], sics: o.sics ?? { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, betas: o.betas ?? { NVT: 1.2 }, fills, today: TODAY, cfg: o.c ?? cfg, runId: "r1" });
  return { out, spyReads, cls: out.plan.classifications.find((c) => c.ticker === "NVT")! };
};

describe("planRun — a held name below its bear case, by cause", () => {
  it("market fell enough to explain it → HOLD, still sized (an ADD toward target), cause recorded", async () => {
    // NVT −24% since the report; SPY −20% × beta 1.2 = −24% → stock-specific share 0.
    const { out, cls, spyReads } = await plan({ mark: 76, spy: { "2026-09-22": 500, "2026-09-24": 400 } });
    expect(out.signals[0]).toMatchObject({ R: null, D: 0 });
    expect(cls.classification).toBe("HOLD");
    expect(cls.reasons[0]).toMatch(/^bear breach, market-driven \(stock-specific share 0%\)/);
    expect(out.breaches.NVT).toMatchObject({ cause: "market", beta: 1.2 });
    expect(out.breaches.NVT.spyReturn).toBeCloseTo(-0.2, 12);
    expect(out.record.breaches).toEqual(out.breaches);
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", side: "buy", reason: "ADD" })]);
    expect(spyReads.sort()).toEqual(["2026-09-22", "2026-09-24"]); // report date + the decision-mark date, once each
  });
  it("market flat → stock-specific → EXIT the whole position", async () => {
    const { out, cls } = await plan({ mark: 76, spy: { "2026-09-22": 500, "2026-09-24": 500 } });
    expect(cls).toEqual({ ticker: "NVT", classification: "EXIT", reasons: ["bear breach, stock-specific (stock-specific share 100%) — exit"] });
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", side: "sell", reason: "EXIT" })]);
    expect(out.sized.orders.every((o) => o.side === "sell")).toBe(true);
  });
  it("stock-specific while sell-locked (bought inside the lock window) → DEFER_EXIT until the lock clears, no order", async () => {
    const { out, cls } = await plan({ mark: 76, buyOn: "2026-09-22", spy: { "2026-09-22": 500, "2026-09-24": 500 } });
    expect(out.locks.sellLockUntil.NVT).toBe("2026-09-29");
    expect(cls).toEqual({ ticker: "NVT", classification: "DEFER_EXIT", reasons: ["bear breach, stock-specific (stock-specific share 100%) — exit"], unlockOn: "2026-09-29" });
    expect(out.plan.trades).toEqual([]);
    expect(out.sized.orders).toEqual([]);
  });
  it("a mixed fall → FREEZE: no order either way, the weight held", async () => {
    // SPY −8% × 1.2 = −9.6% of a −24% fall → share 0.6.
    const { out, cls } = await plan({ mark: 76, spy: { "2026-09-22": 500, "2026-09-24": 460 } });
    expect(cls.classification).toBe("FREEZE");
    expect(out.breaches.NVT.share).toBeCloseTo(0.6, 12);
    expect(out.plan.trades).toEqual([]);
    expect(out.sized.orders).toEqual([]);
    expect(out.plan.skipped).toContainEqual(expect.objectContaining({ ticker: "NVT", code: "FREEZE" }));
  });
  it("SPY close missing → no cause → the plain bear-breach EXIT, no throw, and the run record says why", async () => {
    const { out, cls } = await plan({ mark: 76 }); // the fake throws for an unconfigured SPY close
    expect(cls).toEqual({ ticker: "NVT", classification: "EXIT", reasons: [`R — < exit ${resolveTradeConfig().rExit} (price at or below the bear case)`] });
    expect(out.breaches).toEqual({});
    expect(out.record.notes.some((n) => /bear breach NVT: cause unknown \(no SPY close/.test(n))).toBe(true);
  });
  it("only the report-date close missing → still the plain EXIT", async () => {
    const { cls } = await plan({ mark: 76, spy: { "2026-09-24": 400 } });
    expect(cls.classification).toBe("EXIT");
    expect(cls.reasons).toEqual([`R — < exit ${resolveTradeConfig().rExit} (price at or below the bear case)`]);
  });
  it("no beta and no SIC → the plain EXIT; a SIC alone prices it with the sector proxy", async () => {
    const spy = { "2026-09-22": 500, "2026-09-24": 400 };
    expect((await plan({ mark: 76, spy, betas: {}, sics: {} })).cls.classification).toBe("EXIT");
    const proxied = await plan({ mark: 76, spy, betas: {}, sics: { NVT: 3674 } }); // semis proxy 1.7
    expect(proxied.out.breaches.NVT.beta).toBe(1.7);
  });
  it("a report priced on a weekend reads SPY on the trading day before it", async () => {
    const { out, spyReads } = await plan({ mark: 76, report: nvt("Sep 20, 2026"), spy: { "2026-09-18": 500, "2026-09-24": 400 } });
    expect(out.breaches.NVT.cause).toBe("market");
    expect(spyReads).toContain("2026-09-18");
  });
  it("a report priced after the decision mark can't measure the fall → plain EXIT", async () => {
    const { cls } = await plan({ mark: 76, report: nvt("Sep 25, 2026"), spy: { "2026-09-24": 400, "2026-09-25": 400 } });
    expect(cls.classification).toBe("EXIT");
  });
  it("breachPolicy exit: never reads SPY, exits as before", async () => {
    const { cls, spyReads } = await plan({ mark: 76, spy: { "2026-09-22": 500, "2026-09-24": 400 }, c: resolveTradeConfig({ wMax: 1, sectorMax: 1, breachPolicy: "exit" }) });
    expect(cls.classification).toBe("EXIT");
    expect(spyReads).toEqual([]);
  });
  it("no breach (price above the bear) → SPY is never read", async () => {
    const { cls, spyReads, out } = await plan({ mark: 90 });
    expect(cls.classification).toBe("HOLD");
    expect(cls.reasons).toEqual([]);
    expect(spyReads).toEqual([]);
    expect(out.breaches).toEqual({});
  });
});

describe("planRun — a bear breach in a live (15:10 ET) run", () => {
  const NOW = Date.parse("2026-09-25T15:10:00-04:00"); // TODAY, inside the session: markMode "live" (the default)
  it("measures the market part against SPY's LIVE mark, not yesterday's close", async () => {
    // Report $100 on 09-22, bear $80. Settled 09-24: NVT $85 (above the bear), SPY $470. Live: NVT $76 (a breach), SPY $440.
    const { b, fills } = await heldBook({ mark: 85, spy: { "2026-09-22": 500, "2026-09-24": 470 } });
    b.setTrade("NVT", 76, NOW - 60_000);
    b.setTrade("SPY", 440, NOW - 60_000);
    const out = await planRun({ adapter: b, reports: [nvt()], sics: { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, betas: { NVT: 1.2 }, fills, today: TODAY, cfg, runId: "r1", nowMs: NOW });
    expect(out.record.markMode).toBe("live");
    expect(out.record.markSources?.NVT).toBe("trade");
    expect(out.signals[0]).toMatchObject({ price: 76, R: null, D: 0 });
    // Live SPY −12% × β 1.2 = −14.4% of NVT's −24% → stock-specific share 0.40 → market-driven → HOLD.
    // (Settled SPY $470 would read −6% → share 0.70 → a mixed FREEZE.)
    expect(out.breaches.NVT.spyReturn).toBeCloseTo(440 / 500 - 1, 12);
    expect(out.breaches.NVT).toMatchObject({ cause: "market" });
    expect(out.plan.classifications.find((c) => c.ticker === "NVT")!.classification).toBe("HOLD");
  });
  it("a stale SPY print falls back to SPY's settled close, exactly like any other decision mark", async () => {
    const { b, fills } = await heldBook({ mark: 85, spy: { "2026-09-22": 500, "2026-09-24": 470 } });
    b.setTrade("NVT", 76, NOW - 60_000);
    b.setTrade("SPY", 440, NOW - 30 * 60_000); // older than the large-cap 5-minute window
    const out = await planRun({ adapter: b, reports: [nvt()], sics: { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, betas: { NVT: 1.2 }, fills, today: TODAY, cfg, runId: "r1", nowMs: NOW });
    expect(out.breaches.NVT.spyReturn).toBeCloseTo(470 / 500 - 1, 12);
    expect(out.plan.classifications.find((c) => c.ticker === "NVT")!.classification).toBe("FREEZE");
  });
});
