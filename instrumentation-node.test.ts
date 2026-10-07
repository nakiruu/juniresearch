import { afterEach, describe, it, expect, vi } from "vitest";

const { stop, startScheduler, buildSchedulerDeps } = vi.hoisted(() => {
  const stop = vi.fn();
  return { stop, startScheduler: vi.fn(() => ({ stop })), buildSchedulerDeps: vi.fn(() => ({})) };
});
vi.mock("./lib/trade/scheduler-wiring", () => ({
  buildSchedulerDeps, startScheduler,
  getSchedulerStatus: () => ({ broker: "fake", nextRunISO: null }),
}));
import { registerNode } from "./instrumentation-node";

const prev = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
  Object.assign(process.env, prev);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.removeListener(sig, stop);
  delete (globalThis as { __tradeSchedulerRegistered?: boolean }).__tradeSchedulerRegistered;
  startScheduler.mockClear(); buildSchedulerDeps.mockReset(); buildSchedulerDeps.mockImplementation(() => ({}));
});

describe("registerNode (A-5)", () => {
  it("arms one scheduler and one pair of signal listeners per process, however often it is called", async () => {
    process.env.NEXT_RUNTIME = "nodejs"; process.env.TRADE_SCHEDULER_ENABLED = "1";
    const before = process.listenerCount("SIGTERM");
    await registerNode(); await registerNode();
    expect(startScheduler).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGTERM") - before).toBe(1);
  });
  it("a failed arm can be retried by a later call", async () => {
    process.env.NEXT_RUNTIME = "nodejs"; process.env.TRADE_SCHEDULER_ENABLED = "1";
    buildSchedulerDeps.mockImplementationOnce(() => { throw new Error("no keys"); });
    await registerNode();
    expect(startScheduler).not.toHaveBeenCalled();
    await registerNode();
    expect(startScheduler).toHaveBeenCalledTimes(1);
  });
});
