import { describe, it, expect } from "vitest";
import { buildReview, executionStats, fillsNeededForLockState, type ReviewRun, type ReviewFill, type DatedOrder, type ReviewOrder } from "./trade-review";

const CFG = { lockBusinessDays: 5 };

describe("fillsNeededForLockState (fix round 1 — the printReview window-boundary bug)", () => {
  it("retains a fill one business day before `since` whose lock window reaches into the review window", () => {
    // 2026-09-30 (Wed) is one business day before since=2026-10-01 (Thu); +5 biz days -> 2026-10-07, > since.
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-30" }];
    expect(fillsNeededForLockState(fills, "2026-10-01", 5)).toEqual(fills);
  });

  it("drops a fill well before `since` whose lock window has already lapsed", () => {
    // 2026-09-01 (Tue) + 5 biz days -> 2026-09-08, well short of since=2026-10-01.
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-01" }];
    expect(fillsNeededForLockState(fills, "2026-10-01", 5)).toEqual([]);
  });

  it("drops a fill exactly at the cutoff (its lock expires exactly at `since`, so it can't lock any day in the window)", () => {
    // addBizDays("2026-09-24", 5) === "2026-10-01" exactly (Thu -> Thu) — until === since is not "> since".
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-24" }];
    expect(fillsNeededForLockState(fills, "2026-10-01", 5)).toEqual([]);
  });

  it("keeps a fill dated on or after `since` unconditionally (still within the reviewed window)", () => {
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-10-01" }];
    expect(fillsNeededForLockState(fills, "2026-10-01", 5)).toEqual(fills);
  });
});

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

describe("reconciledEveryRun window-scoping (fix round 2 — a round-1 regression)", () => {
  const since = "2026-10-01";

  it("does not flag a pre-window fill (present only to widen lock-state) as unreconciled, even though its matching order sits in an excluded pre-window run", () => {
    // Mirrors printReview exactly: `runs` is already filtered to >= since, so the pre-cutoff run
    // that actually placed this order is excluded — but `fills` is the WIDENED lockFills set
    // (fillsNeededForLockState) that still includes the pre-cutoff fill, because lock-violation
    // detection needs to see it. Round 1 fed that same widened set straight into the
    // fills-vs-orders cross-check with no window awareness, so this fill read as an orphan even
    // though it is fully explained by a run outside the printed window — a false "NO" on every
    // boundary week. Passing `since` must fix it.
    const runs: ReviewRun[] = []; // the pre-cutoff run that placed the order is excluded, as printReview would
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-28" }]; // pre-window, only in the widened lock set
    expect(buildReview(runs, fills, [], CFG, since).reconciledEveryRun).toBe(true);
  });

  it("still flags a genuine orphan fill dated within the window", () => {
    const runs: ReviewRun[] = [{ today: since, orders: [{ ticker: "AAPL", side: "buy" }] }];
    const fills: ReviewFill[] = [{ ticker: "MP", side: "buy", tradingDate: since }]; // no order anywhere placed it
    expect(buildReview(runs, fills, [], CFG, since).reconciledEveryRun).toBe(false);
  });

  it("without `since`, keeps checking every provided fill (backward-compatible default — the round-2 regression only exists once a window is in play)", () => {
    const runs: ReviewRun[] = [];
    const fills: ReviewFill[] = [{ ticker: "NVT", side: "buy", tradingDate: "2026-09-28" }];
    expect(buildReview(runs, fills, [], CFG).reconciledEveryRun).toBe(false);
  });
});

describe("executionStats (spec #9/#10)", () => {
  const cfg = { limitTolMax: { large: 0.004, mid: 0.01, small: 0.015 } };
  const t0 = Date.parse("2026-09-28T13:45:00Z");
  const iso = (dms: number) => new Date(t0 + dms).toISOString();
  const order = (o: Partial<ReviewOrder>): ReviewOrder => ({ ticker: "A", side: "buy", qty: 10, filledQty: 10, bucket: "large", capBound: false,
    diag: { tauWanted: 0.002 }, anchorAtMs: t0, submitStartAt: iso(2_000), submitAckAt: iso(2_300), terminalAt: iso(3_000), ...o });

  it("splits fill ratio by capBound and never mixes brokers", () => {
    const s = executionStats([
      { broker: "schwab", orders: [order({ capBound: true, filledQty: 2, diag: { tauWanted: 0.006 } }), order({ capBound: true, filledQty: 4, diag: { tauWanted: 0.005 } }), order({})] },
      { broker: "alpaca-paper", orders: [order({ capBound: true, filledQty: 10 })] },
    ], cfg);
    expect(s.schwab.capBound).toEqual({ orders: 2, filledFrac: 0.3 });
    expect(s.schwab.notCapBound).toEqual({ orders: 1, filledFrac: 1 });
    expect(s["alpaca-paper"].capBound.filledFrac).toBe(1);
  });
  it("reports τ pressure (tauWanted / τ_max) per bucket and latency percentiles in ms", () => {
    const s = executionStats([{ broker: "schwab", orders: [order({ diag: { tauWanted: 0.006 } }), order({ diag: { tauWanted: 0.002 } })] }], cfg).schwab;
    expect(s.tauPressure.large.n).toBe(2);
    expect(s.tauPressure.large.p90).toBeCloseTo(1.5, 9);
    expect(s.tauPressure.mid.n).toBe(0);
    expect(s.latency.anchorToSubmit.p50).toBe(2_000);
    expect(s.latency.submitToAck.p50).toBe(300);
    expect(s.latency.submitToTerminal.p50).toBe(1_000);
  });
  it("tolerates older run records with none of the new fields", () => {
    const s = executionStats([{ broker: "schwab", orders: [{ ticker: "A", side: "buy", capBound: true }] }], cfg).schwab;
    expect(s.capBound).toEqual({ orders: 0, filledFrac: null });
    expect(s.latency.submitToAck.n).toBe(0);
  });
});
