/** run-record.ts — the point-in-time record of one run (spec §14); the backtest's replay input. */
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TradingDay } from "./calendar";

const loose = z.record(z.string(), z.unknown());
export const RunRecord = z.object({
  runId: z.string().min(1), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  markMode: z.enum(["settled", "live"]), broker: z.string().min(1),
  marks: z.record(z.string(), z.number()),
  signals: z.array(z.object({ ticker: z.string(), label: z.string(), gatedLabel: z.string().nullable(), mu: z.number(), R: z.number().nullable(), kappa: z.number(), quality: z.number(), ageDays: z.number() })),
  classifications: z.array(z.object({ ticker: z.string(), classification: z.string(), reasons: z.array(z.string()), unlockOn: z.string().optional() })),
  locks: z.object({ buyLockUntil: z.record(z.string(), z.string()), sellLockUntil: z.record(z.string(), z.string()) }),
  plan: loose, orders: z.array(loose), fills: z.array(loose), notes: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecord>;

export function newRunId(today: TradingDay): string {
  return `${today}-${randomBytes(4).toString("hex")}`;
}

export function writeRunRecord(dir: string, rec: RunRecord): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${rec.runId}.json`);
  writeFileSync(path, JSON.stringify(RunRecord.parse(rec), null, 2) + "\n");
  return path;
}
