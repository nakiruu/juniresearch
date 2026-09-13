# Synthesis — design

**Date:** 2026-09-13
**Subsystem:** 3 of 5 (model synthesis)
**Depends on:** subsystem 1 (render site) and subsystem 2 (fact pipeline), both merged to `main` at `1ee7e3c`

## Purpose

Subsystem 2 produces a validated FactPack per filing and projects its numbers
onto the Report contract. Subsystem 3 produces the other half — the analyst's
judgment: rating, target range, scenarios, thesis, and every commentary field —
and merges the two into a `Report` that the render site publishes.

The model writes prose and calls. Code writes everything derivable, validates
everything checkable, and refuses to publish a report that fails. The FactPack
is the only source of numbers; a figure the model cannot point to in the facts
or the captured context is a validation error, not a style problem.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The synthesis driver is a **Claude Code skill** (`/synthesize`) behind a `Synthesizer` seam; the API driver comes later | No API key is configured; the session model is available; the same pattern carried subsystem 2 (`FactSource`). Prompt assembly, the judgment contract, validation and merge are code either way — only the caller changes. |
| 2 | **Single-shot judgment JSON with a code-side validation loop** (≤ 3 rounds) | One prompt, one object, one validator. The loop is the reconciliation mechanism; the prompt orders the calls (rating, scenarios) before the prose so a single pass stays internally consistent. Sectioned or two-pass generation adds orchestration without adding a guarantee the loop does not already give. |
| 3 | **Numbers in prose are machine-checked** against the FactPack and the captured context | "Do not invent numbers" must be a property of the artefact, not of the prompt. A public research page cannot rely on a model's promise. |
| 4 | **The model decides the rating; code enforces consistency** (an upside envelope per label, band brackets the base case, scenario ordering) | Conviction may legitimately differ from arithmetic; blatant contradiction may not. Mechanical rating from scenarios would make the analyst a formula. |
| 5 | The **judgment contract is a separate Zod schema** (`Judgment`), stricter than `Report`, exported to JSON Schema for the prompt | The model targets exactly what code validates; array bounds and character caps become Zod errors instead of layout surprises. |
| 6 | **Facts the model may quote are rendered in the prompt exactly as the reader will see them**, through the frozen `lib/format.ts` | The grounding index is built from the same strings, so a quoted figure always passes; the model never does arithmetic. |
| 7 | The **multiples table carries the company column only** until a peer source exists | Peer multiples are not in the FactPack; the "~40x" strings in the hand-built fixture were indicative and unsourced. No invented peers. |
| 8 | The **hand-built `data/avgo.json` becomes a test fixture** (`lib/__fixtures__/avgo-golden.json`); `data/` holds generated reports only | `data/` is the published set; the golden is a test asset. Subsystem 2's parity tests and subsystem 1's render tests re-point to the golden and keep their meaning. |
| 9 | **Desk identity and style live in config** (`data/desk/desk.json`), never in the model's output | Byline, disclaimer and house style are not judgment. The file sits one level below `data/` because `lib/reports.ts` treats every `data/*.json` as a report. |
| 10 | Judgment files are **committed**; prompts and error lists are git-ignored | The judgment is the model's authored artefact and belongs in review diffs; prompts are reproducible from the FactPack and the config. |

## Architecture

```
data/facts/<T>/<acc>.json ──► synth:prompt ──► data/judgment/<T>/<acc>.prompt.md   (git-ignored)
                                                       │  /synthesize: the session model reads the prompt
                                                       ▼  and writes the judgment
                                   data/judgment/<T>/<acc>.json                    (committed)
                                                       │
data/facts/<T>/<acc>.json ──► synth:build ── mergeReport(projectReportFacts, judgment, desk, buildDate)
                                                       ├──► Report.parse
                                                       ├──► validateReport        (subsystem 1's rules)
                                                       └──► validateJudgment      (rating bands, grounding, Markdown lint, segments)
                                        pass ──► data/<ticker>.json          fail ──► data/judgment/<T>/<acc>.errors.txt (git-ignored)
```

```
lib/synth/
  judgment.schema.ts    Judgment (Zod) + judgmentJsonSchema() via zod v4's toJSONSchema
  desk.schema.ts        Desk (Zod): analyst, analystName, disclaimer, styleRules[]
  prompt.ts             renderPrompt(pack, facts, desk, opts?) → string
  grounding.ts          numericTokens(md), buildAllowedIndex(pack, factsBlock), checkGrounding(judgment, index)
  validate-judgment.ts  validateJudgment(judgment, facts, pack) → ValidationIssue[]
  merge.ts              mergeReport(facts, judgment, desk, buildDate) → Report
  synthesizer.ts        interface Synthesizer { synthesize(prompt: string, priorErrors?: string[]): Promise<unknown> }
scripts/
  synth-prompt.ts       npm run synth:prompt -- <T> <acc> [--with-errors]
  synth-build.ts        npm run synth:build  -- <T> <acc>
.claude/skills/synthesize/SKILL.md
data/desk/desk.json
data/judgment/<T>/<acc>.json
lib/__fixtures__/avgo-golden.json, lib/__fixtures__/avgo-golden-judgment.json
```

Nothing under `lib/synth/` touches the network or the filesystem; the two
scripts do the I/O. `ValidationIssue` is subsystem 1's shape (`{ field,
message, value }`), so every validator's output reads the same way and can be
concatenated into one re-prompt payload.

## The Judgment contract

The model writes exactly the fields code cannot derive. Everything else is
filled by `mergeReport`.

| Judgment field | Bounds | Merge behaviour |
|---|---|---|
| `meta.subtitle`, `meta.fiscalYearEnd` | non-empty strings, ≤ 160 / ≤ 40 chars | `reportDate` = build date ("September 13, 2026"); `asOf`, `filing`, `company`, `ticker`, `exchange` from facts; `analyst`, `analystName` from desk |
| `rating.label` | enum `STRONG BUY \| BUY \| HOLD \| SELL \| STRONG SELL` | `tone` set by code: bull for the two buys, secondary for HOLD, bear for the two sells; `thesis.label` = `rating.label` |
| `rating.targetLow`, `rating.targetHigh` | positive numbers | copied |
| `analystCommentary` | Markdown ≤ 2,500 | → `analystSentiment.commentary`; the numbers come from facts |
| `executiveSummary.companyOverview`, `.thesis.body` | Markdown ≤ 2,500 / ≤ 1,500 | copied |
| `executiveSummary.catalysts[]`, `.risks[]` | 3–6 items, each ≤ 600 | copied |
| `financials.incomeCommentary`, `.balanceCommentary`, `.cashflowCommentary` | Markdown ≤ 2,500 each | tables and their `note` come from facts; the note is set by code: "Source: Bigdata.com company tearsheet (FMP); fiscal years ended <FYE>." |
| `valuation.multiplesCommentary`, `.scenarioCommentary` | Markdown ≤ 2,500 | the multiples table is `columns: ["Multiple (TTM)", "<TICKER>"]` with the company column only and `note: "Peer multiples pending a peer data source."` |
| `valuation.scenarios[]` | exactly 3; `name` ≤ 20, `driver` Markdown ≤ 600, `impliedPrice` > 0, `probability` in (0, 1) | copied; `computeScenarios` derives weighted values at render |
| `businessMoat.segments[]` | one entry per fact segment, `{ name, body ≤ 1,200 }` | joined to facts by `name`; share and revenue from facts |
| `businessMoat.moatRating` | enum `WIDE \| NARROW \| NONE` | copied (Report keeps the string) |
| `businessMoat.moatFactors[]` | 2–5 of `{ name ≤ 60, strength ≤ 30, body ≤ 800 }`, names unique | copied |
| `businessMoat.durability` | Markdown ≤ 1,500 | copied; `segmentsBasis`, `geographyBasis` from facts |
| `growth.points[]` | 3–6 items ≤ 600 | copied |
| `management.leadership`, `.capitalAllocation`, `.governance`, `.insiderOwnership?` | Markdown ≤ 1,500 | copied |
| `risks.idiosyncratic[]`, `.systemic` | 2–5 items ≤ 800; ≤ 1,500 | copied |
| `finalRecommendation.body[]` | 1–3 paragraphs ≤ 1,200 | copied |

`null` is not permitted anywhere in a judgment; optional fields are omitted.
`snapshot` is facts-only (the sixteen projected cells). `disclaimer` comes from
the desk config.

## The prompt

`renderPrompt` is pure and deterministic. One Markdown document:

1. **Role and house style** — desk name, byline, and the desk's `styleRules`
   (evidence-led; one claim per sentence; no hype vocabulary; name the period
   when quoting a figure; American spelling).
2. **Authoring contract** — the Markdown subset (`**bold**`, `### `/`#### ` at
   block start, `- ` lists, `{+ +}`/`{- -}` spans, no nesting, no HTML, no
   links, no tables); ratios not percentages in numeric fields; **quote figures
   exactly as they appear in the Facts or Context blocks — never compute, never
   recall**; omit optional fields rather than writing `null`.
3. **Facts block** — rendered through `lib/format.ts`: the sixteen snapshot
   cells (`formatSnapshot`), the three statement tables cell by cell
   (`formatCell`), the multiples column, analyst sentiment, segments and
   geography with shares, and FactPack fields the page does not show: FY+1 and
   FY+2 revenue and EPS estimates, TTM margins, the latest-quarter line, the
   52-week range, dividend yield.
4. **Context block** — under headings carrying source and date: company
   description, MD&A (≤ 16,000), risk factors (≤ 8,000), transcript highlights
   (≤ 8,000), headlines (≤ 10, with publisher and date). Verbatim; code
   summarises nothing.
5. **Output contract** — the Judgment JSON Schema, the file path the driver
   expects, and "return the complete object every time".
6. **Prior errors** — present only on a re-prompt: the validator messages
   verbatim under "Fix every item below and return the full object".

Expected size for AVGO: 35–40k characters.

## Validation

`synth:build` runs, in order, and stops at the first stage that fails:

1. `Judgment.parse` on the judgment file (bounds, enums, shapes).
2. `mergeReport` → `Report.parse`.
3. `validateReport` — subsystem 1's rules, unchanged.
4. `validateJudgment`:
   - **Rating envelope.** Fair value = Σ `impliedPrice × probability`; upside
     `u` = fair value ÷ current price − 1. Each label has an envelope the
     upside must fall in — envelopes overlap so a conservative label is
     allowed and only a contradiction fails: STRONG BUY `u ≥ +0.25`; BUY
     `u ≥ +0.10`; HOLD `−0.10 ≤ u ≤ +0.15`; SELL `u ≤ −0.05`; STRONG SELL
     `u ≤ −0.20`. (The hand-built AVGO report — BUY at a weighted +34% — passes;
     a BUY at −3% or a HOLD at +40% fails.) `targetLow < targetHigh`. Where
     scenario names match `/bull/i`, `/base/i`, `/bear/i`, prices must satisfy
     bull ≥ base ≥ bear.
   - **Grounding.** `numericTokens(md)` extracts every figure from Markdown,
     normalising sign, `$`, `%`, `x`, `K/M/B/T` suffixes, thousands separators
     and ranges (`$350–$600` → 350, 600). The allowed index is the union of:
     every FactPack number expanded to its display scalings (a USD amount →
     itself, thousands, millions, billions; a ratio → itself, ×100), every
     token of the rendered facts block, and every token of the context
     excerpts. A figure passes if it equals an indexed value when the indexed
     value is rounded to the figure's own precision, or lies within 0.5% of
     one. Allow-listed without lookup: integers 0–12, years 1990–2040, `Q1`–`Q4`,
     `FY24`-style labels, ISO and month-name dates. Every miss is an issue:
     `sections.executiveSummary.thesis.body: "$17.9B" is not in the facts or the
     captured context`.
   - **Markdown lint.** No HTML tags, no nested emphasis markers, headings only
     at block start, no tables, links or images.
   - **Segments.** One body per fact segment name and no extra names;
     `moatFactors` names unique.

Every failure names the field and the value. On failure the CLI writes
`data/judgment/<T>/<acc>.errors.txt` and exits 1; nothing under `data/` root
changes.

## The loop

`.claude/skills/synthesize/SKILL.md`:

1. `npm run synth:prompt -- <T> <acc>` (adds `--with-errors` from round 2).
2. Read the prompt; write the complete Judgment object to
   `data/judgment/<T>/<acc>.json`.
3. `npm run synth:build -- <T> <acc>`.
4. On failure, return to 1. Three rounds at most; then stop and report the
   residual errors.

The skill contains the loop and nothing else — no style rules, no numbers, no
field list; those are in the prompt the code renders.

## Merge details

- `rating.tone`, `thesis.label`, table notes, the multiples table shape,
  `snapshot`, `quote`, `analystSentiment` numbers, `meta` identity fields,
  `disclaimer` are set by code.
- `meta.reportDate` is the build date rendered as "Month D, YYYY" in UTC;
  `meta.asOf` is the FactPack's quote date rendered "Mon D, YYYY".
- `schemaVersion` is the current `SCHEMA_VERSION`.
- Byte-for-byte reproducibility: `synth:build` on a committed judgment
  regenerates `data/<ticker>.json` identically when the build date is passed
  (`--date YYYY-MM-DD`); the skill passes today's date and the value is
  recorded in the report.

## Fixture move

`data/avgo.json` (the hand-built report) is copied to
`lib/__fixtures__/avgo-golden.json`; its judgment slice is extracted once into
`lib/__fixtures__/avgo-golden-judgment.json`. Every test that imported
`@/data/avgo.json` imports the golden instead. After the real AVGO run,
`data/avgo.json` is the generated report and `lib/reports.ts` is unchanged.

## Testing

Vitest, all pure except the final end-to-end step.

- `grounding.test.ts` — a table of prose → tokens; matching against the real
  AVGO FactPack: `$29.6B` ↔ 29,591,000,000 passes, `86%` ↔ 0.8551 passes,
  `$16.7B` passes only because the transcript contains it, `$17.9B` fails.
- `prompt.test.ts` — the AVGO prompt contains the formatted snapshot strings,
  every context heading with source and date, the JSON Schema, and the errors
  section only when given; identical output for identical input.
- `judgment.schema.test.ts` — the golden judgment parses; an over-long thesis
  and a two-scenario set are rejected; `null` is rejected.
- `validate-judgment.test.ts` — the rating-envelope table (each label × upside, including the overlaps);
  scenario ordering; Markdown lint cases; and the golden judgment against the
  real FactPack, asserting the exact list of grounding misses it produces (the
  hand-written 68% non-GAAP margin and any figure absent from the captured
  context). This calibrates the lint on real prose.
- `merge.test.ts` — golden judgment + AVGO facts → a Report that passes
  `Report.parse` and `validateReport`; tone and thesis label follow the rating;
  snapshot and tables are the projected facts untouched; the multiples table
  is company-only.
- End to end — after the real AVGO run, `synth:build --date <D>` on the
  committed judgment reproduces `data/avgo.json` byte-for-byte; `npm run build`
  renders it; screenshots of both themes at desktop and phone width.

## Error handling

- Missing FactPack, judgment, or desk file: the CLI names the path and exits 2.
- Judgment that is not valid JSON: the parse error, exit 1, written to the
  errors file so the re-prompt carries it.
- Validation failures: all issues collected across the four stages that ran,
  printed and written, exit 1. No partial report.
- `data/<ticker>.json` is written only after every stage passes.

## Out of scope

- The API `Synthesizer` (needs `ANTHROPIC_API_KEY`; the seam is here)
- Peer multiples and a peer data source
- PDF export, publishing, ISR (subsystems 4–5)
- More than one ticker; scheduling
