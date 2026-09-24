/**
 * fills.ts — the append-only fills log, the one record the compliance locks derive from (spec §3, §6.2).
 * Parsing is pure; readFills/appendFill are the only fs touches, and appendFill only ever appends.
 */
import { z } from "zod";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const Fill = z.object({
  ticker: z.string().regex(/^[A-Z0-9.-]+$/),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive(),
  price: z.number().positive(),
  filledAt: z.string().min(1),                       // ISO-8601 from the broker
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // the fill's trading date — the lock clock starts here
  orderId: z.string().min(1),
  runId: z.string().min(1),
});
export type Fill = z.infer<typeof Fill>;

export function parseFillsJsonl(text: string): Fill[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).map((l) => Fill.parse(JSON.parse(l)));
}

export function readFills(path: string): Fill[] {
  if (!existsSync(path)) return [];
  return parseFillsJsonl(readFileSync(path, "utf8"));
}

export function appendFill(path: string, fill: Fill): void {
  appendFileSync(path, JSON.stringify(Fill.parse(fill)) + "\n");
}
