import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnoverBreaker, readHaltState, bumpHalt, clearHalt, haltBlocked, acquireLock, releaseLock } from "./breakers";
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
