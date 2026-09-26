/**
 * conviction.ts — the two numbers the rating rests on, and the label they imply.
 * -----------------------------------------------------------------------------
 * Expected upside E is the probability-weighted fair value against the current
 * price; bear-case downside D is the bear implied price against the current price
 * (a positive magnitude); reward/risk R = E / D is the upside earned per unit of
 * bear-case loss, null when the bear is not below the price. The label is a
 * function of (E, R) with no overlap zone; the author may sit one notch more
 * conservative than it (see conservativeNotch), never more aggressive.
 */
import { computeScenarios, upside, type ScenarioIn } from "../format";
import type { RatingLabel } from "./judgment.schema";
import type { DeskRating } from "./desk.schema";

export interface Conviction {
  expectedUpside: number;
  bearDownside: number;
  rewardRisk: number | null;
}

export function computeConviction(scenarios: ScenarioIn[], price: number): Conviction {
  const { fairValue } = computeScenarios(scenarios);
  const expectedUpside = upside(fairValue, price);
  const bear = scenarios.find((s) => /bear/i.test(s.name));
  const bearDownside = bear ? (price - bear.impliedPrice) / price : 0;
  const rewardRisk = bearDownside > 0 ? expectedUpside / bearDownside : null;
  return { expectedUpside, bearDownside, rewardRisk };
}

/**
 * How much the author's own scenarios disagree: the probability-weighted standard deviation of the
 * scenario returns vs `price`. 0 when there are no scenarios or no price.
 */
export function scenarioDispersion(scenarios: Pick<ScenarioIn, "impliedPrice" | "probability">[], price: number): number {
  if (!(price > 0) || !scenarios.length) return 0;
  const rets = scenarios.map((s) => ({ p: s.probability, r: s.impliedPrice / price - 1 }));
  const mu = rets.reduce((a, x) => a + x.p * x.r, 0);
  return Math.sqrt(Math.max(0, rets.reduce((a, x) => a + x.p * (x.r - mu) ** 2, 0)));
}

/** Evaluated top to bottom; the first band that matches wins. A null R never satisfies a ≥ test. */
export function deriveLabel(c: Conviction, cfg: DeskRating): RatingLabel {
  const r = c.rewardRisk;
  if (c.expectedUpside <= cfg.strongSell.maxUpside) return "STRONG SELL";
  if (c.expectedUpside <= cfg.sell.maxUpside) return "SELL";
  if (c.expectedUpside >= cfg.strongBuy.minUpside && r != null && r >= cfg.strongBuy.minRewardRisk) return "STRONG BUY";
  if (c.expectedUpside >= cfg.buy.minUpside && r != null && r >= cfg.buy.minRewardRisk) return "BUY";
  return "HOLD";
}

const NOTCH: Record<RatingLabel, RatingLabel | null> = {
  "STRONG BUY": "BUY", BUY: "HOLD", HOLD: null, SELL: "HOLD", "STRONG SELL": "SELL",
};
/** The one label an author may choose instead of the derived one — a step toward HOLD. */
export const conservativeNotch = (label: RatingLabel): RatingLabel | null => NOTCH[label];
