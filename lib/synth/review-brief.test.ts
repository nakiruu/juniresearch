import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EditorialReview } from "@/lib/synth/editorial.schema";
import { judgmentSha256 } from "@/lib/synth/editorial";
import { renderReviewBrief, briefGroundingLists } from "@/lib/synth/review-brief";
import { Desk } from "@/lib/synth/desk.schema";

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

describe("briefGroundingLists", () => {
  const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
  const packText = readFileSync(`data/facts/${ticker}/${accession}.json`, "utf8");
  it("computes the weak and assumed lists from the judgment and the pack", () => {
    const r = briefGroundingLists(judgmentText, packText, desk);
    expect("weak" in r && Array.isArray(r.weak) && Array.isArray(r.assumed)).toBe(true);
  });
  it.each<[string, string, string | null, RegExp]>([
    ["a judgment that is not JSON", "{ not json", packText, /judgment/],
    ["a judgment that fails the schema", "{}", packText, /judgment/],
    ["a missing pack", judgmentText, null, /pack/],
    ["a pack that is not JSON", judgmentText, "{ nope", /pack/],
  ])("returns a warning, not a throw, for %s", (_name, j, p, why) => {
    const r = briefGroundingLists(j, p, desk);
    expect("warning" in r && r.warning).toMatch(why);
  });
});

describe("what the brief says the grounding check enforces", () => {
  const weak = ['sections.financials.incomeCommentary: "$15,955 million" grounds only through a unit-less table cell: Context "15,955"'];
  const assumed = ['sections.valuation.scenarios[2].driver: "14x"'];
  const text = brief({ weak, assumed });
  it("names Facts, Calls and Context as the surface and does not overclaim the check", () => {
    expect(text).toContain("Its **Facts**, **Calls** and **Context** blocks, with the report's own calls, are the grounding surface.");
    expect(text).toContain("checked by digits only");
    expect(text).toContain("an unsigned Context figure cannot check a sign");
    expect(text).not.toContain("Context signs are not checked");   // a sign written in Context is checked (review C-7)
    expect(text).toContain("(rubric item 1) is always yours");
    expect(text).not.toContain("checks each figure's unit, scale, sign and precision");
  });
  it("lists the weakly grounded figures to check first", () => {
    expect(text).toContain("# Weakly grounded figures — check unit, scale, sign and attribution first");
    expect(text).toContain(`- ${weak[0]}`);
  });
  it("lists the assumed figures (D2)", () => {
    expect(text).toContain("# Assumed figures");
    expect(text).toContain(`- ${assumed[0]}`);
    expect(text.indexOf("# Weakly grounded figures")).toBeLessThan(text.indexOf("# Output"));
  });
  it("says so when there are none, and carries both lists on a warm re-check too", () => {
    const empty = brief({ weak: [], assumed: [] });
    expect(empty).toMatch(/# Weakly grounded figures[^\n]*\n\nNone/);
    expect(empty).toMatch(/# Assumed figures\n\nNone/);
    const recheck = brief({ previousReview, round: 2, weak, assumed });
    expect(recheck).toContain(`- ${weak[0]}`);
    expect(recheck).toContain(`- ${assumed[0]}`);
  });
});
