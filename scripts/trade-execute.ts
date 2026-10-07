/** trade:execute [--yes | --preview]  — plan, (confirm), submit through the guards, record fills.
 *  Broker chosen by BROKER env: "alpaca-paper" (default, paper test rig) or "schwab" (LIVE money).
 *  Every run prints the target allocation and posts it to Discord (when DISCORD_WEBHOOK_URL is set) —
 *  including a market-closed run, a declined prompt, and `--preview`, which plans and never submits. */
import { createInterface } from "node:readline/promises";
import { resolveTradeConfig, tradeConfigFromEnv } from "../lib/trade/config";
import { planRun, executeOrders, mergeExecution } from "../lib/trade/pipeline";
import { crossCheckBroker } from "../lib/trade/audit";
import { abortAlert } from "../lib/trade/cron";
import { TERMINAL_STATUSES, type BrokerOrderStatus } from "../lib/broker/adapter";
import { allocationFromRun, allocationLines, makeNotifier, summaryFromRun } from "../lib/trade/notify";
import { newRunId, writeRunRecord } from "../lib/trade/run-record";
import { writeLedger, ReconcileError } from "../lib/trade/ledger";
import { SchwabAuthError } from "../lib/broker/schwab-auth";
import { has, isPreviewOnly, loadReportsAndMeta, makeBroker, brokerBaseUrl, readFills, CRON_LOCK_PATH, FILLS_PATH, HALT_STATE_PATH, LEDGER_PATH, RUNS_DIR } from "./_trade-common";
import { etInstantOn, todayET } from "../lib/trade/clock";
import { acquireManualRun, manualPlanTooOld, MANUAL_PLAN_MAX_AGE_MS, type ManualRunGate } from "../lib/trade/breakers";

const args = process.argv.slice(2);
// --preview, or PREVIEW_ONLY=true in the environment: plan + post the allocation, never submit.
const preview = has(args, "--preview") || isPreviewOnly();
if (process.env.TRADE_DISABLED === "1" && !preview) { console.error("TRADE_DISABLED=1 — refusing to submit (use --preview to plan only)."); process.exit(2); }
const cfg = resolveTradeConfig(tradeConfigFromEnv());
const notifier = makeNotifier({ webhookUrl: process.env.DISCORD_WEBHOOK_URL });
// A run that may submit holds cron's run-lock from BEFORE planning (no overlap with the scheduler, no double-submit)
// and refuses while the consecutive-halt breaker is tripped. Released on every exit path; a preview takes no lock.
let gate: Extract<ManualRunGate, { ok: true }> | null = null;
if (!preview) {
  const g = acquireManualRun({ lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH }, cfg);
  if (!g.ok) {
    const msg = `trade:execute refused — ${g.reason}`;
    console.error(msg); notifier.message(msg); await notifier.flush(); process.exit(2);
  }
  gate = g;
  process.once("exit", g.release);
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) process.once(sig, () => { g.release(); process.exit(code); });
}
const today = todayET();
const adapter = makeBroker();
const baseUrl = brokerBaseUrl(adapter);
const mode = adapter.kind === "schwab" ? ">>> LIVE — Charles Schwab (real money) <<<" : "paper — Alpaca (test)";
console.log(`Broker: ${adapter.kind}  ${mode}`);
let marketOpen: boolean;
try {
  marketOpen = (await adapter.getClock()).isOpen;
} catch (e) {
  if (e instanceof SchwabAuthError) { notifier.message(e.message); await notifier.flush(); console.error(e.message); process.exit(2); }
  throw e;
}
const { reports, sics, marketCapUsd, betas, earnings } = await loadReportsAndMeta();
const runId = newRunId(today);
let out: Awaited<ReturnType<typeof planRun>>;
try {
  // Planning only reads the broker, so it also runs with the market closed (nothing is submitted then).
  out = await planRun({ adapter, reports, sics, marketCapUsd, betas, earnings, fills: readFills(FILLS_PATH), today, cfg, runId, clock: Date.now });
} catch (e) {
  if (e instanceof ReconcileError) {
    const msg = `trade:execute halted at reconcile — ${e.message}`;
    notifier.message(msg); await notifier.flush(); console.error(msg); process.exit(1);
  }
  throw e;
}
const plannedAtMs = Date.now();
writeLedger(LEDGER_PATH, out.ledger);

/** Print the allocation and post it (every run, whatever happens next). */
const sendAllocation = async (status: string) => {
  console.log(`\nAllocation — ${status}:`);
  for (const l of allocationLines(allocationFromRun(out, status).rows)) console.log(`  ${l}`);
  notifier.allocation(allocationFromRun(out, status));
  await notifier.flush();
};

for (const o of out.sized.orders) console.log(`  ${o.side} ${o.ticker} ${o.qty} sh ${o.type === "market" ? `@ market (~$${o.limitPrice})` : `@ limit $${o.limitPrice} ioc`} (${o.reason}${o.leg ? `, ${o.leg} leg` : ""})`);
if (!marketOpen) { await sendAllocation("market closed — nothing submitted"); console.log("Market is closed — nothing submitted (spec §9.5)."); process.exit(0); }
if (preview) { await sendAllocation(has(args, "--preview") ? "preview — nothing submitted" : "preview (PREVIEW_ONLY) — nothing submitted"); process.exit(0); }
if (out.sized.orders.length === 0) { writeRunRecord(RUNS_DIR, out.record); await sendAllocation("nothing to trade"); console.log("Nothing to trade."); process.exit(0); }
if (!has(args, "--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`Submit ${out.sized.orders.length} order(s) to ${adapter.kind}${adapter.kind === "schwab" ? " (LIVE)" : " (paper)"}? [y/N] `)).trim().toLowerCase(); rl.close();
  if (a !== "y") { await sendAllocation("declined — nothing submitted"); console.log("Aborted; nothing submitted."); process.exit(0); }
}
await sendAllocation(`submitting ${out.sized.orders.length} order(s)`);
// Submit cutoff (cfg.submitCutoffET, 15:50 ET): nothing is sent at or after it, even mid-run — never into the close.
// F-3: submit only on a fresh plan, under a lock that is still ours (a prompt left open can outlive both).
if (gate) {
  const refuse = async (msg: string) => { console.error(msg); notifier.message(msg); await notifier.flush(); process.exit(2); };
  if (manualPlanTooOld(plannedAtMs, Date.now())) await refuse(`trade:execute refused — the plan is ${Math.round((Date.now() - plannedAtMs) / 60_000)} min old (limit ${MANUAL_PLAN_MAX_AGE_MS / 60_000}). Nothing was sent; re-run trade:execute for a fresh plan.`);
  if (!gate.stillOurs()) await refuse(`trade:execute refused — the run lock (${CRON_LOCK_PATH}) is no longer this run's (it was reclaimed by another run). Nothing was sent.`);
}
const cutoffMs = etInstantOn(today, cfg.submitCutoffET);
const { fills, executed, aborted, skippedCash, rejected, skippedLegs, skippedCutoff } = await executeOrders({ adapter, sized: out.sized, ctx: { brokerKind: adapter.kind, configuredBaseUrl: baseUrl, locks: out.locks, today, nav: out.ledger.nav, cashUsd: out.ledger.cash, cfg, env: process.env, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 } }, runId, fillsPath: FILLS_PATH, cutoffMs });
out.record.fills = fills as unknown as Record<string, unknown>[];
out.record.orders = mergeExecution(out.record.orders, executed);
out.record.notes.push(...skippedCash.map((s) => `cash skipped: ${s.ticker} — ${s.detail}`), ...rejected.map((r) => `rejected: ${r.ticker} — ${r.detail}`), ...skippedLegs.map((l) => `leg skipped: ${l.ticker} — ${l.detail}`), ...skippedCutoff.map((c) => `cutoff skipped: ${c.ticker} — ${c.detail}`));
for (const s of skippedCash) console.warn(`  skipped (cash backstop): ${s.ticker} — ${s.detail}`);
for (const r of rejected) console.warn(`  REJECTED: ${r.ticker} — ${r.detail}`);
for (const l of skippedLegs) console.warn(`  market remainder skipped: ${l.ticker} — ${l.detail}`);
for (const c of skippedCutoff) console.warn(`  NOT SENT (past the ${cfg.submitCutoffET} ET submit cutoff): ${c.ticker}`);
if (rejected.length) notifier.message(`trade:execute: ${rejected.length} order(s) rejected (nothing placed for them) — ${rejected.map((r) => `${r.ticker}: ${r.detail}`).join("; ")}`);
if (skippedCutoff.length) notifier.message(`trade:execute: ${skippedCutoff.length} order(s) NOT sent — the ${cfg.submitCutoffET} ET submit cutoff passed — ${skippedCutoff.map((c) => c.ticker).join(", ")}`);
const path = writeRunRecord(RUNS_DIR, out.record);
console.log(`Submitted ${executed.length} of ${out.sized.orders.length} order(s); ${fills.length} fill(s) recorded to ${FILLS_PATH}. Run record ${path}. Run trade:reconcile before the next plan.`);

// Broker-truth cross-check (spec §4): the recorded fills must match what the broker actually did.
// Fills are already written, so this is a fail-loud alert, not a rollback — a critical discrepancy
// exits non-zero so the operator investigates before the next run.
// A rejected order never reached the broker's book — nothing to cross-check.
const brokerIdByCid = new Map(executed.filter((e) => e.status !== "rejected").map((e) => [e.clientOrderId, e.brokerId || undefined]));
let audit: ReturnType<typeof crossCheckBroker> | null = null;
let auditReadError = "";
try {
  audit = crossCheckBroker({
    expected: out.sized.orders.filter((o) => brokerIdByCid.has(o.clientOrderId)).map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side, brokerId: brokerIdByCid.get(o.clientOrderId) })),
    brokerOrders: await adapter.getOrders("all", `${today}T00:00:00Z`),
    fills,
  });
} catch (e) {
  auditReadError = e instanceof Error ? e.message : String(e);
}
if (audit) {
  for (const d of audit.discrepancies) console.error(`  [${d.severity.toUpperCase()}] ${d.code} ${d.ticker}${d.orderId ? ` (${d.orderId})` : ""} — ${d.detail}`);
  notifier.runSummary(summaryFromRun(out, "executed", fills, audit, skippedCutoff));
}
const stop = async (msg: string) => { notifier.message(msg); await notifier.flush(); console.error(msg); process.exit(1); };
if (aborted) await stop(abortAlert(aborted, "trade:execute"));
if (!audit) await stop(`trade:execute: the broker-truth check could not read the broker's orders (${auditReadError}). ${fills.length} fill(s) recorded; run record ${path}. Run \`npm run trade:audit -- --run ${runId}\` before the next run.`);
if (!audit!.ok) await stop(`Broker-truth check FAILED: ${audit!.critical} critical discrepancy(ies). Investigate before the next run.`);
const stillWorking = executed.filter((e) => e.brokerId && !TERMINAL_STATUSES.has(e.status as BrokerOrderStatus));
if (stillWorking.length) await stop(`trade:execute: ${stillWorking.length} order(s) still working at the broker after the cancel attempt — ${stillWorking.map((e) => `${e.brokerId} (${e.status}${e.cancelError ? `; cancel failed: ${e.cancelError}` : ""})`).join(", ")}. Check the broker before the next run.`);
console.log(`Broker-truth check ${audit!.warn ? `OK with ${audit!.warn} warning(s)` : "clean"}.`);
await notifier.flush();
