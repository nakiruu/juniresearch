/** trade:execute [--yes]  — plan, (confirm), submit through the guards, record fills.
 *  Broker chosen by BROKER env: "alpaca-paper" (default, paper test rig) or "schwab" (LIVE money). */
import { createInterface } from "node:readline/promises";
import { resolveTradeConfig } from "../lib/trade/config";
import { planRun, executeOrders, mergeExecution } from "../lib/trade/pipeline";
import { crossCheckBroker } from "../lib/trade/audit";
import { makeNotifier, summaryFromRun } from "../lib/trade/notify";
import { newRunId, writeRunRecord } from "../lib/trade/run-record";
import { writeLedger } from "../lib/trade/ledger";
import { SchwabAuthError } from "../lib/broker/schwab-auth";
import { has, loadReportsAndMeta, makeBroker, brokerBaseUrl, readFills, FILLS_PATH, LEDGER_PATH, RUNS_DIR } from "./_trade-common";
import { todayET } from "../lib/trade/clock";

const args = process.argv.slice(2);
if (process.env.TRADE_DISABLED === "1") { console.error("TRADE_DISABLED=1 — refusing to submit."); process.exit(2); }
const cfg = resolveTradeConfig();
const today = todayET();
const adapter = makeBroker();
const baseUrl = brokerBaseUrl(adapter);
const mode = adapter.kind === "schwab" ? ">>> LIVE — Charles Schwab (real money) <<<" : "paper — Alpaca (test)";
console.log(`Broker: ${adapter.kind}  ${mode}`);
const notifier = makeNotifier({ webhookUrl: process.env.DISCORD_WEBHOOK_URL });
try {
  if (!(await adapter.getClock()).isOpen) { console.log("Market is closed — nothing submitted (spec §9.5)."); process.exit(0); }
} catch (e) {
  if (e instanceof SchwabAuthError) { notifier.message(e.message); await notifier.flush(); console.error(e.message); process.exit(2); }
  throw e;
}
const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
const runId = newRunId(today);
const out = await planRun({ adapter, reports, sics, marketCapUsd, fills: readFills(FILLS_PATH), today, cfg, runId, clock: Date.now });
writeLedger(LEDGER_PATH, out.ledger);
for (const o of out.sized.orders) console.log(`  ${o.side} ${o.ticker} ${o.qty} sh @ limit $${o.limitPrice} ioc (${o.reason})`);
if (out.sized.orders.length === 0) { writeRunRecord(RUNS_DIR, out.record); notifier.runSummary(summaryFromRun(out, "noop", [])); await notifier.flush(); console.log("Nothing to trade."); process.exit(0); }
if (!has(args, "--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`Submit ${out.sized.orders.length} order(s) to ${adapter.kind}${adapter.kind === "schwab" ? " (LIVE)" : " (paper)"}? [y/N] `)).trim().toLowerCase(); rl.close();
  if (a !== "y") { console.log("Aborted; nothing submitted."); process.exit(0); }
}
const { fills, executed, aborted, skippedCash } = await executeOrders({ adapter, sized: out.sized, ctx: { brokerKind: adapter.kind, configuredBaseUrl: baseUrl, locks: out.locks, today, nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: process.env, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } }, runId, fillsPath: FILLS_PATH });
out.record.fills = fills as unknown as Record<string, unknown>[];
out.record.orders = mergeExecution(out.record.orders, executed);
out.record.notes.push(...skippedCash.map((s) => `cash skipped: ${s.ticker} — ${s.detail}`));
for (const s of skippedCash) console.warn(`  skipped (cash backstop): ${s.ticker} — ${s.detail}`);
const path = writeRunRecord(RUNS_DIR, out.record);
console.log(`Submitted ${executed.length} of ${out.sized.orders.length} order(s); ${fills.length} fill(s) recorded to ${FILLS_PATH}. Run record ${path}. Run trade:reconcile before the next plan.`);

// Broker-truth cross-check (spec §4): the recorded fills must match what the broker actually did.
// Fills are already written, so this is a fail-loud alert, not a rollback — a critical discrepancy
// exits non-zero so the operator investigates before the next run.
const brokerIdByCid = new Map(executed.map((e) => [e.clientOrderId, e.brokerId || undefined]));
const audit = crossCheckBroker({
  expected: out.sized.orders.filter((o) => brokerIdByCid.has(o.clientOrderId)).map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side, brokerId: brokerIdByCid.get(o.clientOrderId) })),
  brokerOrders: await adapter.getOrders("all", `${today}T00:00:00Z`),
  fills,
});
for (const d of audit.discrepancies) console.error(`  [${d.severity.toUpperCase()}] ${d.code} ${d.ticker}${d.orderId ? ` (${d.orderId})` : ""} — ${d.detail}`);
notifier.runSummary(summaryFromRun(out, "executed", fills, audit));
if (aborted) {
  const msg = `STOPPED: the order submit for ${aborted.ticker} has an UNKNOWN outcome (${aborted.detail}). Remaining orders were NOT sent. Check the broker's order history; if it executed, run \`npm run trade:reconcile -- --record-missing\`.`;
  notifier.message(msg);
  await notifier.flush();
  console.error(msg);
  process.exit(1);
}
if (!audit.ok) {
  notifier.message(`Broker-truth check FAILED: ${audit.critical} critical discrepancy(ies). Investigate before the next run.`);
  await notifier.flush();
  console.error(`Broker-truth check FAILED: ${audit.critical} critical discrepancy(ies). Investigate before the next run.`);
  process.exit(1);
}
console.log(`Broker-truth check ${audit.warn ? `OK with ${audit.warn} warning(s)` : "clean"}.`);
await notifier.flush();
