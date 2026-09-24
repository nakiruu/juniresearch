---
name: synthesize
description: Author the judgment half of an equity report for a captured filing and build the published Report. Usage — /synthesize <TICKER> <ACCESSION>
---

# synthesize

You are the `Synthesizer` for this run: the code renders the prompt, you write the judgment, the code validates and merges. Three authoring rounds at most, then two review rounds at most.

## Steps

1. `npm run synth:prompt -- <TICKER> <ACCESSION>` — prints the prompt path and the judgment path.
2. Read the prompt file in full. Write the complete judgment object it asks for to the judgment path (valid JSON, nothing else in the file).
3. `npm run synth:build -- <TICKER> <ACCESSION>`.
4. If it fails: `npm run synth:prompt -- <TICKER> <ACCESSION> --with-errors`, then
   read **only the printed delta file** (`<ACCESSION>.prompt.delta.md`) — it holds
   every error; the rest of the prompt is byte-for-byte the one you already read,
   so do not re-read the full `.prompt.md`. Rewrite the **whole** judgment file and
   return to step 3. Stop after the third failed build and report the residual
   errors verbatim.
5. On a build that fails **only** at the editorial gate with "missing" or "stale":
   build once with `npm run synth:build -- <TICKER> <ACCESSION> --skip-review` so
   the lint and grounding pass and `data/<ticker>.json` exists for the reviewer —
   nothing is published behind the flag; the gated build at the end of this step
   (step 5, without the flag) is the publish. Then
   `npm run synth:review-brief -- <TICKER> <ACCESSION>` and hand the printed brief
   to a reviewer that is never this session and never the author:
   - **Round 1** (the brief prints "round 1"): dispatch a **fresh** subagent — the
     model named by `desk.review.model` in `data/desk/desk.json` (default Opus) —
     whose entire brief is "Read <the printed brief path> and follow it." **Keep
     this subagent; you continue it on round 2.**
   - **Round 2** (the brief prints "re-check — delta"): **continue that same
     subagent** with "The judgment was rewritten — read <the printed brief path>
     and follow it." The delta brief points it at only the rebuilt report and
     judgment; it still holds the grounding surface and rubric from round 1, so it
     does not re-read them. If that subagent is gone, re-render with
     `npm run synth:review-brief -- <TICKER> <ACCESSION> --full-brief` and dispatch
     a fresh one.
   Wait for the findings file, then run `npm run synth:build -- <TICKER> <ACCESSION>` again.
6. When the gate reports open findings:
   `npm run synth:prompt -- <TICKER> <ACCESSION> --with-review`, read **only the
   printed delta file** (`<ACCESSION>.prompt.delta.md`) — it holds every open
   Critical and Important; the base prompt is unchanged from what you already hold
   — rewrite the **whole** judgment addressing all of them (Minors at your
   discretion, and a Minor you decline gets a `note` in the findings file), then
   rebuild and return to step 5 for the re-check. The rewrite makes the review
   stale, so the same reviewer re-checks against its own findings.
7. Stop after two review rounds. Report the summary line the build prints, the
   report path, and any residual findings verbatim.

## Rules

- The prompt is the only brief. It contains the facts you may quote, the context you may draw on, the contract, and the schema. Do not read the FactPack, the raw captures, or other reports.
- Never edit anything except the judgment file. Never edit the errors file, the prompt file, the facts, or `data/<ticker>.json`.
- Every figure you write must appear in the prompt's Facts or Context block, in the same form. If a claim needs a number the prompt does not contain, make the claim without the number.
- The reviewer is never you and never the author. Dispatch round 1 as a fresh
  subagent with no context but the brief path, and **keep it** for the round-2
  re-check — the same reviewer re-verdicting its own findings against only what
  changed is exactly what round 2 is for, and it saves re-reading the whole
  grounding surface. An author who reviews their own work finds nothing.
- On any `--with-errors` or `--with-review` re-render, read only the printed
  `*.prompt.delta.md` — the base prompt does not change between rounds and you
  already hold it. The full `*.prompt.md` still exists, but it is the reviewer's
  copy, not yours to re-read.
- Never edit the findings file except to set a **Minor** to `declined` with a
  `note`. A Critical or Important is addressed in the judgment or it stays open.
- `--skip-review` renders the draft `data/<ticker>.json` the reviewer reads when
  the gate would otherwise block the build. A report is never *published* behind
  `--skip-review` — the gated build at the end of step 5, run without the flag,
  is the publish.
