import { describe, it, expect } from "vitest";
import { equalWeightCoverage, activeWeights } from "./benchmark";

describe("benchmark", () => {
  it("equal-weights every covered name", () => {
    const ew = equalWeightCoverage(["A", "B", "C", "D"]);
    expect(ew.get("A")).toBeCloseTo(0.25, 6);
  });
  it("computes active weight = portfolio - benchmark for every covered name", () => {
    const rows = activeWeights(["A", "B", "C", "D"], [{ ticker: "A", weight: 0.6 }]);
    const a = rows.find((r) => r.ticker === "A")!;
    const b = rows.find((r) => r.ticker === "B")!;
    expect(a.activeWeight).toBeCloseTo(0.6 - 0.25, 6);  // overweight
    expect(b.activeWeight).toBeCloseTo(0 - 0.25, 6);    // underweight (not held)
  });
});
