/**
 * target-low — a buy whose range starts below the price (or a sell whose range ends above it).
 * -----------------------------------------------------------------------------
 * The page prints "Upside Potential: <low> to <high>" against the current price, so a BUY with a
 * low end under the price reads as a negative upside. The house's range is a where-it-could-trade
 * band that brackets the base case, not a Street-style target, so this is a warning the author
 * resolves by raising the low end or saying so in the prose — never a build error. It needs the
 * price, which the prose units do not carry, so lintJudgment calls it directly with a context.
 */
import type { Judgment } from "../../judgment.schema";
import type { LintIssue } from "../index";
import { usd, pct } from "../../../format";

export function ratingLint(judgment: Judgment, ctx: { currentPrice: number }): LintIssue[] {
  const { label, targetLow, targetHigh } = judgment.rating;
  const price = ctx.currentPrice;
  if (label.endsWith("BUY") && targetLow < price)
    return [{
      rule: "target-low", severity: "warning", field: "rating.targetLow", value: targetLow,
      message: `target low ${usd(targetLow)} sits ${pct((price - targetLow) / price)} below the price on a ${label}, so the upside line will read negative; raise the low end or address it in the prose`,
    }];
  if (label.endsWith("SELL") && targetHigh > price)
    return [{
      rule: "target-low", severity: "warning", field: "rating.targetHigh", value: targetHigh,
      message: `target high ${usd(targetHigh)} sits ${pct((targetHigh - price) / price)} above the price on a ${label}, so the downside line will read positive; lower the high end or address it in the prose`,
    }];
  return [];
}
