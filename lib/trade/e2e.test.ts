import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun, executeOrders } from "./pipeline";
import { readFills } from "./fills";
import { resolveTradeConfig } from "./config";
import { FakeBroker } from "../broker/fake";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { GuardContext } from "../broker/guards";

// Trading days Mon 09-21 → Fri 10-02 with Thu 09-24 a holiday.
const DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const CAL = DAYS.map((date) => ({ date, open: "09:30", close: "16:00" }));
// lockBusinessDays pinned to 6 here (not the production default of 5) so this scenario's
// sell-lock lands exactly on the 9-day calendar's boundary — the 5-day default is covered in
// locks.test.ts. The mechanism under test (deferred exit fires on the first legal day) is
// independent of the specific lock length.
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1, lockBusinessDays: 6 });
// Scenarios fixed; price path drives mu/R. At 100: mu +21%, R 1.05 → ENTER. At 125: mu ≈ −3%, below muExit → EXIT.
const nvt = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] });
const path = (d: string) => (d < "2026-09-23" ? 100 : 125); // rallies through fair value from 09-23

describe("e2e: a whipsaw cannot happen inside the lock window; the deferred exit fires on the first legal day", () => {
  it("runs the book day by day", async () => {
    const closes = { NVT: Object.fromEntries(DAYS.map((d) => [d, path(d)])) };
    const b = new FakeBroker({ calendar: CAL, closes, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-22" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "e2e-")), "fills.jsonl");
    const ctx = (today: string, locks: GuardContext["locks"], nav: number): GuardContext =>
      ({ brokerKind: "fake", configuredBaseUrl: "memory://", locks, today, nav, cfg, env: {} as NodeJS.ProcessEnv, counters: { orders: 0, notionalUsd: 0 } });
    const run = async (today: string) => {
      b.setToday(today);
      // A fresh live last trade at today's real price, so a same-day BUY/SELL anchors tier 1 (full
      // size) instead of tier 3 close-anchored (spec's closeAnchorSizeMult would otherwise halve Day
      // 1's ENTER, which is a sizing concern orthogonal to what this scenario tests: lock/whipsaw
      // sequencing). Re-set every call so it never goes stale relative to `nowMs` (Date.now() default).
      b.setTrade("NVT", path(today), Date.now());
      const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: readFills(fillsPath), today, cfg, runId: `r-${today}` });
      const fills = await executeOrders({ adapter: b, sized: out.sized, ctx: ctx(today, out.locks, out.ledger.nav), runId: `r-${today}`, fillsPath, pollMs: 0 });
      return { out, fills };
    };

    // Day 1 (Tue 09-22, marked at Mon's 100): ENTER and fill.
    const d1 = await run("2026-09-22");
    expect(d1.out.plan.trades.map((t) => t.reason)).toEqual(["ENTER"]);
    expect(d1.fills).toHaveLength(1);
    expect(d1.out.locks.sellLockUntil).toEqual({});                 // locks are computed from fills *before* today's execution

    // Day 2 (Wed 09-23, marked at Tue's 100): HOLD, nothing to do.
    const d2 = await run("2026-09-23");
    expect(d2.out.locks.sellLockUntil.NVT).toBe("2026-10-01");      // 09-22 + 6 trading days, holiday skipped
    expect(d2.out.plan.trades).toEqual([]);

    // Day 3 (Fri 09-25, marked at Wed's 125): the thesis played out → EXIT wanted, but sell-locked → DEFERRED.
    const d3 = await run("2026-09-25");
    expect(d3.out.plan.skipped).toContainEqual(expect.objectContaining({ ticker: "NVT", code: "DEFER_EXIT", unlockOn: "2026-10-01" }));
    expect(d3.fills).toEqual([]);
    expect(d3.out.plan.trades).toEqual([]);                          // the EXIT was skipped, not attempted
    expect(d3.out.plan.frozenWeight).toBeGreaterThan(0.9);

    // Day 4 (Wed 09-30, the day before unlock): still deferred.
    const d4 = await run("2026-09-30");
    expect(d4.fills).toEqual([]);
    expect(d4.out.plan.skipped).toContainEqual(expect.objectContaining({ ticker: "NVT", code: "DEFER_EXIT", unlockOn: "2026-10-01" }));

    // Day 5 (Thu 10-01, first legal day): the exit fires and fills.
    const d5 = await run("2026-10-01");
    expect(d5.out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "EXIT" })]);
    expect(d5.fills).toEqual([expect.objectContaining({ side: "sell", tradingDate: "2026-10-01" })]);
    expect(await b.getPositions()).toEqual([]);

    // Day 6 (Fri 10-02): the 10-01 sell buy-locks NVT six trading days out — beyond this test's
    // 9-day calendar. A lock that cannot be dated is a hard error, never silently absent (which is
    // why planRun loads 45 days of calendar in production).
    await expect(run("2026-10-02")).rejects.toThrow(/beyond the loaded calendar/);
  });
});
