---
name: synthesize
description: Author the judgment half of an equity report for a captured filing and build the published Report. Usage — /synthesize <TICKER> <ACCESSION>
---

# synthesize

You are the `Synthesizer` for this run: the code renders the prompt, you write the judgment, the code validates and merges. Three authoring rounds at most, then two review rounds at most.

## Choosing what to synthesize next

When several detected filings are waiting and the user has not named one, order them with the
pre-synthesis screen before starting: `npm run screen -- --query <TICKER ...>` (or `--pending` for
filings already captured under `data/raw/`), run each printed Shibui call and save its response
verbatim, then `npm run screen -- --rank <saved.json>`. Synthesize the top-ranked first — high Street
upside is where BUYs come from; `HOLD?` rows go last. The screen only orders the queue: never skip
or drop a filing because of it, and a filing the user asked for by name is synthesized regardless of
its rank.

## Steps

1. `npm run synth:prompt -- <TICKER> <ACCESSION>` — prints the prompt path and the judgment path.
2. Read the prompt file in full. Write the complete judgment object it asks for to the judgment path (valid JSON, nothing else in the file).
3. `npm run synth:build -- <TICKER> <ACCESSION>`. Before any republish of a published report (a
   `synth:build --date` on corrected inputs, or a re-run on today's pack), first run
   `npm run grounding:sweep -- <TICKER>`: it re-runs the grounding check read-only and lists every figure that
   would fail `validate`, with the reason. A figure it lists needs a fix round; never edit a reviewed judgment
   just to make the sweep pass.
4. If it fails: `npm run synth:prompt -- <TICKER> <ACCESSION> --with-errors`, then
   read **only the printed delta file** (`<ACCESSION>.prompt.delta.md`) — it holds
   every error; the rest of the prompt is byte-for-byte the one you already read,
   so do not re-read the full `.prompt.md`. Rewrite the **whole** judgment file and
   return to step 3. Stop after the third failed build and report the residual
   errors verbatim. A build that fails at `input check` (a Shibui FAIL) is not an
   authoring error: stop and report it; the pack must be re-captured or the fail
   accepted before any judgment is written.
5. On a build that fails **only** at the editorial gate with "missing", "stale" or "unstamped":
   build once with `npm run synth:build -- <TICKER> <ACCESSION> --skip-review` so
   the lint and grounding pass and `data/<ticker>.json` exists for the reviewer —
   nothing is published behind the flag; the gated build at the end of this step
   (step 5, without the flag) is the publish. Then
   `npm run synth:review-brief -- <TICKER> <ACCESSION>`. The brief refuses until
   `<ACCESSION>.prompt.md` and `data/<ticker>.json` carry today's inputs: run what it
   names (`synth:prompt`, or `synth:build --skip-review`) and render it again. It also
   refuses to overwrite a brief that a reviewer may still be reading (one rendered for
   other inputs that no newer findings file answers): stop that reviewer, delete the
   brief it names, and re-render. Hand the printed brief
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
   - **Inputs changed** (the brief prints "full brief — inputs changed: …" or
     "previous review unstamped"): the pack, the desk's Calls or the Context moved
     since the last round, so the brief is a forced full brief with a "What changed
     since round N" section. Hand it to the same reviewer if it is still alive,
     otherwise to a fresh one.
   The reviewer copies two values into the findings file: `judgmentSha256`, and
   `inputs` from the `Inputs fingerprint` line of `prompt.md` (the brief's Output
   section prints both). Wait for the findings file, then run
   `npm run synth:build -- <TICKER> <ACCESSION>` again. The gate names what moved:
   - `stale (judgment)`: the judgment changed since the review; re-check (step 6).
   - `stale (facts | calls | context)`: the review predates the current inputs;
     rebuild with `--skip-review`, re-render the brief (it will be a full brief) and
     re-run the review.
   - `unstamped`: the findings file has no valid `inputs` (missing, or mis-copied);
     continue the same reviewer to re-copy it from the `Inputs fingerprint` line.
     If the inputs changed since its brief, re-render the brief and re-run the review.
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
- Never write or edit `judgmentSha256` or `inputs` in a findings file on the reviewer's behalf: only the reviewer
  copies them, from the text it read. A `desk.rating` change ships with
  `node --import tsx scripts/rekey-review-calls.ts --from <old desk commit> --to <new desk commit>` (dry run, then
  `--apply`) as an approved data commit that lists its re-review reports.
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
