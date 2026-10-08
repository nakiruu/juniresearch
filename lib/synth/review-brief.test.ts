import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EditorialReview } from "@/lib/synth/editorial.schema";
import { judgmentSha256 } from "@/lib/synth/editorial";
import { renderReviewBrief, briefGroundingLists, briefOverwriteGuard, briefPreflight, briefCopyBlock } from "@/lib/synth/review-brief";
import { Desk } from "@/lib/synth/desk.schema";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Judgment } from "@/lib/synth/judgment.schema";
import { mergeReport } from "@/lib/synth/merge";
import { renderPrompt } from "@/lib/synth/prompt";
import { reviewInputs, inputsLine, type ReviewInputs } from "@/lib/synth/review-inputs";

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
const inputs: ReviewInputs = { scheme: 1, facts: "1".repeat(64), calls: "2".repeat(64), context: "3".repeat(64) };
const brief = (over: Partial<Parameters<typeof renderReviewBrief>[0]> = {}) =>
  renderReviewBrief({ ticker, accession, judgmentText, previousReview: null, round: 1, rubric, paths, inputs, ...over });

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

  it("carries the previous findings verbatim, less the two hash fields, on a re-check, with the verdict instruction", () => {
    const recheck = brief({ previousReview, round: 2 });
    expect(recheck).toContain("# Previous findings");
    const rest = Object.fromEntries(Object.entries(previousReview).filter(([k]) => k !== "judgmentSha256"));
    expect(recheck).toContain(JSON.stringify(rest, null, 2));
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

describe("the copy block and the stripped history", () => {
  const sha = judgmentSha256(judgmentText);
  it("opens the Output section with both values, next to each other, and names the prompt.md line", () => {
    const text = brief();
    const out = text.slice(text.indexOf("# Output"));
    expect(out).toMatch(/^# Output\n\n## Copy these two values exactly\n/);
    expect(out).toContain(`"judgmentSha256": "${sha}",\n"inputs": ${inputsLine(inputs)}`);
    expect(out).toContain(`\`Inputs fingerprint\` line of \`${paths.prompt}\``);
    expect(out).toMatch(/If the two differ, stop/);
  });
  it("a previous findings file loses both hash keys, and says where to take them from", () => {
    const prev = EditorialReview.parse({ ...previousReview, inputs: { ...inputs, facts: "9".repeat(64) } });
    const text = brief({ previousReview: prev, round: 2 });
    const json = text.split("# Previous findings")[1].split("```json\n")[1].split("\n```")[0];
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("judgmentSha256");
    expect(parsed).not.toHaveProperty("inputs");
    expect(text).toContain("hash fields omitted; take them from Output");
    // the only hash values in the brief are the current ones
    expect(text).not.toContain("b".repeat(64));
    expect(text).not.toContain("9".repeat(64));
  });
});

describe("what changed since the previous round", () => {
  it("a changed component forces the full brief and names the blocks to re-read", () => {
    const text = brief({ previousReview, round: 2, inputsChanged: ["facts"] });
    expect(text).toContain("# What to read");
    expect(text).toContain("# The rubric");
    expect(text).not.toContain("# What changed — read only these");
    expect(text).toContain("# What changed since round 1");
    expect(text).toMatch(/inputs the round-1 review read have changed: facts/);
    expect(text).toMatch(/re-read the \*\*Facts\*\* block of `data\/judgment\/AVGO\/0001730168-26-000080\.prompt\.md` and the matching parts of the rebuilt report/);
    expect(text.indexOf("# What changed since round 1")).toBeLessThan(text.indexOf("# What to read"));
  });
  it("an unstamped previous review forces the full brief too", () => {
    const text = brief({ previousReview, round: 2, inputsChanged: "unstamped" });
    expect(text).toContain("# What to read");
    expect(text).toMatch(/# What changed since round 1\n\nThe round-1 findings file carries no valid inputs/);
  });
  it("no change keeps today's delta brief, apart from the copy block and the stripped keys", () => {
    const text = renderReviewBrief({
      ticker: "TEST", accession: "0000000000-26-000001", judgmentText: "{}\n", round: 2, rubric: "RUBRIC", inputs, inputsChanged: [],
      paths: { report: "r.json", prompt: "p.md", judgment: "j.json", findings: "f.json", rubric: "rubric.md" },
      previousReview: EditorialReview.parse({ ...previousReview, inputs }),
    });
    expect(text.split("```json\n{\n  \"$schema\"")[0]).toMatchInlineSnapshot(`
      "# Role

      You are the editorial reviewer for the Juniper Finance Research Desk, reading the TEST report built from filing 0000000000-26-000001. This is round 2. You did not write it and you are not fixing it: you find defects against the rubric and write them to a findings file. Do not edit the judgment, the report, the facts or any other file — the findings file is your only output.

      # What changed — read only these

      You reviewed round 1 of this report. You already hold the author's brief — the \`p.md\` grounding surface, its Context **Proxy statement** section included — and the rubric, and neither changed. The author rewrote the judgment to address your findings. Read only:
      - \`r.json\` — the rebuilt report.
      - \`j.json\` — the rewritten judgment (the field paths your findings name).

      Judge against the same rubric and the same grounding surface as round 1. Re-verdict every previous finding below first, then look only for defects the rewrite introduced.

      # Previous findings

      Below is your previous findings file verbatim (hash fields omitted; take them from Output). Verdict every finding in it — set \`status\` to \`addressed\` when the rewrite fixed it, or leave it \`open\` and add a \`note\` saying what is still wrong — **before you add any new finding**. Keep the ids you already issued; number new findings after the highest one.

      \`\`\`json
      {
        "reviewedAt": "2026-09-14T09:00:00Z",
        "reviewer": "opus",
        "round": 1,
        "verdict": "needs-fix-round",
        "findings": [
          {
            "id": "F-1",
            "severity": "Critical",
            "field": "sections.financials.incomeCommentary",
            "quote": "up 121%",
            "issue": "wrong period",
            "fix": "date it to FY26",
            "status": "open"
          }
        ]
      }
      \`\`\`

      # Output

      ## Copy these two values exactly

      \`\`\`json
      "judgmentSha256": "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356",
      "inputs": {"scheme":1,"facts":"1111111111111111111111111111111111111111111111111111111111111111","calls":"2222222222222222222222222222222222222222222222222222222222222222","context":"3333333333333333333333333333333333333333333333333333333333333333"}
      \`\`\`

      \`judgmentSha256\` is the hash of the judgment you just read. \`inputs\` identifies the Facts, Calls and Context you read: copy it from the \`Inputs fingerprint\` line of \`p.md\`, and check that it equals the value above. If the two differ, stop: write no findings file, and report the mismatch.

      Write one JSON object matching this schema, and nothing else, to \`f.json\`.

      - \`judgmentSha256\` must be exactly \`ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356\` — the hash of the judgment you just read.
      - \`inputs\` is the value above, copied exactly, right after \`judgmentSha256\`; leave out \`source\`.
      - \`round\` is 2.
      - \`reviewer\` is your model name.
      - \`reviewedAt\` is the current UTC time in ISO 8601 (\`2026-09-14T10:00:00Z\`).
      - \`verdict\` is \`approved\` when nothing is open, \`approved-with-minors\` when only Minors are open, \`needs-fix-round\` when any Critical or Important is open.
      - Every new finding has \`status: "open"\`. A Critical or Important may never be \`declined\`.

      "
    `);
  });
});

describe("briefOverwriteGuard", () => {
  const old: ReviewInputs = { ...inputs, facts: "9".repeat(64) };
  const existing = brief({ inputs: old });
  const sha = judgmentSha256(judgmentText);
  const findings = (judgment = sha, stamp?: unknown) => ({ judgmentSha256: judgment, ...(stamp ? { inputs: stamp } : {}) });
  it("allows when no brief exists", () => expect(briefOverwriteGuard({ existingBriefText: null, currentInputs: inputs, findings: null, briefMtime: null, findingsMtime: null }).ok).toBe(true));
  it("allows when the inputs are equal", () => expect(briefOverwriteGuard({ existingBriefText: brief(), currentInputs: inputs, findings: null, briefMtime: 2, findingsMtime: null }).ok).toBe(true));
  it("allows when the findings file answers this brief: its stamp and judgment are the brief's copy block, whatever the mtimes", () => {
    for (const [bm, fm] of [[1, 2], [2, 1], [null, null]] as const)
      expect(briefOverwriteGuard({ existingBriefText: existing, currentInputs: inputs, findings: findings(sha, { ...old, source: undefined }), briefMtime: bm, findingsMtime: fm }).ok).toBe(true);
  });
  it("refuses old findings stamped with other inputs, even with a newer mtime (a touched file answers nothing)", () => {
    const other = { ...old, facts: "a".repeat(64) };
    for (const f of [findings(sha, other), findings(sha), findings(sha, "junk"), findings("c".repeat(64), old)])
      expect(briefOverwriteGuard({ existingBriefText: existing, currentInputs: inputs, findings: f, briefMtime: 1, findingsMtime: 2 }).ok).toBe(false);
  });
  it("refuses when the findings file is the previous review the brief itself carried, matching stamp or not (the NVDA touch repro)", () => {
    // a re-check brief rendered on top of a review that already answers its judgment and inputs
    const prev = EditorialReview.parse({ ...previousReview, judgmentSha256: sha, inputs: { ...old, source: "backfill:abc1234" } });
    const recheck = brief({ inputs: old, previousReview: prev, round: 2 });
    expect(briefOverwriteGuard({ existingBriefText: recheck, currentInputs: inputs, findings: prev, briefMtime: 1, findingsMtime: 2 }).ok).toBe(false);
    // a reviewer's new findings for this brief (new reviewedAt, the copied stamp) answer it
    const answer = EditorialReview.parse({ ...prev, reviewedAt: "2026-10-08T12:00:00Z", inputs: old });
    expect(briefOverwriteGuard({ existingBriefText: recheck, currentInputs: inputs, findings: answer, briefMtime: 2, findingsMtime: 1 }).ok).toBe(true);
  });
  it("refuses when the inputs differ and no findings file answers it", () => {
    for (const [f, fm] of [[null, null], [findings(), 0.5], [findings("c".repeat(64)), 2]] as const) {
      const r = briefOverwriteGuard({ existingBriefText: existing, currentInputs: inputs, findings: f, briefMtime: 1, findingsMtime: fm, briefPath: "x/brief.md" });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toMatch(/a reviewer may be reading the brief for the old inputs; stop that reviewer, then delete `x\/brief\.md` and re-render/);
    }
  });
  it("reads the copy block of a brief with CRLF line endings", () => {
    const crlf = brief().replace(/\n/g, "\r\n");
    expect(briefCopyBlock(crlf)).toEqual({ judgmentSha256: sha, inputs });
    expect(briefOverwriteGuard({ existingBriefText: crlf, currentInputs: inputs, findings: null, briefMtime: 2, findingsMtime: null }).ok).toBe(true);
    expect(briefCopyBlock(existing.replace(/\n/g, "\r\n"))).toEqual({ judgmentSha256: sha, inputs: old });
  });
  it("treats a brief without a copy block (rendered before inputs existed) as old inputs", () => {
    const legacy = existing.replace(/^"inputs": .*$/m, "");
    expect(briefOverwriteGuard({ existingBriefText: legacy, currentInputs: inputs, findings: null, briefMtime: 1, findingsMtime: null }).ok).toBe(false);
    expect(briefOverwriteGuard({ existingBriefText: legacy, currentInputs: inputs, findings: findings(), briefMtime: 1, findingsMtime: 2 }).ok).toBe(true);
  });
});

describe("briefPreflight", () => {
  const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
  const pack = FactPack.parse(JSON.parse(readFileSync(`data/facts/${ticker}/${accession}.json`, "utf8")));
  const facts = projectReportFacts(pack);
  const judgment = Judgment.parse(JSON.parse(judgmentText));
  const promptText = renderPrompt(pack, facts, desk);
  const report = JSON.parse(JSON.stringify(mergeReport(facts, { ...judgment, highlights: Object.keys(facts.highlightCells).slice(0, 2) as Judgment["highlights"] }, desk, "2026-10-08")));
  const run = (over: Partial<Parameters<typeof briefPreflight>[0]> = {}) => briefPreflight({ promptText, report, facts, pack, desk, accession, ...over });
  it("passes on a fresh prompt and report", () => expect(run()).toEqual({ ok: true }));
  it("refuses a prompt with one changed Facts line, naming synth:prompt", () => {
    const r = run({ promptText: promptText.replace("- Current Price: $", "- Current Price: $1") });
    expect(!r.ok && r.errors.join("\n")).toMatch(/Facts block.*synth:prompt/);
  });
  it("refuses a prompt with a stale Inputs fingerprint line, naming synth:prompt", () => {
    const r = run({ promptText: promptText.replace(/^Inputs fingerprint: .*$/m, `Inputs fingerprint: ${inputsLine(inputs)}`) });
    expect(!r.ok && r.errors.join("\n")).toMatch(/Inputs fingerprint.*synth:prompt/);
    expect(run({ promptText: null }).ok).toBe(false);
  });
  it("refuses a report with an old multiples row, a changed close or another accession, naming synth:build --skip-review", () => {
    const mult = structuredClone(report); mult.sections.valuation.multiples.rows[0].values[0] += 1;
    const close = structuredClone(report); close.quote.history[close.quote.history.length - 1].close += 1;
    const acc = structuredClone(report); acc.meta.filing.accession = "0000000000-26-000001";
    const cell = structuredClone(report); cell.snapshot[cell.snapshot.length - 1].value += 1;
    for (const [bad, what] of [[mult, /multiples/], [close, /quote/], [acc, /0000000000-26-000001/], [cell, /highlight/]] as const) {
      const r = run({ report: bad });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.errors.join("\n")).toMatch(what);
      expect(!r.ok && r.errors.join("\n")).toMatch(/synth:build -- AVGO 0001730168-26-000080 --skip-review/);
    }
    expect(run({ report: null }).ok).toBe(false);
  });
  it("compares segments as a set", () => {
    const r = structuredClone(report); r.sections.businessMoat.segments.reverse();
    expect(run({ report: r })).toEqual({ ok: true });
  });
  it("agrees with reviewInputs on what the prompt carries", () => expect(promptText).toContain(`Inputs fingerprint: ${inputsLine(reviewInputs(pack, desk))}`));
});
