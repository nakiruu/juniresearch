import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack, FACTPACK_SCHEMA_VERSION } from "@/lib/facts/schema";

describe("FactPack 1.2.0 carries the proxy statement", () => {
  const raw = { ...JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")), schemaVersion: FACTPACK_SCHEMA_VERSION };
  it("bumps the schema version", () => {
    expect(FACTPACK_SCHEMA_VERSION).toBe("1.2.0");
  });
  it("requires context.proxyStatement (nullable) so every built pack states whether it has one", () => {
    expect(FactPack.parse({ ...raw, context: { ...raw.context, proxyStatement: null } }).context.proxyStatement).toBeNull();
    const ex = { text: "Board and director independence:\nAll independent.", source: "edgar:DEF 14A", asOf: "2025-09-26", url: "https://www.sec.gov/x.htm", truncated: false };
    expect(FactPack.parse({ ...raw, context: { ...raw.context, proxyStatement: ex } }).context.proxyStatement).toEqual(ex);
    const { proxyStatement: _omit, ...withoutField } = { ...raw.context, proxyStatement: null };
    expect(() => FactPack.parse({ ...raw, context: withoutField })).toThrow();
  });
});
