import { describe, it, expect } from "vitest";
import { planRun } from "./pipeline";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig, type TradeConfig } from "./config";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { Report } from "../report.schema";
import type { LastEarnings } from "./earnings";
import { staleEntryLines, summaryFromRun } from "./notify";

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
const MISS: LastEarnings = { reportDate: "2026-08-05", surprisePct: -12, epsActual: 0.88, epsEstimate: 1 };
// Bear $80; the report was priced at $100 on 09-22. Not held.
const nvt = (): Report => {
  const r = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] });
  return { ...r, meta: { ...r.meta, asOf: "Sep 22, 2026" }, quote: { currentPrice: 100 } } as unknown as Report;
};

const plan = async (o: { mark: number; spy?: Record<string, number>; earnings?: Record<string, LastEarnings>; c?: TradeConfig }) => {
  const b = new FakeBroker({ calendar: CAL, closes: { NVT: { "2026-09-22": 100, "2026-09-24": o.mark, "2026-09-25": o.mark }, ...(o.spy ? { SPY: o.spy } : {}) }, equity: 10_000, cash: 10_000, isOpen: true, today: TODAY });
  const spyReads: string[] = [];
  const read = b.getLastClose.bind(b);
  b.getLastClose = async (symbols: string[], date: string) => { if (symbols.includes("SPY")) spyReads.push(date); return read(symbols, date); };
  const out = await planRun({ adapter: b, reports: [nvt()], sics: { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, betas: { NVT: 1.2 }, earnings: o.earnings ?? { NVT: MISS }, fills: [], today: TODAY, cfg: o.c ?? cfg, runId: "r1" });
  return { out, spyReads, cls: out.plan.classifications.find((c) => c.ticker === "NVT")! };
};

describe("planRun — the stale-on-bad-news entry gate", () => {
  it("−10% since the report, market flat, last earnings a miss → STALE_ENTRY: no order, recorded, on the re-write list", async () => {
    const { out, cls, spyReads } = await plan({ mark: 90, spy: { "2026-09-22": 500, "2026-09-24": 500 } });
    expect(out.signals[0].mu).toBeGreaterThan(cfg.muEnter); // it would have entered
    expect(cls.classification).toBe("STALE_ENTRY");
    expect(cls.reasons[0]).toMatch(/^stale on bad news: down 10% since the report, stock-specific \(share 100%\), last earnings missed \(-12\.0% on 2026-08-05\)/);
    expect(out.plan.trades).toEqual([]);
    expect(out.sized.orders).toEqual([]);
    expect(out.plan.skipped).toContainEqual(expect.objectContaining({ ticker: "NVT", code: "STALE_ENTRY", targetWeight: null }));
    expect(out.staleEntries.NVT).toMatchObject({ share: 1, surprisePct: -12, earningsDate: "2026-08-05" });
    expect(out.record.staleEntries).toEqual(out.staleEntries);
    expect(spyReads.sort()).toEqual(["2026-09-22", "2026-09-24"]);
    expect(staleEntryLines(out)).toEqual(["NVT -10% since report, stock-specific; missed -12.0% (2026-08-05)"]);
    expect(summaryFromRun(out, "plan", []).staleEntries).toEqual(staleEntryLines(out));
  });
  it("the same fall after a beat → ENTER", async () => {
    const { cls, out } = await plan({ mark: 90, spy: { "2026-09-22": 500, "2026-09-24": 500 }, earnings: { NVT: { ...MISS, surprisePct: 5 } } });
    expect(cls.classification).toBe("ENTER");
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "ENTER" })]);
  });
  it("a miss, but the market explains the fall → ENTER", async () => {
    const { cls, out } = await plan({ mark: 90, spy: { "2026-09-22": 500, "2026-09-24": 460 } });
    expect(cls.classification).toBe("ENTER");
    expect(out.staleEntries).toEqual({});
  });
  it("no earnings on file, an old miss, or a fall under 5% → ENTER without reading SPY", async () => {
    const cases: { mark: number; earnings?: Record<string, LastEarnings> }[] = [{ mark: 90, earnings: {} }, { mark: 90, earnings: { NVT: { ...MISS, reportDate: "2026-05-01" } } }, { mark: 96 }];
    for (const o of cases) {
      const { cls, spyReads } = await plan(o);
      expect(cls.classification).toBe("ENTER");
      expect(spyReads).toEqual([]);
    }
  });
  it("SPY unavailable → ENTER (fail-open), and the run notes say the gate could not check", async () => {
    const { cls, out } = await plan({ mark: 90 }); // the fake throws for an unconfigured SPY close
    expect(cls.classification).toBe("ENTER");
    expect(out.record.notes.some((n) => /^stale-entry gate NVT: not checked \(no SPY close/.test(n))).toBe(true);
  });
  it("staleEntryGate off → ENTER, SPY never read", async () => {
    const { cls, spyReads } = await plan({ mark: 90, spy: { "2026-09-22": 500, "2026-09-24": 500 }, c: resolveTradeConfig({ wMax: 1, sectorMax: 1, staleEntryGate: false }) });
    expect(cls.classification).toBe("ENTER");
    expect(spyReads).toEqual([]);
  });
});
