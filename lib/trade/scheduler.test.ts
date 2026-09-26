import { describe, it, expect, vi } from "vitest";
import { nextRunAtET, etDateString, shouldCatchUp, shouldArm, startScheduler, getSchedulerStatus, readSchedulerState, writeSchedulerState } from "./scheduler";
import type { CronResult } from "./cron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 09:45 EDT (UTC-4) = 13:45Z ; 09:45 EST (UTC-5) = 14:45Z
describe("nextRunAtET", () => {
  it("returns today's 09:45 ET when now is before it (EDT summer day)", () => {
    const now = Date.parse("2026-07-01T12:00:00Z"); // 08:00 ET, a Wednesday
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-07-01T13:45:00.000Z");
  });
  it("rolls to the next day when now is past 09:45 ET", () => {
    const now = Date.parse("2026-07-01T18:00:00Z"); // 14:00 ET Wed
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-07-02T13:45:00.000Z");
  });
  it("skips the weekend: Friday afternoon → Monday 09:45 ET", () => {
    const now = Date.parse("2026-07-03T18:00:00Z"); // Fri 14:00 ET
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-07-06T13:45:00.000Z"); // Mon
  });
  it("skips an NYSE holiday (Jan 1) to the next trading day", () => {
    const now = Date.parse("2027-01-01T05:00:00Z"); // very early Jan 1 (holiday)
    // Jan 1 2027 is a Friday holiday → next trading day Mon Jan 4, 09:45 EST = 14:45Z
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2027-01-04T14:45:00.000Z");
  });
  it("uses EST offset in winter (14:45Z)", () => {
    const now = Date.parse("2026-12-02T05:00:00Z"); // Wed, winter
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-12-02T14:45:00.000Z");
  });
  it("handles the spring-forward morning (2027-03-14 is a Sunday → Mon 15th EDT)", () => {
    const now = Date.parse("2027-03-13T20:00:00Z"); // Sat
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2027-03-15T13:45:00.000Z"); // Mon, now EDT
  });
});

describe("etDateString", () => {
  it("gives the ET calendar date, not UTC", () => {
    expect(etDateString(Date.parse("2026-07-02T02:00:00Z"))).toBe("2026-07-01"); // 22:00 ET prev day
  });
});

describe("shouldCatchUp", () => {
  it("runs now when not yet fired today and the market is open", () => {
    expect(shouldCatchUp({ lastFiredDay: "2026-06-30", todayET: "2026-07-01", marketOpen: true })).toBe(true);
  });
  it("does not run when already fired today", () => {
    expect(shouldCatchUp({ lastFiredDay: "2026-07-01", todayET: "2026-07-01", marketOpen: true })).toBe(false);
  });
  it("does not run when the market is closed", () => {
    expect(shouldCatchUp({ lastFiredDay: null, todayET: "2026-07-01", marketOpen: false })).toBe(false);
  });
});

function fakeTimer() {
  let fn: (() => void) | null = null;
  return {
    setTimer: (f: () => void, _ms: number) => { fn = f; return { clear: () => { fn = null; } }; },
    fire: () => { const f = fn; fn = null; f?.(); },
    pending: () => fn !== null,
  };
}

describe("startScheduler", () => {
  it("catches up on boot when the market is open and not fired today, then arms", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    const timer = fakeTimer();
    const runOnce = vi.fn(async (): Promise<CronResult> => ({ status: "executed", orders: 2, fills: 2 }));
    const s = startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as unknown as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"), // 10:00 ET, market open, past 09:45
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); await Promise.resolve(); // let the async boot settle
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(readSchedulerState(dir).lastFiredDay).toBe("2026-07-01");
    expect(timer.pending()).toBe(true); // armed for the next day
    s.stop();
    expect(timer.pending()).toBe(false);
  });

  it("does not catch up when already fired today; just arms", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    writeSchedulerState({ lastFiredDay: "2026-07-01" }, dir);
    const timer = fakeTimer();
    const runOnce = vi.fn(async (): Promise<CronResult> => ({ status: "noop" }));
    const s = startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as unknown as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"),
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); await Promise.resolve();
    expect(runOnce).not.toHaveBeenCalled();
    expect(timer.pending()).toBe(true);
    s.stop();
  });

  it("a rejecting runOnce never crashes and still re-arms, reporting status 'error'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    const timer = fakeTimer();
    const runOnce = vi.fn(async (): Promise<CronResult> => { throw new Error("boom"); });
    const s = startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as unknown as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"), // 10:00 ET, past 09:45 → arms for next day
      setTimer: timer.setTimer, stateDir: dir,
    });
    // Boot catch-up awaits the rejecting runOnce; the fire path must swallow it (no unhandled rejection).
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(true); // re-armed for the next trading day despite the rejection
    expect(getSchedulerStatus().lastRun?.status).toBe("error");
    s.stop();
    expect(timer.pending()).toBe(false);
  });

  it("a rejecting runOnce during a stopped scheduler does not re-arm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    const timer = fakeTimer();
    let rejectRun: (e: Error) => void;
    const runOnce = vi.fn((): Promise<CronResult> => new Promise((_res, reject) => { rejectRun = reject; }));
    const s = startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as unknown as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"),
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // reach the in-flight runOnce
    expect(runOnce).toHaveBeenCalledTimes(1);
    s.stop();                       // shutdown while runOnce is in flight
    rejectRun!(new Error("boom"));  // then it rejects
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(timer.pending()).toBe(false);          // stopped → no re-arm
    expect(getSchedulerStatus().armed).toBe(false);
  });

  it("does not double-fire the same day: catch-up then the armed same-day timer skips runOnce", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    const timer = fakeTimer();
    const runOnce = vi.fn(async (): Promise<CronResult> => ({ status: "executed", orders: 1, fills: 1 }));
    const s = startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as unknown as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T13:35:00Z"), // 09:35 ET, market open, before today's 09:45
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);                 // catch-up fired
    expect(readSchedulerState(dir).lastFiredDay).toBe("2026-07-01");
    expect(timer.pending()).toBe(true);                       // armed for the SAME day's 09:45
    timer.fire();                                             // the same-day 09:45 timer fires
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);                 // NOT re-run — same-day guard held
    expect(timer.pending()).toBe(true);                       // still re-armed
    s.stop();
  });

  it("stop() during an in-flight boot (marketOpenNow still pending) is not undone when it resolves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    const timer = fakeTimer();
    const runOnce = vi.fn(async (): Promise<CronResult> => ({ status: "executed", orders: 1, fills: 1 }));
    let resolveMarketOpen: (open: boolean) => void;
    const marketOpenNow = () => new Promise<boolean>((resolve) => { resolveMarketOpen = resolve; });
    const s = startScheduler({
      runOnce, marketOpenNow,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as unknown as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"),
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); // let the boot IIFE reach and start awaiting marketOpenNow()
    s.stop(); // shutdown requested while marketOpenNow() is still in flight
    resolveMarketOpen!(true); // now let it resolve — the boot must abandon rather than resurrect
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(runOnce).not.toHaveBeenCalled();
    expect(timer.pending()).toBe(false);
    expect(getSchedulerStatus().armed).toBe(false);
  });
});

describe("getSchedulerStatus", () => {
  it("reports broker + kill-switch from env when disarmed", () => {
    const st = getSchedulerStatus({ BROKER: "schwab", TRADE_DISABLED: "1" } as unknown as NodeJS.ProcessEnv);
    expect(st.broker).toBe("schwab");
    expect(st.tradeDisabled).toBe(true);
  });
});

describe("shouldArm", () => {
  it("arms only in the node runtime with the flag on", () => {
    expect(shouldArm({ NEXT_RUNTIME: "nodejs", TRADE_SCHEDULER_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldArm({ NEXT_RUNTIME: "edge", TRADE_SCHEDULER_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldArm({ NEXT_RUNTIME: "nodejs" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
