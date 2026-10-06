/**
 * relabel.ts — the advisory re-label flag. ADVISORY ONLY: nothing here feeds classify, eligibility, sizing or
 * locks; a report's stored label still decides every trade.
 *
 * A report's label is derived once, at publish, from its scenarios and that day's price. When the price moves far
 * enough, the same rule applied to today's mark would give a different label (a HOLD that would now derive BUY,
 * a BUY that would now derive HOLD). This module finds those names, rule against rule: the label the publish-time
 * rule produced (the gated label, else the derived one) against the same rule, with the same gate ceiling, at
 * today's decision mark. The author's own label is carried for display only — a report the author took one notch
 * conservative is not flagged for that alone.
 *
 * A candidate is CONFIRMED once the same report has shown the same live label on `RELABEL_CONFIRM_DAYS` consecutive
 * run days (a day with no run does not break a streak; a run day without the candidate does). The streaks live in
 * their own small state file, so preview-only runs, which write no run record, still count.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Report } from "../report.schema";
import { computeConviction, deriveLabel } from "../synth/conviction";
import { applyGateCeiling } from "../synth/gates";
import type { DeskRating } from "../synth/desk.schema";

/** Consecutive run days a candidate must hold before it is posted. */
export const RELABEL_CONFIRM_DAYS = 3;

export interface RelabelEntry {
  ticker: string;
  accession: string;
  /** The label the rule gave at publish: rating.gate.gatedLabel, else rating.conviction.derivedLabel. */
  publishedLabel: string;
  /** The same rule (and gate ceiling) at today's decision mark. */
  liveLabel: string;
  /** The author's label (rating.label) — display only. */
  reportLabel: string;
  price: number;
  expectedUpside: number;
  rewardRisk: number | null;
}

/**
 * Every report whose rule-derived label at today's mark differs from the one it was published with. Reports
 * without a publish-time derived label (built before conviction existed), without scenarios, or without a positive
 * mark are skipped. Pure.
 */
export function relabelCandidates(reports: Report[], marks: Record<string, number>, rating: DeskRating): RelabelEntry[] {
  const out: RelabelEntry[] = [];
  for (const r of reports) {
    const ticker = r.meta.ticker;
    const price = marks[ticker];
    const scenarios = r.sections.valuation.scenarios;
    const publishedLabel = r.rating.gate?.gatedLabel ?? r.rating.conviction?.derivedLabel;
    if (!publishedLabel || !scenarios.length || !(typeof price === "number" && Number.isFinite(price) && price > 0)) continue;
    const c = computeConviction(scenarios, price);
    const derived = deriveLabel(c, rating);
    const ceiling = r.rating.gate?.ceiling;
    const liveLabel = ceiling ? applyGateCeiling(derived, ceiling) : derived;
    if (liveLabel === publishedLabel) continue;
    out.push({
      ticker, accession: r.meta.filing.accession, publishedLabel, liveLabel, reportLabel: r.rating.label,
      price, expectedUpside: c.expectedUpside, rewardRisk: c.rewardRisk,
    });
  }
  return out;
}

const Streak = z.object({ key: z.string(), days: z.array(z.string()) });
export const RelabelState = z.record(z.string(), Streak);
export type RelabelState = z.infer<typeof RelabelState>;

/** What a streak is a streak OF: the same report, published label and live label. */
const keyOf = (e: RelabelEntry) => `${e.accession}|${e.publishedLabel}|${e.liveLabel}`;

/**
 * The streaks after a run on `today` that saw `entries`. A ticker's streak extends when its key matches and
 * restarts when it does not; a ticker absent from `entries` drops out. A second run on the same day replaces that
 * day's reading rather than adding a day. Pure.
 */
export function advanceRelabels(prev: RelabelState, today: string, entries: RelabelEntry[]): RelabelState {
  const next: RelabelState = {};
  for (const e of entries) {
    const key = keyOf(e);
    const old = prev[e.ticker];
    const days = old && old.key === key ? old.days.filter((d) => d < today) : [];
    next[e.ticker] = { key, days: [...days, today] };
  }
  return next;
}

export interface ConfirmedRelabel extends RelabelEntry { days: number }

/** Today's entries whose streak has reached `n` run days. Pure. */
export function confirmedRelabels(state: RelabelState, entries: RelabelEntry[], n = RELABEL_CONFIRM_DAYS): ConfirmedRelabel[] {
  return entries.flatMap((e) => {
    const s = state[e.ticker];
    return s && s.key === keyOf(e) && s.days.length >= n ? [{ ...e, days: s.days.length }] : [];
  });
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** "VST HOLD → BUY at $145.00 · E +12.3% · R 0.52× · 3 days" (plus the author's label when it differs). */
export function relabelLine(e: ConfirmedRelabel): string {
  const author = e.reportLabel !== e.publishedLabel ? ` (report says ${e.reportLabel})` : "";
  const r = e.rewardRisk == null ? "R n/a" : `R ${e.rewardRisk.toFixed(2)}×`;
  return `${e.ticker} ${e.publishedLabel} → ${e.liveLabel} at $${e.price.toFixed(2)} · E ${pct(e.expectedUpside)} · ${r} · ${e.days} days${author}`;
}

/** The saved streaks; a missing or unreadable file reads as none (advisory state must never stop a run). */
export function readRelabelState(path: string): RelabelState {
  try {
    return existsSync(path) ? RelabelState.parse(JSON.parse(readFileSync(path, "utf8"))) : {};
  } catch {
    return {};
  }
}

export function writeRelabelState(path: string, state: RelabelState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(RelabelState.parse(state), null, 2) + "\n");
}
