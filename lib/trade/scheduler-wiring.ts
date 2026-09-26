/**
 * scheduler-wiring.ts — the real (production) SchedulerDeps for the in-process scheduler
 * (instrumentation.ts). Mirrors scripts/trade-cron.ts's main(): build the broker, assemble
 * CronDeps, call runCron — minus the process.exit mapping (the caller here is startScheduler,
 * not a process). Honors TRADE_DISABLED with an unreachable adapter so the scheduler needs no
 * broker keys when disabled, exactly like trade:cron's safe-smoke path.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runCron, type CronResult } from "./cron";
import { resolveTradeConfig } from "./config";
import { newRunId } from "./run-record";
import { makeNotifier } from "./notify";
import type { BrokerAdapter } from "../broker/adapter";
import {
  makeBroker, brokerBaseUrl, loadReportsAndMeta, readFills,
  CRON_LOCK_PATH, CRON_LOG_PATH, FILLS_PATH, HALT_STATE_PATH, RUNS_DIR, AUTH_WARN_PATH, schwabRefreshObtainedAt,
} from "./runtime";
import { startScheduler, getSchedulerStatus, type SchedulerDeps } from "./scheduler";
import { todayET } from "./clock";
export { startScheduler, getSchedulerStatus };

/**
 * A structurally-valid BrokerAdapter that throws if actually invoked. Used only when
 * TRADE_DISABLED=1, so the kill switch can be smoke-tested without live broker keys — runCron's
 * step 1 (disabled) returns before any adapter method is ever called (lib/trade/cron.ts).
 */
function unreachableAdapter(): BrokerAdapter {
  const fail = (): never => { throw new Error("scheduler: adapter invoked while TRADE_DISABLED=1 — unreachable."); };
  return {
    kind: "fake",
    getClock: fail, getCalendar: fail, getAccount: fail, getPositions: fail, getOrders: fail,
    getLastClose: fail, getLatestTrade: fail, getLatestQuote: fail, isFractionable: fail,
    submitOrder: fail, findSubmitted: fail, cancelOrder: fail,
  } as unknown as BrokerAdapter;
}

export function buildSchedulerDeps(env: NodeJS.ProcessEnv = process.env): SchedulerDeps {
  const cfg = resolveTradeConfig();
  const broker = env.BROKER ?? "alpaca-paper";
  const disabled = env.TRADE_DISABLED === "1";
  const notifier = makeNotifier({
    webhookUrl: env.DISCORD_WEBHOOK_URL,
    onLog: (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      mkdirSync(dirname(CRON_LOG_PATH), { recursive: true });
      appendFileSync(CRON_LOG_PATH, line + "\n");
      console.error(line);
    },
  });

  // Lazily build the adapter per fire so a token refreshed between runs is picked up.
  const runOnce = async (): Promise<CronResult> => {
    const adapter = disabled ? unreachableAdapter() : makeBroker(env);
    const configuredBaseUrl = disabled ? "" : brokerBaseUrl(adapter);
    const nowMs = Date.now();
    const today = todayET(nowMs); // one clock read for both, and the ET trading date (not UTC)
    const result = await runCron({
      adapter, cfg, today, nowMs, runId: newRunId(today), configuredBaseUrl,
      paths: { lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH, log: CRON_LOG_PATH, fills: FILLS_PATH, runs: RUNS_DIR, authWarn: AUTH_WARN_PATH },
      refreshObtainedAt: disabled ? undefined : schwabRefreshObtainedAt(env),
      loadInputs: async () => { const m = await loadReportsAndMeta(); return { ...m, fills: readFills(FILLS_PATH) }; },
      notify: notifier.message, notifySummary: notifier.runSummary, disabled, env,
    });
    await notifier.flush();
    return result;
  };

  const marketOpenNow = async (): Promise<boolean> => {
    if (disabled) return false;
    try { return (await makeBroker(env).getClock()).isOpen; } catch { return false; }
  };

  return {
    runOnce, marketOpenNow, cfg, broker, env, now: () => Date.now(),
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return { clear: () => clearTimeout(t) }; },
  };
}
