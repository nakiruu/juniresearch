import { describe, it, expect } from "vitest";
import { emitTrades } from "./rebalance";
import { resolveTradeConfig } from "./config";
import type { Signal } from "../portfolio/signal";
import type { Locks } from "./locks";
import type { BreachInfo } from "./breach";

const sig = (o: Partial<Signal> = {}): Signal => ({
  ticker: "A", company: "A", sector: "35", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.15, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 0.8, kappa: 0.6,
  quality: 1, ageDays: 10, staleness: 1, ...o,
});
const NONE: Locks = { buyLockUntil: {}, sellLockUntil: {} };
const TODAY = "2026-09-25";
// Wide caps so targets are readable: two equal-score names split the target 50/50.
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 });
const run = (signals: Signal[], currentWeights: Record<string, number>, locks = NONE, c = cfg) =>
  emitTrades({ signals, currentWeights, locks, today: TODAY, cfg: c });

describe("emitTrades", () => {
  it("ENTERs a new name by buying to its target, leaving the cash floor", () => {
    const p = run([sig()], {});
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "A", side: "buy", reason: "ENTER", currentWeight: 0 })]);
    expect(p.trades[0].targetWeight).toBeCloseTo(0.99, 9);
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
  });

  it("freezes a deferred exit and sizes the rest into the reduced target", () => {
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { A: "2026-09-29" } };
    const p = run([sig({ ticker: "A", mu: 0.02 }), sig({ ticker: "B" })], { A: 0.30 }, L);
    expect(p.frozenWeight).toBeCloseTo(0.30, 9);
    expect(p.sizingTarget).toBeCloseTo(0.69, 9);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "DEFER_EXIT", unlockOn: "2026-09-29", targetWeight: 0.30 }));
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "B", side: "buy", reason: "ENTER" })]);
    expect(p.trades[0].deltaWeight).toBeCloseTo(0.69, 9);
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
  });

  it("bars a buy-locked entry and leaves its capital in cash", () => {
    const L: Locks = { buyLockUntil: { A: "2026-09-29" }, sellLockUntil: {} };
    const p = run([sig()], {}, L);
    expect(p.trades).toEqual([]);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BARRED_ENTRY", unlockOn: "2026-09-29" }));
    expect(p.plannedCash).toBeCloseTo(1, 9);
  });

  it("suppresses a drift inside the band and trades one outside it (ADD)", () => {
    // Equal scores → targets 0.495 each. A drifted +1.5pp (inside 2.5pp band); B is 9.5pp under.
    const p = run([sig({ ticker: "A" }), sig({ ticker: "B" })], { A: 0.48, B: 0.40 });
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BELOW_BAND" }));
    const b = p.trades.find((t) => t.ticker === "B")!;
    expect(b).toEqual(expect.objectContaining({ side: "buy", reason: "ADD" }));
    expect(b.deltaWeight).toBeCloseTo(0.095, 9);
  });

  it("defers a sell-locked trim and never leverages: the freed room is not spent", () => {
    // A is 10.5pp OVER target but sell-locked → DEFER_TRIM. B is 10.5pp under → wants an ADD,
    // but buying it would push invested to 1.095. Buys are scaled to keep cash ≥ floor.
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { A: "2026-09-29" } };
    const p = run([sig({ ticker: "A" }), sig({ ticker: "B" })], { A: 0.60, B: 0.39 }, L);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "DEFER_TRIM", unlockOn: "2026-09-29" }));
    expect(p.buyScale).toBeCloseTo(0, 9);
    expect(p.trades.filter((t) => t.side === "buy")).toEqual([]);           // the scaled-to-zero buy is dropped …
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "B", code: "NO_CAPACITY" })); // … and recorded
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
    expect(p.plannedInvested).toBeLessThanOrEqual(0.99 + 1e-9);
  });

  it("EXITs by selling the whole position", () => {
    const p = run([sig({ mu: 0.02 })], { A: 0.07 });
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "A", side: "sell", reason: "EXIT", currentWeight: 0.07, targetWeight: 0 })]);
    expect(p.trades[0].deltaWeight).toBeCloseTo(-0.07, 9);
  });

  it("never buys a banned ticker, but does emit the sell that disposes of one", () => {
    const ice = sig({ ticker: "ICE", label: "STRONG BUY", gatedLabel: "STRONG BUY", mu: 0.5, R: 3 });
    expect(run([ice], {}).skipped).toContainEqual(expect.objectContaining({ ticker: "ICE", code: "INELIGIBLE" }));
    const held = run([ice], { ICE: 0.05 });
    expect(held.trades).toEqual([expect.objectContaining({ ticker: "ICE", side: "sell", reason: "EXIT" })]);
  });

  it("freezes a held name that has no signal instead of trading on missing data", () => {
    const p = run([sig({ ticker: "B" })], { GONE: 0.20 });
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "GONE", code: "NO_SIGNAL", currentWeight: 0.20 }));
    expect(p.frozenWeight).toBeCloseTo(0.20, 9);
    expect(p.trades.find((t) => t.ticker === "B")!.deltaWeight).toBeCloseTo(0.79, 9);
  });

  it("applies the quality tilt when enabled and not when disabled", () => {
    const hi = sig({ ticker: "A", quality: 1.2 }), lo = sig({ ticker: "B", quality: 0.8 });
    const tilted = run([hi, lo], {});
    const flat = run([hi, lo], {}, NONE, resolveTradeConfig({ wMax: 1, sectorMax: 1, useQualityTilt: false }));
    const w = (p: ReturnType<typeof run>, t: string) => p.trades.find((x) => x.ticker === t)!.targetWeight;
    expect(w(tilted, "A")).toBeGreaterThan(w(tilted, "B"));
    expect(w(flat, "A")).toBeCloseTo(w(flat, "B"), 9);
  });
});

describe("bear breaches by cause (breachPolicy byCause)", () => {
  // A held at or below its bear: D = 0, R null; its cause comes in through `breaches`.
  const breached = sig({ ticker: "A", R: null, D: 0, mu: 0.4 });
  const why = (cause: BreachInfo["cause"], share: number): BreachInfo => ({ cause, share, total: -0.2, residual: -0.2 * share, beta: 1, spyReturn: -0.1 });
  const runB = (signals: Signal[], currentWeights: Record<string, number>, breaches: Record<string, BreachInfo>, locks = NONE, c = cfg) =>
    emitTrades({ signals, currentWeights, locks, today: TODAY, cfg: c, breaches });

  it("FREEZE keeps the current weight untraded, counts it as frozen, and sizes the rest into what is left", () => {
    const p = runB([breached, sig({ ticker: "B" })], { A: 0.30 }, { A: why("mixed", 0.7) });
    expect(p.classifications.find((c) => c.ticker === "A")!.classification).toBe("FREEZE");
    expect(p.frozenWeight).toBeCloseTo(0.30, 9);
    expect(p.sizingTarget).toBeCloseTo(0.69, 9);
    expect(p.skipped).toContainEqual({ ticker: "A", code: "FREEZE", reasons: ["bear breach, mixed (stock-specific share 70%) — frozen until the report is re-written"], unlockOn: undefined, currentWeight: 0.30, targetWeight: 0.30 });
    expect(p.trades.map((t) => t.ticker)).toEqual(["B"]);
    expect(p.trades[0].deltaWeight).toBeCloseTo(0.69, 9);
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
  });
  it("FREEZE never adds or trims, even far off target, and never pushes the book past the cash floor", () => {
    // A frozen at 0.70; B held at 0.20 wants the rest (0.29): an ADD that lands exactly on the floor, nothing more.
    const p = runB([breached, sig({ ticker: "B" })], { A: 0.70, B: 0.20 }, { A: why("mixed", 0.5) });
    expect(p.trades.find((t) => t.ticker === "A")).toBeUndefined();
    expect(p.trades.find((t) => t.ticker === "B")!.deltaWeight).toBeCloseTo(0.09, 9);
    expect(p.plannedInvested).toBeLessThanOrEqual(0.99 + 1e-9);
    // A frozen at 0.60 and B over target but sell-locked (DEFER_TRIM, kept at 0.39): C's ENTER would lever the
    // book, so buys scale to zero — the frozen weight is never sold to make room, and cash never goes below the floor.
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { B: "2026-09-29" } };
    const q = runB([breached, sig({ ticker: "B" }), sig({ ticker: "C" })], { A: 0.60, B: 0.39 }, { A: why("mixed", 0.6) }, L);
    expect(q.trades).toEqual([]);
    expect(q.buyScale).toBeCloseTo(0, 9);
    expect(q.skipped).toContainEqual(expect.objectContaining({ ticker: "C", code: "NO_CAPACITY" }));
    expect(q.plannedCash).toBeCloseTo(0.01, 9);
  });
  it("a market-driven breach is a HOLD sized through the bear floor: positive target, ADD when under it outside the band", () => {
    const capped = resolveTradeConfig(); // wMax 10%
    const p = runB([breached, sig({ ticker: "B", sector: "20" })], { A: 0.04 }, { A: why("market", 0.1) }, NONE, capped);
    expect(p.classifications.find((c) => c.ticker === "A")!.classification).toBe("HOLD");
    const a = p.trades.find((t) => t.ticker === "A")!;
    expect(a).toEqual(expect.objectContaining({ side: "buy", reason: "ADD", currentWeight: 0.04 }));
    expect(a.targetWeight).toBeCloseTo(0.10, 9);
    expect(a.deltaWeight).toBeCloseTo(0.06, 9);
  });
  it("a market-driven HOLD still respects a buy lock (BARRED_ADD)", () => {
    const L: Locks = { buyLockUntil: { A: "2026-09-29" }, sellLockUntil: {} };
    const p = runB([breached], { A: 0.04 }, { A: why("market", 0.1) }, L, resolveTradeConfig());
    expect(p.trades).toEqual([]);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BARRED_ADD", unlockOn: "2026-09-29" }));
  });
  it("without a cause (or under breachPolicy exit) the breach sells the whole position, as before", () => {
    for (const p of [runB([breached], { A: 0.07 }, {}), runB([breached], { A: 0.07 }, { A: why("market", 0.1) }, NONE, resolveTradeConfig({ wMax: 1, sectorMax: 1, breachPolicy: "exit" }))]) {
      expect(p.trades).toEqual([expect.objectContaining({ ticker: "A", side: "sell", reason: "EXIT", currentWeight: 0.07, targetWeight: 0 })]);
    }
  });
  it("a stock-specific breach exits, or waits out a sell lock frozen at its weight (DEFER_EXIT)", () => {
    expect(runB([breached], { A: 0.07 }, { A: why("stock", 0.95) }).trades).toEqual([expect.objectContaining({ ticker: "A", reason: "EXIT" })]);
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { A: "2026-09-29" } };
    const p = runB([breached], { A: 0.07 }, { A: why("stock", 0.95) }, L);
    expect(p.trades).toEqual([]);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "DEFER_EXIT", unlockOn: "2026-09-29", targetWeight: 0.07 }));
    expect(p.frozenWeight).toBeCloseTo(0.07, 9);
  });
  it("a cause on a name not held never makes it enterable", () => {
    const p = runB([breached], {}, { A: why("market", 0.1) });
    expect(p.trades).toEqual([]);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "INELIGIBLE" }));
  });
});

describe("residual top-up of recent buys (topUpRecentBuys, spec #8)", () => {
  const on = resolveTradeConfig({ wMax: 1, sectorMax: 1, topUpRecentBuys: true });
  const recentBuy: Locks = { buyLockUntil: {}, sellLockUntil: { A: "2026-09-29" } }; // bought inside the lock window
  // One name → target 0.99; held 0.98 is a 1pp gap: inside tradeBand (2.5pp), outside residualBand (0.5pp).
  it("tops up a sell-locked (recently bought) name through the smaller band", () => {
    const p = run([sig()], { A: 0.98 }, recentBuy, on);
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "A", side: "buy", reason: "ADD", note: "residual" })]);
    expect(p.trades[0].deltaWeight).toBeCloseTo(0.01, 9);
  });
  it("leaves an unlocked name to the normal band", () => {
    expect(run([sig()], { A: 0.98 }, NONE, on).skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BELOW_BAND" }));
  });
  it("never applies to the sell side", () => {
    const p = run([sig()], { A: 1.0 }, recentBuy, on);
    expect(p.trades).toEqual([]);
  });
  it("ignores a gap inside the residual band", () => {
    expect(run([sig()], { A: 0.987 }, recentBuy, on).trades).toEqual([]);
  });
  it("never buys a buy-locked name", () => {
    const both: Locks = { buyLockUntil: { A: "2026-09-29" }, sellLockUntil: { A: "2026-09-29" } };
    expect(run([sig()], { A: 0.98 }, both, on).trades).toEqual([]);
  });
  it("is off by default — exactly today's behaviour", () => {
    expect(run([sig()], { A: 0.98 }, recentBuy).skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BELOW_BAND" }));
  });
  it("resolveTradeConfig keeps residualBand within tradeBand", () => {
    expect(() => resolveTradeConfig({ residualBand: 0.03 })).toThrow(/residualBand/);
    expect(() => resolveTradeConfig({ residualBand: 0 })).toThrow(/residualBand/);
  });
});
