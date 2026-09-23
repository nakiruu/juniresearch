import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";
import { assessEligibility } from "./eligibility";

/**
 * scoreWeight — a name's desirability score, which drives its share of the book.
 *
 * The score rewards exactly the three signals we size on:
 *   - higher expected return  (mu)
 *   - higher conviction       (kappa, 0..1)
 *   - higher reward/risk      (R = expected upside / bear-case downside)
 * times a mild recency multiplier (staleness). Each factor's emphasis is a tunable
 * exponent (config.muExp/convExp/rExp), so a product of ones is the neutral blend.
 *
 * Weights are later allocated in proportion to this score, so the best names on
 * these three signals become the largest holdings — not everyone flattened to the
 * per-name cap (the old fractional-Kelly weights nearly all saturated wMax, which
 * collapsed the book to equal weight).
 *
 * Every eligible name has mu, kappa and R strictly positive (the eligibility gate
 * requires mu >= muMin, R >= rMin, kappa*100 >= convictionMin), so the product is
 * well-defined and positive. We still guard defensively for a null/degenerate R.
 */
export function scoreWeight(s: Signal, config: PortfolioConfig): number {
  if (s.R == null) return 0;
  const mu = Math.max(s.mu, 0);
  const conv = Math.max(s.kappa, 0);
  const r = Math.max(s.R, 0);
  const score =
    Math.pow(mu, config.muExp) *
    Math.pow(conv, config.convExp) *
    Math.pow(r, config.rExp) *
    s.staleness;
  return Number.isFinite(score) && score > 0 ? score : 0;
}

export interface Weighted { ticker: string; sector: string; weight: number }

interface Scored { ticker: string; sector: string; score: number }

/**
 * allocateCapped — distribute `target` (the invested fraction, e.g. 0.99) across
 * items in proportion to their score, honoring a per-name cap (wMax) and a
 * per-sector cap (sectorMax) by WATER-FILLING: weight freed when a name hits its
 * cap, or when a sector is scaled back to its cap, flows to the best remaining
 * names rather than leaking to cash or flattening everyone to the cap. The book
 * therefore stays concentrated in the highest-scoring names while no single name
 * or sector can overcrowd it.
 *
 * If the caps physically cannot absorb `target` (too few names, or too few
 * sectors), the shortfall is left unplaced and surfaces later as cash — the
 * honest "not enough to hold under the caps" outcome, never leverage.
 */
export function allocateCapped(items: Scored[], target: number, config: PortfolioConfig): Weighted[] {
  const weights = new Map<string, number>(items.map((i) => [i.ticker, 0]));
  const nameFrozen = new Set<string>();   // hit the per-name cap
  const sectorFrozen = new Set<string>(); // sector at its cap

  // Bounded by the number of freeze events possible (names + sectors); the extra
  // headroom is pure safety against floating-point stalls.
  const maxIters = items.length * 4 + 16;
  for (let iter = 0; iter < maxIters; iter++) {
    const assigned = sum(weights.values());
    const remaining = target - assigned;
    if (remaining <= 1e-12) break;

    const free = items.filter(
      (i) => i.score > 0 && !nameFrozen.has(i.ticker) && !sectorFrozen.has(i.sector),
    );
    const freeScore = free.reduce((a, i) => a + i.score, 0);
    if (freeScore <= 0) break;

    let changed = false;

    // 1. Hand out the remaining capacity in proportion to score; clamp any name
    //    that reaches the per-name cap and freeze it.
    for (const i of free) {
      const next = (weights.get(i.ticker) ?? 0) + remaining * (i.score / freeScore);
      if (next >= config.wMax - 1e-12) {
        weights.set(i.ticker, config.wMax);
        nameFrozen.add(i.ticker);
        changed = true;
      } else {
        weights.set(i.ticker, next);
      }
    }

    // 2. Any sector now over its cap is scaled to exactly the cap and frozen; the
    //    weight it sheds returns to `remaining` on the next pass for other sectors.
    const bySector = new Map<string, number>();
    for (const i of items) bySector.set(i.sector, (bySector.get(i.sector) ?? 0) + (weights.get(i.ticker) ?? 0));
    for (const [sec, total] of bySector) {
      if (!sectorFrozen.has(sec) && total > config.sectorMax + 1e-12) {
        const scale = config.sectorMax / total;
        for (const i of items) {
          if (i.sector === sec) weights.set(i.ticker, (weights.get(i.ticker) ?? 0) * scale);
        }
        sectorFrozen.add(sec);
        changed = true;
      }
    }

    // Neither a name nor a sector froze this pass: the proportional fill placed the
    // whole remainder, so we're done.
    if (!changed) break;
  }

  return items.map((i) => ({ ticker: i.ticker, sector: i.sector, weight: weights.get(i.ticker) ?? 0 }));
}

export interface Sized {
  holdings: Weighted[]; cash: number; excluded: { ticker: string; reasons: string[] }[];
}

export function sizePortfolio(signals: Signal[], config: PortfolioConfig): Sized {
  const eligible: Signal[] = [];
  const excluded: { ticker: string; reasons: string[] }[] = [];
  for (const s of signals) {
    const e = assessEligibility(s, config);
    if (e.eligible) eligible.push(s);
    else excluded.push({ ticker: s.ticker, reasons: e.reasons });
  }

  const target = 1 - config.cashFloor;
  let scored: Scored[] = eligible
    .map((s) => ({ ticker: s.ticker, sector: s.sector, score: scoreWeight(s, config) }))
    .filter((i) => i.score > 0);

  // Allocate, then drop any dust below wMin and re-allocate the survivors so the
  // freed weight redistributes to the best names (rather than sitting as cash).
  // Dropping can expose new dust, so iterate to a fixed point.
  let holdings: Weighted[] = [];
  for (let pass = 0; pass < eligible.length + 1; pass++) {
    holdings = allocateCapped(scored, target, config);
    const survivors = holdings.filter((w) => w.weight >= config.wMin);
    if (survivors.length === scored.length) break;
    scored = scored.filter((i) => survivors.some((w) => w.ticker === i.ticker));
    if (scored.length === 0) break;
  }

  holdings = holdings.filter((w) => w.weight > 0);
  const invested = holdings.reduce((a, w) => a + w.weight, 0);
  const cash = 1 - invested;
  return { holdings, cash, excluded };
}

function sum(xs: Iterable<number>): number {
  let a = 0;
  for (const x of xs) a += x;
  return a;
}
