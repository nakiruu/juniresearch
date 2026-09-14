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
  facts: string;
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
}): string {
  const { ticker, accession, judgmentText, previousReview, round, rubric, paths } = input;
  const sha = judgmentSha256(judgmentText);
  const parts = [
    `# Role\n\nYou are the editorial reviewer for the Juniper Finance Research Desk, reading the ${ticker} report built from filing ${accession}. This is round ${round}. You did not write it and you are not fixing it: you find defects against the rubric below and write them to a findings file. Do not edit the judgment, the report, the facts or any other file — the findings file is your only output.`,
    `# What to read\n\n- \`${paths.report}\` — the built report, what the reader sees.\n- \`${paths.prompt}\` — the author's brief. Its **Facts** and **Context** blocks are the grounding surface: a figure in the prose must appear there, in the report's own calls, or in the Context excerpts.\n- \`${paths.judgment}\` — the judgment the author wrote, and the field paths your findings must name.\n- \`${paths.facts}\` — the FactPack. Its \`context.proxyStatement.text\` is the authoritative proxy excerpt for every governance, pay, ownership and related-party claim.\n- \`${paths.rubric}\` — the rubric, reproduced below so you need not open it.`,
    `# The rubric\n\n${rubric.trim()}`,
  ];
  if (previousReview)
    parts.push(
      `# Previous findings\n\nThis is round ${round}. Below is your previous findings file verbatim. Verdict every finding in it — set \`status\` to \`addressed\` when the rewrite fixed it, or leave it \`open\` and add a \`note\` saying what is still wrong — **before you add any new finding**. Keep the ids you already issued; number new findings after the highest one.\n\n\`\`\`json\n${JSON.stringify(previousReview, null, 2)}\n\`\`\``,
    );
  parts.push(
    `# Output\n\nWrite one JSON object matching this schema, and nothing else, to \`${paths.findings}\`.\n\n- \`judgmentSha256\` must be exactly \`${sha}\` — the hash of the judgment you just read.\n- \`round\` is ${round}.\n- \`reviewer\` is your model name.\n- \`reviewedAt\` is the current UTC time in ISO 8601 (\`2026-09-14T10:00:00Z\`).\n- \`verdict\` is \`approved\` when nothing is open, \`approved-with-minors\` when only Minors are open, \`needs-fix-round\` when any Critical or Important is open.\n- Every new finding has \`status: "open"\`. A Critical or Important may never be \`declined\`.\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(EditorialReviewShape), null, 2)}\n\`\`\``,
  );
  return parts.join("\n\n") + "\n";
}
