/**
 * pipeline.live.test.ts — markMode "live": the 15:10 decision on live prices (liveMark + planRun's
 * marks section). tradesToOrders is wrapped in a pass-through spy (behaviour unchanged) so a test can
 * read the exact Mkt it was handed — the proof that execution's reference close stays the settled one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./orders", async (importOriginal) => {
  const m = await importOriginal<typeof import("./orders")>();
  return { ...m, tradesToOrders: vi.fn(m.tradesToOrders) };
});

import { planRun, liveMark } from "./pipeline";
import { tradesToOrders } from "./orders";
import { FakeBroker } from "../broker/fake";
import type { LatestSnapshot } from "../broker/adapter";
import { resolveTradeConfig } from "./config";
import { fixtureReport } from "../portfolio/__fixtures__/reports";

const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"].map((date) => ({ date, open: "09:30", close: "16:00" }));
const TODAY = "2026-09-25";
const PREV = "2026-09-24";
/** Settled closes of 100 every day — and a 999 "bar" for TODAY, the partial intraday bar live mode must never read. */
const closes = (p = 100) => ({ ...Object.fromEntries(CAL.map((d) => [d.date, p])), [TODAY]: 999 });
const at = (hhmm: string, day = TODAY) => Date.parse(`${day}T${hhmm}:00-04:00`); // EDT
const NOW = at("15:10");
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 }); // markMode "live" is the default
const report = (ticker: string) => fixtureReport({ ticker, label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] }); // at 100: mu +21%, R 1.05

function broker(tickers: string[]) {
  const b = new FakeBroker({ calendar: CAL, closes: Object.fromEntries(tickers.map((t) => [t, closes()])), equity: 10_000, cash: 10_000, isOpen: true, today: TODAY });
  const closeDates: string[] = [];
  const reads = { trade: 0, quote: 0 };
  const lastClose = b.getLastClose.bind(b), trade = b.getLatestTrade.bind(b), quote = b.getLatestQuote.bind(b);
  b.getLastClose = async (symbols, date) => { closeDates.push(date); return lastClose(symbols, date); };
  b.getLatestTrade = async (s) => { reads.trade++; return trade(s); };
  b.getLatestQuote = async (s) => { reads.quote++; return quote(s); };
  return { b, closeDates, reads };
}
const lastSizing = () => vi.mocked(tradesToOrders).mock.calls.at(-1)![0];

beforeEach(() => { vi.mocked(tradesToOrders).mockClear(); });

describe("liveMark (pure)", () => {
  const T = 1_000_000_000_000;
  const min = 60_000;
  it("takes a fresh last trade", () => {
    expect(liveMark({ price: 104, tsMs: T - 2 * min }, { bid: 103, ask: 105, tsMs: T }, 100, T, 5)).toEqual({ price: 104, source: "trade" });
    expect(liveMark({ price: 104, tsMs: T - 5 * min }, null, 100, T, 5)).toEqual({ price: 104, source: "trade" }); // exactly maxStaleMin old is still fresh
  });
  it("a stale (or unusable) trade falls to the fresh quote MID", () => {
    expect(liveMark({ price: 104, tsMs: T - 6 * min }, { bid: 101, ask: 103, tsMs: T - min }, 100, T, 5)).toEqual({ price: 102, source: "quote" });
    expect(liveMark({ price: 0, tsMs: T }, { bid: 101, ask: 103, tsMs: T }, 100, T, 5)).toEqual({ price: 102, source: "quote" });
    expect(liveMark({ price: NaN, tsMs: T }, { bid: 101, ask: 103, tsMs: T }, 100, T, 5)).toEqual({ price: 102, source: "quote" });
    expect(liveMark(null, { bid: 101, ask: 101, tsMs: T }, 100, T, 5)).toEqual({ price: 101, source: "quote" }); // a locked quote is sane
  });
  it("rejects a crossed, zero-bid, non-finite or stale quote → the settled close", () => {
    expect(liveMark(null, { bid: 103, ask: 101, tsMs: T }, 100, T, 5)).toEqual({ price: 100, source: "close" });     // crossed
    expect(liveMark(null, { bid: 0, ask: 101, tsMs: T }, 100, T, 5)).toEqual({ price: 100, source: "close" });       // zero bid
    expect(liveMark(null, { bid: -1, ask: 101, tsMs: T }, 100, T, 5)).toEqual({ price: 100, source: "close" });
    expect(liveMark(null, { bid: 99, ask: Infinity, tsMs: T }, 100, T, 5)).toEqual({ price: 100, source: "close" });
    expect(liveMark(null, { bid: 99, ask: 101, tsMs: T - 6 * min }, 100, T, 5)).toEqual({ price: 100, source: "close" }); // stale
  });
  it("nothing fresh → the settled close", () => {
    expect(liveMark(null, null, 100, T, 60)).toEqual({ price: 100, source: "close" });
    expect(liveMark({ price: 104, tsMs: T - 61 * min }, { bid: 99, ask: 101, tsMs: T - 61 * min }, 100, T, 60)).toEqual({ price: 100, source: "close" });
    expect(liveMark({ price: 104, tsMs: NaN }, { bid: 99, ask: 101, tsMs: NaN }, 100, T, 60)).toEqual({ price: 100, source: "close" });
  });
  it("a timestamp beyond the window in the FUTURE is not fresh either (a units or clock bug is not a live price)", () => {
    expect(liveMark({ price: 104, tsMs: T + 10 * min }, null, 100, T, 5)).toEqual({ price: 100, source: "close" });
    expect(liveMark({ price: 104, tsMs: T + 30_000 }, null, 100, T, 5)).toEqual({ price: 104, source: "trade" }); // seconds of clock skew are fine
  });
  it("sets aside a live price that has gapped past the gap-halt from the settled close (execution would halt it anyway)", () => {
    const m = liveMark({ price: 130, tsMs: T }, { bid: 99, ask: 101, tsMs: T }, 100, T, 15, 0.15);
    expect(m).toMatchObject({ price: 100, source: "close" });
    expect(m.setAside).toMatch(/trade \$130 is 30\.0% from the \$100 settled close \(over the 15% gap-halt\)/);
    expect(liveMark({ price: 114, tsMs: T }, null, 100, T, 15, 0.15)).toEqual({ price: 114, source: "trade" });       // inside the gap-halt
    expect(liveMark(null, { bid: 79, ask: 81, tsMs: T }, 100, T, 15, 0.15)).toMatchObject({ price: 100, source: "close" }); // −20% mid, set aside too
  });
  it("trusts live data only against a valid reference close", () => {
    expect(liveMark({ price: 104, tsMs: T }, null, 0, T, 5)).toEqual({ price: 0, source: "close" });
    expect(liveMark({ price: 104, tsMs: T }, null, NaN, T, 5)).toMatchObject({ source: "close" });
  });
});

describe("planRun — markMode live on the current ET session", () => {
  it("decides on live marks (trade, quote mid, or the settled fallback), records the sources, and keeps execution's Mkt.close settled", async () => {
    const { b, closeDates } = broker(["NVT", "QQQ", "ZZZ"]);
    b.setTrade("NVT", 104, NOW - 60_000);              // fresh trade, +4%
    b.setQuote("QQQ", 101.9, 102.1, NOW - 120_000);    // no trade; fresh quote → mid 102
    // ZZZ: no live data at all → the settled close
    const out = await planRun({ adapter: b, reports: ["NVT", "QQQ", "ZZZ"].map(report), sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg, runId: "r", nowMs: NOW });
    expect(closeDates).toEqual([PREV]);                // only the settled PRIOR close — never TODAY's partial bar (999)
    expect(out.markDate).toBe(PREV);
    expect(out.marks).toEqual({ NVT: 104, QQQ: 102, ZZZ: 100 });
    expect(out.signals.map((s) => [s.ticker, s.price])).toEqual([["NVT", 104], ["QQQ", 102], ["ZZZ", 100]]);
    expect(out.record).toMatchObject({
      markMode: "live", marks: { NVT: 104, QQQ: 102, ZZZ: 100 },
      refCloses: { NVT: 100, QQQ: 100, ZZZ: 100 }, markSources: { NVT: "trade", QQQ: "quote", ZZZ: "close" },
    });
    expect(out.record.notes[0]).toBe(`live marks (15:10 ET): 1 trade, 1 quote mid, 1 settled ${PREV} close (ZZZ)`);
    // Execution: the decision marks feed the qty conversion, but every Mkt.close is the settled close.
    const sizing = lastSizing();
    expect(sizing.marks).toEqual(out.marks);
    expect(Object.fromEntries(Object.entries(sizing.mkts).map(([t, m]) => [t, m.close]))).toEqual(Object.fromEntries(out.plan.trades.map((t) => [t.ticker, 100])));
    expect(out.sized.orders.find((o) => o.ticker === "NVT")).toMatchObject({ tier: 1, pRef: 104 });
  });

  it("reuses the decision's snapshot for execution — one trade + one quote read per ticker per run, anchored at its capture time", async () => {
    const { b, reads } = broker(["NVT"]);
    b.setTrade("NVT", 104, NOW - 60_000);
    let t = NOW;
    const out = await planRun({ adapter: b, reports: [report("NVT")], sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg, runId: "r", nowMs: NOW, clock: () => (t += 1_000) });
    expect(reads).toEqual({ trade: 1, quote: 1 });
    expect(out.sized.orders[0].anchorAtMs).toBe(NOW + 1_000);
    expect(out.sized.orders[0].diag?.tradeAgeMs).toBe(61_000);
  });

  it("freshness is judged per bucket at capture time: a 10-minute-old trade is live for a mid cap, stale for a large cap", async () => {
    const { b } = broker(["MID", "BIG"]);
    b.setTrade("MID", 104, NOW - 10 * 60_000);
    b.setTrade("BIG", 104, NOW - 10 * 60_000);
    const out = await planRun({ adapter: b, reports: [report("MID"), report("BIG")], sics: {}, marketCapUsd: { MID: 5e9, BIG: 50e9 }, fills: [], today: TODAY, cfg, runId: "r", nowMs: NOW });
    expect(out.record.markSources).toEqual({ MID: "trade", BIG: "close" }); // maxStaleMin mid 15 / large 5
    expect(out.marks).toEqual({ MID: 104, BIG: 100 });
  });

  it("a print gapped past the gap-halt is set aside: the decision is the settled one and execution still gap-halts the name", async () => {
    const { b } = broker(["GAPD"]);
    b.setTrade("GAPD", 130, NOW - 60_000); // +30% vs the $100 settled close; mid-bucket gap-halt is 15%
    const out = await planRun({ adapter: b, reports: [report("GAPD")], sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg, runId: "r", nowMs: NOW });
    expect(out.marks).toEqual({ GAPD: 100 });
    expect(out.record.markSources).toEqual({ GAPD: "close" });
    expect(out.record.notes).toEqual(expect.arrayContaining([expect.stringMatching(/^live mark: GAPD trade \$130 is 30\.0% from the \$100 settled close .* — settled close used$/)]));
    expect(out.plan.trades.map((t) => t.reason)).toEqual(["ENTER"]);   // decided at 100, as settled mode would
    expect(out.sized.skippedHalt).toEqual([{ ticker: "GAPD", reason: "gap" }]); // and never traded on the gapped print
  });

  it("a failed live read never fails the run: that ticker decides on the settled close (recorded), and execution re-reads it", async () => {
    const { b, reads } = broker(["NVT"]);
    b.setTrade("NVT", 104, NOW - 60_000);
    const trade = b.getLatestTrade.bind(b);
    let calls = 0;
    b.getLatestTrade = async (s) => { if (++calls === 1) throw new Error("HTTP 429 Too Many Requests"); return trade(s); };
    const out = await planRun({ adapter: b, reports: [report("NVT")], sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg, runId: "r", nowMs: NOW });
    expect(out.marks).toEqual({ NVT: 100 });
    expect(out.record.markSources).toEqual({ NVT: "close" });
    expect(out.record.notes).toContain("live mark: NVT read failed (HTTP 429 Too Many Requests) — settled close used");
    expect(calls).toBe(2); // the execution re-read
    expect(reads.quote).toBe(2);
    expect(out.sized.orders[0]).toMatchObject({ ticker: "NVT", tier: 1, pRef: 104 }); // execution anchors on the fresh re-read, gap-checked against the settled close
    expect(lastSizing().mkts.NVT.close).toBe(100);
  });

  it("a held name with no report is marked too (report tickers ∪ held)", async () => {
    const { b } = broker(["NVT", "OLD"]);
    const seed = await b.submitOrder({ symbol: "OLD", side: "buy", qty: 5, clientOrderId: "seed", estNotionalUsd: 500 });
    const fills = [{ ticker: "OLD", side: "buy" as const, qty: 5, price: seed.filledAvgPrice!, filledAt: "2026-09-21T15:00:00Z", tradingDate: "2026-09-21", orderId: seed.id, runId: "r0" }];
    b.setTrade("OLD", 101, NOW - 60_000);
    const out = await planRun({ adapter: b, reports: [report("NVT")], sics: {}, marketCapUsd: {}, fills, today: TODAY, cfg, runId: "r", nowMs: NOW });
    expect(out.record.markSources).toEqual({ NVT: "close", OLD: "trade" });
    expect(out.marks.OLD).toBe(101);
  });
});

describe("planRun — markMode live outside today's session behaves exactly like settled", () => {
  const settledLike = async (today: string, nowMs: number) => {
    const { b, closeDates, reads } = broker(["NVT"]);
    b.setTrade("NVT", 104, nowMs - 60_000); // fresh at nowMs — and still ignored for the decision
    const out = await planRun({ adapter: b, reports: [report("NVT")], sics: {}, marketCapUsd: {}, fills: [], today, cfg, runId: "r", nowMs });
    return { out, closeDates, reads };
  };
  it("a `today` that is not the ET date of nowMs (trade:plan --date): the settled prior close", async () => {
    const { out, closeDates, reads } = await settledLike(PREV, NOW);
    expect(closeDates).toEqual(["2026-09-23"]);
    expect(out.marks).toEqual({ NVT: 100 });
    expect(out.record).toMatchObject({ markMode: "settled", markSources: { NVT: "close" }, refCloses: { NVT: 100 } });
    expect(out.record.notes[0]).toMatch(/^markMode live, but this run is not inside today's ET session \(today 2026-09-24, now 2026-09-25 15:10 ET\) — decided on the settled 2026-09-23 close$/);
    expect(reads).toEqual({ trade: 1, quote: 1 }); // only execution's read for the traded ticker — no decision reads
  });
  it("after the close or before the open on today's date", async () => {
    for (const nowMs of [at("16:30"), at("08:00")]) {
      const { out } = await settledLike(TODAY, nowMs);
      expect(out.record.markMode).toBe("settled");
      expect(out.marks).toEqual({ NVT: 100 });
    }
  });
  it("a non-trading day (Saturday)", async () => {
    const { out, closeDates } = await settledLike("2026-09-26", at("12:00", "2026-09-26"));
    expect(closeDates).toEqual([TODAY]); // prevTradingDay(Sat) = Fri
    expect(out.record.markMode).toBe("settled");
  });
});

describe("planRun — markMode settled is unchanged", () => {
  it("marks the settled prior close even inside today's session; execution still anchors on the live print", async () => {
    const { b, closeDates, reads } = broker(["NVT"]);
    b.setTrade("NVT", 104, NOW - 60_000);
    const out = await planRun({ adapter: b, reports: [report("NVT")], sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg: { ...cfg, markMode: "settled" }, runId: "r", nowMs: NOW });
    expect(closeDates).toEqual([PREV]);
    expect(out.marks).toEqual({ NVT: 100 });
    expect(out.signals[0].price).toBe(100);
    expect(out.record).toMatchObject({ markMode: "settled", refCloses: { NVT: 100 }, markSources: { NVT: "close" } });
    expect(out.record.notes.some((n) => /live mark/.test(n))).toBe(false);
    expect(reads).toEqual({ trade: 1, quote: 1 });
    expect(lastSizing().mkts.NVT.close).toBe(100);
    expect(out.sized.orders[0]).toMatchObject({ tier: 1, pRef: 104 });
  });
});

describe("planRun live — a batching broker (getLatestSnapshots)", () => {
  it("reads every decision ticker in ONE batch call, no per-ticker reads, and decides on it", async () => {
    const { b, reads } = broker(["NVT", "QQQ"]);
    const batches: string[][] = [];
    Object.assign(b, { getLatestSnapshots: async (symbols: string[]): Promise<Record<string, LatestSnapshot>> => {
      batches.push(symbols);
      return Object.fromEntries(symbols.map((s) => [s, s === "NVT" ? { lastTrade: { price: 104, tsMs: NOW - 60_000 }, quote: null } : { lastTrade: null, quote: null }]));
    } });
    const out = await planRun({ adapter: b, reports: [report("NVT"), report("QQQ")], sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg, runId: "r1", nowMs: NOW });
    expect(batches).toEqual([["NVT", "QQQ"]]);
    expect(out.record.markSources).toEqual({ NVT: "trade", QQQ: "close" });
    expect(out.marks.NVT).toBe(104);
    // Execution reuses the batch snapshot: no per-ticker trade/quote reads at all.
    expect(reads).toEqual({ trade: 0, quote: 0 });
  });
  it("a failed batch decides every ticker on its settled close, records why, and never fans out per ticker", async () => {
    const { b, reads } = broker(["NVT", "QQQ"]);
    Object.assign(b, { getLatestSnapshots: async (): Promise<Record<string, LatestSnapshot>> => { throw new Error("429 Too Many Requests"); } });
    const out = await planRun({ adapter: b, reports: [report("NVT"), report("QQQ")], sics: {}, marketCapUsd: {}, fills: [], today: TODAY, cfg, runId: "r1", nowMs: NOW });
    expect(out.record.markSources).toEqual({ NVT: "close", QQQ: "close" });
    expect(out.marks).toEqual({ NVT: 100, QQQ: 100 });
    expect(out.record.notes.filter((n) => n.includes("429"))).toHaveLength(2);
    // Only traded tickers are re-read at execution (to anchor their order), never the whole decision set.
    expect(reads.trade).toBe(new Set(out.plan.trades.map((t) => t.ticker)).size);
  });
});
