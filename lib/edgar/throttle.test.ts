import { describe, it, expect } from "vitest";
import { createRateLimiter, mapConcurrent } from "@/lib/edgar/throttle";

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

describe("mapConcurrent", () => {
  it("keeps input order and never exceeds the concurrency cap", async () => {
    let inFlight = 0, peak = 0;
    const out = await mapConcurrent([30, 5, 20, 1, 10, 2], 3, async (ms, i) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10", "5:2"]);
    expect(peak).toBe(3);
  });

  it("stops starting new items after a failure and rejects with it", async () => {
    const seen: number[] = [];
    await expect(mapConcurrent([1, 2, 3, 4, 5], 1, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error("fail 2");
      return n;
    })).rejects.toThrow("fail 2");
    expect(seen).toEqual([1, 2]);
  });

  it("handles an empty list", async () => {
    expect(await mapConcurrent([], 4, async () => 1)).toEqual([]);
  });
});
