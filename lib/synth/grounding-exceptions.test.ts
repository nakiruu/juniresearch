import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  GroundingExceptionsFile, loadExceptions, applyExceptions, exceptionKey, surfaceSha256, gitReaders, EXCEPTIONS_IGNORED_DIFFERS, EXCEPTIONS_IGNORED_UNREADABLE,
  type GroundingException,
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

describe("only the copy merged to main and pushed to origin/main applies", () => {
  const bytes = fileOf([entry]);
  const both = (main: () => Buffer | string, originMain: () => Buffer | string = main) => ({ readMain: main, readOriginMain: originMain });
  it("applies the entries when the working file is byte-equal to both refs' copies", () => {
    expect(loadExceptions({ readWorking: () => bytes, ...both(() => Buffer.from(bytes)) })).toEqual({ entries: [entry] });
  });
  it("applies none, with a warning, when one byte differs from main's copy", () => {
    const r = loadExceptions({ readWorking: () => bytes, ...both(() => bytes.replace("test", "tesT"), () => bytes) });
    expect(r.entries).toEqual([]);
    expect(r.warning).toBe(EXCEPTIONS_IGNORED_DIFFERS);
    expect(EXCEPTIONS_IGNORED_DIFFERS).toBe("grounding exceptions ignored: file differs from main or origin/main");
  });
  it("applies none when main agrees but origin/main does not (a moved local main, a wip branch)", () => {
    const r = loadExceptions({ readWorking: () => bytes, ...both(() => bytes, () => fileOf([])) });
    expect(r.entries).toEqual([]);
    expect(r.warning).toBe(EXCEPTIONS_IGNORED_DIFFERS);
  });
  it("applies none when a line ending differs", () => {
    expect(loadExceptions({ readWorking: () => bytes.replace(/\n/g, "\r\n"), ...both(() => bytes) }).entries).toEqual([]);
  });
  it("fails closed, with a warning, when either ref's copy cannot be read", () => {
    const boom = () => { throw new Error("fatal: path not in refs/remotes/origin/main"); };
    for (const r of [loadExceptions({ readWorking: () => bytes, ...both(boom, () => bytes) }), loadExceptions({ readWorking: () => bytes, ...both(() => bytes, boom) })]) {
      expect(r.entries).toEqual([]);
      expect(r.warning).toBe(EXCEPTIONS_IGNORED_UNREADABLE);
    }
  });
  it("applies none when the working file is absent", () => {
    expect(loadExceptions({ readWorking: () => null, ...both(() => bytes) })).toEqual({ entries: [] });
  });
  it("fails closed, with a warning, when the working file cannot be read (EACCES, EISDIR), rather than stopping the build", () => {
    const r = loadExceptions({ readWorking: () => { throw Object.assign(new Error("EISDIR: illegal operation on a directory"), { code: "EISDIR" }); }, ...both(() => bytes) });
    expect(r.entries).toEqual([]);
    expect(r.warning).toMatch(/^grounding exceptions ignored: the working copy is unreadable: EISDIR/);
  });
  it("excepts nothing from a wip commit that adds an entry and pins it, while main holds the old file", () => {
    const added = { ...entry, field: "sections.growth.points[0]", raw: "$2T" };
    const frozen = new Set([exceptionKey(entry), exceptionKey(added)]);
    const working = fileOf([entry, added]);
    expect(GroundingExceptionsFile.parse(JSON.parse(working)).entries.every((e) => frozen.has(exceptionKey(e)))).toBe(true);
    expect(loadExceptions({ readWorking: () => working, ...both(() => bytes) }).entries).toEqual([]);
    // a local `git branch -f main wip` moves refs/heads/main but not refs/remotes/origin/main
    expect(loadExceptions({ readWorking: () => working, ...both(() => working, () => bytes) }).entries).toEqual([]);
  });
  it("throws on a malformed file that both refs also hold, so synth:build fails at the exceptions stage", () => {
    const bad = JSON.stringify({ entries: [{ ...entry, class: "maybe" }] });
    expect(() => loadExceptions({ readWorking: () => bad, ...both(() => bad) })).toThrow();
  });
  it("reads main's and origin/main's copies by fully qualified ref, never a bare name a tag could shadow", () => {
    const calls: string[][] = [];
    const r = gitReaders("lib/synth/grounding-exceptions.json", (args) => { calls.push(args); return Buffer.from("x"); });
    r.readMain(); r.readOriginMain();
    expect(calls).toEqual([
      ["show", "refs/heads/main:lib/synth/grounding-exceptions.json"],
      ["show", "refs/remotes/origin/main:lib/synth/grounding-exceptions.json"],
    ]);
  });
});

/**
 * Shrink-only. These are the owner-approved entries left of the 8 in plan 2026-10-07 §5 (CSTM fixed 2026-10-08): LH ×2, LLY ×2, MDU ×2, NVDA. A fix round
 * removes its keys here and its entries from the JSON in the same merge; nothing is ever added.
 */
const FROZEN_KEYS = new Set([
  "LH|0000920148-26-000175|68ac4715cee0131281b68b90640a6e844ad9d267ac0264f8bd963123d46a169c|91b392e467c90dc3289cac71072d746c77ac9c697d3d898da5c2af408d9e184d|grounding|sections.executiveSummary.catalysts[2]|$8.73 billion",
  "LH|0000920148-26-000175|68ac4715cee0131281b68b90640a6e844ad9d267ac0264f8bd963123d46a169c|91b392e467c90dc3289cac71072d746c77ac9c697d3d898da5c2af408d9e184d|grounding|sections.growth.points[0]|$13,952",
  "LLY|0000059478-26-000081|9f262de96beee34bd73e30500e22606e7435611b3b72f4a020599812e9d8163f|37fad26e9ea859ef73851d4007d35e4320d11b48e661131cb29f87ce6dc101eb|grounding|sections.executiveSummary.companyOverview|$1T",
  "LLY|0000059478-26-000081|9f262de96beee34bd73e30500e22606e7435611b3b72f4a020599812e9d8163f|37fad26e9ea859ef73851d4007d35e4320d11b48e661131cb29f87ce6dc101eb|grounding|sections.financials.cashflowCommentary|$1T",
  "MDU|0000067716-26-000072|7dfd54a98b8a6084de33ea3accb8decd8cda867f205f87df68d838f2d2cde2d1|6eb7245db8f546013a9926149015c1f5ec5a1618d6e4d3635b0ab6959d5b5fdb|grounding|analystCommentary|$0.4M",
  "MDU|0000067716-26-000072|7dfd54a98b8a6084de33ea3accb8decd8cda867f205f87df68d838f2d2cde2d1|6eb7245db8f546013a9926149015c1f5ec5a1618d6e4d3635b0ab6959d5b5fdb|grounding|sections.financials.incomeCommentary|$0.4M",
  "NVDA|0001045810-26-000075|96408ee70d2f07ad2d7ca8f9a3c669ce75c10b016dc4b32bb6e19a06a18d1395|18749fbef886bfd281a1d2695e3ad678c3a6d0571a84a5a780ec401e33c00b40|grounding|sections.financials.balanceCommentary|400 times",
]);

/**
 * The judgment each entry was approved against, one line per entry. A re-key (a renderer wording change moved every
 * surface hash) edits only the surface hash inside FROZEN_KEYS; this list never changes except to shrink with a fix round.
 */
const FROZEN_JUDGMENTS = [
  "LH|68ac4715cee0131281b68b90640a6e844ad9d267ac0264f8bd963123d46a169c",
  "LH|68ac4715cee0131281b68b90640a6e844ad9d267ac0264f8bd963123d46a169c",
  "LLY|9f262de96beee34bd73e30500e22606e7435611b3b72f4a020599812e9d8163f",
  "LLY|9f262de96beee34bd73e30500e22606e7435611b3b72f4a020599812e9d8163f",
  "MDU|7dfd54a98b8a6084de33ea3accb8decd8cda867f205f87df68d838f2d2cde2d1",
  "MDU|7dfd54a98b8a6084de33ea3accb8decd8cda867f205f87df68d838f2d2cde2d1",
  "NVDA|96408ee70d2f07ad2d7ca8f9a3c669ce75c10b016dc4b32bb6e19a06a18d1395",
];
const judgmentOf = (key: string) => { const [ticker, , judgment] = key.split("|"); return `${ticker}|${judgment}`; };
const sorted = (xs: string[]) => [...xs].sort();

describe("the committed exception file", () => {
  const file = GroundingExceptionsFile.parse(JSON.parse(readFileSync("lib/synth/grounding-exceptions.json", "utf8")));
  it("pins keys whose judgment hashes are exactly the approved ones: a re-key may move a surface hash, never a judgment", () => {
    expect(sorted([...FROZEN_KEYS].map(judgmentOf))).toEqual(sorted(FROZEN_JUDGMENTS));
  });
  it("holds entries whose judgment hashes are a sub-multiset of the approved ones", () => {
    const left = [...FROZEN_JUDGMENTS];
    for (const e of file.entries) {
      const at = left.indexOf(`${e.ticker}|${e.judgmentSha256}`);
      expect(at, exceptionKey(e)).toBeGreaterThanOrEqual(0);
      left.splice(at, 1);
    }
  });
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
  // A source-order assertion, not a behavioural one: scripts/synth-build.ts is a top-level script that reads the pack,
  // judgment and desk and calls process.exit as it runs, so it cannot be imported into a test without first being split
  // into a function (a larger change than this guard warrants). The fail(…, "<stage>") call sites are what this pins.
  it("runs the exceptions stage after the input check and before validate", () => {
    const src = readFileSync("scripts/synth-build.ts", "utf8");
    const at = (stage: string) => src.indexOf(`"${stage}")`);
    expect(at("input check")).toBeGreaterThan(0);
    expect(at("exceptions")).toBeGreaterThan(at("input check"));
    expect(at("validate")).toBeGreaterThan(at("exceptions"));
  });
});
