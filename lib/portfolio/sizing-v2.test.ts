import { describe, it, expect } from "vitest";
import type { Report } from "@/lib/report.schema";
import type { Signal } from "./signal";
import { DEFAULT_CONFIG } from "./config";
import { sizePortfolio } from "./sizing";
import { scoreWeightV2, liquidityFactor, makeV2Scorer, DEFAULT_SIZING_V2 } from "./sizing-v2";

const sig = (o: Partial<Signal>): Signal => ({
  ticker: "X", company: "X", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.5,
  quality: 1, ageDays: 0, staleness: 1, ...o,
});

describe("liquidityFactor", () => {
  it("buckets by market cap, no penalty when unknown", () => {
    const c = DEFAULT_SIZING_V2;
    expect(liquidityFactor(50e9, c)).toBe(1.0);
    expect(liquidityFactor(5e9, c)).toBe(0.9);
    expect(liquidityFactor(1e9, c)).toBe(0.7);
    expect(liquidityFactor(null, c)).toBe(1.0);
  });
});

describe("scoreWeightV2", () => {
  const c = DEFAULT_SIZING_V2; // R core, α=1.0, β=0.6
  it("at neutral conviction and quality (50/50) with full liquidity, the score is the bounded core mu*R", () => {
    expect(scoreWeightV2(sig({ mu: 0.2, R: 1 }), 50, 1, c)).toBeCloseTo(0.2, 9);
  });
  it("tilts up with conviction (C/50)^alpha", () => {
    expect(scoreWeightV2(sig({ kappa: 0.9 }), 50, 1, c)).toBeCloseTo(0.2 * Math.pow(90 / 50, 1.0), 9); // 0.36
  });
  it("tilts with quality (Q/50)^beta, beta=0.6", () => {
    expect(scoreWeightV2(sig({}), 100, 1, c)).toBeCloseTo(0.2 * Math.pow(100 / 50, 0.6), 9); // ~0.303
    expect(scoreWeightV2(sig({}), 25, 1, c)).toBeCloseTo(0.2 * Math.pow(25 / 50, 0.6), 9);   // ~0.132
  });
  it("scales by liquidity and staleness", () => {
    expect(scoreWeightV2(sig({}), 50, 0.7, c)).toBeCloseTo(0.14, 9);
    expect(scoreWeightV2(sig({ staleness: 0.5 }), 50, 1, c)).toBeCloseTo(0.1, 9);
  });
  it("uses the bounded 1/sigma core (never mu/sigma^2) when riskCore is invSigma", () => {
    const iv = { ...c, riskCore: "invSigma" as const };
    expect(scoreWeightV2(sig({ mu: 0.2, sigma: 0.25 }), 50, 1, iv)).toBeCloseTo(0.8, 9); // 0.2 / 0.25
    // the floor prevents a blow-up on a tiny scenario sigma
    expect(scoreWeightV2(sig({ mu: 0.2, sigma: 0.001 }), 50, 1, iv)).toBeCloseTo(0.2 / iv.sigmaFloor, 9);
  });
  it("returns 0 for a name without reward/risk", () => {
    expect(scoreWeightV2(sig({ R: null }), 80, 1, c)).toBe(0);
  });
});

// Reports carrying the financials the quality composite reads (see quality.test.ts for the shape).
type Row = [string, (number | null)[]];
function rep(o: { ticker: string; moat?: string; income?: Row[]; balance?: Row[]; cashflow?: Row[] }): Report {
  const table = (rows: Row[]) => ({ columns: ["Metric", "FY21", "FY22", "FY23", "FY24", "FY25"], rows: rows.map(([label, values]) => ({ label, values, format: "num" })) });
  return {
    meta: { ticker: o.ticker, company: o.ticker, reportDate: "September 1, 2026" },
    rating: { decision: { conviction: 60, moat: { width: o.moat ?? "NARROW", trend: "STABLE" } } },
    sections: { financials: { income: table(o.income ?? []), balance: table(o.balance ?? []), cashflow: table(o.cashflow ?? []) } },
  } as unknown as Report;
}
const strong = rep({ ticker: "HIQ", moat: "WIDE", income: [["Operating Income ($B)", [2, 2, 2, 2, 2]], ["Net Income ($B)", [1.5, 1.5, 1.5, 1.5, 1.5]]], balance: [["Total Debt", [1, 1, 1, 1, 1]], ["Total Equity", [10, 10, 10, 10, 10]], ["Cash & ST Investments", [2, 2, 2, 2, 2]], ["Net Debt", [-1, -1, -1, -1, -1]], ["Current Ratio", [2.5, 2.5, 2.5, 2.5, 2.5]]], cashflow: [["Free Cash Flow", [1.4, 1.4, 1.4, 1.4, 1.4]]] });
const weak = rep({ ticker: "LOQ", moat: "NONE", income: [["Operating Income ($B)", [0.1, 0.1, 0.1, 0.1, 0.1]], ["Net Income ($B)", [0.3, 0.02, 0.4, 0.01, 0.2]]], balance: [["Total Debt", [9, 9, 9, 9, 9]], ["Total Equity", [10, 10, 10, 10, 10]], ["Cash & ST Investments", [0.1, 0.1, 0.1, 0.1, 0.1]], ["Net Debt", [8.9, 8.9, 8.9, 8.9, 8.9]], ["Current Ratio", [0.6, 0.6, 0.6, 0.6, 0.6]]], cashflow: [["Free Cash Flow", [0.05, 0.05, 0.05, 0.05, 0.05]]] });

describe("makeV2Scorer + sizePortfolio", () => {
  it("scores the higher-quality name above an otherwise-identical low-quality name, and the book follows", () => {
    const reports = [strong, weak];
    const scorer = makeV2Scorer(reports, new Map(), DEFAULT_SIZING_V2);
    const hi = sig({ ticker: "HIQ", sector: "36", mu: 0.2, R: 1, kappa: 0.6 });
    const lo = sig({ ticker: "LOQ", sector: "36", mu: 0.2, R: 1, kappa: 0.6 });
    expect(scorer(hi)).toBeGreaterThan(scorer(lo));                 // same mu/R/conviction → quality breaks the tie
    // With the per-name and sector caps lifted the two names split the target in proportion to score,
    // so the tilt is visible in the weights. (Under the production caps two names against a 99% target
    // both clip to a cap — the tilt shows below the caps in a realistic book, per the scorer order above.)
    const out = sizePortfolio([hi, lo], { ...DEFAULT_CONFIG, wMax: 0.7, sectorMax: 1 }, scorer);
    const w = Object.fromEntries(out.holdings.map((h) => [h.ticker, h.weight]));
    expect(w.HIQ).toBeGreaterThan(w.LOQ);
    expect(w.HIQ + w.LOQ + out.cash).toBeCloseTo(1, 9);
  });
  it("falls back to neutral quality (50) for a ticker with no report", () => {
    const scorer = makeV2Scorer([strong], new Map(), DEFAULT_SIZING_V2);
    // "GHOST" has no report → Q defaults to 50 → neutral quality tilt, score = mu*R
    expect(scorer(sig({ ticker: "GHOST", mu: 0.2, R: 1, kappa: 0.5 }))).toBeCloseTo(0.2, 9);
  });
});
