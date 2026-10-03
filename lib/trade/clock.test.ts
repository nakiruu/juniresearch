import { describe, it, expect } from "vitest";
import { todayET, etMinutesOfDay, etDateString, etWallToUtc, hhmmToMinutes, etInstantOn, etHHMM } from "./clock";

describe("todayET", () => {
  it("is the ET date, not the UTC date, in the evening (EDT)", () => {
    expect(todayET(Date.parse("2026-03-09T03:30:00Z"))).toBe("2026-03-08"); // 23:30 EDT Sun
    expect(todayET(Date.parse("2026-07-02T00:30:00Z"))).toBe("2026-07-01"); // 20:30 EDT
  });
  it("rolls over exactly at ET midnight (EST)", () => {
    expect(todayET(Date.parse("2026-01-15T04:59:00Z"))).toBe("2026-01-14"); // 23:59 EST
    expect(todayET(Date.parse("2026-01-15T05:01:00Z"))).toBe("2026-01-15"); // 00:01 EST
  });
  it("matches etDateString", () => {
    const ms = Date.parse("2026-11-01T06:30:00Z"); // DST fall-back morning
    expect(todayET(ms)).toBe(etDateString(ms));
  });
});

describe("etMinutesOfDay", () => {
  it("is 585 at 09:45 ET in both EDT and EST", () => {
    expect(etMinutesOfDay(Date.parse("2026-07-01T13:45:00Z"))).toBe(585);
    expect(etMinutesOfDay(Date.parse("2026-01-15T14:45:00Z"))).toBe(585);
  });
  it("round-trips etWallToUtc", () => {
    expect(etMinutesOfDay(etWallToUtc(2026, 3, 9, 16, 0))).toBe(960);
  });
});

describe("hhmmToMinutes", () => {
  it("parses HH:MM and rejects malformed values", () => {
    expect(hhmmToMinutes("09:45")).toBe(585);
    for (const bad of ["9:45", "24:00", "09:60", "0945", ""]) expect(() => hhmmToMinutes(bad)).toThrow();
  });
});

describe("etInstantOn (the submit cutoff instant)", () => {
  it("is HH:MM ET on that ET date, DST-correct", () => {
    expect(new Date(etInstantOn("2026-09-25", "15:50")).toISOString()).toBe("2026-09-25T19:50:00.000Z"); // EDT
    expect(new Date(etInstantOn("2026-12-01", "15:50")).toISOString()).toBe("2026-12-01T20:50:00.000Z"); // EST
    expect(etHHMM(etInstantOn("2026-11-27", "15:50"))).toBe("15:50 ET");
  });
  it("throws on a malformed date or time rather than return NaN", () => {
    for (const [d, t] of [["2026-9-25", "15:50"], ["", "15:50"], ["2026-09-25", "3:50"], ["2026-09-25", "25:00"]]) expect(() => etInstantOn(d, t)).toThrow();
  });
});
