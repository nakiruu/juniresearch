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
const distressedGateHigh = { ceiling: "SELL" as const, flags: ["distress"], confidence: "high" as const };
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
  it("enforceGate applies a HIGH-confidence gate ceiling as a hard cap", () => {
    const d = decide({ conviction: HOLDISH, gate: distressedGateHigh, moat: null, intrinsic: null }, cfg, { ...SAFE_DEFAULTS, enforceGate: true });
    expect(d.label).toBe("SELL");
    expect(d.reasons.some((r) => /gate/i.test(r))).toBe(true);
  });
  it("does NOT hard-cap a medium-confidence gate even under enforceGate (rare and severe — 6.md veto-collapse guard)", () => {
    // The CRWV case: a real but medium-confidence distress flag must not override a considered rating.
    const d = decide({ conviction: HOLDISH, gate: distressedGate, moat: null, intrinsic: null }, cfg, { ...SAFE_DEFAULTS, enforceGate: true });
    expect(d.label).toBe("HOLD"); // the ceiling stays advisory, not applied
    expect(d.advisories.some((a) => /SELL/.test(a))).toBe(true);
    // but the disagreement still costs conviction — a medium flag is a real concern, just not a veto
    const clean = decide({ conviction: HOLDISH, gate: cleanGate, moat: null, intrinsic: null }, cfg, { ...SAFE_DEFAULTS, enforceGate: true });
    expect(d.conviction).toBeLessThan(clean.conviction);
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

describe("uncertainty bands (11.md §3)", () => {
  // E 0.12, D 0.20, R 0.60 -> BUY at Low; a High tier widens the BUY bar (0.10 -> 0.18) -> HOLD.
  const MARGINAL_BUY: Conviction = { expectedUpside: 0.12, bearDownside: 0.2, rewardRisk: 0.6 };
  it("is off under SAFE_DEFAULTS (the tier does not move the label)", () => {
    expect(decide({ conviction: MARGINAL_BUY, gate: cleanGate, moat: null, intrinsic: null, uncertainty: { tier: "high" } }, cfg).label).toBe("BUY");
  });
  it("widens the bullish band under a High tier when applyUncertaintyBands is on", () => {
    const d = decide({ conviction: MARGINAL_BUY, gate: cleanGate, moat: null, intrinsic: null, uncertainty: { tier: "high" } }, cfg, { ...SAFE_DEFAULTS, applyUncertaintyBands: true });
    expect(d.label).toBe("HOLD");
    expect(d.reasons.some((r) => /uncertainty/i.test(r))).toBe(true);
  });
  it("leaves the label unchanged at a Low tier even with the knob on", () => {
    expect(decide({ conviction: MARGINAL_BUY, gate: cleanGate, moat: null, intrinsic: null, uncertainty: { tier: "low" } }, cfg, { ...SAFE_DEFAULTS, applyUncertaintyBands: true }).label).toBe("BUY");
  });
});

describe("moat bear-depth floor (3.md Lever 1)", () => {
  // E 0.12, D 0.20, R 0.60 -> BUY. A thin moat forces a deeper bear -> lower R -> HOLD.
  const BUYISH: Conviction = { expectedUpside: 0.12, bearDownside: 0.2, rewardRisk: 0.6 };
  const thin = { width: "NONE" as const, trend: "STABLE" as const, contingent: false, bearFloor: 0.3 };
  const wide = { width: "WIDE" as const, trend: "WIDENING" as const, contingent: false, bearFloor: 0.15 };
  it("is off under SAFE_DEFAULTS (label stays the raw E/R BUY)", () => {
    expect(decide({ conviction: BUYISH, gate: cleanGate, moat: thin, intrinsic: null }, cfg).label).toBe("BUY");
  });
  it("deepens the bear for a thin moat and downgrades BUY -> HOLD when applyMoatFloor is on", () => {
    const d = decide({ conviction: BUYISH, gate: cleanGate, moat: thin, intrinsic: null }, cfg, { ...SAFE_DEFAULTS, applyMoatFloor: true });
    expect(d.label).toBe("HOLD");
    expect(d.reasons.some((r) => /moat bear floor/i.test(r))).toBe(true);
  });
  it("does not bind for a wide moat whose floor (0.15) is below the actual bear (0.20)", () => {
    expect(decide({ conviction: BUYISH, gate: cleanGate, moat: wide, intrinsic: null }, cfg, { ...SAFE_DEFAULTS, applyMoatFloor: true }).label).toBe("BUY");
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

describe("Street-vs-model divergence and the published label (I12, I5)", () => {
  const base = { conviction: HOLDISH, gate: cleanGate, moat: { width: "WIDE" as const, trend: "STABLE" as const, contingent: false }, intrinsic: { marginOfSafety: 0.05 } };
  it("penalises a large model-vs-Street divergence (4.md §8)", () => {
    const aligned = decide({ ...base, market: { targetDispersion: 0.2, divergence: 0.05 } }, cfg);
    const diverged = decide({ ...base, market: { targetDispersion: 0.2, divergence: 0.7 } }, cfg);
    expect(diverged.conviction).toBeLessThan(aligned.conviction);
  });
  it("notes when the author's published label differs from the composed one (I5)", () => {
    const d = decide({ conviction: HOLDISH, gate: cleanGate, moat: null, intrinsic: null, published: "SELL" }, cfg);
    expect(d.label).toBe("HOLD"); // the composed recommendation
    expect(d.advisories.some((a) => /author|published/i.test(a))).toBe(true);
  });
});

describe("conviction: analyst-target dispersion and the HOLD synthesis (I13, I4)", () => {
  const base = { conviction: HOLDISH, gate: cleanGate, moat: { width: "WIDE" as const, trend: "STABLE" as const, contingent: false }, intrinsic: { marginOfSafety: 0.05 } };
  it("penalises wide analyst-target dispersion (6.md 4.1)", () => {
    const tight = decide({ ...base, market: { targetDispersion: 0.1 } }, cfg);
    const wide = decide({ ...base, market: { targetDispersion: 1.58 } }, cfg);
    expect(wide.conviction).toBeLessThan(tight.conviction);
  });
  it("does not apply the MoS/E-sign penalty to a HOLD (a HOLD is the synthesis of that disagreement)", () => {
    const disagree = decide({ conviction: HOLDISH, gate: cleanGate, moat: null, intrinsic: { marginOfSafety: -0.6 } }, cfg);
    const agree = decide({ conviction: HOLDISH, gate: cleanGate, moat: null, intrinsic: { marginOfSafety: 0.1 } }, cfg);
    expect(disagree.conviction).toBe(agree.conviction);
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
  const AMD = JSON.parse(readFileSync("lib/synth/__fixtures__/packs/AMD/0000002488-26-000123.json", "utf8"));
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
