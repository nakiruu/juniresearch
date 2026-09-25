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
import { PAPER_HOST } from "../lib/broker/guards";
import type { BrokerAdapter } from "../lib/broker/adapter";
import { requireAlpaca } from "./_env";
import { loadReportsAndMeta, makeAlpaca, readFills, CRON_LOCK_PATH, CRON_LOG_PATH, FILLS_PATH, HALT_STATE_PATH, RUNS_DIR } from "./_trade-common";

/**
 * Step 3b — always append to cron.log; a halt/breaker trip also goes to stderr, which Windows Task
 * Scheduler captures. runCron only ever calls `notify` for a halt/breaker/refusal condition (clean
 * runs are silent — see lib/trade/cron.ts), so every call here is by construction one of those.
 */
function notify(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  mkdirSync(dirname(CRON_LOG_PATH), { recursive: true });
  appendFileSync(CRON_LOG_PATH, line + "\n");
  console.error(line);
}

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
    // Reach the kill switch without requiring live Alpaca keys (safe-smoke requirement).
    adapter = unreachableAdapter();
  } else {
    const { baseUrl } = requireAlpaca();
    if (!baseUrl.includes(PAPER_HOST)) { console.error(`APCA_API_BASE_URL is not the paper endpoint: ${baseUrl}`); process.exit(2); }
    configuredBaseUrl = baseUrl;
    adapter = makeAlpaca();
  }

  const cfg = resolveTradeConfig();
  const today = new Date().toISOString().slice(0, 10);
  const runId = newRunId(today);

  return runCron({
    adapter, cfg, today, nowMs: Date.now(), runId, configuredBaseUrl,
    paths: { lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH, log: CRON_LOG_PATH, fills: FILLS_PATH, runs: RUNS_DIR },
    loadInputs: async () => {
      const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
      return { reports, sics, marketCapUsd, fills: readFills(FILLS_PATH) };
    },
    notify,
    disabled,
    env: process.env, // guard-level TRADE_DISABLED backstop (Task 6) — must be the real environment.
  });
}

try {
  const result = await main();
  console.log(`trade:cron → ${result.status}${result.reason ? ` (${result.reason})` : ""}${result.orders != null ? ` · ${result.orders} order(s), ${result.fills} fill(s)` : ""}`);
  // Every CronStatus (disabled/closed/locked/halted/noop/executed) is an expected outcome, not a
  // failure the scheduler needs to see in its exit code — halts/breaker trips are surfaced via
  // notify() (cron.log + stderr) instead. Exit 0 covers all of them; only an unexpected throw below
  // (already caught by this try/catch) exits non-zero.
  process.exit(0);
} catch (err) {
  console.error(`trade:cron: unexpected error — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
}
