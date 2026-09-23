import { describe, it, expect } from "vitest";
import { fixtureReport } from "./__fixtures__/reports";
import { DEFAULT_CONFIG } from "./config";
import { buildSignal } from "./signal";
import { sizePortfolio } from "./sizing";
import { activeWeights } from "./benchmark";
import { assembleSnapshot, PortfolioSnapshot } from "./snapshot";

describe("portfolio pipeline (golden)", () => {
  it("produces a valid, fully-summing snapshot from a small universe", () => {
    const today = new Date("2026-09-01T00:00:00Z");
    const reports = [
      fixtureReport({ ticker: "STRONG", label: "BUY", conviction: 80, scenarios: [[160, 0.3], [130, 0.5], [80, 0.2]] }),
      fixtureReport({ ticker: "HELD2",  label: "BUY", conviction: 60, scenarios: [[140, 0.3], [120, 0.5], [85, 0.2]] }),
      fixtureReport({ ticker: "HOLDME", label: "HOLD", conviction: 50, scenarios: [[130, 0.3], [110, 0.5], [80, 0.2]] }),
    ];
    const prices: Record<string, number> = { STRONG: 100, HELD2: 100, HOLDME: 100 };
    const signals = reports.map((r) => buildSignal(r, prices[r.meta.ticker], 3674, today, DEFAULT_CONFIG));
    const sized = sizePortfolio(signals, DEFAULT_CONFIG);
    const active = activeWeights(signals.map((s) => s.ticker), sized.holdings);
    const snap = assembleSnapshot({ asOf: "2026-09-01", signals, sized, active, spyPrice: 640, config: DEFAULT_CONFIG });

    expect(() => PortfolioSnapshot.parse(snap)).not.toThrow();
    expect(snap.holdings.reduce((a, h) => a + h.weight, 0) + snap.cash).toBeCloseTo(1, 9);
    expect(snap.excluded.map((e) => e.ticker)).toContain("HOLDME");
    // STRONG has the higher mu/conviction, so it is the top (or joint-cap) holding.
    expect(snap.holdings[0].ticker).toBe("STRONG");
    // No weight exceeds the 10% cap.
    for (const h of snap.holdings) expect(h.weight).toBeLessThanOrEqual(DEFAULT_CONFIG.wMax + 1e-9);
  });

  it("never holds hard-banned ICE, even as a top-tier BUY, and lists it excluded", () => {
    const today = new Date("2026-09-01T00:00:00Z");
    const reports = [
      // ICE has the strongest signal in the universe — absent the ban it would be the top holding.
      fixtureReport({ ticker: "ICE",    label: "STRONG BUY", conviction: 90, scenarios: [[200, 0.4], [175, 0.4], [150, 0.2]] }),
      fixtureReport({ ticker: "STRONG", label: "BUY",        conviction: 80, scenarios: [[160, 0.3], [130, 0.5], [80, 0.2]] }),
    ];
    const prices: Record<string, number> = { ICE: 100, STRONG: 100 };
    const signals = reports.map((r) => buildSignal(r, prices[r.meta.ticker], 6200, today, DEFAULT_CONFIG));
    const sized = sizePortfolio(signals, DEFAULT_CONFIG);
    const active = activeWeights(signals.map((s) => s.ticker), sized.holdings);
    const snap = assembleSnapshot({ asOf: "2026-09-01", signals, sized, active, spyPrice: 640, config: DEFAULT_CONFIG });

    expect(() => PortfolioSnapshot.parse(snap)).not.toThrow();
    expect(snap.holdings.map((h) => h.ticker)).not.toContain("ICE");
    const iceExclusion = snap.excluded.find((e) => e.ticker === "ICE");
    expect(iceExclusion?.reasons).toContain("banned: ICE (employer holding restriction)");
  });
});
