import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  dcfEquityValue,
  impliedGrowth,
  fairValuePerShare,
  ownerEarningsBase,
  achievableGrowth,
  intrinsicRead,
  dcfApplicable,
  type IntrinsicFacts,
} from "./intrinsic";

/**
 * Known answers from docs/scoreconcepts/4.md's AMD worked example: at r=11%, gt=3%,
 * N=10 on trailing FCF ~$8.40B, the $504.20 price implies ~31% owner-earnings growth
 * for a decade, the achievable path is ~20%, and the base case (g=20%) is worth ~$226.
 */
const load = (t: string, acc: string): IntrinsicFacts =>
  JSON.parse(readFileSync(`data/facts/${t}/${acc}.json`, "utf8"));

const AMD = load("AMD", "0000002488-26-000123");
const BAC = load("BAC", "0000070858-26-000394");
const NEE = load("NEE", "0000753308-26-000060");
const CRWV = load("CRWV", "0001769628-26-000366");

const R = 0.11, GT = 0.03, N = 10;

describe("dcfApplicable — the engine abstains where a reverse DCF is meaningless", () => {
  it("applies to a mature FCF-generative industrial (AMD)", () => {
    expect(dcfApplicable(AMD).ok).toBe(true);
  });
  it("abstains on a financial (BAC): no FCF stream to value", () => {
    const a = dcfApplicable(BAC);
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/financial/i);
  });
  it("abstains on a utility (NEE)", () => {
    expect(dcfApplicable(NEE).ok).toBe(false);
  });
  it("abstains on a name with non-positive owner earnings (CRWV, deeply FCF-negative)", () => {
    const a = dcfApplicable(CRWV);
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/owner earnings/i);
  });
});

describe("dcfEquityValue / impliedGrowth round-trip", () => {
  it("the growth solved from a price reproduces that price", () => {
    const oe0 = 8.4e9, equity = 822.1e9;
    const g = impliedGrowth(oe0, equity, R, GT, N);
    expect(dcfEquityValue(oe0, g, R, GT, N)).toBeCloseTo(equity, -8); // within ~1e8 of $822.1B
  });
  it("AMD's $504.20 price implies roughly 31% growth at r=11%", () => {
    const g = impliedGrowth(8.4e9, 822.1e9, R, GT, N);
    expect(g).toBeGreaterThan(0.29);
    expect(g).toBeLessThan(0.34);
  });
  it("the implied-growth band widens with the discount rate (26%..36% across r 9-13%)", () => {
    expect(impliedGrowth(8.4e9, 822.1e9, 0.09, GT, N)).toBeGreaterThan(0.23);
    expect(impliedGrowth(8.4e9, 822.1e9, 0.13, GT, N)).toBeGreaterThan(impliedGrowth(8.4e9, 822.1e9, 0.09, GT, N));
    expect(impliedGrowth(8.4e9, 822.1e9, 0.13, GT, N)).toBeLessThan(0.40);
  });
});

describe("ownerEarningsBase", () => {
  it("derives trailing FCF from fcfYield x marketCap (~$8.4B for AMD)", () => {
    expect(ownerEarningsBase(AMD)).toBeCloseTo(8.4e9, -8);
  });
});

describe("achievableGrowth", () => {
  it("anchors on AMD's ~20% five-year FCF CAGR", () => {
    const g = achievableGrowth(AMD);
    expect(g).toBeGreaterThan(0.15);
    expect(g).toBeLessThan(0.25);
  });
});

describe("fairValuePerShare", () => {
  it("values AMD's base case (g=20%) near $226/share", () => {
    const fv = fairValuePerShare(8.4e9, 0.2, 1.6306e9, R, GT, N);
    expect(fv).toBeGreaterThan(200);
    expect(fv).toBeLessThan(255);
  });
});

describe("intrinsicRead — the whole engine on AMD", () => {
  const read = intrinsicRead(AMD, { r: R, terminalGrowth: GT, horizon: N });
  it("reports a positive expectations gap (implied above achievable) and a deep negative margin of safety", () => {
    expect(read.gap).toBeGreaterThan(0.05); // implied ~31% vs achievable ~20%
    expect(read.marginOfSafety).toBeLessThan(0); // base case sits below the $504 price
  });
  it("emits three ordered mechanical scenarios (bull >= base >= bear) for conviction.ts", () => {
    const byName = (re: RegExp) => read.scenarios.find((s) => re.test(s.name))!.impliedPrice;
    expect(read.scenarios).toHaveLength(3);
    expect(byName(/bull/i)).toBeGreaterThanOrEqual(byName(/base/i));
    expect(byName(/base/i)).toBeGreaterThanOrEqual(byName(/bear/i));
    expect(read.scenarios.reduce((a, s) => a + s.probability, 0)).toBeCloseTo(1, 5);
  });
  it("always reports the discount rate it used", () => {
    expect(read.discountRate).toBe(R);
  });
});
