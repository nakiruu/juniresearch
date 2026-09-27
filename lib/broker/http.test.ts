import { describe, it, expect } from "vitest";
import { fetchWithTimeout, withReadRetry, BrokerTimeoutError, mapWithConcurrency, allInOrder } from "./http";

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
});

describe("mapWithConcurrency", () => {
  const tick = () => new Promise((r) => setTimeout(r, 1));
  it("keeps input order and never exceeds the limit", async () => {
    let inFlight = 0, peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (n) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, n)); inFlight--; return n * 10; });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
  it("throws the EARLIEST failing item's error (sequential semantics), after every call settles", async () => {
    const done: number[] = [];
    const run = mapWithConcurrency([0, 1, 2, 3], 4, async (i) => {
      await new Promise((r) => setTimeout(r, 10 - i * 3)); // later items settle first
      done.push(i);
      if (i === 1 || i === 3) throw new Error(`boom ${i}`);
      return i;
    });
    await expect(run).rejects.toThrow("boom 1");
    expect(done.sort()).toEqual([0, 1, 2, 3]);
  });
  it("handles an empty list", async () => {
    await tick();
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("allInOrder", () => {
  it("resolves the tuple in position order", async () => {
    expect(await allInOrder([Promise.resolve(1), Promise.resolve("a")])).toEqual([1, "a"]);
  });
  it("throws the earliest-positioned rejection even when a later one rejects first", async () => {
    const early = new Promise<number>((_, rej) => setTimeout(() => rej(new Error("first by position")), 15));
    const late = Promise.reject(new Error("first in time"));
    await expect(allInOrder([early, late])).rejects.toThrow("first by position");
  });
});
