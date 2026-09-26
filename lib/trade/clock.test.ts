import { describe, it, expect } from "vitest";
import { todayET, etMinutesOfDay, etDateString, etWallToUtc, hhmmToMinutes } from "./clock";

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
