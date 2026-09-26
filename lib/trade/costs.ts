/** costs.ts — round-trip cost by liquidity bucket, for reporting and the dust floor (spec §7.8). */
export { bucketFor, type LiquidityBucket } from "./config";
import type { LiquidityBucket } from "./config";

export const ROUND_TRIP_BPS: Record<LiquidityBucket, number> = { large: 8, mid: 15, small: 30 };

export function estimateCostUsd(notionalUsd: number, bucket: LiquidityBucket): number {
  return (Math.abs(notionalUsd) * ROUND_TRIP_BPS[bucket]) / 10_000;
}
