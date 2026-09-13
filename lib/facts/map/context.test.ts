import { describe, it, expect } from "vitest";
import { mapContext } from "@/lib/facts/map/context";
const DIR = "data/raw/AVGO/0001730168-26-000080";
const filing = { form: "10-Q" as const, url: "https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm", filedDate: "2026-09-10" };
const desc = { text: "Broadcom designs chips.", source: "bigdata:company_tearsheet", asOf: "2026-09-11" };

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
    expect(t.text.length).toBeLessThanOrEqual(8000);
    expect(t.text).toContain("infrastructure software");
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
  });
});
