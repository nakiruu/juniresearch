import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { formatSnapshot, num } from "@/lib/format";
import type { SnapshotCell } from "@/lib/format";
import { buildHighlightCells, HIGHLIGHT_KEYS } from "@/lib/facts/highlights";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/ORCL/0001193125-26-389274.json", "utf8")));

describe("buildHighlightCells — ORCL Q1 FY27 10-Q", () => {
  const cells = buildHighlightCells(pack);

  it("renders capexLatestFY as the FY26 capital expenditure, formatted by the frozen formatter", () => {
    // The brief's suggested rendering was "-$55.7B"; the frozen compactUSD() actually keeps
    // the sign inside the "$": confirmed directly against lib/format.ts before asserting.
    const cell = cells.capexLatestFY!;
    expect(cell.label).toBe("FY26 Capital Expenditure");
    expect(formatSnapshot(cell as SnapshotCell)).toBe("$-55.7B");
  });

  it("renders netDebtToEbitda as a multiple", () => {
    expect(cells.netDebtToEbitda!.label).toBe("Net Debt / EBITDA (TTM)");
    expect(formatSnapshot(cells.netDebtToEbitda! as SnapshotCell)).toBe("3.2x");
  });

  it("renders fcfYield as a signed percent with one decimal", () => {
    expect(cells.fcfYield!.label).toBe("FCF Yield (TTM)");
    expect(formatSnapshot(cells.fcfYield! as SnapshotCell)).toBe("-6.6%");
  });

  it("renders currentRatioTTM as a raw two-decimal figure", () => {
    expect(cells.currentRatioTTM).toEqual({ label: "Current Ratio (TTM)", raw: num(pack.ttm.currentRatio!, 2) });
    expect(cells.currentRatioTTM!.raw).toBe("1.17");
  });

  it("every key in HIGHLIGHT_KEYS is present, since ORCL's TTM/latest-FY facts are all non-null", () => {
    for (const key of HIGHLIGHT_KEYS) expect(cells[key], key).toBeDefined();
  });
});

describe("buildHighlightCells — a null underlying value", () => {
  it("omits the key entirely rather than emitting a null-valued cell", () => {
    const nulled = { ...pack, ttm: { ...pack.ttm, fcfYield: null } };
    const cells = buildHighlightCells(nulled);
    expect(cells.fcfYield).toBeUndefined();
    expect(Object.keys(cells)).not.toContain("fcfYield");
    // unrelated keys are unaffected
    expect(cells.netDebtToEbitda).toBeDefined();
  });
});
