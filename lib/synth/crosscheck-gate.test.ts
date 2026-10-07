import { describe, it, expect } from "vitest";
import { crosscheckGate } from "./crosscheck-gate";

const check = (diffs: { field: "price" | "marketCap" | "sharesOutstanding" | "revenueQuarter" | "fcfTtm"; level: "ok" | "warn" | "fail"; pack: number; shibui: number; relDiff: number }[]) => ({
  asOf: "2026-09-23", quarterEnd: "2026-06-30", price: 1, marketCap: 1, sharesOutstanding: 1, revenueQuarter: 1, fcfTtm: 1, sbcTtm: null, diffs, source: "shibui" as const,
});

describe("crosscheckGate (D-27)", () => {
  it("blocks on a fail without an override, naming the field and both figures", () => {
    const g = crosscheckGate({ shibuiCheck: check([{ field: "revenueQuarter", level: "fail", pack: 451e6, shibui: 2149e6, relDiff: 0.7901 }]) });
    expect(g.blocked).toBe(true);
    expect(g.errors[0]).toMatch(/revenueQuarter/);
    expect(g.errors[0]).toMatch(/79%/);
    expect(g.errors[0]).toMatch(/--accept revenueQuarter/);
  });

  it("passes a fail that has an accepted override and surfaces the reason as a warning", () => {
    const g = crosscheckGate({
      shibuiCheck: check([{ field: "fcfTtm", level: "fail", pack: 702e6, shibui: 1049e6, relDiff: 0.3308 }]),
      crosscheckOverrides: [{ field: "fcfTtm", reason: "Shibui mixes Q3'25 as originally reported with a recast Q4 plug; pack equals continuing-ops SEC figure", verifiedAgainst: "10-Q 0001666700-26-000053", capturedAt: "2026-10-03T00:00:00.000Z" }],
    });
    expect(g.blocked).toBe(false);
    expect(g.errors).toEqual([]);
    expect(g.warnings[0]).toMatch(/override.*fcfTtm.*recast Q4 plug/);
  });

  it("an override for a different field does not cover the fail", () => {
    const g = crosscheckGate({
      shibuiCheck: check([{ field: "revenueQuarter", level: "fail", pack: 1, shibui: 2, relDiff: 0.5 }]),
      crosscheckOverrides: [{ field: "fcfTtm", reason: "x", verifiedAgainst: "y", capturedAt: "2026-10-03T00:00:00.000Z" }],
    });
    expect(g.blocked).toBe(true);
  });

  it("warn levels never block", () => {
    const g = crosscheckGate({ shibuiCheck: check([{ field: "price", level: "warn", pack: 100, shibui: 85, relDiff: 0.17 }]) });
    expect(g.blocked).toBe(false);
    expect(g.warnings[0]).toMatch(/warn price/);
  });

  it("ok levels produce nothing", () => {
    const g = crosscheckGate({ shibuiCheck: check([{ field: "price", level: "ok", pack: 100, shibui: 99, relDiff: 0.01 }]) });
    expect(g).toEqual({ blocked: false, errors: [], warnings: [] });
  });

  it("a pack with no shibuiCheck is a warning, not a block", () => {
    const g = crosscheckGate({});
    expect(g.blocked).toBe(false);
    expect(g.warnings).toEqual(["input check (Shibui): none on this pack"]);
  });
});
