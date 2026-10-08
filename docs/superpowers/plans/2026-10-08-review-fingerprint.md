# Review fingerprint (audit S-3): bind each editorial review to the inputs it read

**Status:** plan only, revision 3 (2026-10-08), final. Two adversarial reviews returned APPROVE WITH CHANGES, and every
probe number reproduced. The owner decisions are final (Section 7). Branch `claude/review-fingerprint-s3`, cut from
`main` at 60976e5.

**Audit item:** S-3 · High · process/security · `lib/synth/editorial.ts:32-36` + `scripts/synth-build.ts:120-127`.

**Baseline:** `npx vitest run` gives 137 files, 2051 passed, 4 skipped, re-confirmed on 60976e5.

> For the executor:
> - Work task by task, TDD.
> - Every task ends with a full `npx vitest run`, which must be green before the commit.
> - The old gate behaviour (judgment hash only) stays in force until Task 8 (switch-over).
> - Task 8 hard-codes the backfill cutoff. Task 9 is the backfill **data** commit (approved, D2): dry run first, then
>   apply. The branch is not merged until Task 9 has landed.
> - Run any `synth:build` in a scratch git worktree, never in the main checkout.
> - No model IDs in commits.

## Revision 2 changelog

| Item | Change |
|---|---|
| D4 / R-1 | Switched to **reviewer-copy**. The brief renders `inputs` next to `judgmentSha256`; the reviewer copies both; the gate compares. Sidecar and `synth:review-stamp` dropped. Missing or malformed `inputs` → `unstamped` with a clear message. See Section 2.2 for the one weakness against the stamp tool. |
| R-2 | The delta brief's "Previous findings" JSON drops `judgmentSha256` and `inputs`. The two values to copy are printed together in a "Copy these exactly" block. The old Section 2.2 / Section 4 contradiction (stamp step vs re-stamp under the round cap) is gone with the stamp tool. |
| R-3 | `synth:review-brief` refuses unless `prompt.md` and `data/<t>.json` both carry the current inputs. Section 5 starts with a `--skip-review` rebuild on the dev branch. Measured: 9 of the 16 would be refused today. |
| R-4 | The backfill reports every block HEAD fills by schema default. The 10 reviews from before the desk had a `rating` block are listed; their treatment is D6, with a recommendation. |
| R-5 | Builds run only in a scratch worktree, and the gate flip never ships without the backfill. In revision 3 the switch-over is Task 8 and the backfill Task 9, merged together. D2 is approved, so the "if declined" branch was removed. |
| R-6 | The backfill refuses any unstamped file reviewed after a cutoff, and the dry run is re-run immediately before the merge. (The `--cutoff` argument was superseded in revision 3 by a constant.) |
| R-7 | A defined re-key path for a `desk.rating` change (`rekey:<sha>`), built in Task 6, with D1 reframed around it. Revision 3 hardened it (N-2) and removed its use for D6 (N-1). |
| R-8 | The "scheme 1 frozen" claim is corrected. Task 1 pins literal scheme-1 hashes on frozen AVGO, JPM and UEC fixtures. |
| R-9 | `history` (the report's closes) joins the facts component. The gate and decision blocks are an explicit non-goal (DOW F-5). `--date` re-dating is a follow-up. |
| R-10 | The backfill inserts the key textually; one file (CRWD) uses a different layout. Task 0 expects the untracked plan. Task 2 adds absent→present mutations on a maximal synthetic pack. |

## Revision 3 changelog

| Item | Change |
|---|---|
| N-1 (D6) | Dropped the invented "old envelope derives the same label" test. The pre-02d1335 Calls block was an overlapping envelope with no reward/risk test and no bear floor, so it derives no single label (BAC, EWBC and HON sit in the BUY/HOLD overlap). These 10 reviews never covered today's rule. Owner decision: BAC, CBRS, HON, KTOS and T get the legacy stale sentinel and join the re-review queue. EWBC, INTC, JPM and ORCL, plus the superseded UEC 0001437749-26-019889, are re-keyed as an explicit owner acceptance (`source: "owner-accept:pre-rating"`). **Stale: 21.** |
| N-2 | The re-key restamps `calls` only when the derived label is unchanged **and** the judgment passes validate's rating and Calls-grounding checks under the new `desk.rating`. Measured: a bear floor raised by 5pp leaves every derived label unchanged but fails 23 published judgments, so a label-only re-key would restamp all 23. Task 6 tests this. |
| N-3 | `prompt.md` prints the inputs line (Task 5), so the reviewer copies from the text it read. `synth:review-brief` refuses to overwrite a review brief whose inputs differ while no newer findings file exists. The `unstamped` message says "continue the reviewer to re-copy", never "orchestrator re-copies". |
| R-6 (residual) | `--cutoff` is no longer a free argument. `BACKFILL_CUTOFF` is a constant in the backfill script, set in the switch-over commit (Task 8). The script refuses to apply while the constant is unset, and refuses any review after it; both are tested. The pre-merge dry run stays. |
| Decisions | D1, D2, D3, D5 and D6 are recorded as final in Section 7. |

---

## 0. The problem, measured

`reviewStatus` compares only `review.judgmentSha256` with the current judgment. Nothing binds a review to the pack, the
desk Calls or the context it was read against. A backfill or re-capture after approval leaves the review "clean", and
`synth:build` republishes prose against figures the reviewer never saw.

This has already happened. NBIX was reviewed at 555a2fc. The EV/EBITDA backfill (7a0c475, 2026-10-02) then rewrote its
pack and **rebuilt and committed `data/nbix.json` through the gate**. The judgment hash still matched. The published
report now shows an EV/EBITDA the reviewer saw as "—". Fifteen other reports have drifted since (Section 1.2).

## 1. Decision: what to fingerprint

### 1.1 Options

| Option | What is hashed |
|---|---|
| (a) rendered surface | `surfaceSha256` of the Facts, Calls, judgment and Context blocks (what `grounding-exceptions.ts` keys on) |
| (b) render inputs | canonical JSON of the **data** the renderers and the report's price chart read: the projected `ReportFacts` cells, the pack fields `renderFactsBlock` reads, the `pack.context` excerpts and `desk.rating` |
| (c) typed-entry multiset | sorted `(source, kind, currency, sign, abs, precision)` of every grounding-index entry |
| (d) components | per-component hashes, so the gate can name what changed. This combines with (a) or (b) |

### 1.2 Measurements

All measurements cover the 102 published reports at HEAD 60976e5, using HEAD code. The adversarial reviewer re-ran every
probe; the sources are in the Appendix.

**Stale today.** The review anchor is the last commit touching the findings file. The reviewer confirmed it: all 103
final judgment states sit in exactly one commit. The report anchor is the last commit touching `data/<t>.json`, which is
what `grounding:sweep` uses.

| Option | Stale, review anchor | Stale, report anchor |
|---|---|---|
| (a) surface | 16 | 15 |
| (b) inputs incl. `history`, rounded to 12 sig. digits | **16** (facts 16, calls 0, context 0) | 15 |
| (c) multiset | 16 | 15 |
| raw pack-file bytes (the audit's "pack hash") | 57 | 57 |
| `pack.history` alone | 0 | 0 |

- The 15 are the sweep's silent-drift list: BE CHWY DELL ESAB EVLV LITE LQDT LRCX LTRX MMM PLTR SOLS UEC VICR VSH.
- **NBIX** is the 16th at the review anchor. Its report commit already contains the backfilled pack, so the report
  anchor hides it.
- All 16 drifted in facts only, from three changes:
  - EV/EBITDA filled by 7a0c475: BE CHWY DELL LITE LRCX MMM NBIX PLTR SOLS VICR VSH;
  - TTM FCF yield filled by c93c53e: CHWY DELL ESAB LITE LQDT LRCX LTRX UEC VSH;
  - EVLV's capex and FCF rows, by cc1e51e.
- Options (a), (b) and (c) agree on all 102 reports.
- The raw-pack hash's 41 extra reports are unrendered-field backfills: beta, SBC, goodwill, `shibuiCheck`, provenance
  and `capturedAt`.

**Renderer wording changes on unchanged data** (how many of the 102 fingerprints move):

| Change | (a) | (b) | (c) |
|---|---|---|---|
| R1: the real 61102f1 `renderCalls` edit | 102 | **0** | 0 |
| R2: heading wording, no digits | 102 | 0 | 0 |
| R3a: heading with an allow-listed period digit | 102 | 0 | 0 |
| R3b: heading with a plain digit | 102 | 0 | **102** |
| R4: display precision, 1dp → 2dp | 102 | 0 | 102 |

Since 09-13, the renderer bodies changed in 20 commits: `renderFactsBlock` 8, `renderCalls` 6, `renderContextBlock` 3
and `renderJudgmentBlock` 3. Two of those landed on 10-08.

**Mutations on NVDA only.** Each mutation flagged only NVDA, or nothing.

| Mutation | (a) | (b) | (c) |
|---|---|---|---|
| M1: TTM net margin +1pp | ✓ | ✓ | ✓ |
| M2: +1e-6 (below display precision) | – | ✓ | – |
| M3: cash ↔ debt rows swapped | ✓ | ✓ | ✓ |
| M3b: FY EPS swap / M3c: 52-week low/high swap | ✓ | ✓ | **–** |
| M4: one proxy word / M5: excerpt re-dated | ✓ | ✓ | **–** |
| M6: unrendered fields only | – | – | – |
| M7: consensus target +$1 | ✓ | ✓ | ✓ |

**Desk edits.** `desk.rating.bearFloor` +1pp flags 102 under every option. A new `recurringTraps` entry flags 0 under (b).

**Completeness of (b).** Every leaf of five packs (NVDA, JPM, UEC, INTC, ALL; 1,909 leaves) was mutated one at a time.
- **Gaps: 0.** No mutation moved the rendered Facts or Context block without moving (b).
- Over-sensitive leaves: 62. These are 30 history points (6 per pack: rendered on the report's chart, not in the prompt),
  the rest are projected values whose rendered cell did not change, plus `quote.sharesSource`.

**HEAD code reproduces what reviewers saw.** For all 102 reports, `data/<t>.json` at the review commit equals HEAD's
projection of that commit's pack. The comparison covers the snapshot prefix, the three tables, the multiples and the
segments as a set: **102 of 102 match**.

**Blocks HEAD fills by schema default (R-4).** These are counts at the review commit, over all 103 findings files.
- **Desk:**
  - `recurringTraps` is absent in 35 files. It is not fingerprinted.
  - **`rating` is absent in 10:** BAC CBRS EWBC HON INTC JPM KTOS ORCL T and the superseded UEC 0001437749-26-019889.
- **Pack keys absent then and present now**, none of them fingerprinted: `beta` 56, `shibuiCheck` 58, `goodwill` 26,
  `sbc` 33, `sic` 14, `sicDescription` 14, `crosscheckOverrides` 3, `goodwillRestated` 6.

**The 10 reviews from before the desk had a `rating` block.** These reviewers read the Calls block as it stood before
02d1335:

> "your label must sit in its envelope — STRONG BUY ≥ +25%, BUY ≥ +10%, HOLD −10% to +15%, SELL ≤ −5%, STRONG SELL ≤
> −20%. A conservative label is allowed"

That envelope has overlapping bands, no reward/risk test and no bear floor. It derives no single label, so "the old rule
derives the same label as today's" cannot be tested. These reviews **never covered today's rule**. No review falls
between 1ea28c5 and 02d1335.

The table is for information only and is not a re-key test. It shows today's figures and today's rule; every judgment
passes validate's rating checks at HEAD.

| Report | E | D | R | Today's derived label | Owner treatment (D6) |
|---|---|---|---|---|---|
| BAC | 11.0% | 15.9% | 0.69 | BUY | sentinel → re-review |
| CBRS | 7.5% | 40.2% | 0.19 | HOLD | sentinel → re-review |
| EWBC | 11.0% | 17.3% | 0.64 | BUY | owner-accept |
| HON | 13.7% | 15.6% | 0.88 | BUY | sentinel → re-review |
| INTC | 3.5% | 38.2% | 0.09 | HOLD | owner-accept |
| JPM | 5.8% | 17.1% | 0.34 | HOLD | owner-accept |
| KTOS | 22.8% | 37.0% | 0.62 | BUY | sentinel → re-review |
| ORCL | 21.0% | 36.7% | 0.57 | BUY | owner-accept |
| T | 5.6% | 20.8% | 0.27 | HOLD | sentinel → re-review |
| UEC 019889 (superseded) | 6.1% | 30.9% | 0.20 | HOLD | owner-accept |

Notes on the table:
- BAC, EWBC and HON have E between +10% and +15%. That is the old envelope's BUY/HOLD overlap.
- BAC, CBRS, HON, KTOS and T get the sentinel because their prose describes the retired envelope (owner's reading).

**The bear floor and the re-key (N-2).** Raising `desk.rating.bearFloor` by 5pp leaves every derived label unchanged.
The label depends on E and R, not on the floor. It does, however, fail validate's rating checks for **23** published
judgments: ALL ALRS AMZN ATO BAC CME DD EWBC FELE GE HON JPM LH MDU MNST NEE RL RTX TJX UNH VRTX WFC WM. A re-key keyed
on the label alone would restamp all 23.

**Brief preflight (R-3).** Today, 9 published reports have a `data/<t>.json` that does not carry their HEAD pack's
projection:
- snapshot and multiples: BE DELL LRCX MMM PLTR SOLS VICR VSH;
- cash flow: EVLV.

All 9 are among the 16. The other 7 drifted only in rows the report does not show: TTM FCF yield, or CHWY/LITE/NBIX,
which were rebuilt by 7a0c475.

### 1.3 Choice: (b) render inputs, in (d) components (facts, calls, context), versioned by `scheme`

1. It meets the goal both ways:
   - Every surface data change stales the review: 0 gaps, and M1, M3–M5 and M7 flag.
   - A pure renderer wording change never stales: R1–R4 move 0 of 102.
   - Precision changes (R4) are still caught at build: `validate` re-grounds the prose on the re-rendered surface.
2. (a) costs about one renderer change a week, and each one stales all ~102 reviews. Re-keying (a) needs renderer code
   that no longer exists.
3. (c) is unsound: it misses M3b–M5, and still stales everything on R3b and R4.
4. Components let the gate and the brief name what changed.
5. The cost is conservative and small:
   - a sub-display change stales a review (M2). This occurred 0 times in the corpus.
   - Rounding numbers to 12 significant digits absorbs float noise from re-derivation without hiding a displayed change.

**Components, scheme 1** (mirroring `lib/synth/prompt.ts` and `project.ts` at 60976e5):
- **facts:**
  - from `projectReportFacts(pack)`: `snapshot`; the three statement tables (columns and rows); the company multiples
    (label and value); segments (basis, name, sharePct, revenue); geography (basis, region, sharePct); the nine
    Street-view analyst fields; `highlightCells`; and **`quote.history`** (date and close, the report's chart, R-9).
  - from the pack: `estimates.nextFY` and `estimates.followingFY` (label, revenue, eps); the seven TTM ratios the Facts
    block prints; `latestQuarter` (label, periodEnd, revenue, operatingMargin, revenueYoY); and `quote` (price, asOf,
    52-week low and high, marketCap, sharesOutstanding, sharesSource, dividendYield).
- **context:** the six `pack.context` excerpts as `{text, source, asOf, truncated}` or `null`, plus the headlines as
  `{asOf, source, text}`.
- **calls:** `desk.rating`.

The judgment block is left out. It is a function of the judgment, which `judgmentSha256` binds, and of `quote.price`.

**Left out deliberately:**
- Unrendered pack fields, listed above. Including them causes the 57-report false alarm.
- The rest of the desk: style rules, traps, lint, review model, names, disclaimer. These are guidance, re-run at build.
- The rubric. It is the reviewer's standard, not an input.
- **The gate and decision blocks** (`rating.gate`, `rating.decision`, the scorecard). These are code-derived and
  advisory: `synth:build` runs `decide()` with `enforceGate: false`, and the learnings record that author briefs must
  describe the gate as advisory (DOW F-5). A `gates.ts` change moves `gatedLabel` across many reports with no input
  change. Fingerprinting these blocks would stale reviews on scoring-code changes, not on anything the prose may quote;
  grounding rejects their figures. This is a non-goal.

**What `scheme` does and does not freeze (R-8, corrected).** Scheme 1 freezes the **field picks and the canonical form**.
It does not freeze the projection code beneath them.
- A `projectReportFacts`, formatter-input or capture change that moves a value the reviewer saw stales the affected
  reviews. That is the intended outcome; the FOUR/DSP FCF fix is the model case.
- Such a change is never silent: Task 1 pins literal scheme-1 hashes for frozen AVGO, JPM and UEC fixtures, so it fails
  CI.
- The committer then decides, in that commit, one of:
  - it was not meant to move what reviewers saw, so fix the change;
  - accept: update the pins, run `grounding:sweep`, and list the reports whose reviews go stale in the commit message;
  - change the picks under scheme 2.
- A renderer that starts reading a new field fails the Task 2 completeness test. The fix adds the field under `scheme: 2`
  and keeps the scheme-1 function, and the gate recomputes under each review's recorded scheme. Old reviews keep
  comparing on what their reviewer saw; `validate` still grounds the prose on the whole new surface.

**Grounding exceptions** keep `surfaceSha256`, and share only the `canon` and `sha256` helpers. Moving them to the
inputs fingerprint is a follow-up.

## 2. Storage, writer and check

### 2.1 Field

The findings file carries `inputs` immediately after `judgmentSha256`:

```json
"judgmentSha256": "<sha256>",
"inputs": { "scheme": 1, "facts": "<sha256>", "calls": "<sha256>", "context": "<sha256>" },
```

There is an optional `source`:
- absent: the reviewer copied the value from the brief;
- `"backfill:<sha>"`: reconstructed by Task 8 from git at that review commit;
- `"rekey:<sha>"`: `calls` re-keyed across the `desk.rating` change at `<sha>` (R-7 / N-2);
- `"owner-accept:pre-rating"`: one of the five pre-rating reviews the owner accepted under today's rule without a re-review
  (D6). This is an explicit acceptance, not a derived equivalence.

`source` is an audit trail only and is never compared.

Schema (`lib/synth/editorial.schema.ts`):
- `ReviewInputsStamp` is a strict object with `scheme` literal 1, three SHA-256 hashes, and an optional `source`
  matching `^((backfill|rekey):[0-9a-f]{7,40}|owner-accept:pre-rating)$`.
- **`EditorialReviewShape`**, the JSON Schema the brief shows reviewers, declares `inputs: ReviewInputsStamp` as
  required.
- **The parse schema** (`EditorialReview`) widens it to `inputs: z.unknown().optional()`, so a missing or malformed value
  never makes the whole file "malformed". Instead, `readInputsStamp(review)` returns `{ stamp } | { missing } |
  { malformed: message }`, and the gate reports both failures as `unstamped`.
- `loadEditorialReview` and `synth:prompt --with-review` therefore keep working on any file.

### 2.2 Who writes it: the reviewer copies it from the brief (D4, decided)

The inputs line is printed in two places, from the same `reviewInputs(pack, desk)`:
- **In `prompt.md` (N-3).** `renderPrompt` adds one line, `Inputs fingerprint: {"scheme":1,"facts":"…","calls":"…","context":"…"}`,
  in a short `# Inputs fingerprint` section placed just before `# Output`. The reviewer copies the value from the text it
  actually read. The line sits outside the Facts, Calls and Context blocks, which are what `groundingSurface` renders,
  so the grounding surface is unchanged.
- **In the brief.** `synth:review-brief` prints the same value with `judgmentSha256` in one block at the top of the Output
  section, titled "Copy these two values exactly". The brief tells the reviewer to check that the `inputs` value equals
  the `Inputs fingerprint` line of `prompt.md` and to copy it from there. If they differ, the reviewer stops and reports
  instead of writing a findings file. Preflight 1 makes this case unreachable unless `prompt.md` was edited by hand.

The reviewer copies both values. Reviewers copied `judgmentSha256` correctly in 103 of 103 files. The gate compares the
copy with the current inputs.
- A stale copy fails closed.
- Laundering would need two things together: a brief re-rendered on new inputs, **and** a reviewer who copies the new
  value without re-reviewing. That is the trust boundary `judgmentSha256` already rests on.

**Against the stamp tool, one weakness remains.** The stamp tool proved the stored value was exactly the brief's. With
reviewer-copy, a mis-copy is indistinguishable from a real input change: a typo in `calls` reads as "stale (calls)",
which sends the owner looking for a desk edit that never happened. It fails closed and is no less safe, but the
diagnosis is worse.
- Mitigation 1: when the stored value does not parse, the message says "mis-copied", not "stale".
- Mitigation 2: when a stamped component matches neither the current hash nor the hash recomputed at the findings file's
  last commit, the gate message adds "if nothing changed, the inputs were likely mis-copied; continue the reviewer to
  re-copy them". The extra check uses `git log`, so it is diagnostic only and never decides the status.

The hardening that the stamp tool needed is now in the brief itself:
- **Preflight (R-3).** `synth:review-brief` refuses unless both conditions hold:
  1. `<acc>.prompt.md` contains the current `renderCalls`, `renderFactsBlock` and `renderContextBlock` output verbatim,
     **and** its `Inputs fingerprint` line equals the current inputs. Otherwise it says "re-run synth:prompt".
  2. `data/<t>.json` exists, names this accession, and carries the current projection: the snapshot prefix (and each
     appended highlight cell equals the `highlightCells` cell with its label), the three tables' columns and rows, the
     company multiples, the segments as a set, and `quote` including `history`. Otherwise it says "re-run
     synth:build --skip-review".

  Together these guarantee that what the reviewer reads (prompt and report) is what the copied `inputs` describe.
- **No silent re-render (N-3).** `synth:review-brief` reads the inputs value from the copy block of an existing
  `<acc>.review-brief.md`. If that value differs from the current inputs and no findings file newer than that brief
  exists, it refuses to overwrite: "a reviewer may be reading the brief for the old inputs; stop that reviewer, then
  delete `<brief>` and re-render". "Newer" means a findings file whose `judgmentSha256` equals the old brief's and whose
  mtime is later than the brief's. A reviewer mid-review therefore never has its brief swapped underneath it, and the
  only way past is an explicit, visible deletion.
- **No carry-forward (R-2).** The "Previous findings" JSON in a re-check brief omits `judgmentSha256` and `inputs`, and
  notes "hash fields omitted; take them from Output". A warm reviewer still holds round 1's brief, but the only hash
  values in the new brief are the current ones.

### 2.3 Check

`lib/synth/editorial.ts`:
- Add `reviewVerdict(judgmentText, review, current, { requireInputs })`, returning `{ status, changed?, hint? }`.
- Keep `reviewStatus(judgmentText, review)` as a thin wrapper with the old behaviour until the switch-over.

The order of checks:
1. No review → `missing`.
2. The judgment differs → `stale`, with `changed: ["judgment"]`.
3. `requireInputs` is set and the stamp is missing or malformed → `unstamped`.
4. The stamp is present and any component differs from `inputsUnder(stamp.scheme, …)` → `stale`, with
   `changed: [components]`.
5. Otherwise `open` or `clean`, as today.

Messages:
- judgment stale: unchanged.
- inputs stale: "the review predates the current inputs (facts changed) — rebuild with --skip-review, re-render the brief
  (it will be a full brief) and re-run the review".
- unstamped: "the findings file has no valid `inputs` (missing | mis-copied: …) — continue the same reviewer to re-copy
  it from the `Inputs fingerprint` line of prompt.md (also in the brief's Output section); if the inputs changed since
  its brief, re-render the brief and re-run the review". The orchestrator never copies or edits `inputs` on the
  reviewer's behalf; the message says so.

### 2.4 The brief's "what changed"

On a re-check, the brief compares the previous review's stamp with the current inputs.
- **A component changed, or the previous review is unstamped:** the brief is forced to the full brief, with the cold-read
  "What to read" section. A "What changed since round N" section names the components and tells the reviewer to re-read
  those blocks of `prompt.md` and of the rebuilt report.
- **Nothing changed:** today's delta brief, with the hash fields stripped as above.

Section 4 (`--date`) and the round cap follow the same rule; nothing else re-binds a review.

## 3. Migration of the 103 findings files

| Option | Effect |
|---|---|
| (i) backfill from git at each review commit | **21 stale** (the 16 drifted + 5 pre-rating per D6); 81 published clean |
| (ii) missing = stale | all 102 blocked |
| (iii) missing = clean | the hole stays open for exactly the 16 |
| (iv) compute from git at gate time | the gate depends on history; rejected |

**Decided: (i)** (D2). `scripts/backfill-review-inputs.ts` runs as a dry run by default; `--apply` writes.

**The cutoff is a constant, not an argument (R-6).** `export const BACKFILL_CUTOFF: string | null = null` lives in the
script. Task 8, the switch-over commit, sets it to that commit's parent SHA (`git rev-parse HEAD` just before committing
Task 8). Reviews made after that point go through the new brief flow and must carry the reviewer's copy.
- While the constant is `null`, the script runs a dry run against `HEAD` as a provisional cutoff and refuses `--apply`.
- No flag overrides the constant.

For each `data/judgment/*/*.editorial.json` the script:
- **skips** a file that already has a valid `inputs`. The backfill is idempotent, and that matters: after the data
  commit, the last commit touching each file is the backfill itself.
- **refuses** to run:
  - when `git status --porcelain` shows changes under `data/facts`, `data/judgment` or `data/desk`;
  - (R-6) when any unstamped file's review commit is **not an ancestor of `BACKFILL_CUTOFF`**. Such a file was reviewed
    after the new brief flow existed, and must carry the reviewer's copy.
- takes the review commit as `git log -1 --format=%h -- <findings path>`.
- loads the raw pack, judgment and `desk.json` there. It skips with a reason if any is missing, or if the judgment there
  does not hash to the findings file's `judgmentSha256` (0 such cases today).
- **reports schema-default blocks (R-4).** It lists the top-level `desk.json` keys absent at that commit and the pack keys
  absent there but present at HEAD, and flags any that falls inside a fingerprint component. None does today; `rating`
  is handled next.
- **handles the desk `rating` block (D6, owner decision, final).** When the raw historical desk has no `rating` key, the
  reviewer read the overlapping pre-02d1335 envelope and never reviewed against today's rule. No label test applies. The
  script hard-codes the owner's per-file list, and refuses on any pre-rating file not in it:
  - `PRE_RATING_SENTINEL` = BAC, CBRS, HON, KTOS and T (by ticker and accession). It stamps
    `calls = LEGACY_ENVELOPE_CALLS` (`sha256(canon({ legacyEnvelope: "pre-1ea28c5" }))`, never equal to a real hash, so
    always stale) with `source: "backfill:<commit>"`. Their prose describes the retired envelope, so they join the
    re-review queue.
  - `PRE_RATING_ACCEPT` = EWBC, INTC, JPM, ORCL and the superseded UEC 0001437749-26-019889. It stamps `calls` with the
    current hash and `source: "owner-accept:pre-rating"`, as an explicit acceptance.
  - It also asserts that no review commit descends from 1ea28c5 but not from 02d1335 (0 today).
- computes the other components with HEAD code (102 of 102 reproduce what reviewers saw) and stamps
  `source: "backfill:<commit>"`.
- **inserts textually (R-10).**
  - It finds the single line matching `^(\s*)"judgmentSha256"\s*:\s*"[0-9a-f]{64}"\s*,\s*$`. That is 102 files with
    two-space style; CRWD uses four-space indentation and `":  "`.
  - It inserts one `"inputs": {…},` line after it, with the same indentation and the file's own EOL (all 103 working
    copies are CRLF; the index is LF).
  - It asserts that the result parses, equals the original plus `inputs`, and differs from the original by exactly one
    inserted line. Reviewer escapes and layout survive.
- prints per file `clean` or `stale (<components>)`, then a summary.

**Expected dry-run result** (Task 7 acceptance; Task 9 gate):
- 103 files, 0 skipped, 0 refused.
- Owner-accepted pre-rating: 5, as `owner-accept:pre-rating`. These are EWBC INTC JPM ORCL and the superseded UEC 019889.
- **21 published stale:**
  - 16 on facts: BE CHWY DELL ESAB EVLV LITE LQDT LRCX LTRX MMM NBIX PLTR SOLS UEC VICR VSH. Here UEC is the published
    0001437749-26-031414.
  - 5 on calls (legacy sentinel): BAC CBRS HON KTOS T.
- 81 published clean.
- The schema-default report as in Section 1.2.

Any other result stops the task.

The `--apply` output is a **separate data commit** touching only the 103 findings files (D2). Run the dry run first.

## 4. Interactions

- **`--skip-review`** still bypasses the whole editorial gate and prints the reason, e.g.
  `editorial review skipped: stale (facts)`. Nothing is published behind it.
- **Stage order** stays `input check` → `exceptions` → `validate` → `editorial`. The stage-order test adds `editorial`
  after `validate`.
- **`facts:free --keep-quote`.** A re-capture that changes a shown figure stales the review (facts); one with identical
  figures does not (M6).
- **`facts:crosscheck --accept`** writes the unrendered `crosscheckOverrides`, so it does not stale a review. The Shibui
  gate still runs first.
- **`--date` republish.** The build date is not an input. A republish on corrected inputs is stale (facts), and the brief
  forces the full brief, which matches the house rule.
  - Follow-up: whether a pure re-dating (no input change) should need a re-review.
- **Round cap.** Unchanged. A re-check after an inputs change stays round 2; the reviewer copies the new values from the
  new brief.
- **`grounding:sweep`** (Task 10) adds a `stale reviews` list. "Silent surface drift" stays.
- **App, portfolio and trade: no effect.** Only `scripts/synth-*.ts`, `scripts/grounding-sweep.ts` and `lib/synth/` read
  findings files. A grep of `app/`, `lib/portfolio`, `lib/trade`, `lib/reports.ts` and `instrumentation*.ts` finds
  nothing. A stale review blocks only a rebuild; the 21 published reports stay live on their stored labels.

## 5. The 21 stale reports: re-review queue straight after the merge (D5), not part of this build

**The queue:**
- 16 on facts: BE CHWY DELL ESAB EVLV LITE LQDT LRCX LTRX MMM NBIX PLTR SOLS UEC VICR VSH.
- 5 on calls: BAC CBRS HON KTOS T. Their prose was written and reviewed against the retired envelope rule, so expect
  rating-argument findings there.

**Per report, on the dev branch:**
1. **`npm run synth:build -- <T> <ACC> --date <original report date> --skip-review` on the dev branch first.** This
   regenerates `data/<t>.json` on today's pack, so the brief preflight passes. Today the preflight refuses 9 of the 16
   without it.
2. `npm run synth:prompt -- <T> <ACC>`, so `prompt.md` matches and carries the `Inputs fingerprint` line.
3. `synth:review-brief`. This is a forced full brief that names the changed component (facts, or calls for the five).
4. A fresh reviewer, who copies `judgmentSha256` and `inputs`.
5. The gated `synth:build --date <original date>`, or the usual fix round.

The facts drift on the 16 is the three backfills, so many of those re-checks should close without a fix.

## 6. Tasks

Each task ends with `npx vitest run`, which must be green. Record files/passed/skipped in the commit body. The baseline is
137 / 2051 / 4.

### Task 0: Baseline

- `git status --short` shows exactly two untracked files: `docs/scoreconcepts/VSCodiumUserSetup-x64-1.135.06055.exe` and
  this plan, `docs/superpowers/plans/2026-10-08-review-fingerprint.md`. Commit the plan first, as
  `docs(plans): review fingerprint (S-3)`, if the owner wants it tracked.
- `git log -1` is 60976e5 (or the plan commit).
- `npx vitest run` gives 137 / 2051 / 4.

### Task 1: `lib/synth/review-inputs.ts`, the scheme-1 fingerprint, pinned

**Files:**
- `lib/synth/review-inputs.ts` (new) and `lib/synth/review-inputs.test.ts` (new);
- frozen fixtures `lib/__fixtures__/review-inputs/{AVGO,JPM,UEC}.pack.json` and `desk.json`. These are byte copies of
  the current `data/facts/...` packs and `data/desk/desk.json`, so the pins never move with a data re-capture.

**Exports:**
- `canon`: key-sorted; drops `undefined`; `-0` → `0`; finite numbers rounded to 12 significant digits.
- `factsInputs`, `contextInputs` and `callsInputs`, as in Section 1.3, with `history`.
- `type ReviewInputs`, `reviewInputs(pack, desk, facts?)`, `inputsUnder(scheme, …)` and `changedComponents`.
- `LEGACY_ENVELOPE_CALLS`, the sentinel hash. A test asserts it differs from the `calls` hash of every fixture desk.

**Tests, written first:**
- `canon` is independent of key order, maps `-0` to `0`, treats `0.1 + 0.2` the same as `0.3`, and drops `undefined`.
- One mutation per component moves only that component: TTM, a `history` close, a proxy word, `bearFloor`.
- M6 fields and `recurringTraps` move nothing.
- **Pins:** literal facts, calls and context hashes for each of the three fixtures, with the header comment from
  Section 1.3 ("what to do when a pin fails").

**Run:** `npx vitest run lib/synth/review-inputs.test.ts`, then `npx vitest run`.

**Commit:** `feat(synth): the review inputs fingerprint (scheme 1), pinned on frozen fixtures (S-3)`

### Task 2: Completeness property test

**File:** `lib/synth/review-inputs.test.ts`.

**(a) Present-value mutations.** For the three fixtures, mutate every pack leaf, with `history` beyond its first 3 points
skipped:
- numbers ×1.37 + 0.11, and 0 → 1.5;
- strings + " Zq", or a date → `2001-02-03`;
- booleans negated, and `null` → 7.25.

Assert: if the `renderFactsBlock` output moved, `facts` moved; if the `renderContextBlock` output moved, `context` moved.
For every `desk.rating` leaf: if `renderCalls` moved, `calls` moved.

**(b) Absent→present mutations (R-10).** Build a **maximal synthetic pack** from the AVGO fixture: every optional or
nullable field the schema allows is populated. That includes:
- all six context excerpts, with `truncated: true`, plus headlines;
- `sharesSource`, `revenueYoY`, `operatingMargin`, and every nullable TTM ratio and estimate;
- non-empty segments and geography;
- every highlight key.

Build a **minimal** twin with each such field null, absent or empty. For each field, set it absent→present on the minimal
pack. If the rendered block moved, the component must move.

**Failure message:** "renderer reads a field the fingerprint does not cover: add it under a new scheme (see
review-inputs.ts header)". The probe found 0 gaps on 1,909 leaves.

**Commit:** `test(synth): the inputs fingerprint covers every field the renderers read, present or absent`

### Task 3: Schema

**Files:** `lib/synth/editorial.schema.ts`, `lib/synth/editorial.schema.test.ts`.

- Add `ReviewInputsStamp`.
- `EditorialReviewShape` (reviewer-facing JSON Schema) declares `inputs` as required.
- The parse schema `EditorialReview` widens `inputs` to `z.unknown().optional()`.
- Add `readInputsStamp`.

**Tests:**
- A file with no `inputs` parses, and `readInputsStamp` gives `missing`.
- A bad hash, `scheme: 2`, an extra key or a bad `source` parse as a file but give `malformed`, with the zod message.
- A good stamp, with or without `source`, gives `stamp`.
- The JSON Schema lists `inputs` under `required`.

**Commit:** `feat(synth): findings files carry the inputs the reviewer read; a missing or malformed copy is readable, not fatal`

### Task 4: `reviewVerdict` and messages (old `reviewStatus` intact)

**Files:** `lib/synth/editorial.ts`, `lib/synth/editorial.test.ts`.

**Tests:**
- Precedence is judgment → unstamped (missing / malformed) → inputs → open/clean.
- `requireInputs: false` treats an unstamped review as today's status.
- `changed` names the components.
- The `unstamped` message distinguishes missing from mis-copied, says "continue the same reviewer to re-copy", and never
  tells the orchestrator to copy or edit `inputs`.
- The all-components-differ hint appears only when the caller passes the git-side recomputation.
- The existing `reviewStatus` tests are unchanged.

**Commit:** `feat(synth): reviewVerdict — say whether the judgment or the inputs moved, and which`

### Task 5: `prompt.md` inputs line; `synth:review-brief` copy block, stripped history, preflight, no silent re-render, what-changed

**Files:**
- `lib/synth/prompt.ts` and `lib/synth/prompt.test.ts`. `renderPrompt` takes `inputs` and renders the
  `# Inputs fingerprint` section before `# Output`; `scripts/synth-prompt.ts` passes `reviewInputs(pack, desk)`.
- `lib/synth/review-brief.ts`, `lib/synth/review-brief.test.ts` and `scripts/synth-review-brief.ts`.

**Changes:**
- `renderReviewBrief` takes `inputs: ReviewInputs` and `inputsChanged?: Component[] | "unstamped"`.
- The Output section opens with "Copy these two values exactly", holding the two JSON lines. It tells the reviewer to copy
  `inputs` from the `Inputs fingerprint` line of `prompt.md`, and to stop and report if the two differ.
- Add a pure `briefOverwriteGuard({ existingBriefText, currentInputs, findings, briefMtime, findingsMtime })`, the N-3
  rule of Section 2.2. The script applies it before writing.
- The previous-findings JSON omits `judgmentSha256` and `inputs`.
- A non-empty `inputsChanged` forces the full brief and adds "What changed since round N".
- Add a pure `briefPreflight({ promptText, report, facts, pack, desk, accession })`, which runs the two checks of
  Section 2.2. Comparison helpers are shared with the probe's `reportMismatch` shape.

**Tests:**
- `renderPrompt` prints the `Inputs fingerprint` line equal to `reviewInputs`, outside the Facts, Calls and Context
  blocks. `groundingSurface` and the existing prompt pins are unchanged, apart from the new section.
- The copy block carries both values, next to each other, and names the `prompt.md` line.
- The overwrite guard:
  - refuses when the existing brief's inputs differ and no newer findings file for its judgment exists;
  - allows when the inputs are equal, or when a newer findings file exists, or when no brief exists.
- The previous findings contain neither hash key.
- `inputsChanged: ["facts"]` renders the full brief and the changed section.
- `inputsChanged: []` renders today's delta brief except for the copy block and the stripped keys; pin it.
- Preflight passes on a fresh prompt and report.
- Preflight refuses on:
  - one changed Facts line in the prompt, or a stale `Inputs fingerprint` line (message names `synth:prompt`);
  - a report with an old multiples row, a changed `history` close, or another accession (message names
    `synth:build --skip-review`).

**Commit:** `feat(synth): the prompt and the review brief carry the inputs to copy; the brief checks freshness, never swaps under a reviewer, and says what changed`

### Task 6: The `desk.rating` re-key path (R-7, hardened per N-2)

**Files:** `lib/synth/review-rekey.ts`, `lib/synth/review-rekey.test.ts`, `scripts/rekey-review-calls.ts`.

`rekeyCalls({ stamp, judgment, pack, facts, desk, oldRating, newRating, rekeySha })` checks, in order:
1. If the stamp's `calls` does not equal `hash(oldRating)`, it returns "not this change" and leaves the stamp alone. The
   stamp's facts and context must also equal the current values; otherwise the review is already stale for other reasons
   and is left alone.
2. It restamps `calls` (new hash, `source: "rekey:<sha>"`) **only if both** of these hold:
   - **the derived label is unchanged**: `deriveLabel(computeConviction(scenarios, price), oldRating)` equals the same
     under `newRating`;
   - **the judgment passes validate under the new rule.** `ratingIssues(judgment, price, newRating)` is empty: the
     published label is the derived one or one notch more conservative, and the Bear clears the new bear floor. Also,
     `groundJudgment(judgment, groundingSurface(judgment, facts, pack, { ...desk, rating: newRating }))` reports no error
     on a figure that grounded on the old Calls block. Any Calls threshold the prose quotes must still be on the new Calls
     block.
3. Otherwise it returns `reReview`, with the failing reason (label `<old>→<new>`, a rating issue, or the quoted Calls
   figure).

There is no legacy-envelope mode. The pre-rating reviews are an owner decision (D6), handled in the backfill.

The script `node --import tsx scripts/rekey-review-calls.ts --from <old desk commit> --to <new desk commit> [--apply]`
runs as a dry run by default. It inserts textually like the backfill. It is run as an approved data commit alongside
every `desk.rating` change (D1), with the `reReview` list in its message. Those reports join the re-review queue.

**Tests:**
- Equal labels and no rating issue → restamp with the `rekey` source.
- A label that flips at a threshold → `reReview`.
- **A raised bear floor does not blanket-restamp.** On the AVGO, JPM and UEC fixtures plus a synthetic judgment whose
  Bear sits between the old and new floors, `bearFloor +0.05` leaves the derived label unchanged, but that judgment is
  `reReview` (rating issue: bear floor). Measured on the corpus: the same change fails validate for 23 of 102 published
  judgments, and the label-only rule would have restamped all 23.
- A judgment quoting a Calls threshold that the new rule changes → `reReview` (grounding).
- A stamp from another rule, or with stale facts → untouched.

**Commit:** `feat(synth): re-key review stamps across a desk.rating change only where the label holds and validate passes`

### Task 7: Backfill script (code only)

**Files:** `lib/synth/review-backfill.ts` (pure `planBackfill` with injected git readers), its test, and
`scripts/backfill-review-inputs.ts`.

**Usage:** `node --import tsx scripts/backfill-review-inputs.ts [--apply] [TICKER ...]`. There is no cutoff argument:
the cutoff is the `BACKFILL_CUTOFF` constant, `null` in this task.

**Tests, with fake git readers:**
- an already-stamped file is skipped;
- a judgment mismatch at the commit is skipped;
- a missing pack is skipped;
- **cutoff (R-6):**
  - with `BACKFILL_CUTOFF = null`, `--apply` is refused and the dry run uses `HEAD`;
  - with a cutoff set, a file whose review commit is not an ancestor of it is refused, and that refusal fails the run;
  - no argument can change the cutoff (argv with `--cutoff x` is rejected as unknown);
- a dirty tree is refused;
- a schema-default report lists absent desk and pack keys and flags one inside a component;
- D6:
  - a pre-rating file in `PRE_RATING_SENTINEL` gets `LEGACY_ENVELOPE_CALLS`;
  - one in `PRE_RATING_ACCEPT` gets the current `calls` with `owner-accept:pre-rating`;
  - a pre-rating file in neither list is refused;
- the textual insert preserves two-space and four-space layouts and CRLF, and adds exactly one line;
- `source` is `backfill:<commit>` except on the accepted five.

**Manual check:** `node --import tsx scripts/backfill-review-inputs.ts` (a dry run, provisional cutoff `HEAD`) prints the
Section 3 expected result. Paste the output into the commit body.

**Commit:** `feat(scripts): backfill-review-inputs — stamp existing reviews from git at their review commit (dry run by default)`

### Task 8: Switch-over in `synth:build`, and the cutoff constant (one commit)

**Files:**
- `scripts/synth-build.ts`;
- the stage-order test in `lib/synth/grounding-exceptions.test.ts`;
- `scripts/backfill-review-inputs.ts` (the constant only) and its test.

**Changes:**
- Compute `reviewInputs` once.
- Call `reviewVerdict(..., { requireInputs: true })`, and pass `changed` and `hint` into the message.
- The `--skip-review` warning carries the reason.
- Set `BACKFILL_CUTOFF` to the commit this task is built on (`git rev-parse HEAD` before committing). Add a test that
  pins the constant to a 40-hex SHA that is an ancestor of `HEAD`. That keeps it non-null, so `--apply` is enabled only
  from this commit on.

From this commit until Task 9 lands, every gated rebuild on the branch reports `unstamped`. No build is run on the branch
in that window, and the branch is not merged or pushed until Task 9 is in.

**Commit:** `feat(synth): the editorial gate checks the inputs the reviewer read; fix the backfill cutoff (S-3)`

### Task 9: The backfill data commit (approved, D2), then the worktree checks

1. Run the dry run, `node --import tsx scripts/backfill-review-inputs.ts`, and confirm Section 3 exactly: 103 files, 0
   skipped, 0 refused, 5 owner-accepted, **21 stale**, 81 published clean.
2. Run it with `--apply`.
3. `git diff --stat` must show exactly the 103 findings files, each with +1 line.
4. Re-run the dry run: all 103 are skipped as stamped.
5. `npx vitest run`.

**Commit:** `chore(data): stamp review inputs from git (S-3 backfill)`. The message lists the 21 stale (16 facts, 5
calls) and the 5 owner-accepted.

**Manual check, in a scratch worktree only (R-5):**

```bash
git worktree add "<scratch>/wt-s3" HEAD
cd "<scratch>/wt-s3" && npm ci --prefer-offline   # or symlink node_modules
npm run synth:build -- NVDA <acc> --date <report date>   # builds; no change to data/nvda.json
npm run synth:build -- NBIX <acc>                         # stops at editorial: stale (facts)
npm run synth:build -- BAC <acc>                          # stops at editorial: stale (calls)
cd - && git worktree remove --force "<scratch>/wt-s3"
```

The main checkout's `data/` is never written.

**Immediately before the merge (R-6):** merge `main` into the branch and re-run the dry run. Every file must be skipped
as stamped. If `main` gained an unstamped review, the script refuses it: its review commit is not an ancestor of the
fixed cutoff. Resolve it before merging, either by re-reviewing it through the new brief or by rebasing Tasks 8–9 onto
the new `main` (which re-sets the constant in Task 8) and re-running Task 9. The cutoff is never edited on its own.

### Task 10: `grounding:sweep` reports stale reviews

- Each published report gets `review` = clean | open | stale (components) | unstamped | missing.
- The summary and `--json` gain `staleReviews`.
- **Manual check:** after Task 9 it lists exactly the 21 (16 stale on facts, 5 on calls).

**Commit:** `feat(scripts): grounding:sweep lists reports whose review no longer matches their inputs`

### Task 11: Docs

**Files:** `.claude/skills/synthesize/SKILL.md` step 5, and `README.md`.

Document:
- the reviewer copies `judgmentSha256` and `inputs`, taking `inputs` from the `Inputs fingerprint` line of `prompt.md`;
- the brief refuses until `prompt.md` and `data/<t>.json` are fresh, and never overwrites a brief a reviewer may be
  reading;
- the `stale (facts | calls | context)` and `unstamped` messages. On `unstamped`, continue the same reviewer to re-copy;
  the orchestrator never edits `inputs`;
- the forced full brief;
- `rekey-review-calls` alongside every `desk.rating` change.

**Commit:** `docs(synth): binding a review to its inputs`

**Total: 11 tasks**, plus Task 0. Before the merge: `npx vitest run`, `npm run lint`, the Task 9 pre-merge dry run, and a
final review of the branch diff.

## 7. Owner decisions (final)

- **D1. Fingerprint `desk.rating` (calls): yes.** A threshold change stales every review whose stamp carries the old
  rating. Each `desk.rating` change ships with an approved `rekey-review-calls` data commit (Task 6). That commit
  restamps `calls` (`rekey:<sha>`) only where the derived label is unchanged **and** the judgment passes validate's rating
  and Calls-grounding checks under the new rule; every other report goes to re-review.
- **D2. The backfill data commit is approved,** as a separate commit made dry-run first (Task 9): 103 files, +1 line
  each, 21 stale.
- **D3. Review-commit anchor.** 16 reports are stale on facts, NBIX included.
- **D4. Reviewer-copy.** The value is copied from the `Inputs fingerprint` line of `prompt.md`; there is no stamp tool.
- **D5. Re-review queue straight after the merge.** The 21 in Section 5: BE CHWY DELL ESAB EVLV LITE LQDT LRCX LTRX MMM
  NBIX PLTR SOLS UEC VICR VSH, plus BAC CBRS HON KTOS T.
- **D6. The 10 pre-rating reviews.**
  - **Legacy stale sentinel, re-reviewed:** BAC, CBRS, HON, KTOS, T. Their prose describes the retired envelope.
  - **Owner-accepted under today's rule** (`source: "owner-accept:pre-rating"`): EWBC, INTC, JPM, ORCL and the superseded
    UEC 0001437749-26-019889.

  These reviews never covered today's rule. The acceptance is the owner's explicit call, not a derived equivalence.

**Final stale list after the backfill: 21 published.** BE BAC CBRS CHWY DELL ESAB EVLV HON KTOS LITE LQDT LRCX LTRX MMM
NBIX PLTR SOLS T UEC VICR VSH.

## 8. Risks and non-goals

- **No `data/` edits** except the approved Task 9 backfill, and a Task 6 re-key alongside a future `desk.rating` change.
  No changes to `data/trade`, tokens, `.env*` or `BANNED_TICKERS`. Builds run only in a scratch worktree.
- **The window between Task 8 and Task 9.** Every gated rebuild on the branch is `unstamped` in that window. No build is
  run then, and nothing merges until Task 9 lands.
- **Owner-accepted pre-rating reviews.** The five accepted reviews were never reviewed against today's rating rule. This
  is accepted explicitly, recorded in `source`, and visible to any audit.
- **The backfill anchor.** Working-tree changes made between the review and its commit are invisible; this is accepted.
  The reviewer confirmed each final judgment state sits in one commit. Going forward, the brief's preflight and the
  reviewer's copy close the gap.
- **Reviewer mis-copy** reads as stale. It is fail-closed and mitigated by the messages in Section 2.2.
- **Over-sensitivity** (M2): 0 occurrences in the corpus.
- **Projection-code changes** that move values stale reviews by design; the Task 1 pins make each one a visible decision.
- **Non-goals:**
  - S-5 (the draft marker on `data/<t>.json`);
  - grounding exceptions on the inputs fingerprint;
  - the gate, decision and scorecard blocks (DOW F-5);
  - the `--date` re-dating question;
  - re-reviewing the 21 (D5, straight after the merge).

---

## Appendix: probe sources (re-runnable)

Probe directory:
`C:\Users\nicopc\AppData\Local\Temp\claude\C--Users-nicopc-Documents-juniresearch\63a937f0-f812-4b73-91d1-14b72f7bdb18\scratchpad\s3\`.
The adversarial reviewer's extra probes (`probe-anchor.ts`, `probe-excluded.ts`) are in `..\s3review\`.

Run every probe from the repo root, for example
`cd C:/Users/nicopc/Documents/juniresearch && FP_ROUND=1 npx tsx "<scratch>/s3/probe-corpus.ts"`.
`FP_ROUND=1` applies the 12-digit rounding the plan specifies, and `fp-lib.ts` includes `history` in facts (revision 2).

| Probe | What it produces |
|---|---|
| `probe-corpus.ts` | Section 1.2 "Stale today" |
| `probe-what-changed.ts` | the changed facts keys per drifted report |
| `probe-sim.ts` | R1–R4, M1–M7, desk edits |
| `probe-completeness.ts` | 0 gaps on 1,909 leaves |
| `probe-projection-drift.ts` | 102/102 reproduce |
| `probe-uec-old.ts` | the superseded UEC file's facts, calls and context are clean (before the D6 treatment) |
| `probe-prerating.ts` | R-4 schema-default blocks; the 10 pre-rating reviews under today's rule (no old-rule label: N-1); the N-2 bear-floor count (23) |
| `probe-report-match.ts` | R-3: the 9 reports whose `data/<t>.json` lags their pack |

`old-prompt-61102f1p.ts` (for R1) is generated by:

```bash
git show 61102f1^:lib/synth/prompt.ts | sed -E 's#from "\.\./([^"]+)"#from "file:///C:/Users/nicopc/Documents/juniresearch/lib/\1.ts"#; s#from "\./([^"]+)"#from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/\1.ts"#' > "<scratch>/s3/old-prompt-61102f1p.ts"
```

### fp-lib.ts

```ts
// fp-lib.ts — candidate fingerprints for S-3, computed with HEAD code. Throwaway probe, not repo code.
// Run every probe with cwd = the repo root (git + data paths are relative).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/facts/schema.ts";
import { projectReportFacts } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/facts/project.ts";
import { Desk } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/desk.schema.ts";
import { Judgment } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/judgment.schema.ts";
import { groundingSurface } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment.ts";
import { buildGroundingIndex, type GroundingSurface } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding.ts";
import { surfaceSha256 } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding-exceptions.ts";
import { judgmentSha256 } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/editorial.ts";

export const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });

/** Key-sorted JSON; undefined dropped; -0 → 0. */
export function canon(v: unknown): string {
  // FP_ROUND=1 rounds finite numbers to 12 significant digits (the plan's float-noise guard)
  if (typeof v === "number" && process.env.FP_ROUND && Number.isFinite(v)) v = Number(v.toPrecision(12));
  if (v === null || typeof v !== "object") return typeof v === "number" && Object.is(v, -0) ? "0" : JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canon(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}

type Pack = ReturnType<typeof FactPack.parse>;
type Facts = ReturnType<typeof projectReportFacts>;
type DeskT = ReturnType<typeof Desk.parse>;

/** Option (b): exactly the data renderFactsBlock / renderContextBlock / renderCalls read (prompt.ts at 60976e5). */
export function factsInputs(facts: Facts, pack: Pack) {
  const bm = facts.sections.businessMoat, a = facts.analystSentiment, e = pack.estimates, t = pack.ttm, lq = pack.latestQuarter, q = pack.quote;
  return {
    snapshot: facts.snapshot,
    tables: [facts.sections.financials.income, facts.sections.financials.balance, facts.sections.financials.cashflow],
    estimates: { nextFY: { label: e.nextFY.label, revenue: e.nextFY.revenue, eps: e.nextFY.eps }, followingFY: { label: e.followingFY.label, revenue: e.followingFY.revenue, eps: e.followingFY.eps } },
    ttm: { grossMargin: t.grossMargin, operatingMargin: t.operatingMargin, netMargin: t.netMargin, netDebtToEbitda: t.netDebtToEbitda, interestCoverage: t.interestCoverage, fcfYield: t.fcfYield, currentRatio: t.currentRatio },
    latestQuarter: { label: lq.label, periodEnd: lq.periodEnd, revenue: lq.revenue, operatingMargin: lq.operatingMargin, revenueYoY: lq.revenueYoY },
    multiples: facts.sections.valuation.multiplesCompanyColumn.map((m) => ({ label: m.label, value: m.value })),
    analysts: { numAnalysts: a.numAnalysts, buy: a.buy, hold: a.hold, sell: a.sell, consensusRating: a.consensusRating, consensusTarget: a.consensusTarget, medianTarget: a.medianTarget, lowTarget: a.lowTarget, highTarget: a.highTarget },
    segments: { basis: bm.segmentsBasis, items: bm.segments.map((s) => ({ name: s.name, sharePct: s.sharePct, revenue: s.revenue })) },
    geography: { basis: bm.geographyBasis, items: bm.geoMix.map((g) => ({ region: g.region, sharePct: g.sharePct })) },
    quote: { price: q.price, asOf: q.asOf, week52Low: q.week52Low, week52High: q.week52High, marketCap: q.marketCap, sharesOutstanding: q.sharesOutstanding, sharesSource: q.sharesSource, dividendYield: q.dividendYield },
    highlightCells: facts.highlightCells,
    // R-9: the closes the report's price chart shows the reviewer (facts.quote.history = pack.history date/close)
    history: facts.quote.history,
  };
}
export function contextInputs(pack: Pack) {
  const c = pack.context;
  const ex = (x: { text: string; source: string; asOf: string; truncated?: boolean } | null) => (x ? { text: x.text, source: x.source, asOf: x.asOf, truncated: !!x.truncated } : null);
  return {
    description: ex(c.description), mda: ex(c.mdaExcerpt), risk: ex(c.riskFactorsExcerpt), pressRelease: ex(c.pressRelease),
    proxy: ex(c.proxyStatement), transcript: ex(c.transcriptHighlights), headlines: c.headlines.map((h) => ({ asOf: h.asOf, source: h.source, text: h.text })),
  };
}
export const callsInputs = (desk: DeskT) => desk.rating;

export interface Snapshot { pack: Pack; judgment: ReturnType<typeof Judgment.parse>; judgmentText: string; desk: DeskT; packText: string }

export function load(texts: { pack: string; judgment: string; desk: string }): Snapshot {
  return { pack: FactPack.parse(JSON.parse(texts.pack)), judgment: Judgment.parse(JSON.parse(texts.judgment)), judgmentText: texts.judgment, desk: Desk.parse(JSON.parse(texts.desk)), packText: texts.pack };
}

/** Option (c): the typed-entry multiset the grounding index sees (facts, calls, context; judgment excluded). */
export function multisetHash(surface: GroundingSurface, sources = ["facts", "calls", "context"]): string {
  const idx = buildGroundingIndex(surface);
  const keys = idx.entries.filter((e) => sources.includes(e.source)).map((e) => `${e.source}|${e.kind}|${e.currency ?? ""}|${e.sign}|${e.abs}|${e.precision}`).sort();
  return sha(keys.join("\n"));
}

export function fingerprints(s: Snapshot, surfaceOverride?: (g: GroundingSurface) => GroundingSurface) {
  const facts = projectReportFacts(s.pack);
  let surface = groundingSurface(s.judgment, facts, s.pack, s.desk);
  if (surfaceOverride) surface = surfaceOverride(surface);
  return {
    a: surfaceSha256(surface),
    aFacts: sha(surface.factsBlock), aCalls: sha(surface.callsBlock), aContext: sha(surface.contextBlock), aJudgment: sha(surface.judgmentBlock),
    bFacts: sha(canon(factsInputs(facts, s.pack))), bCalls: sha(canon(callsInputs(s.desk))), bContext: sha(canon(contextInputs(s.pack))),
    c: multisetHash(surface),
    history: sha(canon(s.pack.history)),
    judgment: judgmentSha256(s.judgmentText),
    packFile: sha(s.packText.replace(/\r\n/g, "\n")),
  };
}
export const bAll = (f: ReturnType<typeof fingerprints>) => sha(`${f.bFacts}|${f.bCalls}|${f.bContext}`);

export interface Pub { ticker: string; accession: string }
export function published(): Pub[] {
  const out: Pub[] = [];
  for (const t of readdirSync(join("data", "judgment")).sort()) {
    const report = join("data", `${t.toLowerCase()}.json`);
    if (!existsSync(report)) continue;
    const acc = JSON.parse(readFileSync(report, "utf8")).meta?.filing?.accession as string;
    out.push({ ticker: t, accession: acc });
  }
  return out;
}
export const headTexts = (p: Pub) => ({
  pack: readFileSync(join("data", "facts", p.ticker, `${p.accession}.json`), "utf8"),
  judgment: readFileSync(join("data", "judgment", p.ticker, `${p.accession}.json`), "utf8"),
  desk: readFileSync(join("data", "desk", "desk.json"), "utf8"),
});
export const atTexts = (p: Pub, commit: string) => ({
  pack: git("show", `${commit}:data/facts/${p.ticker}/${p.accession}.json`),
  judgment: git("show", `${commit}:data/judgment/${p.ticker}/${p.accession}.json`),
  desk: git("show", `${commit}:data/desk/desk.json`),
});
```

### probe-corpus.ts

```ts
// probe-corpus.ts — which published reviews would be stale today under each option, anchored at the review commit
// (last commit touching the findings file) and at the report commit (last commit touching data/<t>.json, the sweep's anchor).
// Run: cd <repo> && npx tsx <scratch>/s3/probe-corpus.ts [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { published, headTexts, atTexts, load, fingerprints, bAll, git } from "./fp-lib";

const SILENT = "BE CHWY DELL ESAB EVLV LITE LQDT LRCX LTRX MMM PLTR SOLS UEC VICR VSH".split(" ");
const rows: Record<string, unknown>[] = [];
const opts = ["a", "bAll", "bFacts", "bCalls", "bContext", "c", "aFacts", "aCalls", "aContext", "history", "packFile"] as const;
const staleBy: Record<string, Record<string, string[]>> = { review: {}, report: {} };
for (const o of opts) { staleBy.review[o] = []; staleBy.report[o] = []; }
const notes: string[] = [];

for (const p of published()) {
  const edPath = `data/judgment/${p.ticker}/${p.accession}.editorial.json`;
  const ed = JSON.parse(readFileSync(edPath, "utf8"));
  const head = fingerprints(load(headTexts(p)));
  const cReview = git("log", "-1", "--format=%h", "--", edPath).trim();
  const cReport = git("log", "-1", "--format=%h", "--", `data/${p.ticker.toLowerCase()}.json`).trim();
  const isAnc = (a: string, b: string) => { try { git("merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
  const row: Record<string, unknown> = { ticker: p.ticker, accession: p.accession, cReview, cReport, reportBeforeReview: cReport !== cReview && isAnc(cReport, cReview),
    gateToday: ed.judgmentSha256 === head.judgment ? "judgment-ok" : "judgment-STALE" };
  for (const [anchor, commit] of [["review", cReview], ["report", cReport]] as const) {
    let snap;
    try { snap = fingerprints(load(atTexts(p, commit))); } catch (e) { notes.push(`${p.ticker} @${anchor} ${commit}: ${(e as Error).message.split("\n")[0]}`); continue; }
    const cmp: Record<string, boolean> = {};
    for (const o of opts) {
      const a = o === "bAll" ? bAll(snap) : (snap as Record<string, string>)[o];
      const h = o === "bAll" ? bAll(head) : (head as Record<string, string>)[o];
      cmp[o] = a !== h;
      if (a !== h) staleBy[anchor][o].push(p.ticker);
    }
    row[anchor] = cmp;
    if (anchor === "review") row.reviewJudgmentMatchesFile = ed.judgmentSha256 === snap.judgment;
  }
  rows.push(row);
}

const fmt = (xs: string[]) => `${xs.length}: ${xs.join(" ")}`;
console.log(`published reports: ${rows.length}`);
console.log(`gate today (judgment hash): ${rows.filter((r) => r.gateToday !== "judgment-ok").map((r) => r.ticker).join(" ") || "all match"}`);
console.log(`review-commit judgment == findings judgmentSha256: ${rows.filter((r) => r.reviewJudgmentMatchesFile === false).map((r) => r.ticker).join(" ") || "all match"}`);
console.log(`report commit strictly before review commit: ${rows.filter((r) => r.reportBeforeReview).length}`);
for (const anchor of ["review", "report"]) {
  console.log(`\n== anchor: ${anchor} commit`);
  for (const o of opts) console.log(`  ${o.padEnd(9)} stale ${fmt(staleBy[anchor][o])}`);
  const bset = new Set(staleBy[anchor].bAll);
  console.log(`  silent-drift list vs bAll: missing ${SILENT.filter((t) => !bset.has(t)).join(" ") || "none"}; extra ${[...bset].filter((t) => !SILENT.includes(t)).join(" ") || "none"}`);
}
for (const n of notes) console.log(`note: ${n}`);
const out = process.argv.indexOf("--json");
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ rows, staleBy }, null, 1));
```

### probe-what-changed.ts

```ts
// probe-what-changed.ts — for each drifted report, which factsInputs sub-keys differ (review commit vs HEAD), plus the
// commits that touched the pack after the review commit. Run: cd <repo> && npx tsx <scratch>/s3/probe-what-changed.ts
import { readFileSync } from "node:fs";
import { projectReportFacts } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/facts/project.ts";
import { published, headTexts, atTexts, load, factsInputs, canon, git } from "./fp-lib";

const want = process.argv.slice(2);
for (const p of published()) {
  if (want.length && !want.includes(p.ticker)) continue;
  const edPath = `data/judgment/${p.ticker}/${p.accession}.editorial.json`;
  const cReview = git("log", "-1", "--format=%h", "--", edPath).trim();
  const head = load(headTexts(p)), then = load(atTexts(p, cReview));
  const fh = factsInputs(projectReportFacts(head.pack), head.pack) as Record<string, unknown>;
  const ft = factsInputs(projectReportFacts(then.pack), then.pack) as Record<string, unknown>;
  const changed = Object.keys(fh).filter((k) => canon(fh[k]) !== canon(ft[k]));
  if (!changed.length) continue;
  const detail: string[] = [];
  for (const k of changed) {
    if (k === "tables") {
      const th = fh.tables as { rows: { label: string; values: unknown[] }[] }[], tt = ft.tables as typeof th;
      for (let i = 0; i < th.length; i++) for (const r of th[i].rows) {
        const o = tt[i].rows.find((x) => x.label === r.label);
        if (!o || canon(o.values) !== canon(r.values)) detail.push(`tables[${i}].${r.label}: ${o ? canon(o.values) : "(absent)"} → ${canon(r.values)}`);
      }
    } else if (k === "snapshot" || k === "highlightCells") {
      const a = canon(ft[k]), b = canon(fh[k]);
      detail.push(`${k}: …${a.length} → ${b.length} chars`);
    } else detail.push(`${k}: ${canon(ft[k]).slice(0, 160)} → ${canon(fh[k]).slice(0, 160)}`);
  }
  const touches = git("log", "--format=%h %ad %s", "--date=short", `${cReview}..HEAD`, "--", `data/facts/${p.ticker}/${p.accession}.json`).trim().split("\n").filter(Boolean);
  const cReport = git("log", "-1", "--format=%h", "--", `data/${p.ticker.toLowerCase()}.json`).trim();
  console.log(`${p.ticker} review@${cReview} report@${cReport}: changed ${changed.join(", ")}`);
  for (const d of detail.slice(0, 8)) console.log(`   ${d}`);
  if (detail.length > 8) console.log(`   … ${detail.length - 8} more`);
  for (const t of touches) console.log(`   pack commit after review: ${t}`);
}
```

### probe-sim.ts

```ts
// probe-sim.ts — (1) renderer wording changes: how many of the 102 published fingerprints move under each option;
// (2) single-report mutations: which options flag them, and that only that report is flagged.
// Run: cd <repo> && npx tsx <scratch>/s3/probe-sim.ts
import { renderCalls as oldRenderCalls } from "./old-prompt-61102f1p";
import { published, headTexts, load, fingerprints, bAll, type Snapshot } from "./fp-lib";
import type { GroundingSurface } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding.ts";

const pubs = published();
const snaps = new Map(pubs.map((p) => [p.ticker, load(headTexts(p))] as const));
const base = new Map([...snaps].map(([t, s]) => [t, fingerprints(s)] as const));

type Fp = ReturnType<typeof fingerprints>;
const OPTS: Record<string, (f: Fp) => string> = { a: (f) => f.a, b: bAll, c: (f) => f.c, "d(a-components)": (f) => `${f.aFacts}|${f.aCalls}|${f.aContext}` };
const count = (fps: Map<string, Fp>) => Object.fromEntries(Object.entries(OPTS).map(([k, fn]) => [k, pubs.filter((p) => fn(fps.get(p.ticker)!) !== fn(base.get(p.ticker)!)).length]));

// ---- (1) renderer changes, applied as surface overrides on unchanged data
const renderers: Record<string, (s: Snapshot) => (g: GroundingSurface) => GroundingSurface> = {
  "R1 real 61102f1 renderCalls wording (no digits)": (s) => (g) => ({ ...g, callsBlock: oldRenderCalls(s.desk.rating) }),
  "R2 synthetic heading wording, no digits": () => (g) => ({ ...g, factsBlock: g.factsBlock.replace("### Street view", "### Street consensus"), contextBlock: g.contextBlock.replace(/\(not captured\)/g, "(none captured)") }),
  "R3a synthetic heading wording with a period-unit digit (allow-listed)": () => (g) => ({ ...g, factsBlock: g.factsBlock.replace("### Trailing twelve months", "### Trailing 12 months") }),
  "R3b synthetic heading wording with a plain digit": () => (g) => ({ ...g, factsBlock: g.factsBlock.replace("### Street view", "### Street view (3 sources)") }),
  "R4 synthetic display precision (Facts TTM line 1dp→2dp)": () => (g) => ({ ...g, factsBlock: g.factsBlock.replace(/^- Gross margin.*$/m, (l) => l.replace(/(\d+\.\d)%/g, "$10%")) }),
};
console.log(`== renderer changes on unchanged data (reports whose fingerprint moves, of ${pubs.length}); b is computed from data, never from rendered text`);
for (const [name, mk] of Object.entries(renderers)) {
  const fps = new Map([...snaps].map(([t, s]) => [t, fingerprints(s, mk(s))] as const));
  console.log(`  ${name}: ${JSON.stringify(count(fps))}`);
}

// ---- (2) mutations on one report
const T = "NVDA";
const mutate = (fn: (s: Snapshot) => void) => {
  const s0 = snaps.get(T)!;
  const s = { ...s0, pack: structuredClone(s0.pack) } as Snapshot; fn(s);
  const fps = new Map(base); fps.set(T, fingerprints(s));
  const flagged = Object.fromEntries(Object.entries(OPTS).map(([k, fn2]) => [k, pubs.filter((p) => fn2(fps.get(p.ticker)!) !== fn2(base.get(p.ticker)!)).map((p) => p.ticker).join(",") || "-"]));
  return flagged;
};
const balRow = (s: Snapshot, key: string) => s.pack.statements.balance.find((r) => r.key === key);
const mutations: Record<string, (s: Snapshot) => void> = {
  "M1 visible value change (TTM net margin +1pp)": (s) => { s.pack.ttm.netMargin = (s.pack.ttm.netMargin ?? 0) + 0.01; },
  "M2 sub-display value change (TTM net margin +1e-6)": (s) => { s.pack.ttm.netMargin = (s.pack.ttm.netMargin ?? 0) + 1e-6; },
  "M3 swap two balance rows' values (cash <-> totalDebt)": (s) => {
    const keys = s.pack.statements.balance.map((r) => r.key);
    const a = balRow(s, keys.includes("cash") ? "cash" : keys[0])!, b = balRow(s, keys.includes("totalDebt") ? "totalDebt" : keys[1])!;
    [a.values, b.values] = [b.values, a.values];
  },
  "M3b swap next-FY and following-FY EPS": (s) => { const e = s.pack.estimates; [e.nextFY.eps, e.followingFY.eps] = [e.followingFY.eps, e.nextFY.eps]; },
  "M3c swap 52-week low and high": (s) => { const q = s.pack.quote; [q.week52Low, q.week52High] = [q.week52High, q.week52Low]; },
  "M4 one word in the proxy excerpt (no digit)": (s) => { const p = s.pack.context.proxyStatement; if (p) p.text = p.text.replace(/\bthe\b/, "a"); },
  "M5 context excerpt re-dated (asOf)": (s) => { const p = s.pack.context.mdaExcerpt; if (p) p.asOf = "2020-01-01"; },
  "M6 unrendered pack fields only (capturedAt, provenance, shibuiCheck, beta, sbc)": (s) => {
    s.pack.capturedAt = "2030-01-01T00:00:00Z"; s.pack.provenance = []; delete (s.pack as Record<string, unknown>).shibuiCheck; delete (s.pack as Record<string, unknown>).beta; delete (s.pack as Record<string, unknown>).sbc;
  },
  "M7 consensus target +$1": (s) => { s.pack.analysts.consensusTarget = (s.pack.analysts.consensusTarget ?? 0) + 1; },
};
console.log(`\n== mutations on ${T} only (tickers flagged per option)`);
console.log(`  balance keys: ${snaps.get(T)!.pack.statements.balance.map((r) => r.key).join(",")}`);
for (const [name, fn] of Object.entries(mutations)) console.log(`  ${name}: ${JSON.stringify(mutate(fn))}`);

// ---- (3) desk.rating change
const deskFlag = Object.fromEntries(Object.entries(OPTS).map(([k, fn]) => {
  const n = pubs.filter((p) => { const s0 = snaps.get(p.ticker)!; const s = { ...s0, desk: { ...s0.desk, rating: { ...s0.desk.rating, bearFloor: s0.desk.rating.bearFloor + 0.01 } } } as Snapshot; return fn(fingerprints(s)) !== fn(base.get(p.ticker)!); }).length;
  return [k, n];
}));
const trapFlag = pubs.filter((p) => { const s0 = snaps.get(p.ticker)!; const s = { ...s0, desk: { ...s0.desk, recurringTraps: [...s0.desk.recurringTraps, "new trap"] } } as Snapshot; return bAll(fingerprints(s)) !== bAll(base.get(p.ticker)!); }).length;
console.log(`\n== desk edits: rating.bearFloor +1pp flags ${JSON.stringify(deskFlag)}; a new recurring trap flags (b) ${trapFlag}`);
```

### probe-completeness.ts

```ts
// probe-completeness.ts — option (b) must be at least as sensitive as the rendered surface to pack data: mutate every
// leaf of a pack one at a time; any leaf that moves the rendered Facts/Context block but not the (b) component is a gap.
// Also counts over-sensitive leaves (b moves, render does not). Run: cd <repo> && npx tsx <scratch>/s3/probe-completeness.ts [TICKER ...]
import { projectReportFacts } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/facts/project.ts";
import { renderFactsBlock, renderContextBlock } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt.ts";
import { published, headTexts, load, factsInputs, contextInputs, canon, sha } from "./fp-lib";

type Leaf = { path: (string | number)[]; value: unknown };
function leaves(o: unknown, path: (string | number)[] = [], out: Leaf[] = []): Leaf[] {
  if (o !== null && typeof o === "object") {
    if (Array.isArray(o)) o.forEach((v, i) => leaves(v, [...path, i], out));
    else for (const [k, v] of Object.entries(o)) leaves(v, [...path, k], out);
  } else out.push({ path, value: o });
  return out;
}
const setAt = (o: any, path: (string | number)[], v: unknown) => { let x = o; for (const k of path.slice(0, -1)) x = x[k]; x[path.at(-1)!] = v; };
const bump = (v: unknown): unknown => typeof v === "number" ? (v === 0 ? 1.5 : v * 1.37 + 0.11) : typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}/.test(v) ? "2001-02-03" : v + " Zq") : typeof v === "boolean" ? !v : v === null ? 7.25 : v;

const want = process.argv.slice(2);
const pubs = published().filter((p) => (want.length ? want.includes(p.ticker) : ["NVDA", "JPM", "UEC", "INTC", "ALL"].includes(p.ticker)));
for (const p of pubs) {
  const s = load(headTexts(p));
  const render = (pk: typeof s.pack) => { try { const f = projectReportFacts(pk); return { facts: renderFactsBlock(f, pk), context: renderContextBlock(pk), bF: sha(canon(factsInputs(f, pk))), bC: sha(canon(contextInputs(pk))) }; } catch { return null; } };
  const base = render(s.pack)!;
  const ls = leaves(s.pack).filter((l) => l.path[0] !== "history" || (l.path[1] as number) < 3); // history: first 3 points only (never rendered)
  const gaps: string[] = [], over: string[] = []; let tested = 0, threw = 0;
  for (const l of ls) {
    const pk = structuredClone(s.pack); setAt(pk, l.path, bump(l.value));
    const r = render(pk); if (!r) { threw++; continue; } tested++;
    if (r.facts !== base.facts && r.bF === base.bF) gaps.push(`facts ${l.path.join(".")}`);
    if (r.context !== base.context && r.bC === base.bC) gaps.push(`context ${l.path.join(".")}`);
    if (r.facts === base.facts && r.bF !== base.bF) over.push(l.path.join("."));
  }
  console.log(`${p.ticker}: ${tested} leaves mutated (${threw} threw); gaps ${gaps.length}${gaps.length ? ": " + gaps.slice(0, 12).join("; ") : ""}; over-sensitive ${over.length}${over.length ? ": " + over.slice(0, 8).join("; ") : ""}`);
}
```

### probe-projection-drift.ts

```ts
// probe-projection-drift.ts — the backfill computes the review-time fingerprint with HEAD code. Is that what the reviewer
// saw? Compare the facts the built report carried at the review commit (data/<t>.json there) with HEAD's projection of the
// review-commit pack: snapshot, the three statement tables, multiples, segments. Run: cd <repo> && npx tsx <scratch>/s3/probe-projection-drift.ts
import { projectReportFacts } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/facts/project.ts";
import { published, atTexts, load, canon, git } from "./fp-lib";

const diffs: string[] = [], same: string[] = [], skipped: string[] = [];
for (const p of published()) {
  const edPath = `data/judgment/${p.ticker}/${p.accession}.editorial.json`;
  const c = git("log", "-1", "--format=%h", "--", edPath).trim();
  let rep: any;
  try { rep = JSON.parse(git("show", `${c}:data/${p.ticker.toLowerCase()}.json`)); } catch { skipped.push(`${p.ticker}(no report at ${c})`); continue; }
  if (rep.meta?.filing?.accession !== p.accession) { skipped.push(`${p.ticker}(report at ${c} is another accession)`); continue; }
  const s = load(atTexts(p, c));
  const tbl = (t: any) => (t ? { columns: t.columns, rows: t.rows } : undefined);
  const segs = (xs: any[] | undefined) => xs?.map((x) => ({ name: x.name, sharePct: x.sharePct, revenue: x.revenue })).sort((a, b) => a.name.localeCompare(b.name));
  const f =projectReportFacts(s.pack) as any;
  const parts: Record<string, [unknown, unknown]> = {
    // the report appends judgment-chosen highlight cells to the snapshot and a judgment `note` to each table
    snapshot: [rep.snapshot?.slice(0, f.snapshot.length), f.snapshot],
    income: [tbl(rep.sections?.financials?.income), f.sections.financials.income],
    balance: [tbl(rep.sections?.financials?.balance), f.sections.financials.balance],
    cashflow: [tbl(rep.sections?.financials?.cashflow), f.sections.financials.cashflow],
    multiples: [rep.sections?.valuation?.multiples?.rows?.map((r: any) => ({ label: r.label, value: r.values[0] })), f.sections.valuation.multiplesCompanyColumn.map((m: any) => ({ label: m.label, value: m.value }))],
    // the report orders segments as the judgment does; compare as a set
    segments: [segs(rep.sections?.businessMoat?.segments), segs(f.sections.businessMoat.segments)],
  };
  const bad = Object.entries(parts).filter(([, [a, b]]) => a !== undefined && canon(a) !== canon(b)).map(([k]) => k);
  const absent = Object.entries(parts).filter(([, [a]]) => a === undefined).map(([k]) => k);
  if (bad.length) diffs.push(`${p.ticker}@${c}: ${bad.join(",")}${absent.length ? ` (not in report: ${absent.join(",")})` : ""}`);
  else same.push(p.ticker + (absent.length ? `(not in report: ${absent.join(",")})` : ""));
}
console.log(`same: ${same.length}`); if (same.some((s) => s.includes("("))) console.log(`  ${same.filter((s) => s.includes("(")).join(" ")}`);
console.log(`differs: ${diffs.length}`); for (const d of diffs) console.log(`  ${d}`);
console.log(`skipped: ${skipped.join(" ") || "none"}`);
```

### probe-uec-old.ts

```ts
// probe-uec-old.ts — the one superseded findings file (UEC 0001437749-26-019889): stale or not under (b)?
import { headTexts, atTexts, load, fingerprints, bAll, git } from "./fp-lib";
const p = { ticker: "UEC", accession: "0001437749-26-019889" };
const c = git("log", "-1", "--format=%h", "--", `data/judgment/UEC/${p.accession}.editorial.json`).trim();
const then = fingerprints(load(atTexts(p, c))), now = fingerprints(load(headTexts(p)));
console.log(`review commit ${c}: facts ${then.bFacts === now.bFacts ? "same" : "CHANGED"}, calls ${then.bCalls === now.bCalls ? "same" : "CHANGED"}, context ${then.bContext === now.bContext ? "same" : "CHANGED"}; bAll ${bAll(then) === bAll(now) ? "clean" : "stale"}`);
```

### probe-prerating.ts

```ts
// probe-prerating.ts (R-4, revised for N-1/N-2) — for every findings file, which desk.json / pack blocks did the raw file at
// the review commit lack, so that HEAD's schema fills them by default? For reviews whose desk had no `rating` block (they read
// the pre-02d1335 overlapping envelope, which had no reward/risk test and no bear floor), report what TODAY's rule says:
// E, D, R, today's derived label, the published label, and validate's rating issues under today's desk.rating. No "old
// derived label" is computed: the old envelope was overlapping and allowed any conservative label, so it derives none.
// N-2 check: how many of the 102 published judgments would fail ratingIssues if bearFloor rose by 5pp (a re-key must
// not blanket-restamp those). Run: cd <repo> && npx tsx <scratch>/s3/probe-prerating.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeConviction, deriveLabel } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/conviction.ts";
import { ratingIssues } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment.ts";
import { load, git, published, headTexts } from "./fp-lib";

const DESK_KEYS = ["analyst", "analystName", "disclaimer", "styleRules", "recurringTraps", "lint", "review", "rating"];
const files: { t: string; acc: string; path: string }[] = [];
for (const t of readdirSync(join("data", "judgment")).sort())
  for (const f of readdirSync(join("data", "judgment", t))) if (f.endsWith(".editorial.json")) files.push({ t, acc: f.replace(".editorial.json", ""), path: `data/judgment/${t}/${f}` });

const byMissing = new Map<string, string[]>();
const packMissing = new Map<string, string[]>();
const rows: string[] = [];
for (const f of files) {
  const c = git("log", "-1", "--format=%h", "--", f.path).trim();
  const deskRaw = JSON.parse(git("show", `${c}:data/desk/desk.json`));
  const missing = DESK_KEYS.filter((k) => !(k in deskRaw));
  for (const k of missing) byMissing.set(k, [...(byMissing.get(k) ?? []), `${f.t}/${f.acc.slice(-6)}`]);
  const packAt = JSON.parse(git("show", `${c}:data/facts/${f.t}/${f.acc}.json`));
  const packHead = JSON.parse(readFileSync(`data/facts/${f.t}/${f.acc}.json`, "utf8"));
  const absentKeys = (h: any, o: any, pre = ""): string[] => (h && typeof h === "object" && !Array.isArray(h))
    ? Object.keys(h).flatMap((k) => (o == null || !(k in o) ? [pre + k] : absentKeys(h[k], o[k], `${pre}${k}.`))) : [];
  for (const k of absentKeys(packHead, packAt)) packMissing.set(k, [...(packMissing.get(k) ?? []), f.t]);
  if (missing.includes("rating")) {
    const s = load({ pack: JSON.stringify(packAt), judgment: git("show", `${c}:data/judgment/${f.t}/${f.acc}.json`), desk: JSON.stringify(deskRaw) });
    const conv = computeConviction(s.judgment.sections.valuation.scenarios, s.pack.quote.price);
    const issues = ratingIssues(s.judgment, s.pack.quote.price, s.desk.rating);
    rows.push(`${f.t}/${f.acc} @${c}: published ${s.judgment.rating.label}; E ${(conv.expectedUpside * 100).toFixed(1)}% D ${(conv.bearDownside * 100).toFixed(1)}% R ${conv.rewardRisk.toFixed(2)}; today's rule derives ${deriveLabel(conv, s.desk.rating)}; ratingIssues under today's desk.rating: ${issues.length}`);
  }
}
console.log(`findings files: ${files.length}`);
for (const [k, v] of byMissing) console.log(`desk.json at review commit lacks "${k}" (HEAD fills by default): ${v.length}: ${v.join(" ")}`);
for (const [k, v] of packMissing) console.log(`pack at review commit lacks "${k}" (present at HEAD): ${v.length}`);
console.log("\npre-rating reviews (read the overlapping envelope; never reviewed against today's rule):");
for (const r of rows) console.log("  " + r);

// N-2: a bear-floor rise must not blanket-restamp. Count published judgments whose rating checks fail at bearFloor + 5pp.
let fail = 0; const failing: string[] = [];
for (const p of published()) {
  const s = load(headTexts(p));
  const raised = { ...s.desk.rating, bearFloor: s.desk.rating.bearFloor + 0.05 };
  if (ratingIssues(s.judgment, s.pack.quote.price, raised).length) { fail++; failing.push(p.ticker); }
}
console.log(`\nN-2: published judgments failing ratingIssues at bearFloor +5pp: ${fail}: ${failing.join(" ")}`);
```

### probe-report-match.ts

```ts
// probe-report-match.ts (R-3) — the brief preflight: does data/<t>.json on disk carry the current projection of the HEAD
// pack (snapshot prefix, the three tables' columns+rows, company multiples, segments as a set, quote incl. history)?
// Run: cd <repo> && npx tsx <scratch>/s3/probe-report-match.ts
import { readFileSync } from "node:fs";
import { projectReportFacts } from "file:///C:/Users/nicopc/Documents/juniresearch/lib/facts/project.ts";
import { published, headTexts, load, canon } from "./fp-lib";

export function reportMismatch(rep: any, f: any): string[] {
  const tbl = (t: any) => (t ? { columns: t.columns, rows: t.rows } : undefined);
  const segs = (xs: any[] | undefined) => xs?.map((x) => ({ name: x.name, sharePct: x.sharePct, revenue: x.revenue })).sort((a, b) => a.name.localeCompare(b.name));
  const parts: Record<string, [unknown, unknown]> = {
    snapshot: [rep.snapshot?.slice(0, f.snapshot.length), f.snapshot],
    income: [tbl(rep.sections?.financials?.income), f.sections.financials.income],
    balance: [tbl(rep.sections?.financials?.balance), f.sections.financials.balance],
    cashflow: [tbl(rep.sections?.financials?.cashflow), f.sections.financials.cashflow],
    multiples: [rep.sections?.valuation?.multiples?.rows?.map((r: any) => ({ label: r.label, value: r.values[0] })), f.sections.valuation.multiplesCompanyColumn.map((m: any) => ({ label: m.label, value: m.value }))],
    segments: [segs(rep.sections?.businessMoat?.segments), segs(f.sections.businessMoat.segments)],
    quote: [rep.quote, f.quote],
  };
  return Object.entries(parts).filter(([, [a, b]]) => canon(a ?? null) !== canon(b)).map(([k]) => k);
}

const bad: string[] = [];
for (const p of published()) {
  const rep = JSON.parse(readFileSync(`data/${p.ticker.toLowerCase()}.json`, "utf8"));
  const s = load(headTexts(p));
  const m = reportMismatch(rep, projectReportFacts(s.pack));
  if (m.length) bad.push(`${p.ticker}(${m.join(",")})`);
}
console.log(`published reports whose data/<t>.json does not carry the HEAD pack's projection: ${bad.length}`);
console.log(`  ${bad.join(" ")}`);
```
