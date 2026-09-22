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
import { uncertaintyMultiplier, type UncertaintyTier } from "./uncertainty";

export interface DecisionPolicy {
  enforceGate: boolean; // the gate ceiling hard-caps the label
  requireCorroboration: boolean; // an extreme (STRONG BUY/SELL) needs the layers to agree
  applyMoatFloor: boolean; // the moat's minimum bear depth deepens D before deriveLabel (3.md Lever 1)
  applyUncertaintyBands: boolean; // the uncertainty tier widens the bullish minimum-upside band (11.md §3)
  maxNotches: 1 | 2; // most notches disagreement may pull toward HOLD
}
export const SAFE_DEFAULTS: DecisionPolicy = { enforceGate: false, requireCorroboration: false, applyMoatFloor: false, applyUncertaintyBands: false, maxNotches: 1 };

// Narrow structural shapes — the full GateResult / MoatResult / IntrinsicResult / CompositeResult satisfy them.
export interface DecisionInputs {
  conviction: Conviction;
  gate: { ceiling: RatingLabel; flags: string[]; confidence: "high" | "medium" | "low" };
  moat: { width: MoatWidth; trend: MoatTrend; contingent: boolean; bearFloor?: number } | null;
  intrinsic: { marginOfSafety: number } | null;
  composite?: { percentile: number | null; confidence: "high" | "medium" | "low" } | null;
  market?: { targetDispersion: number | null; divergence?: number | null } | null; // dispersion; |E_mech − E_Street|
  uncertainty?: { tier: UncertaintyTier } | null;
  published?: RatingLabel; // the author's label, if a report is being scored
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
  const composite = inputs.composite ?? null;

  // Uncertainty widens the minimum upside a bullish label demands (11.md §3). Opt-in; the widened
  // thresholds (`eff`) are then used for every label derivation below so the whole decision is
  // consistent. One-way: a higher bar can only lower the label.
  const uTier = inputs.uncertainty?.tier ?? null;
  const mult = policy.applyUncertaintyBands && uTier ? uncertaintyMultiplier(uTier) : 1;
  const eff: DeskRating =
    mult === 1 ? cfg : { ...cfg, buy: { ...cfg.buy, minUpside: cfg.buy.minUpside * mult }, strongBuy: { ...cfg.strongBuy, minUpside: cfg.strongBuy.minUpside * mult } };

  const proposed = deriveLabel(c, eff);
  let label = proposed;
  const reasons: string[] = [`E/R proposed ${proposed}`];
  if (mult !== 1 && proposed !== deriveLabel(c, cfg)) reasons.push(`uncertainty ${uTier} widened the band → ${proposed}`);
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

  // --- Moat bear-depth floor (3.md Lever 1): a thin/eroding moat forces a deeper bear,
  // which lowers R and can only tighten the label. Opt-in; one-way toward HOLD. ---
  if (policy.applyMoatFloor && moat?.bearFloor != null && moat.bearFloor > c.bearDownside) {
    const dFloored = moat.bearFloor;
    const rFloored = dFloored > 0 ? c.expectedUpside / dFloored : null;
    const flooredLabel = deriveLabel({ ...c, bearDownside: dFloored, rewardRisk: rFloored }, eff);
    if (rank(flooredLabel) < rank(label)) {
      label = flooredLabel;
      reasons.push(`moat bear floor ${(dFloored * 100).toFixed(0)}% (${moat.width}/${moat.trend}) → ${label}`);
    }
  }

  // --- Corroboration (L3): an extreme must be backed by moat + intrinsic. Opt-in. ---
  if (policy.requireCorroboration && (label === "STRONG BUY" || label === "STRONG SELL")) {
    const compTail = composite?.percentile;
    const agree =
      label === "STRONG BUY"
        ? moat?.width === "WIDE" && moat.trend !== "ERODING" && (intrinsic ? intrinsic.marginOfSafety > 0 : true) && (compTail == null || compTail >= 50)
        : gate.flags.includes("distress") && (intrinsic ? intrinsic.marginOfSafety < 0 : true) && (compTail == null || compTail <= 50);
    if (!agree) {
      label = towardHold(label);
      reasons.push(`extreme not corroborated → ${label}`);
    }
  }

  // --- Conviction: a penalty model. Confidence starts at 100 and doubt subtracts. ---
  let score = 100;
  if (gateBinds) score -= 25; // the fundamentals disagree with the rating
  if (moat && moat.trend === "ERODING" && isBullish(label)) score -= 15;
  // A value/expected-return disagreement only counts against a bullish call — a HOLD is often the
  // correct synthesis of exactly that disagreement, so it is not penalised for it (7.md I4).
  if (isBullish(label) && intrinsic && sign(intrinsic.marginOfSafety) !== 0 && sign(intrinsic.marginOfSafety) !== sign(c.expectedUpside)) score -= 20;
  // Contested name: a wide analyst-target spread is a market proxy for uncertainty (6.md 4.1).
  const disp = inputs.market?.targetDispersion;
  if (disp != null) score -= Math.round(Math.min(1, Math.max(0, disp)) * 15);
  // The model and the Street disagree sharply on value — real uncertainty, not an error (4.md §8).
  const divergence = inputs.market?.divergence;
  if (divergence != null && divergence > 0.25) score -= 10;
  if (!intrinsic) score -= 10; // could not value intrinsically
  if (!moat) score -= 10;
  if (!composite || composite.percentile == null) score -= 10; // no cross-sectional read
  if (gate.confidence === "low") score -= 10;
  if (moat?.contingent) score -= 5;
  score = Math.max(0, Math.min(100, score));
  const tier: Decision["tier"] = score >= 70 ? "high" : score >= 45 ? "moderate" : "low";

  // The report carries the author's label; note when it differs from the composed recommendation so
  // the two persisted labels are never silently inconsistent (7.md I5).
  if (inputs.published && inputs.published !== label)
    advisories.push(`author's published label ${inputs.published} differs from the composed ${label}`);

  return { label, proposed, conviction: score, tier, reasons, advisories };
}
