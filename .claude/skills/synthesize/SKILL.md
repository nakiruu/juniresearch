---
name: synthesize
description: Author the judgment half of an equity report for a captured filing and build the published Report. Usage — /synthesize <TICKER> <ACCESSION>
---

# synthesize

You are the `Synthesizer` for this run: the code renders the prompt, you write the judgment, the code validates and merges. Three rounds at most.

## Steps

1. `npm run synth:prompt -- <TICKER> <ACCESSION>` — prints the prompt path and the judgment path.
2. Read the prompt file in full. Write the complete judgment object it asks for to the judgment path (valid JSON, nothing else in the file).
3. `npm run synth:build -- <TICKER> <ACCESSION>`.
4. If it fails: `npm run synth:prompt -- <TICKER> <ACCESSION> --with-errors`, read the new prompt (its last section lists every error), rewrite the **whole** judgment file, and return to step 3. Stop after the third failed build and report the residual errors verbatim.
5. On a build that fails **only** at the editorial gate with "missing" or "stale":
   `npm run synth:review-brief -- <TICKER> <ACCESSION>`, then dispatch a **fresh**
   reviewer subagent — the model named by `desk.review.model` in
   `data/desk/desk.json` (default Opus), never this session, never the author —
   whose entire brief is "Read <the printed brief path> and follow it." Wait for
   the findings file, then run `npm run synth:build -- <TICKER> <ACCESSION>` again.
6. When the gate reports open findings:
   `npm run synth:prompt -- <TICKER> <ACCESSION> --with-review`, read the new
   prompt (its last section lists every open Critical and Important), rewrite the
   **whole** judgment addressing all of them — Minors at your discretion, and a
   Minor you decline gets a `note` in the findings file — then rebuild and return
   to step 5. The rewrite makes the review stale, so the reviewer re-checks
   against its own findings.
7. Stop after two review rounds. Report the summary line the build prints, the
   report path, and any residual findings verbatim.

## Rules

- The prompt is the only brief. It contains the facts you may quote, the context you may draw on, the contract, and the schema. Do not read the FactPack, the raw captures, or other reports.
- Never edit anything except the judgment file. Never edit the errors file, the prompt file, the facts, or `data/<ticker>.json`.
- Every figure you write must appear in the prompt's Facts or Context block, in the same form. If a claim needs a number the prompt does not contain, make the claim without the number.
- The reviewer is never you. Dispatch it as a fresh subagent with no context but
  the brief path; an author who reviews their own work finds nothing.
- Never edit the findings file except to set a **Minor** to `declined` with a
  `note`. A Critical or Important is addressed in the judgment or it stays open.
- `--skip-review` is for local experiments only. A report is not published
  behind it.
