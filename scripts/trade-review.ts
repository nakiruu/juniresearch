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
export interface ReviewOrder {
  ticker: string; side: "buy" | "sell"; capBound?: boolean; tier?: number;
  // Execution diagnostics (Phase 4) — absent on older run records, which executionStats simply skips.
  qty?: number; filledQty?: number | null; bucket?: string; diag?: { tauWanted?: number };
  anchorAtMs?: number; submitStartAt?: string | null; submitAckAt?: string | null; terminalAt?: string | null;
}
export interface ReviewSkip { ticker: string; code: string; unlockOn?: string }
export interface ReviewRun {
  runId?: string;
  broker?: string;
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
 * Which fills matter for reconstructing lock state as of `since` — not just fills dated `>= since`,
 * but back far enough that a fill's own lock window (tradingDate .. tradingDate + lockBusinessDays)
 * can still reach *into* the reviewed window. Fix-round-1: printReview previously filtered fills to
 * `>= since` before calling buildReview, which silently dropped a fill dated just before `since`
 * whose lock was still active — at the review's weekly cadence (~= the default lockBusinessDays),
 * that is the boundary every routine run sits on, hiding exactly the violation the tool exists to
 * catch. Extracted as its own pure function (not inlined in printReview) so the boundary is
 * unit-testable without touching the filesystem.
 */
export function fillsNeededForLockState(fills: ReviewFill[], since: string, lockBusinessDays: number): ReviewFill[] {
  return fills.filter((f) => addBizDays(f.tradingDate, lockBusinessDays) > since);
}

/**
 * buildReview(runs, fills, orders, cfg, since?) — the digest, pure over its inputs (Task 7 brief).
 * `orders` is unioned with every run's own `.orders` (each dated by that run's day) rather than
 * required to carry the whole picture itself, so a caller can pass just the run records (as
 * printReview does) or supplement them with an independently-sourced order feed.
 *
 * `since` (fix round 2): `fills` is expected to be the WIDENED lock-state set (see
 * `fillsNeededForLockState`) when the caller has one — it reaches back before the reviewed window
 * so lock-violation detection can see a still-active lock from just before `since` (round 1's fix).
 * But `datedOrders` is built from `runs`, which the caller keeps scoped to `>= since` (round 1 left
 * that unchanged). Round 1 fed the same widened `fills` straight into the reconciled-vs-orders
 * cross-check too, so a pre-window fill pulled in only for lock-state — whose real matching order
 * sits in an excluded pre-window run — read as an unexplained orphan: a false "NO" on every
 * boundary week. `since`, when given, scopes *only* that reconciliation check back down to
 * `tradingDate >= since` (the same window `runs` is already in); lock-table construction and
 * `lockViolations` keep using the full, possibly-widened `fills` as before — only the
 * reconciliation (and any other reviewed-window aggregate) is window-scoped. Omitting `since`
 * preserves the original behavior (check every provided fill) for callers/tests with no window
 * concept at all.
 */
export function buildReview(
  runs: ReviewRun[],
  fills: ReviewFill[],
  orders: DatedOrder[],
  cfg: Pick<TradeConfig, "lockBusinessDays">,
  since?: string,
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
  // an order never accounts for. Window-scoped to `>= since` (when given) so a pre-window fill pulled
  // in only to widen the lock-state window isn't judged against the `>= since`-only `datedOrders` it
  // was never expected to appear in (fix round 2) — no `since` means no window, so every fill counts.
  const reconciledFills = since != null ? fills.filter((f) => f.tradingDate >= since) : fills;
  const reconciledEveryRun = reconciledFills.every((f) => datedOrders.some((o) => o.ticker === f.ticker && o.side === f.side));

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

// ---- execution quality (spec #9/#10) ---------------------------------------------------------

export interface FillRatio { orders: number; filledFrac: number | null } // Σ filledQty / Σ qty
export interface Pctl { n: number; p50: number | null; p90: number | null; p95: number | null }
export interface BrokerExecStats {
  capBound: FillRatio; notCapBound: FillRatio;
  /** tauWanted / τ_max per liquidity bucket: > 1 means the spread wanted more slippage than the cap allowed. */
  tauPressure: Record<string, Pctl>;
  /** Milliseconds. */
  latency: { anchorToSubmit: Pctl; submitToAck: Pctl; submitToTerminal: Pctl };
}

function pctl(xs: number[]): Pctl {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null);
  return { n: s.length, p50: at(0.5), p90: at(0.9), p95: at(0.95) };
}
function ratio(os: ReviewOrder[]): FillRatio {
  const withQty = os.filter((o) => typeof o.qty === "number" && o.qty > 0 && typeof o.filledQty === "number");
  const q = withQty.reduce((a, o) => a + o.qty!, 0);
  return { orders: withQty.length, filledFrac: q > 0 ? withQty.reduce((a, o) => a + (o.filledQty as number), 0) / q : null };
}
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * Per broker (paper and live are NEVER mixed — IEX-paper fills say nothing about Schwab), how orders
 * filled when the τ cap bound vs when it didn't, how hard spreads pushed against τ_max per bucket, and
 * decision→fill latency. This is the evidence the "raise τ_max?" decision waits on (plan L.1).
 */
export function executionStats(runs: ReviewRun[], cfg: Pick<TradeConfig, "limitTolMax">): Record<string, BrokerExecStats> {
  const byBroker = new Map<string, ReviewOrder[]>();
  for (const r of runs) {
    const k = r.broker ?? "unknown";
    byBroker.set(k, [...(byBroker.get(k) ?? []), ...(r.orders ?? [])]);
  }
  const out: Record<string, BrokerExecStats> = {};
  for (const [broker, os] of byBroker) {
    const tauPressure: Record<string, Pctl> = {};
    for (const b of Object.keys(cfg.limitTolMax)) {
      const cap = cfg.limitTolMax[b as keyof typeof cfg.limitTolMax];
      tauPressure[b] = pctl(os.filter((o) => o.bucket === b && typeof o.diag?.tauWanted === "number").map((o) => o.diag!.tauWanted! / cap));
    }
    out[broker] = {
      capBound: ratio(os.filter((o) => o.capBound === true)),
      notCapBound: ratio(os.filter((o) => o.capBound === false)),
      tauPressure,
      latency: {
        anchorToSubmit: pctl(os.map((o) => ms(o.submitStartAt) - (o.anchorAtMs ?? NaN))),
        submitToAck: pctl(os.map((o) => ms(o.submitAckAt) - ms(o.submitStartAt))),
        submitToTerminal: pctl(os.map((o) => ms(o.terminalAt) - ms(o.submitStartAt))),
      },
    };
  }
  return out;
}

export async function printReview(since: string): Promise<void> {
  const runs: ReviewRun[] = existsSync(RUNS_DIR)
    ? readdirSync(RUNS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as ReviewRun)
        .filter((r) => runDate(r) >= since)
    : [];
  const allFills = readFills(FILLS_PATH);
  const displayFills = allFills.filter((f) => f.tradingDate >= since); // for the printed summary count only
  const logLines = existsSync(CRON_LOG_PATH)
    ? readFileSync(CRON_LOG_PATH, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && l.slice(0, 10) >= since)
    : [];
  const cfg = resolveTradeConfig();
  // The --since filter applies to what's displayed/aggregated (runs, log lines, the fill count
  // above) — NOT to the fills buildReview uses to reconstruct lock state, which need the wider
  // fillsNeededForLockState window so a still-active lock from just before `since` isn't invisible.
  const lockFills = fillsNeededForLockState(allFills, since, cfg.lockBusinessDays);
  // `since` scopes reconciledEveryRun back down to the window (fix round 2) — lockFills stays
  // widened for lock-table construction/lockViolations, which is exactly what it's for.
  const d = buildReview(runs, lockFills, [], cfg, since);

  console.log(`Weekly review since ${since} — ${runs.length} run(s), ${displayFills.length} fill(s), ${logLines.length} log line(s)`);
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
  const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);
  const p = (x: Pctl, unit: (v: number) => string) => (x.n ? `p50 ${unit(x.p50!)} · p90 ${unit(x.p90!)} · p95 ${unit(x.p95!)} (n=${x.n})` : "n/a");
  for (const [broker, s] of Object.entries(executionStats(runs, cfg))) {
    console.log(`Execution quality — ${broker}:`);
    console.log(`  fill ratio: cap-bound ${pct(s.capBound.filledFrac)} (${s.capBound.orders} orders) vs not ${pct(s.notCapBound.filledFrac)} (${s.notCapBound.orders})`);
    for (const [b, x] of Object.entries(s.tauPressure)) if (x.n) console.log(`  τ wanted / τ_max, ${b}: ${p(x, (v) => v.toFixed(2))}`);
    const sec = (v: number) => `${(v / 1000).toFixed(1)}s`;
    console.log(`  latency anchor→submit: ${p(s.latency.anchorToSubmit, sec)}; submit→ack: ${p(s.latency.submitToAck, sec)}; submit→terminal: ${p(s.latency.submitToTerminal, sec)}`);
  }
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
