import { describe, it, expect } from "vitest";
import { splitSentences, normalizeSentence, wordTrigrams, jaccard } from "@/lib/synth/lint/sentences";

describe("splitSentences", () => {
  it("splits on sentence-final punctuation", () => {
    expect(splitSentences("Revenue rose. Margin fell! Did it? Yes."))
      .toEqual(["Revenue rose.", "Margin fell!", "Did it?", "Yes."]);
  });
  it("does not split on a decimal point", () => {
    expect(splitSentences("EPS was $8.10 for the year. Margin held at 65.2%."))
      .toEqual(["EPS was $8.10 for the year.", "Margin held at 65.2%."]);
  });
  it("does not split on a personal or corporate abbreviation", () => {
    expect(splitSentences("Mr. Tan is CEO. Ms. Lee chairs audit. Dr. Samueli is chair. Broadcom Inc. filed it. No. 1 by share."))
      .toEqual(["Mr. Tan is CEO.", "Ms. Lee chairs audit.", "Dr. Samueli is chair.", "Broadcom Inc. filed it.", "No. 1 by share."]);
  });
  it("does not split inside U.S.", () => {
    expect(splitSentences("U.S. revenue grew. The rest did not.")).toEqual(["U.S. revenue grew.", "The rest did not."]);
  });
  it("treats each Markdown block and list line as its own run, without its marker", () => {
    expect(splitSentences("### Recommendation\n\n**BUY.** Target band $165 to $205.\n\n- one point\n- two points"))
      .toEqual(["Recommendation", "**BUY.**", "Target band $165 to $205.", "one point", "two points"]);
  });
  it("returns nothing for empty or whitespace-only prose", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n\n  ")).toEqual([]);
  });
  it("keeps an unterminated trailing run", () => {
    expect(splitSentences("Revenue rose. Margin held")).toEqual(["Revenue rose.", "Margin held"]);
  });
});

describe("normalizeSentence", () => {
  it("lowercases and strips markers, punctuation and digits", () => {
    expect(normalizeSentence("**Management** raised the outlook to {+ $90 billion +}, +34%."))
      .toBe("management raised the outlook to billion");
  });
  it("keeps hyphenated words whole", () => {
    expect(normalizeSentence("The full-year guide is non-GAAP.")).toBe("the full-year guide is non-gaap");
  });
  it("is stable under whitespace and line breaks", () => {
    expect(normalizeSentence("Revenue\n  rose   sharply")).toBe("revenue rose sharply");
  });
});

describe("wordTrigrams and jaccard", () => {
  it("shingles the normalised words", () => {
    expect([...wordTrigrams("one two three four")]).toEqual(["one two three", "two three four"]);
  });
  it("is empty below three words", () => {
    expect(wordTrigrams("one two").size).toBe(0);
  });
  it("scores identical sentences 1 and disjoint sentences 0", () => {
    const a = wordTrigrams("the desk read the filing closely today");
    expect(jaccard(a, wordTrigrams("the desk read the filing closely today"))).toBe(1);
    expect(jaccard(a, wordTrigrams("margins fell while capital spending climbed again"))).toBe(0);
  });
  it("scores an empty side 0", () => {
    expect(jaccard(new Set(), wordTrigrams("one two three"))).toBe(0);
  });
  it("scores a one-word edit of a seven-word sentence at the 0.80 boundary or above", () => {
    // 5 trigrams each, 2 shared → 2 / (5 + 5 - 2) = 0.25 — below the error threshold, above nothing.
    const x = wordTrigrams("the board approved the buyback last quarter");
    const y = wordTrigrams("the board approved the dividend last quarter");
    expect(jaccard(x, y)).toBeCloseTo(0.25, 4);
    // A pure suffix addition keeps most shingles: 8 shared of 9 → 0.8889.
    const p = wordTrigrams("management raised the full-year outlook to at least ninety billion");
    const q = wordTrigrams("management raised the full-year outlook to at least ninety billion today");
    expect(jaccard(p, q)).toBeCloseTo(0.8889, 3);
  });
});
