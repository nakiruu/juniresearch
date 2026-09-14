import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EditorialReview } from "@/lib/synth/editorial.schema";
import { judgmentSha256 } from "@/lib/synth/editorial";
import { renderReviewBrief } from "@/lib/synth/review-brief";

const ticker = "AVGO";
const accession = "0001730168-26-000080";
const judgmentText = readFileSync(`data/judgment/${ticker}/${accession}.json`, "utf8");
const rubric = readFileSync("data/desk/editorial-rubric.md", "utf8");
const paths = {
  report: "data/avgo.json",
  prompt: `data/judgment/${ticker}/${accession}.prompt.md`,
  judgment: `data/judgment/${ticker}/${accession}.json`,
  facts: `data/facts/${ticker}/${accession}.json`,
  findings: `data/judgment/${ticker}/${accession}.editorial.json`,
  rubric: "data/desk/editorial-rubric.md",
};
const brief = (over: Partial<Parameters<typeof renderReviewBrief>[0]> = {}) =>
  renderReviewBrief({ ticker, accession, judgmentText, previousReview: null, round: 1, rubric, paths, ...over });

describe("renderReviewBrief", () => {
  const text = brief();

  it("names the reviewer's role and forbids editing the judgment", () => {
    expect(text).toMatch(/# Role/);
    expect(text).toMatch(/editorial reviewer/i);
    expect(text).toMatch(/Do not edit/i);
  });

  it("lists every path the reviewer reads, including the proxy excerpt inside the FactPack", () => {
    for (const p of [paths.report, paths.prompt, paths.judgment, paths.facts]) expect(text).toContain(p);
    expect(text).toContain("context.proxyStatement.text");
  });

  it("carries the rubric verbatim", () => {
    expect(text).toContain(rubric.trim());
  });

  it("carries the findings path, the schema and the hash to write", () => {
    expect(text).toContain(paths.findings);
    expect(text).toContain("judgmentSha256");
    expect(text).toContain("needs-fix-round");
    expect(text).toContain(judgmentSha256(judgmentText));
  });

  it("states the round", () => {
    expect(text).toContain("round 1");
    expect(brief({ round: 2 })).toContain("round 2");
  });

  it("has no previous-findings section on a first pass", () => {
    expect(text).not.toContain("# Previous findings");
  });

  it("carries the previous findings verbatim on a re-check, with the verdict instruction", () => {
    const previousReview = EditorialReview.parse({
      judgmentSha256: "b".repeat(64), reviewedAt: "2026-09-14T09:00:00Z", reviewer: "opus", round: 1,
      verdict: "needs-fix-round",
      findings: [{ id: "F-1", severity: "Critical", field: "sections.financials.incomeCommentary", quote: "up 121%", issue: "wrong period", fix: "date it to FY26", status: "open" }],
    });
    const recheck = brief({ previousReview, round: 2 });
    expect(recheck).toContain("# Previous findings");
    expect(recheck).toContain(JSON.stringify(previousReview, null, 2));
    expect(recheck).toMatch(/addressed/);
    expect(recheck).toMatch(/before you add/i);
  });

  it("is deterministic", () => {
    expect(brief()).toBe(brief());
  });
});
