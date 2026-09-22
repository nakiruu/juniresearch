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
  JSON.parse(readFileSync(`lib/synth/__fixtures__/packs/${t}/${acc}.json`, "utf8"));

const AMD = load("AMD", "0000002488-26-000123");
const BAC = load("BAC", "0000070858-26-000394");
const NEE = load("NEE", "0000753308-26-000060");
const CRWV = load("CRWV", "0001769628-26-000366");
// AT&T: a declining business (FCF 25.4->19.4B, revenue 134->126B), a case where implied < achievable.
const T = load("T", "0000732717-26-000297");

const R = 0.11, GT = 0.03, N = 10;

describe("achievableGrowth does not manufacture growth for a decliner (C2)", () => {
  it("returns a negative CAGR for AT&T rather than flooring at +3%", () => {
    const g = achievableGrowth(T);
    expect(g).toBeLessThan(0);
    expect(g).toBeGreaterThanOrEqual(-0.1); // bounded, not unbounded
  });
  it("still returns the positive CAGR for a grower (AMD ~20%)", () => {
    expect(achievableGrowth(AMD)).toBeGreaterThan(0.15);
  });
});

describe("the Base scenario is anchored to achievable growth, not the price sort (C1)", () => {
  const read = intrinsicRead(T, { r: R, terminalGrowth: GT, horizon: N });
  it("Base carries the 0.50 weight, names the achievable growth, and drives the margin of safety", () => {
    const base = read.scenarios.find((s) => s.name === "Base")!;
    expect(base.probability).toBe(0.5);
    expect(base.driver).toContain(`${(read.achievableGrowth * 100).toFixed(0)}%`); // the achievable rate, not implied/2
    expect(read.marginOfSafety).toBeCloseTo(base.impliedPrice / T.quote.price - 1, 5);
  });
  it("keeps bull >= base >= bear even when implied < achievable", () => {
    const p = (n: string) => read.scenarios.find((s) => s.name === n)!.impliedPrice;
    expect(p("Bull")).toBeGreaterThanOrEqual(p("Base"));
    expect(p("Base")).toBeGreaterThanOrEqual(p("Bear"));
  });
  it("does not assign a positive perpetual terminal growth to a declining base case, and flags it", () => {
    expect(read.flags.some((f) => /declin/i.test(f))).toBe(true);
    // terminal growth capped at the (negative) explicit growth ⇒ base FV well below the +3%-terminal value
    const inflated = fairValuePerShare(ownerEarningsBase(T), read.achievableGrowth, T.quote.sharesOutstanding, R, GT, N);
    const base = read.scenarios.find((s) => s.name === "Base")!.impliedPrice;
    expect(base).toBeLessThan(inflated);
  });
});

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
  it("derives trailing FCF from fcfYield x marketCap (~$8.4B for AMD, before SBC)", () => {
    expect(ownerEarningsBase({ ...AMD, sbc: undefined })).toBeCloseTo(8.4e9, -8);
  });
  it("charges the latest SBC as a real cost when it is present (8.md; Damodaran)", () => {
    const noSbc = { ...AMD, sbc: undefined };
    const withSbc = { ...AMD, sbc: [null, null, null, null, 1.6e9] };
    expect(ownerEarningsBase(withSbc)).toBeCloseTo(ownerEarningsBase(noSbc) - 1.6e9, 0);
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
  it("reports a mechanical E — the probability-weighted fair value vs price (4.md §8)", () => {
    const wtd = read.scenarios.reduce((a, s) => a + s.probability * s.impliedPrice, 0);
    expect(read.eMechanical).toBeCloseTo(wtd / AMD.quote.price - 1, 6);
  });
});
