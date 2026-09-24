/**
 * hysteresis.ts — two-sided eligibility (spec §5). Entry and exit have different bars, keyed on
 * whether the name is currently held, so a held name is never sold for merely dipping below the
 * entry bar. Pure: locks and `today` are inputs.
 */
import type { Signal } from "../portfolio/signal";
import { isBannedTicker } from "../portfolio/eligibility";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { isBuyLocked, isSellLocked, type Locks } from "./locks";

const BUY_SIDE = new Set(["BUY", "STRONG BUY"]);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rStr = (r: number | null) => (r == null ? "—" : r.toFixed(2));

export type Classification = "ENTER" | "HOLD" | "EXIT" | "DEFER_EXIT" | "BARRED_ENTRY" | "INELIGIBLE";
export interface Classified { ticker: string; classification: Classification; reasons: string[]; unlockOn?: TradingDay }

export function classify(s: Signal, held: boolean, locks: Locks, today: TradingDay, cfg: TradeConfig): Classified {
  const t = s.ticker;
  if (held) {
    const exits: string[] = [];
    if (isBannedTicker(t)) exits.push(`banned: ${t} (employer holding restriction)`);
    if (!BUY_SIDE.has(s.label)) exits.push(`label ${s.label} not buy-side`);
    if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) exits.push(`gate ceiling ${s.gatedLabel}`);
    if (s.mu < cfg.muExit) exits.push(`mu ${pct(s.mu)} < exit ${pct(cfg.muExit)} (thesis played out)`);
    if (s.R == null || s.R < cfg.rExit) exits.push(`R ${rStr(s.R)} < exit ${cfg.rExit}`);
    if (s.ageDays > cfg.stalenessMaxDays) exits.push(`stale ${s.ageDays}d > ${cfg.stalenessMaxDays}d`);
    if (exits.length === 0) return { ticker: t, classification: "HOLD", reasons: [] };
    if (isSellLocked(locks, t, today)) return { ticker: t, classification: "DEFER_EXIT", reasons: exits, unlockOn: locks.sellLockUntil[t] };
    return { ticker: t, classification: "EXIT", reasons: exits };
  }
  if (isBannedTicker(t)) return { ticker: t, classification: "INELIGIBLE", reasons: [`banned: ${t} (employer holding restriction)`] };
  const fails: string[] = [];
  if (!BUY_SIDE.has(s.label)) fails.push(`label ${s.label} not buy-side`);
  if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) fails.push(`gate ceiling ${s.gatedLabel}`);
  if (s.mu < cfg.muEnter) fails.push(`mu ${pct(s.mu)} < enter ${pct(cfg.muEnter)}`);
  if (s.R == null || s.R < cfg.rEnter) fails.push(`R ${rStr(s.R)} < enter ${cfg.rEnter}`);
  if (s.kappa * 100 < cfg.convictionMin) fails.push(`conviction ${(s.kappa * 100).toFixed(0)} < ${cfg.convictionMin}`);
  if (s.ageDays > cfg.stalenessMaxDays) fails.push(`stale ${s.ageDays}d > ${cfg.stalenessMaxDays}d`);
  if (fails.length) return { ticker: t, classification: "INELIGIBLE", reasons: fails };
  if (isBuyLocked(locks, t, today)) return { ticker: t, classification: "BARRED_ENTRY", reasons: ["buy-locked"], unlockOn: locks.buyLockUntil[t] };
  return { ticker: t, classification: "ENTER", reasons: [] };
}
