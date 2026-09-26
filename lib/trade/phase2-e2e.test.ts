/**
 * phase2-e2e.test.ts — the Phase-2 capstone: drives the real `runCron` (Task 6) day by day against
 * one FakeBroker, exercising every Phase-2 branch spec §4/§5 add on top of the v1 pipeline: a
 * closed-market no-op, a fresh tier-1 fill, a per-ticker gap-halt alongside a name that still
 * fills, a tier-3 close-anchored half-size buy, and the run-level turnover breaker. Nothing here
 * re-implements planRun/executeOrders/computeLimit — it only assembles CronDeps and reads back the
 * real artifacts (fills.jsonl, run records, cron.log, halt-state.json).
 *
 * Each day's `loadInputs` supplies only that day's *new* candidate report(s), not the full
 * cumulative coverage set a real cron would pass every day. A name bought on an earlier day and
 * omitted from a later day's reports is classified NO_SIGNAL and frozen (held, never re-sized) —
 * it does not get re-evaluated for an ADD/EXIT that day. This is a deliberate test-harness
 * simplification: it isolates each day's tested branch (tier-1 fill / gap-halt / tier-3 anchor /
 * turnover halt) from incidental HOLD/ADD trades the water-fill sizer would otherwise emit once
 * multiple held names compete for the same capped weight. It does not change the code under test.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCron, type CronDeps } from "./cron";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig } from "./config";
import { readHaltState } from "./breakers";
import { readFills } from "./fills";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { Report } from "../report.schema";

// Ten consecutive weekdays. The scenario itself only runs Mon 09-21 .. Fri 09-25; the tail
// (09-28 .. 10-02) exists purely so locksFor's addTradingDays(fillDate, lockBusinessDays=5) has
// somewhere to land for every buy fill placed during the window — without it, planRun would throw
// "beyond the loaded calendar" starting the day after the first buy (mirrors why the v1 e2e test
// loads a calendar longer than the days it actually drives).
const DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const CAL = DAYS.map((date) => ({ date, open: "09:30", close: "16:00" }));
const [D1, D2, D3, D4, D5] = DAYS;

const TICKERS = ["ENTR", "GAPD", "OKAY", "STAL", "TOVA", "TOVB"];
// Distinct 2-digit sectors per ticker (sector = floor(sic/100)) so sectorMax (30%) never binds —
// this scenario is about the per-ticker execution-time branches, not sector water-filling.
const SICS: Record<string, number | null> = { ENTR: 3600, GAPD: 2800, OKAY: 5000, STAL: 7300, TOVA: 8000, TOVB: 9000 };
const flat100 = Object.fromEntries(DAYS.map((d) => [d, 100]));
const CLOSES = Object.fromEntries(TICKERS.map((t) => [t, flat100]));

const cfg = resolveTradeConfig(); // defaults: wMax 0.10, sectorMax 0.30, maxRunTurnoverFrac 0.15, gapHalt.mid 0.15, maxStaleMin.mid 15, closeAnchorSizeMult 0.5

// Same fixture shape as cron.test.ts/e2e.test.ts: at a $100 mark this is a strong ENTER (mu +21%, R 1.05).
const mkReport = (ticker: string): Report =>
  fixtureReport({ ticker, label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] });

const nowMsFor = (day: string) => Date.parse(`${day}T13:50:00.000Z`); // 09:50 EDT — the scheduled morning run, inside the fire window

function mkPaths() {
  const dir = mkdtempSync(join(tmpdir(), "phase2-e2e-"));
  return { lock: join(dir, "run.lock"), haltState: join(dir, "halt.json"), log: join(dir, "cron.log"), fills: join(dir, "fills.jsonl"), runs: join(dir, "runs") };
}

async function runDay(broker: FakeBroker, paths: CronDeps["paths"], day: string, reports: Report[]) {
  const notified: string[] = [];
  const deps: CronDeps = {
    adapter: broker, cfg, today: day, nowMs: nowMsFor(day), runId: `r-${day}`,
    configuredBaseUrl: "memory://", paths,
    loadInputs: async () => ({ reports, sics: SICS, marketCapUsd: {}, fills: readFills(paths.fills) }),
    notify: (m: string) => notified.push(m),
    disabled: false, env: {} as NodeJS.ProcessEnv,
  };
  const result = await runCron(deps);
  return { result, notified };
}

function readRunRecord(paths: CronDeps["paths"], day: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(paths.runs, `r-${day}.json`), "utf8"));
}

describe("phase-2 end to end", () => {
  it("runs the five-day scenario and matches the fills log, run records, cron.log and halt-state", async () => {
    const paths = mkPaths();
    const broker = new FakeBroker({ calendar: CAL, closes: CLOSES, equity: 10_000, cash: 10_000, isOpen: false, today: D1 });

    // --- Day 1: market closed. Nothing else in the stack should even be touched. ---
    const day1 = await runDay(broker, paths, D1, []);
    expect(day1.result).toEqual({ status: "closed" });
    expect(readFills(paths.fills)).toEqual([]);
    expect(existsSync(paths.runs)).toBe(false); // writeRunRecord never called
    expect(readFileSync(paths.log, "utf8")).toMatch(/closed/);
    expect(day1.notified).toEqual([]);

    // --- Day 2: open, one new BUY name with a fresh live last-trade (tier 1) -> executes and fills. ---
    broker.setClock(true);
    broker.setToday(D2);
    broker.setTrade("ENTR", 100, nowMsFor(D2) - 60_000); // fresh: 1 min old, well under the mid-bucket 15 min stale window; no gap vs the $100 settled close
    const entr = mkReport("ENTR");
    const day2 = await runDay(broker, paths, D2, [entr]);
    expect(day2.result.status).toBe("executed");
    expect(day2.result.orders).toBe(1);
    expect(day2.result.fills).toBe(1);
    let fills = readFills(paths.fills);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toEqual(expect.objectContaining({ ticker: "ENTR", side: "buy", runId: `r-${D2}` }));
    const rec2 = readRunRecord(paths, D2);
    expect((rec2.orders as Record<string, unknown>[])[0]).toEqual(expect.objectContaining({ ticker: "ENTR", tier: 1, anchorReason: "ok" }));
    expect(readFileSync(paths.log, "utf8")).toMatch(/executed/);
    expect(day2.notified).toEqual([]); // no skippedHalt to report

    // --- Day 3: one name gaps +30% vs its settled close -> gap-halted; the other name still fills. ---
    broker.setToday(D3);
    broker.setTrade("GAPD", 130, nowMsFor(D3) - 60_000); // fresh, but +30% vs the $100 settled close -> gap-halt (mid bucket threshold 15%)
    broker.setTrade("OKAY", 100, nowMsFor(D3) - 60_000); // fresh, no gap -> proceeds
    const gapd = mkReport("GAPD");
    const okay = mkReport("OKAY");
    const day3 = await runDay(broker, paths, D3, [gapd, okay]);
    expect(day3.result.status).toBe("executed"); // the per-ticker gap-halt does not halt the run
    expect(day3.result.orders).toBe(1); // GAPD never became an order
    expect(day3.result.fills).toBe(1);
    fills = readFills(paths.fills);
    expect(fills).toHaveLength(2);
    expect(fills[1]).toEqual(expect.objectContaining({ ticker: "OKAY", side: "buy" }));
    expect(fills.some((f) => f.ticker === "GAPD")).toBe(false); // the gapped name did not fill
    const rec3 = readRunRecord(paths, D3);
    expect(rec3.notes as string[]).toEqual(expect.arrayContaining([expect.stringMatching(/GAPD.*gap/)]));
    expect(day3.notified).toEqual([expect.stringMatching(/GAPD.*\(gap\)/)]);

    // --- Day 4: a name with a stale last-trade and no quote -> tier-3 close-anchored buy at 0.5x notional. ---
    broker.setToday(D4);
    broker.setTrade("STAL", 101, nowMsFor(D4) - 20 * 60_000); // 20 min old > the mid-bucket 15 min stale window -> not tier 1
    // No quote ever set for STAL -> tier 2 also unavailable -> falls through to tier 3 (close-anchored).
    const stal = mkReport("STAL");
    const day4 = await runDay(broker, paths, D4, [stal]);
    expect(day4.result.status).toBe("executed");
    expect(day4.result.orders).toBe(1);
    expect(day4.result.fills).toBe(1);
    const rec4 = readRunRecord(paths, D4);
    const stalOrder = (rec4.orders as Record<string, unknown>[])[0];
    expect(stalOrder).toEqual(expect.objectContaining({ ticker: "STAL", tier: 3, anchorReason: "close_anchored" }));
    const { deltaUsd, limitPrice, qty } = stalOrder as { deltaUsd: number; limitPrice: number; qty: number };
    const fullSizeQty = Math.floor(deltaUsd / limitPrice);
    const halfSizeQty = Math.floor((deltaUsd * cfg.closeAnchorSizeMult) / limitPrice);
    expect(qty).toBe(halfSizeQty);
    expect(qty).toBeLessThan(fullSizeQty); // proves the tier-3 sizing actually reduced the order, not merely tagged it
    fills = readFills(paths.fills);
    expect(fills).toHaveLength(3);
    expect(fills[2]).toEqual(expect.objectContaining({ ticker: "STAL", side: "buy", qty }));
    expect(day4.notified).toEqual([]);

    // --- Day 5: two new ENTERs whose combined notional exceeds the 15%-of-NAV turnover cap -> halted. ---
    broker.setToday(D5);
    broker.setTrade("TOVA", 100, nowMsFor(D5) - 60_000);
    broker.setTrade("TOVB", 100, nowMsFor(D5) - 60_000);
    const tova = mkReport("TOVA");
    const tovb = mkReport("TOVB");
    const fillsBefore = readFills(paths.fills).length;
    const day5 = await runDay(broker, paths, D5, [tova, tovb]);
    expect(day5.result).toEqual({ status: "halted", reason: "turnover" });
    expect(readHaltState(paths.haltState)).toEqual({ consecutive: 1 });
    expect(day5.notified).toEqual([expect.stringMatching(/turnover/i)]);
    expect(readFills(paths.fills)).toHaveLength(fillsBefore); // no fills that day
    const rec5 = readRunRecord(paths, D5); // step 6 writes the record even on a turnover halt
    const ordersDay5 = rec5.orders as { qty: number; limitPrice: number; ticker: string }[];
    expect(ordersDay5.map((o) => o.ticker).sort()).toEqual(["TOVA", "TOVB"]);
    const nav = (await broker.getAccount()).equity;
    const notionalDay5 = ordersDay5.reduce((a, o) => a + Math.abs(o.qty * o.limitPrice), 0);
    expect(notionalDay5).toBeGreaterThan(0.15 * nav); // the same threshold turnoverBreaker itself tripped on
    expect(readFileSync(paths.log, "utf8")).toMatch(/halted.*turnover|turnover.*halted/i);

    // Final sanity: only the three names that actually filled ever entered the book.
    const heldTickers = (await broker.getPositions()).map((p) => p.symbol).sort();
    expect(heldTickers).toEqual(["ENTR", "OKAY", "STAL"]);
  });
});
