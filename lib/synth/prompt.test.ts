import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk } from "@/lib/synth/desk.schema";
import { renderFactsBlock, renderContextBlock, renderPrompt, renderCalls, renderTraps, promptTail } from "@/lib/synth/prompt";
import { EditorialReview } from "@/lib/synth/editorial.schema";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));

const orclPack = FactPack.parse(JSON.parse(readFileSync("data/facts/ORCL/0001193125-26-389274.json", "utf8")));
const orclFacts = projectReportFacts(orclPack);

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
  it("says so when the quarter had no revenue and when the vendor has no geographic split", () => {
    const bare = structuredClone(pack);
    bare.latestQuarter = { ...bare.latestQuarter, revenue: 0, operatingMargin: null, revenueYoY: null };
    bare.geoMix = { basis: "FY25", items: [] };
    const b = renderFactsBlock(projectReportFacts(bare), bare);
    const line = b.split("\n").find((l) => l.startsWith("- Latest quarter"))!;
    expect(line).toContain("operating margin not meaningful (no revenue in the quarter)");
    expect(line).not.toContain("YoY");
    expect(b).toContain("- No geographic split in the vendor data");
  });
  it("explains a null operating margin as a missing operating-income line when the quarter had revenue (a bank)", () => {
    const bank = structuredClone(pack);
    bank.latestQuarter = { ...bank.latestQuarter, revenue: 57.347e9, operatingMargin: null };
    const line = renderFactsBlock(projectReportFacts(bank), bank).split("\n").find((l) => l.startsWith("- Latest quarter"))!;
    expect(line).toContain("operating margin not meaningful (no operating-income line)");
    expect(line).not.toContain("no revenue in the quarter");
  });
  it("points to the segment mix when geography was promoted to segments (no product split)", () => {
    const bare = structuredClone(pack);
    bare.segments = { basis: "FY25 by geography", items: [{ name: "UNITED STATES", revenue: 4.8e9, share: 0.936 }, { name: "Non-US", revenue: 3.3e8, share: 0.064 }] };
    bare.geoMix = { basis: "FY25", items: [] };
    const b = renderFactsBlock(projectReportFacts(bare), bare);
    expect(b).toContain("### Segments (FY25 by geography mix)");
    expect(b).toContain("the geographic revenue mix is shown as the segment mix above");
    expect(b).not.toContain("do not quote a regional mix");
  });
  it("renders the leverage line under Trailing twelve months", () => {
    expect(block).toContain("- Net debt/EBITDA 0.7x · Interest coverage 14.2x · FCF yield 2.3% · Current ratio 2.50");
  });
  it("shows cover-page shares on the Quote line", () => {
    expect(block).toMatch(/shares 4\.77B \(cover page\)/);
  });
  it("lists every available highlight cell by key", () => {
    expect(block).toContain("### Highlight cells you may add (up to four, by key)");
    expect(block).toContain("- fcfLatestFY: FY25 Free Cash Flow = $26.9B");
    expect(block).toContain("- netDebtToEbitda: Net Debt / EBITDA (TTM) = 0.7x");
  });
});

describe("renderFactsBlock (ORCL — the frozen formatter's sign placement on a negative highlight cell)", () => {
  const block = renderFactsBlock(orclFacts, orclPack);
  it("renders the negative FY26 capex highlight cell", () => {
    expect(block).toContain("- capexLatestFY: FY26 Capital Expenditure = -$55.7B");
  });
  it("renders ORCL's leverage line with a negative FCF yield", () => {
    expect(block).toContain("- Net debt/EBITDA 3.2x · Interest coverage 4.6x · FCF yield -6.6% · Current ratio 1.17");
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
  it("renders the earnings press release before the transcript", () => {
    expect(ctx).toMatch(/### Earnings press release \(edgar:8-K ex-99\.1, 2026-09-02, truncated\)/);
    expect(ctx).toContain(pack.context.pressRelease!.text.slice(0, 100));
    expect(ctx.indexOf("### Earnings press release")).toBeLessThan(ctx.indexOf("### Transcript highlights"));
  });
});

describe("renderCalls", () => {
  it("interpolates the desk thresholds into the rating, bear and target-low rules", () => {
    const calls = renderCalls(desk.rating);
    expect(calls).toContain("STRONG BUY needs E ≥ +20.0% and R ≥ 1.00×; BUY needs E ≥ +10.0% and R ≥ 0.50×; SELL is E ≤ -5.0%; STRONG SELL is E ≤ -20.0%; anything else is HOLD.");
    expect(calls).toContain("one notch more conservative (STRONG BUY→BUY, BUY→HOLD, SELL→HOLD, STRONG SELL→SELL); a more aggressive label fails.");
    expect(calls).toContain("the Bear implied price must sit at least 15.0% below the current price");
    expect(calls).toContain("On a BUY, a target low below the current price");
    expect(calls).toContain("expected upside, bear-case downside and reward/risk");
    expect(calls).not.toMatch(/envelope|−10% to \+15%/);
  });
  it("follows a changed threshold, so the prompt and the validator cannot drift", () => {
    const tuned = Desk.parse({ ...JSON.parse(readFileSync("data/desk/desk.json", "utf8")), rating: { bearFloor: 0.2, strongBuy: { minUpside: 0.25, minRewardRisk: 1.5 } } });
    const calls = renderCalls(tuned.rating);
    expect(calls).toContain("at least 20.0% below");
    expect(calls).toContain("STRONG BUY needs E ≥ +25.0% and R ≥ 1.50×");
  });
  it("is what renderPrompt puts under # Calls", () => {
    expect(renderPrompt(pack, facts, desk)).toContain(`# Calls\n\n${renderCalls(desk.rating)}`);
  });
});

describe("renderPrompt", () => {
  it("assembles the seven sections in order, with the errors section only on a re-prompt", () => {
    const p = renderPrompt(pack, facts, desk, { judgmentPath: "data/judgment/AVGO/0001730168-26-000080.json" });
    const order = ["# Role", "# Authoring contract", "# Calls", "# Facts", "# Context", "# Output"].map((h) => p.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(p).not.toContain("# Prior errors");
    expect(p).toContain(desk.styleRules[0]);
    expect(p).toContain('"STRONG BUY"');
    expect(p).toContain("STRONG BUY needs E ≥ +20.0%");
    expect(p).toContain("Scenario probabilities are quotable as percentages (e.g. 48%).");
    expect(p).toContain("data/judgment/AVGO/0001730168-26-000080.json");
    const re = renderPrompt(pack, facts, desk, { priorErrors: ["rating.label: BUY is inconsistent with an upside of -3.0%"] });
    expect(re).toMatch(/# Prior errors[\s\S]*- rating\.label: BUY is inconsistent/);
  });
  it("is deterministic and within the expected size", () => {
    const a = renderPrompt(pack, facts, desk), b = renderPrompt(pack, facts, desk);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(30000);
    // Raised from 60000: the Context block now also carries the earnings press release excerpt
    // (Task 5), which for AVGO alone runs to ~15,000 characters. Raised again from 90000: the
    // token-lean pass added the "# Known traps" section (~1.5K chars) between contract and calls.
    expect(a.length).toBeLessThan(95000);
  });
});

describe("known traps in the prompt", () => {
  it("renders the desk's recurring traps as their own section, between the contract and the calls", () => {
    const p = renderPrompt(pack, facts, desk);
    expect(p).toContain("# Known traps (avoid these)");
    expect(p).toContain(desk.recurringTraps[0]);
    const i = p.indexOf("# Known traps");
    expect(i).toBeGreaterThan(p.indexOf("# Authoring contract"));
    expect(i).toBeLessThan(p.indexOf("# Calls"));
  });
  it("drops the section entirely when the desk lists no traps", () => {
    expect(renderTraps([])).toBe("");
    const bare = Desk.parse({ ...JSON.parse(readFileSync("data/desk/desk.json", "utf8")), recurringTraps: [] });
    expect(renderPrompt(pack, facts, bare)).not.toContain("# Known traps");
  });
});

describe("promptTail — the re-render delta", () => {
  const errors = ["rating.label: BUY is inconsistent with an upside of -3.0%"];
  const review = EditorialReview.parse({
    judgmentSha256: "c".repeat(64), reviewedAt: "2026-09-14T10:00:00Z", reviewer: "opus", round: 1,
    verdict: "needs-fix-round",
    findings: [{ id: "F-1", severity: "Critical", field: "analystCommentary", quote: "up 121%", issue: "wrong period", fix: "date it", status: "open" }],
  });
  it("is empty on a first pass", () => {
    expect(promptTail({})).toBe("");
  });
  it("carries the prior errors and the open findings, in that order, and nothing else", () => {
    const tail = promptTail({ priorErrors: errors, editorial: review });
    expect(tail).toContain("# Prior errors");
    expect(tail).toContain(errors[0]);
    expect(tail).toContain("# Editorial findings");
    expect(tail.indexOf("# Prior errors")).toBeLessThan(tail.indexOf("# Editorial findings"));
    expect(tail).not.toContain("# Facts");
    expect(tail).not.toContain("# Calls");
  });
  it("is exactly the tail the full prompt ends with, so the delta and the prompt cannot drift", () => {
    const opts = { priorErrors: errors, editorial: review };
    expect(renderPrompt(pack, facts, desk, opts).endsWith(promptTail(opts) + "\n")).toBe(true);
  });
});

describe("prior warnings in the prompt", () => {
  const errors = ["rating.label: BUY is inconsistent with an upside of -3.0% (received \"BUY\")"];
  const warnings = ['warn: lint/tic: analystCommentary: "leg" appears 11 times (received "leg")'];

  it("renders warnings under the errors, in their own subsection", () => {
    const p = renderPrompt(pack, facts, desk, { priorErrors: errors, priorWarnings: warnings });
    expect(p).toContain("# Prior errors");
    expect(p).toContain("## Warnings (fix if cheap)");
    expect(p.indexOf("## Warnings (fix if cheap)")).toBeGreaterThan(p.indexOf(errors[0]));
    expect(p).toContain(warnings[0]);
  });
  it("renders a warnings-only section when the last build passed", () => {
    const p = renderPrompt(pack, facts, desk, { priorWarnings: warnings });
    expect(p).toContain("## Warnings (fix if cheap)");
    expect(p).toMatch(/passed validation/);
    expect(p).not.toMatch(/failed validation/);
  });
  it("renders no section at all when there is neither", () => {
    expect(renderPrompt(pack, facts, desk)).not.toContain("# Prior errors");
  });
});

describe("the proxy statement in the prompt", () => {
  it("renders (not captured) when the pack has none, between the press release and the transcript", () => {
    const ctx = renderContextBlock({ ...pack, context: { ...pack.context, proxyStatement: null } });
    expect(ctx).toContain("### Proxy statement\n(not captured)");
    expect(ctx.indexOf("### Proxy statement")).toBeGreaterThan(ctx.indexOf("### Earnings press release"));
    expect(ctx.indexOf("### Proxy statement")).toBeLessThan(ctx.indexOf("### Transcript highlights"));
  });
  it("renders the captured excerpt with its source and filing date", () => {
    const proxyStatement = { text: "Board and director independence:\nEleven of twelve directors are independent.", source: "edgar:DEF 14A", asOf: "2025-09-26", truncated: true };
    const ctx = renderContextBlock({ ...pack, context: { ...pack.context, proxyStatement } });
    expect(ctx).toMatch(/### Proxy statement \(edgar:DEF 14A, 2025-09-26, truncated\)\nBoard and director independence:/);
  });
  it("tells the author that governance claims rest on the proxy statement", () => {
    const p = renderPrompt(pack, facts, desk);
    expect(p).toMatch(/Governance claims[^\n]*proxy statement/);
    expect(p).toMatch(/no proxy statement[^\n]*say so/i);
  });
});

describe("editorial findings in the prompt", () => {
  const review = EditorialReview.parse({
    judgmentSha256: "c".repeat(64), reviewedAt: "2026-09-14T10:00:00Z", reviewer: "opus", round: 1,
    verdict: "needs-fix-round",
    findings: [
      { id: "F-1", severity: "Critical", field: "sections.financials.incomeCommentary", quote: "up 121%", issue: "wrong period", fix: "date it to FY26", status: "open" },
      { id: "F-2", severity: "Minor", field: "analystCommentary", quote: "record", issue: "unattributed", fix: "attribute it", status: "addressed" },
    ],
  });

  it("renders the open findings last, after the output section", () => {
    const p = renderPrompt(pack, facts, desk, { editorial: review });
    expect(p).toContain("# Editorial findings");
    expect(p.indexOf("# Editorial findings")).toBeGreaterThan(p.indexOf("# Output"));
    expect(p).toContain("F-1");
    expect(p).toContain("sections.financials.incomeCommentary");
    expect(p).toContain("date it to FY26");
    expect(p).not.toContain("F-2");
  });

  it("renders errors, warnings and findings together, in that order", () => {
    const p = renderPrompt(pack, facts, desk, { priorErrors: ["rating.label: bad (received 1)"], priorWarnings: ['warn: lint/tic: a: b (received "c")'], editorial: review });
    const order = ["# Prior errors", "## Warnings (fix if cheap)", "# Editorial findings"].map((h) => p.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("renders no findings section without a review", () => {
    expect(renderPrompt(pack, facts, desk)).not.toContain("# Editorial findings");
  });
});
