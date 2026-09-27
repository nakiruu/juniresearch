/**
 * throttle.ts — bounded concurrency under SEC's fair-access limit.
 * -----------------------------------------------------------------------------
 * `createRateLimiter` spaces task STARTS at least `minIntervalMs` apart (EDGAR_MIN_INTERVAL_MS
 * keeps SEC traffic ≤ 10 req/s), however many tasks are in flight; `mapConcurrent` caps how many
 * are in flight. Together they overlap response latency without raising the request rate.
 */
import { sleep } from "./client";

export type RateLimiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createRateLimiter(minIntervalMs: number, now: () => number = Date.now, wait: (ms: number) => Promise<unknown> = sleep): RateLimiter {
  let nextStart = -Infinity;
  return async (task) => {
    const t = now();
    const at = Math.max(t, nextStart);
    nextStart = at + minIntervalMs; // reserve the slot synchronously, so concurrent callers queue up
    if (at > t) await wait(at - t);
    return task();
  };
}

/**
 * `fn` over `items` with at most `concurrency` calls in flight; results in input order. After the
 * first rejection no new item is started and the returned promise rejects with that error.
 */
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}
