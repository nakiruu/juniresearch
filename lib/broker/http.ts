/**
 * http.ts — bounded broker HTTP (spec #10). Every broker/auth request gets a deadline covering the
 * headers AND the body read, so a hung connection can't stall a run for undici's ~5-minute defaults.
 *
 * The one rule that matters: an ORDER SUBMIT is never retried. A submit that times out (or dies on the
 * network, or gets a 5xx) may or may not have placed the order, so it surfaces as
 * SubmitOutcomeUnknownError and the caller resolves it by LOOKING the order up (findSubmitted), never
 * by resending it. Only idempotent reads go through withReadRetry.
 */
export type HttpPhase = "read" | "submit" | "token";

export class BrokerTimeoutError extends Error {
  constructor(readonly phase: HttpPhase, readonly url: string, readonly ms: number) {
    super(`broker ${phase} timed out after ${ms}ms: ${url}`);
    this.name = "BrokerTimeoutError";
  }
}

/** A submit whose outcome is unknown — the order may exist at the broker. Look it up; never resubmit. */
export class SubmitOutcomeUnknownError extends Error {
  constructor(readonly clientOrderId: string, readonly symbol: string, readonly submitStartAt: string, cause: string) {
    super(`order submit for ${symbol} (${clientOrderId}) has an unknown outcome — ${cause}`);
    this.name = "SubmitOutcomeUnknownError";
  }
}

/** More than one broker order matches a timed-out submit, so it can't be attributed safely. */
export class AmbiguousOrderError extends Error {
  constructor(msg: string) { super(msg); this.name = "AmbiguousOrderError"; }
}

export const DEFAULT_TIMEOUTS = { readMs: 10_000, submitMs: 15_000, tokenMs: 10_000 } as const;

export interface BoundedResponse { status: number; ok: boolean; headers: Headers; text: string }

/** fetch + body read under one deadline. Throws BrokerTimeoutError on the deadline; other failures propagate. */
export async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, ms: number, phase: HttpPhase): Promise<BoundedResponse> {
  const timeout = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const res = await fetchImpl(url, { ...init, signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, headers: res.headers, text };
  } catch (e) {
    if (timeout.aborted) throw new BrokerTimeoutError(phase, url, ms);
    throw e;
  }
}

/** Transient read failures worth one more try: our deadline, or a network-level fetch failure. HTTP errors are not. */
export function isTransientRead(e: unknown): boolean {
  return (e instanceof BrokerTimeoutError && e.phase === "read") || e instanceof TypeError;
}

/** Retry an idempotent read on transient failure only. Never wrap a submit in this. */
export async function withReadRetry<T>(fn: () => Promise<T>, delaysMs: readonly number[] = [1_000, 3_000], sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delaysMs.length || !isTransientRead(e)) throw e;
      await sleep(delaysMs[attempt]);
    }
  }
}

/**
 * Map `items` through `fn` with at most `limit` calls in flight, preserving input order in the result.
 * For independent idempotent READS only (never submits). Every item is attempted; if any fail, the
 * error of the earliest failing item (by input position) is thrown — the same error a sequential loop
 * would have surfaced first — after all in-flight calls settle, so nothing is left running unobserved.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors = new Map<number, unknown>();
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { errors.set(i, e); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (errors.size) throw errors.get(Math.min(...errors.keys()));
  return results;
}

/**
 * Promise.all for independent READS, with sequential-loop error semantics: waits for every promise to
 * settle, then throws the rejection of the EARLIEST one by position (not whichever failed first in
 * time), so the surfaced error is the one the equivalent sequential code would have thrown.
 */
export async function allInOrder<T extends readonly unknown[]>(promises: readonly [...{ [K in keyof T]: Promise<T[K]> }]): Promise<T> {
  const settled = await Promise.allSettled(promises);
  for (const r of settled) if (r.status === "rejected") throw r.reason;
  return settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as unknown as T;
}
