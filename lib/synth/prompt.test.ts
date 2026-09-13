import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk } from "@/lib/synth/desk.schema";
import { renderFactsBlock, renderContextBlock, renderPrompt } from "@/lib/synth/prompt";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));

describe("renderFactsBlock", () => {
  const block = renderFactsBlock(facts, pack);
  it("renders the snapshot exactly as the page formats it", () => {
    expect(block).toContain("- Current Price: $361.99");
    expect(block).toContain("- Q3'26 Revenue: $29.6B (+86%)");
    expect(block).toContain("- Fwd P/E (FY27E): ~18.8x");
  });
  it("renders the three statement tables cell by cell", () => {
    expect(block).toMatch(/\| Revenue \(\$B\) \| 27\.5 \| 33\.2 \| 35\.8 \| 51\.6 \| 63\.9 \|/);
    expect(block).toMatch(/\| Gross Margin \| 61\.4% \|/);
    expect(block).toMatch(/\| Free Cash Flow \|/);
  });
  it("renders estimates, TTM margins, analyst split, segments and geography", () => {
    expect(block).toContain("FY26E revenue $105.9B, EPS $11.63");
    expect(block).toContain("FY27E revenue $174.8B, EPS $19.28");
    expect(block).toMatch(/Buy 54 · Hold 6 · Sell 0/);
    expect(block).toMatch(/Semiconductor Solutions: 57\.7% \(\$36\.9B\)/);
    expect(block).toMatch(/Asia Pacific: 56\.2%/);
  });
});

describe("renderContextBlock", () => {
  const ctx = renderContextBlock(pack);
  it("labels every excerpt with its source and date and keeps the text verbatim", () => {
    expect(ctx).toMatch(/### MD&A \(edgar:10-Q, 2026-09-10, truncated\)/);
    expect(ctx).toMatch(/### Risk factors \(edgar:10-Q, 2026-09-10, truncated\)/);
    expect(ctx).toMatch(/### Transcript highlights \(bigdata:Quartr Transcripts, 2026-09-02/);
    expect(ctx).toContain(pack.context.mdaExcerpt!.text.slice(0, 200));
    expect(ctx).toMatch(/### Headlines\n- 2026-08-04 · Benzinga · What Is Going on With Broadcom Stock on Tuesday\?/);
  });
});

describe("renderPrompt", () => {
  it("assembles the six sections in order, with the errors section only on a re-prompt", () => {
    const p = renderPrompt(pack, facts, desk, { judgmentPath: "data/judgment/AVGO/0001730168-26-000080.json" });
    const order = ["# Role", "# Authoring contract", "# Facts", "# Context", "# Output"].map((h) => p.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(p).not.toContain("# Prior errors");
    expect(p).toContain(desk.styleRules[0]);
    expect(p).toContain('"STRONG BUY"');
    expect(p).toContain("data/judgment/AVGO/0001730168-26-000080.json");
    const re = renderPrompt(pack, facts, desk, { priorErrors: ["rating.label: BUY is inconsistent with an upside of -3.0%"] });
    expect(re).toMatch(/# Prior errors[\s\S]*- rating\.label: BUY is inconsistent/);
  });
  it("is deterministic and within the expected size", () => {
    const a = renderPrompt(pack, facts, desk), b = renderPrompt(pack, facts, desk);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(30000);
    expect(a.length).toBeLessThan(60000);
  });
});
