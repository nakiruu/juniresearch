/**
 * decide.ts — the aggregation / decision layer (6.md).
 * -----------------------------------------------------------------------------
 * Composes the E/R rule (conviction.ts) with the three fundamental views — the
 * distress/quality gate (5.md), the moat/durability read (3.md), and the
 * intrinsic-value margin of safety (4.md) — into one label plus a conviction
 * score and a machine-readable reason. It is non-compensatory and one-way: the
 * E/R rule proposes, the other layers can only cap/annotate or (under an opt-in
 * policy) require corroboration for an extreme; nothing makes the label more
 * bullish than E/R allows — the existing conviction.ts invariant, generalized.
 *
 * SAFE DEFAULTS: every policy knob is off, so decide() returns exactly the
 * deriveLabel() the desk uses today (6.md §6.4's graceful degrade). The gate,
 * moat and intrinsic views still flow into the conviction score and the
 * advisories, but they do not move the label until a knob is turned on.
 */
import type { RatingLabel } from "./judgment.schema";
import type { DeskRating } from "./desk.schema";
import { deriveLabel, type Conviction } from "./conviction";
import { applyGateCeiling } from "./gates";
import type { MoatWidth, MoatTrend } from "./moat";

export interface DecisionPolicy {
  enforceGate: boolean; // the gate ceiling hard-caps the label
  requireCorroboration: boolean; // an extreme (STRONG BUY/SELL) needs the layers to agree
  maxNotches: 1 | 2; // most notches disagreement may pull toward HOLD
}
export const SAFE_DEFAULTS: DecisionPolicy = { enforceGate: false, requireCorroboration: false, maxNotches: 1 };

// Narrow structural shapes — the full GateResult / MoatResult / IntrinsicResult satisfy them.
export interface DecisionInputs {
  conviction: Conviction;
  gate: { ceiling: RatingLabel; flags: string[]; confidence: "high" | "medium" | "low" };
  moat: { width: MoatWidth; trend: MoatTrend; contingent: boolean } | null;
  intrinsic: { marginOfSafety: number } | null;
}

export interface Decision {
  label: RatingLabel;
  proposed: RatingLabel; // the raw E/R label
  conviction: number; // 0-100
  tier: "high" | "moderate" | "low";
  reasons: string[]; // binding constraints that shaped the label
  advisories: string[]; // non-binding notes (what a layer said without being enforced)
}

const ORDER: RatingLabel[] = ["STRONG SELL", "SELL", "HOLD", "BUY", "STRONG BUY"];
const rank = (l: RatingLabel) => ORDER.indexOf(l);
const towardHold = (l: RatingLabel): RatingLabel =>
  l === "HOLD" ? l : ORDER[rank(l) + (rank(l) > rank("HOLD") ? -1 : 1)];
const isBullish = (l: RatingLabel) => l === "BUY" || l === "STRONG BUY";
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export function decide(inputs: DecisionInputs, cfg: DeskRating, policy: DecisionPolicy = SAFE_DEFAULTS): Decision {
  const { conviction: c, gate, moat, intrinsic } = inputs;
  const proposed = deriveLabel(c, cfg);
  let label = proposed;
  const reasons: string[] = [`E/R proposed ${proposed}`];
  const advisories: string[] = [];

  // --- Gate (L0): a fundamental ceiling. Hard cap only under policy; else advisory. ---
  const gateBinds = rank(gate.ceiling) < rank(label);
  if (gateBinds) {
    const why = gate.flags.length ? gate.flags.join(", ") : "gate";
    if (policy.enforceGate) {
      label = applyGateCeiling(label, gate.ceiling);
      reasons.push(`gate cap → ${label} (${why})`);
    } else {
      advisories.push(`gate ceiling ${gate.ceiling} (${why}) — advisory, not applied`);
    }
  }

  // --- Corroboration (L3): an extreme must be backed by moat + intrinsic. Opt-in. ---
  if (policy.requireCorroboration && (label === "STRONG BUY" || label === "STRONG SELL")) {
    const agree =
      label === "STRONG BUY"
        ? moat?.width === "WIDE" && moat.trend !== "ERODING" && (intrinsic ? intrinsic.marginOfSafety > 0 : true)
        : gate.flags.includes("distress") && (intrinsic ? intrinsic.marginOfSafety < 0 : true);
    if (!agree) {
      label = towardHold(label);
      reasons.push(`extreme not corroborated → ${label}`);
    }
  }

  // --- Conviction: a penalty model. Confidence starts at 100 and doubt subtracts. ---
  let score = 100;
  if (gateBinds) score -= 25; // the fundamentals disagree with the rating
  if (moat && moat.trend === "ERODING" && isBullish(label)) score -= 15;
  if (intrinsic && sign(intrinsic.marginOfSafety) !== 0 && sign(intrinsic.marginOfSafety) !== sign(c.expectedUpside)) score -= 20;
  if (!intrinsic) score -= 10; // could not value intrinsically
  if (!moat) score -= 10;
  if (gate.confidence === "low") score -= 10;
  if (moat?.contingent) score -= 5;
  score = Math.max(0, Math.min(100, score));
  const tier: Decision["tier"] = score >= 70 ? "high" : score >= 45 ? "moderate" : "low";

  return { label, proposed, conviction: score, tier, reasons, advisories };
}
