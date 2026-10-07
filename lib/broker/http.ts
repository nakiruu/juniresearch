/**
 * http.ts — bounded broker HTTP (spec #10). Every broker/auth request gets a deadline covering the
 * headers AND the body read, so a hung connection can't stall a run for undici's ~5-minute defaults.
 *
 * The one rule that matters: an ORDER SUBMIT is never retried. A submit that times out (or dies on the
 * network, or gets a 5xx) may or may not have placed the order, so it surfaces as
 * SubmitOutcomeUnknownError and the caller resolves it by LOOKING the order up (findSubmitted), never
 * by resending it. Only idempotent reads (and the idempotent DELETE cancel) go through withReadRetry; a 429/5xx on
 * them is retried with bounded, Retry-After-aware backoff.
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

/**
 * The broker DEFINITIVELY refused an order (a 4xx), or the adapter refused to send it (e.g. a sub-share
 * LIMIT on Schwab). Nothing was placed, so the run records it as rejected and carries on with the next order.
 */
export class OrderRejectedError extends Error {
  constructor(readonly symbol: string, readonly detail: string) {
    super(`order for ${symbol} rejected — ${detail}`);
    this.name = "OrderRejectedError";
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

/**
 * A non-2xx answer to an idempotent broker request (a GET, or the DELETE cancel). 429 and 5xx are
 * transient (rate limit, broker hiccup); every other status is definitive. Never thrown for a submit.
 */
export class BrokerHttpError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = "BrokerHttpError";
  }
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Retry-After as delta-seconds or an HTTP-date → ms to wait (never negative); null when absent or unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null;
}

/** Transient read failures worth another try: our deadline, a network-level fetch failure, or an HTTP 429/5xx. */
export function isTransientRead(e: unknown): boolean {
  return (e instanceof BrokerTimeoutError && e.phase === "read") || e instanceof TypeError
    || (e instanceof BrokerHttpError && isTransientHttpStatus(e.status));
}

/**
 * Transient token-refresh failures: our token deadline, or a network-level fetch failure. A refresh-token
 * grant places no order and can be repeated safely; an HTTP answer (400/401 = dead token, 5xx) is not retried.
 */
export function isTransientToken(e: unknown): boolean {
  return (e instanceof BrokerTimeoutError && e.phase === "token") || e instanceof TypeError;
}

/** HTTP-status retries (429/5xx): a budget of their own, independent of the timeout/network budget. */
export interface RetryPolicy { httpDelaysMs?: readonly number[]; maxRetryAfterMs?: number }
export const DEFAULT_HTTP_RETRY = { httpDelaysMs: [2_000, 5_000, 10_000], maxRetryAfterMs: 15_000 } as const;

/**
 * Retry an idempotent read (or, with isTransientToken, a token refresh) on transient failure only. Never wrap
 * a submit in this. Timeouts/network errors use `delaysMs`; an HTTP 429/5xx (BrokerHttpError) uses
 * policy.httpDelaysMs, waiting the server's Retry-After instead when it is longer, capped at maxRetryAfterMs.
 * The budgets are independent: with the defaults a call makes at most 6 attempts (≈110 s worst case at a
 * 10 s read timeout).
 */
export async function withReadRetry<T>(
  fn: () => Promise<T>, delaysMs: readonly number[] = [1_000, 3_000],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  isTransient: (e: unknown) => boolean = isTransientRead, policy: RetryPolicy = {},
): Promise<T> {
  const httpDelays = policy.httpDelaysMs ?? DEFAULT_HTTP_RETRY.httpDelaysMs;
  const maxRetryAfter = policy.maxRetryAfterMs ?? DEFAULT_HTTP_RETRY.maxRetryAfterMs;
  let netTries = 0, httpTries = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e)) throw e;
      if (e instanceof BrokerHttpError) {
        if (httpTries >= httpDelays.length) throw e;
        const base = httpDelays[httpTries++];
        await sleep(e.retryAfterMs != null ? Math.min(Math.max(e.retryAfterMs, base), maxRetryAfter) : base);
      } else {
        if (netTries >= delaysMs.length) throw e;
        await sleep(delaysMs[netTries++]);
      }
    }
  }
}
