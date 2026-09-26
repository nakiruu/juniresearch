import type { Report } from "@/lib/report.schema";
import type { PortfolioConfig } from "./config";
import { realizedVol, touchProbability } from "./touch";

export interface Signal {
  ticker: string; company: string; sector: string;
  label: Report["rating"]["label"]; gatedLabel: Report["rating"]["label"] | null;
  price: number; mu: number; sigma: number; sigmaDown: number;
  D: number; R: number | null; kappa: number; quality: number;
  ageDays: number; staleness: number;
  /**
   * DISPLAY ONLY: model probability the price touches probability-weighted fair value within
   * touchHorizonYears (lib/portfolio/touch.ts), from the report's recent closes; null without ≥21
   * closes. Never read by scoring, eligibility or the trade layer — it rewards volatility.
   */
  touch?: number | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const moatScore = (w?: string) => (w === "WIDE" ? 1 : w === "NARROW" ? 0.5 : w === "NONE" ? 0 : 0.25);

// Parses a display date like "September 1, 2026" as a UTC midnight instant so
// ageDays is stable regardless of the host's local timezone.
function parseReportDateUTC(reportDate: string): Date {
  const parsedLocal = new Date(reportDate);
  if (Number.isNaN(parsedLocal.getTime())) return new Date(NaN);
  return new Date(Date.UTC(
    parsedLocal.getFullYear(), parsedLocal.getMonth(), parsedLocal.getDate(),
  ));
}

export function buildSignal(report: Report, livePrice: number, sic: number | null, today: Date, config: PortfolioConfig): Signal {
  const r = report.rating;
  const scen = report.sections.valuation.scenarios.map((s) => ({
    ret: s.impliedPrice / livePrice - 1, p: s.probability, name: s.name,
  }));
  const mu = scen.reduce((a, s) => a + s.p * s.ret, 0);
  const variance = scen.reduce((a, s) => a + s.p * (s.ret - mu) ** 2, 0);
  const sigma = Math.sqrt(Math.max(0, variance));
  const downVar = scen.filter((s) => s.ret < 0).reduce((a, s) => a + s.p * s.ret ** 2, 0);
  const sigmaDown = Math.sqrt(Math.max(0, downVar));
  const bear = scen.reduce((lo, s) => (s.ret < lo.ret ? s : lo), scen[0]);
  const D = Math.max(0, -bear.ret);
  const R = D > 0 ? mu / D : null;

  const dec = r.decision;
  const kappa = dec ? dec.conviction / 100 : 0;
  const compositePctile = dec?.composite?.percentile ?? 50;
  const eroding = dec?.moat?.trend === "ERODING";
  const quality = clamp(
    1 + config.qGainComposite * (compositePctile - 50) / 50
      + config.qGainMoat * (moatScore(dec?.moat?.width) - 0.5)
      - config.qPenaltyEroding * (eroding ? 1 : 0),
    config.qLo, config.qHi,
  );

  const reportDate = parseReportDateUTC(report.meta.reportDate);
  const ageDays = Math.max(0, Math.round((today.getTime() - reportDate.getTime()) / 86_400_000));
  // A true half-life: a report stalenessHalfLifeDays old counts half (exp(-age/h) was an e-folding time — ~62-day half-life at h=90).
  const staleness = Math.pow(0.5, ageDays / config.stalenessHalfLifeDays);

  const closes = report.quote?.history?.map((h) => h.close) ?? []; // fixtures may omit the quote
  const vol = realizedVol(closes);
  const fairValue = scen.reduce((a, s) => a + s.p * (1 + s.ret) * livePrice, 0);
  const touch = vol != null && livePrice > 0 ? touchProbability(livePrice, fairValue, vol, config.touchDrift, config.touchHorizonYears) : null;

  return {
    ticker: report.meta.ticker, company: report.meta.company,
    sector: sic != null && Number.isFinite(sic) ? String(Math.floor(sic / 100)).padStart(2, "0") : "??",
    label: r.label, gatedLabel: r.gate?.gatedLabel ?? null,
    price: livePrice, mu, sigma, sigmaDown, D, R, kappa, quality, ageDays, staleness, touch,
  };
}
