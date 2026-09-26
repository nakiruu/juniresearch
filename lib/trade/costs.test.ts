import { describe, it, expect } from "vitest";
import { bucketFor, estimateCostUsd, ROUND_TRIP_BPS } from "./costs";

describe("costs", () => {
  it("buckets by market cap, defaulting to mid when unknown", () => {
    expect(bucketFor(50e9)).toBe("large"); expect(bucketFor(5e9)).toBe("mid");
    expect(bucketFor(500e6)).toBe("small"); expect(bucketFor(null)).toBe("mid");
  });
  it("treats the large/mid and mid/small boundaries as inclusive (>=) on the lower side", () => {
    expect(bucketFor(10e9)).toBe("large");
    expect(bucketFor(2e9)).toBe("mid");
  });
  it("estimates a round trip in dollars from bps", () => {
    expect(ROUND_TRIP_BPS).toEqual({ large: 8, mid: 15, small: 30 });
    expect(estimateCostUsd(10_000, "large")).toBeCloseTo(8, 9);
    expect(estimateCostUsd(-10_000, "small")).toBeCloseTo(30, 9); // sign-agnostic
  });
});
