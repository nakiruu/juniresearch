/**
 * trade:audit -- [--run <runId>] [--date <YYYY-MM-DD>]
 * Broker-truth cross-check for a run (read-only, spec 2026-09-25-trade-broker-truth-audit).
 * Fetches the day's broker orders (per BROKER env) and compares them against fills.jsonl and the run
 * record's expected orders. Exits 1 on any CRITICAL discrepancy, 0 otherwise (warnings print but pass).
 * Writes nothing.
 */
import { crossCheckBroker } from "../lib/trade/audit";
import { makeBroker, readFills, readRunRecord, latestRunRecord, FILLS_PATH, flag } from "./_trade-common";

const args = process.argv.slice(2);

const runId = flag(args, "--run");
const rec = runId ? readRunRecord(runId) : latestRunRecord();
if (!rec) { console.error("No run record found under data/trade/runs — nothing to audit."); process.exit(2); }

const orders = rec.orders as { clientOrderId: string; ticker: string; side: "buy" | "sell" }[];
const expected = orders.map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side }));
const fills = readFills(FILLS_PATH).filter((f) => f.runId === rec.runId);
const brokerOrders = await makeBroker().getOrders("all", `${rec.today}T00:00:00Z`);

const r = crossCheckBroker({ expected, brokerOrders, fills });
console.log(`Audit ${rec.runId} (${rec.today}): expected ${r.checked.expected}, broker-matched ${r.checked.brokerMatched}, fills ${r.checked.fills}`);
for (const d of r.discrepancies) {
  console.log(`  [${d.severity.toUpperCase()}] ${d.code} ${d.ticker}${d.orderId ? ` (${d.orderId})` : ""} — ${d.detail}`);
}
if (r.ok) console.log(r.warn ? `OK with ${r.warn} warning(s).` : "OK — broker matches the local record exactly.");
else console.error(`FAIL — ${r.critical} critical discrepancy(ies).`);
// Set exitCode and let the loop drain rather than process.exit() — an abrupt exit races the tsx
// loader / keep-alive socket teardown on Windows (libuv async.c assertion). trade:reconcile drains
// the same way after its Alpaca reads.
process.exitCode = r.ok ? 0 : 1;
