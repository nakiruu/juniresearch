import { describe, it, expect } from "vitest";
import { scoreWeight, allocateCapped, sizePortfolio } from "./sizing";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const sig = (o: Partial<Signal>): Signal => ({
  ticker: "X", company: "X", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.6,
  quality: 1, ageDays: 0, staleness: 1, ...o,
});

describe("scoreWeight", () => {
  it("is the neutral product mu * conviction * R * recency at unit exponents", () => {
    // 0.2 * 0.6 * 1.0 * 1 = 0.12
    expect(scoreWeight(sig({}), DEFAULT_CONFIG)).toBeCloseTo(0.12, 9);
  });

  it("rises with each of expected return, conviction, and reward/risk", () => {
    const base = scoreWeight(sig({}), DEFAULT_CONFIG);
    expect(scoreWeight(sig({ mu: 0.4 }), DEFAULT_CONFIG)).toBeGreaterThan(base);
    expect(scoreWeight(sig({ kappa: 0.9 }), DEFAULT_CONFIG)).toBeGreaterThan(base);
    expect(scoreWeight(sig({ R: 2 }), DEFAULT_CONFIG)).toBeGreaterThan(base);
  });

  it("down-weights a staler report", () => {
    expect(scoreWeight(sig({ staleness: 0.5 }), DEFAULT_CONFIG)).toBeCloseTo(0.06, 9);
  });

  it("honors the tunable exponents (rExp 0 removes reward/risk influence)", () => {
    const cfg = { ...DEFAULT_CONFIG, rExp: 0 };
    expect(scoreWeight(sig({ R: 1 }), cfg)).toBeCloseTo(scoreWeight(sig({ R: 5 }), cfg), 9);
  });

  it("returns 0 for a name with no reward/risk", () => {
    expect(scoreWeight(sig({ R: null }), DEFAULT_CONFIG)).toBe(0);
  });

  it("ignores quality by default, so the analytical snapshot is unchanged", () => {
    expect(scoreWeight(sig({ quality: 1.2 }), DEFAULT_CONFIG)).toBeCloseTo(0.12, 9);
  });
  it("multiplies by quality when the tilt is requested", () => {
    expect(scoreWeight(sig({ quality: 1.2 }), DEFAULT_CONFIG, { qualityTilt: true })).toBeCloseTo(0.144, 9);
    expect(scoreWeight(sig({ quality: 0.8 }), DEFAULT_CONFIG, { qualityTilt: true })).toBeCloseTo(0.096, 9);
  });
});

describe("allocateCapped", () => {
  it("splits in proportion to score when no cap binds", () => {
    const out = allocateCapped(
      [{ ticker: "A", sector: "10", score: 3 }, { ticker: "B", sector: "20", score: 1 }],
      0.08, DEFAULT_CONFIG,
    );
    const w = Object.fromEntries(out.map((o) => [o.ticker, o.weight]));
    expect(w.A).toBeCloseTo(0.06, 9);
    expect(w.B).toBeCloseTo(0.02, 9);
  });

  it("caps a dominant name at wMax and redistributes the excess to the next-best name", () => {
    const out = allocateCapped(
      [{ ticker: "A", sector: "10", score: 10 }, { ticker: "B", sector: "20", score: 1 }],
      0.15, DEFAULT_CONFIG,
    );
    const w = Object.fromEntries(out.map((o) => [o.ticker, o.weight]));
    expect(w.A).toBeCloseTo(0.10, 9);          // hit the per-name cap
    expect(w.B).toBeCloseTo(0.05, 9);          // got the redistributed remainder, not its naive 0.0136
    expect(w.A + w.B).toBeCloseTo(0.15, 9);
  });

  it("holds an over-weight sector to sectorMax and flows the excess to another sector", () => {
    const out = allocateCapped([
      { ticker: "A", sector: "36", score: 5 },
      { ticker: "B", sector: "36", score: 5 },
      { ticker: "C", sector: "36", score: 5 },
      { ticker: "D", sector: "36", score: 5 },
      { ticker: "E", sector: "60", score: 1 }, // lower score, but a roomy sector
    ], 0.99, DEFAULT_CONFIG);
    const w = Object.fromEntries(out.map((o) => [o.ticker, o.weight]));
    const sec36 = w.A + w.B + w.C + w.D;
    expect(sec36).toBeCloseTo(0.30, 6);        // sector held to the cap
    expect(w.E).toBeCloseTo(0.10, 6);          // pulled up to its own cap by redistribution
    for (const o of out) expect(o.weight).toBeLessThanOrEqual(DEFAULT_CONFIG.wMax + 1e-9);
  });

  it("leaves capacity unplaced (later cash) when the caps cannot absorb the target", () => {
    const out = allocateCapped(
      [{ ticker: "A", sector: "10", score: 1 }, { ticker: "B", sector: "20", score: 1 }],
      0.99, DEFAULT_CONFIG,
    );
    for (const o of out) expect(o.weight).toBeCloseTo(0.10, 9); // both at cap
    expect(out.reduce((a, o) => a + o.weight, 0)).toBeCloseTo(0.20, 9);
  });
});

describe("sizePortfolio", () => {
  it("holds eligible names, lists the excluded with reasons, and sums to 1", () => {
    const out = sizePortfolio([
      sig({ ticker: "A" }),
      sig({ ticker: "B", label: "HOLD" }),   // excluded (not buy-side)
      sig({ ticker: "C", mu: 0.01 }),         // excluded (rallied out)
    ], DEFAULT_CONFIG);
    expect(out.holdings.map((h) => h.ticker)).toEqual(["A"]);
    expect(out.excluded.map((e) => e.ticker).sort()).toEqual(["B", "C"]);
    expect(out.holdings.reduce((a, h) => a + h.weight, 0) + out.cash).toBeCloseTo(1, 9);
  });

  it("returns an all-cash book when nothing is eligible", () => {
    const out = sizePortfolio([sig({ label: "HOLD" })], DEFAULT_CONFIG);
    expect(out.holdings).toHaveLength(0);
    expect(out.cash).toBeCloseTo(1, 9);
  });

  it("makes the best names on mu/conviction/R the biggest holdings (weights non-increasing in score)", () => {
    // 12 names, each its own sector so only the per-name cap binds; mu descends.
    const mus = [0.30, 0.28, 0.26, 0.24, 0.22, 0.20, 0.18, 0.16, 0.14, 0.12, 0.10, 0.08];
    const signals = mus.map((mu, i) =>
      sig({ ticker: `T${i}`, sector: String(10 + i), mu, R: 1 + mu, kappa: 0.6 }));
    const out = sizePortfolio(signals, DEFAULT_CONFIG);
    const byTicker = new Map(out.holdings.map((h) => [h.ticker, h.weight]));
    // scores strictly descend with i, so weights must be non-increasing with i
    for (let i = 1; i < mus.length; i++) {
      const prev = byTicker.get(`T${i - 1}`) ?? 0;
      const cur = byTicker.get(`T${i}`) ?? 0;
      expect(prev).toBeGreaterThanOrEqual(cur - 1e-9);
    }
    expect(byTicker.get("T0")).toBeCloseTo(DEFAULT_CONFIG.wMax, 6); // top name at the cap
    expect(out.holdings.reduce((a, h) => a + h.weight, 0) + out.cash).toBeCloseTo(1, 9);
    for (const h of out.holdings) expect(h.weight).toBeLessThanOrEqual(DEFAULT_CONFIG.wMax + 1e-9);
  });

  it("respects the sector cap across the book", () => {
    // 6 names all in sector 36 -> the sector total must not exceed sectorMax.
    const signals = [0.30, 0.28, 0.26, 0.24, 0.22, 0.20].map((mu, i) =>
      sig({ ticker: `S${i}`, sector: "36", mu, R: 1 + mu }));
    const out = sizePortfolio(signals, DEFAULT_CONFIG);
    const sec = out.holdings.filter((h) => h.sector === "36").reduce((a, h) => a + h.weight, 0);
    expect(sec).toBeLessThanOrEqual(DEFAULT_CONFIG.sectorMax + 1e-6);
  });
});
