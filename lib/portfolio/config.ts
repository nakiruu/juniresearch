/**
 * config.ts — every tunable knob for the v1 portfolio, in one place.
 * Ratios are decimals (0.10 == 10%). See docs/portfolio/01-conceptual-outline.md §13.
 */
export interface PortfolioConfig {
  // Eligibility (§4)
  muMin: number;            // min re-marked expected upside to hold (e.g. 0.05)
  rMin: number;             // min reward/risk (e.g. 0.5)
  convictionMin: number;    // min decision.conviction 0-100 (e.g. 45)
  stalenessMaxDays: number; // drop reports older than this (e.g. 120)
  // Sizing (§6) — score = mu^muExp * conviction^convExp * R^rExp * recency.
  // Bigger weight for higher expected return, higher conviction, higher reward/risk.
  muExp: number;            // score emphasis on expected return mu (e.g. 1)
  convExp: number;          // score emphasis on conviction kappa (e.g. 1)
  rExp: number;             // score emphasis on reward/risk R (e.g. 1)
  alpha: number;            // legacy Kelly fraction — unused by the score-based sizer, kept for config/CLI back-compat
  sigmaMin: number;         // legacy sigma floor — unused by the score-based sizer
  qGainComposite: number;   // quality-tilt gain on composite percentile (e.g. 0.10)
  qGainMoat: number;        // quality-tilt gain on moat score (e.g. 0.20)
  qPenaltyEroding: number;  // quality-tilt penalty for an eroding moat (e.g. 0.10)
  qLo: number;              // quality-tilt clamp low (e.g. 0.8)
  qHi: number;              // quality-tilt clamp high (e.g. 1.2)
  stalenessHalfLifeDays: number; // soft decay half-life (e.g. 90)
  // Constraints (§7)
  wMax: number;             // hard per-name cap — THE knob (default 0.10)
  sectorMax: number;        // max weight per SIC-2-digit sector (e.g. 0.30)
  wMin: number;             // dust floor; below this a name is dropped (0 = no floor, hold every eligible name)
  cashFloor: number;        // frictional min cash (e.g. 0.01)
  cashCeiling: number;      // soft max cash (e.g. 0.35)
  minNamesForCeiling: number; // ceiling binds only with at least this many holdings (e.g. 4)
}

export const DEFAULT_CONFIG: PortfolioConfig = {
  muMin: 0.05, rMin: 0.5, convictionMin: 45, stalenessMaxDays: 120,
  muExp: 1, convExp: 1, rExp: 1,
  alpha: 0.4, sigmaMin: 0.05,
  qGainComposite: 0.10, qGainMoat: 0.20, qPenaltyEroding: 0.10, qLo: 0.8, qHi: 1.2,
  stalenessHalfLifeDays: 90,
  wMax: 0.10, sectorMax: 0.30, wMin: 0,
  cashFloor: 0.01, cashCeiling: 0.35, minNamesForCeiling: 4,
};

export function resolveConfig(overrides: Partial<PortfolioConfig> = {}): PortfolioConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
