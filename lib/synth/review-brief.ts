/**
 * review-brief.ts — the document the editorial reviewer reads, and nothing else.
 * -----------------------------------------------------------------------------
 * It mirrors renderPrompt: pure, deterministic, and the reviewer's whole brief.
 * On a re-check the previous findings go in verbatim, because the reviewer's
 * first job in round two is to verdict its own round-one findings before it
 * looks for anything new.
 */
import { z } from "zod";
import { EditorialReviewShape, type EditorialReview } from "./editorial.schema";
import { judgmentSha256 } from "./editorial";

export interface ReviewBriefPaths {
  report: string;
  prompt: string;
  judgment: string;
  findings: string;
  rubric: string;
}

export function renderReviewBrief(input: {
  ticker: string;
  accession: string;
  judgmentText: string;
  previousReview: EditorialReview | null;
  round: 1 | 2;
  rubric: string;
  paths: ReviewBriefPaths;
  /** The desk's recurring-defect list; rendered as a check-these-first section on the first pass. */
  recurringTraps?: readonly string[];
  /** Force the full cold brief even on a re-check — for when a fresh reviewer, not the round-1 one, reads round 2. */
  fullBrief?: boolean;
}): string {
  const { ticker, accession, judgmentText, previousReview, round, rubric, paths, recurringTraps = [], fullBrief = false } = input;
  const sha = judgmentSha256(judgmentText);
  // A re-check by the same, still-warm reviewer: it already holds the author's brief (the grounding
  // surface, proxy included) and the rubric from the previous round, and only the report and judgment
  // changed. Then the brief points at just those two, saving the ~40K-token re-read of prompt + rubric.
  // fullBrief forces the cold read for the fallback case where a fresh reviewer picks up round 2.
  const recheck = previousReview != null && !fullBrief;
  const parts = [
    `# Role\n\nYou are the editorial reviewer for the Juniper Finance Research Desk, reading the ${ticker} report built from filing ${accession}. This is round ${round}. You did not write it and you are not fixing it: you find defects against the rubric and write them to a findings file. Do not edit the judgment, the report, the facts or any other file — the findings file is your only output.`,
  ];
  if (!recheck) {
    parts.push(
      `# What to read\n\n- \`${paths.report}\` — the built report, what the reader sees.\n- \`${paths.prompt}\` — the author's brief. Its **Facts** and **Context** blocks are the grounding surface: a figure in the prose must appear there or in the report's own calls. Its Context **Proxy statement** section is the authoritative source for every governance, pay, ownership and related-party claim; when it reads "(not captured)", no such claim is supported. You do not need the raw FactPack — everything you check is on this surface.\n- \`${paths.judgment}\` — the judgment the author wrote, and the field paths your findings must name.\n- \`${paths.rubric}\` — the rubric, reproduced below so you need not open it.`,
    );
    if (recurringTraps.length)
      parts.push(
        `# Known recurring defects (check these first)\n\nThe desk has hit each of these before, and each has cost a review round. Verify each against the grounding surface before you read for anything else.\n${recurringTraps.map((t) => `- ${t}`).join("\n")}`,
      );
    parts.push(`# The rubric\n\n${rubric.trim()}`);
  } else {
    parts.push(
      `# What changed — read only these\n\nYou reviewed round ${round - 1} of this report. You already hold the author's brief — the \`${paths.prompt}\` grounding surface, its Context **Proxy statement** section included — and the rubric, and neither changed. The author rewrote the judgment to address your findings. Read only:\n- \`${paths.report}\` — the rebuilt report.\n- \`${paths.judgment}\` — the rewritten judgment (the field paths your findings name).\n\nJudge against the same rubric and the same grounding surface as round ${round - 1}. Re-verdict every previous finding below first, then look only for defects the rewrite introduced.`,
    );
  }
  if (previousReview)
    parts.push(
      `# Previous findings\n\nBelow is your previous findings file verbatim. Verdict every finding in it — set \`status\` to \`addressed\` when the rewrite fixed it, or leave it \`open\` and add a \`note\` saying what is still wrong — **before you add any new finding**. Keep the ids you already issued; number new findings after the highest one.\n\n\`\`\`json\n${JSON.stringify(previousReview, null, 2)}\n\`\`\``,
    );
  parts.push(
    `# Output\n\nWrite one JSON object matching this schema, and nothing else, to \`${paths.findings}\`.\n\n- \`judgmentSha256\` must be exactly \`${sha}\` — the hash of the judgment you just read.\n- \`round\` is ${round}.\n- \`reviewer\` is your model name.\n- \`reviewedAt\` is the current UTC time in ISO 8601 (\`2026-09-14T10:00:00Z\`).\n- \`verdict\` is \`approved\` when nothing is open, \`approved-with-minors\` when only Minors are open, \`needs-fix-round\` when any Critical or Important is open.\n- Every new finding has \`status: "open"\`. A Critical or Important may never be \`declined\`.\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(EditorialReviewShape), null, 2)}\n\`\`\``,
  );
  return parts.join("\n\n") + "\n";
}
