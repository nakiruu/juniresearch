import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCron, type CronDeps } from "./cron";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig } from "./config";
import { readHaltState, bumpHalt } from "./breakers";
import { readFills } from "./fills";
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
    nowMs: Date.parse(`${TODAY}T20:00:00.000Z`),
    runId: "r-cron-1",
    configuredBaseUrl: "memory://",
    loadInputs: async () => ({ reports: [], sics: {}, marketCapUsd: {}, fills: [] }),
    notify: (m: string) => { notified.push(m); },
    disabled: false,
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

  it("run-lock: a pre-existing lock file returns \"locked\" immediately, without loading inputs", async () => {
    const paths = mkPaths();
    writeFileSync(paths.lock, "12345 2026-09-25T00:00:00.000Z");
    let loadInputsCalled = false;
    const r = await runCron(mkDeps({ paths, loadInputs: async () => { loadInputsCalled = true; return { reports: [], sics: {}, marketCapUsd: {}, fills: [] }; } }));
    expect(r).toEqual({ status: "locked" });
    expect(loadInputsCalled).toBe(false);
    expect(readFileSync(paths.lock, "utf8")).toBe("12345 2026-09-25T00:00:00.000Z"); // untouched — not ours to release
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
});
