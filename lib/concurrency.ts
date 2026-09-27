/**
 * concurrency.ts — the one place bounded concurrency and request pacing live.
 * -----------------------------------------------------------------------------
 * Used by the broker reads (lib/broker, lib/trade/pipeline), the SEC/Yahoo capture scripts and
 * portfolio-build. All of it is for independent READS: nothing here is ever wrapped around an order
 * submit.
 */

export interface MapOptions {
  /**
   * "settle" (default): every item is attempted; if any fail, the error of the EARLIEST failing item
   * by input position is thrown — the error a sequential loop would have surfaced first — after all
   * in-flight calls settle, so nothing is left running unobserved.
   * "fail-fast": no new item starts after the first rejection, and that rejection is thrown once the
   * items already in flight finish (for bulk fetches where one failure dooms the run anyway).
   */
  onError?: "settle" | "fail-fast";
}

/** Map `items` through `fn` with at most `limit` calls in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  { onError = "settle" }: MapOptions = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors = new Map<number, unknown>();
  let next = 0;
  const worker = async () => {
    while (next < items.length && !(onError === "fail-fast" && errors.size)) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { errors.set(i, e); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (errors.size) throw errors.get(Math.min(...errors.keys()));
  return results;
}

/**
 * Promise.all with sequential-loop error semantics: waits for every promise to settle, then throws
 * the rejection of the EARLIEST one by position (not whichever failed first in time).
 */
export async function allInOrder<T extends readonly unknown[]>(promises: readonly [...{ [K in keyof T]: Promise<T[K]> }]): Promise<T> {
  const settled = await Promise.allSettled(promises);
  for (const r of settled) if (r.status === "rejected") throw r.reason;
  return settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as unknown as T;
}

export type RateLimiter = <T>(task: () => Promise<T>) => Promise<T>;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Spaces task STARTS at least `minIntervalMs` apart however many tasks are in flight (e.g.
 * EDGAR_MIN_INTERVAL_MS keeps SEC traffic under its fair-access rate). Pair with
 * mapWithConcurrency to overlap response latency without raising the request rate.
 */
export function createRateLimiter(minIntervalMs: number, now: () => number = Date.now, wait: (ms: number) => Promise<unknown> = delay): RateLimiter {
  let nextStart = -Infinity;
  return async (task) => {
    const t = now();
    const at = Math.max(t, nextStart);
    nextStart = at + minIntervalMs; // reserve the slot synchronously, so concurrent callers queue up
    if (at > t) await wait(at - t);
    return task();
  };
}
