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
  it("accepts three to five fiscal years and rejects fewer or more", () => {
    const p = minimalPack();
    p.statements.fiscalYears = ["FY23", "FY24", "FY25"];
    p.statements.income = p.statements.income.map((r) => ({ ...r, values: r.values.slice(-3) }));
    p.statements.balance = p.statements.balance.map((r) => ({ ...r, values: r.values.slice(-3) }));
    p.statements.cashflow = p.statements.cashflow.map((r) => ({ ...r, values: r.values.slice(-3) }));
    expect(() => FactPack.parse(p)).not.toThrow();
    expect(() => FactPack.parse({ ...p, statements: { ...p.statements, fiscalYears: ["FY24", "FY25"] } })).toThrow();
    expect(() => FactPack.parse({ ...p, statements: { ...p.statements, fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25", "FY26"] } })).toThrow();
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
