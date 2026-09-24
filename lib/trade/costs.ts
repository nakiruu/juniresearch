/** costs.ts — round-trip cost by liquidity bucket, for reporting and the dust floor (spec §7.8). */
export type LiquidityBucket = "large" | "mid" | "small";
export const ROUND_TRIP_BPS: Record<LiquidityBucket, number> = { large: 8, mid: 15, small: 30 };

export function bucketFor(marketCapUsd: number | null): LiquidityBucket {
  if (marketCapUsd == null || !Number.isFinite(marketCapUsd)) return "mid";
  if (marketCapUsd >= 10e9) return "large";
  if (marketCapUsd >= 2e9) return "mid";
  return "small";
}

export function estimateCostUsd(notionalUsd: number, bucket: LiquidityBucket): number {
  return (Math.abs(notionalUsd) * ROUND_TRIP_BPS[bucket]) / 10_000;
}
