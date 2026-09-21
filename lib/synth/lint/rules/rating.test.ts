import { describe, it, expect } from "vitest";
import { Judgment } from "@/lib/synth/judgment.schema";
import { ratingLint } from "@/lib/synth/lint/rules/rating";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const golden = Judgment.parse(goldenJudgment);
const withRange = (label: Judgment["rating"]["label"], targetLow: number, targetHigh: number) => {
  const j = structuredClone(golden); j.rating = { label, targetLow, targetHigh }; return j;
};
const price = 361.99;

describe("target-low (price 361.99)", () => {
  it("warns on a BUY whose low end sits below the price", () => {
    const [issue] = ratingLint(withRange("BUY", 300, 525), { currentPrice: price });
    expect([issue.rule, issue.severity, issue.field, issue.value]).toEqual(["target-low", "warning", "rating.targetLow", 300]);
    expect(issue.message).toBe("target low $300.00 sits 17.1% below the price on a BUY, so the upside line will read negative; raise the low end or address it in the prose");
  });
  it("warns on a STRONG BUY the same way, and not when the low end is at or above the price", () => {
    expect(ratingLint(withRange("STRONG BUY", 300, 525), { currentPrice: price })).toHaveLength(1);
    expect(ratingLint(withRange("BUY", 361.99, 525), { currentPrice: price })).toEqual([]);
    expect(ratingLint(withRange("BUY", 400, 525), { currentPrice: price })).toEqual([]);
  });
  it("mirrors on a SELL or STRONG SELL whose high end sits above the price", () => {
    const [issue] = ratingLint(withRange("SELL", 250, 400), { currentPrice: price });
    expect([issue.rule, issue.severity, issue.field, issue.value]).toEqual(["target-low", "warning", "rating.targetHigh", 400]);
    expect(issue.message).toBe("target high $400.00 sits 10.5% above the price on a SELL, so the downside line will read positive; lower the high end or address it in the prose");
    expect(ratingLint(withRange("STRONG SELL", 250, 400), { currentPrice: price })).toHaveLength(1);
    expect(ratingLint(withRange("SELL", 250, 361.99), { currentPrice: price })).toEqual([]);
  });
  it("never warns on a HOLD", () => {
    expect(ratingLint(withRange("HOLD", 300, 400), { currentPrice: price })).toEqual([]);
  });
});
