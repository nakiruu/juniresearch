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
  findings: `data/judgment/${ticker}/${accession}.editorial.json`,
  rubric: "data/desk/editorial-rubric.md",
};
const previousReview = EditorialReview.parse({
  judgmentSha256: "b".repeat(64), reviewedAt: "2026-09-14T09:00:00Z", reviewer: "opus", round: 1,
  verdict: "needs-fix-round",
  findings: [{ id: "F-1", severity: "Critical", field: "sections.financials.incomeCommentary", quote: "up 121%", issue: "wrong period", fix: "date it to FY26", status: "open" }],
});
const brief = (over: Partial<Parameters<typeof renderReviewBrief>[0]> = {}) =>
  renderReviewBrief({ ticker, accession, judgmentText, previousReview: null, round: 1, rubric, paths, ...over });

describe("renderReviewBrief", () => {
  const text = brief();

  it("names the reviewer's role and forbids editing the judgment", () => {
    expect(text).toMatch(/# Role/);
    expect(text).toMatch(/editorial reviewer/i);
    expect(text).toMatch(/Do not edit/i);
  });

  it("lists the report, prompt and judgment as the read set and does not send the reviewer to the raw FactPack", () => {
    for (const p of [paths.report, paths.prompt, paths.judgment]) expect(text).toContain(p);
    expect(text).not.toContain(`data/facts/${ticker}/${accession}.json`);
    expect(text).not.toContain("context.proxyStatement.text");
  });

  it("points governance claims at the prompt's Context proxy section rather than the FactPack", () => {
    expect(text).toMatch(/Context \*\*Proxy statement\*\* section is the authoritative source/);
    expect(text).toMatch(/do not need the raw FactPack/);
  });

  it("carries the rubric verbatim", () => {
    expect(text).toContain(rubric.trim());
  });

  it("renders the desk's recurring traps as a check-these-first section, before the rubric", () => {
    const traps = [
      "Ungrounded peer: do not name a competitor unless it appears on the surface.",
      "Recalled executive: names come from the proxy excerpt or not at all.",
    ];
    const t = brief({ recurringTraps: traps });
    expect(t).toContain("# Known recurring defects (check these first)");
    for (const trap of traps) expect(t).toContain(trap);
    expect(t.indexOf("# Known recurring defects")).toBeLessThan(t.indexOf("# The rubric"));
  });

  it("omits the traps section when the desk lists none", () => {
    expect(brief({ recurringTraps: [] })).not.toContain("# Known recurring defects");
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
    const recheck = brief({ previousReview, round: 2 });
    expect(recheck).toContain("# Previous findings");
    expect(recheck).toContain(JSON.stringify(previousReview, null, 2));
    expect(recheck).toMatch(/addressed/);
    expect(recheck).toMatch(/before you add/i);
  });

  it("on a warm re-check points at only the changed report and judgment and drops the re-read of prompt + rubric", () => {
    const recheck = brief({ previousReview, round: 2 });
    expect(recheck).toContain("# What changed — read only these");
    expect(recheck).toMatch(/already hold the author's brief/);
    expect(recheck).not.toContain("# What to read");
    expect(recheck).not.toContain("# The rubric");
    expect(recheck).not.toContain(rubric.trim());
    // the report and judgment (the two things that changed) are still named
    expect(recheck).toContain(paths.report);
    expect(recheck).toContain(paths.judgment);
  });

  it("forces the full cold brief on a re-check when fullBrief is set, for a fresh reviewer picking up round 2", () => {
    const full = brief({ previousReview, round: 2, fullBrief: true });
    expect(full).toContain("# What to read");
    expect(full).toContain("# The rubric");
    expect(full).toContain(rubric.trim());
    expect(full).toContain("# Previous findings");
    expect(full).not.toContain("# What changed — read only these");
  });

  it("is deterministic", () => {
    expect(brief()).toBe(brief());
    expect(brief({ previousReview, round: 2 })).toBe(brief({ previousReview, round: 2 }));
  });
});
