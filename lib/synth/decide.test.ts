import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "./desk.schema";
import { deriveLabel, type Conviction } from "./conviction";
import { evaluateGates } from "./gates";
import { moatRead } from "./moat";
import { intrinsicRead } from "./intrinsic";
import { decide, SAFE_DEFAULTS } from "./decide";

const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const cfg = desk.rating;

// E 0.12 >= 0.10 but R 0.37 < 0.50 -> HOLD; E 0.25 & R 1.25 -> STRONG BUY.
const HOLDISH: Conviction = { expectedUpside: 0.12, bearDownside: 0.32, rewardRisk: 0.37 };
const STRONGBUYISH: Conviction = { expectedUpside: 0.25, bearDownside: 0.2, rewardRisk: 1.25 };

const distressedGate = { ceiling: "SELL" as const, flags: ["distress"], confidence: "medium" as const };
const cleanGate = { ceiling: "STRONG BUY" as const, flags: [] as string[], confidence: "high" as const };

describe("decide with SAFE_DEFAULTS degrades to the E/R rule", () => {
  it("returns deriveLabel unchanged even when a gate ceiling is lower (advisory only)", () => {
    const d = decide({ conviction: HOLDISH, gate: distressedGate, moat: null, intrinsic: null }, cfg);
    expect(d.label).toBe(deriveLabel(HOLDISH, cfg)); // HOLD
    expect(d.proposed).toBe("HOLD");
    expect(d.advisories.some((a) => /SELL/.test(a))).toBe(true); // the gate is surfaced, not applied
  });
  it("names the E/R proposal as the first reason", () => {
    expect(decide({ conviction: HOLDISH, gate: cleanGate, moat: null, intrinsic: null }, cfg).reasons[0]).toMatch(/E\/R/);
  });
});

describe("policy knobs", () => {
  it("enforceGate applies the gate ceiling as a hard cap", () => {
    const d = decide({ conviction: HOLDISH, gate: distressedGate, moat: null, intrinsic: null }, cfg, { ...SAFE_DEFAULTS, enforceGate: true });
    expect(d.label).toBe("SELL");
    expect(d.reasons.some((r) => /gate/i.test(r))).toBe(true);
  });
  it("requireCorroboration caps an uncorroborated extreme one notch toward HOLD", () => {
    const inputs = { conviction: STRONGBUYISH, gate: cleanGate, moat: { width: "NONE" as const, trend: "STABLE" as const, contingent: false }, intrinsic: { marginOfSafety: -0.3 } };
    expect(decide(inputs, cfg).label).toBe("STRONG BUY"); // off by default
    expect(decide(inputs, cfg, { ...SAFE_DEFAULTS, requireCorroboration: true }).label).toBe("BUY");
  });
  it("leaves a corroborated extreme alone under requireCorroboration", () => {
    const inputs = { conviction: STRONGBUYISH, gate: cleanGate, moat: { width: "WIDE" as const, trend: "WIDENING" as const, contingent: false }, intrinsic: { marginOfSafety: 0.15 } };
    expect(decide(inputs, cfg, { ...SAFE_DEFAULTS, requireCorroboration: true }).label).toBe("STRONG BUY");
  });
});

describe("composite (5.md) in the decision", () => {
  it("blocks a STRONG BUY corroboration when the cross-sectional composite is in the bearish tail", () => {
    const base = { conviction: STRONGBUYISH, gate: cleanGate, moat: { width: "WIDE" as const, trend: "WIDENING" as const, contingent: false }, intrinsic: { marginOfSafety: 0.15 } };
    expect(decide({ ...base, composite: { percentile: 30, confidence: "high" as const } }, cfg, { ...SAFE_DEFAULTS, requireCorroboration: true }).label).toBe("BUY");
    expect(decide({ ...base, composite: { percentile: 80, confidence: "high" as const } }, cfg, { ...SAFE_DEFAULTS, requireCorroboration: true }).label).toBe("STRONG BUY");
  });
  it("a present composite lifts conviction vs a missing one (completeness)", () => {
    const base = { conviction: HOLDISH, gate: cleanGate, moat: { width: "WIDE" as const, trend: "STABLE" as const, contingent: false }, intrinsic: { marginOfSafety: 0.05 } };
    const withComp = decide({ ...base, composite: { percentile: 60, confidence: "high" as const } }, cfg);
    const without = decide(base, cfg);
    expect(withComp.conviction).toBeGreaterThan(without.conviction);
  });
});

describe("conviction score", () => {
  it("is lower when the fundamentals disagree with the rating than when they align", () => {
    const aligned = decide({ conviction: HOLDISH, gate: cleanGate, moat: { width: "WIDE", trend: "STABLE", contingent: false }, intrinsic: { marginOfSafety: 0.05 } }, cfg);
    const conflicted = decide({ conviction: HOLDISH, gate: distressedGate, moat: null, intrinsic: null }, cfg);
    expect(conflicted.conviction).toBeLessThan(aligned.conviction);
    expect(["high", "moderate", "low"]).toContain(aligned.tier);
  });
});

describe("integration — the full layer results satisfy decide's inputs", () => {
  const AMD = JSON.parse(readFileSync("data/facts/AMD/0000002488-26-000123.json", "utf8"));
  it("composes real gate/moat/intrinsic outputs on AMD into a HOLD", () => {
    const d = decide(
      {
        conviction: HOLDISH,
        gate: evaluateGates(AMD),
        moat: moatRead(AMD, { taxRate: 0.15, wacc: 0.119 }),
        intrinsic: intrinsicRead(AMD, { r: 0.11, terminalGrowth: 0.03, horizon: 10 }),
      },
      cfg,
    );
    expect(d.label).toBe("HOLD");
    expect(["high", "moderate", "low"]).toContain(d.tier);
  });
});
