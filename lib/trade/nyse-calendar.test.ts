import { describe, it, expect } from "vitest";
import { nyseTradingDays, COVERAGE_END } from "./nyse-calendar";
import { addTradingDays, prevTradingDay } from "./calendar";

describe("nyseTradingDays", () => {
  it("returns Mon–Fri for a normal week", () => {
    const days = nyseTradingDays("2026-09-21", "2026-09-25").map((d) => d.date);
    expect(days).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(nyseTradingDays("2026-09-21", "2026-09-25")[0]).toEqual({ date: "2026-09-21", open: "09:30", close: "16:00" });
  });

  it("excludes weekends", () => {
    const days = nyseTradingDays("2026-09-25", "2026-09-28").map((d) => d.date); // Fri..Mon
    expect(days).toEqual(["2026-09-25", "2026-09-28"]); // Sat 26 / Sun 27 dropped
  });

  it("excludes observed 2026 holidays", () => {
    const set = new Set(nyseTradingDays("2026-01-01", "2026-12-31").map((d) => d.date));
    for (const h of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]) {
      expect(set.has(h)).toBe(false);
    }
    expect(set.has("2026-09-25")).toBe(true); // a normal day is present
  });

  it("drops exactly the holiday in a spanning range (Thanksgiving week)", () => {
    const days = nyseTradingDays("2026-11-23", "2026-11-27").map((d) => d.date);
    expect(days).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27"]); // Thu 26 (Thanksgiving) dropped
  });

  it("feeds prevTradingDay / addTradingDays correctly across a holiday", () => {
    const cal = nyseTradingDays("2026-11-01", "2026-12-01").map((d) => d.date);
    expect(prevTradingDay(cal, "2026-11-27")).toBe("2026-11-25"); // skips Thanksgiving (26)
    expect(addTradingDays(cal, "2026-11-25", 1)).toBe("2026-11-27"); // 26 is not a trading day
  });

  it("throws rather than return a silently-wrong calendar beyond coverage", () => {
    expect(() => nyseTradingDays("2025-01-01", "2029-06-01")).toThrow(/outside the maintained holiday table/);
    expect(() => nyseTradingDays(COVERAGE_END, COVERAGE_END)).not.toThrow();
  });
});
