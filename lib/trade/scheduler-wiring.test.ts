import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSchedulerDeps } from "./scheduler-wiring";
import { readHaltState } from "./breakers";
import type { TradeNotifier } from "./notify";

/** Every run path in a temp dir — these tests must never touch data/trade (the old disabled test wrote data/trade/cron.log). */
const tmpPaths = () => {
  const d = mkdtempSync(join(tmpdir(), "wiring-"));
  return { lock: join(d, "cron.lock"), haltState: join(d, "halt.json"), log: join(d, "cron.log"), fills: join(d, "fills.jsonl"), runs: join(d, "runs"), authWarn: join(d, "auth-warn.json"), relabelState: join(d, "relabel.json") };
};
const recNotifier = () => {
  const messages: string[] = []; let flushed = 0;
  const notifier: TradeNotifier = { message: (m) => { messages.push(m); }, runSummary: () => {}, allocation: () => {}, flush: async () => { flushed++; } };
  return { notifier, messages, flushes: () => flushed };
};

describe("buildSchedulerDeps", () => {
  it("with TRADE_DISABLED=1, runOnce returns 'disabled', needs no broker keys, and logs to the injected path", async () => {
    const paths = tmpPaths();
    const deps = buildSchedulerDeps({ TRADE_DISABLED: "1", BROKER: "alpaca-paper" } as unknown as NodeJS.ProcessEnv, { paths, notifier: recNotifier().notifier });
    expect(deps.broker).toBe("alpaca-paper");
    expect(typeof deps.now()).toBe("number");
    expect((await deps.runOnce()).status).toBe("disabled");
    expect(existsSync(paths.log)).toBe(true);
  });

  it("T-4: an error escaping runOnce is alerted, flushed and re-thrown; the halt counter is untouched (pre-trade)", async () => {
    const paths = tmpPaths(); const n = recNotifier();
    const deps = buildSchedulerDeps({ BROKER: "nope" } as unknown as NodeJS.ProcessEnv, { paths, notifier: n.notifier });
    await expect(deps.runOnce()).rejects.toThrow(/BROKER=nope is not a known broker/);
    expect(n.messages).toEqual([expect.stringMatching(/^scheduler: run stopped before any order was sent — BROKER=nope is not a known broker/)]);
    expect(n.flushes()).toBe(1);
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 });
  });

  it("review focus 4: an alert path that throws (message and flush) never masks the original error", async () => {
    const paths = tmpPaths();
    const notifier: TradeNotifier = { message: () => { throw new Error("log disk full"); }, runSummary: () => {}, allocation: () => {}, flush: async () => { throw new Error("discord down"); } };
    const deps = buildSchedulerDeps({ BROKER: "nope" } as unknown as NodeJS.ProcessEnv, { paths, notifier });
    await expect(deps.runOnce()).rejects.toThrow(/BROKER=nope is not a known broker/);
  });
});
