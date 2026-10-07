import { describe, it, expect } from "vitest";
import { fetchWithTimeout, withReadRetry, isTransientToken, isTransientRead, BrokerTimeoutError, BrokerHttpError, parseRetryAfter } from "./http";

/** Honors the abort signal like real fetch does. */
const hangUntilAborted = ((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
  init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
})) as unknown as typeof fetch;

describe("fetchWithTimeout", () => {
  it("returns status, headers and the body text", async () => {
    const f = (async () => new Response("hi", { status: 201, headers: { location: "/x/1" } })) as unknown as typeof fetch;
    const r = await fetchWithTimeout(f, "https://b/x", {}, 1_000, "read");
    expect(r).toMatchObject({ status: 201, ok: true, text: "hi" });
    expect(r.headers.get("location")).toBe("/x/1");
  });
  it("throws BrokerTimeoutError when the request hangs", async () => {
    await expect(fetchWithTimeout(hangUntilAborted, "https://b/slow", {}, 20, "submit")).rejects.toMatchObject({ name: "BrokerTimeoutError", phase: "submit", url: "https://b/slow" });
  });
  it("also bounds a body that stalls after the headers", async () => {
    const stallBody = ((_u: string, init: RequestInit) => Promise.resolve({
      status: 200, ok: true, headers: new Headers(),
      text: () => new Promise<string>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    } as unknown as Response)) as unknown as typeof fetch;
    await expect(fetchWithTimeout(stallBody, "https://b/body", {}, 20, "read")).rejects.toBeInstanceOf(BrokerTimeoutError);
  });
  it("propagates non-timeout failures unchanged", async () => {
    const boom = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(fetchWithTimeout(boom, "https://b", {}, 1_000, "read")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("withReadRetry", () => {
  const noSleep = async () => {};
  it("retries a timed-out read, then succeeds", async () => {
    let n = 0;
    const v = await withReadRetry(async () => { if (n++ < 2) throw new BrokerTimeoutError("read", "u", 1); return "ok"; }, [1, 1], noSleep);
    expect(v).toBe("ok");
    expect(n).toBe(3);
  });
  it("gives up after the configured retries", async () => {
    let n = 0;
    await expect(withReadRetry(async () => { n++; throw new TypeError("fetch failed"); }, [1, 1], noSleep)).rejects.toBeInstanceOf(TypeError);
    expect(n).toBe(3);
  });
  it("never retries an HTTP error or a submit timeout", async () => {
    let n = 0;
    await expect(withReadRetry(async () => { n++; throw new Error("Alpaca GET → 400"); }, [1, 1], noSleep)).rejects.toThrow(/400/);
    await expect(withReadRetry(async () => { n++; throw new BrokerTimeoutError("submit", "u", 1); }, [1, 1], noSleep)).rejects.toBeInstanceOf(BrokerTimeoutError);
    expect(n).toBe(2);
  });
  it("retries a token timeout only when given isTransientToken", async () => {
    let n = 0;
    const tokenTimeout = async () => { if (n++ < 1) throw new BrokerTimeoutError("token", "u", 1); return "tok"; };
    await expect(withReadRetry(tokenTimeout, [1, 1], noSleep)).rejects.toBeInstanceOf(BrokerTimeoutError); // default: reads only
    n = 0;
    expect(await withReadRetry(tokenTimeout, [1, 1], noSleep, isTransientToken)).toBe("tok");
    expect(isTransientToken(new BrokerTimeoutError("submit", "u", 1))).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  const NOW = Date.parse("2026-10-07T19:15:00Z");
  it("reads delta-seconds", () => { expect(parseRetryAfter("3", NOW)).toBe(3_000); expect(parseRetryAfter("0", NOW)).toBe(0); });
  it("reads an HTTP-date, never negative", () => {
    expect(parseRetryAfter("Wed, 07 Oct 2026 19:15:04 GMT", NOW)).toBe(4_000);
    expect(parseRetryAfter("Wed, 07 Oct 2026 19:14:00 GMT", NOW)).toBe(0);
  });
  it("is null when absent or unparseable", () => { expect(parseRetryAfter(null, NOW)).toBeNull(); expect(parseRetryAfter("soon", NOW)).toBeNull(); expect(parseRetryAfter(" ", NOW)).toBeNull(); });
});

describe("withReadRetry — HTTP 429/5xx (T-8)", () => {
  const rec = () => { const slept: number[] = []; return { slept, sleep: async (ms: number) => { slept.push(ms); } }; };
  const POLICY = { httpDelaysMs: [2_000, 5_000, 10_000], maxRetryAfterMs: 15_000 };
  it("isTransientRead: 429 and 5xx are transient; other 4xx are not", () => {
    expect(isTransientRead(new BrokerHttpError(429, "x"))).toBe(true);
    expect(isTransientRead(new BrokerHttpError(503, "x"))).toBe(true);
    for (const s of [400, 401, 403, 404]) expect(isTransientRead(new BrokerHttpError(s, "x"))).toBe(false);
  });
  it("retries a 429 on the HTTP schedule, honouring a longer Retry-After, then succeeds", async () => {
    const { slept, sleep } = rec(); let n = 0;
    const v = await withReadRetry(async () => { if (n++ < 2) throw new BrokerHttpError(429, "rl", n === 1 ? 4_000 : null); return "ok"; }, [1, 1], sleep, undefined, POLICY);
    expect(v).toBe("ok");
    expect(slept).toEqual([4_000, 5_000]);
  });
  it("clamps a huge Retry-After to the cap and gives up after the HTTP budget", async () => {
    const { slept, sleep } = rec(); let n = 0;
    await expect(withReadRetry(async () => { n++; throw new BrokerHttpError(429, "rl", 120_000); }, [1, 1], sleep, undefined, POLICY)).rejects.toMatchObject({ name: "BrokerHttpError", status: 429 });
    expect(n).toBe(4); expect(slept).toEqual([15_000, 15_000, 15_000]);
  });
  it("never retries a non-transient 4xx", async () => {
    const { slept, sleep } = rec(); let n = 0;
    await expect(withReadRetry(async () => { n++; throw new BrokerHttpError(400, "bad"); }, [1, 1], sleep)).rejects.toMatchObject({ status: 400 });
    expect(n).toBe(1); expect(slept).toEqual([]);
  });
  it("timeouts and HTTP errors have independent budgets (worst case = both exhausted)", async () => {
    const { slept, sleep } = rec(); let n = 0;
    await expect(withReadRetry(async () => {
      n++;
      // HTTP first, so the 3-retry HTTP budget is still open when the 2-retry timeout budget runs out.
      throw n % 2 ? new BrokerHttpError(503, "down") : new BrokerTimeoutError("read", "u", 1);
    }, [1_000, 3_000], sleep, undefined, POLICY)).rejects.toThrow();
    expect(n).toBe(6); // 1 + 2 timeout retries + 3 HTTP retries
    expect(slept).toEqual([2_000, 1_000, 5_000, 3_000, 10_000]);
  });
});
