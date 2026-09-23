import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";

const BUY_SIDE = new Set(["BUY", "STRONG BUY"]);

/**
 * Tickers the portfolio is HARD-BANNED from ever holding, whatever the rating,
 * conviction, or expected upside. This is a compliance guardrail, NOT a tunable
 * knob: it deliberately lives outside PortfolioConfig so that no CLI flag, config
 * override, or scenario re-mark can switch it off.
 *
 *   ICE (Intercontinental Exchange) — the portfolio owner is an ICE employee, so
 *   discretionary positions beyond company-vested shares carry insider-trading /
 *   conflict-of-interest risk. The book must never take an ICE position.
 */
export const BANNED_TICKERS: ReadonlySet<string> = new Set(["ICE"]);

/** True if `ticker` is on the hard-ban list (whitespace- and case-insensitive). */
export function isBannedTicker(ticker: string): boolean {
  return BANNED_TICKERS.has(ticker.trim().toUpperCase());
}

export function assessEligibility(s: Signal, config: PortfolioConfig): { eligible: boolean; reasons: string[] } {
  // Hard ban short-circuits every other signal: a banned name is never held,
  // however strong its report. It still surfaces in the snapshot's `excluded`
  // list with this reason, so the ban stays visible and auditable each run.
  if (isBannedTicker(s.ticker)) {
    return { eligible: false, reasons: [`banned: ${s.ticker} (employer holding restriction)`] };
  }
  const reasons: string[] = [];
  if (!BUY_SIDE.has(s.label)) reasons.push(`label ${s.label} not buy-side`);
  if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) reasons.push(`gate ceiling ${s.gatedLabel}`);
  if (s.mu < config.muMin) reasons.push(`mu ${(s.mu * 100).toFixed(1)}% < ${(config.muMin * 100).toFixed(0)}%`);
  if (s.R == null || s.R < config.rMin) reasons.push(`R ${s.R == null ? "—" : s.R.toFixed(2)} < ${config.rMin}`);
  if (s.kappa * 100 < config.convictionMin) reasons.push(`conviction ${(s.kappa * 100).toFixed(0)} < ${config.convictionMin}`);
  if (s.ageDays > config.stalenessMaxDays) reasons.push(`stale ${s.ageDays}d > ${config.stalenessMaxDays}d`);
  return { eligible: reasons.length === 0, reasons };
}
