import { describe, it, expect } from "vitest";
import { normCdf, realizedVol, touchProbability } from "./touch";
import { scoreWeight, sizePortfolio } from "./sizing";
import { DEFAULT_CONFIG } from "./config";
import { buildSignal, type Signal } from "./signal";

/** Deterministic PRNG (mulberry32) + Box–Muller, so the Monte Carlo check is reproducible. */
function rng(seed: number) {
  let a = seed;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

describe("normCdf", () => {
  it("matches known values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.9750, 4);
    expect(normCdf(-1)).toBeCloseTo(0.1587, 4);
  });
});

describe("touchProbability (display only)", () => {
  it("agrees with a seeded Monte Carlo of the same GBM within 0.02", () => {
    const S0 = 100, H = 120, sigma = 0.4, mu = 0, T = 1, steps = 504, paths = 10_000;
    const n = rng(42), dt = T / steps, nu = mu - sigma * sigma / 2;
    let hits = 0;
    for (let p = 0; p < paths; p++) {
      let x = 0;
      for (let k = 0; k < steps; k++) { x += nu * dt + sigma * Math.sqrt(dt) * n(); if (x >= Math.log(H / S0)) { hits++; break; } }
    }
    // A 504-step walk only checks the barrier at discrete times, so it misses some touches; the
    // Broadie–Glasserman shift (barrier × e^{0.5826σ√dt}) puts the continuous formula on the same basis.
    const mc = hits / paths;
    expect(Math.abs(touchProbability(S0, H * Math.exp(0.5826 * sigma * Math.sqrt(dt)), sigma, mu, T) - mc)).toBeLessThan(0.02);
    expect(touchProbability(S0, H, sigma, mu, T)).toBeGreaterThan(mc); // continuous monitoring can only touch more
  });
  it("is 1 when the target is at or below the price", () => {
    expect(touchProbability(100, 100, 0.3, 0, 1)).toBe(1);
    expect(touchProbability(100, 90, 0.3, 0, 1)).toBe(1);
  });
  it("rises with volatility (the reason it must never rank the book)", () => {
    const at = (s: number) => touchProbability(100, 120, s, 0, 1);
    expect(at(0.2)).toBeLessThan(at(0.4));
    expect(at(0.4)).toBeLessThan(at(0.9));
  });
  it("rises with drift and with horizon", () => {
    expect(touchProbability(100, 120, 0.3, 0.1, 1)).toBeGreaterThan(touchProbability(100, 120, 0.3, 0, 1));
    expect(touchProbability(100, 120, 0.3, 0, 2)).toBeGreaterThan(touchProbability(100, 120, 0.3, 0, 1));
  });
});

describe("realizedVol", () => {
  it("annualizes daily log-return sd and needs ≥20 returns", () => {
    const closes = Array.from({ length: 31 }, (_, i) => 100 * Math.exp((i % 2 ? 0.01 : -0.01) * 1));
    expect(realizedVol(closes)).toBeGreaterThan(0);
    expect(realizedVol(closes.slice(0, 20))).toBeNull();
    expect(realizedVol([...closes.slice(0, 25), 0])).toBeNull();
  });
});

describe("touch is display-only (guard)", () => {
  type Sig = Signal;
  const sig = (o: Partial<Sig>): Sig => ({ ticker: "A", company: "A", sector: "35", label: "BUY", gatedLabel: "BUY", price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.7, quality: 1, ageDays: 5, staleness: 1, ...o });
  it("changing touch changes neither the score nor the book", () => {
    const a = [sig({ ticker: "A", touch: 0.1 }), sig({ ticker: "B", touch: 0.9 })];
    const b = [sig({ ticker: "A", touch: 0.9 }), sig({ ticker: "B", touch: null })];
    expect(scoreWeight(a[0], DEFAULT_CONFIG)).toBe(scoreWeight(b[0], DEFAULT_CONFIG));
    expect(sizePortfolio(a, DEFAULT_CONFIG)).toEqual(sizePortfolio(b, DEFAULT_CONFIG));
  });
  it("buildSignal fills touch from the report's recent closes (null without them)", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, close: 100 * (1 + 0.01 * Math.sin(i)) }));
    const report = {
      meta: { ticker: "T", company: "T", reportDate: "September 1, 2026" },
      rating: { label: "BUY", conviction: {}, decision: { conviction: 70 } },
      quote: { currentPrice: 100, history },
      sections: { valuation: { scenarios: [{ name: "Bull", impliedPrice: 150, probability: 0.3 }, { name: "Base", impliedPrice: 120, probability: 0.5 }, { name: "Bear", impliedPrice: 80, probability: 0.2 }] } },
    } as unknown as Parameters<typeof buildSignal>[0];
    const s = buildSignal(report, 100, null, new Date("2026-09-02T00:00:00Z"), DEFAULT_CONFIG);
    expect(s.touch).toBeGreaterThan(0);
    expect(s.touch).toBeLessThan(1);
    const bare = buildSignal({ ...report, quote: { currentPrice: 100 } } as typeof report, 100, null, new Date("2026-09-02T00:00:00Z"), DEFAULT_CONFIG);
    expect(bare.touch).toBeNull();
  });
});
