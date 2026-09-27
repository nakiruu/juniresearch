import { describe, it, expect } from "vitest";
import { fetchWithTimeout, withReadRetry, BrokerTimeoutError } from "./http";

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
