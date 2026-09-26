import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCron, type CronDeps } from "./cron";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig } from "./config";
import { readHaltState, bumpHalt } from "./breakers";
import { readFills } from "./fills";
import { SchwabAuthError } from "../broker/schwab-auth";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { Fill } from "./fills";

const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((date) => ({ date, open: "09:30", close: "16:00" }));
const closes = (p: number) => Object.fromEntries(CAL.map((d) => [d.date, p]));
const TODAY = "2026-09-25";
// Same fixture as pipeline.test.ts: at a $100 mark this is a strong ENTER (mu +21%, R 1.05).
const nvt = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] });

function mkPaths() {
  const dir = mkdtempSync(join(tmpdir(), "cron-"));
  return { lock: join(dir, "run.lock"), haltState: join(dir, "halt.json"), log: join(dir, "cron.log"), fills: join(dir, "fills.jsonl"), runs: join(dir, "runs") };
}

function mkBroker(opts: { isOpen?: boolean; cash?: number } = {}) {
  return new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: opts.cash ?? 10_000, cash: opts.cash ?? 10_000, isOpen: opts.isOpen ?? true, today: TODAY });
}

/** Base deps; individual tests override what they need to exercise one branch. */
function mkDeps(overrides: Partial<CronDeps> & { paths: CronDeps["paths"] }): CronDeps {
  const notified: string[] = [];
  return {
    adapter: mkBroker(),
    cfg: resolveTradeConfig(), // default wMax=0.10 keeps a single ENTER well under the 15% turnover cap
    today: TODAY,
    nowMs: Date.parse(`${TODAY}T13:50:00.000Z`), // 09:50 EDT — inside the fire window
    runId: "r-cron-1",
    configuredBaseUrl: "memory://",
    loadInputs: async () => ({ reports: [], sics: {}, marketCapUsd: {}, fills: [] }),
    notify: (m: string) => { notified.push(m); },
    disabled: false,
    env: {} as NodeJS.ProcessEnv,
    ...overrides,
  } as CronDeps & { __notified?: string[] };
}

describe("runCron", () => {
  it("market closed: status closed, nothing submitted, no lock taken", async () => {
    const paths = mkPaths();
    const adapter = mkBroker({ isOpen: false });
    const r = await runCron(mkDeps({ paths, adapter }));
    expect(r).toEqual({ status: "closed" });
    expect(await adapter.getOrders("all")).toEqual([]);
    expect(existsSync(paths.lock)).toBe(false); // never acquired
    expect(readFileSync(paths.log, "utf8")).toMatch(/closed/);
  });

  it("fire window: a run starting after cronTimeET + maxLateMin (ET) is 'late' — no broker call, no lock, no halt bump", async () => {
    const paths = mkPaths();
    const adapter = mkBroker();
    let clockCalls = 0;
    const getClock = adapter.getClock.bind(adapter);
    adapter.getClock = async () => { clockCalls++; return getClock(); };
    const r = await runCron(mkDeps({ paths, adapter, nowMs: Date.parse(`${TODAY}T14:06:00.000Z`) })); // 10:06 EDT > 09:45 + 20m
    expect(r).toEqual({ status: "late" });
    expect(clockCalls).toBe(0);
    expect(existsSync(paths.lock)).toBe(false);
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 });
    expect(readFileSync(paths.log, "utf8")).toMatch(/late reason=after 09:45 ET \+ 20m/);
  });

  it("fire window: 10:05 ET (exactly cronTimeET + 20m) still runs; the window is DST-correct (EST)", async () => {
    expect((await runCron(mkDeps({ paths: mkPaths(), nowMs: Date.parse(`${TODAY}T14:05:00.000Z`) }))).status).not.toBe("late");
    const est = await runCron(mkDeps({ paths: mkPaths(), nowMs: Date.parse("2026-12-01T14:50:00.000Z") })); // 09:50 EST
    expect(est.status).not.toBe("late");
  });

  it("fire window: ignoreWindow (trade:cron --now) skips it; the market clock still applies", async () => {
    const late = Date.parse(`${TODAY}T18:00:00.000Z`); // 14:00 EDT
    expect((await runCron(mkDeps({ paths: mkPaths(), nowMs: late, ignoreWindow: true }))).status).not.toBe("late");
    expect(await runCron(mkDeps({ paths: mkPaths(), nowMs: late, ignoreWindow: true, adapter: mkBroker({ isOpen: false }) }))).toEqual({ status: "closed" });
  });

  it("kill switch still wins over the fire window", async () => {
    expect(await runCron(mkDeps({ paths: mkPaths(), nowMs: Date.parse(`${TODAY}T23:00:00.000Z`), disabled: true }))).toEqual({ status: "disabled" });
  });

  it("kill switch: disabled short-circuits before even checking the clock", async () => {
    const paths = mkPaths();
    const adapter = mkBroker({ isOpen: false }); // would also be "closed" — disabled must win
    const r = await runCron(mkDeps({ paths, adapter, disabled: true }));
    expect(r).toEqual({ status: "disabled" });
    expect(existsSync(paths.lock)).toBe(false);
    expect(readFileSync(paths.log, "utf8")).toMatch(/disabled/);
  });

  it("open market + empty plan: noop, clears any prior halt, writes a run record", async () => {
    const paths = mkPaths();
    bumpHalt(paths.haltState); // consecutive:1 beforehand
    const r = await runCron(mkDeps({ paths }));
    expect(r).toEqual({ status: "noop" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 });
    expect(readdirSync(paths.runs)).toHaveLength(1);
    expect(readFileSync(paths.log, "utf8")).toMatch(/noop/);
    expect(existsSync(paths.lock)).toBe(false); // released
  });

  it("turnover breaker: an order over 15% NAV halts, bumps the counter, notifies, submits nothing", async () => {
    const paths = mkPaths();
    const notified: string[] = [];
    const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 }); // uncapped — the fixture ENTER is ~49% of NAV
    const adapter = mkBroker();
    const r = await runCron(mkDeps({
      paths, cfg, adapter, notify: (m) => notified.push(m),
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }),
    }));
    expect(r).toEqual({ status: "halted", reason: "turnover" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(notified.some((m) => /turnover/i.test(m))).toBe(true);
    expect(await adapter.getOrders("all")).toEqual([]); // executeOrders never ran
    expect(readFills(paths.fills)).toEqual([]);
    expect(readdirSync(paths.runs)).toHaveLength(1); // record still written (spec §3 step 6)
    expect(readFileSync(paths.log, "utf8")).toMatch(/halted.*turnover|turnover.*halted/i);
  });

  it("run-lock: a pre-existing (fresh) lock file returns \"locked\" immediately, without loading inputs, and logs it", async () => {
    const paths = mkPaths();
    const freshLock = `12345 ${new Date().toISOString()}`; // just written — not stale, must not be reclaimed
    writeFileSync(paths.lock, freshLock);
    let loadInputsCalled = false;
    const r = await runCron(mkDeps({ paths, loadInputs: async () => { loadInputsCalled = true; return { reports: [], sics: {}, marketCapUsd: {}, fills: [] }; } }));
    expect(r).toEqual({ status: "locked" });
    expect(loadInputsCalled).toBe(false);
    expect(readFileSync(paths.lock, "utf8")).toBe(freshLock); // untouched — not ours to release
    expect(readFileSync(paths.log, "utf8")).toMatch(/locked/);
  });

  it("run-lock: a stale lock (older than the reclaim threshold) is reclaimed and the run proceeds, logging the reclaim", async () => {
    const paths = mkPaths();
    const staleLock = `99999 ${new Date(Date.now() - 2 * 60 * 60_000).toISOString()}`; // 2h old
    writeFileSync(paths.lock, staleLock);
    const r = await runCron(mkDeps({ paths }));
    expect(r).toEqual({ status: "noop" }); // the run proceeded past the lock step to a normal empty plan
    expect(existsSync(paths.lock)).toBe(false); // reclaimed, then released via finally at run end
    expect(readFileSync(paths.log, "utf8")).toMatch(/lock-reclaimed-stale/);
  });

  it("consecutive-halt: at the configured limit, blocks before planning, notifies", async () => {
    const paths = mkPaths();
    const cfg = resolveTradeConfig();
    for (let i = 0; i < cfg.consecutiveHaltLimit; i++) bumpHalt(paths.haltState);
    let loadInputsCalled = false;
    const notified: string[] = [];
    const r = await runCron(mkDeps({
      paths, cfg, notify: (m) => notified.push(m),
      loadInputs: async () => { loadInputsCalled = true; return { reports: [], sics: {}, marketCapUsd: {}, fills: [] }; },
    }));
    expect(r).toEqual({ status: "halted", reason: "consecutive" });
    expect(loadInputsCalled).toBe(false);
    expect(notified.some((m) => /consecutive/i.test(m))).toBe(true);
    expect(existsSync(paths.lock)).toBe(false); // released even though we halted
  });

  it("reconcile halt: an unexplained broker position throws ReconcileError inside planRun -> halted/reconcile", async () => {
    const paths = mkPaths();
    const adapter = mkBroker();
    await adapter.submitOrder({ symbol: "NVT", side: "buy", notional: 1_000, clientOrderId: "manual", estNotionalUsd: 1_000 }); // never logged as a fill
    const notified: string[] = [];
    const r = await runCron(mkDeps({
      paths, adapter, notify: (m) => notified.push(m),
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }),
    }));
    expect(r).toEqual({ status: "halted", reason: "reconcile" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(notified.some((m) => /reconcile/i.test(m))).toBe(true);
    expect(existsSync(paths.runs) && readdirSync(paths.runs).length > 0).toBe(false); // no record — planRun never returned
  });

  it("corrupt halt-state file: a throwing readHaltState is a safe halt, not a crash (addendum)", async () => {
    const paths = mkPaths();
    writeFileSync(paths.haltState, "{not json");
    let loadInputsCalled = false;
    const notified: string[] = [];
    const r = await runCron(mkDeps({
      paths, notify: (m) => notified.push(m),
      loadInputs: async () => { loadInputsCalled = true; return { reports: [], sics: {}, marketCapUsd: {}, fills: [] }; },
    }));
    expect(r).toEqual({ status: "halted", reason: "halt-state-corrupt" });
    expect(loadInputsCalled).toBe(false);
    expect(notified.length).toBe(1);
    expect(existsSync(paths.lock)).toBe(false); // released
  });

  it("executed: submits the order, records fills, clears halt, logs a summary line", async () => {
    const paths = mkPaths();
    bumpHalt(paths.haltState); // a prior halt should clear on a clean executed run
    const adapter = mkBroker();
    const r = await runCron(mkDeps({
      paths, adapter,
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] as Fill[] }),
    }));
    expect(r.status).toBe("executed");
    expect(r.orders).toBeGreaterThan(0);
    expect(r.fills).toBe(r.orders);
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 0 });
    const fills = readFills(paths.fills);
    expect(fills.length).toBe(r.fills);
    expect(fills[0]).toEqual(expect.objectContaining({ ticker: "NVT", side: "buy", runId: "r-cron-1" }));
    const recFile = readdirSync(paths.runs)[0];
    const rec = JSON.parse(readFileSync(join(paths.runs, recFile), "utf8"));
    expect(rec.fills.length).toBe(r.fills);
    expect(readFileSync(paths.log, "utf8")).toMatch(/executed/);
    expect(existsSync(paths.lock)).toBe(false);
  });

  it("broker-truth mismatch: a fill the log missed halts the run (broker-mismatch), bumps the counter, notifies", async () => {
    // The IOC is not marketable (today's print 999 > the ~$100 limit) so the fake cancels it with a
    // zero fill and executeOrders records nothing. We then make the post-execute getOrders report that
    // same order as FILLED — the broker did something the fills log doesn't reflect. The cross-check
    // must catch it as a critical UNRECORDED_FILL and halt.
    const paths = mkPaths();
    const adapter = new FakeBroker({ calendar: CAL, closes: { NVT: { ...closes(100), [TODAY]: 999 } }, equity: 10_000, cash: 10_000, isOpen: true, today: TODAY });
    const orig = adapter.getOrders.bind(adapter);
    adapter.getOrders = (async (status: "open" | "closed" | "all") =>
      (await orig(status)).map((o) => (o.status === "canceled" ? { ...o, status: "filled" as const, filledQty: o.qty ?? 1, filledAvgPrice: 100, filledAt: `${TODAY}T15:30:00Z` } : o))) as typeof adapter.getOrders;
    const notified: string[] = [];
    const r = await runCron(mkDeps({
      paths, adapter, notify: (m) => notified.push(m),
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }),
    }));
    expect(r).toEqual({ status: "halted", reason: "broker-mismatch" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(notified.some((m) => /broker-truth|discrepanc/i.test(m))).toBe(true);
    expect(readdirSync(paths.runs)).toHaveLength(1); // record written before the check
    expect(existsSync(paths.lock)).toBe(false);       // released
  });

  it("a broker-truth CRITICAL is sticky: every later run halts at reconcile until the fill is recorded", async () => {
    const paths = mkPaths();
    const adapter = mkBroker();
    const orig = adapter.getOrders.bind(adapter);
    // The order the run submits comes back canceled (no fill recorded), but the broker later reports it filled.
    adapter.getOrders = (async (status: "open" | "closed" | "all") =>
      (await orig(status)).map((o) => (o.status === "canceled" ? { ...o, status: "filled" as const, filledQty: o.qty ?? 1, filledAvgPrice: 100, filledAt: `${TODAY}T13:55:00Z` } : o))) as typeof adapter.getOrders;
    const submit = adapter.submitOrder.bind(adapter);
    adapter.submitOrder = async (req) => ({ ...(await submit(req)), status: "canceled", filledQty: 0, filledAvgPrice: null, filledAt: null });
    const inputs = { reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] as Fill[] };
    const run = (runId: string) => runCron(mkDeps({ paths, adapter, runId, loadInputs: async () => ({ ...inputs, fills: readFills(paths.fills) }) }));

    expect(await run("r1")).toEqual({ status: "halted", reason: "broker-mismatch" });
    // Before: the next run re-planned and could trade against the under-set lock. Now it halts, and keeps halting.
    expect(await run("r2")).toEqual({ status: "halted", reason: "reconcile" });
    expect(await run("r3")).toEqual({ status: "halted", reason: "reconcile" });
    expect(await run("r4")).toEqual({ status: "halted", reason: "consecutive" }); // counter reached the limit (3)
    expect(readFileSync(paths.log, "utf8")).toMatch(/r2 halted reason=reconcile/);
  });

  it("Schwab re-auth needed: a SchwabAuthError from the first authed call halts (auth) and alerts, no lock left", async () => {
    const paths = mkPaths();
    const adapter = mkBroker();
    adapter.getClock = async () => { throw new SchwabAuthError("No Schwab tokens found — run: npm run trade:auth"); };
    const notified: string[] = [];
    const r = await runCron(mkDeps({ paths, adapter, notify: (m) => notified.push(m) }));
    expect(r).toEqual({ status: "halted", reason: "auth" });
    expect(notified.some((m) => /trade:auth/.test(m))).toBe(true);
    expect(existsSync(paths.lock)).toBe(false); // getClock throws before the lock is acquired
  });

  it("calls notifySummary once on an executed run with matching orders/fills", async () => {
    const paths = mkPaths();
    const summaries: { status: string; orders: unknown[]; fills: unknown[] }[] = [];
    const r = await runCron(mkDeps({
      paths,
      notifySummary: (s) => summaries.push(s),
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] as Fill[] }),
    }));
    expect(r.status).toBe("executed");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe("executed");
    expect(summaries[0].orders.length).toBe(r.orders);
    expect(summaries[0].fills.length).toBe(r.fills);
  });

  it("guard-level kill switch: env.TRADE_DISABLED=1 blocks submission even though step-1 disabled is false", async () => {
    // Step-1 `disabled` is false (as if the caller's process.env check raced or was stale), but the
    // GuardContext carries the real env — assertOrderAllowed's per-submit re-check must still fire.
    // This proves defense-in-depth: the kill switch isn't only the single step-1 read.
    const paths = mkPaths();
    const adapter = mkBroker();
    await expect(runCron(mkDeps({
      paths, adapter, disabled: false, env: { TRADE_DISABLED: "1" } as unknown as NodeJS.ProcessEnv,
      loadInputs: async () => ({ reports: [nvt], sics: {}, marketCapUsd: {}, fills: [] }),
    }))).rejects.toThrow(/TRADE_DISABLED/);
    expect(readFills(paths.fills)).toEqual([]); // the guard threw before any fill was recorded
    expect(await adapter.getOrders("all")).toEqual([]); // never reached adapter.submitOrder
    expect(existsSync(paths.lock)).toBe(false); // released via finally even on an uncaught throw
  });
});
