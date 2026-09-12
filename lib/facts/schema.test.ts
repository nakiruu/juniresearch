import { describe, it, expect } from "vitest";
import { FactPack } from "@/lib/facts/schema";
import { minimalPack, excerpt } from "@/lib/facts/__fixtures__/minimal-pack";

describe("FactPack schema", () => {
  it("parses a minimal valid pack", () => {
    expect(() => FactPack.parse(minimalPack())).not.toThrow();
  });
  it("rejects a foreign schema version", () => {
    expect(() => FactPack.parse({ ...minimalPack(), schemaVersion: "0.9.0" })).toThrow();
  });
  it("requires exactly five fiscal years", () => {
    const p = minimalPack(); p.statements.fiscalYears = ["FY22", "FY23", "FY24", "FY25"];
    expect(() => FactPack.parse(p)).toThrow();
  });
  it("caps headlines at ten", () => {
    const p = minimalPack(); p.context.headlines = Array.from({ length: 11 }, () => excerpt);
    expect(() => FactPack.parse(p)).toThrow();
  });
  it("allows null statement cells for a year a vendor lacks", () => {
    const p = minimalPack(); p.statements.income = [{ key: "ebitda", label: "EBITDA", values: [null, 1, 2, 3, 4] }];
    expect(() => FactPack.parse(p)).not.toThrow();
  });
});
