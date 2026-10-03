import { describe, it, expect } from "vitest";
import { classifyBreach } from "./breach";
import { DEFAULT_TRADE_CONFIG as cfg } from "./config";

// P0 100 → P 80 is a 20% fall since the report; SPY0 is 100 throughout.
const at = (o: Partial<{ price: number; p0: number; spyNow: number; spy0: number; beta: number }> = {}) =>
  classifyBreach({ price: 80, p0: 100, spyNow: 100, spy0: 100, beta: 1.2, ...o }, cfg);

describe("classifyBreach", () => {
  it("splits the fall into the market part (beta x SPY) and the stock-specific rest", () => {
    // SPY −15% x beta 1.2 = −18% explained; residual −2% of a −20% fall → share 10% → market-driven.
    const b = at({ spyNow: 85 })!;
    expect(b.total).toBeCloseTo(-0.2, 12);
    expect(b.spyReturn).toBeCloseTo(-0.15, 12);
    expect(b.residual).toBeCloseTo(-0.02, 12);
    expect(b.share).toBeCloseTo(0.1, 12);
    expect(b.beta).toBe(1.2);
    expect(b.cause).toBe("market");
  });
  it("a flat market makes the whole fall stock-specific", () => {
    const b = at()!;
    expect(b).toMatchObject({ cause: "stock", share: 1, spyReturn: 0 });
    expect(b.residual).toBeCloseTo(-0.2, 12);
  });
  it("is mixed between the thresholds — inclusive at breachMarketShareMax, exclusive at breachStockShareMin", () => {
    // total −50%, SPY −25% x beta 1: half explained → share exactly 0.5 → mixed (not market).
    expect(classifyBreach({ price: 50, p0: 100, spyNow: 75, spy0: 100, beta: 1 }, cfg)).toMatchObject({ cause: "mixed", share: 0.5 });
    // share exactly 0.75 against a 0.75 stock threshold → stock.
    const tight = { breachMarketShareMax: 0.5, breachStockShareMin: 0.75 };
    expect(classifyBreach({ price: 50, p0: 100, spyNow: 87.5, spy0: 100, beta: 1 }, tight)).toMatchObject({ cause: "stock", share: 0.75 });
    expect(classifyBreach({ price: 50, p0: 100, spyNow: 87.5, spy0: 100, beta: 1 }, cfg)).toMatchObject({ cause: "mixed" });
  });
  it("market UP while the stock fell: share > 1 → stock-specific", () => {
    const b = at({ spyNow: 110, beta: 1 })!;
    expect(b.share).toBeCloseTo(1.5, 12);
    expect(b.cause).toBe("stock");
  });
  it("market fell MORE than beta needs to explain the drop: share < 0 → market-driven", () => {
    const b = at({ spyNow: 70, beta: 1 })!;
    expect(b.residual).toBeCloseTo(0.1, 12);
    expect(b.share).toBeCloseTo(-0.5, 12);
    expect(b.cause).toBe("market");
  });
  it("a higher beta explains more of the same fall", () => {
    // SPY −10% against a −20% fall: beta 0.5 explains −5% (share 75%, mixed); beta 2 explains all of it (share 0).
    expect(at({ spyNow: 90, beta: 0.5 })).toMatchObject({ cause: "mixed" });
    expect(at({ spyNow: 90, beta: 0.5 })!.share).toBeCloseTo(0.75, 12);
    expect(at({ spyNow: 90, beta: 2 })).toMatchObject({ cause: "market" });
    expect(at({ spyNow: 90, beta: 2 })!.share).toBeCloseTo(0, 12);
  });
  it("is null (→ the plain exit) on any non-finite or non-positive input, or when the price has not fallen", () => {
    for (const o of [
      { price: 0 }, { price: -1 }, { price: Number.NaN }, { p0: 0 }, { p0: Number.POSITIVE_INFINITY },
      { spyNow: 0 }, { spyNow: Number.NaN }, { spy0: 0 }, { spy0: Number.NaN },
      { beta: 0 }, { beta: -0.3 }, { beta: Number.NaN }, { beta: Number.POSITIVE_INFINITY },
      { price: 100 }, { price: 120 },
    ]) expect(at(o)).toBeNull();
  });
});
