# Editorial rubric — Juniper Finance Research Desk

Read the report against these ten items in order. Each names the failure it is
looking for and the severity that failure carries. Quote the offending text
verbatim in the finding; a finding the author cannot locate is not a finding.

## 1. Attribution — Critical

Every figure in the prose appears on the grounding surface — the prompt's Facts
block, the report's own calls, or the Context excerpts — with the same quantity,
the same period and the same unit. A figure attached to the wrong quantity, the
wrong period or the wrong source is Critical even when the number itself exists
somewhere in the pack. Check the ones that carry the argument first: revenue,
margin, the backlog, the target band, the fair value.

## 2. Unsupported claims — Critical

A statement of fact the surface does not support. Four shapes recur: an
inference the source invites but does not make; a causal claim ("because",
"drove", "as a result of") the pack does not establish; a "record" or a "first"
the series on the page does not show; a characterisation of a document the pack
does not carry ("the proxy discloses…" when no proxy was captured).

## 3. Honest dating — Important

Sourced facts carry their period. A proxy, a press release or a call fact older
than the filing is dated wherever its age changes what it means. Nothing a year
old is presented as current. "As of the filing" is not a date.

## 4. Judgment, not restatement — Important

A control, ownership, pay or exposure figure is read for the holder: what does
40.9% of the shares let this person do that 4% would not? Each section reaches a
view the reader can act on. A paragraph that only lists facts the Facts block
already gave is a finding, however accurate it is.

## 5. The counter-case — Important

Each judgment names the reading that cuts the other way, using figures already on
the page. A bull section with no bear sentence, or a bear scenario that is a
formality rather than a scenario, is a finding.

## 6. Calls coherence — Important

The base case is anchored to something on the surface — a multiple, a guided
figure, or an argument in words. Each scenario's probability is stated and argued
once, not restated in three places. The target band and the probability-weighted
fair value are consistent with what the prose says, and the band brackets the
base implied price.

## 7. Repetition and pointers — Important

Each figure is introduced once per section and referred back to in words. No
sentence appears in two sections. Executive-summary catalysts and risks point;
the sections behind them argue. The lint catches the mechanical cases — the same
token, the same sentence — so look for the paraphrase: the same claim made twice
in different words, in two places.

## 8. Source disagreements — Important

When two sources disagree on a figure, the report says so once and states which
figure it used. Silently picking one is a finding; saying it twice is a
repetition finding.

## 9. Voice — Minor

No unearned superlatives and no hype. Spans (`{+ +}`, `{- -}`) only around signed
changes or explicit positives and negatives, never around a whole sentence. One
tense per paragraph. The company's phrasing quoted where the phrasing is the
point. Dates in prose form, not ISO. No tic repeated past the point of notice.

## 10. Fit — Minor

Field lengths sit inside their caps with room to spare, so the next round has
somewhere to go. Nothing material was cut only for space without being flagged.

---

## How to write the findings

One finding per defect, `F-1` upward, each with: `severity`, the judgment `field`
path, the offending `quote` verbatim, the `issue` (what is wrong), the `fix`
(what to do instead), and `status: "open"`. Keep the count under forty; if a
defect recurs in five places, write one finding and name all five in `issue`.

On a re-check you are reading your own previous findings: verdict each one
`addressed`, or leave it `open` with a `note` saying what is still wrong, before
you add anything new.

Your verdict is `approved` (nothing open), `approved-with-minors` (only Minors
open) or `needs-fix-round` (any Critical or Important open).
