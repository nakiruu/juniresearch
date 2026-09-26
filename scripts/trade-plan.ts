/** trade:plan — compute and record the plan. NEVER submits. `--broker fake` (default) | `alpaca` (read-only). */
import { resolveTradeConfig } from "../lib/trade/config";
import { planRun } from "../lib/trade/pipeline";
import { newRunId, writeRunRecord } from "../lib/trade/run-record";
import { writeLedger } from "../lib/trade/ledger";
import { flag, has, loadReportsAndMeta, makeFakeBroker, makeAlpaca, readFills, FILLS_PATH, LEDGER_PATH, RUNS_DIR } from "./_trade-common";

const args = process.argv.slice(2);
const today = flag(args, "--date") ?? new Date().toISOString().slice(0, 10);
const broker = flag(args, "--broker") ?? "fake";
const cfg = resolveTradeConfig();
const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
const tickers = reports.map((r) => r.meta.ticker);
const fills = readFills(FILLS_PATH);
const adapter = broker === "alpaca" ? makeAlpaca() : await makeFakeBroker(tickers, today);
const runId = newRunId(today);
const out = await planRun({ adapter, reports, sics, marketCapUsd, fills, today, cfg, runId });
writeLedger(LEDGER_PATH, out.ledger);
const path = writeRunRecord(RUNS_DIR, out.record);
console.log(`Plan ${runId} · broker ${adapter.kind} · marks ${out.markDate} (${cfg.markMode}) · NAV $${out.ledger.nav.toFixed(0)} · invested→ ${(out.plan.plannedInvested * 100).toFixed(1)}% · cash→ ${(out.plan.plannedCash * 100).toFixed(1)}%`);
for (const t of out.plan.trades) console.log(`  ${t.side.toUpperCase().padEnd(4)} ${t.ticker.padEnd(6)} ${t.reason.padEnd(5)} ${(t.currentWeight * 100).toFixed(1).padStart(5)}% → ${(t.targetWeight * 100).toFixed(1).padStart(5)}%`);
for (const o of out.sized.orders) console.log(`  order ${o.side} ${o.ticker} ${o.qty} sh @ limit $${o.limitPrice} ioc (tier ${o.tier}${o.capBound ? ", cap-bound" : ""}) ~cost $${o.estCostUsd.toFixed(2)} (${o.bucket})`);
for (const h of out.sized.skippedHalt) console.log(`  halt  ${h.ticker.padEnd(6)} ${h.reason}`);
for (const s of out.plan.skipped.filter((s) => s.code !== "INELIGIBLE")) console.log(`  skip  ${s.ticker.padEnd(6)} ${s.code}${s.unlockOn ? ` until ${s.unlockOn}` : ""} — ${s.reasons.join("; ")}`);
console.log(`Recorded ${path}. No orders were submitted.`);
if (has(args, "--simulate-fills") && adapter.kind === "fake") {
  const { executeOrders } = await import("../lib/trade/pipeline");
  const n = (await executeOrders({ adapter, sized: out.sized, ctx: { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today, nav: out.ledger.nav, cfg, env: process.env, counters: { orders: 0, notionalUsd: 0 } }, runId, fillsPath: FILLS_PATH, pollMs: 0 })).fills.length;
  const acct = await adapter.getAccount();
  writeLedger(LEDGER_PATH, { asOf: today, nav: acct.equity, cash: acct.cash, positions: (await adapter.getPositions()).map((p) => ({ ticker: p.symbol, qty: p.qty, marketValue: p.marketValue, avgCost: p.avgEntryPrice })) });
  console.log(`Simulated ${n} fill(s) into the fake book (Phase 0 only).`);
}
