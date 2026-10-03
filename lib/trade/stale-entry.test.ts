import { describe, it, expect } from "vitest";
import { classifyStaleEntry, fellEnough, staleEntryReason, usableMiss } from "./stale-entry";
import { DEFAULT_TRADE_CONFIG as cfg, resolveTradeConfig } from "./config";
import type { LastEarnings } from "./earnings";

const TODAY = "2026-09-25";
const miss: LastEarnings = { reportDate: "2026-08-05", surprisePct: -12, epsActual: 0.88, epsEstimate: 1 };
const beat: LastEarnings = { ...miss, surprisePct: 8 };
// Report priced at $100; the name now trades at $90 (−10%); SPY flat unless set.
const gate = (o: Partial<{ price: number; p0: number; spyNow: number; spy0: number; beta: number; earnings: LastEarnings | null; today: string }> = {}, c = cfg) =>
  classifyStaleEntry({ price: 90, p0: 100, spyNow: 500, spy0: 500, beta: 1.2, earnings: miss, today: TODAY, ...o }, c);

describe("classifyStaleEntry", () => {
  it("bars a stock-specific fall after a miss, and says why", () => {
    const g = gate()!;
    expect(g).toMatchObject({ share: 1, beta: 1.2, spyReturn: 0, surprisePct: -12, earningsDate: "2026-08-05" });
    expect(g.fall).toBeCloseTo(-0.1, 12);
    expect(staleEntryReason(g)).toBe("stale on bad news: down 10% since the report, stock-specific (share 100%), last earnings missed (-12.0% on 2026-08-05) — re-write the report");
  });
  it("lets the entry through after a beat, or with no earnings at all", () => {
    expect(gate({ earnings: beat })).toBeNull();
    expect(gate({ earnings: null })).toBeNull();
    expect(gate({ earnings: { ...miss, surprisePct: 0 } })).toBeNull(); // in line is not a miss
  });
  it("lets the entry through when the market explains the fall (market-driven or mixed)", () => {
    expect(gate({ spyNow: 460 })).toBeNull(); // SPY −8% × 1.2 = −9.6% of −10% → share 4% → market
    expect(gate({ spyNow: 480 })).toBeNull(); // −4.8% of −10% → share 52% → mixed
  });
  it("a stock that fell while the market rose is stock-specific (share > 1)", () => {
    expect(gate({ spyNow: 525 })!.share).toBeCloseTo(1.6, 12);
  });
  it("ignores falls smaller than staleEntryMinFall (5%) — noise for the cause split", () => {
    expect(gate({ price: 95.5 })).toBeNull();
    expect(gate({ price: 95 })).not.toBeNull(); // exactly −5% counts
    expect(gate({ price: 104 })).toBeNull(); // above the report price
  });
  it("ignores an earnings result older than staleEntryEarningsMaxDays, or dated after today", () => {
    expect(gate({ earnings: { ...miss, reportDate: "2026-05-28" } })).not.toBeNull(); // 120 days → still used
    expect(gate({ earnings: { ...miss, reportDate: "2026-05-27" } })).toBeNull(); // 121 days
    expect(gate({ earnings: { ...miss, reportDate: "2026-07-01" } }, resolveTradeConfig({ staleEntryEarningsMaxDays: 60 }))).toBeNull();
    expect(gate({ earnings: { ...miss, reportDate: "2026-09-26" } })).toBeNull();
  });
  it("any missing or non-positive price input, or the gate turned off → null", () => {
    expect(gate({ spy0: 0 })).toBeNull();
    expect(gate({ beta: 0 })).toBeNull();
    expect(gate({ p0: 0 })).toBeNull();
    expect(gate({}, resolveTradeConfig({ staleEntryGate: false }))).toBeNull();
  });
});

describe("usableMiss / fellEnough", () => {
  it("usableMiss: a miss reported on/before today and at most 120 days ago", () => {
    expect(usableMiss(miss, TODAY, cfg)).toBe(miss);
    expect(usableMiss({ ...miss, reportDate: "2026-05-28" }, TODAY, cfg)).not.toBeNull(); // day 120
    expect(usableMiss({ ...miss, reportDate: "2026-05-27" }, TODAY, cfg)).toBeNull(); // day 121
    expect(usableMiss(miss, "2026-08-04", cfg)).toBeNull(); // not yet reported as of that day
    expect(usableMiss(beat, TODAY, cfg)).toBeNull();
    expect(usableMiss(undefined, TODAY, cfg)).toBeNull();
  });
  it("fellEnough: at least staleEntryMinFall below the report price", () => {
    expect(fellEnough(95, 100, cfg)).toBe(true);
    expect(fellEnough(95.01, 100, cfg)).toBe(false);
    expect(fellEnough(0, 100, cfg)).toBe(false);
  });
});
