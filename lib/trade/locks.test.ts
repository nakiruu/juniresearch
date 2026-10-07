import { describe, it, expect } from "vitest";
import { locksFor, isBuyLocked, isSellLocked } from "./locks";
import type { Fill } from "./fills";
import { nyseTradingDays } from "./nyse-calendar";

// Mon 09-21 … Fri 10-02, Thu 09-24 is a holiday (see calendar.test.ts).
const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const TODAY = "2026-10-02";
const f = (side: "buy" | "sell", tradingDate: string, ticker = "NVT"): Fill =>
  ({ ticker, side, qty: 1, price: 1, filledAt: `${tradingDate}T15:00:00Z`, tradingDate, orderId: "o", runId: "r" });

describe("locksFor", () => {
  it("a Monday buy with the 6-day default is sellable on Wed 09-30 (six trading days on, holiday skipped)", () => {
    const L = locksFor([f("buy", "2026-09-21")], CAL, 6, TODAY);
    expect(L.sellLockUntil.NVT).toBe("2026-09-30");
    expect(isSellLocked(L, "NVT", "2026-09-29")).toBe(true);   // day before first legal
    expect(isSellLocked(L, "NVT", "2026-09-30")).toBe(false);  // first legal day
    expect(isBuyLocked(L, "NVT", "2026-09-22")).toBe(false);   // buys are not locked by a buy
  });
  it("with 5 days (the 'count the transaction day' reading) the same buy is sellable on Tue 09-29", () => {
    expect(locksFor([f("buy", "2026-09-21")], CAL, 5, TODAY).sellLockUntil.NVT).toBe("2026-09-29");
  });
  it("a sell locks buys, not sells", () => {
    const L = locksFor([f("sell", "2026-09-23")], CAL, 6, TODAY);
    expect(L.buyLockUntil.NVT).toBe("2026-10-02");
    expect(isBuyLocked(L, "NVT", "2026-09-30")).toBe(true);
    expect(isSellLocked(L, "NVT", "2026-09-25")).toBe(false);
  });
  it("adding to a position restarts the whole-ticker sell-lock (later fill wins)", () => {
    const L = locksFor([f("buy", "2026-09-21"), f("buy", "2026-09-23")], CAL, 6, TODAY);
    expect(L.sellLockUntil.NVT).toBe("2026-10-02"); // from the 09-23 fill, not 09-21
  });
  it("locks are per ticker", () => {
    const L = locksFor([f("buy", "2026-09-21", "NVT"), f("sell", "2026-09-21", "MP")], CAL, 6, TODAY);
    expect(L.sellLockUntil).toEqual({ NVT: "2026-09-30" });
    expect(L.buyLockUntil).toEqual({ MP: "2026-09-30" });
  });
  it("a fill dated on a non-trading day is an error (fills must carry the fill's trading date)", () => {
    expect(() => locksFor([f("buy", "2026-09-24")], CAL, 6, TODAY)).toThrow(/not a trading day/);
  });
  it("no fills → no locks", () => {
    expect(locksFor([], CAL, 6, TODAY)).toEqual({ buyLockUntil: {}, sellLockUntil: {} });
  });
});

describe("locksFor — fills older than the loaded calendar (T-1)", () => {
  const days = (from: string, to: string) => nyseTradingDays(from, to).map((d) => d.date);
  const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
  /** Every calendar day, weekends and holidays included. */
  const calDays = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };

  it("the audit repro: a June fill against a July–November calendar no longer throws and sets no lock", () => {
    const cal = days("2026-07-08", "2026-11-20");
    expect(locksFor([f("buy", "2026-06-15", "OLD"), f("sell", "2026-06-15", "OLD")], cal, 5, "2026-10-07")).toEqual({ buyLockUntil: {}, sellLockUntil: {} });
  });

  it("straddles the window edge: a fill ON calendar[0] still locks, one trading day earlier is skipped", () => {
    // CAL[0] = 2026-09-21 (Mon); 2026-09-18 (Fri) is the trading day before it.
    const L = locksFor([f("buy", "2026-09-21", "EDGE"), f("buy", "2026-09-18", "PRE")], CAL, 5, TODAY);
    expect(L.sellLockUntil).toEqual({ EDGE: "2026-09-29" });
  });

  it("an in-window fill on a non-trading day still throws (fills must carry a trading date)", () => {
    expect(() => locksFor([f("buy", "2026-06-15", "OLD"), f("buy", "2026-09-24")], CAL, 5, TODAY)).toThrow(/not a trading day/);
  });

  it("fails closed when today is too early in the calendar to prove a skipped lock expired", () => {
    expect(() => locksFor([f("buy", "2026-09-18", "PRE")], CAL, 5, CAL[2])).toThrow(/predate the loaded calendar/);
  });

  it("active-lock equivalence vs a full calendar: daily fills, n ∈ {1, 5, 6}, Oct–Nov 2026 and 2026-12-20 … 2027-01-17, weekends included", () => {
    const full = days("2026-01-02", "2027-03-31");
    const tickers = ["A", "B", "C", "D", "E", "F", "G"];
    // A fill on EVERY trading day through 2027-01-15, alternating sides, rotating tickers.
    const fills: Fill[] = full.filter((d) => d <= "2027-01-15").map((d, i) => f(i % 3 === 0 ? "sell" : "buy", d, tickers[i % tickers.length]));
    const todays = [...calDays("2026-10-01", "2026-11-30"), ...calDays("2026-12-20", "2027-01-17")];
    expect(todays).toContain("2026-12-26"); // a Saturday (and the day after the Christmas holiday)
    expect(todays).toContain("2026-12-24"); // the first day the old code would have thrown on live data
    for (const n of [1, 5, 6]) {
      for (const today of todays) {
        const window = days(shift(today, -90), shift(today, 45)); // exactly what planRun loads
        const visible = fills.filter((x) => x.tradingDate <= today);
        const oldL = locksFor(visible, full, n, today);
        const newL = locksFor(visible, window, n, today);
        for (const t of tickers) {
          expect(isBuyLocked(newL, t, today), `n=${n} ${t} buy ${today}`).toBe(isBuyLocked(oldL, t, today));
          expect(isSellLocked(newL, t, today), `n=${n} ${t} sell ${today}`).toBe(isSellLocked(oldL, t, today));
          if (isBuyLocked(oldL, t, today)) expect(newL.buyLockUntil[t]).toBe(oldL.buyLockUntil[t]);
          if (isSellLocked(oldL, t, today)) expect(newL.sellLockUntil[t]).toBe(oldL.sellLockUntil[t]);
        }
      }
    }
  });
});
