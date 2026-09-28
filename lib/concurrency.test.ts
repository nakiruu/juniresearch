import { describe, it, expect } from "vitest";
import { allInOrder, createRateLimiter, mapWithConcurrency } from "@/lib/concurrency";

describe("createRateLimiter", () => {
  it("spaces task starts at least minIntervalMs apart, even when called concurrently", async () => {
    let clock = 1000;
    const waits: number[] = [];
    const limit = createRateLimiter(120, () => clock, async (ms) => { waits.push(ms); });
    const started: number[] = [];
    await Promise.all([0, 1, 2, 3].map((i) => limit(async () => { started.push(i); return i; })));
    expect(started).toEqual([0, 1, 2, 3]);
    expect(waits).toEqual([120, 240, 360]); // first starts immediately; the rest queue behind it
    clock = 5000; // well past the reserved slots: no wait
    await limit(async () => 0);
    expect(waits).toHaveLength(3);
  });

  it("returns the task's result and propagates its rejection", async () => {
    const limit = createRateLimiter(0);
    await expect(limit(async () => "ok")).resolves.toBe("ok");
    await expect(limit(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("mapWithConcurrency (fail-fast)", () => {
  it("keeps input order and never exceeds the concurrency cap", async () => {
    let inFlight = 0, peak = 0;
    const out = await mapWithConcurrency([30, 5, 20, 1, 10, 2], 3, async (ms, i) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return `${i}:${ms}`;
    }, { onError: "fail-fast" });
    expect(out).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10", "5:2"]);
    expect(peak).toBe(3);
  });

  it("stops starting new items after a failure and rejects with it", async () => {
    const seen: number[] = [];
    await expect(mapWithConcurrency([1, 2, 3, 4, 5], 1, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error("fail 2");
      return n;
    }, { onError: "fail-fast" })).rejects.toThrow("fail 2");
    expect(seen).toEqual([1, 2]);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1, { onError: "fail-fast" })).toEqual([]);
  });
});

describe("mapWithConcurrency (settle, the default)", () => {
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
