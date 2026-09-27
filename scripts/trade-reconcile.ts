/**
 * trade:reconcile — broker → ledger. Reads only, unless `--record-missing`.
 *
 * Also runs the lock-window orders check (every executed broker order must be in fills.jsonl). When
 * that halts — a manual trade in the account, a crash between submit and fill recording, a fill
 * after the poll window — `npm run trade:reconcile -- --record-missing` appends the missing fills
 * from broker truth (runId "manual"), printing each, then reconciles again.
 */
import { missingFills, reconcile, writeLedger, ReconcileError } from "../lib/trade/ledger";
import { appendFill } from "../lib/trade/fills";
import { indexOnOrBefore } from "../lib/trade/calendar";
import { resolveTradeConfig } from "../lib/trade/config";
import { makeBroker, readFills, has, shift, FILLS_PATH, LEDGER_PATH } from "./_trade-common";
import { todayET } from "../lib/trade/clock";

const args = process.argv.slice(2);
const cfg = resolveTradeConfig();
const b = makeBroker();
const today = todayET();
const calendar = (await b.getCalendar(shift(today, -30), today)).map((d) => d.date);
const lockWindowStart = calendar[Math.max(0, indexOnOrBefore(calendar, today) - (cfg.lockBusinessDays + 1))];
const brokerOrders = await b.getOrders("all", `${lockWindowStart}T00:00:00Z`);

if (has(args, "--record-missing")) {
  const missing = missingFills(brokerOrders, readFills(FILLS_PATH), lockWindowStart, "manual");
  for (const f of missing) {
    appendFill(FILLS_PATH, f);
    console.log(`recorded: ${f.side} ${f.qty} ${f.ticker} @ $${f.price} on ${f.tradingDate} (order ${f.orderId})`);
  }
  if (!missing.length) console.log("No missing fills — every executed broker order in the lock window is recorded.");
}

try {
  const ledger = reconcile({ asOf: today, account: await b.getAccount(), positions: await b.getPositions(), fills: readFills(FILLS_PATH), brokerOrders, lockWindowStart });
  writeLedger(LEDGER_PATH, ledger);
  console.log(`Reconciled ${ledger.positions.length} position(s), NAV $${ledger.nav.toFixed(2)}, cash $${ledger.cash.toFixed(2)} → ${LEDGER_PATH}`);
} catch (e) {
  if (!(e instanceof ReconcileError)) throw e;
  console.error(`RECONCILE HALT — ${e.message}`);
  console.error("If these are real executions (e.g. a manual trade), record them from broker truth: npm run trade:reconcile -- --record-missing");
  process.exitCode = 1;
}
