/**
 * review-brief.ts — the document the editorial reviewer reads, and nothing else.
 * -----------------------------------------------------------------------------
 * It mirrors renderPrompt: pure, deterministic, and the reviewer's whole brief.
 * On a re-check the previous findings go in verbatim, because the reviewer's
 * first job in round two is to verdict its own round-one findings before it
 * looks for anything new — less the two hash fields, so the only hashes in the
 * brief are the current ones the reviewer copies (plan 2026-10-08, S-3). An
 * inputs change since that round forces the cold read. The preflight and the
 * overwrite guard keep the brief bound to the prompt and report it points at.
 */
import { z } from "zod";
import { EditorialReviewShape, type EditorialReview } from "./editorial.schema";
import { judgmentSha256 } from "./editorial";
import { FactPack } from "../facts/schema";
import { projectReportFacts, type ReportFacts } from "../facts/project";
import { Judgment } from "./judgment.schema";
import type { Desk } from "./desk.schema";
import { groundingSurface, groundJudgment } from "./validate-judgment";
import { weakLine } from "./grounding";
import { renderCalls, renderFactsBlock, renderContextBlock } from "./prompt";
import { canon, inputsLine, reviewInputs, type Component, type ReviewInputs } from "./review-inputs";

/**
 * The figures the build could check only by digits or without a sign, and the assumed whole-number multiples (D2): the
 * reviewer checks these first. A judgment or pack that does not parse yields a warning instead; the brief is then
 * rendered without the two lists (the build fails on such a judgment anyway).
 */
export function briefGroundingLists(judgmentText: string, packText: string | null, desk: Desk): { weak: string[]; assumed: string[] } | { warning: string } {
  const firstLine = (e: unknown) => (e as Error).message.split("\n")[0];
  let j: Judgment;
  try { j = Judgment.parse(JSON.parse(judgmentText)); } catch (e) { return { warning: `the judgment does not parse (${firstLine(e)})` }; }
  if (packText == null) return { warning: "the pack is missing" };
  let pack: FactPack;
  try { pack = FactPack.parse(JSON.parse(packText)); } catch (e) { return { warning: `the pack does not parse (${firstLine(e)})` }; }
  const g = groundJudgment(j, groundingSurface(j, projectReportFacts(pack), pack, desk));
  return { weak: g.weak.map(weakLine), assumed: g.assumed.map((w) => `${w.field}: "${String(w.value)}"`) };
}

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
  /** Figures the build grounded only by digits or without a sign (grounding.ts weakLine); omitted → no section. */
  weak?: readonly string[];
  /** Whole-number multiples nowhere on the surface, passed as assumed-figure warnings (decision D2); omitted → no section. */
  assumed?: readonly string[];
  /** The current inputs (review-inputs.ts), which the reviewer copies next to judgmentSha256. */
  inputs: ReviewInputs;
  /** On a re-check: the components that moved since the previous review's stamp, or "unstamped" when it has none. */
  inputsChanged?: Component[] | "unstamped";
}): string {
  const { ticker, accession, judgmentText, previousReview, round, rubric, paths, recurringTraps = [], fullBrief = false, weak, assumed, inputs, inputsChanged = [] } = input;
  const sha = judgmentSha256(judgmentText);
  const inputsMoved = inputsChanged === "unstamped" || inputsChanged.length > 0;
  // A re-check by the same, still-warm reviewer: it already holds the author's brief (the grounding
  // surface, proxy included) and the rubric from the previous round, and only the report and judgment
  // changed. Then the brief points at just those two, saving the ~40K-token re-read of prompt + rubric.
  // fullBrief forces the cold read for the fallback case where a fresh reviewer picks up round 2, and so
  // does any change in the inputs: the surface the warm reviewer holds is no longer the current one.
  const recheck = previousReview != null && !fullBrief && !inputsMoved;
  const parts = [
    `# Role\n\nYou are the editorial reviewer for the Juniper Finance Research Desk, reading the ${ticker} report built from filing ${accession}. This is round ${round}. You did not write it and you are not fixing it: you find defects against the rubric and write them to a findings file. Do not edit the judgment, the report, the facts or any other file — the findings file is your only output.`,
  ];
  if (previousReview && inputsMoved) {
    const n = previousReview.round;
    const BLOCK: Record<Component, string> = { facts: "**Facts**", calls: "**Calls**", context: "**Context**" };
    parts.push(inputsChanged === "unstamped"
      ? `# What changed since round ${n}\n\nThe round-${n} findings file carries no valid inputs stamp, so what that review read cannot be compared with today's inputs. Read this brief cold, as a first pass, and re-verdict the previous findings against the current surface.`
      : `# What changed since round ${n}\n\nThe inputs the round-${n} review read have changed: ${inputsChanged.join(", ")}. Before you re-verdict anything, re-read the ${inputsChanged.map((c) => BLOCK[c]).join(" and ")} block${inputsChanged.length > 1 ? "s" : ""} of \`${paths.prompt}\` and the matching parts of the rebuilt report \`${paths.report}\`: a finding that held on the old inputs may not hold now, and the new figures may carry defects of their own.`);
  }
  if (!recheck) {
    parts.push(
      `# What to read\n\n- \`${paths.report}\` — the built report, what the reader sees.\n- \`${paths.prompt}\` — the author's brief. Its **Facts**, **Calls** and **Context** blocks, with the report's own calls, are the grounding surface. The build rejects a figure that matches nothing on it. Where the surface states a unit, scale or sign (Facts, Calls, typed Context figures), the build checks them. A Context statement-table cell carries no unit, so a figure matching one is checked by digits only, and an unsigned Context figure cannot check a sign. The section below lists every figure grounded that weakly; check its unit, scale, sign and attribution first. Which quantity and which period a figure is attached to (rubric item 1) is always yours. Its Context **Proxy statement** section is the authoritative source for every governance, pay, ownership and related-party claim; when it reads "(not captured)", no such claim is supported. You do not need the raw FactPack — everything you check is on this surface.\n- \`${paths.judgment}\` — the judgment the author wrote, and the field paths your findings must name.\n- \`${paths.rubric}\` — the rubric, reproduced below so you need not open it.`,
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
  if (weak)
    parts.push(`# Weakly grounded figures — check unit, scale, sign and attribution first\n\n${weak.length
      ? `Each of these grounds only through a unit-less Context table cell, a Context money cell read at another scale, or an unsigned Context figure, so the build could not check the unit, scale or sign.\n${weak.map((w) => `- ${w}`).join("\n")}`
      : "None: every figure grounds on an entry whose unit, scale and sign the build checks."}`);
  if (assumed)
    parts.push(`# Assumed figures\n\n${assumed.length
      ? `No figure on the surface comes near these whole-number multiples: they are the author's valuation assumptions, and the build passes them as warnings. Each must state its basis in the same sentence; a bare assumption is a finding.\n${assumed.map((a) => `- ${a}`).join("\n")}`
      : "None."}`);
  if (previousReview) {
    const rest = Object.fromEntries(Object.entries(previousReview).filter(([k]) => k !== "judgmentSha256" && k !== "inputs"));
    parts.push(
      `# Previous findings\n\nBelow is your previous findings file verbatim (hash fields omitted; take them from Output). Verdict every finding in it — set \`status\` to \`addressed\` when the rewrite fixed it, or leave it \`open\` and add a \`note\` saying what is still wrong — **before you add any new finding**. Keep the ids you already issued; number new findings after the highest one.\n\n\`\`\`json\n${JSON.stringify(rest, null, 2)}\n\`\`\``,
    );
  }
  parts.push(
    `# Output\n\n## Copy these two values exactly\n\n\`\`\`json\n"judgmentSha256": "${sha}",\n"inputs": ${inputsLine(inputs)}\n\`\`\`\n\n\`judgmentSha256\` is the hash of the judgment you just read. \`inputs\` identifies the Facts, Calls and Context you read: copy it from the \`Inputs fingerprint\` line of \`${paths.prompt}\`, and check that it equals the value above. If the two differ, stop: write no findings file, and report the mismatch.\n\nWrite one JSON object matching this schema, and nothing else, to \`${paths.findings}\`.\n\n- \`judgmentSha256\` must be exactly \`${sha}\` — the hash of the judgment you just read.\n- \`inputs\` is the value above, copied exactly, right after \`judgmentSha256\`; leave out \`source\`.\n- \`round\` is ${round}.\n- \`reviewer\` is your model name.\n- \`reviewedAt\` is the current UTC time in ISO 8601 (\`2026-09-14T10:00:00Z\`).\n- \`verdict\` is \`approved\` when nothing is open, \`approved-with-minors\` when only Minors are open, \`needs-fix-round\` when any Critical or Important is open.\n- Every new finding has \`status: "open"\`. A Critical or Important may never be \`declined\`.\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(EditorialReviewShape), null, 2)}\n\`\`\``,
  );
  return parts.join("\n\n") + "\n";
}

const COPIED_SHA = /^"judgmentSha256": "([0-9a-f]{64})",$/m;
const LEGACY_SHA = /`judgmentSha256` must be exactly `([0-9a-f]{64})`/;
const COPIED_INPUTS = /^"inputs": (\{.*\})$/m;

/**
 * May synth:review-brief overwrite the existing brief? Not when its inputs differ from today's (a brief rendered before
 * inputs existed counts as different) while no findings file newer than it answers its judgment: a reviewer may still be
 * reading it, and swapping the brief under that reviewer would launder the old review onto the new inputs.
 */
export function briefOverwriteGuard(input: {
  existingBriefText: string | null;
  currentInputs: ReviewInputs;
  findings: { judgmentSha256: string } | null;
  briefMtime: number | null;
  findingsMtime: number | null;
  briefPath?: string;
}): { ok: true } | { ok: false; message: string } {
  const { existingBriefText: text, currentInputs, findings, briefMtime, findingsMtime, briefPath = "the review brief" } = input;
  if (text == null) return { ok: true };
  if (COPIED_INPUTS.exec(text)?.[1] === inputsLine(currentInputs)) return { ok: true };
  const briefSha = (COPIED_SHA.exec(text) ?? LEGACY_SHA.exec(text))?.[1];
  const answered = findings != null && briefSha != null && findings.judgmentSha256 === briefSha
    && findingsMtime != null && briefMtime != null && findingsMtime > briefMtime;
  if (answered) return { ok: true };
  return { ok: false, message: `${briefPath} was rendered for other inputs and no newer findings file answers it: a reviewer may be reading the brief for the old inputs; stop that reviewer, then delete \`${briefPath}\` and re-render` };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a report read from disk

/**
 * The parts of a built report (data/<t>.json) that do not carry today's projection of the pack: the snapshot prefix, each
 * appended highlight cell against the cell of the same label, the three tables' columns and rows, the company multiples,
 * the segments as a set, and the quote with its closes.
 */
export function reportMismatch(report: Json, facts: ReportFacts): string[] {
  const tbl = (t: Json | undefined) => (t ? { columns: t.columns, rows: t.rows } : undefined);
  const segs = (xs: Json[] | undefined) => xs?.map((x) => ({ name: x.name, sharePct: x.sharePct, revenue: x.revenue })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const f = facts.sections;
  const parts: Record<string, [unknown, unknown]> = {
    snapshot: [report.snapshot?.slice(0, facts.snapshot.length), facts.snapshot],
    income: [tbl(report.sections?.financials?.income), f.financials.income],
    balance: [tbl(report.sections?.financials?.balance), f.financials.balance],
    cashflow: [tbl(report.sections?.financials?.cashflow), f.financials.cashflow],
    multiples: [report.sections?.valuation?.multiples?.rows?.map((r: Json) => ({ label: r.label, value: r.values?.[0] })), f.valuation.multiplesCompanyColumn.map((m) => ({ label: m.label, value: m.value }))],
    segments: [segs(report.sections?.businessMoat?.segments), segs(f.businessMoat.segments)],
    quote: [report.quote, facts.quote],
  };
  const out = Object.entries(parts).filter(([, [a, b]]) => canon(a ?? null) !== canon(b)).map(([k]) => k);
  const cells = Object.values(facts.highlightCells);
  const appended: Json[] = Array.isArray(report.snapshot) ? report.snapshot.slice(facts.snapshot.length) : [];
  if (appended.some((c) => { const h = cells.find((x) => x?.label === c?.label); return !h || canon(h) !== canon(c); })) out.push("highlight cells");
  return out;
}

/**
 * Before a brief goes out: prompt.md carries today's Calls, Facts and Context blocks verbatim and today's inputs line, and
 * the report names this accession and carries today's projection. Then what the reviewer reads is what `inputs` describes.
 */
export function briefPreflight(input: {
  promptText: string | null;
  report: Json | null;
  facts: ReportFacts;
  pack: FactPack;
  desk: Pick<Desk, "rating">;
  accession: string;
}): { ok: true } | { ok: false; errors: string[] } {
  const { promptText, report, facts, pack, desk, accession } = input;
  const reprompt = `re-run npm run synth:prompt -- ${pack.ticker} ${accession}`;
  const rebuild = `re-run npm run synth:build -- ${pack.ticker} ${accession} --skip-review`;
  const errors: string[] = [];
  if (promptText == null) errors.push(`prompt.md is missing — ${reprompt}`);
  else {
    const stale = [
      ...([["Calls block", renderCalls(desk.rating)], ["Facts block", renderFactsBlock(facts, pack)], ["Context block", renderContextBlock(pack)]] as const)
        .filter(([, block]) => !promptText.includes(block)).map(([name]) => name),
      ...(promptText.split(/\r?\n/).includes(`Inputs fingerprint: ${inputsLine(reviewInputs(pack, desk, facts))}`) ? [] : ["Inputs fingerprint line"]),
    ];
    if (stale.length) errors.push(`prompt.md does not carry today's ${stale.join(", ")} — ${reprompt}`);
  }
  const reportPath = `data/${pack.ticker.toLowerCase()}.json`;
  if (report == null) errors.push(`${reportPath} is missing — ${rebuild}`);
  else if (report.meta?.filing?.accession !== accession) errors.push(`${reportPath} is the report for ${String(report.meta?.filing?.accession)}, not ${accession} — ${rebuild}`);
  else {
    const m = reportMismatch(report, facts);
    if (m.length) errors.push(`${reportPath} does not carry today's pack (${m.join(", ")} differ) — ${rebuild}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
