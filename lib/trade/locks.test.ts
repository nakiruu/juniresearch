import { describe, it, expect } from "vitest";
import { locksFor, isBuyLocked, isSellLocked } from "./locks";
import type { Fill } from "./fills";

// Mon 09-21 … Fri 10-02, Thu 09-24 is a holiday (see calendar.test.ts).
const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const f = (side: "buy" | "sell", tradingDate: string, ticker = "NVT"): Fill =>
  ({ ticker, side, qty: 1, price: 1, filledAt: `${tradingDate}T15:00:00Z`, tradingDate, orderId: "o", runId: "r" });

describe("locksFor", () => {
  it("a Monday buy with the 6-day default is sellable on Wed 09-30 (six trading days on, holiday skipped)", () => {
    const L = locksFor([f("buy", "2026-09-21")], CAL, 6);
    expect(L.sellLockUntil.NVT).toBe("2026-09-30");
    expect(isSellLocked(L, "NVT", "2026-09-29")).toBe(true);   // day before first legal
    expect(isSellLocked(L, "NVT", "2026-09-30")).toBe(false);  // first legal day
    expect(isBuyLocked(L, "NVT", "2026-09-22")).toBe(false);   // buys are not locked by a buy
  });
  it("with 5 days (the 'count the transaction day' reading) the same buy is sellable on Tue 09-29", () => {
    expect(locksFor([f("buy", "2026-09-21")], CAL, 5).sellLockUntil.NVT).toBe("2026-09-29");
  });
  it("a sell locks buys, not sells", () => {
    const L = locksFor([f("sell", "2026-09-23")], CAL, 6);
    expect(L.buyLockUntil.NVT).toBe("2026-10-02");
    expect(isBuyLocked(L, "NVT", "2026-09-30")).toBe(true);
    expect(isSellLocked(L, "NVT", "2026-09-25")).toBe(false);
  });
  it("adding to a position restarts the whole-ticker sell-lock (later fill wins)", () => {
    const L = locksFor([f("buy", "2026-09-21"), f("buy", "2026-09-23")], CAL, 6);
    expect(L.sellLockUntil.NVT).toBe("2026-10-02"); // from the 09-23 fill, not 09-21
  });
  it("locks are per ticker", () => {
    const L = locksFor([f("buy", "2026-09-21", "NVT"), f("sell", "2026-09-21", "MP")], CAL, 6);
    expect(L.sellLockUntil).toEqual({ NVT: "2026-09-30" });
    expect(L.buyLockUntil).toEqual({ MP: "2026-09-30" });
  });
  it("a fill dated on a non-trading day is an error (fills must carry the fill's trading date)", () => {
    expect(() => locksFor([f("buy", "2026-09-24")], CAL, 6)).toThrow(/not a trading day/);
  });
  it("no fills → no locks", () => {
    expect(locksFor([], CAL, 6)).toEqual({ buyLockUntil: {}, sellLockUntil: {} });
  });
});
