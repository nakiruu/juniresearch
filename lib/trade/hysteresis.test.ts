import { describe, it, expect } from "vitest";
import { classify } from "./hysteresis";
import { DEFAULT_TRADE_CONFIG as cfg, resolveTradeConfig } from "./config";
import type { Signal } from "../portfolio/signal";
import type { Locks } from "./locks";
import type { BreachInfo } from "./breach";

const sig = (o: Partial<Signal> = {}): Signal => ({
  ticker: "NVT", company: "nVent", sector: "35", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.15, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 0.8, kappa: 0.6,
  quality: 1, ageDays: 10, staleness: 0.9, ...o,
});
const NONE: Locks = { buyLockUntil: {}, sellLockUntil: {} };
const TODAY = "2026-09-25";

describe("classify — not held", () => {
  it("ENTERs a fresh BUY above both entry thresholds", () => {
    expect(classify(sig(), false, NONE, TODAY, cfg).classification).toBe("ENTER");
  });
  it("is INELIGIBLE below the entry bar on mu, on R, on conviction, on the gate, on staleness", () => {
    for (const o of [{ mu: 0.05 }, { R: 0.55 }, { kappa: 0.4 }, { gatedLabel: "HOLD" as const }, { ageDays: 130 }, { label: "HOLD" as const }]) {
      const c = classify(sig(o), false, NONE, TODAY, cfg);
      expect(c.classification).toBe("INELIGIBLE");
      expect(c.reasons.length).toBeGreaterThan(0);
    }
  });
  it("is BARRED_ENTRY, with the unlock date, when everything passes but the name is buy-locked", () => {
    const L: Locks = { buyLockUntil: { NVT: "2026-09-29" }, sellLockUntil: {} };
    expect(classify(sig(), false, L, TODAY, cfg)).toEqual({ ticker: "NVT", classification: "BARRED_ENTRY", reasons: ["buy-locked"], unlockOn: "2026-09-29" });
  });
  it("a banned ticker is INELIGIBLE whatever its signal", () => {
    const c = classify(sig({ ticker: "ICE", label: "STRONG BUY", gatedLabel: "STRONG BUY", mu: 0.5, R: 3 }), false, NONE, TODAY, cfg);
    expect(c.classification).toBe("INELIGIBLE");
    expect(c.reasons[0]).toMatch(/banned/);
  });
  it("is INELIGIBLE on a null R (fails the entry gate)", () => {
    const c = classify(sig({ R: null }), false, NONE, TODAY, cfg);
    expect(c.classification).toBe("INELIGIBLE");
    expect(c.reasons.some((r) => r.startsWith("R —"))).toBe(true);
  });
});

describe("classify — held", () => {
  it("HOLDs a name that dipped below the ENTRY bar but is above the EXIT bar (the whole point)", () => {
    // mu 0.05 < muEnter 0.08 but >= muExit 0.03; R 0.45 < rEnter 0.6 but >= rExit 0.35
    expect(classify(sig({ mu: 0.05, R: 0.45, kappa: 0.3 }), true, NONE, TODAY, cfg).classification).toBe("HOLD");
  });
  it("EXITs on mu below the exit floor (rallied to target)", () => {
    const c = classify(sig({ mu: 0.02 }), true, NONE, TODAY, cfg);
    expect(c.classification).toBe("EXIT");
    expect(c.reasons[0]).toMatch(/thesis played out/);
  });
  it("EXITs on R below the exit floor, on a downgrade, on a gate trip, on staleness, on ban", () => {
    for (const o of [{ R: 0.3 }, { label: "HOLD" as const }, { gatedLabel: "SELL" as const }, { ageDays: 121 }, { ticker: "ICE" }]) {
      expect(classify(sig(o), true, NONE, TODAY, cfg).classification).toBe("EXIT");
    }
  });
  it("EXITs on a null R (fails the exit gate)", () => {
    const c = classify(sig({ R: null }), true, NONE, TODAY, cfg);
    expect(c.classification).toBe("EXIT");
    expect(c.reasons.some((r) => r.startsWith("R —"))).toBe(true);
  });
  it("names the bear breach when the price has fallen to or below the bear case (D = 0)", () => {
    const c = classify(sig({ R: null, D: 0, mu: 0.4 }), true, NONE, TODAY, cfg);
    expect(c.classification).toBe("EXIT");
    expect(c.reasons).toContain("R — < exit 0.35 (price at or below the bear case)");
  });
  it("DEFERs an exit while sell-locked and reports the unlock date", () => {
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { NVT: "2026-09-29" } };
    const c = classify(sig({ mu: 0.02 }), true, L, TODAY, cfg);
    expect(c.classification).toBe("DEFER_EXIT");
    expect(c.unlockOn).toBe("2026-09-29");
    expect(c.reasons[0]).toMatch(/thesis played out/);
  });
  it("executes the exit on the unlock day itself", () => {
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { NVT: "2026-09-29" } };
    expect(classify(sig({ mu: 0.02 }), true, L, "2026-09-29", cfg).classification).toBe("EXIT");
  });
});

describe("classify — a held bear breach, by cause (breachPolicy byCause)", () => {
  // At or below the bear: D = 0, R null, every scenario upside (mu large).
  const breached = (o: Partial<Signal> = {}) => sig({ R: null, D: 0, mu: 0.4, ...o });
  const why = (cause: BreachInfo["cause"], share: number): BreachInfo => ({ cause, share, total: -0.2, residual: -0.2 * share, beta: 1.1, spyReturn: -0.1 });
  const PLAIN = "R — < exit 0.35 (price at or below the bear case)";
  const SELL_LOCKED: Locks = { buyLockUntil: {}, sellLockUntil: { NVT: "2026-09-29" } };

  it("HOLDs a market-driven breach", () => {
    expect(classify(breached(), true, NONE, TODAY, cfg, why("market", 0.1))).toEqual({
      ticker: "NVT", classification: "HOLD", reasons: ["bear breach, market-driven (stock-specific share 10%) — holding"],
    });
  });
  it("FREEZEs a mixed breach", () => {
    expect(classify(breached(), true, NONE, TODAY, cfg, why("mixed", 0.7))).toEqual({
      ticker: "NVT", classification: "FREEZE", reasons: ["bear breach, mixed (stock-specific share 70%) — frozen until the report is re-written"],
    });
  });
  it("EXITs a stock-specific breach", () => {
    expect(classify(breached(), true, NONE, TODAY, cfg, why("stock", 1.25))).toEqual({
      ticker: "NVT", classification: "EXIT", reasons: ["bear breach, stock-specific (stock-specific share 125%) — exit"],
    });
  });
  it("a stock-specific breach while sell-locked is a DEFER_EXIT with the unlock date, exactly like any exit", () => {
    expect(classify(breached(), true, SELL_LOCKED, TODAY, cfg, why("stock", 0.95))).toEqual({
      ticker: "NVT", classification: "DEFER_EXIT", reasons: ["bear breach, stock-specific (stock-specific share 95%) — exit"], unlockOn: "2026-09-29",
    });
    expect(classify(breached(), true, SELL_LOCKED, "2026-09-29", cfg, why("stock", 0.95)).classification).toBe("EXIT");
  });
  it("a lock never changes a hold or a freeze (neither trades on its own)", () => {
    expect(classify(breached(), true, SELL_LOCKED, TODAY, cfg, why("market", 0.1)).classification).toBe("HOLD");
    expect(classify(breached(), true, SELL_LOCKED, TODAY, cfg, why("mixed", 0.6)).classification).toBe("FREEZE");
  });
  it("applies only when the bear breach is the SOLE exit reason — a downgrade, gate, staleness or ban still exits", () => {
    for (const o of [{ label: "HOLD" as const }, { gatedLabel: "SELL" as const }, { ageDays: 121 }, { ticker: "ICE" }]) {
      for (const cause of ["market", "mixed"] as const) {
        const c = classify(breached(o), true, NONE, TODAY, cfg, why(cause, 0.2));
        expect(c.classification).toBe("EXIT");
        expect(c.reasons).toContain(PLAIN);
        expect(c.reasons.length).toBe(2);
      }
    }
  });
  it("leaves every other exit untouched: R < rExit with a downside, a null R with a downside, mu below the floor", () => {
    expect(classify(sig({ R: 0.3, D: 0.2 }), true, NONE, TODAY, cfg, why("market", 0.1)).classification).toBe("EXIT");
    expect(classify(sig({ R: null, D: 0.2 }), true, NONE, TODAY, cfg, why("market", 0.1)).classification).toBe("EXIT");
    expect(classify(sig({ mu: 0.02 }), true, NONE, TODAY, cfg, why("market", 0.1)).classification).toBe("EXIT");
  });
  it("missing cause → today's plain bear-breach exit (never a hold on missing data)", () => {
    for (const b of [null, undefined]) {
      expect(classify(breached(), true, NONE, TODAY, cfg, b)).toEqual({ ticker: "NVT", classification: "EXIT", reasons: [PLAIN] });
      expect(classify(breached(), true, SELL_LOCKED, TODAY, cfg, b)).toEqual({ ticker: "NVT", classification: "DEFER_EXIT", reasons: [PLAIN], unlockOn: "2026-09-29" });
    }
  });
  it("breachPolicy \"exit\" ignores the cause: every breach exits as before", () => {
    const exitCfg = resolveTradeConfig({ breachPolicy: "exit" });
    for (const cause of ["market", "mixed", "stock"] as const) {
      expect(classify(breached(), true, NONE, TODAY, exitCfg, why(cause, 0.1))).toEqual({ ticker: "NVT", classification: "EXIT", reasons: [PLAIN] });
    }
  });
  it("a name not held is unchanged: a null R still fails entry, whatever the cause", () => {
    const c = classify(breached(), false, NONE, TODAY, cfg, why("market", 0.1));
    expect(c.classification).toBe("INELIGIBLE");
    expect(c.reasons.some((r) => r.startsWith("R —"))).toBe(true);
  });
});
