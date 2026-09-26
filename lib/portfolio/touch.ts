/**
 * touch.ts — "how plausible is fair value within a year?" (spec #1). DISPLAY ONLY.
 *
 * The probability that a geometric Brownian motion starting at S0 touches H > S0 at least once
 * within T years (first passage), with volatility σ from recent closes. It is deliberately NOT a
 * sizing, eligibility or tie-break input: on the published reports it correlates +0.73 with realized
 * volatility and −0.58 with R, so using it to rank would steer the book toward volatile names. It is
 * a model output with ~13% relative error on σ from 30 closes — a sanity flag, not a forecast.
 */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Annualized volatility of daily log returns; null with fewer than 20 returns or any non-positive close. */
export function realizedVol(closes: number[], annualize = 252): number | null {
  if (closes.length < 21 || closes.some((c) => !(c > 0))) return null;
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const m = r.reduce((a, x) => a + x, 0) / r.length;
  const v = r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * annualize);
}

/**
 * P(max_{t≤T} S_t ≥ H) for dS/S = μ dt + σ dW, with log drift ν = μ − σ²/2:
 *   b = ln(H/S0);  P = Φ((νT − b)/(σ√T)) + e^{2νb/σ²} · Φ((−b − νT)/(σ√T)).
 * H ≤ S0 → 1 (already there). `muAnnual` is the arithmetic drift (0 = no drift assumed).
 */
export function touchProbability(S0: number, H: number, sigma: number, muAnnual: number, T: number): number {
  if (!(S0 > 0) || !(H > 0) || !(T > 0)) return NaN;
  if (H <= S0) return 1;
  if (!(sigma > 0)) return muAnnual > 0 && Math.log(H / S0) <= muAnnual * T ? 1 : 0;
  const b = Math.log(H / S0);
  const nu = muAnnual - (sigma * sigma) / 2;
  const s = sigma * Math.sqrt(T);
  const p = normCdf((nu * T - b) / s) + Math.exp((2 * nu * b) / (sigma * sigma)) * normCdf((-b - nu * T) / s);
  return Math.min(1, Math.max(0, p));
}
