/**
 * trade:cron — the scheduler entrypoint (spec §2, §3). Windows Task Scheduler invokes `npm run
 * trade:cron` once each trading morning; this script builds the real dependencies and calls
 * `runCron` (lib/trade/cron.ts), which does all the actual reconcile → plan → execute-if-any
 * orchestration, breakers, locking and logging. This file is thin wiring, mirroring
 * scripts/trade-execute.ts: build the real Alpaca PAPER adapter, refuse non-paper, assemble
 * `loadInputs` from `_trade-common`, define `notify`, map the result to a process exit code.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runCron, type CronResult } from "../lib/trade/cron";
import { resolveTradeConfig } from "../lib/trade/config";
import { newRunId } from "../lib/trade/run-record";
import { makeNotifier } from "../lib/trade/notify";
import type { BrokerAdapter } from "../lib/broker/adapter";
import { loadReportsAndMeta, makeBroker, brokerBaseUrl, readFills, CRON_LOCK_PATH, CRON_LOG_PATH, FILLS_PATH, HALT_STATE_PATH, RUNS_DIR } from "./_trade-common";
import { todayET } from "../lib/trade/clock";

/**
 * Every alert/summary line lands in cron.log and on stderr (which Windows Task Scheduler captures);
 * the notifier ALSO posts it to Discord when DISCORD_WEBHOOK_URL is set (best-effort — a Discord
 * outage never fails the run). Alerts are halt/breaker/refusal conditions; run summaries carry the
 * orders/fills/goal-book/audit for every executed and noop run.
 */
function logLine(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  mkdirSync(dirname(CRON_LOG_PATH), { recursive: true });
  appendFileSync(CRON_LOG_PATH, line + "\n");
  console.error(line);
}
const notifier = makeNotifier({ webhookUrl: process.env.DISCORD_WEBHOOK_URL, onLog: logLine });

/**
 * A structurally-valid BrokerAdapter that throws if actually invoked. Used only when
 * TRADE_DISABLED=1, so the kill switch can be smoke-tested without live Alpaca keys — runCron's
 * step 1 (disabled) returns before any adapter method is ever called (lib/trade/cron.ts).
 */
function unreachableAdapter(): BrokerAdapter {
  const fail = (): never => { throw new Error("trade:cron: adapter invoked while TRADE_DISABLED=1 — unreachable (runCron checks `disabled` before any adapter call)."); };
  return {
    kind: "fake",
    getClock: fail, getCalendar: fail, getAccount: fail, getPositions: fail, getOrders: fail,
    getLastClose: fail, getLatestTrade: fail, getLatestQuote: fail, isFractionable: fail,
    submitOrder: fail, cancelOrder: fail,
  } as unknown as BrokerAdapter;
}

async function main(): Promise<CronResult> {
  const disabled = process.env.TRADE_DISABLED === "1";

  let adapter: BrokerAdapter;
  let configuredBaseUrl = "";
  if (disabled) {
    // Reach the kill switch without requiring live broker keys (safe-smoke requirement).
    adapter = unreachableAdapter();
  } else {
    adapter = makeBroker(); // BROKER=alpaca-paper (default) | schwab (LIVE)
    configuredBaseUrl = brokerBaseUrl(adapter);
  }

  const cfg = resolveTradeConfig();
  const nowMs = Date.now();
  const today = todayET(nowMs); // ET trading date — the UTC date is tomorrow from 20:00 EDT
  const runId = newRunId(today);

  return runCron({
    adapter, cfg, today, nowMs, runId, configuredBaseUrl,
    paths: { lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH, log: CRON_LOG_PATH, fills: FILLS_PATH, runs: RUNS_DIR },
    loadInputs: async () => {
      const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
      return { reports, sics, marketCapUsd, fills: readFills(FILLS_PATH) };
    },
    notify: notifier.message,
    notifySummary: notifier.runSummary,
    disabled,
    env: process.env, // guard-level TRADE_DISABLED backstop (Task 6) — must be the real environment.
  });
}

try {
  const result = await main();
  await notifier.flush(); // let any Discord POSTs complete before the process exits
  console.log(`trade:cron → ${result.status}${result.reason ? ` (${result.reason})` : ""}${result.orders != null ? ` · ${result.orders} order(s), ${result.fills} fill(s)` : ""}`);
  // Fix round 1 (ruling): "halted" (a breaker trip / reconcile failure / consecutive-halt block)
  // exits non-zero so Windows Task Scheduler's Last-Run-Result surfaces it independently of
  // notify()/cron.log. Every other resolved status is benign/expected: "locked" is an overlapping
  // run declining to double-submit (self-protection, not a failure); disabled/closed/noop/executed
  // are ordinary outcomes. An unexpected throw (caught below) is the only other non-zero case.
  process.exit(result.status === "halted" ? 1 : 0);
} catch (err) {
  notifier.message(`trade:cron: unexpected error — ${err instanceof Error ? err.message : String(err)}`);
  await notifier.flush();
  console.error(`trade:cron: unexpected error — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
}
