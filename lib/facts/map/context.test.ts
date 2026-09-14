import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapContext } from "@/lib/facts/map/context";
const DIR = "data/raw/AVGO/0001730168-26-000080";
const filing = { form: "10-Q" as const, url: "https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm", filedDate: "2026-09-10" };
const desc = { text: "Broadcom designs chips.", source: "bigdata:company_tearsheet", asOf: "2026-09-11" };

const readFiling = (dir: string) => JSON.parse(readFileSync(`${dir}/edgar-filing.json`, "utf8"));

describe("mapContext on the AVGO capture", () => {
  const c = mapContext(DIR, filing, "2026-09-13T03:18:05Z", desc);
  it("carries capped, sourced filing excerpts with their real truncation flags", () => {
    expect(c.mdaExcerpt).toMatchObject({ source: "edgar:10-Q", url: filing.url, asOf: "2026-09-10", truncated: true });
    expect(c.mdaExcerpt!.text.length).toBeLessThanOrEqual(16000);
    expect(c.mdaExcerpt!.text.toLowerCase()).toContain("revenue");
    expect(c.riskFactorsExcerpt).toMatchObject({ source: "edgar:10-Q", truncated: true });
    expect(c.riskFactorsExcerpt!.text.length).toBeLessThanOrEqual(8000);
  });
  it("joins the transcript chunks into one capped, sourced excerpt", () => {
    const t = c.transcriptHighlights!;
    expect(t.source).toBe("bigdata:Quartr Transcripts");
    expect(t.url).toMatch(/^https:\/\/app\.bigdata\.com\/documents\//);
    expect(t.asOf).toBe("2026-09-02");
    expect(t.text.length).toBeGreaterThan(1000);
    expect(t.text.length).toBeLessThanOrEqual(16000);
    expect(t.text).toContain("infrastructure software");
    // Past the old 8,000-character cap — proves the raised TRANSCRIPT_CAP actually reaches further into the ranked chunks.
    expect(t.text).toContain("AI semiconductor revenue, which grew 221% year-on-year");
  });
  it("carries the ten newest-ranked headlines with publisher, date, and link", () => {
    expect(c.headlines).toHaveLength(10);
    expect(c.headlines[0]).toEqual({
      text: "What Is Going on With Broadcom Stock on Tuesday?", source: "bigdata:Benzinga", asOf: "2026-08-04",
      url: "https://app.bigdata.com/documents/B2A63DCA0F4374F148907C96C83CBB57?cnum=1&cnum=3",
    });
    for (const h of c.headlines) { expect(h.text.length).toBeGreaterThan(10); expect(h.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
  });
  it("passes the description through and tolerates a missing search capture", () => {
    expect(c.description).toEqual(desc);
    const bare = mapContext("lib/facts/map/__fixtures__/context-bare", filing, "2026-09-13T03:18:05Z", desc);
    expect(bare.headlines).toEqual([]);
    expect(bare.transcriptHighlights).toBeNull();
    expect(bare.pressRelease).toBeNull();
    expect(bare.proxyStatement).toBeNull();
  });
  it("keeps its own risk factors as the source since they are longer than the prior 10-K's", () => {
    expect(c.riskFactorsSource).toBe("10-Q");
  });
});

describe("mapContext on an empty capture", () => {
  it("throws naming the primary document file", () => {
    expect(() => mapContext("lib/facts/map/__fixtures__/empty", filing, "2026-09-13T03:18:05Z", desc)).toThrow(/edgar-primary\.html/);
  });
});

describe("mapContext picks the risk-factors winner on raw length, not capped length", () => {
  // edgar-primary.html (10-Q): Item 1A is short sentences throughout, raw ~8,211 chars, capping to
  // ~7,977 (a sentence boundary lands close to the 8,000-char cap).
  // edgar-10k-primary.html (10-K): Item 1A is raw ~9,381 chars — longer — but a ~4,450-char run-on
  // clause with no periods pushes its last pre-cap sentence boundary back to ~4,857, so its CAPPED
  // text is shorter than the 10-Q's even though its RAW text is longer.
  const dir = "lib/facts/map/__fixtures__/rf-longest";
  const c = mapContext(dir, filing, "2026-09-13T03:18:05Z", desc);
  it("prefers the raw-longer 10-K even though its capped excerpt is shorter", () => {
    expect(c.riskFactorsSource).toBe("10-K");
    expect(c.riskFactorsExcerpt!.source).toBe("edgar:10-K");
    expect(c.riskFactorsExcerpt!.text.length).toBeLessThan(6000); // the 10-K's capped text, not the 10-Q's ~7,977
  });
});

describe("mapContext on the ORCL Q1 FY27 10-Q capture (press release, 10-K risk factors)", () => {
  const orclDir = "data/raw/ORCL/0001193125-26-389274";
  const orclFiling = readFiling(orclDir);
  const c = mapContext(orclDir, orclFiling, "2026-09-13T03:18:05Z", desc);

  it("captures the earnings press release, capped and sourced", () => {
    expect(c.pressRelease).not.toBeNull();
    expect(c.pressRelease!.text).toContain("$664 billion");
    expect(c.pressRelease!.source).toBe("edgar:8-K ex-99.1");
    expect(c.pressRelease!.truncated).toBe(true);
  });
  it("prefers the prior 10-K's risk factors over the 10-Q's own thin cross-reference", () => {
    expect(c.riskFactorsSource).toBe("10-K");
    expect(c.riskFactorsExcerpt).not.toBeNull();
    expect(c.riskFactorsExcerpt!.text.length).toBeGreaterThan(5000);
    expect(c.riskFactorsExcerpt!.source).toBe("edgar:10-K");
  });
});

describe("mapContext on the ORCL FY26 10-K capture", () => {
  const orclDir = "data/raw/ORCL/0001193125-26-277521";
  const orclFiling = readFiling(orclDir);
  const c = mapContext(orclDir, orclFiling, "2026-09-13T03:18:05Z", desc);

  it("records its own risk factors as the source", () => {
    expect(c.riskFactorsSource).toBe("10-K");
  });
  it("captures the June 10 earnings press release", () => {
    expect(c.pressRelease).not.toBeNull();
    expect(c.pressRelease!.asOf).toBe("2026-06-10");
  });
});

describe("mapContext carries the proxy statement when captured", () => {
  const withProxy = { ...filing, proxyStatement: { url: "https://www.sec.gov/Archives/edgar/data/1341439/000119312525209/def14a.htm", filedDate: "2025-09-26" } };
  it("is null on a capture with no proxy file", () => {
    expect(mapContext("lib/facts/map/__fixtures__/rf-longest", withProxy, "2026-09-13T03:18:05Z", desc).proxyStatement).toBeNull();
  });
  it("maps the three governance sections into one sourced excerpt dated by the proxy's filing", () => {
    const c = mapContext("lib/facts/map/__fixtures__/proxy", withProxy, "2026-09-13T03:18:05Z", desc);
    expect(c.proxyStatement).toMatchObject({ source: "edgar:DEF 14A", url: withProxy.proxyStatement.url, asOf: "2025-09-26", truncated: false });
    expect(c.proxyStatement!.text).toContain("Compensation discussion and analysis:");
    expect(c.proxyStatement!.text).toContain("total compensation of $9,876,543");
    expect(c.proxyStatement!.text).toContain("Board and director independence:");
    expect(c.proxyStatement!.text).toContain("Security ownership and related-person transactions:");
  });
});
