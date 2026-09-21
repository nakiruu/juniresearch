import { describe, it, expect } from "vitest";
import { computeConviction, deriveLabel, conservativeNotch, type Conviction } from "@/lib/synth/conviction";
import { DESK_RATING_DEFAULTS } from "@/lib/synth/desk.schema";

const cfg = DESK_RATING_DEFAULTS;
const shape = (bull: number, base: number, bear: number) => [
  { name: "Bull", driver: "x", impliedPrice: bull, probability: 0.3 },
  { name: "Base", driver: "x", impliedPrice: base, probability: 0.5 },
  { name: "Bear", driver: "x", impliedPrice: bear, probability: 0.2 },
];

describe("computeConviction (price 100, probabilities 0.3/0.5/0.2)", () => {
  it("works one shape by hand: fair value 131 → E 0.31, bear 80 → D 0.20, R 1.55", () => {
    const c = computeConviction(shape(150, 140, 80), 100);
    expect(c.expectedUpside).toBeCloseTo(0.31, 10);
    expect(c.bearDownside).toBeCloseTo(0.2, 10);
    expect(c.rewardRisk).toBeCloseTo(1.55, 10);
  });
  it("finds the bear by name regardless of order", () => {
    const reordered = [shape(150, 140, 80)[2], shape(150, 140, 80)[0], shape(150, 140, 80)[1]];
    expect(computeConviction(reordered, 100).bearDownside).toBeCloseTo(0.2, 10);
  });
  it("returns a null reward/risk when the bear is at or above the price", () => {
    expect(computeConviction(shape(150, 140, 100), 100).rewardRisk).toBeNull();
    expect(computeConviction(shape(150, 140, 105), 100).rewardRisk).toBeNull();
    expect(computeConviction(shape(150, 140, 105), 100).bearDownside).toBeCloseTo(-0.05, 10);
  });
});

describe("deriveLabel at the band boundaries", () => {
  const c = (expectedUpside: number, bearDownside: number, rewardRisk: number | null): Conviction => ({ expectedUpside, bearDownside, rewardRisk });
  it.each<[string, Conviction, string]>([
    ["strong buy at both thresholds", c(0.2, 0.2, 1.0), "STRONG BUY"],
    ["just under the strong-buy upside", c(0.199, 0.1, 1.99), "BUY"],
    ["just under the strong-buy ratio", c(0.3, 0.31, 0.99), "BUY"],
    ["buy at both thresholds", c(0.1, 0.2, 0.5), "BUY"],
    ["just under the buy upside", c(0.099, 0.1, 0.99), "HOLD"],
    ["just under the buy ratio (the AMD shape)", c(0.121, 0.326, 0.37), "HOLD"],
    ["positive but small", c(0.014, 0.167, 0.08), "HOLD"],
    ["flat", c(0, 0.2, 0), "HOLD"],
    ["just above the sell line", c(-0.049, 0.2, null), "HOLD"],
    ["sell at the line", c(-0.05, 0.2, null), "SELL"],
    ["just above the strong-sell line", c(-0.199, 0.3, null), "SELL"],
    ["strong sell at the line", c(-0.2, 0.3, null), "STRONG SELL"],
    ["a null ratio never earns a buy", c(0.5, 0, null), "HOLD"],
  ])("%s → %s", (_n, conv, label) => {
    expect(deriveLabel(conv, cfg)).toBe(label);
  });
});

describe("conservativeNotch", () => {
  it.each([
    ["STRONG BUY", "BUY"], ["BUY", "HOLD"], ["SELL", "HOLD"], ["STRONG SELL", "SELL"],
  ] as const)("%s → %s", (from, to) => expect(conservativeNotch(from)).toBe(to));
  it("has no alternative for HOLD", () => expect(conservativeNotch("HOLD")).toBeNull());
});
