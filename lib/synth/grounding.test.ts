import { describe, it, expect } from "vitest";
import { numericTokens, buildAllowedIndex, checkGrounding } from "@/lib/synth/grounding";
import { stringLeaves } from "@/lib/synth/walk";
import { FactPack } from "@/lib/facts/schema";
import { readFileSync } from "node:fs";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));

describe("numericTokens", () => {
  const cases: [string, { raw: string; magnitude: number; kind: string }[]][] = [
    ["revenue of $29.6B rose 86% YoY", [{ raw: "$29.6B", magnitude: 29.6e9, kind: "money" }, { raw: "86%", magnitude: 86, kind: "pct" }]],
    ["AI revenue grew +221% to $16.7 billion", [{ raw: "+221%", magnitude: 221, kind: "pct" }, { raw: "$16.7 billion", magnitude: 16.7e9, kind: "money" }]],
    ["trades at 44.9x earnings and ~19.3x sales", [{ raw: "44.9x", magnitude: 44.9, kind: "mult" }, { raw: "19.3x", magnitude: 19.3, kind: "mult" }]],
    ["a $350–$600 range", [{ raw: "$350", magnitude: 350, kind: "money" }, { raw: "$600", magnitude: 600, kind: "money" }]],
    ["16,700 employees and 4.76B shares", [{ raw: "16,700", magnitude: 16700, kind: "plain" }, { raw: "4.76B", magnitude: 4.76e9, kind: "plain" }]],
    ["-3.3% in FY2024", [{ raw: "-3.3%", magnitude: -3.3, kind: "pct" }]],
  ];
  for (const [text, want] of cases) {
    it(`extracts ${JSON.stringify(text)}`, () => {
      expect(numericTokens(text).map((t) => ({ raw: t.raw, magnitude: t.magnitude, kind: t.kind }))).toEqual(want);
    });
  }
  it("allow-lists small counts, years, quarter and fiscal labels, dates, and form names", () => {
    expect(numericTokens("six customers, 3 hyperscalers, Q3'26 and Q4 FY2026, ended Aug 2, 2026, the 10-Q, a 10:1 split, since 2023")).toEqual([]);
  });
  it("records precision as the number of decimals written", () => {
    expect(numericTokens("$361.99 and 0.855 and 68%").map((t) => t.precision)).toEqual([2, 3, 0]);
  });
  it("treats a typographic apostrophe in quarter shorthand like a straight one", () => {
    expect(numericTokens("Q3'26 revenue and Q4'26 guidance")).toEqual([]);
  });
  it("allow-lists bare years only through 2040", () => {
    expect(numericTokens("by 2040 and beyond").map((t) => t.raw)).toEqual([]);
    expect(numericTokens("by 2045 and beyond").map((t) => t.raw)).toEqual(["2045"]);
  });
  it("allow-lists month-name and ISO dates with days above 12", () => {
    expect(numericTokens("the quarter ended August 30, 2026 and December 31, 2025; as of 2026-08-30")).toEqual([]);
  });
  it("allow-lists period phrases such as 52-week but still tokenizes '52 weeks'", () => {
    expect(numericTokens("the 52-week low and a 12-month view over a 90-day window")).toEqual([]);
    expect(numericTokens("over 52 weeks").map((t) => t.raw)).toEqual(["52"]);
  });
  it("checks both ends of a hyphenated range", () => {
    expect(numericTokens("up 40-50% next year").map((t) => t.raw)).toEqual(["40", "50%"]);
    expect(numericTokens("300-400 basis points").map((t) => t.raw)).toEqual(["300", "400"]);
  });
  it("keeps the high end of a small range even though it looks like a day", () => {
    expect(numericTokens("up 20-30% next year").map((t) => t.raw)).toEqual(["20", "30%"]);
    expect(numericTokens("10-25 units of growth").map((t) => t.raw)).toEqual(["25"]);
  });
});

describe("the allowed index on the AVGO FactPack", () => {
  const index = buildAllowedIndex(pack, []);
  const ok = (s: string) => checkGrounding({ p: s }, index);
  it("accepts figures that round from FactPack values at their own precision", () => {
    expect(ok("Revenue of $29.6B rose 86% YoY; FY25 revenue was $63.9B; EPS of $4.77")).toEqual([]);
  });
  it("accepts figures that round from FactPack values at a coarser precision", () => {
    expect(ok("consensus target $509.61, market cap ~$1.72T, P/E of 44.9x")).toEqual([]);
  });
  it("accepts a figure only because the transcript contains it", () => {
    // "$16.7 billion" would also round from FY22 operating cash flow (16.736B) — a numeric index cannot attribute,
    // so the transcript-only case uses guided Q4 AI revenue, which no FactPack number rounds to.
    expect(ok("management guided Q4 AI revenue to $21.7 billion")).toEqual([]);
    const noContext = { ...pack, context: { description: { ...pack.context.description, text: "" }, mdaExcerpt: null, riskFactorsExcerpt: null, riskFactorsSource: null, pressRelease: null, proxyStatement: null, transcriptHighlights: null, headlines: [] } };
    expect(buildAllowedIndex(noContext, []).has(numericTokens("$21.7 billion")[0])).toBe(false);
  });
  it("rejects a figure that is nowhere in the facts or the context, naming the field and the token", () => {
    const issues = checkGrounding({ sections: { thesis: { body: "Revenue of $17.9B" } } }, index);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("sections.thesis.body");
    expect(issues[0].message).toMatch(/\$17\.9B.*not in the facts or the captured context/);
  });
  it("indexes extra text, such as the rendered facts block", () => {
    const withExtra = buildAllowedIndex(pack, ["Custom metric 123.4x"]);
    expect(checkGrounding({ p: "at 123.4x on our metric" }, withExtra)).toEqual([]);
    expect(checkGrounding({ p: "at 123.4x on our metric" }, index)).toHaveLength(1);
  });
});

describe("the press release is indexed for grounding (ORCL pack)", () => {
  const orclPack = FactPack.parse(JSON.parse(readFileSync("data/facts/ORCL/0001193125-26-389274.json", "utf8")));
  it("accepts a figure that appears only in the press-release excerpt (RPO, quoted nowhere else)", () => {
    expect(orclPack.context.pressRelease?.text).toContain("$664 billion");
    const index = buildAllowedIndex(orclPack, []);
    expect(checkGrounding({ p: "RPO grew to $664 billion" }, index)).toEqual([]);
  });
  it("rejects that same figure when the pack has no press release", () => {
    const noPressRelease = { ...orclPack, context: { ...orclPack.context, pressRelease: null } };
    const index = buildAllowedIndex(noPressRelease, []);
    expect(checkGrounding({ p: "RPO grew to $664 billion" }, index)).toHaveLength(1);
  });
});

describe("stringLeaves", () => {
  it("walks nested objects and arrays with dotted, indexed paths", () => {
    expect(stringLeaves({ a: { b: ["x", "y"] }, c: 1, d: "z" })).toEqual([
      { path: "a.b[0]", text: "x" }, { path: "a.b[1]", text: "y" }, { path: "d", text: "z" },
    ]);
  });
});

describe("the proxy statement is indexed for grounding", () => {
  const orclPack = FactPack.parse(JSON.parse(readFileSync("data/facts/ORCL/0001193125-26-389274.json", "utf8")));
  const proxyStatement = { text: "Compensation discussion and analysis:\nThe CEO's total compensation was $138,713,110 for fiscal 2025.", source: "edgar:DEF 14A", asOf: "2025-09-26" };
  it("accepts a figure that appears only in the proxy excerpt", () => {
    const index = buildAllowedIndex({ ...orclPack, context: { ...orclPack.context, proxyStatement } }, []);
    expect(checkGrounding({ p: "total compensation of $138,713,110" }, index)).toEqual([]);
  });
  it("rejects it when the pack carries no proxy", () => {
    const index = buildAllowedIndex({ ...orclPack, context: { ...orclPack.context, proxyStatement: null } }, []);
    expect(checkGrounding({ p: "total compensation of $138,713,110" }, index)).toHaveLength(1);
  });
});
