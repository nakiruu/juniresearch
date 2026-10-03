/**
 * rebalance.ts — the pure trade emitter (spec §7). ledger + signals + locks → TradePlan.
 * Reuses the portfolio sizer's scoring and water-fill unchanged; hysteresis decides the set,
 * the locks (and a mixed bear breach, FREEZE) decide what is frozen or barred, the band decides
 * what is worth trading. Never leverages: if locked or frozen names hold weight the sizer wanted
 * to move, buys are scaled down, not cash borrowed.
 */
import type { Signal } from "../portfolio/signal";
import { scoreWeight, allocateCapped } from "../portfolio/sizing";
import { isBannedTicker } from "../portfolio/eligibility";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { isBuyLocked, isSellLocked, type Locks } from "./locks";
import { classify, type Classified } from "./hysteresis";
import type { BreachInfo } from "./breach";
import type { StaleEntryInfo } from "./stale-entry";

export type TradeReason = "ENTER" | "EXIT" | "ADD" | "TRIM";
export interface Trade {
  ticker: string; sector: string; side: "buy" | "sell"; reason: TradeReason;
  currentWeight: number; targetWeight: number; deltaWeight: number;
  /** "residual": an ADD that went through the smaller residualBand (topUpRecentBuys). */
  note?: "residual";
}
export type SkipCode = "BELOW_BAND" | "BARRED_ENTRY" | "STALE_ENTRY" | "BARRED_ADD" | "DEFER_EXIT" | "DEFER_TRIM" | "FREEZE" | "INELIGIBLE" | "NO_SIGNAL" | "NO_CAPACITY" | "TURNOVER_CLIP";
export interface Skipped {
  ticker: string; code: SkipCode; reasons: string[]; unlockOn?: TradingDay;
  currentWeight: number; targetWeight: number | null;
}
export interface TradePlan {
  today: TradingDay; trades: Trade[]; skipped: Skipped[]; classifications: Classified[];
  frozenWeight: number; sizingTarget: number; plannedInvested: number; plannedCash: number; buyScale: number;
}

const EPS = 1e-12;

export function emitTrades(input: {
  signals: Signal[]; currentWeights: Record<string, number>; locks: Locks; today: TradingDay; cfg: TradeConfig;
  /** The cause of each held bear breach (breach.ts), by ticker; a name with none takes the plain bear-breach exit. */
  breaches?: Record<string, BreachInfo>;
  /** Not-held names the stale-on-bad-news gate bars (stale-entry.ts), by ticker; a name with none enters as usual. */
  staleEntries?: Record<string, StaleEntryInfo>;
}): TradePlan {
  const { signals, currentWeights, locks, today, cfg, breaches = {}, staleEntries = {} } = input;
  const cur = (t: string) => currentWeights[t] ?? 0;
  const bySignal = new Map(signals.map((s) => [s.ticker, s]));
  const classifications = signals.map((s) => classify(s, cur(s.ticker) > 0, locks, today, cfg, breaches[s.ticker] ?? null, staleEntries[s.ticker] ?? null));
  const trades: Trade[] = [];
  const skipped: Skipped[] = [];

  // 1–2. Freeze set: deferred exits, frozen bear breaches, and held names with no signal at all.
  let frozenWeight = 0;
  for (const [t, w] of Object.entries(currentWeights)) {
    if (w > 0 && !bySignal.has(t)) {
      frozenWeight += w;
      skipped.push({ ticker: t, code: "NO_SIGNAL", reasons: ["held but no current signal — frozen, not traded"], currentWeight: w, targetWeight: null });
    }
  }
  for (const c of classifications) if (c.classification === "DEFER_EXIT" || c.classification === "FREEZE") frozenWeight += cur(c.ticker);

  // 3. Size HOLD ∪ ENTER into the reduced target with the existing sizer (dust loop as sizePortfolio).
  const sizingTarget = Math.max(0, 1 - cfg.cashFloor - frozenWeight);
  const sizable = signals.filter((s) => {
    const k = classifications.find((c) => c.ticker === s.ticker)!.classification;
    return k === "HOLD" || k === "ENTER";
  });
  let scored = sizable
    .map((s) => ({ ticker: s.ticker, sector: s.sector, score: scoreWeight(s, cfg, { qualityTilt: cfg.useQualityTilt }) }))
    .filter((i) => i.score > 0);
  let alloc = scored.length ? allocateCapped(scored, sizingTarget, cfg) : [];
  for (let pass = 0; pass < sizable.length + 1 && scored.length; pass++) {
    const survivors = alloc.filter((w) => w.weight >= cfg.wMin);
    if (survivors.length === scored.length) break;
    scored = scored.filter((i) => survivors.some((w) => w.ticker === i.ticker));
    alloc = scored.length ? allocateCapped(scored, sizingTarget, cfg) : [];
  }
  const target = new Map(alloc.map((w) => [w.ticker, w.weight]));

  // 4–5, 7. Decide each name.
  for (const c of classifications) {
    const s = bySignal.get(c.ticker)!;
    const w = cur(c.ticker);
    const k = c.classification;
    if (k === "EXIT") {
      trades.push({ ticker: c.ticker, sector: s.sector, side: "sell", reason: "EXIT", currentWeight: w, targetWeight: 0, deltaWeight: -w });
      continue;
    }
    if (k === "DEFER_EXIT" || k === "FREEZE" || k === "BARRED_ENTRY" || k === "STALE_ENTRY" || k === "INELIGIBLE") {
      // DEFER_EXIT and FREEZE keep the current weight (counted in frozenWeight above), untraded.
      const kept = k === "DEFER_EXIT" || k === "FREEZE";
      skipped.push({ ticker: c.ticker, code: k, reasons: c.reasons, unlockOn: c.unlockOn, currentWeight: w, targetWeight: kept ? w : null });
      continue;
    }
    const tw = target.get(c.ticker) ?? 0;
    if (k === "ENTER") {
      if (tw <= EPS) { skipped.push({ ticker: c.ticker, code: "NO_CAPACITY", reasons: ["the caps left no room"], currentWeight: 0, targetWeight: 0 }); continue; }
      trades.push({ ticker: c.ticker, sector: s.sector, side: "buy", reason: "ENTER", currentWeight: 0, targetWeight: tw, deltaWeight: tw });
      continue;
    }
    // HOLD: trade only outside the band, and only if the required side is not locked.
    const d = tw - w;
    // Residual top-up (opt-in): a name bought inside the lock window (so it is sell-locked) may keep
    // BUYING toward target through a smaller band — the unfilled rest of a partial IOC entry would
    // otherwise sit in cash until drift crosses the full band. It can't churn: the name can't be sold
    // until the lock clears. Buys only; the sell side and every unlocked name keep tradeBand.
    const residual = cfg.topUpRecentBuys && d > cfg.residualBand && d <= cfg.tradeBand
      && isSellLocked(locks, c.ticker, today) && !isBuyLocked(locks, c.ticker, today);
    if (residual) {
      trades.push({ ticker: c.ticker, sector: s.sector, side: "buy", reason: "ADD", currentWeight: w, targetWeight: tw, deltaWeight: d, note: "residual" });
    } else if (Math.abs(d) <= cfg.tradeBand) {
      skipped.push({ ticker: c.ticker, code: "BELOW_BAND", reasons: [`|Δw| ${(Math.abs(d) * 100).toFixed(2)}pp ≤ band ${(cfg.tradeBand * 100).toFixed(2)}pp`], currentWeight: w, targetWeight: tw });
    } else if (d > 0) {
      if (isBuyLocked(locks, c.ticker, today)) skipped.push({ ticker: c.ticker, code: "BARRED_ADD", reasons: ["buy-locked"], unlockOn: locks.buyLockUntil[c.ticker], currentWeight: w, targetWeight: tw });
      else trades.push({ ticker: c.ticker, sector: s.sector, side: "buy", reason: "ADD", currentWeight: w, targetWeight: tw, deltaWeight: d });
    } else {
      if (isSellLocked(locks, c.ticker, today)) skipped.push({ ticker: c.ticker, code: "DEFER_TRIM", reasons: ["sell-locked"], unlockOn: locks.sellLockUntil[c.ticker], currentWeight: w, targetWeight: tw });
      else trades.push({ ticker: c.ticker, sector: s.sector, side: "sell", reason: "TRIM", currentWeight: w, targetWeight: tw, deltaWeight: d });
    }
  }

  // 6. Never leverage. Names kept at their current weight (frozen, deferred, below-band) can leave
  //    the book over the invested ceiling once the wanted buys land; scale the buys, never borrow.
  const held = Object.values(currentWeights).reduce((a, w) => a + w, 0);
  const sumDelta = () => trades.reduce((a, t) => a + t.deltaWeight, 0);
  const ceiling = 1 - cfg.cashFloor;
  let buyScale = 1;
  const over = held + sumDelta() - ceiling;
  if (over > EPS) {
    const buys = trades.filter((t) => t.side === "buy");
    const buyTotal = buys.reduce((a, t) => a + t.deltaWeight, 0);
    buyScale = buyTotal > 0 ? Math.max(0, (buyTotal - over) / buyTotal) : 1;
    for (const t of buys) { t.deltaWeight *= buyScale; t.targetWeight = t.currentWeight + t.deltaWeight; }
  }
  // A buy scaled to nothing is not a trade; record it as no-capacity.
  for (const t of trades.filter((t) => t.side === "buy" && t.deltaWeight <= EPS)) {
    skipped.push({ ticker: t.ticker, code: "NO_CAPACITY", reasons: ["buys scaled to zero to respect the cash floor"], currentWeight: t.currentWeight, targetWeight: t.currentWeight });
  }
  const finalTrades = trades.filter((t) => Math.abs(t.deltaWeight) > EPS);

  const plannedInvested = held + finalTrades.reduce((a, t) => a + t.deltaWeight, 0);
  const plannedCash = 1 - plannedInvested;
  if (plannedCash < -1e-9) throw new Error(`emitTrades: planned cash ${plannedCash} is negative — leverage bug`);
  for (const t of finalTrades) if (t.side === "buy" && isBannedTicker(t.ticker)) throw new Error(`emitTrades: buy of banned ticker ${t.ticker}`);

  return { today, trades: finalTrades, skipped, classifications, frozenWeight, sizingTarget, plannedInvested, plannedCash, buyScale };
}
