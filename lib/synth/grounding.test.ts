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
});

describe("the allowed index on the AVGO FactPack", () => {
  const index = buildAllowedIndex(pack, []);
  const ok = (s: string) => checkGrounding({ p: s }, index);
  it("accepts figures that round from FactPack values at their own precision", () => {
    expect(ok("Revenue of $29.6B rose 86% YoY; FY25 revenue was $63.9B; EPS of $4.77")).toEqual([]);
  });
  it("accepts figures within 0.5% of a FactPack value", () => {
    expect(ok("consensus target $509.61, market cap ~$1.72T, P/E of 44.9x")).toEqual([]);
  });
  it("accepts a figure only because the transcript contains it", () => {
    expect(ok("AI semiconductor revenue of $16.7 billion")).toEqual([]);
    const noContext = { ...pack, context: { description: { ...pack.context.description, text: "" }, mdaExcerpt: null, riskFactorsExcerpt: null, transcriptHighlights: null, headlines: [] } };
    expect(buildAllowedIndex(noContext, []).has(numericTokens("$16.7 billion")[0])).toBe(false);
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

describe("stringLeaves", () => {
  it("walks nested objects and arrays with dotted, indexed paths", () => {
    expect(stringLeaves({ a: { b: ["x", "y"] }, c: 1, d: "z" })).toEqual([
      { path: "a.b[0]", text: "x" }, { path: "a.b[1]", text: "y" }, { path: "d", text: "z" },
    ]);
  });
});
