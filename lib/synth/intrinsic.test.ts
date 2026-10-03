import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  dcfEquityValue,
  impliedGrowth,
  fairValuePerShare,
  fadedGrowth,
  ownerEarningsBase,
  achievableGrowth,
  achievableGrowthDetail,
  revenueBreakIndex,
  intrinsicRead,
  dcfApplicable,
  ownerEarningsDetail,
  inputCheckFailures,
  inputCheckStatus,
  type ShibuiCheck,
  GROWTH_CAP,
  GROWTH_FLOOR,
  MIN_OWNER_EARNINGS_YIELD,
  MIN_DISCOUNT_SPREAD,
  IMPLIED_GROWTH_BAND,
  type IntrinsicFacts,
} from "./intrinsic";

/**
 * Known answers from docs/scoreconcepts/4.md's AMD worked example (r=11%, gt=3%, N=10, trailing
 * FCF ~$8.40B, $504.20 price). That example used a decade-FLAT growth and a +20% ceiling; the engine
 * now fades the starting growth linearly to gt over the decade and caps achievable growth at +15%,
 * so several of the worked-example numbers legitimately move (each changed expectation says why).
 */
const load = (t: string, acc: string): IntrinsicFacts =>
  JSON.parse(readFileSync(`lib/synth/__fixtures__/packs/${t}/${acc}.json`, "utf8"));

const AMD = load("AMD", "0000002488-26-000123");
const BAC = load("BAC", "0000070858-26-000394");
const NEE = load("NEE", "0000753308-26-000060");
const CRWV = load("CRWV", "0001769628-26-000366");
const INTC = load("INTC", "0000050863-26-000157");
const LLY = load("LLY", "0000059478-26-000081");
const NVDA = load("NVDA", "0001045810-26-000075");
// AT&T: a declining business (FCF 25.4->19.4B, revenue 134->126B), a case where implied < achievable.
const T = load("T", "0000732717-26-000297");

const R = 0.11, GT = 0.03, N = 10;

/** A synthetic industrial pack: $1B market cap, 5% owner-earnings yield unless overridden. */
const synth = (revenue: (number | null)[], fcf: (number | null)[], over: Partial<IntrinsicFacts> = {}): IntrinsicFacts => ({
  ticker: "SYN",
  sic: 3559, // industrial machinery
  quote: { price: 10, marketCap: 1e9, sharesOutstanding: 1e8 },
  ttm: { fcfYield: 0.05 },
  statements: {
    fiscalYears: revenue.map((_, i) => `FY${21 + i}`),
    income: [{ key: "revenue", label: "Revenue", values: revenue }],
    cashflow: [{ key: "freeCashFlow", label: "FCF", values: fcf }],
  },
  ...over,
});

describe("achievableGrowth does not manufacture growth for a decliner (C2)", () => {
  it("returns a negative CAGR for AT&T rather than flooring at +3%", () => {
    const g = achievableGrowth(T);
    expect(g).toBeLessThan(0);
    expect(g).toBeGreaterThanOrEqual(GROWTH_FLOOR); // bounded, not unbounded
  });
  it("still returns the positive CAGR for a grower — AMD's 20.3% FCF CAGR now sits on the +15% cap", () => {
    // Was > 15% under the old +20% ceiling; the ceiling is now +15% (a starting rate that fades).
    expect(achievableGrowth(AMD)).toBe(GROWTH_CAP);
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
  it("fades a decliner toward the capped terminal (0), not toward +3%", () => {
    const oe0 = ownerEarningsBase(T);
    const g = read.achievableGrowth;
    expect(read.fairValue.base).toBeCloseTo(fairValuePerShare(oe0, g, T.quote.sharesOutstanding, R, Math.min(GT, Math.max(g, 0)), N), 6);
  });
});

describe("dcfApplicable — the engine abstains where a reverse DCF is meaningless", () => {
  it("applies to a mature FCF-generative industrial (LLY, owner earnings ~1.7% of market cap)", () => {
    // Was AMD; AMD's SBC-charged owner earnings are 0.82% of market cap, now below the 1.5% floor.
    expect(dcfApplicable(LLY).ok).toBe(true);
    expect(dcfApplicable(NVDA).ok).toBe(true);
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
    expect(a.reason).toMatch(/non-positive owner earnings/i);
  });
  it("abstains when owner earnings are below 1.5% of market cap (INTC 0.08%, AMD 0.82%)", () => {
    for (const f of [INTC, AMD]) {
      expect(ownerEarningsBase(f) / f.quote.marketCap).toBeLessThan(MIN_OWNER_EARNINGS_YIELD);
      const a = dcfApplicable(f);
      expect(a.ok).toBe(false);
      expect(a.reason).toBe("owner earnings below 1.5% of market cap — too small a base to value");
    }
  });
  it("the floor is on owner earnings after SBC, at exactly 1.5% of market cap", () => {
    const at = (y: number, sbc?: number) =>
      dcfApplicable(synth([100, 110, 120], [10, 11, 12], { ttm: { fcfYield: y }, sbc: sbc == null ? undefined : [null, null, sbc] }));
    expect(at(0.015).ok).toBe(true);
    expect(at(0.0149).ok).toBe(false);
    expect(at(0.02, 0.006e9).ok).toBe(false); // 2.0% FCF yield − 0.6% SBC = 1.4% owner earnings
  });
});

describe("dcfEquityValue — linear fade from starting growth to terminal", () => {
  it("year-t growth runs from g in year 1 to gt in year N", () => {
    expect(fadedGrowth(0.15, 0.03, 1, 10)).toBeCloseTo(0.15, 12);
    expect(fadedGrowth(0.15, 0.03, 10, 10)).toBeCloseTo(0.03, 12);
    expect(fadedGrowth(0.15, 0.03, 5, 10)).toBeCloseTo(0.15 - (0.12 * 4) / 9, 12);
    expect(fadedGrowth(0.15, 0.03, 1, 1)).toBe(0.15); // a one-year stage grows at g
  });
  it("matches a hand-built three-year faded model", () => {
    // N=3, g=10%, gt=4%: growth 10%, 7%, 4%, then 4% forever, discounted at 9%.
    const f1 = 100 * 1.1, f2 = f1 * 1.07, f3 = f2 * 1.04;
    const tv = (f3 * 1.04) / (0.09 - 0.04) / 1.09 ** 3;
    const hand = f1 / 1.09 + f2 / 1.09 ** 2 + f3 / 1.09 ** 3 + tv;
    expect(dcfEquityValue(100, 0.1, 0.09, 0.04, 3)).toBeCloseTo(hand, 8);
  });
  it("equals the flat model when g = gt, and values a fading grower below the flat-g value", () => {
    const flat = (oe0: number, g: number, r: number, gt: number, n: number) => {
      let v = 0, f = oe0;
      for (let t = 1; t <= n; t++) { f *= 1 + g; v += f / (1 + r) ** t; }
      return v + (f * (1 + gt)) / (r - gt) / (1 + r) ** n;
    };
    expect(dcfEquityValue(100, GT, R, GT, N)).toBeCloseTo(flat(100, GT, R, GT, N), 8);
    expect(dcfEquityValue(100, 0.15, R, GT, N)).toBeLessThan(flat(100, 0.15, R, GT, N));
  });
});

describe("dcfEquityValue / impliedGrowth round-trip", () => {
  it("the growth solved from a price reproduces that price", () => {
    const oe0 = 8.4e9, equity = 822.1e9;
    const g = impliedGrowth(oe0, equity, R, GT, N);
    expect(dcfEquityValue(oe0, g, R, GT, N)).toBeCloseTo(equity, -8); // within ~1e8 of $822.1B
  });
  it("AMD's $504.20 price implies a ~58% STARTING growth at r=11% (was ~31% decade-flat)", () => {
    // With the fade, 31% flat for ten years is equivalent to starting near 58% and fading to 3%.
    const g = impliedGrowth(8.4e9, 822.1e9, R, GT, N);
    expect(g).toBeGreaterThan(0.55);
    expect(g).toBeLessThan(0.62);
  });
  it("the implied-growth band widens with the discount rate (~48%..67% starting growth across r 9-13%)", () => {
    // Was 26%..36% under the decade-flat model; same ordering, higher starting rates under the fade.
    const lo = impliedGrowth(8.4e9, 822.1e9, 0.09, GT, N), hi = impliedGrowth(8.4e9, 822.1e9, 0.13, GT, N);
    expect(lo).toBeGreaterThan(0.45);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThan(0.72);
  });
  it("is not pinned at the band edge for a name priced for decline", () => {
    // T's price now implies a starting decline beyond −10% (the old lower bound of the search band).
    const g = intrinsicRead(T, { r: R, terminalGrowth: GT, horizon: N }).impliedGrowth;
    expect(dcfEquityValue(ownerEarningsBase(T), g, R, GT, N)).toBeCloseTo(T.quote.marketCap, -8);
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

describe("revenueBreakIndex — spin-off / divestiture detection", () => {
  it("returns −1 with no year-over-year drop beyond 20%", () => {
    expect(revenueBreakIndex([100, 90, 81, 100])).toBe(-1);
    expect(revenueBreakIndex([100, 80])).toBe(-1); // exactly −20% is not a break
    expect(revenueBreakIndex(undefined)).toBe(-1);
  });
  it("returns the index of the post-drop year, the latest one when there are several", () => {
    expect(revenueBreakIndex([100, 110, 70, 75, 80])).toBe(2);
    expect(revenueBreakIndex([100, 70, 75, 50, 55])).toBe(3);
  });
  it("skips pairs with a missing or non-positive prior year", () => {
    expect(revenueBreakIndex([100, null, 50, 55])).toBe(-1);
    expect(revenueBreakIndex([0, 50, 30])).toBe(2);
  });
  it("finds DD-style spins in real packs (MMM-like shape: 35.4B → 26.2B)", () => {
    expect(revenueBreakIndex([32.2e9, 35.4e9, 34.2e9, 26.2e9, 24.6e9, 24.9e9])).toBe(3);
  });
});

describe("achievableGrowth — base-year guard, structural break, sign rule, cap", () => {
  it("rejects an FCF CAGR off a tiny base year (< 25% of the latest) and uses revenue CAGR", () => {
    // CHWY-shape: FCF $8.6M → $560M would be ~185%/yr; revenue grew ~10%/yr.
    const f = synth([100, 110, 121, 133.1, 146.41], [8.6, 100, 200, 400, 560]);
    const d = achievableGrowthDetail(f);
    expect(d.source).toBe("revenue");
    expect(d.g).toBeCloseTo(0.1, 6);
    expect(d.flags.some((x) => /25%/.test(x))).toBe(true);
  });
  it("accepts the FCF CAGR when the first year is at least 25% of the last", () => {
    const f = synth([100, 105, 110, 116, 122], [25, 40, 60, 80, 100]); // exactly 25%: 41.4%/yr → capped
    const d = achievableGrowthDetail(f);
    expect(d.source).toBe("fcf");
    expect(d.g).toBe(GROWTH_CAP);
    expect(d.capped).toBe(true);
    const g = achievableGrowth(synth([100, 105, 110, 116, 122], [60, 65, 70, 75, 80])); // (80/60)^(1/4) − 1
    expect(g).toBeCloseTo((80 / 60) ** 0.25 - 1, 8);
  });
  it("measures growth only from a structural break onward (spin-off ≠ organic decline)", () => {
    // DD-shape: revenue halves in FY23 (13.0B → 6.6B) then grows; the full-window CAGR would be ~−15%.
    const f = synth([12.0, 13.0, 6.6, 6.9, 7.2], [1.5, 1.6, 0.9, 0.95, 1.0]);
    const d = achievableGrowthDetail(f);
    expect(d.breakIndex).toBe(2);
    expect(d.g).toBeCloseTo((1.0 / 0.9) ** 0.5 - 1, 8); // FCF CAGR over FY23..FY25
    expect(d.flags.some((x) => /structural break at FY23/.test(x))).toBe(true);
  });
  it("with one post-break year left, uses that revenue change; with none, 0 — and flags it", () => {
    const one = achievableGrowthDetail(synth([100, 105, 110, 70, 77], [10, 11, 12, 8, 4]));
    expect(one.breakIndex).toBe(3);
    expect(one.source).toBe("revenue");
    expect(one.g).toBeCloseTo(0.1, 8); // 70 → 77, the FCF change is ignored
    expect(one.flags.some((x) => /fewer than 2 post-break years/.test(x))).toBe(true);
    const none = achievableGrowthDetail(synth([100, 105, 110, 115, 70], [10, 11, 12, 13, 8]));
    expect(none.breakIndex).toBe(4);
    expect(none.g).toBe(0);
    expect(none.flags.some((x) => /set to 0/.test(x))).toBe(true);
  });
  it("does not let a negative FCF CAGR override a non-negative revenue CAGR (LH-shape)", () => {
    const f = synth([10, 10.5, 11, 11.5, 12], [2.69, 2.2, 1.8, 1.5, 1.21]);
    const d = achievableGrowthDetail(f);
    expect(d.source).toBe("revenue");
    expect(d.g).toBeCloseTo((12 / 10) ** 0.25 - 1, 8);
  });
  it("keeps the less negative rate when both FCF and revenue decline", () => {
    const f = synth([100, 97, 94, 91, 88], [20, 18, 16, 14, 12]);
    expect(achievableGrowth(f)).toBeCloseTo((88 / 100) ** 0.25 - 1, 8); // revenue −3.1% beats FCF −12%
  });
  it("clamps to [−10%, +15%]", () => {
    expect(achievableGrowth(synth([100, 200, 300], [50, 80, 100]))).toBe(GROWTH_CAP);
    expect(achievableGrowth(synth([100, 85, 72], [100, 70, 50]))).toBe(GROWTH_FLOOR);
    expect(GROWTH_CAP).toBe(0.15);
    expect(GROWTH_FLOOR).toBe(-0.1);
  });
  it("AMD's 20.3% five-year FCF CAGR is capped at +15% and flagged", () => {
    // Was asserted inside (15%, 25%) under the old +20% ceiling.
    const d = achievableGrowthDetail(AMD);
    expect(d.source).toBe("fcf");
    expect(d.g).toBe(GROWTH_CAP);
    expect(d.flags.some((x) => /capped at \+15% \(raw 20%\)/.test(x))).toBe(true);
  });
});

describe("fairValuePerShare", () => {
  it("values AMD's g=20% case near $129/share under the fade (was ~$226 decade-flat)", () => {
    // Twenty percent faded linearly to 3% over the decade compounds to far less than 20% flat.
    const fv = fairValuePerShare(8.4e9, 0.2, 1.6306e9, R, GT, N);
    expect(fv).toBeGreaterThan(120);
    expect(fv).toBeLessThan(140);
  });
});

describe("intrinsicRead — the whole engine on AMD", () => {
  const read = intrinsicRead(AMD, { r: R, terminalGrowth: GT, horizon: N });
  it("reports a positive expectations gap (implied above achievable) and a deep negative margin of safety", () => {
    expect(read.gap).toBeGreaterThan(0.05); // implied ~65% starting vs achievable 15%
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

describe("intrinsicRead — scenario ordering survives the fade", () => {
  for (const [name, f] of [["LLY", LLY], ["NVDA", NVDA], ["T", T], ["AMD", AMD]] as const) {
    it(`bull >= base >= bear for ${name}`, () => {
      const { fairValue: v } = intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N });
      expect(v.bull).toBeGreaterThanOrEqual(v.base);
      expect(v.base).toBeGreaterThanOrEqual(v.bear);
    });
  }
});

describe("intrinsicRead — mosRange over r ± 1pt × base growth ± 2pt", () => {
  for (const [name, f] of [["LLY", LLY], ["NVDA", NVDA], ["T", T]] as const) {
    it(`is the min/max of the centre and the four corners (${name})`, () => {
      const read = intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N });
      const oe0 = ownerEarningsBase(f);
      const mos = (g: number, r: number) =>
        fairValuePerShare(oe0, g, f.quote.sharesOutstanding, r, Math.min(GT, Math.max(g, 0)), N) / f.quote.price - 1;
      const g = read.achievableGrowth;
      const grid = [mos(g, R), mos(g - 0.02, R - 0.01), mos(g + 0.02, R - 0.01), mos(g - 0.02, R + 0.01), mos(g + 0.02, R + 0.01)];
      expect(read.mosRange.min).toBeCloseTo(Math.min(...grid), 10);
      expect(read.mosRange.max).toBeCloseTo(Math.max(...grid), 10);
      expect(read.mosRange.min).toBeLessThanOrEqual(read.marginOfSafety);
      expect(read.mosRange.max).toBeGreaterThanOrEqual(read.marginOfSafety);
      // the high corner is low r + high growth; the low corner high r + low growth (value monotone in both)
      expect(read.mosRange.max).toBeCloseTo(mos(g + 0.02, R - 0.01), 10);
      expect(read.mosRange.min).toBeCloseTo(mos(g - 0.02, R + 0.01), 10);
    });
  }
  it("shifts a capped base growth past the cap rather than re-clamping it (NVDA at +15%)", () => {
    const read = intrinsicRead(NVDA, { r: R, terminalGrowth: GT, horizon: N });
    expect(read.achievableGrowth).toBe(GROWTH_CAP);
    const atCap = fairValuePerShare(ownerEarningsBase(NVDA), GROWTH_CAP, NVDA.quote.sharesOutstanding, R - 0.01, GT, N);
    expect(read.mosRange.max).toBeGreaterThan(atCap / NVDA.quote.price - 1); // used 17%, not 15%
  });
});

describe("intrinsicRead — discount-rate floor (r ≥ gt + 4pt)", () => {
  const f = synth([100, 110, 121, 133, 146], [10, 11, 12, 13, 14]);
  it("floors a low cost of equity at gt + 4pt and flags it; a normal r passes through untouched", () => {
    const low = intrinsicRead(f, { r: 0.055, terminalGrowth: GT, horizon: N });
    expect(low.discountRate).toBeCloseTo(GT + MIN_DISCOUNT_SPREAD, 10);
    expect(low.flags.some((x) => x.startsWith("discount rate floored at 7.0%"))).toBe(true);
    const atFloor = intrinsicRead(f, { r: GT + MIN_DISCOUNT_SPREAD, terminalGrowth: GT, horizon: N });
    expect(low.marginOfSafety).toBeCloseTo(atFloor.marginOfSafety, 10);
    const normal = intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N });
    expect(normal.discountRate).toBe(R);
    expect(normal.flags.some((x) => x.startsWith("discount rate floored"))).toBe(false);
  });
  it("lets the r − 1pt robustness corner sit no closer than 3pt to gt", () => {
    const read = intrinsicRead(f, { r: 0.05, terminalGrowth: GT, horizon: N });
    const oe0 = ownerEarningsBase(f);
    const g = read.achievableGrowth;
    const hi = fairValuePerShare(oe0, g + 0.02, f.quote.sharesOutstanding, GT + MIN_DISCOUNT_SPREAD - 0.01, Math.min(GT, Math.max(g + 0.02, 0)), N);
    expect(read.mosRange.max).toBeCloseTo(hi / f.quote.price - 1, 10);
  });
});

describe("intrinsicRead — implied growth at the solver edge is flagged", () => {
  it("flags a price the band cannot explain (owner earnings 3× market cap)", () => {
    const cheap = synth([100, 100, 100, 100, 100], [10, 10, 10, 10, 10], { ttm: { fcfYield: 3 } });
    const read = intrinsicRead(cheap, { r: R, terminalGrowth: GT, horizon: N });
    expect(read.impliedGrowth).toBeCloseTo(IMPLIED_GROWTH_BAND[0], 2);
    expect(read.flags.some((x) => x.startsWith("market-implied growth is outside the solver band"))).toBe(true);
  });
  it("does not flag an interior solution", () => {
    const read = intrinsicRead(synth([100, 110, 121, 133, 146], [10, 11, 12, 13, 14]), { r: R, terminalGrowth: GT, horizon: N });
    expect(read.flags.some((x) => x.startsWith("market-implied growth is outside"))).toBe(false);
  });
});

/** A Shibui cross-check stamp: all inputs agree unless diffs/sbcTtm are overridden. */
const check = (over: Partial<ShibuiCheck> = {}): ShibuiCheck => ({
  asOf: "2026-10-01", quarterEnd: "2026-06-30",
  price: 10, marketCap: 1e9, sharesOutstanding: 1e8, revenueQuarter: 30, fcfTtm: 5e7, sbcTtm: null,
  diffs: [], source: "shibui", ...over,
});
const diff = (field: ShibuiCheck["diffs"][number]["field"], pack: number, shibui: number): ShibuiCheck["diffs"][number] => {
  const relDiff = Math.abs(pack - shibui) / Math.abs(shibui);
  return { field, pack, shibui, relDiff, level: relDiff <= 0.1 ? "ok" : relDiff <= 0.25 ? "warn" : "fail" };
};
const grower = (over: Partial<IntrinsicFacts> = {}) => synth([100, 110, 121, 133, 146], [10, 11, 12, 13, 14e6], over);

describe("ownerEarningsBase — the SBC charged matches the FCF base's period", () => {
  it("charges the Shibui TTM SBC on the TTM-FCF path, in place of the fiscal-year SEC SBC", () => {
    const f = grower({ sbc: [null, null, null, null, 8e6], shibuiCheck: check({ sbcTtm: 1e7 }) });
    const d = ownerEarningsDetail(f);
    expect(d).toMatchObject({ fcfBasis: "ttm", sbc: 1e7, sbcSource: "ttmShibui" });
    expect(ownerEarningsBase(f)).toBeCloseTo(0.05 * 1e9 - 1e7, 0);
    expect(intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N }).flags[0]).toBe("TTM SBC (Shibui) charged to owner earnings");
  });
  it("keeps the fiscal-year SEC SBC on the fiscal-year FCF fallback path", () => {
    const f = grower({ ttm: { fcfYield: null }, sbc: [null, null, null, null, 2e6], shibuiCheck: check({ sbcTtm: 3e6 }) });
    expect(ownerEarningsDetail(f)).toMatchObject({ fcfBasis: "fiscalYear", sbc: 2e6, sbcSource: "fiscalYearSec" });
    expect(ownerEarningsBase(f)).toBeCloseTo(14e6 - 2e6, 0);
    expect(intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N }).flags[0]).toBe("fiscal-year SBC (SEC) charged to owner earnings");
  });
  it("uses the Shibui TTM SBC when the SEC SBC is missing entirely (either path)", () => {
    const ttm = grower({ shibuiCheck: check({ sbcTtm: 4e6 }) });
    expect(ownerEarningsBase(ttm)).toBeCloseTo(5e7 - 4e6, 0);
    const fy = grower({ ttm: { fcfYield: null }, sbc: [null, null, null, null, null], shibuiCheck: check({ sbcTtm: 4e6 }) });
    expect(ownerEarningsDetail(fy)).toMatchObject({ fcfBasis: "fiscalYear", sbc: 4e6, sbcSource: "ttmShibui" });
  });
  it("ignores a negative or non-finite sbcTtm and falls back to the SEC SBC", () => {
    for (const bad of [-1e6, Number.NaN]) {
      const f = grower({ sbc: [null, null, null, null, 8e6], shibuiCheck: check({ sbcTtm: bad }) });
      expect(ownerEarningsDetail(f).sbcSource).toBe("fiscalYearSec");
    }
  });
  it("is unchanged without a shibuiCheck (fiscal-year SBC, or none isolated)", () => {
    const withSbc = grower({ sbc: [null, null, null, null, 8e6] });
    expect(ownerEarningsBase(withSbc)).toBeCloseTo(5e7 - 8e6, 0);
    expect(intrinsicRead(withSbc, { r: R, terminalGrowth: GT, horizon: N }).flags[0]).toBe("fiscal-year SBC (SEC) charged to owner earnings");
    const none = grower();
    expect(ownerEarningsBase(none)).toBeCloseTo(5e7, 0);
    expect(intrinsicRead(none, { r: R, terminalGrowth: GT, horizon: N }).flags[0]).toBe("trailing-FCF owner-earnings proxy (SBC not isolated)");
    expect(inputCheckStatus(none)).toBe("—");
  });
});

describe("dcfApplicable / intrinsicRead — input guard against Shibui", () => {
  it("abstains on a fail (> 25%) on TTM FCF, naming the field and both values", () => {
    const f = grower({ shibuiCheck: check({ diffs: [diff("fcfTtm", 5e7, 3.2e7), diff("price", 10, 10.1)] }) });
    expect(inputCheckFailures(f).map((d) => d.field)).toEqual(["fcfTtm"]);
    const a = dcfApplicable(f);
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("inputs disagree with an independent source (Shibui): fcfTtm 50M vs 32M (56%)");
    expect(inputCheckStatus(f)).toBe("FAIL: fcf");
  });
  it("lists every failing guarded input (market cap and shares)", () => {
    const f = grower({ shibuiCheck: check({ diffs: [diff("marketCap", 1e9, 1.5e9), diff("sharesOutstanding", 1e8, 1.5e8)] }) });
    expect(dcfApplicable(f).reason).toBe(
      "inputs disagree with an independent source (Shibui): marketCap 1B vs 1.5B (33%); sharesOutstanding 100M vs 150M (33%)",
    );
  });
  it("a warn on a guarded input does not abstain but is flagged; so is any non-ok price/revenue diff", () => {
    const f = grower({ shibuiCheck: check({ diffs: [diff("sharesOutstanding", 1e8, 1.2e8), diff("revenueQuarter", 30, 50), diff("marketCap", 1e9, 1.01e9)] }) });
    expect(dcfApplicable(f).ok).toBe(true);
    const read = intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N });
    expect(read.flags).toContain("input check (Shibui): sharesOutstanding differs by 17%");
    expect(read.flags).toContain("input check (Shibui): revenueQuarter differs by 40%");
    expect(read.flags.some((x) => x.includes("marketCap"))).toBe(false); // ok → silent
    expect(inputCheckStatus(f)).toBe("FAIL: rev; warn: shares");
  });
  it("an all-ok check changes nothing", () => {
    const base = grower();
    const f = grower({ shibuiCheck: check({ diffs: [diff("marketCap", 1e9, 1.02e9)] }) });
    expect(dcfApplicable(f)).toEqual(dcfApplicable(base));
    expect(intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N })).toEqual(intrinsicRead(base, { r: R, terminalGrowth: GT, horizon: N }));
    expect(inputCheckStatus(f)).toBe("ok");
  });
});

describe("ownerEarningsDetail — fiscal-year FCF fallback skips a missing latest year", () => {
  it("uses the most recent year with FCF (and that year's SBC) instead of reading null as zero", () => {
    const f = synth([100, 110, 121, 133, 146], [10, 11, 12, 13, null], { ttm: { fcfYield: null }, sbc: [1, 1, 1, 2, 3] });
    const d = ownerEarningsDetail(f);
    expect(d).toMatchObject({ fcf: 13, fcfBasis: "fiscalYear", fcfYear: "FY24", sbc: 2, oe: 11 });
    const read = intrinsicRead(f, { r: R, terminalGrowth: GT, horizon: N });
    expect(read.flags).toContain("owner earnings from FY24 FCF (no TTM) — FY25 FCF missing");
  });
});
