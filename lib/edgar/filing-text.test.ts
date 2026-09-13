import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { htmlToText, capAtSentence, extractSections, EXCERPT_CAP, MDA_CAP } from "@/lib/edgar/filing-text";

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
    expect(s.mda!.text.length).toBeGreaterThan(2000);
    expect(s.mda!.text.toLowerCase()).toContain("revenue");
  });
  it("finds risk factors", () => {
    expect(s.riskFactors).not.toBeNull();
    expect(s.riskFactors!.text.toLowerCase()).toContain("risk");
  });
  it("caps each section at its own limit and says so", () => {
    expect(s.mda!.text.length).toBeLessThanOrEqual(MDA_CAP);
    expect(s.riskFactors!.text.length).toBeLessThanOrEqual(EXCERPT_CAP);
    expect(s.mda!.truncated).toBe(true);
    expect(s.riskFactors!.truncated).toBe(true);
  });
  it("returns null for a section that is absent", () => {
    expect(extractSections("Item 1. Nothing here.", "10-K")).toEqual({ mda: null, riskFactors: null });
  });
});
