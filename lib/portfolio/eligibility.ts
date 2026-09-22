import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";

const BUY_SIDE = new Set(["BUY", "STRONG BUY"]);

export function assessEligibility(s: Signal, config: PortfolioConfig): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!BUY_SIDE.has(s.label)) reasons.push(`label ${s.label} not buy-side`);
  if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) reasons.push(`gate ceiling ${s.gatedLabel}`);
  if (s.mu < config.muMin) reasons.push(`mu ${(s.mu * 100).toFixed(1)}% < ${(config.muMin * 100).toFixed(0)}%`);
  if (s.R == null || s.R < config.rMin) reasons.push(`R ${s.R == null ? "—" : s.R.toFixed(2)} < ${config.rMin}`);
  if (s.kappa * 100 < config.convictionMin) reasons.push(`conviction ${(s.kappa * 100).toFixed(0)} < ${config.convictionMin}`);
  if (s.ageDays > config.stalenessMaxDays) reasons.push(`stale ${s.ageDays}d > ${config.stalenessMaxDays}d`);
  return { eligible: reasons.length === 0, reasons };
}
