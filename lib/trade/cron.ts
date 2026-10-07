/**
 * cron.ts — the one function the scheduler runs (spec §3, Phase 2 Task 6). Reuses the pipeline
 * (planRun + executeOrders) unchanged; this file adds only the run wrapper around it: kill-switch,
 * clock-check, an exclusive run-lock, the consecutive-halt / reconcile / turnover breakers, the
 * run-record, a one-line run log, and halt-only notify. No plan/size/execute logic lives here.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Report } from "../report.schema";
import type { BrokerAdapter } from "../broker/adapter";
import { TERMINAL_STATUSES, type BrokerOrderStatus } from "../broker/adapter";
import type { GuardContext } from "../broker/guards";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import type { LastEarnings } from "./earnings";
import type { Fill } from "./fills";
import { planRun, executeOrders, mergeExecution, type PlanRunOutput, type SubmitAbort } from "./pipeline";
import { ReconcileError } from "./ledger";
import { SchwabAuthError } from "../broker/schwab-auth";
import { turnoverBreaker, clipToTurnover, dayTurnoverUsd, readHaltState, bumpHalt, clearHalt, haltBlocked, holdLock, DEFAULT_LOCK_STALE_MS } from "./breakers";
import { crossCheckBroker } from "./audit";
import { allocationFromRun, summaryFromRun, type AllocationInput, type RunSummaryInput } from "./notify";
import { writeRunRecord } from "./run-record";
import { currentSlot, etInstantOn, etMinutesOfDay, hhmmToMinutes } from "./clock";
import { refreshTokenHealth } from "../broker/schwab-auth";
import { maybeWarnAuth } from "./auth-health";
import { nextSlotRunAtET } from "./clock";
import type { DeskRating } from "../synth/desk.schema";
import { advanceRelabels, confirmedRelabels, readRelabelState, writeRelabelState } from "./relabel";

export type CronStatus = "disabled" | "late" | "closed" | "locked" | "halted" | "preview" | "noop" | "executed";

export interface CronDeps {
  adapter: BrokerAdapter;
  cfg: TradeConfig;
  today: TradingDay;
  /** Execution-only freshness gate, forwarded to planRun's computeLimit; never feeds the decision path. Injected (not Date.now()) so cron stays pure/testable. */
  nowMs: number;
  runId: string;
  /** Forwarded into the GuardContext built after planRun, for the paper-endpoint guard (mirrors trade-execute.ts). Irrelevant for a "fake" adapter. */
  configuredBaseUrl: string;
  /** relabelState: the advisory re-label streaks (relabel.ts); absent → candidates are recorded but never confirmed or posted. */
  paths: { lock: string; haltState: string; log: string; fills: string; runs: string; authWarn?: string; relabelState?: string };
  /** Schwab only: the refresh token's issue time (epoch ms, undefined if unknown) for the proactive re-auth notice. */
  refreshObtainedAt?: () => number | undefined;
  /** betas: optional (absent → the SIC proxy) — prices a held bear breach's market part (breach.ts). earnings: optional
   *  (absent → the stale-on-bad-news entry gate bars nothing). deskRating: optional (absent → no re-label check). */
  loadInputs: () => Promise<{ reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null>; betas?: Record<string, number | null>; earnings?: Record<string, LastEarnings>; deskRating?: DeskRating; fills: Fill[] }>;
  notify: (msg: string) => void;
  /** Optional rich run summary sink (orders/fills/goal book/audit) — called on executed and noop runs. Injected like notify so cron stays pure and testable; absent → nothing extra happens. */
  notifySummary?: (s: RunSummaryInput) => void;
  /** Caller passes process.env.TRADE_DISABLED === "1" — cron.ts itself never reads process.env. */
  disabled: boolean;
  /**
   * Forwarded verbatim into the GuardContext built for step 8 (mirrors trade-execute.ts's
   * `env: process.env`). This is the guard-level, per-submit kill-switch re-check
   * (assertOrderAllowed throws when env.TRADE_DISABLED === "1") — a backstop independent of the
   * step-1 `disabled` read, so it must carry the real environment, not an empty stand-in.
   */
  env: NodeJS.ProcessEnv;
  /**
   * Wall clock for per-ticker market-data capture times (latency/freshness) and the submit loop
   * (timestamps, the submit cutoff). Default: frozen at nowMs for capture; the submit loop then runs on
   * nowMs + real elapsed time instead — a clock frozen at nowMs would never reach the cutoff.
   */
  clock?: () => number;
  /** Lookup schedule for an order submit with an unknown outcome (tests pass zeros). */
  resolveDelaysMs?: readonly number[];
  /** Fill-poll interval for executeOrders (tests pass 0); unset → 1 s. */
  pollMs?: number;
  /**
   * PREVIEW_ONLY: plan, post the allocation, and stop — no breakers, no submit, no run record, halt
   * counter untouched. Every read-side check before planning (kill switch, window, clock, lock,
   * consecutive halts, reconcile) still runs.
   */
  previewOnly?: boolean;
  /**
   * Step 6's turnover breaker (per-run / daily caps). Production callers pass isTurnoverBreakerOn(env),
   * which is OFF unless TURNOVER_BREAKER is set; left undefined (tests, direct callers) it stays ON.
   */
  turnoverBreaker?: boolean;
  /** Sink for the allocation post (Discord); absent → log only. */
  notifyAllocation?: (a: AllocationInput) => void;
  /** Manual run (`trade:cron --now`): skip the fire-window check. The market-clock check still applies. */
  ignoreWindow?: boolean;
}

export interface CronResult { status: CronStatus; reason?: string; orders?: number; fills?: number }

interface LogFields { orders?: number; notionalUsd?: number; cashFrac?: number; capBound?: number; haltSkip?: number; reason?: string }

function logLine(today: string, runId: string, status: CronStatus, fields: LogFields = {}): string {
  const parts = [today, runId, status];
  if (fields.orders != null) parts.push(`orders=${fields.orders}`);
  if (fields.notionalUsd != null) parts.push(`notional=$${fields.notionalUsd.toFixed(2)}`);
  if (fields.cashFrac != null) parts.push(`cash=${(fields.cashFrac * 100).toFixed(1)}%`);
  if (fields.capBound != null) parts.push(`capBound=${fields.capBound}`);
  if (fields.haltSkip != null) parts.push(`haltSkip=${fields.haltSkip}`);
  if (fields.reason) parts.push(`reason=${fields.reason}`);
  return parts.join(" ");
}

function appendLog(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line + "\n");
}

/** #orders, total submitted notional, cash % of NAV, and how many orders were capBound — the log/notify summary fields spec §3 step 8 asks for. */
function summaryFields(out: PlanRunOutput): LogFields {
  const notionalUsd = out.sized.orders.reduce((a, o) => a + Math.abs(o.qty * o.limitPrice), 0);
  const cashFrac = out.ledger.nav > 0 ? out.ledger.cash / out.ledger.nav : 0;
  const capBound = out.sized.orders.filter((o) => o.capBound).length;
  return { orders: out.sized.orders.length, notionalUsd, cashFrac, capBound };
}

/** The halt alert for a run that stopped submitting (executeOrders' `aborted`). Shared with trade:execute. */
export function abortAlert(a: SubmitAbort, source: string): string {
  switch (a.reason) {
    case "submit-unknown":
      return `${source} halted: order submit for ${a.ticker} has an UNKNOWN outcome (${a.detail}). Check the broker's order history; if it executed, run \`npm run trade:reconcile -- --record-missing\`, then clear the halt state to resume.`;
    case "poll-unavailable":
      return `${source} halted: lost track of the ${a.ticker} order — the broker's order list could not be read (${a.detail}). It may still be working or may have filled. Remaining orders were NOT sent. Check the broker's order history; if it executed, run \`npm run trade:reconcile -- --record-missing\`, then clear the halt state to resume.`;
    case "guard":
      return `${source} halted: a guard refused ${a.ticker} mid-run (${a.detail}). Nothing was placed for it; remaining orders were NOT sent.`;
  }
}

export async function runCron(deps: CronDeps): Promise<CronResult> {
  const { adapter, cfg, today, nowMs, runId, configuredBaseUrl, paths, loadInputs, notify, disabled, env } = deps;

  // 1. Kill switch.
  if (disabled) {
    appendLog(paths.log, logLine(today, runId, "disabled"));
    return { status: "disabled" };
  }

  // 1a. Proactive re-auth notice (Schwab): warn BEFORE the weekly refresh token dies instead of only
  // after a run fails. Deduplicated per ET day; never blocks or fails the run.
  if (deps.refreshObtainedAt && paths.authWarn) {
    try {
      const nextRunMs = nextSlotRunAtET(nowMs, cfg.cronTimesET);
      const health = refreshTokenHealth(deps.refreshObtainedAt(), nowMs, nextRunMs, { lifetimeMs: cfg.schwabRefreshLifetimeDays * 86_400_000, warnHours: cfg.schwabAuthWarnHours });
      maybeWarnAuth(health, nowMs, nextRunMs, paths.authWarn, notify);
    } catch { /* a notice must never fail a run */ }
  }

  // 1b. Fire window. A scheduled run that starts more than maxLateMin after cronTimeET (a missed
  // trigger fired late, a catch-up after a restart) trades at a worse, unplanned time of day — skip it;
  // the next scheduled slot runs normally. Checked before any broker call. With the 15:10 slot the
  // window ends 15:30, and the submit cutoff (step 8) still bounds a run that starts inside it.
  // Early-close days (13:00 ET) need no special case: at 15:10 the broker clock (step 2) reads closed,
  // so the run exits "closed" and nothing trades that day (accepted: ~3 days a year).
  const slot = currentSlot(nowMs, cfg.cronTimesET);
  if (!deps.ignoreWindow && slot && etMinutesOfDay(nowMs) > hhmmToMinutes(slot) + cfg.maxLateMin) {
    appendLog(paths.log, logLine(today, runId, "late", { reason: `after ${slot} ET + ${cfg.maxLateMin}m` }));
    return { status: "late" };
  }

  // 2. Clock check. For a live broker (Schwab) this is also the first authenticated request, so a
  // dead ~7-day refresh token surfaces here as a SchwabAuthError — halt with a re-auth alert rather
  // than crash, so cron.log/notify tell the operator to run `trade:auth`.
  let clockOpen: boolean;
  try {
    clockOpen = (await adapter.getClock()).isOpen;
  } catch (e) {
    if (e instanceof SchwabAuthError) {
      notify(`cron halted: ${e.message}`);
      appendLog(paths.log, logLine(today, runId, "halted", { reason: "auth" }));
      return { status: "halted", reason: "auth" };
    }
    throw e;
  }
  if (!clockOpen) {
    appendLog(paths.log, logLine(today, runId, "closed"));
    return { status: "closed" };
  }

  // 3. Exclusive run-lock — a held lock returns immediately, before touching halt state or inputs.
  // (spec §3 step 3: "if already held -> log and exit 0.") A lock file already present when we
  // reach acquireLock, combined with acquireLock succeeding, means the lock we just took was
  // reclaimed from a stale one (a hard-killed/hung prior run whose `finally` never released it) —
  // not merely lock-file-didn't-exist-yet; note that in the log so it's visible in cron.log.
  // The lock is held through a handle that releases it only while it is still ours (D-4): a run that outlived the
  // stale threshold may have had it reclaimed, and must not delete the new holder's lock. A held lock is alerted
  // (F-10): the slot is skipped, and a manual trade:execute left open holds it until it exits.
  const lockAlreadyPresent = existsSync(paths.lock);
  const lock = holdLock(paths.lock, DEFAULT_LOCK_STALE_MS);
  if (!lock) {
    let holder = "";
    try { holder = readFileSync(paths.lock, "utf8").trim(); } catch { /* released meanwhile */ }
    notify(`cron: skipped — another trade run holds the run lock (${holder || "holder unknown"}). Nothing was sent this slot; a manual trade:execute holds it until it exits.`);
    appendLog(paths.log, logLine(today, runId, "locked"));
    return { status: "locked" };
  }
  if (lockAlreadyPresent) {
    appendLog(paths.log, `${today} ${runId} lock-reclaimed-stale`);
  }

  // Phase-based halt counting (F-4): true once an order has reached the broker (set when step 8 builds ctx).
  let ordersSent = (): boolean => false;
  try {
    // 4. Consecutive-halt breaker. A corrupt/wrong-shape state file throws (breakers.ts) — that is
    // itself a safe-halt condition (addendum), not a crash.
    let haltState;
    try {
      haltState = readHaltState(paths.haltState);
    } catch (e) {
      notify(`cron halted: halt-state file is unreadable/corrupt — ${(e as Error).message}`);
      appendLog(paths.log, logLine(today, runId, "halted", { reason: "halt-state-corrupt" }));
      return { status: "halted", reason: "halt-state-corrupt" };
    }
    if (haltBlocked(haltState, cfg)) {
      notify(`cron halted: ${haltState.consecutive} consecutive halted run(s) (limit ${cfg.consecutiveHaltLimit}) — clear halt state to resume`);
      appendLog(paths.log, logLine(today, runId, "halted", { reason: "consecutive" }));
      return { status: "halted", reason: "consecutive" };
    }

    // 5. Plan (reuses pipeline.planRun unchanged; it reconciles the book internally).
    let out: PlanRunOutput;
    try {
      const inputs = await loadInputs();
      out = await planRun({ ...inputs, today, cfg, runId, nowMs, clock: deps.clock, adapter });
    } catch (e) {
      if (e instanceof ReconcileError) {
        bumpHalt(paths.haltState);
        notify(`cron halted: reconcile failed — ${e.message}`);
        appendLog(paths.log, logLine(today, runId, "halted", { reason: "reconcile" }));
        return { status: "halted", reason: "reconcile" };
      }
      if (e instanceof SchwabAuthError) { // access token died between the clock check and planRun (rare)
        notify(`cron halted: ${e.message}`);
        appendLog(paths.log, logLine(today, runId, "halted", { reason: "auth" }));
        return { status: "halted", reason: "auth" };
      }
      throw e;
    }

    // 5a. Advisory re-label streaks (relabel.ts): extend them with this run's candidates and attach the confirmed
    // ones for the summary / allocation post. Runs in preview too (it is not trading state); never fails a run.
    if (paths.relabelState) {
      try {
        const state = advanceRelabels(readRelabelState(paths.relabelState), today, out.relabel);
        writeRelabelState(paths.relabelState, state);
        out = { ...out, relabelConfirmed: confirmedRelabels(state, out.relabel) };
      } catch (e) {
        appendLog(paths.log, `${today} ${runId} relabel-state-error ${(e as Error).message}`);
      }
    }

    // 5b. Preview only: report the plan and stop before anything that could submit or change state.
    if (deps.previewOnly) {
      const a = allocationFromRun(out, `preview — auto-trade off (PREVIEW_ONLY) · ${out.sized.orders.length} order(s) not sent`);
      deps.notifyAllocation?.(a);
      appendLog(paths.log, logLine(today, runId, "preview", summaryFields(out)));
      return { status: "preview", orders: out.sized.orders.length };
    }

    // 6. Turnover breaker. An ENTER-only plan (opening positions, e.g. building the book from cash) may
    // be clipped to the cap instead of halting — opt-in; every run still stays within the cap.
    // The budget is the smaller of the per-run cap and what's left of the daily cap after today's
    // earlier runs (the daily cap only binds with several cronTimesET slots).
    const breakerOn = deps.turnoverBreaker ?? true;
    const tb = turnoverBreaker(out.sized.orders, out.ledger.nav, cfg);
    const nav = out.ledger.nav;
    const doneTodayUsd = dayTurnoverUsd(paths.runs, today);
    const dayLeftUsd = Math.max(0, cfg.maxDayTurnoverFrac * nav - doneTodayUsd);
    const plannedUsd = tb.frac * nav;
    const byDay = dayLeftUsd < cfg.maxRunTurnoverFrac * nav;
    const budgetUsd = Math.min(cfg.maxRunTurnoverFrac * nav, dayLeftUsd);
    const over = breakerOn && plannedUsd > budgetUsd + 1e-9;
    if (!breakerOn && plannedUsd > budgetUsd + 1e-9) out = { ...out, record: { ...out.record, notes: [...out.record.notes, `turnover breaker OFF (TURNOVER_BREAKER unset): ${(tb.frac * 100).toFixed(1)}% of NAV sent, over the ${(cfg.maxRunTurnoverFrac * 100).toFixed(1)}% cap it would have applied`] } };
    const capText = byDay
      ? `daily cap ${(cfg.maxDayTurnoverFrac * 100).toFixed(1)}% of NAV (${((doneTodayUsd / nav) * 100).toFixed(1)}% already traded today)`
      : `${(cfg.maxRunTurnoverFrac * 100).toFixed(1)}% per-run cap`;
    const clip = over && cfg.turnoverClipBuyOnly ? clipToTurnover(out.sized.orders, nav, cfg, budgetUsd) : null;
    if (clip) {
      const clippedCids = new Set(clip.clipped.map((o) => o.clientOrderId));
      const deferred = clip.clipped.map((o) => ({ ticker: o.ticker, code: "TURNOVER_CLIP" as const, reasons: [`deferred: turnover capped by the ${capText}`], currentWeight: 0, targetWeight: nav > 0 ? o.deltaUsd / nav : null }));
      out = {
        ...out,
        sized: { ...out.sized, orders: clip.kept },
        plan: { ...out.plan, skipped: [...out.plan.skipped, ...deferred] },
        record: {
          ...out.record,
          orders: out.record.orders.filter((o) => !clippedCids.has(o.clientOrderId as string)),
          plan: { ...out.record.plan, skipped: [...(out.record.plan.skipped as unknown[]), ...deferred] },
          notes: [...out.record.notes, `turnover clip: ${(tb.frac * 100).toFixed(1)}% of NAV planned vs the ${capText}; kept ${clip.kept.length}, deferred ${clip.clipped.length} (${clip.clipped.map((o) => o.ticker).join(", ")})`],
        },
      };
      notify(`cron: buy-only plan was ${(tb.frac * 100).toFixed(1)}% of NAV, over the ${capText} — clipped: sending ${clip.kept.length}, deferring ${clip.clipped.length} to later runs`);
    } else if (over) {
      const reason = byDay ? "day-turnover" : "turnover";
      bumpHalt(paths.haltState);
      notify(`cron halted: turnover breaker tripped — ${(tb.frac * 100).toFixed(1)}% of NAV planned, over the ${capText}`);
      writeRunRecord(paths.runs, out.record);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason }));
      return { status: "halted", reason };
    }

    // 7. Nothing to trade — a clean run, so it clears any prior halt.
    if (out.sized.orders.length === 0) {
      clearHalt(paths.haltState);
      writeRunRecord(paths.runs, out.record);
      appendLog(paths.log, logLine(today, runId, "noop", summaryFields(out)));
      deps.notifySummary?.(summaryFromRun(out, "noop", []));
      return { status: "noop" };
    }

    // 8. Execute (reuses pipeline.executeOrders unchanged). ctx is built here from out.locks/out.ledger
    // rather than via an injected builder — the same shape trade-execute.ts assembles, with no extra
    // dependency needed to test it (a "fake"-kind adapter skips the paper-endpoint check entirely).
    // env is the caller's real environment (not {}): assertOrderAllowed re-checks TRADE_DISABLED on
    // every submit, and that per-submit backstop must stay live on the unattended path.
    const ctx: GuardContext = {
      brokerKind: adapter.kind, configuredBaseUrl, locks: out.locks, today, nav: out.ledger.nav, cfg,
      env, cashUsd: out.ledger.cash, counters: { orders: 0, notionalUsd: 0, buyNotionalUsd: 0, sellProceedsUsd: 0 },
    };
    ordersSent = () => ctx.counters.orders > 0;
    // Submit cutoff (cfg.submitCutoffET, 15:50 ET): no order goes out at or after it, however late the
    // run started or however long earlier orders polled — never into the close. Remaining orders are
    // recorded as skipped (sells go first, so a cutoff only ever leaves cash).
    const cutoffMs = etInstantOn(today, cfg.submitCutoffET);
    const t0 = Date.now();
    const submitClock = deps.clock ?? (() => nowMs + (Date.now() - t0));
    const { fills, executed, aborted, skippedCash, rejected, skippedLegs, skippedCutoff } = await executeOrders({ adapter, sized: out.sized, ctx, runId, fillsPath: paths.fills, resolveDelaysMs: deps.resolveDelaysMs, pollMs: deps.pollMs, now: submitClock, cutoffMs });
    const rec = {
      ...out.record, fills: fills as unknown as Record<string, unknown>[], orders: mergeExecution(out.record.orders, executed),
      notes: [...out.record.notes, ...skippedCash.map((s) => `cash skipped: ${s.ticker} — ${s.detail}`),
        ...rejected.map((r) => `rejected: ${r.ticker} — ${r.detail}`), ...skippedLegs.map((l) => `leg skipped: ${l.ticker} — ${l.detail}`),
        ...skippedCutoff.map((c) => `cutoff skipped: ${c.ticker} — ${c.detail}`)],
    };
    if (rejected.length) notify(`cron: ${rejected.length} order(s) rejected by the broker (nothing placed for them) — ${rejected.map((r) => `${r.ticker}: ${r.detail}`).join("; ")}`);
    if (skippedCash.length) notify(`cron: ${skippedCash.length} buy(s) skipped by the cash backstop — ${skippedCash.map((s) => s.ticker).join(", ")} (broker cash couldn't cover them; usually a funding sell that didn't fill)`);
    if (skippedCutoff.length) notify(`cron: ${skippedCutoff.length} order(s) NOT sent — the ${cfg.submitCutoffET} ET submit cutoff passed mid-run — ${skippedCutoff.map((c) => c.ticker).join(", ")} (nothing placed for them; the next run re-plans)`);
    writeRunRecord(paths.runs, rec);

    // 9. Broker-truth cross-check (spec §4). The recorded fills must match what the broker actually
    // did; a critical discrepancy (an unrecorded or mismatched fill under-sets the lock clock and the
    // ledger) is a halt — bump the counter, notify, exit non-zero. Warnings pass. Only a clean audit
    // clears the consecutive-halt counter.
    // Audit only what was actually sent (a cash-skipped buy never reached the broker).
    const brokerIdByCid = new Map(executed.filter((e) => e.status !== "rejected").map((e) => [e.clientOrderId, e.brokerId || undefined])); // a rejected order never reached the book
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
    // 9b. The run stopped submitting: an unknown submit outcome or an order it lost track of (either may exist
    // at the broker, and may have filled), or a guard refusal mid-run. Halt so a human checks the broker. The next
    // run's reconcile orders-check also refuses to proceed while any executed order is unrecorded.
    if (aborted) {
      // Phase-based (F-4): count it only if something may have reached the broker. A guard refusal of the very first
      // order sent nothing; an unknown submit or a lost order always may have.
      if (aborted.reason !== "guard" || ctx.counters.orders > 0) bumpHalt(paths.haltState);
      notify(abortAlert(aborted, "cron"));
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: aborted.reason }));
      return { status: "halted", reason: aborted.reason };
    }
    // 9c. The broker's orders could not be read (after retries): this run's fills are unverified. Fills and the run
    // record are already written; halt so a human runs the audit before the next slot trades on them.
    if (!audit) {
      bumpHalt(paths.haltState);
      notify(`cron halted: the broker-truth check could not read the broker's orders (${auditReadError}). ${fills.length} fill(s) were recorded and the run record is written. Run \`npm run trade:audit -- --run ${runId}\` once the broker answers; if it is clean, clear the halt state.`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "audit-unavailable" }));
      return { status: "halted", reason: "audit-unavailable" };
    }
    if (!audit.ok) {
      bumpHalt(paths.haltState);
      notify(`cron halted: broker-truth check found ${audit.critical} critical discrepancy(ies) — ${audit.discrepancies.filter((d) => d.severity === "critical").map((d) => `${d.code} ${d.ticker}`).join(", ")}`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "broker-mismatch" }));
      return { status: "halted", reason: "broker-mismatch" };
    }
    // 9d. An order still working after its cancel (the audit passes a working order with 0 filled) is not a clean
    // run: never clear the halt counter over it.
    const working = executed.filter((e) => e.brokerId && !TERMINAL_STATUSES.has(e.status as BrokerOrderStatus));
    if (working.length) {
      bumpHalt(paths.haltState);
      notify(`cron halted: ${working.length} order(s) still working at the broker after the cancel attempt — ${working.map((e) => `${out.sized.orders.find((x) => x.clientOrderId === e.clientOrderId)?.ticker ?? "?"} ${e.brokerId} (${e.status}${e.cancelError ? `; cancel failed: ${e.cancelError}` : ""})`).join(", ")}. Check the broker; a DAY order expires at the close, and the next run's reconcile halts until it is terminal and recorded.`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "order-working" }));
      return { status: "halted", reason: "order-working" };
    }
    clearHalt(paths.haltState);
    appendLog(paths.log, logLine(today, runId, "executed", { ...summaryFields(out), haltSkip: out.sized.skippedHalt.length }));
    deps.notifySummary?.(summaryFromRun(out, "executed", fills, audit, skippedCutoff));
    if (out.sized.skippedHalt.length) {
      notify(`cron: ${out.sized.skippedHalt.length} order(s) skipped by the per-ticker halt — ${out.sized.skippedHalt.map((h) => `${h.ticker} (${h.reason})`).join(", ")}`);
    }
    return { status: "executed", orders: out.sized.orders.length, fills: fills.length };
  } catch (e) {
    // Phase-based (F-4): before any order reached the broker, the caller alerts (alert-only). After, this is a
    // halted run — count it, alert, and never let it escape (the scheduler would otherwise treat it as pre-trade).
    if (!ordersSent()) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    let counter = "";
    try { counter = ` · halt counter now ${bumpHalt(paths.haltState).consecutive}`; } catch (be) { counter = ` · halt counter NOT bumped (${(be as Error).message})`; }
    try { notify(`cron halted: error after orders were sent — ${msg}${counter}. Check the broker's order history and run \`npm run trade:audit -- --run ${runId}\` before the next slot.`); } catch { /* never mask */ }
    try { appendLog(paths.log, logLine(today, runId, "halted", { reason: "execute-error" })); } catch { /* never mask */ }
    return { status: "halted", reason: "execute-error" };
  } finally {
    lock.release();
  }
}
