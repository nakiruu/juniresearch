import { describe, it, expect } from "vitest";
import { assertCalendar, isTradingDay, indexOnOrBefore, addTradingDays, prevTradingDay } from "./calendar";

// Mon 2026-09-21 … Fri 2026-10-02, with Thu 2026-09-24 removed to stand in for a holiday.
const CAL = [
  "2026-09-21", "2026-09-22", "2026-09-23", /* holiday 09-24 */ "2026-09-25",
  "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
];

describe("assertCalendar", () => {
  it("accepts a sorted, unique list", () => { expect(() => assertCalendar(CAL)).not.toThrow(); });
  it("rejects unsorted or duplicate days", () => {
    expect(() => assertCalendar(["2026-09-22", "2026-09-21"])).toThrow(/sorted/);
    expect(() => assertCalendar(["2026-09-21", "2026-09-21"])).toThrow(/sorted/);
  });
});

describe("isTradingDay / indexOnOrBefore / prevTradingDay", () => {
  it("knows weekends and the holiday are not trading days", () => {
    expect(isTradingDay(CAL, "2026-09-26")).toBe(false); // Sat
    expect(isTradingDay(CAL, "2026-09-24")).toBe(false); // holiday
    expect(isTradingDay(CAL, "2026-09-25")).toBe(true);
  });
  it("finds the last trading day on or before a date", () => {
    expect(indexOnOrBefore(CAL, "2026-09-26")).toBe(3);   // Sat → Fri 09-25
    expect(indexOnOrBefore(CAL, "2026-09-25")).toBe(3);
    expect(indexOnOrBefore(CAL, "2026-09-20")).toBe(-1);  // before the calendar
  });
  it("prevTradingDay is strictly before the date, skipping weekends and holidays", () => {
    expect(prevTradingDay(CAL, "2026-09-28")).toBe("2026-09-25"); // Mon → Fri
    expect(prevTradingDay(CAL, "2026-09-25")).toBe("2026-09-23"); // Fri → Wed (Thu is the holiday)
    expect(prevTradingDay(CAL, "2026-09-27")).toBe("2026-09-25"); // Sun → Fri
    expect(() => prevTradingDay(CAL, "2026-09-21")).toThrow(/no trading day/);
  });
});

describe("addTradingDays", () => {
  it("steps forward n trading days, skipping the weekend and the holiday", () => {
    expect(addTradingDays(CAL, "2026-09-21", 1)).toBe("2026-09-22");
    expect(addTradingDays(CAL, "2026-09-23", 1)).toBe("2026-09-25"); // skips holiday
    expect(addTradingDays(CAL, "2026-09-21", 5)).toBe("2026-09-29"); // Mon +5 → Tue 09-29: the holiday pushes it a day past "next Mon"
    expect(addTradingDays(CAL, "2026-09-21", 6)).toBe("2026-09-30");
  });
  it("requires `from` to be a trading day and stays inside the calendar", () => {
    expect(() => addTradingDays(CAL, "2026-09-24", 1)).toThrow(/not a trading day/);
    expect(() => addTradingDays(CAL, "2026-10-02", 1)).toThrow(/beyond/);
  });
});
