/**
 * cron.ts — the one function the scheduler runs (spec §3, Phase 2 Task 6). Reuses the pipeline
 * (planRun + executeOrders) unchanged; this file adds only the run wrapper around it: kill-switch,
 * clock-check, an exclusive run-lock, the consecutive-halt / reconcile / turnover breakers, the
 * run-record, a one-line run log, and halt-only notify. No plan/size/execute logic lives here.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Report } from "../report.schema";
import type { BrokerAdapter } from "../broker/adapter";
import type { GuardContext } from "../broker/guards";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import type { Fill } from "./fills";
import { planRun, executeOrders, mergeExecution, type PlanRunOutput } from "./pipeline";
import { ReconcileError } from "./ledger";
import { SchwabAuthError } from "../broker/schwab-auth";
import { turnoverBreaker, clipToTurnover, readHaltState, bumpHalt, clearHalt, haltBlocked, acquireLock, releaseLock, DEFAULT_LOCK_STALE_MS } from "./breakers";
import { crossCheckBroker } from "./audit";
import { summaryFromRun, type RunSummaryInput } from "./notify";
import { writeRunRecord } from "./run-record";
import { etMinutesOfDay, hhmmToMinutes } from "./clock";
import { refreshTokenHealth } from "../broker/schwab-auth";
import { maybeWarnAuth } from "./auth-health";
import { nextRunAtET } from "./clock";

export type CronStatus = "disabled" | "late" | "closed" | "locked" | "halted" | "noop" | "executed";

export interface CronDeps {
  adapter: BrokerAdapter;
  cfg: TradeConfig;
  today: TradingDay;
  /** Execution-only freshness gate, forwarded to planRun's computeLimit; never feeds the decision path. Injected (not Date.now()) so cron stays pure/testable. */
  nowMs: number;
  runId: string;
  /** Forwarded into the GuardContext built after planRun, for the paper-endpoint guard (mirrors trade-execute.ts). Irrelevant for a "fake" adapter. */
  configuredBaseUrl: string;
  paths: { lock: string; haltState: string; log: string; fills: string; runs: string; authWarn?: string };
  /** Schwab only: the refresh token's issue time (epoch ms, undefined if unknown) for the proactive re-auth notice. */
  refreshObtainedAt?: () => number | undefined;
  loadInputs: () => Promise<{ reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null>; fills: Fill[] }>;
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
  /** Lookup schedule for an order submit with an unknown outcome (tests pass zeros). */
  resolveDelaysMs?: readonly number[];
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
      const nextRunMs = nextRunAtET(nowMs, cfg.cronTimeET);
      const health = refreshTokenHealth(deps.refreshObtainedAt(), nowMs, nextRunMs, { lifetimeMs: cfg.schwabRefreshLifetimeDays * 86_400_000, warnHours: cfg.schwabAuthWarnHours });
      maybeWarnAuth(health, nowMs, nextRunMs, paths.authWarn, notify);
    } catch { /* a notice must never fail a run */ }
  }

  // 1b. Fire window. A scheduled run that starts more than maxLateMin after cronTimeET (a missed
  // trigger fired late, a catch-up after a mid-day restart) trades at a worse, unplanned time of day —
  // skip it; the next scheduled morning runs normally. Checked before any broker call.
  if (!deps.ignoreWindow && etMinutesOfDay(nowMs) > hhmmToMinutes(cfg.cronTimeET) + cfg.maxLateMin) {
    appendLog(paths.log, logLine(today, runId, "late", { reason: `after ${cfg.cronTimeET} ET + ${cfg.maxLateMin}m` }));
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
  const lockAlreadyPresent = existsSync(paths.lock);
  if (!acquireLock(paths.lock, DEFAULT_LOCK_STALE_MS)) {
    appendLog(paths.log, logLine(today, runId, "locked"));
    return { status: "locked" };
  }
  if (lockAlreadyPresent) {
    appendLog(paths.log, `${today} ${runId} lock-reclaimed-stale`);
  }

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
      out = await planRun({ ...inputs, today, cfg, runId, nowMs, adapter });
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

    // 6. Turnover breaker. An ENTER-only plan (opening positions, e.g. building the book from cash) may
    // be clipped to the cap instead of halting — opt-in; every run still stays within the cap.
    const tb = turnoverBreaker(out.sized.orders, out.ledger.nav, cfg);
    const clip = tb.tripped && cfg.turnoverClipEnterOnly ? clipToTurnover(out.sized.orders, out.ledger.nav, cfg) : null;
    if (clip) {
      const clippedCids = new Set(clip.clipped.map((o) => o.clientOrderId));
      const deferred = clip.clipped.map((o) => ({ ticker: o.ticker, code: "TURNOVER_CLIP" as const, reasons: [`deferred: run turnover capped at ${(cfg.maxRunTurnoverFrac * 100).toFixed(1)}% of NAV`], currentWeight: 0, targetWeight: out.ledger.nav > 0 ? o.deltaUsd / out.ledger.nav : null }));
      out = {
        ...out,
        sized: { ...out.sized, orders: clip.kept },
        plan: { ...out.plan, skipped: [...out.plan.skipped, ...deferred] },
        record: {
          ...out.record,
          orders: out.record.orders.filter((o) => !clippedCids.has(o.clientOrderId as string)),
          plan: { ...out.record.plan, skipped: [...(out.record.plan.skipped as unknown[]), ...deferred] },
          notes: [...out.record.notes, `turnover clip: ${(tb.frac * 100).toFixed(1)}% of NAV planned; kept ${clip.kept.length}, deferred ${clip.clipped.length} (${clip.clipped.map((o) => o.ticker).join(", ")})`],
        },
      };
      notify(`cron: ENTER-only plan was ${(tb.frac * 100).toFixed(1)}% of NAV > ${(cfg.maxRunTurnoverFrac * 100).toFixed(1)}% cap — clipped: sending ${clip.kept.length}, deferring ${clip.clipped.length} to later runs`);
    } else if (tb.tripped) {
      bumpHalt(paths.haltState);
      notify(`cron halted: turnover breaker tripped — ${(tb.frac * 100).toFixed(1)}% of NAV > ${(cfg.maxRunTurnoverFrac * 100).toFixed(1)}% cap`);
      writeRunRecord(paths.runs, out.record);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "turnover" }));
      return { status: "halted", reason: "turnover" };
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
    const { fills, executed, aborted, skippedCash } = await executeOrders({ adapter, sized: out.sized, ctx, runId, fillsPath: paths.fills, resolveDelaysMs: deps.resolveDelaysMs });
    const rec = {
      ...out.record, fills: fills as unknown as Record<string, unknown>[], orders: mergeExecution(out.record.orders, executed),
      notes: [...out.record.notes, ...skippedCash.map((s) => `cash skipped: ${s.ticker} — ${s.detail}`)],
    };
    if (skippedCash.length) notify(`cron: ${skippedCash.length} buy(s) skipped by the cash backstop — ${skippedCash.map((s) => s.ticker).join(", ")} (broker cash couldn't cover them; usually a funding sell that didn't fill)`);
    writeRunRecord(paths.runs, rec);

    // 9. Broker-truth cross-check (spec §4). The recorded fills must match what the broker actually
    // did; a critical discrepancy (an unrecorded or mismatched fill under-sets the lock clock and the
    // ledger) is a halt — bump the counter, notify, exit non-zero. Warnings pass. Only a clean audit
    // clears the consecutive-halt counter.
    // Audit only what was actually sent (a cash-skipped buy never reached the broker).
    const brokerIdByCid = new Map(executed.map((e) => [e.clientOrderId, e.brokerId || undefined]));
    const audit = crossCheckBroker({
      expected: out.sized.orders.filter((o) => brokerIdByCid.has(o.clientOrderId)).map((o) => ({ clientOrderId: o.clientOrderId, ticker: o.ticker, side: o.side, brokerId: brokerIdByCid.get(o.clientOrderId) })),
      brokerOrders: await adapter.getOrders("all", `${today}T00:00:00Z`),
      fills,
    });
    // 9b. A submit whose outcome is unknown stopped the run. The order may exist (and may have filled);
    // halt so a human checks the broker. The next run's reconcile orders-check also refuses to proceed
    // while any executed order is unrecorded, so this can't be silently traded past.
    if (aborted) {
      bumpHalt(paths.haltState);
      notify(`cron halted: order submit for ${aborted.ticker} has an UNKNOWN outcome (${aborted.detail}). Check the broker's order history; if it executed, run \`npm run trade:reconcile -- --record-missing\`, then clear the halt state to resume.`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "submit-unknown" }));
      return { status: "halted", reason: "submit-unknown" };
    }
    if (!audit.ok) {
      bumpHalt(paths.haltState);
      notify(`cron halted: broker-truth check found ${audit.critical} critical discrepancy(ies) — ${audit.discrepancies.filter((d) => d.severity === "critical").map((d) => `${d.code} ${d.ticker}`).join(", ")}`);
      appendLog(paths.log, logLine(today, runId, "halted", { ...summaryFields(out), reason: "broker-mismatch" }));
      return { status: "halted", reason: "broker-mismatch" };
    }
    clearHalt(paths.haltState);
    appendLog(paths.log, logLine(today, runId, "executed", { ...summaryFields(out), haltSkip: out.sized.skippedHalt.length }));
    deps.notifySummary?.(summaryFromRun(out, "executed", fills, audit));
    if (out.sized.skippedHalt.length) {
      notify(`cron: ${out.sized.skippedHalt.length} order(s) skipped by the per-ticker halt — ${out.sized.skippedHalt.map((h) => `${h.ticker} (${h.reason})`).join(", ")}`);
    }
    return { status: "executed", orders: out.sized.orders.length, fills: fills.length };
  } finally {
    releaseLock(paths.lock);
  }
}
