# Subsystem 3b — Desk lint and the editorial review loop

**Date:** 2026-09-14
**Status:** approved design, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-09-13-synthesis-design.md` (subsystem 3)

## Purpose

Every report produced so far needed two or three editorial rounds run by hand,
and the findings repeated: a figure introduced twice in one section, a sentence
near-verbatim in two sections, a superlative borrowed from the company's copy,
a bull/bear span wrapped around a whole sentence, a claim the source does not
make, a control figure stated and never read for the holder. The machine
checks in `synth:build` catch none of these; they check schema, arithmetic and
grounding. Subsystem 3b closes that gap in two layers:

1. **Deterministic lint** — code checks for the mechanical desk rules, run
   inside `synth:build` with the other validators, with a severity per rule.
2. **Editorial review** — a written rubric, a structured findings file, and a
   reviewer step in the `/synthesize` loop, so a report cannot be published
   until a fresh reviewer has passed it against the rubric.

The result: reports leave the loop already reviewed; the manual rounds that
cost most of this week's authoring time become the exception.

## Decisions

1. Deterministic checks live in `lib/synth/lint/` and run in `synth:build`'s
   validation stage, next to `validateJudgment`; nothing is a separate command
   the skill could skip. The report validator `lib/validate.ts` stays frozen.
2. Severity is tiered: errors block the build and go back to the author like
   grounding errors; warnings are printed, written to the errors file, and
   rendered to the author as "fix if cheap". Rules are assigned a severity
   below; the desk config cannot promote or demote them (fewer knobs).
3. Word lists and thresholds are desk configuration (`data/desk/desk.json`,
   new `lint` key with schema defaults), because they are style, not code.
4. The editorial reviewer is a fresh model dispatched by the `/synthesize`
   skill from a rendered brief, mirroring how the author is driven. The
   contract is the findings file, so an API-driven reviewer can replace the
   dispatch later without changing anything else.
5. `synth:build` gates publication on that findings file: present, matching the
   judgment's content hash, no Critical or Important finding open.
   `--skip-review` bypasses with a printed warning, for local experiments.
6. At most two review rounds per report; Minors may stay open and are printed.
7. Section units for the "once per section" and "no sentence in two sections"
   rules are the eleven units listed below (the nine the page renders, with the
   scenario driver cells and the company overview split out) — not the leaf fields. This matches how the reviewers read the reports.

## Architecture

```
synth:prompt ──▶ author writes judgment ──▶ synth:build
                                              ├─ Judgment.parse, Report.parse
                                              ├─ validateReport, validateJudgment   (existing)
                                              ├─ lintJudgment                      (new: errors + warnings)
                                              ├─ editorial gate                     (new: findings file)
                                              └─ write data/<ticker>.json
synth:review-brief ──▶ reviewer writes .editorial.json ──▶ synth:build (gate)
synth:prompt --with-review ──▶ author fixes ──▶ synth:build ──▶ synth:review-brief (re-check) …
```

New modules:

- `lib/synth/lint/units.ts` — maps a `Judgment` to the eleven section units,
  each a list of `{ path, text }` leaves (`stringLeaves` from `walk.ts`).
- `lib/synth/lint/sentences.ts` — sentence splitting and normalisation shared
  by the repetition and pointer rules.
- `lib/synth/lint/rules/*.ts` — one file per rule, each exporting
  `(units, desk) => LintIssue[]`.
- `lib/synth/lint/index.ts` — `lintJudgment(judgment, desk): LintIssue[]` and
  the `LintIssue` type.
- `lib/synth/editorial.schema.ts` — the findings-file contract.
- `lib/synth/editorial.ts` — load, status, and rendering of findings.
- `scripts/synth-review-brief.ts` — renders the reviewer's brief.
- `data/desk/editorial-rubric.md` — the rubric.

Changed: `lib/synth/desk.schema.ts` (the `lint` key), `lib/synth/prompt.ts`
(`--with-errors` renders warnings; `--with-review` renders findings),
`scripts/synth-build.ts` (lint stage, gate, `--skip-review`),
`scripts/synth-prompt.ts` (`--with-review`), `.claude/skills/synthesize/SKILL.md`
(the review steps), `package.json` (`synth:review-brief`), `README.md`, and the
subsystem 3 spec (a revision note pointing here).

## Section units

| Unit | Judgment fields |
| --- | --- |
| `analystCommentary` | `analystCommentary` |
| `companyOverview` | `sections.executiveSummary.companyOverview` — the descriptive overview; it introduces figures the thesis argues from (*added 2026-09-14 at the corpus checkpoint*) |
| `executiveSummary` | `sections.executiveSummary.*` except the overview (thesis body, catalysts, risks) |
| `financials` | `sections.financials.*` |
| `valuation` | `sections.valuation.multiplesCommentary`, `sections.valuation.scenarioCommentary` |
| `scenarioDrivers` | `sections.valuation.scenarios[*].driver` — the table cells; a driver may carry a price the commentary also introduces |
| `businessMoat` | `sections.businessMoat.*` |
| `growth` | `sections.growth.points` |
| `management` | `sections.management.*` |
| `risks` | `sections.risks.*` |
| `finalRecommendation` | `sections.finalRecommendation.body` |

`meta.subtitle` and `meta.fiscalYearEnd` are outside every unit; scenario
`name` fields and moat-factor `name`/`strength` labels are outside every unit.
Cross-unit rules (`sentence-repeat`, `sentence-similar`) treat `scenarioDrivers`
like any other unit.

## The lint issue

```ts
interface LintIssue extends ValidationIssue {   // { field, message, value }
  rule: string;                                  // e.g. "figure-repeat"
  severity: "error" | "warning";
}
```

`field` is the judgment path of the offending leaf (`sections.financials.incomeCommentary`,
`sections.executiveSummary.catalysts[2]`); `value` is the offending token,
span or sentence; `message` names the rule's expectation. In the errors file
and the console an issue prints as
`lint/figure-repeat: sections.financials.incomeCommentary: "65.2%" is introduced twice in financials — introduce a figure once per section and refer back in words (received "65.2%")`,
and warnings print with a `warn:` prefix.

## Rules

Tokens come from `numericTokens` in `lib/synth/grounding.ts` (the same
tokeniser the grounding check uses, with its allow-list of bare integers ≤ 12
and years). A token's display key is its text as written after trimming
whitespace (`65.2%`, `$5,207,393`, `-$23.7B`, `850`), so `$5.2B` and
`$5,207,393` are different figures — the desk's "once" is about the reader
seeing the same number twice, not about equal values.

### Errors

**`figure-repeat`** — a display key appears twice within one field (leaf),
or twice anywhere within the `executiveSummary` unit (its catalysts and risks
must point, not restate the thesis). Reported once per key per field or unit,
at the second occurrence — where a second occurrence inside the same sentence
is one introduction, not two (*corpus checkpoint, 2026-09-14: "all 30
gigawatts … 30 gigawatts"*). The other exclusion is the tokeniser's allow-list
(bare integers ≤ 12, years); the rating's target range and the fair value
count like any other figure. A repeat across *different fields* of any other
unit is the warning `figure-repeat` (severity `warning`) — see below.
*Revised 2026-09-14 while planning: measured against the approved reports, the
unit-wide error fired 15–36 times per report; the reviewers had applied "once
per section" at field level, plus the executive summary as a whole.*

**`sentence-repeat`** — a sentence of eight or more words appears in two
different units after normalisation (lowercase; markers, punctuation and
digits stripped; whitespace collapsed), or two sentences from different units
have word-trigram Jaccard similarity ≥ 0.80. Reported at the later unit in
render order, naming the earlier field. Within one unit the same test is also
an error (a paragraph repeated in the same section).

**`span-scope`** — the content of a `{+ +}` or `{- -}` span contains no numeric
token and is longer than three words. (Spans go around signed changes or
explicit positives/negatives, never around whole sentences.)

**`hype-word`** — a word from `desk.lint.hypeWords` (default: massive,
incredible, game-changing, skyrocket, skyrocketing, revolutionary, explosive)
anywhere in a unit, case-insensitive, whole word.

**`superlative`** — a word from `desk.lint.superlatives` (default: record,
fastest, largest, biggest, highest, unprecedented, best-ever) in a sentence
that does not attribute it. A sentence attributes a superlative when, in the
same sentence, it contains an attribution phrase from
`desk.lint.attributionPhrases` (default: "what it calls", "what management calls",
"its word", "the release's word", "the company's word", "described as",
"describes as", "calls it", "calls its", "reported as", "management's phrase")
or the superlative sits inside straight or curly quotation marks. "Record" is excluded
when it is not a superlative: preceded within two words by "the", "its",
"this", "that", "in", "on", "reported", "governance" or "track" ("the
record", "not in the record", "the reported record", "track record"), or
followed by "date" ("record date"). These patterns live in the rule, not the
desk config.

**`rhetorical-question`** — a `?` in any unit's prose.

### Warnings

**`figure-repeat`** (warning form) — the same display key in two different
fields of one unit other than `executiveSummary` (e.g. a figure in
`management.leadership` and again in `management.capitalAllocation`).

**`sentence-similar`** — trigram Jaccard in [0.60, 0.80) across units.

**`judgment-superlative`** — `first` or `only` used as a superlative (`the first
…`, `the only …`) without attribution; too many innocent uses ("first quarter",
"the only other holder") to block, so the author is told to check.

**`tic`** — a phrase from `desk.lint.tics` (default: "this pack", "worth naming",
"worth stating", "worth noticing", "is where", "leg") whose count across the
whole judgment exceeds `desk.lint.ticLimit` (default 4). One issue per phrase.

**`pointer-length`** — an executive-summary catalyst or risk with more than
two sentences.

**`source-disagreement`** — two different display keys with the same unit type
appear in one sentence joined by "against", "versus" or "vs", the sentence
names a source (proxy, release, filing, statement, tearsheet, table, call,
transcript, 10-Q, 10-K, vendor, management — *corpus checkpoint, 2026-09-14:*
*without this, every year-over-year comparison fired*), and no "we use" /
"we used" / "the statement figure" resolves it — a hint that a disagreement was
stated without saying which figure was used. Warning only; the rubric covers
the rest.

## Desk configuration

```json
"lint": {
  "hypeWords": ["massive", "incredible", "game-changing", "skyrocket", "skyrocketing", "revolutionary", "explosive"],
  "superlatives": ["record", "fastest", "largest", "biggest", "highest", "unprecedented", "best-ever"],
  "attributionPhrases": ["what it calls", "what management calls", "its word", "the release's word", "the company's word", "described as", "describes as", "calls it", "calls its", "reported as", "management's phrase"],
  "tics": ["this pack", "worth naming", "worth stating", "worth noticing", "is where", "leg"],
  "ticLimit": 4,
  "similarity": { "error": 0.8, "warning": 0.6 }
},
"review": { "model": "opus" }
```

`Desk.lint` and `Desk.review` are optional in the schema with these defaults,
so the existing `desk.json` keeps parsing; the committed `desk.json` gains
both blocks explicitly so the desk can edit them.

## Loop integration

`synth:build` validation stage becomes:

```ts
const issues = [...validateReport(valid), ...validateJudgment(judgment, facts, pack)];
const lint = lintJudgment(judgment, desk);
const errors = [...issues, ...lint.filter((i) => i.severity === "error")];
const warnings = lint.filter((i) => i.severity === "warning");
if (errors.length) fail(errors, warnings, "validate");   // both written; the run fails
```

The errors file keeps its line format for errors and adds a `# warnings`
block after them; `renderPrompt`'s `# Prior errors` section renders errors as
before and adds `## Warnings (fix if cheap)` when any exist. A build that
passes with warnings prints them after the summary line and still writes the
report; the warnings are also written to the errors file so the author sees
them on the next `--with-errors` render — and the errors file is no longer
removed on success when warnings remain.

The `renderJudgmentBlock` grounding surface is unchanged; the lint never reads
the FactPack.

## Editorial review

### The rubric — `data/desk/editorial-rubric.md`

Prose the reviewer reads, in this order, each item with the failure it is
looking for and the severity it carries:

1. **Attribution (Critical)** — every figure in the prose appears on the
   grounding surface (the Facts block, the author's own calls, the Context
   excerpts) with the same quantity, period and unit; a figure attached to the
   wrong quantity, period or source is Critical even when the number exists.
2. **Unsupported claims (Critical)** — a statement of fact the surface does
   not support: an inference the source invites but does not make, a causal
   claim, a "record" or "first" the series does not show, a characterisation
   of a document the pack does not carry.
3. **Honest dating (Important)** — sourced facts carry their period; a
   proxy, press release or call fact older than the filing is dated where the
   age matters; nothing year-old is presented as current.
4. **Judgment, not restatement (Important)** — a control, ownership, pay or
   exposure figure is read for the holder; each section reaches a view the
   reader can use; a paragraph that only lists source facts is a finding.
5. **The counter-case (Important)** — each judgment names the reading that
   cuts the other way, using figures already on the page.
6. **Calls coherence (Important)** — the base case is anchored to something
   on the surface (a multiple, a guided figure, or in words); each scenario's
   probability is stated and argued once; the target band and fair value are
   consistent with the prose.
7. **Repetition and pointers (Important)** — each figure introduced once per
   section; no sentence in two sections; executive-summary catalysts and
   risks point rather than restate; the lint catches the mechanical cases,
   the reviewer catches the paraphrases.
8. **Source disagreements (Important)** — when two sources disagree on a
   figure, the report says so once and states which it used.
9. **Voice (Minor)** — no unearned superlatives, no hype, spans only around
   signed changes, one tense per paragraph, the company's phrasing quoted
   where it matters, ISO dates in prose form, tics.
10. **Fit (Minor)** — field lengths within the caps with room; nothing
    material cut only for space without being flagged.

### The findings file — `data/judgment/<T>/<acc>.editorial.json`

```ts
export const EditorialFinding = z.strictObject({
  id: z.string().regex(/^F-\d+$/),
  severity: z.enum(["Critical", "Important", "Minor"]),
  field: z.string(),                     // judgment path, e.g. sections.management.governance
  quote: z.string().min(1).max(600),     // the offending text, verbatim
  issue: z.string().min(1).max(1200),
  fix: z.string().min(1).max(1200),
  status: z.enum(["open", "addressed", "declined"]),
  note: z.string().max(600).optional(),  // author's reason when declined; reviewer's note on re-check
});
export const EditorialReview = z.strictObject({
  judgmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  reviewedAt: z.string(),                // ISO date-time
  reviewer: z.string(),                  // model or person
  round: z.number().int().min(1).max(2),
  verdict: z.enum(["approved", "approved-with-minors", "needs-fix-round"]),
  findings: z.array(EditorialFinding).max(40),
});
```

`judgmentSha256` is the SHA-256 of the judgment file's text at review time
with `

` normalised to `
` (the same file hashes the same on every
machine and after a git line-ending conversion).
Status semantics: the reviewer writes findings `open`; on a re-check the
reviewer sets `addressed` or leaves `open` (with a note); the author may set
`declined` with a note only for Minors — a declined Critical or Important is
invalid.

### Status — `lib/synth/editorial.ts`

`reviewStatus(judgmentText, review | null) → "missing" | "stale" | "open" | "clean"`:
missing (no file), stale (hash mismatch), open (any Critical or Important with
status `open`), clean (otherwise — Minors may be open). `renderEditorialFindings(review)`
renders the open findings for the author (`# Editorial findings` section:
severity, field, quote, issue, fix). `loadEditorialReview(path)` parses or
returns null, and throws on a malformed file (a malformed file is not "missing").

### The gate — `synth:build`

After the validators and the lint pass:

```
status = reviewStatus(judgmentText, loadEditorialReview(editorialPath))
if (status !== "clean" && !flags.skipReview) fail([{ field: editorialPath, message: <status-specific>, value: status }], "editorial")
if (flags.skipReview && status !== "clean") console.warn("editorial review skipped: " + status)
```

Messages: missing → "no editorial review — run synth:review-brief and dispatch
a reviewer"; stale → "the review predates the current judgment — re-run the
review"; open → "N Critical/Important finding(s) open — run synth:prompt
--with-review". The report is written only when the gate passes or is skipped.

### The brief — `npm run synth:review-brief -- <T> <ACC>`

Writes `data/judgment/<T>/<acc>.review-brief.md` (git-ignored like the prompt)
containing: the reviewer's role and the rubric; the paths to read (the report
`data/<ticker>.json`, the prompt file as the grounding surface, the FactPack's
`context.proxyStatement.text` as the authoritative proxy excerpt); the findings
file's path and its JSON schema (`z.toJSONSchema(EditorialReview)`); the
judgment's current sha256 to write into the file; the round number; and, on a
re-check, the previous findings file verbatim with the instruction to verdict
each finding (`addressed` / `open` with a note) before adding new ones. Prints
the brief path and the findings path.

### The loop — `.claude/skills/synthesize/SKILL.md`

Steps 1–4 unchanged (prompt, judgment, build, `--with-errors` rounds; the
build now also reports lint errors and warnings). Then:

5. When `synth:build` fails only at the editorial gate ("missing" or "stale"):
   `npm run synth:review-brief -- <T> <ACC>`, dispatch a **fresh** reviewer
   subagent (model per `desk.review.model`, default Opus; never the author's
   session) with the brief path, wait for the findings file, and run
   `synth:build` again.
6. When the gate reports open findings: `npm run synth:prompt -- <T> <ACC> --with-review`,
   rewrite the whole judgment addressing every Critical and Important (Minors
   at discretion; a declined Minor gets a note), rebuild, then return to step 5
   — the review is now stale and the reviewer re-checks against its own
   findings.
7. Stop after two review rounds; report the residual findings verbatim.

## Regression corpus

Fixtures under `lib/synth/lint/__fixtures__/`, extracted from git history:

| Fixture | Source | Must produce |
| --- | --- | --- |
| `orcl-10q-before.json` | `ee6850a:data/judgment/ORCL/0001193125-26-389274.json` | `sentence-repeat` between `sections.growth.points[1]` and `sections.finalRecommendation.body[0]` (the raised-outlook sentence); `figure-repeat` for `65.2%` in `financials`; `figure-repeat` for `850` and `97.9%` in `executiveSummary`; no `span-scope` |
| `orcl-10q-after.json` | `59619e8:…` | zero errors |
| `orcl-gov-before.json` | `0474e1f:…` | zero errors expected from the lint (its defects were attribution and inference — rubric items); documents the lint's limit |
| `avgo-gov-before.json` | `86052e6:data/judgment/AVGO/0001730168-26-000080.json` | `span-scope` on `{- Mr. Hartenstein was not standing for re-election -}`; `superlative` on the unattributed "record revenue" in `management.governance` |
| `avgo-final.json` | `8abc627:…` | zero errors; warnings allowed and asserted ≤ 3 |

The assertions above are the minimum each fixture test must make; the plan's
fixture task records the lint's full output per fixture and adds it to the
test as the expected set, so later rule changes are visible.

## Testing

- One test file per rule with synthetic units: the positive case, the
  exclusions (allow-listed tokens, attributed superlatives, "the record",
  spans with a figure), and the boundary (three-word span, 0.80 similarity).
- `units.test.ts`: every judgment leaf lands in exactly one unit or the
  documented exclusions.
- `lint/index.test.ts`: the regression corpus table above.
- `editorial.schema.test.ts`, `editorial.test.ts`: parse, status transitions
  (missing/stale/open/clean), a declined Critical rejected, rendering.
- `synth-review-brief` rendering test on the AVGO pack (paths, schema block,
  previous findings verbatim on a re-check).
- `synth-build` gate: integration test via the pure functions (the script
  stays untested, as today) plus a documented manual run: both published
  reports build clean with `--skip-review`, then each gets a real review
  round through the skill and builds without the flag.
- The golden fixtures (`lib/__fixtures__/avgo-golden*.json`) are untouched.

## Error handling

- A malformed findings file fails the build with the parse error (never
  treated as missing).
- A findings file whose `judgmentSha256` matches but whose `round` exceeds 2
  is accepted (the limit is the skill's, not the gate's).
- Lint rules never throw on odd input (empty strings, no sentences); a rule
  that cannot evaluate a leaf skips it.
- `--skip-review` never silently succeeds: the warning is printed and the
  report's `meta` gains no marker (the report format is frozen); the console
  is the record.

## Out of scope

- An API-driven reviewer or author (waits for the synthesizer driver).
- New desk rules beyond the nine in `desk.json`; period-naming detection for
  quoted figures (rubric item 3 covers it).
- Re-authoring the two published reports beyond one review round each.
- PDF export and publishing (subsystems 4 and 5).
