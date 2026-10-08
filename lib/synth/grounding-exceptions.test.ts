import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  GroundingExceptionsFile, loadExceptions, applyExceptions, exceptionKey, surfaceSha256, EXCEPTIONS_IGNORED_DIFFERS, type GroundingException,
} from "@/lib/synth/grounding-exceptions";
import type { GroundingSurface } from "@/lib/synth/grounding";

const H = (c: string) => c.repeat(64);
const entry: GroundingException = {
  ticker: "LLY", accession: "0000059478-26-000123", judgmentSha256: H("a"), surfaceSha256: H("b"), check: "grounding",
  field: "sections.executiveSummary.companyOverview", raw: "$1T", class: "policy", reason: "1-digit rounding of $1.02T", approvedAt: "2026-10-08",
};
const fileOf = (entries: GroundingException[]) => JSON.stringify({ note: "test", entries }, null, 2) + "\n";
const miss = (field: string, raw: string) => ({ field, message: `"${raw}" is not in the facts or the captured context — rounding Facts "$1.02T" this far is not allowed`, value: raw });
const ctx = { ticker: "LLY", accession: entry.accession, judgmentSha256: H("a"), surfaceSha256: H("b") };

describe("the exception file schema", () => {
  it("accepts a complete entry", () => {
    expect(GroundingExceptionsFile.parse(JSON.parse(fileOf([entry]))).entries).toEqual([entry]);
  });
  it.each<[string, Partial<Record<keyof GroundingException, unknown>>]>([
    ["a missing surface hash", { surfaceSha256: undefined }],
    ["a short judgment hash", { judgmentSha256: "abc" }],
    ["an unknown check", { check: "lint/span-scope" }],
    ["an unknown class", { class: "maybe" }],
    ["an empty reason", { reason: "" }],
    ["a reason over 300 characters", { reason: "x".repeat(301) }],
    ["an unknown key", { extra: 1 } as never],
  ])("rejects %s", (_name, patch) => {
    expect(GroundingExceptionsFile.safeParse({ entries: [{ ...entry, ...patch }] }).success).toBe(false);
  });
  it("accepts the lint figure-repeat check", () => {
    expect(GroundingExceptionsFile.safeParse({ entries: [{ ...entry, check: "lint/figure-repeat" }] }).success).toBe(true);
  });
});

describe("applying exceptions", () => {
  const issues = [miss(entry.field, "$1T"), miss("sections.financials.cashflowCommentary", "$1T"), { field: "rating.label", message: "bad", value: "BUY" }];
  it("turns a full match into an owner-approved warning and leaves the rest", () => {
    const r = applyExceptions(issues, ctx, [entry]);
    expect(r.errors).toEqual(issues.slice(1));
    expect(r.warnings).toEqual([{ rule: "grounding-exception", severity: "warning", field: entry.field, value: "$1T",
      message: "grounding exception (owner-approved, policy): 1-digit rounding of $1.02T" }]);
    expect(r.matched).toEqual([entry]);
    expect(r.stale).toEqual([]);
  });
  it("keeps the error when the judgment or the surface changed, and reports the entry stale", () => {
    for (const changed of [{ ...ctx, judgmentSha256: H("c") }, { ...ctx, surfaceSha256: H("d") }]) {
      const r = applyExceptions(issues, changed, [entry]);
      expect(r.errors).toEqual(issues);
      expect(r.warnings).toEqual([]);
      expect(r.stale).toEqual([entry]);
    }
  });
  it("ignores another accession's entries", () => {
    const r = applyExceptions(issues, { ...ctx, accession: "0000059478-26-000999" }, [entry]);
    expect(r.errors).toEqual(issues);
    expect(r.stale).toEqual([]);
  });
  it("matches a lint figure-repeat error by rule", () => {
    const lint = { rule: "figure-repeat", severity: "error" as const, field: "sections.executiveSummary.risks[2]", message: "twice", value: "8 points" };
    const e = { ...entry, check: "lint/figure-repeat" as const, field: lint.field, raw: "8 points" };
    expect(applyExceptions([lint], ctx, [e]).errors).toEqual([]);
    expect(applyExceptions([{ ...lint, rule: "sentence-repeat" }], ctx, [e]).errors).toHaveLength(1);
  });
  it("keys an entry by every field it matches on", () => {
    expect(exceptionKey(entry)).toBe(`LLY|${entry.accession}|${H("a")}|${H("b")}|grounding|${entry.field}|$1T`);
  });
});

describe("only the copy merged to main applies", () => {
  const bytes = fileOf([entry]);
  it("applies the entries when the working file is byte-equal to main's", () => {
    expect(loadExceptions({ readWorking: () => bytes, readMain: () => Buffer.from(bytes) })).toEqual({ entries: [entry] });
  });
  it("applies none, with a warning, when one byte differs", () => {
    const r = loadExceptions({ readWorking: () => bytes, readMain: () => bytes.replace("test", "tesT") });
    expect(r.entries).toEqual([]);
    expect(r.warning).toBe(EXCEPTIONS_IGNORED_DIFFERS);
    expect(EXCEPTIONS_IGNORED_DIFFERS).toBe("grounding exceptions ignored: file differs from main");
  });
  it("applies none when a line ending differs", () => {
    expect(loadExceptions({ readWorking: () => bytes.replace(/\n/g, "\r\n"), readMain: () => bytes }).entries).toEqual([]);
  });
  it("fails closed when main's copy cannot be read (git missing, or the file not on main yet)", () => {
    const r = loadExceptions({ readWorking: () => bytes, readMain: () => { throw new Error("fatal: path not in main"); } });
    expect(r.entries).toEqual([]);
  });
  it("applies none when the working file is absent", () => {
    expect(loadExceptions({ readWorking: () => null, readMain: () => bytes }).entries).toEqual([]);
  });
  it("excepts nothing from a wip commit that adds an entry and pins it, while main holds the old file", () => {
    const added = { ...entry, field: "sections.growth.points[0]", raw: "$2T" };
    const frozen = new Set([exceptionKey(entry), exceptionKey(added)]);
    const working = fileOf([entry, added]);
    expect(GroundingExceptionsFile.parse(JSON.parse(working)).entries.every((e) => frozen.has(exceptionKey(e)))).toBe(true);
    expect(loadExceptions({ readWorking: () => working, readMain: () => bytes }).entries).toEqual([]);
  });
  it("throws on a malformed file that main also holds, so synth:build fails at the exceptions stage", () => {
    const bad = JSON.stringify({ entries: [{ ...entry, class: "maybe" }] });
    expect(() => loadExceptions({ readWorking: () => bad, readMain: () => bad })).toThrow();
  });
});

/**
 * Shrink-only. These are the 8 owner-approved entries (plan 2026-10-07 §5): CSTM, LH ×2, LLY ×2, MDU ×2, NVDA. A fix round
 * removes its keys here and its entries from the JSON in the same merge; nothing is ever added.
 */
const FROZEN_KEYS = new Set([
  "CSTM|0001563411-26-000192|4142e25fe8ad5fb216dfdac560d6e91e946e0f71950cfce5b99fd17185d8ed0f|07bab4b3d97c5006a973b8176c390bbe708fb3971495fceaaa85ec94bb18e321|grounding|sections.financials.incomeCommentary|$4 million",
  "LH|0000920148-26-000175|68ac4715cee0131281b68b90640a6e844ad9d267ac0264f8bd963123d46a169c|4f8f3a20c77cdb0ca6406d8eb3e46bea45c649ab6e731dd69668f793efe6e6b8|grounding|sections.executiveSummary.catalysts[2]|$8.73 billion",
  "LH|0000920148-26-000175|68ac4715cee0131281b68b90640a6e844ad9d267ac0264f8bd963123d46a169c|4f8f3a20c77cdb0ca6406d8eb3e46bea45c649ab6e731dd69668f793efe6e6b8|grounding|sections.growth.points[0]|$13,952",
  "LLY|0000059478-26-000081|9f262de96beee34bd73e30500e22606e7435611b3b72f4a020599812e9d8163f|eca263e3cfc4130f85040f6b628da52f0221a6bc666847a93dea6416ffcb88c2|grounding|sections.executiveSummary.companyOverview|$1T",
  "LLY|0000059478-26-000081|9f262de96beee34bd73e30500e22606e7435611b3b72f4a020599812e9d8163f|eca263e3cfc4130f85040f6b628da52f0221a6bc666847a93dea6416ffcb88c2|grounding|sections.financials.cashflowCommentary|$1T",
  "MDU|0000067716-26-000072|7dfd54a98b8a6084de33ea3accb8decd8cda867f205f87df68d838f2d2cde2d1|bb2f5af9c93ba87e36dc98a77d7db5a64032004c634eb25a97182bace0e29e6e|grounding|analystCommentary|$0.4M",
  "MDU|0000067716-26-000072|7dfd54a98b8a6084de33ea3accb8decd8cda867f205f87df68d838f2d2cde2d1|bb2f5af9c93ba87e36dc98a77d7db5a64032004c634eb25a97182bace0e29e6e|grounding|sections.financials.incomeCommentary|$0.4M",
  "NVDA|0001045810-26-000075|96408ee70d2f07ad2d7ca8f9a3c669ce75c10b016dc4b32bb6e19a06a18d1395|c6adc13483e4ec0073b60cca80c5141d2f0593258ab8cc667b527817baff14b3|grounding|sections.financials.balanceCommentary|400 times",
]);

describe("the committed exception file", () => {
  const file = GroundingExceptionsFile.parse(JSON.parse(readFileSync("lib/synth/grounding-exceptions.json", "utf8")));
  it("holds only pinned entries: adding one is a reviewed code change", () => {
    expect(file.entries.map(exceptionKey).filter((k) => !FROZEN_KEYS.has(k))).toEqual([]);
  });
  it("holds each pinned entry at most once", () => {
    expect(new Set(file.entries.map(exceptionKey)).size).toBe(file.entries.length);
  });
  it("is LF-only, so a checkout stays byte-equal to main's copy", () => {
    expect(readFileSync("lib/synth/grounding-exceptions.json").includes(Buffer.from("\r"))).toBe(false);
  });
});

describe("the surface hash", () => {
  const s: GroundingSurface = { tables: [], factsBlock: "F", callsBlock: "C", judgmentBlock: "J", contextBlock: "X" };
  it("is the SHA-256 of the rendered Facts, Calls, judgment and Context blocks, and moves with any of them", () => {
    expect(surfaceSha256(s)).toMatch(/^[0-9a-f]{64}$/);
    for (const k of ["factsBlock", "callsBlock", "judgmentBlock", "contextBlock"] as const) expect(surfaceSha256({ ...s, [k]: "changed" })).not.toBe(surfaceSha256(s));
  });
});

describe("synth:build stage order", () => {
  it("runs the exceptions stage after the input check and before validate", () => {
    const src = readFileSync("scripts/synth-build.ts", "utf8");
    const at = (stage: string) => src.indexOf(`"${stage}")`);
    expect(at("input check")).toBeGreaterThan(0);
    expect(at("exceptions")).toBeGreaterThan(at("input check"));
    expect(at("validate")).toBeGreaterThan(at("exceptions"));
  });
});
