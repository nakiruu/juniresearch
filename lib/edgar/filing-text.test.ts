import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { htmlToText, capAtSentence, extractSections, extractCoverShares, extractProxySections, proxyExcerpt, EXCERPT_CAP, MDA_CAP, PROXY_CAPS } from "@/lib/edgar/filing-text";

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

describe("extractCoverShares", () => {
  it("reads the cover-page share count in both common phrasings", () => {
    expect(extractCoverShares("The number of shares of registrant's common stock outstanding as of September 7, 2026 was: 3,023,736,000")).toBe(3023736000);
    expect(extractCoverShares("As of August 29, 2026, the registrant had 4,756,442,000 shares of common stock outstanding.")).toBe(4756442000);
    // Matches the strict "outstanding as of <date> ... N" pattern but the count is below the 1e8 floor —
    // this is what the floor rejects, not a failure to match any pattern.
    expect(extractCoverShares("... shares of common stock outstanding as of June 12, 2026: 12,000,000")).toBeNull();
    expect(extractCoverShares("no cover here")).toBeNull();
  });

  it("finds the strict pattern beyond the 30,000-character head window (a 10-K's XBRL/exhibit preamble)", () => {
    const preamble = "x".repeat(35000);
    const text = `${preamble}\nNumber of shares of common stock outstanding as of June 12, 2026: 2,880,471,000 .`;
    expect(extractCoverShares(text)).toBe(2880471000);
  });
});

describe("extractCoverShares on the ORCL FY26 10-K (real filing)", () => {
  const orclPath = "data/raw/ORCL/0001193125-26-277521/edgar-primary.html";

  it.skipIf(!existsSync(orclPath))("finds the cover-page share count past the 30,000-character head window", () => {
    const orclHtml = readFileSync(orclPath, "utf8");
    const orclText = htmlToText(orclHtml);
    expect(extractCoverShares(orclText)).toBe(2880471000);
  });
});

describe("extractProxySections on a synthetic DEF 14A", () => {
  const filler = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed} sentence ${i + 1}.`).join(" ");
  const proxy = [
    "TABLE OF CONTENTS",
    "Corporate Governance 12",
    "Compensation Discussion and Analysis 40",
    "Security Ownership of Certain Beneficial Owners and Management 88",
    "Transactions with Related Persons 92",
    "",
    "CORPORATE GOVERNANCE",
    "Director Independence",
    filler(20, "The Board has determined that each non-employee director is independent"),
    "Board Committees",
    filler(10, "The Audit Committee met nine times"),
    "",
    "C ompensation D iscussion and A nalysis",
    filler(60, "Our executive compensation program ties pay to performance"),
    "Compensation Committee Report",
    filler(5, "The Compensation Committee has reviewed the CD&A"),
    "",
    "Security Ownership of Certain Beneficial Owners and Management",
    filler(25, "The following table shows beneficial ownership as of the record date"),
    "Transactions with Related Persons",
    filler(15, "Our Related Person Transactions Policy requires approval by the Audit Committee"),
    "Delinquent Section 16(a) Reports",
    filler(4, "Based on our review no reports were late"),
  ].join("\n");

  const sections = extractProxySections(proxy);
  it("finds the body of each governance section, not its table-of-contents entry, tolerating letter-spaced headings", () => {
    expect(sections.compensation).toMatch(/^C ompensation D iscussion/);
    expect(sections.compensation).toContain("ties pay to performance sentence 60.");
    expect(sections.compensation).not.toContain("Compensation Committee has reviewed");
    expect(sections.board).toMatch(/^Director Independence/);
    expect(sections.board).toContain("Audit Committee met nine times sentence 10.");
    expect(sections.ownership).toMatch(/^Security Ownership/);
    expect(sections.ownership).toContain("Related Person Transactions Policy");
    expect(sections.ownership).not.toContain("no reports were late");
  });
  it("returns null for a section the document does not carry", () => {
    expect(extractProxySections("Nothing to see here.")).toEqual({ compensation: null, board: null, ownership: null });
  });
  it("joins the present sections under fixed labels, capping each at its own budget", () => {
    const ex = proxyExcerpt(sections)!;
    expect(ex.text).toMatch(/^Board and director independence:\n/);
    expect(ex.text).toContain("\n\nCompensation discussion and analysis:\n");
    expect(ex.text).toContain("\n\nSecurity ownership and related-person transactions:\n");
    expect(ex.truncated).toBe(false);
    const capped = proxyExcerpt({ ...sections, compensation: filler(4000, "Pay") })!;
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(PROXY_CAPS.board + PROXY_CAPS.compensation + PROXY_CAPS.ownership + 200);
    expect(proxyExcerpt({ compensation: null, board: null, ownership: null })).toBeNull();
  });
});

describe("extractProxySections on the ORCL FY25 proxy (real filing)", () => {
  const proxyPath = "data/raw/ORCL/0001193125-26-389274/edgar-proxy.html";
  const proxyText = existsSync(proxyPath) ? htmlToText(readFileSync(proxyPath, "utf8")) : null;
  it("finds all three governance sections in their bodies, not the contents", () => {
    if (!proxyText) return;
    const s = extractProxySections(proxyText);
    expect(s.board).toMatch(/^Board of Directors and Director Independence/);
    expect(s.board!.length).toBeGreaterThan(3000);
    // The CD&A opens with its own mini contents naming the Compensation Committee Report; that line must not end the section.
    expect(s.compensation).toMatch(/^Compensation Discussion and Analysis/);
    expect(s.compensation!.length).toBeGreaterThan(20000);
    expect(s.ownership).toMatch(/^SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT/);
    expect(s.ownership!.length).toBeGreaterThan(4000);
    // Bodies, not contents entries: no bare page-number lines near the top, and the real opening sentences.
    for (const body of [s.board!, s.compensation!, s.ownership!]) expect(body.slice(0, 400)).not.toMatch(/\n\d{1,3}\n/);
    expect(s.compensation).toContain("This Compensation Discussion and Analysis describes our fiscal 2025 executive compensation program");
    expect(s.ownership).toContain("The following table provides information, as of September 19, 2025");
    expect(s.compensation!.length).toBeLessThan(70000);
    expect(s.ownership!.length).toBeLessThan(10000);
    const ex = proxyExcerpt(s)!;
    expect(ex.truncated).toBe(true);
    for (const label of ["Board and director independence:", "Compensation discussion and analysis:", "Security ownership and related-person transactions:"]) expect(ex.text).toContain(label);
    expect(ex.text.length).toBeLessThanOrEqual(PROXY_CAPS.board + PROXY_CAPS.compensation + PROXY_CAPS.ownership + 200);
  });
});

describe("extractProxySections with titles set over several lines (Broadcom style)", () => {
  const filler = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed} sentence ${i + 1}.`).join(" ");
  const proxy = [
    "TABLE OF CONTENTS",
    "Security Ownership of Certain Beneficial Owners, Directors and Executive Officers",
    "92",
    "Certain Relationships and Related Party Transactions",
    "95",
    "",
    "DIRECTOR INDEPENDENCE",
    filler(12, "Our Board annually reviews the independence of each director and nominee"),
    "",
    "SECURITY OWNERSHIP OF",
    "CERTAIN BENEFICIAL OWNERS, DIRECTORS",
    "AND EXECUTIVE OFFICERS",
    filler(14, "The following table sets forth information about the beneficial ownership of common stock"),
    "CERTAIN RELATIONSHIPS AND RELATED PARTY TRANSACTIONS",
    filler(6, "The Audit Committee must review all related party transactions on an ongoing basis"),
    "OTHER MATTERS",
    filler(4, "The Board knows of no other matters that will be presented for consideration"),
  ].join("\n");
  const s = extractProxySections(proxy);
  it("accepts a heading whose title continues on the next lines, and rejects the contents entry followed by a page number", () => {
    expect(s.ownership).toMatch(/^SECURITY OWNERSHIP OF\nCERTAIN BENEFICIAL OWNERS, DIRECTORS\nAND EXECUTIVE OFFICERS/);
    expect(s.ownership).toContain("related party transactions on an ongoing basis sentence 6.");
    expect(s.ownership).not.toContain("no other matters");
    expect(s.board).toMatch(/^DIRECTOR INDEPENDENCE/);
    expect(s.compensation).toBeNull();
  });
});

describe("extractProxySections on the AVGO FY25 proxy (real filing)", () => {
  const proxyPath = "data/raw/AVGO/0001730168-26-000080/edgar-proxy.html";
  const proxyText = existsSync(proxyPath) ? htmlToText(readFileSync(proxyPath, "utf8")) : null;
  it("finds board, pay and the multi-line ownership heading in their bodies", () => {
    if (!proxyText) return;
    const s = extractProxySections(proxyText);
    expect(s.board).toMatch(/^DIRECTOR INDEPENDENCE/);
    expect(s.compensation).toMatch(/^COMPENSATION DISCUSSION AND ANALYSIS/i);
    expect(s.ownership).toMatch(/^SECURITY OWNERSHIP OF\s+CERTAIN BENEFICIAL OWNERS, DIRECTORS/);
    expect(s.ownership).toContain("The following table sets forth information about the beneficial ownership of Broadcom common stock");
    for (const body of [s.board!, s.compensation!, s.ownership!]) expect(body.slice(0, 400)).not.toMatch(/\n\d{1,3}\n/);
  });
});
