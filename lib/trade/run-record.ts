/** run-record.ts — the point-in-time record of one run (spec §14); the backtest's replay input. */
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic-write";
import type { TradingDay } from "./calendar";

const loose = z.record(z.string(), z.unknown());
export const RunRecord = z.object({
  runId: z.string().min(1), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // markMode is the mode the run actually marked in (a "live" config outside today's session marks settled).
  markMode: z.enum(["settled", "live"]), broker: z.string().min(1),
  /** The DECISION marks (buildSignal, qty conversion): live prices in a live run, else the settled prior close. */
  marks: z.record(z.string(), z.number()),
  // Optional: older records lack them. refCloses = the settled prior closes (execution's gap-halt /
  // tier-3 reference); markSources = where each decision mark came from ("close" = settled fallback).
  refCloses: z.record(z.string(), z.number()).optional(),
  markSources: z.record(z.string(), z.enum(["trade", "quote", "close"])).optional(),
  signals: z.array(z.object({
    ticker: z.string(), label: z.string(), gatedLabel: z.string().nullable(), mu: z.number(), R: z.number().nullable(), kappa: z.number(), quality: z.number(), ageDays: z.number(),
    // Scenario-risk fields (optional: older records lack them) so a future backtest can replay σ-based
    // sizers (kellyTilt invSigma, a σ blend) point-in-time instead of only the score sizer (plan #6).
    price: z.number().optional(), sigma: z.number().optional(), sigmaDown: z.number().optional(), D: z.number().optional(), staleness: z.number().optional(),
    scenarios: z.array(z.object({ name: z.string(), impliedPrice: z.number(), probability: z.number() })).optional(),
  })),
  classifications: z.array(z.object({ ticker: z.string(), classification: z.string(), reasons: z.array(z.string()), unlockOn: z.string().optional() })),
  locks: z.object({ buyLockUntil: z.record(z.string(), z.string()), sellLockUntil: z.record(z.string(), z.string()) }),
  // The cause of each held bear breach the run could price (lib/trade/breach.ts), by ticker. Optional: older
  // records, and runs before breachPolicy "byCause", lack it.
  breaches: z.record(z.string(), z.object({
    cause: z.enum(["market", "mixed", "stock"]), share: z.number(), total: z.number(), residual: z.number(), beta: z.number(), spyReturn: z.number(),
  })).optional(),
  // Not-held names the stale-on-bad-news entry gate barred (lib/trade/stale-entry.ts). Optional: older records lack it.
  staleEntries: z.record(z.string(), z.object({
    fall: z.number(), share: z.number(), beta: z.number(), spyReturn: z.number(), surprisePct: z.number(), earningsDate: z.string(),
  })).optional(),
  // Names whose rule-derived label at this run's mark differs from the one they were published with (relabel.ts) —
  // advisory only, unconfirmed. Optional: older records, and runs without the desk rating config, lack it.
  relabel: z.array(z.object({
    ticker: z.string(), accession: z.string(), publishedLabel: z.string(), liveLabel: z.string(), reportLabel: z.string(),
    price: z.number(), expectedUpside: z.number(), rewardRisk: z.number().nullable(),
  })).optional(),
  plan: loose, orders: z.array(loose), fills: z.array(loose), notes: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecord>;

export function newRunId(today: TradingDay): string {
  return `${today}-${randomBytes(4).toString("hex")}`;
}

export function writeRunRecord(dir: string, rec: RunRecord): string {
  const path = join(dir, `${rec.runId}.json`);
  writeFileAtomic(path, JSON.stringify(RunRecord.parse(rec), null, 2) + "\n");
  return path;
}
