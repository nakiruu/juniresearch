/**
 * trade:review -- --since <YYYY-MM-DD> — the weekly-review digest (spec §6). `buildReview` is pure
 * over already-loaded data so it is unit-tested without touching the filesystem; `printReview`
 * does the one-time read of data/trade/{runs/*.json, fills.jsonl, cron.log} and prints the digest.
 *
 * Checks (spec §6): turnover per run within band; cash within [cashFloor, cashCeiling]; every
 * deferral/bar carried a correct unlock date; broker reconciled every run; zero orders in a lock
 * window (broker order history vs fills.jsonl); cap-bind frequency per name.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTradeConfig, type TradeConfig } from "../lib/trade/config";
import { flag, readFills, CRON_LOG_PATH, FILLS_PATH, RUNS_DIR } from "./_trade-common";

// ---- input shapes --------------------------------------------------------------------------
// Loose/optional on purpose: a real RunRecord (lib/trade/run-record.ts, read back as JSON) satisfies
// these structurally, and so does a minimal test fixture — buildReview only reads the fields a given
// part of the digest actually needs, and tolerates every other field being absent.
export interface ReviewOrder { ticker: string; side: "buy" | "sell"; capBound?: boolean; tier?: number }
export interface ReviewSkip { ticker: string; code: string; unlockOn?: string }
export interface ReviewRun {
  runId?: string;
  today?: string; // real RunRecord field name
  date?: string;  // accepted alias (a review fixture, or any other date-bearing summary row)
  plan?: { plannedCash?: number; trades?: { deltaWeight: number }[]; skipped?: ReviewSkip[] };
  orders?: ReviewOrder[];
}
export interface ReviewFill { ticker: string; side: "buy" | "sell"; tradingDate: string }
/** An order dated independently of its owning run — e.g. a richer feed (real broker order history)
 * a future caller could pass instead of/alongside each run's own embedded `orders`. */
export interface DatedOrder extends ReviewOrder { date: string }

export interface ReviewDigest {
  turnoverByRun: { date: string; runId?: string; turnoverFrac: number | null }[];
  cashRange: { min: number; max: number } | null;
  deferralsWithUnlock: { date: string; ticker: string; code: string; unlockOn: string }[];
  reconciledEveryRun: boolean;
  lockViolations: { date: string; ticker: string; side: "buy" | "sell"; lockedUntil: string }[];
  capBindByTicker: Record<string, { bound: number; total: number }>;
}

const runDate = (r: ReviewRun): string => r.today ?? r.date ?? "";

/**
 * Mon–Fri business-day advance — a documented approximation (no NYSE holiday calendar is available
 * to a pure reviewer function; same spirit as _trade-common.ts's weekdayCalendar). Good enough for a
 * monitoring digest; the real lock enforcement (lib/trade/locks.ts + calendar.ts) uses the true
 * trading calendar and is what actually gates a submit.
 */
function addBizDays(date: string, n: number): string {
  let d = new Date(date + "T00:00:00Z");
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * buildReview(runs, fills, orders, cfg) — the digest, pure over its inputs (Task 7 brief). `orders`
 * is unioned with every run's own `.orders` (each dated by that run's day) rather than required to
 * carry the whole picture itself, so a caller can pass just the run records (as printReview does)
 * or supplement them with an independently-sourced order feed.
 */
export function buildReview(
  runs: ReviewRun[],
  fills: ReviewFill[],
  orders: DatedOrder[],
  cfg: Pick<TradeConfig, "lockBusinessDays">,
): ReviewDigest {
  const turnoverByRun = runs.map((r) => ({
    date: runDate(r),
    runId: r.runId,
    turnoverFrac: r.plan?.trades ? r.plan.trades.reduce((a, t) => a + Math.abs(t.deltaWeight), 0) : null,
  }));

  const cashValues = runs.map((r) => r.plan?.plannedCash).filter((x): x is number => typeof x === "number");
  const cashRange = cashValues.length ? { min: Math.min(...cashValues), max: Math.max(...cashValues) } : null;

  const deferralsWithUnlock = runs.flatMap((r) =>
    (r.plan?.skipped ?? [])
      .filter((s): s is ReviewSkip & { unlockOn: string } => !!s.unlockOn)
      .map((s) => ({ date: runDate(r), ticker: s.ticker, code: s.code, unlockOn: s.unlockOn })),
  );

  const datedOrders: DatedOrder[] = [...orders, ...runs.flatMap((r) => (r.orders ?? []).map((o) => ({ ...o, date: runDate(r) })))];

  // A lightweight fills-vs-orders cross-check: every recorded fill should trace back to an order the
  // system actually intended to submit somewhere in the window. The strict broker-vs-ledger reconcile
  // (lib/trade/ledger.ts) already runs inside planRun on every cron invocation and HALTS (no run record
  // written at all) on a real mismatch — this digest can only see what's left over: any fill.jsonl entry
  // an order never accounts for.
  const reconciledEveryRun = fills.every((f) => datedOrders.some((o) => o.ticker === f.ticker && o.side === f.side));

  // Rebuild the two lock tables from fills (mirrors lib/trade/locks.ts's rule): a BUY fill locks SELLs,
  // a SELL fill locks BUYs, for lockBusinessDays, latest fill per side wins.
  const buyLockUntil: Record<string, string> = {};
  const sellLockUntil: Record<string, string> = {};
  for (const f of fills) {
    const until = addBizDays(f.tradingDate, cfg.lockBusinessDays);
    const table = f.side === "buy" ? sellLockUntil : buyLockUntil;
    if (!table[f.ticker] || until > table[f.ticker]) table[f.ticker] = until;
  }
  const lockViolations = datedOrders.flatMap((o) => {
    const table = o.side === "buy" ? buyLockUntil : sellLockUntil;
    const until = table[o.ticker];
    return until && o.date < until ? [{ date: o.date, ticker: o.ticker, side: o.side, lockedUntil: until }] : [];
  });

  const capBindByTicker: Record<string, { bound: number; total: number }> = {};
  for (const o of datedOrders) {
    const row = capBindByTicker[o.ticker] ?? (capBindByTicker[o.ticker] = { bound: 0, total: 0 });
    row.total++;
    if (o.capBound) row.bound++;
  }

  return { turnoverByRun, cashRange, deferralsWithUnlock, reconciledEveryRun, lockViolations, capBindByTicker };
}

export async function printReview(since: string): Promise<void> {
  const runs: ReviewRun[] = existsSync(RUNS_DIR)
    ? readdirSync(RUNS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as ReviewRun)
        .filter((r) => runDate(r) >= since)
    : [];
  const fills = readFills(FILLS_PATH).filter((f) => f.tradingDate >= since);
  const logLines = existsSync(CRON_LOG_PATH)
    ? readFileSync(CRON_LOG_PATH, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && l.slice(0, 10) >= since)
    : [];
  const cfg = resolveTradeConfig();
  const d = buildReview(runs, fills, [], cfg);

  console.log(`Weekly review since ${since} — ${runs.length} run(s), ${fills.length} fill(s), ${logLines.length} log line(s)`);
  console.log(`Cash range: ${d.cashRange ? `${(d.cashRange.min * 100).toFixed(1)}%–${(d.cashRange.max * 100).toFixed(1)}%` : "n/a"} (band [${(cfg.cashFloor * 100).toFixed(0)}%, ${(cfg.cashCeiling * 100).toFixed(0)}%])`);
  console.log("Turnover by run:");
  for (const t of d.turnoverByRun) console.log(`  ${t.date}${t.runId ? ` ${t.runId}` : ""} — ${t.turnoverFrac != null ? `${(t.turnoverFrac * 100).toFixed(1)}%` : "n/a"} of NAV (cap ${(cfg.maxRunTurnoverFrac * 100).toFixed(0)}%)`);
  console.log(`Deferrals carrying an unlock date: ${d.deferralsWithUnlock.length}`);
  for (const x of d.deferralsWithUnlock) console.log(`  ${x.date} ${x.ticker} ${x.code} → unlocks ${x.unlockOn}`);
  console.log(`Reconciled every run: ${d.reconciledEveryRun ? "yes" : "NO — an orphan fill has no matching order; investigate"}`);
  console.log(`Lock violations: ${d.lockViolations.length}`);
  for (const v of d.lockViolations) console.log(`  ${v.date} ${v.side.toUpperCase()} ${v.ticker} — locked until ${v.lockedUntil}`);
  console.log("Cap-bind by ticker:");
  for (const [ticker, row] of Object.entries(d.capBindByTicker)) console.log(`  ${ticker}: ${row.bound}/${row.total} run(s) cap-bound (${row.total ? ((row.bound / row.total) * 100).toFixed(0) : "0"}%)`);
  const haltLines = logLines.filter((l) => /halted|reason=/.test(l));
  if (haltLines.length) {
    console.log(`Halt/breaker lines in cron.log since ${since}:`);
    for (const l of haltLines) console.log(`  ${l}`);
  }
}

const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const since = flag(args, "--since") ?? "1900-01-01";
  await printReview(since);
}
