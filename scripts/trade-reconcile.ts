/** trade:reconcile — broker → ledger. Reads only. */
import { reconcile, writeLedger } from "../lib/trade/ledger";
import { makeBroker, readFills, FILLS_PATH, LEDGER_PATH } from "./_trade-common";
import { todayET } from "../lib/trade/clock";
const b = makeBroker();
const today = todayET();
const ledger = reconcile({ asOf: today, account: await b.getAccount(), positions: await b.getPositions(), fills: readFills(FILLS_PATH) });
writeLedger(LEDGER_PATH, ledger);
console.log(`Reconciled ${ledger.positions.length} position(s), NAV $${ledger.nav.toFixed(2)}, cash $${ledger.cash.toFixed(2)} → ${LEDGER_PATH}`);
