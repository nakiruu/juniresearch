import { describe, it, expect } from "vitest";
import { numericTokens, buildAllowedIndex, checkGrounding, AllowedIndex } from "@/lib/synth/grounding";
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
  it("allow-lists a yearless month-name date but still tokenizes a count after a month", () => {
    expect(numericTokens("fiscal years ended December 31 and quarters ended Sept. 30")).toEqual([]);
    expect(numericTokens("in May 25 stores opened").map((t) => t.raw)).toEqual([]);
    expect(numericTokens("since December, 31 stores opened").map((t) => t.raw)).toEqual(["31"]);
  });
  it("allow-lists period phrases such as 52-week but still tokenizes '52 weeks'", () => {
    expect(numericTokens("the 52-week low and a 12-month view over a 90-day window")).toEqual([]);
    expect(numericTokens("over 52 weeks").map((t) => t.raw)).toEqual(["52"]);
  });
  it("checks both ends of a hyphenated range", () => {
    expect(numericTokens("up 40-50% next year").map((t) => t.raw)).toEqual(["40", "50%"]);
    expect(numericTokens("300-400 basis points").map((t) => t.raw)).toEqual(["300", "400 basis points"]);
    expect(numericTokens("300-400 basis points").map((t) => t.kind)).toEqual(["bp", "bp"]);
  });
  it("keeps the high end of a small range even though it looks like a day", () => {
    expect(numericTokens("up 20-30% next year").map((t) => t.raw)).toEqual(["20", "30%"]);
    expect(numericTokens("10-25 units of growth").map((t) => t.raw)).toEqual(["25"]);
  });
});

describe("numericTokens v2", () => {
  type Want = { raw: string; kind: string; currency?: string | null; abs: number; sign?: number; resolution: number; tz?: number; band?: number };
  const one = (text: string, want: Want) => it(`${JSON.stringify(text)} → ${want.raw}`, () => {
    const got = numericTokens(text);
    expect(got).toHaveLength(1);
    const t = got[0];
    expect({ raw: t.raw, kind: t.kind }).toEqual({ raw: want.raw, kind: want.kind });
    expect(t.abs).toBeCloseTo(want.abs, 9);
    expect(t.resolution).toBeCloseTo(want.resolution, 12);
    expect(t.currency).toBe(want.currency === undefined ? (want.kind === "money" ? "$" : null) : want.currency);
    expect(t.sign).toBe(want.sign ?? 0);
    if (want.tz != null) expect(t.tz).toBe(want.tz);
    expect(t.band).toBe(want.band);
  });
  const none = (text: string) => it(`${JSON.stringify(text)} → no token`, () => expect(numericTokens(text)).toEqual([]));
  const raws = (text: string, want: string[]) => it(`${JSON.stringify(text)} → ${JSON.stringify(want)}`, () => expect(numericTokens(text).map((t) => t.raw)).toEqual(want));

  describe("scales", () => {
    one("$1.5bn", { raw: "$1.5bn", kind: "money", abs: 1.5e9, resolution: 1e8 });
    one("$5mn", { raw: "$5mn", kind: "money", abs: 5e6, resolution: 1e6 });
    one("$5mm", { raw: "$5mm", kind: "money", abs: 5e6, resolution: 1e6 });
    one("$500K", { raw: "$500K", kind: "money", abs: 5e5, resolution: 1e3, tz: 2 });
    one("$5m", { raw: "$5m", kind: "money", abs: 5e6, resolution: 1e6 });
    one("$1.2b", { raw: "$1.2b", kind: "money", abs: 1.2e9, resolution: 1e8 });
    one("$12.3k", { raw: "$12.3k", kind: "money", abs: 12300, resolution: 100 });
    one("12.3k employees", { raw: "12.3", kind: "plain", abs: 12.3, resolution: 0.1 });    // lowercase k/m/b scale only after a currency
    one("a $63.9-billion top line", { raw: "$63.9-billion", kind: "money", abs: 63.9e9, resolution: 1e8 });
  });
  describe("signs", () => {
    one("(12.3)%", { raw: "(12.3)%", kind: "pct", abs: 12.3, sign: -1, resolution: 0.1 });
    one("FY27E ($24.99)", { raw: "($24.99)", kind: "money", abs: 24.99, resolution: 0.01 });  // a prose parenthetical, not a negative
    one("($1.45) loss", { raw: "($1.45)", kind: "money", abs: 1.45, resolution: 0.01 });
    one("$-0.08", { raw: "$-0.08", kind: "money", abs: 0.08, sign: -1, resolution: 0.01 });
    one("-$0.08", { raw: "-$0.08", kind: "money", abs: 0.08, sign: -1, resolution: 0.01 });
    one("−$1.3B", { raw: "−$1.3B", kind: "money", abs: 1.3e9, sign: -1, resolution: 1e8 });
    it("applies the sign to value and magnitude", () => {
      const [t] = numericTokens("-$1.3B");
      expect([t.value, t.magnitude]).toEqual([-1.3, -1.3e9]);
    });
  });
  describe("units", () => {
    one("40 bps", { raw: "40 bps", kind: "bp", abs: 0.4, resolution: 0.01, tz: 1 });
    one("150bp", { raw: "150bp", kind: "bp", abs: 1.5, resolution: 0.01 });
    one("5.4 points", { raw: "5.4 points", kind: "pp", abs: 5.4, resolution: 0.1 });
    one("0.5 point", { raw: "0.5 point", kind: "pp", abs: 0.5, resolution: 0.1 });
    one("0.5\npt", { raw: "0.5\npt", kind: "pp", abs: 0.5, resolution: 0.1 });
    one("(0.7)\npts", { raw: "(0.7)\npts", kind: "pp", abs: 0.7, resolution: 0.1 });
    one("a 3.1-percentage-point gain", { raw: "3.1-percentage-point", kind: "pp", abs: 3.1, resolution: 0.1 });
    one("0.50×", { raw: "0.50×", kind: "mult", abs: 0.5, resolution: 0.01 });
    one("2.6 times", { raw: "2.6 times", kind: "mult", abs: 2.6, resolution: 0.1 });
    one("about 2.6X leverage", { raw: "2.6X", kind: "mult", abs: 2.6, resolution: 0.1 });
    none("met 4 times");
    one("over 400 times", { raw: "400 times", kind: "mult", abs: 400, resolution: 1 });
    none("a 10-point plan");                                                          // a hyphenated unit word counts only as "-percentage-point"
  });
  describe("currencies", () => {
    one("€12", { raw: "€12", kind: "money", currency: "€", abs: 12, resolution: 1 });
    one("£5", { raw: "£5", kind: "money", currency: "£", abs: 5, resolution: 1 });
    one("US$5", { raw: "US$5", kind: "money", currency: "$", abs: 5, resolution: 1 });
    one("a C$5.2 billion deal", { raw: "C$5.2 billion", kind: "money", currency: "C$", abs: 5.2e9, resolution: 1e8 });
    one("HK$12 per share", { raw: "HK$12", kind: "money", currency: "HK$", abs: 12, resolution: 1 });
    one("¥120 billion of sales", { raw: "¥120 billion", kind: "money", currency: "¥", abs: 120e9, resolution: 1e9 });
  });
  describe("layout", () => {
    one("$ 15,952", { raw: "$ 15,952", kind: "money", abs: 15952, resolution: 1 });
    one("$\n15,952", { raw: "$\n15,952", kind: "money", abs: 15952, resolution: 1 });
    one("13.3\n%", { raw: "13.3\n%", kind: "pct", abs: 13.3, resolution: 0.1 });
    one("0.2 %", { raw: "0.2 %", kind: "pct", abs: 0.2, resolution: 0.1 });
    one("$\n.07", { raw: "$\n.07", kind: "money", abs: 0.07, resolution: 0.01 });
    one("(.4)", { raw: "(.4)", kind: "plain", abs: 0.4, resolution: 0.1 });
  });
  describe("words", () => {
    one("20 percent", { raw: "20 percent", kind: "pct", abs: 20, resolution: 1, tz: 1 });
    one("2.3 per cent", { raw: "2.3 per cent", kind: "pct", abs: 2.3, resolution: 0.1 });
    none("February 17, 2026 point to");
  });
  describe("bands", () => {
    one("low $190s", { raw: "$190s", kind: "money", abs: 190, resolution: 1, band: 10 });
    one("$3s", { raw: "$3s", kind: "money", abs: 3, resolution: 1, band: 1 });
    one("mid-80s", { raw: "80s", kind: "plain", abs: 80, resolution: 1, band: 10 });
    none("the 1990s");
  });
  describe("ranges", () => {
    const kinds = (text: string, want: [string, string, number][]) => it(`${JSON.stringify(text)} → ${JSON.stringify(want)}`, () => {
      const got = numericTokens(text);
      expect(got.map((t) => [t.raw, t.kind])).toEqual(want.map(([r, k]) => [r, k]));
      got.forEach((t, i) => expect(t.abs).toBeCloseTo(want[i][2], 6));
    });
    kinds("40-50%", [["40", "pct", 40], ["50%", "pct", 50]]);
    kinds("5 to 7 percent", [["5", "pct", 5], ["7 percent", "pct", 7]]);
    kinds("$350–600", [["$350", "money", 350], ["600", "money", 600]]);
    kinds("$1.2–1.5 billion", [["$1.2", "money", 1.2e9], ["1.5 billion", "money", 1.5e9]]);
    kinds("$1.750 to $1.810 billion", [["$1.750", "money", 1.75e9], ["$1.810 billion", "money", 1.81e9]]);
    kinds("$415 to $455 million", [["$415", "money", 415e6], ["$455 million", "money", 455e6]]);
    kinds("between $8.15 and $8.25 billion", [["$8.15", "money", 8.15e9], ["$8.25 billion", "money", 8.25e9]]);
    kinds("between 5 and 7 percent", [["5", "pct", 5], ["7 percent", "pct", 7]]);
    kinds("$45 and $1.2 billion", [["$45", "money", 45], ["$1.2 billion", "money", 1.2e9]]);      // "and" joins only after "between"
    kinds("fiscal year 2027 to $1.225 billion", [["$1.225 billion", "money", 1.225e9]]);           // a year never joins a range
    raws("10-25 units", ["25"]);
  });
  describe("trailing zeros", () => {
    const tz = (text: string, want: number) => it(`${JSON.stringify(text)} has tz ${want}`, () => expect(numericTokens(text).map((t) => t.tz)).toEqual([want]));
    tz("$500 million", 2);
    tz("50 bps", 1);
    tz("$63,900 million", 2);
    tz("40%", 1);
    tz("$4.50", 0);                                                                    // decimals are significant
    it("counts significant digits as written", () => expect(numericTokens("$500 million")[0].sig).toBe(3));
  });
  // A documented quirk: "B" after a bare number is a scale, so a rating count reads as billions.
  one("54 B", { raw: "54 B", kind: "plain", abs: 54e9, resolution: 1e9 });
  it("records each token's offset in the text", () => {
    const text = "up 8% to $1.2B";
    expect(numericTokens(text).map((t) => text.slice(t.index, t.end))).toEqual(["8%", "$1.2B"]);
  });

  describe("allow-list: labels, index names, day-first dates, period phrases", () => {
    for (const text of ["Schedule 13G/A", "the 14A", "13G", "Item 1A", "Note 14", "Tier 1", "Section 232", "Phase 3", "ISO 9001", "FAST-41", "COVID-19",
      "Intel 14A", "30 September 2026", "a 52/53-week year", "the past 52 weeks", "S&P 500", "Russell 1000", "Russell 2000", "Fortune 500", "401(k)", "24/7",
      "a 1-for-10 split", "Level 3 inputs", "Gen 5", "Rule 10b5-1", "a member of the S&P 500 index", "joined the Russell 1000", "its 401(k) match", "24/7 monitoring"]) none(text);
    raws("over 52 weeks", ["52"]);
    raws("53rd percentile", ["53"]);
    raws("over 25 years", ["25"]);
    raws("in 15 countries", ["15"]);
    raws("14 analysts", ["14"]);
    raws("PDK 0.9", ["0.9"]);                                                          // the label rule covers bare integers only
    it("$14A is money", () => expect(numericTokens("$14A").map((t) => [t.raw, t.kind])).toEqual([["$14", "money"]]));
    it("index mode keeps small counts", () => {
      expect(numericTokens("Acquisitions\n5\n%", "index").map((t) => [t.kind, t.abs])).toEqual([["pct", 5]]);
      expect(numericTokens("growth of 5 stores", "index").map((t) => t.abs)).toEqual([5]);
      expect(numericTokens("growth of 5 stores")).toEqual([]);
    });
  });

  // The reviewer's formats.ts cases (Appendix B): raw:kind, ×scale when not 1, and the sign when written.
  describe("formats.ts cases", () => {
    const show = (text: string) => numericTokens(text).map((t) => `${t.raw}:${t.kind}${t.scale !== 1 ? "×" + t.scale : ""}${t.sign ? (t.sign > 0 ? "+" : "-") : ""}`);
    const CASES: [string, string[]][] = [
      ["a market value of $1.72 trillion", ["$1.72 trillion:money×1000000000000"]],
      ["capex of $500 million", ["$500 million:money×1000000"]],
      ["capex of $0.5 billion", ["$0.5 billion:money×1000000000"]],
      ["about $1.5 billion of revenue", ["$1.5 billion:money×1000000000"]],
      ["FCF of $1.2bn", ["$1.2bn:money×1000000000"]],
      ["FCF of 1.2bn", ["1.2bn:plain×1000000000"]],
      ["FCF of $1.2b", ["$1.2b:money×1000000000"]],
      ["a $5m charge", ["$5m:money×1000000"]],
      ["fees of $12.3K", ["$12.3K:money×1000"]],
      ["about 12.3k employees", ["12.3:plain"]],
      ["a $63.9-billion top line", ["$63.9-billion:money×1000000000"]],
      ["growth of (0.5)%", ["(0.5)%:pct-"]],
      ["growth of -0.5%", ["-0.5%:pct-"]],
      ["margin up 50 bps", ["50 bps:bp"]],
      ["a €12.3 million fine", ["€12.3 million:money×1000000"]],
      ["a $40–47 target", ["$40:money", "47:money"]],
      ["a 40-47 target", ["40:plain", "47:plain"]],
      ["leverage of 2–3x", ["2:mult", "3x:mult"]],
      ["EPS of ($0.12)", ["($0.12):money"]],
      ["EPS of $(0.12)", ["0.12:plain"]],
      ["net debt of −$1.3B", ["−$1.3B:money×1000000000-"]],
      ["net debt of -$1.3 billion", ["-$1.3 billion:money×1000000000-"]],
      ["net cash of $1.3B", ["$1.3B:money×1000000000"]],
      ["a C$5.2 billion deal", ["C$5.2 billion:money×1000000000"]],
      ["HK$12 per share", ["HK$12:money"]],
      ["¥120 billion of sales", ["¥120 billion:money×1000000000"]],
      ["1.2 turns of leverage", ["1.2:plain"]],
      ["about 2.6X leverage", ["2.6X:mult"]],
      ["a 3.1-percentage-point gain", ["3.1-percentage-point:pp"]],
      ["the +10% bar", ["+10%:pct+"]],
      ["one-third of revenue", []],
      ["$63.9 billion of revenue", ["$63.9 billion:money×1000000000"]],
      ["$63,900 million of revenue", ["$63,900 million:money×1000000"]],
      ["63.9 billion dollars", ["63.9 billion:plain×1000000000"]],
      ["USD 63.9 billion", ["63.9 billion:plain×1000000000"]],
      ["about $64 billion", ["$64 billion:money×1000000000"]],
      ["over $60 billion", ["$60 billion:money×1000000000"]],
      ["a 45% margin", ["45%:pct"]],
      ["capex of $1.4 billion", ["$1.4 billion:money×1000000000"]],
      ["capex of $1.41 billion", ["$1.41 billion:money×1000000000"]],
    ];
    for (const [text, want] of CASES) it(JSON.stringify(text), () => expect(show(text)).toEqual(want));
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

describe("AllowedIndex lookup cache", () => {
  it("matches at the figure's own precision and sees values added after a lookup", () => {
    const index = new AllowedIndex();
    const [twoDp] = numericTokens("margin of 12.35%");
    const [oneDp] = numericTokens("margin of 7.1%");
    expect(index.has(twoDp)).toBe(false);          // empty index
    index.add(12.3449);
    expect(index.has(twoDp)).toBe(false);          // 12.3449 rounds to 12.34 at 2dp
    index.add(12.3456);                            // added after the 2dp lookup was cached
    expect(index.has(twoDp)).toBe(true);
    expect(index.has(oneDp)).toBe(false);
    index.add(Number.NaN);                         // non-finite values are ignored
    expect(index.has(oneDp)).toBe(false);
    index.add(7.08);                               // rounds to 7.1 at the token's 1dp
    expect(index.has(oneDp)).toBe(true);
    const [negative] = numericTokens("fell -7.1%"); // a signed token also matches on its absolute value
    expect(index.has(negative)).toBe(true);
  });
});
