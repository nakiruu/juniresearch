import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
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

describe("extractSections tolerates letter-spaced headings (Oracle FY26 10-K style)", () => {
  it("finds the risk-factors body when its heading is letter-spaced", () => {
    const stub = [
      "TABLE OF CONTENTS",
      "Item 1A.",
      "Risk Factors",
      "15",
      "Item 1B.",
      "Unresolved Staff Comments",
      "34",
      "Item 1C.",
      "Cybersecurity",
      "34",
      "Item 2.",
      "Properties",
      "36",
      "PART I",
      "Item 1A. R isk Factors",
      "We operate in rapidly changing economic and technological environments that expose us to a variety of risks and uncertainties. " +
        "Additional risk factor detail follows in this paragraph to pad the section well past the two-hundred character minimum body length required by the extractor. ".repeat(3),
      "Item 1B. Unresolve d Staff Comments",
      "None.",
    ].join("\n");

    const { riskFactors } = extractSections(stub, "10-K");
    expect(riskFactors).not.toBeNull();
    expect(riskFactors!.text.startsWith("Item 1A. R isk Factors")).toBe(true);
  });

  it("finds the MD&A body when its heading splits inside \"Discussion\"", () => {
    const stub = [
      "TABLE OF CONTENTS",
      "Item 7.",
      "Management's Discussion and Analysis of Financial Condition and Results of Operations",
      "40",
      "Item 7A.",
      "Quantitative and Qualitative Disclosures About Market Risk",
      "55",
      "PART II",
      "Item 7. Management's Discu ssion and Analysis o f Financial Condition and Results of Operations",
      "Our revenue and operating margin both grew during the period under review. " +
        "Additional discussion detail follows in this paragraph to pad the section well past the two-hundred character minimum body length required by the extractor. ".repeat(3),
      "Item 7A. Quantitative and Qualitative Disclosures About Market Risk",
      "We are exposed to market risk primarily related to interest rates and foreign currency.",
    ].join("\n");

    const { mda } = extractSections(stub, "10-K");
    expect(mda).not.toBeNull();
    expect(mda!.text.startsWith("Item 7. Management's Discu ssion")).toBe(true);
  });
});

describe("extractSections on the ORCL FY26 10-K (real filing)", () => {
  const orclPath = "data/raw/ORCL/0001193125-26-277521/edgar-primary.html";

  it.skipIf(!existsSync(orclPath))("finds risk factors and MD&A despite letter-spaced body headings", () => {
    const orclHtml = readFileSync(orclPath, "utf8");
    const orclText = htmlToText(orclHtml);
    const s = extractSections(orclText, "10-K");

    expect(s.riskFactors).not.toBeNull();
    expect(s.riskFactors!.text.length).toBeGreaterThan(5000);
    expect(s.riskFactors!.truncated).toBe(true);

    expect(s.mda).not.toBeNull();
    expect(s.mda!.truncated).toBe(true);
  });
});
