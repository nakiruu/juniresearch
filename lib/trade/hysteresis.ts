/**
 * hysteresis.ts — two-sided eligibility (spec §5). Entry and exit have different bars, keyed on
 * whether the name is currently held, so a held name is never sold for merely dipping below the
 * entry bar. Pure: locks, `today` and the bear-breach cause (breach.ts) are inputs.
 */
import type { Signal } from "../portfolio/signal";
import { isBannedTicker } from "../portfolio/eligibility";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import type { BreachInfo } from "./breach";
import { staleEntryReason, type StaleEntryInfo } from "./stale-entry";
import { isBuyLocked, isSellLocked, type Locks } from "./locks";

const BUY_SIDE = new Set(["BUY", "STRONG BUY"]);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rStr = (r: number | null) => (r == null ? "—" : r.toFixed(2));

/**
 * FREEZE: a held name kept exactly as is — no add, no trim — until its report is re-written (a mixed bear breach).
 * STALE_ENTRY: a name that would enter, not bought because it fell on its own after an earnings miss (stale-entry.ts).
 */
export type Classification = "ENTER" | "HOLD" | "FREEZE" | "EXIT" | "DEFER_EXIT" | "BARRED_ENTRY" | "STALE_ENTRY" | "INELIGIBLE";
export interface Classified { ticker: string; classification: Classification; reasons: string[]; unlockOn?: TradingDay }

/**
 * `breach`: the cause of a held name's fall through its bear case (breach.ts); null/absent → the plain bear-breach exit.
 * `staleEntry`: a not-held name the stale-on-bad-news gate bars (stale-entry.ts); null/absent → enter as usual.
 */
export function classify(s: Signal, held: boolean, locks: Locks, today: TradingDay, cfg: TradeConfig, breach?: BreachInfo | null, staleEntry?: StaleEntryInfo | null): Classified {
  const t = s.ticker;
  if (held) {
    let exits: string[] = [];
    if (isBannedTicker(t)) exits.push(`banned: ${t} (employer holding restriction)`);
    if (!BUY_SIDE.has(s.label)) exits.push(`label ${s.label} not buy-side`);
    if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) exits.push(`gate ceiling ${s.gatedLabel}`);
    if (s.mu < cfg.muExit) exits.push(`mu ${pct(s.mu)} < exit ${pct(cfg.muExit)} (thesis played out)`);
    // R is null once the price is at or below the bear-case implied price (D = 0): the market has passed the
    // report's worst scenario, and the name exits (unless its cause says otherwise, below). Say so — "R —"
    // alone hides that this is a stop at the bear.
    if (s.R == null || s.R < cfg.rExit) exits.push(`R ${rStr(s.R)} < exit ${cfg.rExit}${s.R == null && s.D <= 0 ? " (price at or below the bear case)" : ""}`);
    if (s.ageDays > cfg.stalenessMaxDays) exits.push(`stale ${s.ageDays}d > ${cfg.stalenessMaxDays}d`);
    if (exits.length === 0) return { ticker: t, classification: "HOLD", reasons: [] };
    // By cause (breachPolicy "byCause"): a breach the market explains is held, a mixed one frozen, a stock-specific
    // one exited. Only when the bear breach is the SOLE exit reason — a downgrade, a stale report or a ban still
    // exits — and only with a cause in hand: any missing input (no SPY close, no beta) leaves the plain exit.
    if (exits.length === 1 && s.R == null && s.D <= 0 && cfg.breachPolicy === "byCause" && breach) {
      const share = `stock-specific share ${(breach.share * 100).toFixed(0)}%`;
      if (breach.cause === "market") return { ticker: t, classification: "HOLD", reasons: [`bear breach, market-driven (${share}) — holding`] };
      if (breach.cause === "mixed") return { ticker: t, classification: "FREEZE", reasons: [`bear breach, mixed (${share}) — frozen until the report is re-written`] };
      exits = [`bear breach, stock-specific (${share}) — exit`]; // still waits out a sell lock below, like every exit
    }
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
  if (staleEntry && cfg.staleEntryGate) return { ticker: t, classification: "STALE_ENTRY", reasons: [staleEntryReason(staleEntry)] };
  return { ticker: t, classification: "ENTER", reasons: [] };
}
