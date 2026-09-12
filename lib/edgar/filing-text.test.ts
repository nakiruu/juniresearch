import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { htmlToText, capAtSentence, extractSections, EXCERPT_CAP } from "@/lib/edgar/filing-text";

const html = readFileSync("data/raw/AVGO/0001730168-26-000080/edgar-primary.html", "utf8");
const text = htmlToText(html);

describe("htmlToText", () => {
  it("strips tags and decodes common entities", () => {
    expect(htmlToText("<p>Revenue &amp; margin&nbsp;grew</p><p>Next</p>")).toBe("Revenue & margin grew\nNext");
  });
  it("drops scripts and styles", () => {
    expect(htmlToText("<style>p{}</style><script>x()</script><p>ok</p>")).toBe("ok");
  });
});

describe("capAtSentence", () => {
  it("returns short text untouched", () => {
    expect(capAtSentence("Short. Text.", 100)).toEqual({ text: "Short. Text.", truncated: false });
  });
  it("cuts at a sentence boundary and flags truncation", () => {
    const long = "First sentence. Second sentence. " + "x".repeat(200);
    const out = capAtSentence(long, 40);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("First sentence. Second sentence.");
  });
});

describe("extractSections on the AVGO 10-Q", () => {
  const s = extractSections(text, "10-Q");
  it("finds the MD&A body, not the table-of-contents entry", () => {
    expect(s.mda).not.toBeNull();
    expect(s.mda!.length).toBeGreaterThan(2000);
    expect(s.mda!.toLowerCase()).toContain("revenue");
  });
  it("finds risk factors", () => {
    expect(s.riskFactors).not.toBeNull();
    expect(s.riskFactors!.toLowerCase()).toContain("risk");
  });
  it("caps each section", () => {
    expect(s.mda!.length).toBeLessThanOrEqual(EXCERPT_CAP);
    expect(s.riskFactors!.length).toBeLessThanOrEqual(EXCERPT_CAP);
  });
  it("returns null for a section that is absent", () => {
    expect(extractSections("Item 1. Nothing here.", "10-K")).toEqual({ mda: null, riskFactors: null });
  });
});
