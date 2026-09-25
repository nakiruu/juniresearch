/** trade:execute -- --paper [--yes]  — plan, confirm, submit to Alpaca PAPER through the guards, record fills. */
import { createInterface } from "node:readline/promises";
import { resolveTradeConfig } from "../lib/trade/config";
import { planRun, executeOrders, mergeExecution } from "../lib/trade/pipeline";
import { crossCheckBroker } from "../lib/trade/audit";
import { newRunId, writeRunRecord } from "../lib/trade/run-record";
import { writeLedger } from "../lib/trade/ledger";
import { PAPER_HOST } from "../lib/broker/guards";
import { requireAlpaca } from "./_env";
import { has, loadReportsAndMeta, makeAlpaca, readFills, FILLS_PATH, LEDGER_PATH, RUNS_DIR } from "./_trade-common";

const args = process.argv.slice(2);
if (!has(args, "--paper")) { console.error("trade:execute requires an explicit --paper flag (there is no live mode)."); process.exit(2); }
if (process.env.TRADE_DISABLED === "1") { console.error("TRADE_DISABLED=1 — refusing to submit."); process.exit(2); }
const { baseUrl } = requireAlpaca();
if (!baseUrl.includes(PAPER_HOST)) { console.error(`APCA_API_BASE_URL is not the paper endpoint: ${baseUrl}`); process.exit(2); }
const cfg = resolveTradeConfig();
const today = new Date().toISOString().slice(0, 10);
const adapter = makeAlpaca();
if (!(await adapter.getClock()).isOpen) { console.log("Market is closed — nothing submitted (spec §9.5)."); process.exit(0); }
const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
const runId = newRunId(today);
const out = await planRun({ adapter, reports, sics, marketCapUsd, fills: readFills(FILLS_PATH), today, cfg, runId });
writeLedger(LEDGER_PATH, out.ledger);
for (const o of out.sized.orders) console.log(`  ${o.side} ${o.ticker} ${o.qty} sh @ limit $${o.limitPrice} ioc (${o.reason})`);
if (out.sized.orders.length === 0) { writeRunRecord(RUNS_DIR, out.record); console.log("Nothing to trade."); process.exit(0); }
if (!has(args, "--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`Submit ${out.sized.orders.length} order(s) to Alpaca PAPER? [y/N] `)).trim().toLowerCase(); rl.close();
  if (a !== "y") { console.log("Aborted; nothing submitted."); process.exit(0); }
}
const { fills, executed } = await executeOrders({ adapter, sized: out.sized, ctx: { brokerKind: "alpaca-paper", configuredBaseUrl: baseUrl, locks: out.locks, today, nav: out.ledger.nav, cfg, env: process.env, counters: { orders: 0, notionalUsd: 0 } }, runId, fillsPath: FILLS_PATH });
out.record.fills = fills as unknown as Record<string, unknown>[];
out.record.orders = mergeExecution(out.record.orders, executed);
const path = writeRunRecord(RUNS_DIR, out.record);
console.log(`Submitted ${out.sized.orders.length} order(s); ${fills.length} fill(s) recorded to ${FILLS_PATH}. Run record ${path}. Run trade:reconcile before the next plan.`);

// Broker-truth cross-check (spec §4): the recorded fills must match what Alpaca actually did.
// Fills are already written, so this is a fail-loud alert, not a rollback — a critical discrepancy
// exits non-zero so the operator investigates before the next run.
const audit = crossCheckBroker({
  expected: out.sized.orders.map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side })),
  brokerOrders: await adapter.getOrders("all", `${today}T00:00:00Z`),
  fills,
});
for (const d of audit.discrepancies) console.error(`  [${d.severity.toUpperCase()}] ${d.code} ${d.ticker}${d.orderId ? ` (${d.orderId})` : ""} — ${d.detail}`);
if (!audit.ok) { console.error(`Broker-truth check FAILED: ${audit.critical} critical discrepancy(ies). Investigate before the next run.`); process.exit(1); }
console.log(`Broker-truth check ${audit.warn ? `OK with ${audit.warn} warning(s)` : "clean"}.`);
