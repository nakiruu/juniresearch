import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { turnoverBreaker, clipToTurnover, readHaltState, bumpHalt, clearHalt, haltBlocked, acquireLock, releaseLock } from "./breakers";
import { DEFAULT_TRADE_CONFIG as C } from "./config";

describe("turnover breaker", () => {
  it("trips above maxRunTurnoverFrac × NAV", () => {
    const nav = 100_000;
    expect(turnoverBreaker([{ qty: 100, limitPrice: 100 }], nav, C).tripped).toBe(false); // 10% < 15%
    expect(turnoverBreaker([{ qty: 200, limitPrice: 100 }], nav, C).tripped).toBe(true);  // 20% > 15%
  });

  it("reports the exact fraction and sums notional across multiple orders", () => {
    const nav = 100_000;
    const r = turnoverBreaker([{ qty: 100, limitPrice: 100 }, { qty: -50, limitPrice: 100 }], nav, C);
    expect(r.frac).toBeCloseTo(0.15, 10); // |100*100| + |-50*100| = 15,000 / 100,000
    expect(r.tripped).toBe(false); // exactly at the boundary, not above it
  });

  it("does not trip (and does not divide by zero) when NAV is zero", () => {
    const r = turnoverBreaker([{ qty: 100, limitPrice: 100 }], 0, C);
    expect(r.frac).toBe(0);
    expect(r.tripped).toBe(false);
  });

  it("treats no orders as zero turnover", () => {
    expect(turnoverBreaker([], 100_000, C).tripped).toBe(false);
  });
});

describe("clipToTurnover (ENTER-only plans)", () => {
  const enter = (ticker: string, qty: number, limitPrice: number) => ({ ticker, qty, limitPrice, side: "buy" as const, reason: "ENTER", deltaUsd: qty * limitPrice });
  // NAV 100k, cap 15% = $15,000.
  it("keeps whole orders, largest target first, up to the cap; defers the rest", () => {
    const r = clipToTurnover([enter("S", 50, 100), enter("L", 90, 100), enter("M", 60, 100)], 100_000, C)!;
    expect(r.kept.map((o) => o.ticker)).toEqual(["L", "M"]); // $9k + $6k = exactly the $15k cap
    expect(r.clipped.map((o) => o.ticker)).toEqual(["S"]);   // $5k more would exceed it
  });
  it("returns null (halt as before) when any order is not an ENTER buy", () => {
    expect(clipToTurnover([enter("A", 100, 100), { ...enter("B", 10, 100), reason: "ADD" }], 100_000, C)).toBeNull();
    expect(clipToTurnover([enter("A", 100, 100), { ...enter("B", 10, 100), side: "sell" as const, reason: "TRIM" }], 100_000, C)).toBeNull();
    expect(clipToTurnover([], 100_000, C)).toBeNull();
  });
  it("never resizes an order, even when it alone exceeds the cap", () => {
    const r = clipToTurnover([enter("BIG", 200, 100)], 100_000, C)!;
    expect(r).toEqual({ kept: [], clipped: [enter("BIG", 200, 100)] });
  });
});

describe("consecutive-halt state + run-lock", () => {
  it("bumps, blocks at the limit, clears; lock is exclusive", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const hs = join(dir, "halt.json"), lk = join(dir, "run.lock");
    expect(readHaltState(hs).consecutive).toBe(0);
    bumpHalt(hs); bumpHalt(hs); expect(haltBlocked(bumpHalt(hs), C)).toBe(true); // 3 >= 3
    clearHalt(hs); expect(readHaltState(hs).consecutive).toBe(0);
    expect(acquireLock(lk)).toBe(true);
    expect(acquireLock(lk)).toBe(false);
    releaseLock(lk);
    expect(acquireLock(lk)).toBe(true);
  });

  it("readHaltState is unaffected by an absent state directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const missing = join(dir, "nested", "does-not-exist", "halt.json");
    expect(readHaltState(missing)).toEqual({ consecutive: 0 });
  });

  it("bumpHalt and acquireLock create parent directories on demand", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const hs = join(dir, "nested", "halt.json");
    const lk = join(dir, "nested", "run.lock");
    expect(bumpHalt(hs)).toEqual({ consecutive: 1 });
    expect(acquireLock(lk)).toBe(true);
  });

  it("releaseLock on an already-released (or never-acquired) lock is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    expect(() => releaseLock(lk)).not.toThrow();
    expect(acquireLock(lk)).toBe(true);
  });

  it("haltBlocked is false below the configured limit", () => {
    expect(haltBlocked({ consecutive: 0 }, C)).toBe(false);
    expect(haltBlocked({ consecutive: C.consecutiveHaltLimit - 1 }, C)).toBe(false);
  });
});

describe("readHaltState fails loud on anything other than an absent file", () => {
  it("returns {consecutive:0} for an absent file", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    expect(readHaltState(join(dir, "halt.json"))).toEqual({ consecutive: 0 });
  });

  it("throws on malformed JSON content", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const hs = join(dir, "halt.json");
    writeFileSync(hs, "{not json");
    expect(() => readHaltState(hs)).toThrow();
  });

  it("throws on well-formed JSON with the wrong shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const hs = join(dir, "halt.json");
    writeFileSync(hs, JSON.stringify({}));
    expect(() => readHaltState(hs)).toThrow(/corrupt/);
  });

  it("throws on a negative or non-finite consecutive value", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const hs = join(dir, "halt.json");
    writeFileSync(hs, JSON.stringify({ consecutive: -1 }));
    expect(() => readHaltState(hs)).toThrow(/corrupt/);
  });

  it("returns the parsed value for a valid file", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const hs = join(dir, "halt.json");
    writeFileSync(hs, JSON.stringify({ consecutive: 2 }));
    expect(readHaltState(hs)).toEqual({ consecutive: 2 });
  });
});

describe("acquireLock error handling", () => {
  it("rethrows a non-EEXIST fs error rather than reporting the lock as held", () => {
    // An embedded NUL byte is an invalid path character on both POSIX and Windows, so
    // writeFileSync throws ERR_INVALID_ARG_VALUE (never EEXIST) without touching the real
    // filesystem — a portable way to drive the "some other fs error" branch of acquireLock's
    // catch without OS-specific permission setup or a fragile fs-module mock (a `vi.mock("node:fs", ...)`
    // spy was tried first: it intercepts a direct import in the test file itself but — unlike
    // `node:fs/promises` in lib/reports.errors.test.ts — never reached the sync writeFileSync
    // called from inside breakers.ts under this project's pool:"forks"/isolate:true config).
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = `${dir}/run.lock${String.fromCharCode(0)}bad`;
    expect(() => acquireLock(lk)).toThrow(/null bytes/);
  });
});

describe("acquireLock stale-lock recovery", () => {
  it("does not reclaim a lock it just wrote itself, even with a generous staleMs", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    expect(acquireLock(lk)).toBe(true);
    expect(acquireLock(lk, 10 * 60_000)).toBe(false); // milliseconds old, well within 10 min
  });

  it("reclaims using the default staleMs when none is passed (90 min old > default 60 min)", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    const staleTs = new Date(Date.now() - 90 * 60_000).toISOString();
    writeFileSync(lk, `1 ${staleTs}`);
    expect(acquireLock(lk)).toBe(true);
    expect(readFileSync(lk, "utf8")).toMatch(new RegExp(`^${process.pid} `));
  });

  it("reclaims an explicitly stale lock (older than staleMs): returns true, new lock present", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    const staleTs = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); // 2h old
    writeFileSync(lk, `99999 ${staleTs}`);
    expect(acquireLock(lk, 60 * 60_000)).toBe(true);
    const content = readFileSync(lk, "utf8");
    expect(content).not.toContain(staleTs);
    expect(content).toMatch(new RegExp(`^${process.pid} `));
  });

  it("does not reclaim a lock just under the staleMs threshold", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    // 5s under the 60-min threshold — a safety margin against real-clock jitter between
    // computing this timestamp and acquireLock's own Date.now() check, unlike testing the exact
    // boundary (Date.now() - staleMs), which is inherently racy against wall-clock time.
    const staleTs = new Date(Date.now() - (60 * 60_000 - 5_000)).toISOString();
    writeFileSync(lk, `1 ${staleTs}`);
    expect(acquireLock(lk, 60 * 60_000)).toBe(false);
  });

  it("does not reclaim a lock with an unparseable/garbage timestamp (conservative)", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    writeFileSync(lk, "garbage, not a lock line at all");
    expect(acquireLock(lk, 60 * 60_000)).toBe(false);
    expect(readFileSync(lk, "utf8")).toBe("garbage, not a lock line at all"); // untouched
  });

  it("does not reclaim a lock with a missing timestamp field (pid only)", () => {
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");
    writeFileSync(lk, "12345");
    expect(acquireLock(lk, 60 * 60_000)).toBe(false);
  });

  it("does not throw ENOENT when a reclaim races a concurrent remover (another reclaimer, or the original owner's releaseLock) and the stale lock file is already gone by the time we try to remove it", async () => {
    // This is the exact bug: acquireLock's reclaim branch used to call rmSync(path) with no
    // `force`, so if a competing reclaimer (or releaseLock, run by the lock's original owner
    // finally finishing) deleted the file first, our rmSync raised ENOENT and it escaped
    // acquireLock uncaught. Reproducing this needs a real filesystem race — a genuinely
    // concurrent deleter, not a single-threaded "delete it before calling acquireLock" (that
    // would just make the initial `wx` write succeed outright, never reaching the reclaim branch
    // at all). Mocking node:fs was tried first and rejected, same as the EEXIST test above: it
    // doesn't reach breakers.ts's own `import { readFileSync } from "node:fs"` in this project's
    // Vitest setup (empirically confirmed: a mocked readFileSync here is never observed by
    // breakers.ts, so a test built on it would pass whether or not the bug was fixed). A
    // worker_thread gives a real, separate OS thread that can genuinely interleave with this
    // thread's synchronous fs calls. This was verified against the pre-fix code: over ~1300
    // iterations in 1.5s it reliably threw dozens of real ENOENT errors; with the fix, zero.
    //
    // A second, unrelated Windows-only race can surface here too: CreateFile with CREATE_NEW can
    // return EPERM (not EEXIST/ENOENT) when it overlaps a pending delete of the same path. That's
    // explicitly out of scope for this fix (spec: "any other unexpected error, rethrow is fine"),
    // so this test asserts specifically that ENOENT never leaks, not that nothing ever throws.
    const dir = mkdtempSync(join(tmpdir(), "brk-"));
    const lk = join(dir, "run.lock");

    const worker = new Worker(
      `
      const { unlinkSync, existsSync } = require("node:fs");
      const { parentPort, workerData } = require("node:worker_threads");
      const deadline = Date.now() + workerData.durationMs;
      while (Date.now() < deadline) {
        try { if (existsSync(workerData.path)) unlinkSync(workerData.path); } catch { /* raced too */ }
      }
      parentPort.postMessage("done");
      `,
      { eval: true, workerData: { path: lk, durationMs: 800 } },
    );
    const workerDone = new Promise<void>((resolve) => worker.once("message", () => resolve()));

    const start = Date.now();
    let iterations = 0;
    const enoentErrors: unknown[] = [];
    while (Date.now() - start < 800) {
      const staleTs = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); // 2h old, well past staleMs
      try { writeFileSync(lk, `99999 ${staleTs}`); } catch { /* worker deleted it mid-write; fine */ }
      iterations++;
      try {
        const result = acquireLock(lk, 60 * 60_000);
        expect(typeof result).toBe("boolean");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") enoentErrors.push(err);
        // any other code (e.g. Windows EPERM on a pending-delete race) is out of scope — allowed
      }
    }

    await workerDone;
    await worker.terminate();

    expect(iterations).toBeGreaterThan(0); // sanity: the stress loop actually ran
    expect(enoentErrors).toEqual([]);
  }, 10_000);
});
