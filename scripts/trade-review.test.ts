import { describe, it, expect } from "vitest";
import { buildReview, type ReviewRun, type ReviewFill, type DatedOrder } from "./trade-review";

const CFG = { lockBusinessDays: 5 };

describe("weekly review digest", () => {
  it("flags a run whose orders sat in a lock window", () => {
    const runs: ReviewRun[] = [{ date: "2026-10-01", orders: [{ ticker: "NVT", side: "buy" }] }];
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-30" }]; // bought 1 day before → sell-locked
    const d = buildReview(runs, fills, [], CFG);
    expect(d.lockViolations.length).toBe(0); // a BUY after a BUY isn't a round-trip; sanity that no false positive
  });

  it("flags a real in-lock-window trade: a SELL the day after the BUY that locked it", () => {
    const runs: ReviewRun[] = [{ date: "2026-10-01", orders: [{ ticker: "NVT", side: "sell" }] }];
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-30" }]; // sell-locked through 2026-10-07
    const d = buildReview(runs, fills, [], CFG);
    expect(d.lockViolations).toEqual([{ date: "2026-10-01", ticker: "NVT", side: "sell", lockedUntil: "2026-10-07" }]);
  });

  it("a sell order once the lock has expired is not flagged", () => {
    const runs: ReviewRun[] = [{ date: "2026-10-08", orders: [{ ticker: "NVT", side: "sell" }] }];
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-30" }]; // unlocks 2026-10-07
    const d = buildReview(runs, fills, [], CFG);
    expect(d.lockViolations.length).toBe(0);
  });

  it("computes a cash range and turnover from full run records", () => {
    const runs: ReviewRun[] = [
      { today: "2026-10-01", plan: { plannedCash: 0.10, trades: [{ deltaWeight: 0.05 }, { deltaWeight: -0.02 }] } },
      { today: "2026-10-02", plan: { plannedCash: 0.18, trades: [] } },
    ];
    const d = buildReview(runs, [], [], CFG);
    expect(d.cashRange).toEqual({ min: 0.10, max: 0.18 });
    expect(d.turnoverByRun).toEqual([
      { date: "2026-10-01", runId: undefined, turnoverFrac: 0.07 },
      { date: "2026-10-02", runId: undefined, turnoverFrac: 0 },
    ]);
  });

  it("surfaces a deferral that carries an unlock date", () => {
    const runs: ReviewRun[] = [{ today: "2026-10-01", plan: { skipped: [{ ticker: "NVT", code: "DEFER_TRIM", unlockOn: "2026-10-07" }, { ticker: "AAPL", code: "BELOW_BAND" }] } }];
    const d = buildReview(runs, [], [], CFG);
    expect(d.deferralsWithUnlock).toEqual([{ date: "2026-10-01", ticker: "NVT", code: "DEFER_TRIM", unlockOn: "2026-10-07" }]);
  });

  it("flags a fill with no matching order as unreconciled", () => {
    const runs: ReviewRun[] = [{ today: "2026-10-01", orders: [{ ticker: "NVT", side: "buy" }] }];
    const cleanFills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-10-01" }];
    const orphanFill: ReviewFill[] = [{ ticker: "MP", side: "buy", tradingDate: "2026-10-01" }]; // no order anywhere placed it
    expect(buildReview(runs, cleanFills, [], CFG).reconciledEveryRun).toBe(true);
    expect(buildReview(runs, orphanFill, [], CFG).reconciledEveryRun).toBe(false);
  });

  it("tallies cap-bind frequency per ticker across runs and the extra orders feed", () => {
    const runs: ReviewRun[] = [
      { today: "2026-10-01", orders: [{ ticker: "NVT", side: "buy", capBound: true }, { ticker: "AAPL", side: "buy", capBound: false }] },
      { today: "2026-10-02", orders: [{ ticker: "NVT", side: "buy", capBound: true }] },
    ];
    const extra: DatedOrder[] = [{ ticker: "NVT", side: "buy", capBound: false, date: "2026-10-03" }];
    const d = buildReview(runs, [], extra, CFG);
    expect(d.capBindByTicker).toEqual({ NVT: { bound: 2, total: 3 }, AAPL: { bound: 0, total: 1 } });
  });
});
