/**
 * uncertainty.ts — a Morningstar-style Uncertainty Rating for a name (11.md §3).
 * -----------------------------------------------------------------------------
 * The one structural idea the rating system lacked: uncertainty should WIDEN the
 * rating bands, not just lower a separate conviction number. This scores an
 * uncertainty tier (Low/Medium/High/Very High) from data the FactPack already
 * carries — analyst-target dispersion, leverage, sector cyclicality, data
 * completeness, revenue concentration — and a multiplier that widens the minimum
 * upside a bullish label demands as the tier rises. The tier is always computed
 * and persisted (visible to the reader); the band-widening is opt-in in decide().
 */
export type UncertaintyTier = "low" | "medium" | "high" | "veryHigh";
export type Sector = "financial" | "utility" | "industrial";

export interface UncertaintyInputs {
  dispersion: number | null; // (highTarget − lowTarget) / medianTarget
  sic: number | null;
  netDebtToEbitda: number | null;
  netDebtor: boolean;
  fiscalYears: number;
  abstentions: number; // count of moat/intrinsic/composite layers that abstained (0–3)
  segmentHHI: number | null; // Σ share² over reporting segments
  sector: Sector;
}

/** Herfindahl index of revenue concentration; null when there are no segments. */
export function segmentHHI(items: { share: number }[]): number | null {
  if (!items.length) return null;
  return items.reduce((a, s) => a + (Number.isFinite(s.share) ? s.share * s.share : 0), 0);
}

const CYCLICAL = (sic: number): boolean =>
  sic === 3674 || (sic >= 1000 && sic <= 1499) || (sic >= 1300 && sic <= 1399) || (sic >= 2900 && sic <= 2999) || sic === 3711 || sic === 4512;
const DEFENSIVE = (sic: number): boolean =>
  (sic >= 4900 && sic <= 4999) || sic === 2834 || (sic >= 2000 && sic <= 2111) || sic === 4813;

export function uncertaintyTier(u: UncertaintyInputs): { tier: UncertaintyTier; points: number; drivers: string[] } {
  const drivers: string[] = [];
  let points = 0;
  const add = (p: number, why: string) => { if (p > 0) { points += p; drivers.push(`${why} (+${p})`); } };

  const d = u.dispersion;
  if (d != null) add(d > 1.0 ? 3 : d > 0.6 ? 2 : d > 0.3 ? 1 : 0, "wide analyst-target dispersion");

  // Leverage and concentration are structural for banks/utilities, not a source of outcome uncertainty.
  const structural = u.sector !== "industrial";
  if (!structural && u.netDebtor && u.netDebtToEbitda != null && u.netDebtToEbitda > 3) add(2, "elevated leverage");

  if (u.sic != null) {
    if (CYCLICAL(u.sic)) add(2, "cyclical industry");
    else if (!DEFENSIVE(u.sic)) add(1, "non-defensive industry");
  }

  if (u.fiscalYears < 5) add(1, `short history (${u.fiscalYears} FY)`);
  add(Math.min(3, u.abstentions), "layers abstained / thin data");

  if (!structural && u.segmentHHI != null) add(u.segmentHHI > 0.5 ? 2 : u.segmentHHI > 0.25 ? 1 : 0, "revenue concentration");

  const tier: UncertaintyTier = points <= 2 ? "low" : points <= 5 ? "medium" : points <= 8 ? "high" : "veryHigh";
  return { tier, points, drivers };
}

/**
 * The factor that widens the minimum upside a bullish label (BUY / STRONG BUY) demands as
 * uncertainty rises (11.md §3): at Low, today's thresholds; at High, ~1.8× (BUY needs ~18%
 * upside, not 10%); at Very High, 2.5×. A desk config would hold these; the values live here
 * until the desk.json band table is added.
 */
export function uncertaintyMultiplier(tier: UncertaintyTier): number {
  return { low: 1, medium: 1.2, high: 1.8, veryHigh: 2.5 }[tier];
}
