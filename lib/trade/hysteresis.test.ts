import { describe, it, expect } from "vitest";
import { classify } from "./hysteresis";
import { DEFAULT_TRADE_CONFIG as cfg } from "./config";
import type { Signal } from "../portfolio/signal";
import type { Locks } from "./locks";

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
