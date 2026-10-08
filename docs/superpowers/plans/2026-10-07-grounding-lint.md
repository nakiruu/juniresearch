# Grounding lint: a typed index built from the author's surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2 (2026-10-07).** An adversarial review re-ran the harness, reproduced every number and returned APPROVE WITH CHANGES. This revision adopts all ten items:

- **R-1** Green between tasks: old exports kept until Task 7; each test is ported in the task that removes its API.
- **R-2** Exceptions keyed to the judgment hash *and* the rendered-surface hash; the true drift scope stated.
- **R-3** Exception enforcement decided in the plan.
- **R-4** Overclaims fixed; S-1 restated with context; the attack table; a "weakly grounded" list for the reviewer.
- **R-5** D2 rescoped by miss reason.
- **R-6** Tokenizer additions, then a full re-measure.
- **R-7** Corrections.
- **R-8** No `synth:build` dry run.
- **R-9** Placeholder-only prompt wording.
- **R-10** A figure-repeat test.

**Revision 3 (final, 2026-10-08).** The reviewer re-checked revision 2 (every number reproduced; APPROVE WITH CHANGES). This revision makes three required changes:

1. The trailing-zero second reading matches only entries with at least 2 significant digits (§4.1, §2.4).
2. GOOGL, IOT, NVT, TJX and ZBRA, whose surfaces drifted silently, get no exception entries (§5).
3. Exceptions apply only when the file is byte-equal to `main`'s copy (§5).

It also adds a minor §3 note on ZBRA "20x".

**The owner has decided D1–D5 and the drift scope. They are recorded in §6, and the post-merge fix queue is §6.1.** Nothing in this plan is open.

All numbers below are re-measured on the revision-3 prototype.

**Goal:** Fix audit findings S-1 (the index ignores unit, scale and kind), S-2 (it is near-vacuous at 0–1 dp) and S-7 (tokenizer edges) in `lib/synth/grounding.ts`. The index should hold what the author actually sees, each entry typed, and a prose figure should ground only against an entry of a compatible kind, magnitude, sign and precision. Published reports keep republishing without any judgment being edited.

**Architecture:** The tokenizer becomes typed: kind (`money` with currency, `pct`, `mult`, `pp`, `bp`, `plain`), absolute magnitude, explicit sign, resolution, significant digits and an integer's trailing zeros. The index stops broadcasting raw FactPack numbers. It is built from five rendered sources:

- the Facts statement tables, typed by each row's `CellFormat`;
- the other Facts lines, with the trimmed precision of `compactUSD`/`compactNum` restored;
- the **Calls** block (desk thresholds, not indexed today);
- the judgment block;
- the Context block.

A matcher compares a prose token with the entries using one resolution rule, plus two narrow wildcards for statement-table cells whose unit sits in a column header. A miss gets a reason (`explain`). A figure that grounds only through a path that cannot check unit, scale or sign is listed as *weakly grounded* for the reviewer. `validateJudgment` builds the surface. `synth:build` applies a shrink-only exception list keyed to (judgment SHA-256, rendered-surface SHA-256), and only when the file is byte-equal to `main`'s copy. A new read-only `scripts/grounding-sweep.ts` re-runs the measurement before every republish.

**Tech stack:** TypeScript (tsx), vitest, zod. No new dependencies. No network.

**Spec:** The 2026-10-06 audit findings S-1, S-2 and S-7 (quoted in the orchestrator's brief). Design intent #6 in `docs/superpowers/specs/2026-09-13-synthesis-design.md` says "the grounding index is built from the same strings". The code drifted from that by indexing raw FactPack numbers, and this plan restores it. Process rules are in `docs/10022026learning.md`.

**Branch:** `claude/grounding-lint-2026-10-07` (cut from `main` 9f31479, already checked out).

---

## Global constraints

- **Never edit** `data/**`: packs, judgments, reports, `data/desk/*`, `data/trade/**`. Also never touch tokens, `.env*`, `BANNED_TICKERS` or the Schwab auth files. No network calls. The sweep script reads only, and uses `git show` for build-time packs.
- **Editing a judgment after review invalidates the review.** The implementer must not edit any judgment to make the new lint pass. Published reports are handled by the exception file (Task 8).
- `lib/format.ts` is frozen. The tokenizer copes with `$-0.08` and `0.57×` instead.
- Out of scope, listed as follow-ups only: S-3 (pack hash in the review fingerprint) and S-5 (the draft marker).
- **Every task ends with a full `npx vitest run`, all green** (R-1). Baseline, confirmed 2026-10-07 on this branch: **136 files, 1765 passed, 4 skipped**.
- No model IDs in commits. No PRs unless asked. Commit messages end with the session's attribution lines.
- Nothing reaches `main` without review: a code review (superpowers:requesting-code-review), then a `--no-ff` merge after the owner's STOP.

## Review focus

1. Re-run the harness (Appendix B) and confirm §2. The rest of the plan follows from those numbers.
2. Context tokens cannot be fully typed. Most captured statement-table cells are unit-less: `$\n15,955`, `13.3\n%`, `(39,112)`, `27.3` under a "Percent Change" header, with "(in millions)" far above. The two wildcards (§4.4) are the price of not rejecting thousands of legitimate quotes. Their cost is measured (§2.4, §2.5), and figures that ground only through them are listed for the reviewer (§4.6).
3. Exceptions never mask **drift**. They lapse when the judgment *or* the rendered surface changes, and they apply only when the file is byte-equal to `main`'s copy (§5). The ten reports that fail on today's packs and the five silently drifted reports get no entries.
4. The tokenizer change moves the desk lint. This was measured on every published judgment (§2.6).

---

## 1. The surface: how each number reaches the author

| Surface element | Renderer | What the author sees | Kind / scale / precision the index must carry |
|---|---|---|---|
| Snapshot, highlight cells | `formatSnapshot`, `compactUSD`, `compactNum`, `usd`, `pct`, `mult` | `$361.99`, `~$1.72T`, `$63.9B (+23.9%)`, `$27B`, `4.77B`, `44.9x`, `0.70%`, `-$623M`, `Buy (54 B / 6 H / 0 S)` | Typed by the token. **`compactUSD` trims zeros**, so `$27B` is 27.0 at 1 dp and `$T` values have 2 dp. `compactNum` uses 2 dp for B/M/T. The precision is restored from the formatter, not from the trimmed string. |
| Statement tables | `formatCell(v, row.format)` | Bare cells: `63.9` in "Revenue ($B)", `+21.0%`, `1.50` in "Diluted EPS ($)*", `2.64` (current ratio), `-0.4` (capex) | Typed from the **row format**: `usdB` → money ×1e9 at 1 dp, `pct`/`pctSigned` → pct at 1 dp, `eps`/`usd0`/`usd2` → money ×1, `num2` → plain ratio at 2 dp, `mult` → mult. |
| Estimates line | `money()` = `compactUSD`, `eps()` = `usd()` | `FY26E revenue $105.9B, EPS $11.63`. A negative EPS renders as **`$-0.08`**. | The tokenizer accepts a sign after the currency symbol. |
| TTM / quote / Street lines | `pct`, `mult`, `num(…,2)`, `usd`, `compactUSD` | `Net debt/EBITDA 0.7x`, `Current ratio 2.50`, `range $350.00–$600.00`, `60 analysts: Buy 54 · Hold 6` | Typed by the token. |
| "—" for null | all | `—` | Nothing indexed. |
| **Calls** (`renderCalls(desk.rating)`) | `pct`, `rewardRiskText` | `E ≥ +10.0% and R ≥ 0.50×`, `SELL is E ≤ -5.0%`, `at least 15.0% below` | **Not indexed today.** Authors quote the thresholds ("the 0.50× BUY bar"), and these passed only by coincidence. 62 published tokens ground only here. |
| Judgment block (`renderJudgmentBlock`) | `usd`, `pct`, `rewardRiskText` | `Base: $455.00 × 50% = $227.50`, `Reward/risk 0.70×` | Indexed today as text, but **`×` (U+00D7) is not a multiplier in today's tokenizer**. |
| Context (`renderContextBlock`) | verbatim excerpts | 60K+ characters. HTML-table extraction puts cells on their own lines: `$\n15,955`, `13.3\n%`, `(4)`, `(.4)`, `.07`, `<1`, `0.5\npt`, footnote-glued `$29.3711`; prose ranges such as "between $8.15 and $8.25 billion". The unit and scale live in a header ("Dollars in millions", "in 000s", "% of net sales"). | The kind is attached when the layout shows it. Everything else is a **bare cell**: unknown kind and scale (§4.4). |

**What `extraText` carries today:** `validate-judgment.ts:121` passes `[renderFactsBlock(facts, pack), renderJudgmentBlock(j, price)]`. `buildAllowedIndex` also indexes **every raw FactPack number**, including unrendered rows (absolute `grossProfit`) and **`peers`** (the prompt says "peers pending"), each at ÷1e3/1e6/1e9/1e12 and ×100. That is the root of S-1, and it lets unrendered full-precision values pass (ICE `$4.66B`). The new index drops `factNumbers`.

---

## 2. Measurements (all re-measured on the revision-3 prototype)

**Corpus.** `data/judgment` has 109 directories. Seven (ASPN, CC, CRWV, DDD, RCAT, SMCI, UMAC) hold only gitignored residue of removed tickers. The other 102 hold the judgment for the published accession (`data/<t>.json` `meta.filing.accession`). ORCL and UEC also carry one superseded judgment each. Pairing and extra text follow `synth:build`/`validateJudgment` exactly, with the real `lib/` renderers imported.

**Two pack snapshots.**

- **Build-time** is the pack as committed with the last commit that touched `data/<t>.json`, i.e. what the reviewer approved. All 102 judgments are identical at that commit.
- **HEAD** is today's pack, which a republish uses.

Every table states which one it uses.

### 2.1 Headline numbers (102 published reports)

| | Current lint | Prototype (proposed policy) |
|---|---|---|
| Prose tokens checked | 14,028 | 13,949 |
| Failures, build-time packs | **0** | **21 figures in 15 reports** (§3) |
| Failures, HEAD packs | **45 in 10 reports** (§2.2) | **75 in 22** = the same 21 + 54 from changed packs |
| Current-lint failures the prototype passes | — | **0** |
| How passes ground (build-time) | — | exact 13,129 · lossless 698 · coarse 73 · band 28 |
| …by source | — | facts 6,487 · context 6,196 · judgment 1,183 · calls 62 |

### 2.2 Drift: the reviewed surface has moved under 30 published reports

At HEAD packs, today's lint already fails **45 figures in 10 reports**: BAM 18, MQ 6, CRWD 5, RDVT 5, INTU 4, MPWR 3, CAT 1, EXFY 1, ICE 1, VRT 1. The prose quotes figures that `cc1e51e` (2026-10-03, "Count capitalized software and lease equipment as capex; correct FOUR/DSP/BAM packs") changed. That commit is also BAM's source; `308ecc3` only added BAM's `crosscheckOverrides`. **A `synth:build --date` republish of these ten fails today** and will still fail after this change. The prototype adds 9 misses in the same reports (BAM 4, EXFY 2, ICE 2, CAT 1).

The wider scope, found by the reviewer and confirmed with `silentdrift.ts`: **30 of 102 published reports render a different Facts or Context block at HEAD than at build time.**

- **Ten** trip the lint (above).
- **Twenty** drifted **silently**: BE, CHWY, DELL, ESAB, EVLV, GOOGL, IOT, LITE, LQDT, LRCX, LTRX, MMM, NVT, PLTR, SOLS, TJX, UEC, VICR, VSH and ZBRA.

BAM is among the ten and is a held name. The packs changed through `cc1e51e`, `c1aa1e2` (Shibui cross-check stamps), `44cbdd9` (SBC/goodwill re-stamp) and later backfills. This is S-3's territory. The sweep prints the silent-drift list (Task 7). Decided (§6): the 10 failing reports and 5 silently drifted ones with lint misses are queued for fixing (§6.1); the other 15 wait for S-3.

### 2.3 Policy variants (build-time packs; failures / reports)

| Variant | Fails | Note |
|---|---|---|
| **Proposed** | **21 / 15** | |
| context rounding floor 2 sig digits (instead of 3) | 19 / 13 | accepts TJX "13%" from 13.3% |
| context rounding floor 4 | 29 / 18 | rejects "$59.0B" from `$58,981,365` (thousands) |
| surface rounding floor 1 (instead of 2) | 11 / 8 | accepts "near 0.6x", "$1T"; random 9.3% → 14.1% |
| wildcard floor 1 for money/plain | 18 / 13 | accepts MDU "$0.4M"; random `$N` 8.2% → 78.9% |
| wildcard floor 3 | 62 / 30 | rejects "$41 million" from a bare `41` cell |
| % / points wildcard floor 2 | 28 / 17 | rejects UNH "fell 4%" from `(4)`, CFG "less than 1%" from `<1` |
| no sign check | 21 / 15 | costs nothing on the corpus |
| no pp ← pct | 24 / 15 | NVT "46.9 points" vs `46.9\n%` |
| bp ← pct allowed | 21 / 15 | random "NNN bps" 8.3% → 23.1%; **rejected** |
| no mult ← ratio | 24 / 16 | UEC "17.26x current ratio" vs Facts `17.26` |
| no decade bands | 49 / 24 | "$190s", "mid-80s", "low-20s" |
| multiples may use the bare-cell wildcard | 18 / 14 | random integer multiples 5.8% → 31.4% |
| floor 2 on the unscaled money-cell scale-up | 22 / 16 | rejects FOUR "$3 million" (`$\n3`) |
| per-share cells may scale up (M1' off) | 20 / 15 | EPS-as-$billion attack 5% → 21% (§2.5) |
| reviewer M1: money-cell scale-up only for table-shaped cells | 106 / 30 | **rejected**: 85 more misses (WM, HON, DD, BAM, PLOW, SOLS guidance and segment figures) |
| reviewer M2: bare cell grounds %/points only near a "%" | 33 / 22 | **rejected**: 12 more misses (UNH "rose 55%", AXON "5.1%", FTI "27.1%"); random 9.3% → 8.3% |

**Tokenizer changes and their measured effect (R-6; revision 3).** The build-time misses stay the same 20 figures, plus LH "$8.73 billion", which is M1''s one cost.

- An integer with trailing zeros is read **both ways**: as written, and with the zeros insignificant.
- **The second reading may only match an entry with at least 2 significant digits** (revision 3). Unrestricted, it reopened round-number density: random "$N00 million" acceptance rose from 22.0% to 64.6%, almost all through exact matches against 1-significant-digit $B Facts cells (`0.3`, `0.7`).
- With the restriction, "$63,900 million" grounds against `63.9`, and "$500 million" against a context "$0.50 billion". It does **not** ground against a `0.5` ($B) cell.
- `need2nd.ts`: **no corpus figure needs the second reading** (0 tokens), so the restriction costs nothing (still 21 in 15).
- A *single* insignificant-zero reading was measured and **rejected**. It newly failed 8 legitimate roundings (EVLV "40 percent" for 40.1%, TER "60%" for 59.6%, KRYS "40x" for 40.4x) and the verbatim XOM "$90M" cell.

### 2.4 Probe batteries (AVGO) and random false-accept rates

| Battery | Current | Prototype |
|---|---|---|
| S-1 list (16), context stripped, published AVGO judgment | 16/16 pass | **1/16** (`$250` = AVGO's Bear `$250.00`) |
| …same, golden judgment fixture (what the unit tests use) | — | **1/16** (`$250` is a 2-significant-digit rounding of the golden's `$245.00` weighted Base) |
| **S-1 transformations of each pack's own revenue and EPS, context present** (reviewer's `s1full.ts`, 102 packs) | — | **108/1,169 (9.2%)**, revision 1 was 151/1,169 (12.9%); context stripped 30/1,169 (2.6%) |
| S-2 battery (89, my reconstruction; the audit reported 63/89 on its own list), full index | 76/89 | **48/89** (golden 46/89) |
| …its 21 odd-decimal / unit-edge probes | most pass | **0/21** |
| Controls that must pass (17) | 17/17 | **17/17** |
| Sign / per-share / unit probes that must fail (7) | 7/7 wrongly pass | **0/7** |

**Seeded random-figure false-accept rate:** 20 random figures per form per pack, 102 packs, `random-d3.ts`. The original nine forms use seed 20261007; the three round-number rows use their own stream (seed 20261008), so the original rows are unchanged.

| Form | Current | **Proposed** (build-time) | Proposed (HEAD) | surface floor 1 | wildcard floor 1 | mult wildcard on | bp ← pct on | 2nd reading unrestricted |
|---|---|---|---|---|---|---|---|---|
| `N.N%` | 13.4% | **5.3%** | 5.3% | 5.3% | 5.3% | 5.3% | 5.3% | 5.3% |
| `N%` (int) | 64.6% | **45.9%** | 45.9% | 47.8% | 45.9% | 45.9% | 45.9% | 45.9% |
| `N.Nx` | 20.3% | **1.0%** | 1.0% | 1.0% | 1.0% | 3.7% | 1.0% | 1.0% |
| `Nx` (int) | 77.6% | **5.8%** | 5.8% | 13.1% | 5.8% | 31.4% | 5.8% | 5.8% |
| `$N.NB` | 14.4% | **7.9%** | 7.9% | 7.9% | 7.9% | 7.9% | 7.9% | 7.9% |
| `$N,NNN million` | 0.5% | **0.7%** | 0.7% | 0.7% | 0.7% | 0.7% | 0.7% | 0.7% |
| `$NN.NN` | 2.2% | **0.3%** | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% |
| `$N` (int) | 98.4% | **8.2%** | 8.2% | 42.5% | 78.9% | 8.2% | 8.2% | 8.2% |
| `NNN bps` | 17.8% | **8.1%** | 8.1% | 8.1% | 8.1% | 8.1% | 20.7% | 8.3% |
| **all (the nine forms above)** | **34.4%** | **9.3%** | **9.3%** | 14.1% | 17.1% | 12.4% | 10.7% | 9.3% |
| `$N00 million` | 42.5% | **22.0%** | 22.0% | 40.0% | 22.6% | 22.0% | 22.0% | 64.6% |
| `$N,000 million` | 21.4% | **24.2%** | 24.4% | 58.7% | 31.4% | 24.2% | 24.2% | 32.8% |
| `$0.NB` | 90.2% | **61.0%** | 61.0% | 63.8% | 69.1% | 61.0% | 61.0% | 61.0% |

**Named residual: small values in $B tables.** `$0.NB` is still accepted 61% of the time, and `$N00 million` / `$N,000 million` about 22–24%. The Facts statement tables render every company in $B at 1 dp. For a small company (or a small line such as capex), that makes 1-significant-digit cells (`0.3`, `0.7`, `0.0`) that a round figure legitimately matches. This is the same gap behind the MDU and CSTM false positives (they cite `0.0` cells) and AIP's cash showing `0.0`. The fix is `$M` tables below a size threshold, a named follow-up (§9, item 3) and not this plan.

### 2.5 Realistic invented-number attacks (reviewer's `attacks.ts`, build-time packs)

Probes whose literal string is already on the surface are skipped.

| Attack | n | Current | **Proposed** |
|---|---|---|---|
| Facts $B rewritten as "million" (scale swap) | 101 | 100% | **16%** |
| Facts $B as "$X,XXX million" at false precision | 98 | 100% | **34%** |
| EPS rewritten as "$E billion" | 100 | 100% | **5%** |
| EPS rewritten as "$E million" | 100 | 100% | **3%** |
| TTM P/E written as % | 96 | 100% | 1% |
| quarter YoY written as x | 99 | 100% | 0% |
| sign flip on the quarter YoY | 100 | 100% | **24%** |
| computed 3-year revenue CAGR (1 dp) | 83 | 40% | 8% |
| computed capex/revenue (1 dp) | 75 | 45% | 9% |
| computed capex/revenue (integer) | 17 | 76% | **65%** |
| computed payout (integer) | 29 | 41% | **31%** |
| unrendered gross profit "$X.XB" | 71 | 100% | **55%** |
| revenue at 2 dp "$X.XXB" | 102 | 100% | 35% |
| peer P/E, 1 dp / integer | 60 / 57 | 100% / 100% | 0% / 12% |

The residual comes from three places:

- **Bare table cells** (digits only). 1,496 corpus tokens ground through one; 667 typed tokens in 71 reports ground *only* through a unit-less cell or a money-cell scale-up (`wildonly.ts`).
- **Unsigned context**: the sign flip, because context `86\n%` carries no sign.
- **Facts table cells at 1 dp** that a coarse unrendered value happens to equal: gross profit `$0.4B` vs a `0.4` cell.

The lint is a floor, not attribution. §4.6 hands the weak cases to the reviewer explicitly.

### 2.6 Desk lint and the golden fixture

Running a copy of `lib/synth/lint/**` with the prototype tokenizer on every published judgment:

- errors 0 → **1**: ZBRA `figure-repeat` on `"8 points"` (`executiveSummary.risks[2]` and the thesis), a genuine repeat the old allow-list hid;
- warnings 127 → 125. Keys `80` → `80s`, `20` → `20s` and `40` → `40s`; INTC `14`/`18` and ALRS `14` drop out (now labels); AEIS `2.5%` and MP `10X` are added.

The golden fixture's misses go from 2 (`$1.4B` ×2) to 7. The new five are `0.68x` (the surface shows `0.7x`), plus `100T` and `200T` ×2: "100T Tomahawk" is 100 *terabit*, misread as a trillion scale.

---

## 3. Triage of every prototype failure (build-time packs; 21 figures, 15 reports)

The reason column is the prototype `explain()` output (§4.5).

| # | Report · field | Figure | Reason · evidence | Class |
|---|---|---|---|---|
| 1 | **LH** · `growth.points[0]` | `$13,952` | unit · source "$13,952 million": the unit was dropped | **(a) TRUE POSITIVE: mis-scaled** |
| 2 | **ICE** · `financials.cashflowCommentary` | `$4.66B` | finer · Facts shows `4.7` ($B); 4.66 is only the raw pack value | **(a) TRUE POSITIVE: precision beyond the surface** |
| 3–4 | MDU · `analystCommentary`, `financials.incomeCommentary` | `$0.4M` | short-cell · 10-Q `(.4)` (in millions) | (b) FALSE POSITIVE |
| 5 | CSTM · `financials.incomeCommentary` | `$4 million` | short-cell · shredded "Other gains and losses net (39) 1 % **4\n%**" | (b) FALSE POSITIVE |
| 6 | LH · `executiveSummary.catalysts[2]` | `$8.73 billion` | short-cell · `Backlog\n$\n8.73` in an "(in billions)" table; a 2-decimal money cell is treated as per-share (M1') | (b) FALSE POSITIVE: the cost of M1' |
| 7 | CAT · `valuation.scenarioCommentary` | `0.6 times` | rounding · own `0.57×` | (c) policy: 1-digit rounding |
| 8 | GOOGL · `valuation.scenarioCommentary` | `0.9x` | rounding · own `0.92×` | (c) same |
| 9–10 | NVT · `valuation.scenarioCommentary`, `finalRecommendation.body[2]` | `0.6x` | rounding · own `0.64×` | (c) same |
| 11–12 | LLY · `executiveSummary.companyOverview`, `financials.cashflowCommentary` | `$1T` ("above $1T") | rounding · Facts `$1.02T` | (c) same |
| 13 | NVDA · `financials.balanceCommentary` | `400 times` ("over 400 times") | rounding · Facts `426.7x` | (c) same |
| 14 | IOT · `valuation.multiplesCommentary` | `50x` ("roughly 50x FY2027") | rounding · Facts NTM `50.5x` | (c) same |
| 15 | TJX · `valuation.scenarios[1].driver` | `13%` ("low-13% area") | rounding · context `13.3%` | (c) 2-digit rounding of context |
| 16 | MPWR · `valuation.scenarios[0].driver` | `30%` ("holds above 30%") | rounding · context `30.3` | (c) an assumption, but numerically a 1-digit rounding |
| 17 | ZBRA · `valuation.scenarios[0].driver` | `20x` ("roughly 20x") | rounding · Facts `16.6x` | (c) the same. In substance an assumed multiple, but classed **rounding**, not "none", because 16.6x lies within one significant digit of 20x (16.6 rounds to 20 at one significant digit), so the explain() rounding relaxation finds it. It stays an error under D2. |
| 18 | PLOW · `valuation.scenarioCommentary` | `11x` | none | (c) **assumed parameter** |
| 19–20 | USFD · `valuation.scenarios[2].driver`, `valuation.scenarioCommentary` | `14x` ("a judgment, not a finding") | none | (c) assumed parameter |
| 21 | ZBRA · `valuation.scenarios[2].driver` | `13x` | none | (c) assumed parameter |

**Counts:** (a) 2 true positives (LH, ICE), (b) 4 false positives (MDU ×2, CSTM, LH `$8.73 billion`), (c) 15 policy.

**Which reports get exception entries?**

- CAT, ICE and MPWR fail on drift at HEAD anyway (§2.2). They get no entries; ICE's true positive is fixed in its drift re-synthesis.
- GOOGL, IOT, NVT, TJX and ZBRA have silently drifted surfaces (§2.2). They get **no** entries either: keying them to the HEAD surface would except a surface no reviewer saw. Their republish fails until they are fixed.
- All eight go to the fix queue (§6.1).
- PLOW and USFD carry only assumed-figure warnings under D2, so they need no entries.
- **Entries remain for 5 reports: CSTM, LH, LLY, MDU, NVDA (8 entries, §5).**

**False positives found and eliminated while iterating** (each has a prototype fix and a test in the tasks):

- the unindexed Calls block;
- `$\n15,955` and `13.3\n%` layouts;
- bare cells with the unit in a header;
- `$-0.08`, `.07`, `0.2 %`, `0.5\npt`, `(.4)`;
- footnote-glued `$29.3711`;
- `21.705` million and `$58,981,365` thousands;
- "past 52 weeks";
- "2026 point to";
- "met 4 times";
- decade bands;
- "46.9 points" vs "46.9%";
- `17.26x` vs the ratio `17.26`;
- range ends, including "between $8.15 and $8.25 billion", which made M1' affordable;
- years inheriting a range unit.

---

## 4. The matching rule (decision and justification)

### 4.1 Tokens

Each prose or source token carries the following:

- `kind`: `money` (currency `$`, `US$`, `C$`, `A$`, `HK$`, `€`, `£`, `¥`), `pct` (`%`, `percent`, `per cent`), `mult` (`x`, `X`, `×`, `times`), `pp` (`points`, `pts`, `pt`, `pp`, `percentage points`, `-percentage-point`), `bp` (`bps`, `bp`, `basis points`, compared in pp units) or `plain`;
- the absolute magnitude after the scale: `K`/`M`/`B`/`T`/`bn`/`mn`/`mm`/`tn`/`thousand`/`million`/`billion`/`trillion`, also hyphenated as "$63.9-billion". Lowercase `k`/`m`/`b` count as a scale only directly after a currency ("$5m", "$1.2b");
- `sign`: −1, 0 or +1, written as `+`, `-` or `−`, before or after the currency, or `(12.3)%`. A parenthesized money figure in **prose** is a parenthetical, not a negative;
- `res` = 10^−dp × scale, and `sig` = significant digits written;
- `tz`: an integer's trailing zeros. It gives the second reading, with resolution ×10^tz and sig − tz (§2.3). **The second reading matches only entries with at least 2 significant digits** (`POLICY.secondReadingMinSig = 2`);
- `band` for `$190s` → [190, 200), and `$100s` → [100, 200).

### 4.2 Entries

Entries are tokens plus `source` ∈ {facts, calls, judgment, context}:

- **Facts tables**: digits from `formatCell`; kind and scale from the row format; sign known.
- **Facts lines**: `compactUSD` precision restored (B and M at 1 dp, T at 2 dp), `compactNum` at 2 dp; unsigned means positive.
- **Calls** and **judgment block**: sign known.
- **Context**: index mode.
  - The small-count allow-list is off.
  - The sign is known only if written.
  - `N\n%` is indexed as both pct and bare.
  - "between X and Y" joins a range.

### 4.3 Kind compatibility

| Prose kind | Grounds against |
|---|---|
| `plain` | any kind, by magnitude |
| `money` | money of the same currency; a **context** plain entry with a scale ("15.95 billion"). Never a Facts plain entry (a share count). |
| `pct` | pct |
| `mult` | mult; a Facts plain entry with decimals (ratio rows) |
| `pp` | pp, bp, pct ("46.9 points" of growth vs "46.9%") |
| `bp` | pp, bp. **Not pct**: "540 bps" is a change, not a 5.4% level. |

### 4.4 Comparison

**Sign.** Reject when both carry a sign and the signs differ. An unsigned "declined 12%" against −12% passes.

**Resolution.** The prose may not be finer than the source.

- At equal resolution, both values must round to the same number.
- At coarser prose resolution, the source rounded to the prose resolution must equal the prose:
  - **lossless** always passes (`$495.00` → `$495`, `$1,148 million` → `$1.148 billion`);
  - **lossy** needs at least **2** significant digits for a Facts, Calls or judgment source (or the source's own count, if fewer), and at least **3** for a context source.

**Bare context cell** (context, plain, unscaled):

- plain unscaled prose compares directly;
- **a multiple never uses it**;
- money and scaled-plain prose need at least 2 significant digits and are tried at scales {1, 1e3, 1e6, 1e9};
- pct and pp need at least 1 significant digit, at scale 1;
- bp uses scale 0.01.

**Unscaled context money cell** (`$\n15,955`): money prose of the same currency is tried at {1, 1e3, 1e6, 1e9}, **except** a 2-decimal cell (`$4.56`), which is per-share-shaped and is never scaled up (M1'). That cuts the EPS-as-aggregate attack from 21% to 5% for one false positive (LH `$8.73 billion`).

**Bands:** a compatible entry lies inside the band.

**Why this rule.**

- Magnitude by kind kills the S-1 matrix while keeping legitimate scale changes.
- The resolution floor kills S-2's mechanism (rounding at the token's precision against thousands of values).
- Context gets a stricter rounding floor because it is large and dense.
- "Exact equality to a rendered form" (the audit's S-2 suggestion) cannot work for context, because its table cells carry no unit; the two narrow wildcards keep the 6,196 context-grounded quotes.

### 4.5 Miss reasons (`explain`)

A miss keeps the prefix `"<raw>" is not in the facts or the captured context` (tests depend on it) and adds a reason. The reason is the first single relaxation under which the figure would ground:

1. **sign** — "the surface shows it with the opposite sign: `<entry>`";
2. **finer** — the prose rounded to a *non-zero* entry's resolution equals it: "more precise than the surface shows: `<entry>`";
3. **rounding** — the surface/context floors set to 1: "rounding `<entry>` this far is not allowed — quote it as shown or in words";
4. **short-cell** — the wildcard floors set to 1, or M1' off: "a table cell this short cannot vouch for a scaled figure — quote it with the table's unit or in words";
5. **unit** — the same written digits at the same precision, on a typed entry, either the same kind at a different scale or (across kinds) with at least 3 significant digits, so a coincidental "14" does not count: "the surface shows these digits with another unit or scale: `<entry>`";
6. **none** — "no figure of this kind on the surface matches it".

### 4.6 Weakly grounded figures (R-4)

A grounded figure is *weak* when it grounds only through:

- a **bare cell** (unit and scale unchecked: 373 corpus figures);
- a **money-cell scale-up** (scale unchecked: 341);
- or, for a signed prose figure, **unsigned context** (sign unchecked: 55).

That is 769 figures in 73 reports: mean 7.5 per report, median 4, maximum 47. The build writes them to the errors file as a `weak:` block. The author prompt never sees that block (`promptTail` ignores it). The review brief renders them as "Weakly grounded figures — check unit, scale, sign and attribution first". Both are computed by one pure function, `weakGroundings(j, facts, pack, desk)`.

---

## 5. Rollout policy for published reports (decided: D1)

**Facts.** 15 published reports fail the new lint on their build-time packs. At HEAD, 22 fail: 12 lint-only reports plus the 10 that fail on changed packs (CAT, ICE and MPWR are in both groups). A same-date republish of any of them fails at `validate`. No judgment may be edited.

**Decision (D1): an exception file keyed to (judgment SHA-256, rendered-surface SHA-256), plus an active fix queue (§6.1)** so the file shrinks to empty.

Options considered and rejected:

- a hard switch (blocks every build);
- warn-only for N weeks (new reports slip through);
- a legacy lint for published reports (two code paths and a drift-masking risk).

**Keying.** `surfaceSha256` is the SHA-256 of `renderFactsBlock + renderCalls + renderJudgmentBlock + renderContextBlock`. A rendered-surface hash rather than a pack hash because:

- it lapses on any change the grounding depends on (pack values, projection code, desk thresholds, the price behind E/D/R);
- it does not lapse on pack fields the author never sees (BAM's `crosscheckOverrides`).

An entry matches only on (accession, judgmentSha256, surfaceSha256, check, field, raw). Any judgment edit or surface change lapses it, and the figure must then pass.

**Entries exist only for reports whose surface is unchanged since review.** That means build-time surface = HEAD surface, so the entry's surface hash is a surface a reviewer actually saw. A report whose surface drifted, loudly or silently, gets no entry and goes to the fix queue.

**Enforcement (decided; not an owner decision).**

- **(a) Only merged exceptions count.** `synth:build` applies the file only when the working copy of `lib/synth/grounding-exceptions.json` is **byte-equal to `git show main:lib/synth/grounding-exceptions.json`**. Otherwise it prints `grounding exceptions ignored: file differs from main` and applies none.
  - A wip commit that edits both the JSON and the pin test on a branch therefore excepts nothing.
  - **Fail closed:** git missing, the file absent on `main`, or `git show` failing all mean that no exceptions apply.
  - The rule rests on the house rule that `main` changes only through reviewed `--no-ff` merges.
- **(b) Shrink-only by test.** `lib/synth/grounding-exceptions.test.ts` pins `FROZEN_KEYS`, the literal list of the 8 keys below. Every entry in the file must be in it, so adding an entry needs a reviewed code change *and* a merge.
- **(c) On the implementation branch itself**, the file is not on `main` yet, so `synth:build` on the branch applies no exceptions. That is correct: nothing is republished from the branch.
  - The tests cover the rule by **injection**: `loadExceptions({ readWorking, readMain })` takes both readers. One unit test passes equal contents and expects the entries; one passes different contents and expects none plus the warning; one makes `readMain` throw and expects none (fail closed).
  - The sweep's `--preview-exceptions` flag evaluates the working copy and labels its output "preview — synth:build ignores this file until it is on main". It is used for Task 8's acceptance.
  - After the `--no-ff` merge, `main` holds the file, the bytes match on a `main` checkout, and the entries apply.
- **(d) Stage order.** The `exceptions` stage runs after `input check`, so a Shibui-fail message is never pre-empted.
- **(e) Output.** An excepted miss becomes a warning: `grounding exception (owner-approved, <class>): <reason>`.

**Entries (8 entries, 5 reports).** None for CAT, ICE or MPWR (pack drift) or for GOOGL, IOT, NVT, TJX or ZBRA (silent surface drift). PLOW and USFD carry only D2 assumed-figure warnings. No drift miss is ever an entry.

| # | Report · check · field | Figure | Class | Reason (verbatim from §3) |
|---|---|---|---|---|
| 1 | CSTM · grounding · `financials.incomeCommentary` | `$4 million` | false-positive | shredded table cell "4\n%" (the prior-year $4M) |
| 2 | LH · grounding · `executiveSummary.catalysts[2]` | `$8.73 billion` | false-positive | 2-decimal cell in an "(in billions)" table; the per-share rule M1' blocks it |
| 3 | LH · grounding · `growth.points[0]` | `$13,952` | **true-positive** | the unit was dropped: the source reads "$13,952 million"; fix at next synthesis |
| 4–5 | LLY · grounding · `executiveSummary.companyOverview`, `financials.cashflowCommentary` | `$1T` | policy | 1-digit rounding of `$1.02T` |
| 6–7 | MDU · grounding · `analystCommentary`, `financials.incomeCommentary` | `$0.4M` | false-positive | single-digit table cell `(.4)` (in millions) |
| 8 | NVDA · grounding · `financials.balanceCommentary` | `400 times` | policy | 1-digit bound of `426.7x` |

**What a republish does after the merge.**

- CSTM, LH, LLY, MDU, NVDA with unchanged judgment and surface: passes, with the exception warnings.
- After any edit: the entries lapse, and the fixed prose must pass.
- The 13 other queued reports (§6.1): fail at `validate` until their fix round.
- Before any republish: `npm run grounding:sweep -- <T>`.

---

## 6. Decisions (recorded 2026-10-08)

- **D1 · Rollout: the exception file**, keyed to judgment and surface hashes and applied only when byte-equal to `main` (§5). The excepted reports are **actively fixed**, not left waiting (§6.1).
- **D2 · Misses with no near-miss: warning.** A `mult` or `pct` miss whose `explain()` reason is **none** becomes an assumed-figure warning, wherever it sits: "assumed figure — not on the surface; argue its basis in the sentence". The review brief lists each one.
  - *Revised after code review C-1: whole-number multiples only.* Only a `mult` miss with precision 0 and reason **none** is a warning; every `%` and every figure with a decimal stays an error (the `pct` downgrade let invented margins through).
  - Today that is PLOW `11x`, USFD `14x` ×2 and ZBRA `13x` (4 warnings, 3 reports).
  - Every sign, finer, rounding, short-cell or unit miss stays an error, including CAT and GOOGL's 1-digit R roundings, MPWR "above 30%" and ZBRA "roughly 20x".
  - Build-time result: **17 errors in 13 reports + 4 warnings**.
- **D3 · One-digit rounding: rejected.** Allowing it would raise the random rate from 9.3% to 14.1% (`$N` from 8.2% to 42.5%). Authors write the figure as shown, or the claim in words ("short of the 1.00× bar" is quotable from Calls).
- **D4 · True positives: fixed at their next synthesis.** ICE is already in the drift queue. LH is marked "next synthesis" in the fix queue unless the owner pulls it forward.
- **D5 · Exception file location: `lib/synth/grounding-exceptions.json`.**
- **Drift.** The 10 reports that fail on changed packs are queued, **BAM first** (held). Of the 20 silently drifted reports, the five that also have lint misses (GOOGL, IOT, NVT, TJX, ZBRA) are queued (change 2 of revision 3). **The other 15** (BE, CHWY, DELL, ESAB, EVLV, LITE, LQDT, LRCX, LTRX, MMM, PLTR, SOLS, UEC, VICR, VSH) **wait for S-3.**

### 6.1 Fix queue (post-merge; not an implementation task)

Run after Task 10's merge, in this order, one report at a time, with the house process (learnings §1):

1. the original author agent (or a fresh one pointed at the prompt, the judgment and the sweep output) fixes every listed miss;
2. a fresh reviewer reads a `--full-brief`;
3. `synth:build -- <T> <ACC> --date <original reportDate>` passes the editorial gate;
4. the sweep confirms 0 misses;
5. the report merges `--no-ff`.

**A fixed report's exception entries are removed from the JSON and from `FROZEN_KEYS` in the same merge**, so the file only shrinks. It is deleted, with `scripts/lib/grounding-legacy.ts`, when empty.

| Order | Report | Why queued | What the fix round must do |
|---|---|---|---|
| 1 | **BAM** (held) | pack drift (cc1e51e): 22 misses at HEAD | re-ground the FCF and revenue prose on the corrected pack |
| 2–10 | CAT, CRWD, EXFY, ICE, INTU, MPWR, MQ, RDVT, VRT | pack drift (cc1e51e FCF/capex correction) | re-ground on the corrected pack. Also CAT `0.6 times` (rounding), ICE `$4.66B` (true positive), MPWR `30%` (rounding) |
| 11–15 | GOOGL, IOT, NVT, TJX, ZBRA | silent surface drift + lint misses (no entries) | GOOGL `0.9x`; IOT `50x`; NVT `0.6x` ×2; TJX `13%`; ZBRA `20x` and the `8 points` figure-repeat, with `13x` argued (D2 warning) |
| 16–19 | CSTM, LLY, MDU, NVDA | exception entries | CSTM `$4 million` and MDU `$0.4M` ×2: name the figure from the table with its unit in words, or drop it. LLY `$1T` ×2: quote `$1.02T`. NVDA `400 times`: quote `426.7x`. Removes 6 entries. |
| 20 | **LH** | exception entries, including the true positive | **next synthesis** (D4), unless the owner pulls it forward: `$13,952` → "$13,952 million"; `$8.73 billion` stated with its source. Removes 2 entries. |

The queue holds **20 reports**: 5 with entries, 5 silently drifted, and 10 with pack drift. PLOW and USFD are not queued; their D2 warnings ride along at their next synthesis.

---

## 7. Interactions

- **Desk lint** (`figure-repeat.ts`, `markup.ts`, `structure.ts`) imports `numericTokens`. Keys are `raw`, so they change where the tokenizer now keeps a unit (`40 bps`, `8 points`, `2.6 times`, `(12.3)%`, `$190s`) or allow-lists a label (`Note 14`, `14A`, `FAST-41`, `S&P 500`). `structure`'s kind equality gains `pp`/`bp`. Measured impact is in §2.6. `NumberToken` keeps `raw`, `kind`, `value`, `magnitude` and `precision`, so the rules compile unchanged.
- **`desk.json` recurring traps:** no change (`data/` is out of scope).
- **Author prompt (`lib/synth/prompt.ts`)** — placeholders only, no real figures (R-9, the capture-note trap).

  The CONTRACT line 100 is replaced by: "Quote figures as they appear in the Facts, Calls or Context blocks below, in the same unit and scale, and never more precise than shown. You may drop trailing zeros, or round to fewer digits while keeping at least two significant digits of a Facts figure and three of a Context figure ($X.YB may become $XB; a Context figure X.Y% stays X.Y%). A statement-table cell keeps its table's unit: write "$N,NNN million", never "$N,NNN". Never compute a new figure, never recall one from memory; a figure that appears in none of these blocks fails validation."

  `renderCalls`' quotable-numbers bullet gains: "the thresholds in this Calls section are quotable too."

  Add (D2): "A multiple or margin you assume, and that is not on the surface, is your judgment: state its basis in the same sentence; the build lists each one for the reviewer."
- **Review brief (`review-brief.ts:46`)** — rewritten without the overclaim (R-4).

  "Its **Facts**, **Calls** and **Context** blocks, with the report's own calls, are the grounding surface. The build rejects a figure that matches nothing on it. Where the surface states a unit, scale or sign (Facts, Calls, typed Context figures), the build checks them. A Context statement-table cell carries no unit, so a figure matching one is checked by digits only, and Context signs are not checked. The section below lists every figure grounded that weakly; check its unit, scale, sign and attribution first. Which quantity and which period a figure is attached to (rubric item 1) is always yours."

  It then renders a `# Weakly grounded figures` section (§4.6) and an `# Assumed figures` section (D2).
- **Docs:**
  - README §3 (line ~208): "every figure in the prose must match a figure in the rendered Facts block, the Calls thresholds, the report's own calls or the Context excerpts, with a compatible unit and no finer precision; Context table cells match by digits, and figures grounded only that way are listed for the reviewer".
  - Add a `grounding:sweep` line to the command list.
  - `.claude/skills/synthesize/SKILL.md`: run `npm run grounding:sweep -- <T>` before any republish.
  - Learnings §14 after merge.

---

## 8. Tasks

Every task is TDD: write the failing test, run it red, implement, run it green. **Every task ends with `npx vitest run`, all green, before its commit** (R-1). Old exports (`AllowedIndex`, `buildAllowedIndex`, `factNumbers`) stay until Task 7 switches `validateJudgment`. Each old test is ported in the task that removes its API. Appendix A (`proto.ts`) is the measured reference implementation; port it, don't redesign it.

### Task 0: Baseline (read-only)

- [ ] `git status`: untracked `docs/scoreconcepts/VSCodiumUserSetup-x64-1.135.06055.exe` and this plan, `docs/superpowers/plans/2026-10-07-grounding-lint.md` (commit the plan first: `docs(plan): grounding lint`).
- [ ] `npx vitest run` gives **136 files, 1765 passed, 4 skipped**.
- [ ] Appendix B `current.ts`: `PACK_AT=report` → 0 failures; HEAD → 45 in 10. Keep the output in the scratchpad.

### Task 1: Typed tokenizer (old index unchanged)

**Files:** `lib/synth/grounding.ts` (tokenizer only), `lib/synth/grounding.test.ts`.

- [ ] **Tests first** (new `describe("numericTokens v2")`; each case states raw, kind, currency, abs, sign, resolution and tz):
  - Every existing case passes **except `grounding.test.ts:50`**, "300-400 basis points". It expects `["300","400"]` and becomes `["300","400 basis points"]`, both `bp`. Update that one expectation, and say so in the commit.
  - Scales: `$1.5bn`, `$5mn`, `$5mm`, `$500K`, `$5m`, `$1.2b`, `$12.3k` (lowercase only after a currency; bare `12.3k` → plain 12.3), `$63.9-billion`.
  - Signs: `(12.3)%` → −; `($24.99)` and `($1.45) loss` → sign 0; `$-0.08` = `-$0.08`; `−$1.3B` → −.
  - Units: `40 bps` (one token), `150bp`, `300-400 basis points`, `5.4 points`, `0.5 point`, `0.5\npt`, `(0.7)\npts`, `3.1-percentage-point` → pp; `0.50×`, `2.6 times`, `2.6X` → mult; `met 4 times` → none; `400 times` → mult; `a 10-point plan` → none (a hyphenated unit word counts only as "-percentage-point").
  - Currencies: `€12`, `£5`, `US$5` (→ `$`), `C$5.2 billion`, `HK$12`, `¥120 billion`.
  - Layout: `$ 15,952`, `$\n15,952`, `13.3\n%`, `0.2 %`, `$\n.07`, `(.4)`.
  - Words: `20 percent`, `2.3 per cent`; `February 17, 2026 point to` → none.
  - Bands: `$190s`, `$3s`, `mid-80s`; `the 1990s` → none.
  - Ranges: `40-50%`, `5 to 7 percent`, `$350–600`, `$1.2–1.5 billion`, `$1.750 to $1.810 billion`, `$415 to $455 million`, `between $8.15 and $8.25 billion` (both ×1e9), `between 5 and 7 percent`. `$45 and $1.2 billion` leaves `$45` unscaled ("and" joins only after "between"). `fiscal year 2027 to $1.225 billion` → money only. `10-25 units` → `25`.
  - Trailing zeros: `$500 million` has tz 2; `50 bps` tz 1; `$63,900 million` tz 2; `40%` tz 1; `$4.50` tz 0 (decimals are significant).
  - `54 B` → plain 54e9 (documented quirk).
  - Every case from the reviewer's `formats.ts` (Appendix B) tokenizes as shown in its output.
- [ ] **Implement:** port `tokens()` as `numericTokens(text, mode = "prose")`.
  - Export `NumberToken` with the old fields: `raw`, `value` (signed, unscaled), `magnitude` (signed, scaled; bp in pp), `precision`, `kind`.
  - Add `currency`, `sign`, `abs`, `resolution`, `sig`, `tz`, `band?` and `index`.
  - Widen `kind` to six values.
  - The old `AllowedIndex` keeps using `value`/`magnitude`. Measured "Task-1 state" (`task1run.ts`): build-time 0 failures, HEAD 45 in 10, golden misses unchanged.
- [ ] `npx vitest run lib/synth/grounding.test.ts lib/synth/lint`, then `npx vitest run`.
  - Lint deltas must match §2.6: fix a fixture expectation only when the new token is the correct reading, and name each one in the commit.
  - Anything else is a tokenizer bug.
- [ ] Commit: `feat(grounding): typed tokenizer — currency, sign, bp/pp, ×, scales, ranges, bands (S-7)`.

### Task 2: Allow-list additions

- [ ] **Tests first.**
  - **No tokens:** `Schedule 13G/A`, `the 14A`, `13G`, `Item 1A`, `Note 14`, `Tier 1`, `Section 232`, `Phase 3`, `ISO 9001`, `FAST-41`, `COVID-19`, `Intel 14A`, `30 September 2026`, `a 52/53-week year`, `the past 52 weeks`, `S&P 500`, `Russell 1000`, `Russell 2000`, `Fortune 500`, `401(k)`, `24/7`, `a 1-for-10 split`, `Level 3 inputs`, `Gen 5`, `Rule 10b5-1`.
  - **Still tokens:** `over 52 weeks` → `52`; `53rd percentile` → `53`; `over 25 years` → `25`; `in 15 countries` → `15`; `$14A` → money; `14 analysts` → `14`; `PDK 0.9` → `0.9` (the label rule covers bare integers only).
  - **Index mode** keeps small counts: `numericTokens("Acquisitions\n5\n%", "index")` → pct 5.
- [ ] **Implement:** `allowed()`, returning `"small" | "other" | false`. Only `"small"` may be revived by range inheritance, and index mode ignores `"small"`.
- [ ] `npx vitest run` green; commit `feat(grounding): allow-list labels, index names, day-first dates, period phrases (S-7)`.

### Task 3: Desk-lint compatibility (+ R-10)

- [ ] **Test first** (`lib/synth/lint/rules/figure-repeat.test.ts`):
  - a unit whose executive-summary thesis says "About 8 points of guided growth come from acquisitions" and whose risk says "roughly 8 points of guided growth" → one `figure-repeat` error keyed `"8 points"`;
  - the same with "40 bps";
  - "a 10-point plan" twice → no issue.
- [ ] Run `npx vitest run lib/synth/lint` and reconcile against §2.6.
- [ ] Re-run the corpus delta against the real module.
  - **Adapter:** the old side is `main`'s lint, from a throwaway worktree: `git worktree add ../jr-main main`. Import `lintJudgment` from `../jr-main/lib/synth/lint`, and from the branch's `lib/synth/lint` for the new side.
  - Expected: errors 0 → 1 (ZBRA), warnings 127 → 125.
  - Remove the worktree afterwards.
- [ ] `npx vitest run` green; commit `test(lint): figure keys follow the typed tokenizer; repeated points/bps are caught`.

### Task 4: The surface index (new exports beside the old ones)

**Files:** `lib/synth/grounding.ts`, `lib/synth/grounding.test.ts`.

- [ ] **Tests first** (AVGO pack + golden judgment):
  - **Table entries:** typed by row format. "Revenue ($B)" FY25 → money 63.9e9 at 1e8 resolution. Capex `-0.6` → money, sign −. Current ratio → plain at 2 dp. YoY → signed pct.
  - **Precision restore:** `$27B` is indexed at 1 dp; `~$1.72T` at 2 dp; `4.77B` shares at 2 dp.
  - **Calls:** `0.50×`, `+10.0%`, `-5.0%` and `15.0%` have source `calls`.
  - **Judgment block:** `Reward/risk 1.98×` is `mult`.
  - **Context:** `$\n15,955` → money unscaled; `11.2\n%` → pct and bare; `(14,632)` → bare, sign 0; `<1` → bare `1`.
  - **Parity:** every numeric `FinancialTable` cell yields one entry whose digits equal `formatCell`'s output.
  - **No raw pack numbers:** an unrendered `peers[0].pe` = 123.4 does not ground `123.4x`.
- [ ] **Implement:** `GroundingSurface` = `{ tables; factsBlock; callsBlock; judgmentBlock; contextBlock }`, plus `buildGroundingIndex(surface)` (the Appendix A entry builders). `grounding.ts` stays pure: no import from `prompt.ts` or `validate-judgment.ts`. **Keep** `AllowedIndex`, `buildAllowedIndex` and `factNumbers` (still used by `validate-judgment.ts:17,121` and `grounding.test.ts:59–137`).
- [ ] `npx vitest run` green; commit `feat(grounding): index the rendered surface (alongside the old index)`.

### Task 5: The matcher

- [ ] **Tests first:**
  - **Kind (§4.3):** `$6` vs plain 6 fails; `25` vs pct 25 passes; `$4.77B` vs the Facts `4.77B` share count fails; `$15.95 billion` vs context `15.95 billion` passes; `17.26x` vs Facts `17.26` passes; `46.9 points` vs pct passes; **`540 bps` vs pct `5.4%` fails**; `5.4%` vs pp 5.4 fails.
  - **Sign:** `-23.9%` vs Facts `+23.9%` fails; `fell 12%` vs Facts `-12.0%` passes; `-12%` vs unsigned context passes.
  - **Resolution:** `$4.66B` vs `4.7` fails; `$63,887 million` vs `$63.9B` fails; `$64B` passes; `$0.1T` fails; `5%` vs Facts `4.7%` fails; `$495` vs `$495.00` passes; `$60 billion` vs `63.9` fails.
  - **Two readings:**
    - These pass: `$63,900 million` vs table `63.9`; `$500 million` vs context `$0.50 billion`; `50 bps` vs context `0.50 percentage points`; `40%` vs Facts `40.1%` (written reading); `$250` vs judgment `$245.00` (2 significant digits under the second reading).
    - **These fail** (the second reading never matches a 1-significant-digit entry, revision 3): `$500 million` vs table `0.5`; `$300 million` vs table `0.3`; `50 bps` vs `0.5 percentage points`.
    - The random rows of §2.4 are reproduced: `$N00 million` 22.0%, `$N,000 million` 24.2%, `$0.NB` 61.0%, against 64.6% / 32.8% / 61.0% with the restriction off.
  - **Context rounding:** `$29.37` vs `$29.3711` passes; `13%` vs `13.3%` fails; `45%` vs context `45.3%` fails but vs Facts `45.3%` passes; `$1.41 billion` vs `$1,412 million` passes, `$1.4 billion` fails.
  - **Bare cell:** `$15,955 million` vs `15,955` passes; `16%` vs `16` passes; `$4 million` vs `4` fails; `22x` vs `22` fails; `40 bps` vs `40` passes.
  - **Money cell:** `$15,955 million` vs `$\n15,955` passes; `$3 million` vs `$\n3` passes; **`$4.56 billion` vs `$4.56` fails** (M1').
  - **Bands:** `low $190s` vs `$193.00` passes; vs `$205` fails.
  - **Golden-surface batteries:** S-1 1/16 (only `$250`, explained above); the 21 odd S-2 probes 0/21; controls 17/17; must-fail 0/7.
- [ ] **Implement:** `GroundingIndex.lookup(token)` (Appendix A `readings`/`matchOne`/`compare`/`kindOk`), with `POLICY` an exported frozen constant. There is **no CLI override** (R-7d).
- [ ] `npx vitest run` green; commit `feat(grounding): match by kind, magnitude, sign and resolution (S-1, S-2)`.

### Task 6: Miss reasons and weak groundings

- [ ] **Tests first:**
  - LH-shaped `$13,952` vs `$13,952 million` → **unit**;
  - `$4.66B` vs `4.7` → **finer**;
  - `-23.9%` → **sign**;
  - `0.6x` vs `0.57×` → **rounding**;
  - `$0.4M` vs `(.4)` → **short-cell**, not "finer by 0.0";
  - `14x` with a context `$14 million` → **none** (cross-kind needs at least 3 significant digits);
  - `$17.9B` → **none**.
  - **Messages** start with the old prefix.
  - **`weakness()`:** `$15,955 million` vs a bare `15,955` → `bare-cell`; vs `$\n15,955` → `money-cell-scale-up`; `-12%` vs unsigned context `12%` → `unsigned-context`; `$63.9B` vs Facts → not weak.
- [ ] **Implement:** `explain()` and `weakness()` per §4.5–4.6. `checkGrounding(obj, index)` returns `GroundingMiss[]` (= `ValidationIssue` + `token` + `reason`). Add `weakGroundings(obj, index)`.
- [ ] `npx vitest run` green; commit `feat(grounding): say why a figure missed; list weakly grounded figures`.

### Task 7: Switch validateJudgment; port the old tests; the sweep

**Files:**

- `lib/synth/validate-judgment.ts` and its test;
- `lib/synth/grounding.ts` and its test;
- `scripts/synth-build.ts`, `lib/synth/errors-file.ts`;
- `scripts/grounding-sweep.ts` (new);
- `scripts/lib/grounding-legacy.ts` (new: a frozen copy of `main`'s `grounding.ts`, used only for the sweep's comparison column; deleted in the follow-up);
- `package.json`.

- [ ] **Tests first:**
  - `groundingSurface(j, facts, pack, desk)` includes `renderCalls(desk.rating)`.
  - `validateJudgmentDetailed(...)` → `{ errors, warnings, weak }`. `validateJudgment` = `.errors` (signature unchanged).
  - D2: a `mult`/`pct` miss with reason `none` → a warning with rule `grounding-assumed`, **wherever it sits**. A `rounding` miss in a scenario driver stays an error.
  - **Golden** (`validate-judgment.test.ts:192`): the §2.6 list of 7, with the calibration comment updated.
  - **Ported from `grounding.test.ts`** in this same task, because this task deletes their API:
    - "AllowedIndex lookup cache" becomes resolution tests on `GroundingIndex`: context `12.35%` grounds `12.35%` and `12.4%` but not `12%`; `7.1%` vs context `7.08` fails, vs Facts passes.
    - The ORCL press-release and proxy tests use `buildGroundingIndex`.
    - "Indexes extra text" becomes "indexes the judgment block".
  - **Errors file:** `renderErrorsFile` writes an optional `weak:` block; `parseErrorsFile` round-trips it; `promptTail` never includes it.
- [ ] **Implement:**
  - Switch `validateJudgment` to the new index.
  - **Delete** `AllowedIndex`, `buildAllowedIndex` and `factNumbers`.
  - `synth-build.ts` appends grounding warnings and writes `weak`. Stage order is unchanged, and the input check still precedes `validate`.
- [ ] **Sweep:** `node --import tsx scripts/grounding-sweep.ts [TICKER ...] [--pack-at head|report] [--all] [--json] [--propose-exceptions] [--preview-exceptions]`, plus `"grounding:sweep": "node --env-file-if-exists=.env.local --import tsx scripts/grounding-sweep.ts"`.
  - It pairs judgments and packs as `synth:build` does; `--pack-at report` uses `git show <last commit of data/<t>.json>:<pack>`.
  - Per report it prints the legacy misses, the new misses with reasons, excepted and stale entries, and the weak count.
  - It ends with: `N figures; legacy F1 in R1; new F2 in R2; excepted E; stale S; drift D; silent surface drift: <list>`.
  - The silent-drift list holds reports whose rendered surface differs between build time and HEAD without any new miss.
  - Exit code 1 if any non-excepted miss remains for the named tickers. Read-only.
- [ ] **Acceptance:**
  - `--pack-at report`: **legacy 0; new 21 in 15** = 17 errors in 13 reports plus 4 assumed-figure warnings (D2).
  - HEAD: **legacy 45 in 10; new 75 in 22; drift 54; silent drift 20 reports** (§2.2).
- [ ] `npx vitest run` green; commit `feat(synth): validateJudgment grounds on the rendered surface; grounding:sweep`.

### Task 8: Exception file (decisions D1/D5 recorded in §6)

**Files:** `lib/synth/grounding-exceptions.ts` (schema, loader, `applyExceptions`), `lib/synth/grounding-exceptions.json`, `lib/synth/grounding-exceptions.test.ts`, `scripts/synth-build.ts`, `scripts/grounding-sweep.ts`.

- [ ] **Tests first:**
  - **Schema:** `ticker`, `accession`, `judgmentSha256`, `surfaceSha256`, `check` (`grounding` | `lint/figure-repeat`), `field`, `raw`, `class`, `reason` (1–300), `approvedAt`.
  - **Matching:** a full match becomes a warning; a changed judgment **or** a changed surface keeps it an error; another accession is ignored.
  - **Stage:** a malformed file fails at stage `exceptions`, which runs after `input check`.
  - **Pin test:** the file's key set ⊆ `FROZEN_KEYS`, the **8 keys of §5**, written literally in the test. An added entry fails it.
  - **Byte-equality to main, by injection.** `loadExceptions({ readWorking, readMain })`, where in production `readMain` = `git show main:lib/synth/grounding-exceptions.json`:
    - equal bytes → entries applied;
    - one byte different → none, plus the warning `grounding exceptions ignored: file differs from main`;
    - `readMain` throws (git missing, or the file not yet on `main`) → none (fail closed);
    - working file absent → none.
  - **Wip-commit case:** an injected working file with an added entry *and* a `FROZEN_KEYS` that includes it, against a `readMain` returning the old bytes → none applied.
- [ ] **Populate:**
  - `npm run grounding:sweep -- --propose-exceptions` (HEAD) gives candidates.
  - **Keep only CSTM, LH, LLY, MDU and NVDA** (8 entries). Copy class and reason from §5 by hand.
  - **No entry** for CAT, ICE, MPWR (pack drift) or GOOGL, IOT, NVT, TJX, ZBRA (silent drift): the propose step must drop any report whose build-time surface hash ≠ HEAD surface hash, and the sweep asserts it.
- [ ] **Acceptance (on the branch, before merge):**
  - `npm run grounding:sweep -- --preview-exceptions` (HEAD) shows the 8 entries matched. The failing reports are exactly the 15 queued for repair (§6.1, rows 1–15). The silent-drift list is printed.
  - Without `--preview-exceptions`, the sweep shows the entries *ignored (not on main)*. That is the correct branch behaviour, and it says so.
  - **No `synth:build` dry run** (R-8). The sweep shares the code path.
- [ ] **After the merge (Task 10):** on a `main` checkout, `npm run grounding:sweep` applies the 8 entries without the flag.
- [ ] `npx vitest run` green; commit `feat(synth): shrink-only grounding exceptions, applied only as merged to main`.

### Task 9: Prompt, brief and doc wording

- [ ] **Tests first:**
  - `prompt.test.ts`: the CONTRACT contains "never more precise than shown" and "$N,NNN million", and **no digit sequence other than the placeholders** (R-9).
  - `renderCalls` contains "thresholds in this Calls section are quotable".
  - `review-brief.test.ts`: contains "checked by digits only" and "Weakly grounded figures", and **not** "checks each figure's unit, scale, sign and precision".
  - `ReviewBriefPaths`/input gains `weak` and `assumed` (D2), rendered as sections.
- [ ] **Implement** the §7 wording. `synth-review-brief.ts` computes `weakGroundings` and the assumed-figure warnings from the judgment and pack.
- [ ] Update the README and SKILL.md.
- [ ] `npx vitest run` green; commit `docs(synth): tell authors and reviewers exactly what the grounding check enforces`.

### Task 10: Verification, review, merge (STOP for the owner)

- [ ] Run `npx vitest run` and record the count.
- [ ] `npm run grounding:sweep -- --pack-at report` and `npm run grounding:sweep`: paste both summaries.
- [ ] **Re-run the random and attack batteries against the real module.**
  - **Adapter:** the scratchpad file `adapter.ts` exports `tokens = (s) => numericTokens(s)`, `entriesFor = (c) => buildGroundingIndex(surfaceOf(c))` and `grounds = (t, idx) => idx.lookup(t)`. Point `random-d3.ts` and `attacks.ts` at it instead of `./proto`.
  - **Expected:** nine-form false-accept **9.3%** at both `PACK_AT=report` and HEAD; `$N00 million` 22.0%, `$N,000 million` 24.2%, `$0.NB` 61.0%; EPS-as-$billion 5%; S-1 with context 9.2%.
  - A different number means the port differs; diagnose before merge.
- [ ] Code review (superpowers:requesting-code-review).
- [ ] STOP for the owner's go-ahead to merge. The decisions are recorded in §6; this is the merge gate, not a decision point.
- [ ] Merge `--no-ff`, push, fast-forward the branch, add learnings §14.
- [ ] On `main`: `npm run grounding:sweep` applies the 8 exception entries (byte-equal to main). Hand the §6.1 fix queue to the orchestrator, starting with BAM.

---

## 9. Risks, non-goals and follow-ups

**Risks.**

- **Context vacuity.** Integer % is still accepted 45.9% of the time, and a sign flip 24% (unsigned context). Unrendered gross profit passes 55% through 1-dp Facts cells. The weak-grounding list (mean 7.5 per report) hands the unchecked figures to the reviewer.
- **Tokenizer side effects.** One desk-lint error (ZBRA); ZBRA is in the fix queue (no entry). Future repeated "N points"/"N bps" are caught, as intended.
- **Named residual: small values in $B tables.** `$0.NB` is still accepted 61% of the time, and `$N00 million` / `$N,000 million` about 22–24% (§2.4). The cause is 1-significant-digit cells (`0.3`, `0.0`) in $B tables for small companies and small lines. This plan accepts that residual; the fix is follow-up 3.
- **The exception file.** Keyed to the judgment and surface hashes, shrink-only by test, applied only when byte-equal to `main`, fail closed. It empties through the §6.1 fix queue; then it and `scripts/lib/grounding-legacy.ts` are deleted.
- **Performance.** Linear scan, about 0.1 s per build. Bucketing by kind is allowed if the sweep's results do not change.
- **Golden "100T".** A single-letter suffix before a product name reads as a scale. It does not occur in the published corpus; documented in the golden comment.

**Non-goals.**

- No edits to `data/**`, `data/trade`, tokens, `.env*` or `BANNED_TICKERS`.
- No network calls.
- No change to S-3, S-5 or `lib/format.ts`.

**Follow-ups.**

1. **S-3:** the pack or surface hash in the review fingerprint (30 drifted reports, §2.2).
2. **S-5.**
3. **$M statement tables for small values (the named residual):** render a table, or a line, in $M below a size threshold so that small values are not 1-significant-digit $B cells. That would close most of the `$0.NB` / `$N00 million` residual and the MDU/CSTM/AIP `0.0` cells.
4. Header-aware context table parsing: attach "(in millions)" and %-column headers to cells, retiring most of both wildcards and the weak list.
5. A structured `assumptions` field for scenario multiples and margins (replacing the D2 warning).
6. The 15 silently drifted reports not in the fix queue wait for S-3 (§6).
7. Clear the gitignored residue of the removed tickers (learnings §5).

**Where the audit was wrong or incomplete.**

- S-7's parenthesized-negative suggestion would misread prose parentheticals (`FY27E ($24.99)`).
- Ordinals of 13 and above are figures (percentiles).
- S-2's "exact equality to a rendered form" cannot hold for unit-less context cells.
- The audit missed:
  - the 30-report drift (45 figures already failing in 10 reports);
  - the unindexed Calls block;
  - `×` never being a multiplier;
  - unrendered raw pack values (peers, gross profit, full-precision OCF) being indexed.

---

## Appendix A — reference implementation

`proto.ts` (revision 2) is reproduced verbatim in "Sources" at the end of this document. The ported module must reproduce its results: the sweep counts, and `random-d3.ts`/`attacks.ts` through the Task 10 adapter.

## Appendix B — measurement harness (scratchpad, read-only)

Scratchpad: `C:\Users\nicopc\AppData\Local\Temp\claude\C--Users-nicopc-Documents-juniresearch\63a937f0-f812-4b73-91d1-14b72f7bdb18\scratchpad`. Run every script from the repo root with `npx tsx <scratch>/<file>`. `PACK_AT=report` selects build-time packs; the default is HEAD. The reviewer's run copy is in `review/run/`; the files below are the revision-2 versions.

| Script | What it prints |
|---|---|
| `corpus.ts` | Loader (pairs as `synth:build`; `PACK_AT=report` uses `git show`). |
| `current.ts` | Today's lint (§2.1–2.2). |
| `proto.ts` | The prototype (Appendix A). |
| `measure.ts` | Policy variants (§2.3); `fails.json`/`loose.txt` (`OUT=` to redirect). |
| `drift.ts` | Build-time vs drift split (run `measure.ts` with `OUT=fails-report.json` under `PACK_AT=report` and with `OUT=fails-head.json` at HEAD first). |
| `silentdrift.ts` | The 30-report surface drift (§2.2). |
| `reasons.ts` | Miss reasons, rescoped D2, the weak-grounding counts (§3, §4.6; `ANYWHERE=1` for the any-field variant). |
| `probes.ts`, `probes2.ts`, `probes-golden.ts` | AVGO batteries (§2.4). |
| `s1full.ts` | S-1 transformations with context (§2.4). |
| `random-d3.ts` | The random false-accept table (§2.4). |
| `attacks.ts` | The attack table (§2.5; `M1P=1` adds M1'). |
| `mitig.ts` | The reviewer's M1/M2 (§2.3). |
| `wildonly.ts` | Tokens grounded only via unit-less cells (§2.5). |
| `formats.ts`, `oldcases.ts`, `tok-between.ts` | Tokenizer case outputs (Task 1). |
| `task1state.ts`, `task1run.ts` | The Task-1 state (old index, new tokenizer). |
| `lintdiff.ts` + `lintcopy/` | Desk-lint delta (§2.6). |
| `golden.ts`, `why-golden.ts` | Golden misses (§2.6). |
| `need2nd.ts`, `tr-check.ts`, `tok-extra.ts` | Revision 3: corpus figures that need the second reading (0), the restricted two-reading cases (Task 5), extra tokenizer cases. |
| `show.ts`, `why.ts`, `find.js`, `survey.ts`, `tok-check.ts` | Investigation helpers. |

The `lintcopy/` rebuild command (Git Bash, repo root):

```bash
S=<scratchpad>; R=C:/Users/nicopc/Documents/juniresearch; rm -rf $S/lintcopy && mkdir -p $S/lintcopy/lint/rules && for f in lib/synth/lint/*.ts lib/synth/lint/rules/*.ts; do case $f in *.test.ts) continue;; esac; d=$S/lintcopy/lint/${f#lib/synth/lint/}; sed -e "s#\"../../grounding\"#\"../../shim-grounding\"#" -e "s#\"../../desk.schema\"#\"$R/lib/synth/desk.schema\"#" -e "s#\"../../judgment.schema\"#\"$R/lib/synth/judgment.schema\"#" -e "s#\"../../../format\"#\"$R/lib/format\"#" -e "s#\"../../validate\"#\"$R/lib/validate\"#" -e "s#\"../desk.schema\"#\"$R/lib/synth/desk.schema\"#" -e "s#\"../judgment.schema\"#\"$R/lib/synth/judgment.schema\"#" -e "s#\"../walk\"#\"$R/lib/synth/walk\"#" $f > $d; done
```


---

## Sources (verbatim, scratchpad, revision 3)

### `proto.ts`

```ts
/**
 * PROTOTYPE v2 grounding lint (scratch only). Typed tokens + a typed index built from what the author sees:
 * the rendered Facts block (tables via their row formats), the Calls block (desk thresholds), the report's own
 * calls (renderJudgmentBlock) and the Context block text. Matching is by kind, currency, absolute magnitude,
 * resolution and sign.
 */
import { formatCell, type CellFormat } from "C:/Users/nicopc/Documents/juniresearch/lib/format";
import type { FinancialTable } from "C:/Users/nicopc/Documents/juniresearch/lib/report.schema";

export type Kind = "money" | "pct" | "mult" | "bp" | "pp" | "plain";
export interface Tok {
  raw: string; index: number; end: number;
  kind: Kind; cur: string | null;          // "$", "€", "£" for money
  mag: number;                              // absolute value with the scale applied; bp normalised to pp
  sign: -1 | 0 | 1;                         // explicit sign written (0 = none written)
  dp: number; scale: number;                // decimals written; multiplier from the suffix
  res: number;                              // absolute resolution: 10^-dp × scale (bp in pp units)
  sig: number;                              // significant digits written (an integer's trailing zeros excluded)
  tz?: number;                              // trailing zeros of an integer
  band?: number;                            // "$190s": width of the band above mag
  allow?: "small" | "other";                // allow-listed (dropped from the output after range inheritance)
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const CURRENCY: Record<string, string> = { "US$": "$", "$": "$", "C$": "C$", "A$": "A$", "HK$": "HK$", "€": "€", "£": "£", "¥": "¥" };
// (1) "(" (2) sign (3) currency (4) sign after currency (5) integer (6) decimals (7) leading-dot decimals (8) ")" (9) scale
// (10) "%"/x/× (11) unit-word separator (12) unit word (13) decade "s"
const TOKEN = new RegExp(
  String.raw`(?<![A-Za-z'’$€£¥\d.])(\()?([+\-−]?)(US\$|C\$|A\$|HK\$|\$|€|£|¥)?(?:(?<=[$€£¥])[ \n])?([+\-−]?)(?:(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?|(?<=[$\s(])(\.\d+))(\))?` +
  String.raw`(?:((?:[ -]?(?:thousand|million|billion|trillion))|(?: ?(?:K|M|B|T|bn|mn|mm|tn))|(?:(?<=[$€£¥][ \n]?[+\-−]?[\d.,]+) ?(?:k|m|b)))(?![A-Za-z]))?` +
  String.raw`(?:([ \n]?%|[xX](?![A-Za-z])|×)|([\s-]?)(percentage[ -]points?|percent|per cent|ppts?|pp|pts?|points?|bps|bp|basis points?|times)(?![A-Za-z])|(s)(?![A-Za-z]))?`, "g");
const INDEX_BEFORE = /(^|[^A-Za-z])(S&P|Russell|Nasdaq|NASDAQ|Dow Jones|FTSE|STOXX|Stoxx|MSCI|Nikkei|Fortune|Global) ?$/;
const YEAR = /^(199\d|20[0-3]\d|2040)$/;
const MONTH = "(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sept?(ember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)";
const MONTH_BEFORE = new RegExp(`(^|[^A-Za-z])${MONTH}\\.? $`, "i");
const MONTH_AFTER = new RegExp(`^ ${MONTH}\\b`);
const LABEL_BEFORE = /(^|[^A-Za-z])(Note|Notes|Item|Items|Tier|Section|Rule|Phase|Schedule|Form|Class|Series|Level|Title|Chapter|Part|Article|ISO|Gen|Proposal|Exhibit|Regulation|Stage|Version|PDK|No\.|#)\s?$/;
const PERIOD_BEFORE = /(^|[^A-Za-z])(past|last|trailing|prior|next|previous|over the) $/i;

function unitKind(u: string | undefined): Kind | null {
  if (!u) return null;
  const s = u.trim().toLowerCase();
  if (s === "%" || s === "percent" || s === "per cent") return "pct";
  if (s === "x" || s === "×" || s === "times") return "mult";
  if (/^percentage[ -]point/.test(s) || s === "pp" || s.startsWith("ppt") || s === "pts" || s === "pt" || s.startsWith("point")) return "pp";
  if (s === "bps" || s === "bp" || s.startsWith("basis point")) return "bp";
  return null;
}

/** Allow-list for bare integers. "small" (≤12) is a prose-only rule; the index keeps small numbers. */
function allowed(text: string, start: number, end: number, int: string): false | "small" | "other" {
  const n = Number(int.replace(/,/g, ""));
  const before3 = text.slice(Math.max(0, start - 3), start);
  const before12 = text.slice(Math.max(0, start - 12), start);
  const after = text.slice(end, end + 12);
  if (/(^|[^A-Za-z])(Q|FY)$/.test(before3) || (/^'?\d{2}\b/.test(after) && /Q$/.test(before3))) return "other"; // Q3'26, FY24
  if (YEAR.test(int)) return "other";
  if (/^-[QK]\b/.test(after)) return "other";                                         // 10-Q, 10-K
  if (/^:\d/.test(after)) return "other";                                             // 10:1
  if (/^-(week|month|day|year|quarter)s?\b/i.test(after)) return "other";             // 52-week
  if (/^,? ?(19|20)\d\d\b/.test(after)) return "other";                               // August 30, 2026
  if (n >= 1 && n <= 31 && /(19|20)\d\d-(\d{1,2}-)?$/.test(text.slice(Math.max(0, start - 8), start))) return "other"; // 2026-08-30
  if (n >= 1 && n <= 31 && MONTH_BEFORE.test(before12)) return "other";               // December 31
  // S-7 additions
  if (n >= 1 && n <= 31 && MONTH_AFTER.test(after)) return "other";                   // 30 September 2026
  if (LABEL_BEFORE.test(before12)) return "other";                                    // Note 14, Item 1A, Tier 1, Section 232, Phase 3
  if (/[A-Za-z]-$/.test(text.slice(Math.max(0, start - 2), start))) return "other";   // FAST-41, COVID-19
  if (/^[A-Z](\/A)?(?![A-Za-z])/.test(after) && !/^[KMBT](?![A-Za-z])/.test(after)) return "other"; // 14A, 13G, 13G/A, 1A, 3D
  if (/^\/\d+-(week|month|day|year)/.test(after)) return "other";                     // 52/53-week
  if (INDEX_BEFORE.test(before12)) return "other";                                   // S&P 500, Russell 2000, Fortune 500
  if (/^\(k\)/i.test(after)) return "other";                                         // 401(k)
  if (n === 24 && /^\/7\b/.test(after)) return "other";                            // 24/7
  if (PERIOD_BEFORE.test(before12) && /^ (weeks|months|days|quarters)\b/.test(after)) return "other"; // the past 52 weeks
  return n <= 12 ? "small" : false;
}

export function tokens(text: string, mode: "prose" | "index" = "prose"): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    const [whole, open, sign1, cur, sign2, intRaw, fracRaw, dotFrac, close, scaleRaw, unitA, unitSep, unitWRaw, decade] = m;
    const int = intRaw ?? "0";
    const frac = fracRaw ?? dotFrac ?? "";
    let unitW = unitWRaw;
    const paren = !!open && !!close;
    let raw = whole, start = m.index;
    if (open && !close) { raw = raw.slice(1); start += 1; }
    if (close && !open) raw = raw.replace(/\)(?=[^)]*$)/, "");
    const scaleS = scaleRaw?.replace(/^[ -]/, "");
    // "February 17, 2026 point to" is a year, not 2,026 points; "met 4 times" is a count, not a multiple;
    // a hyphenated unit word is a unit only as "-percentage-point" ("a 10-point plan" is not 10 points)
    if (unitW && !frac && !cur && !scaleS && (YEAR.test(int) || (unitW === "times" && Number(int) <= 12))) unitW = undefined as unknown as string;
    if (unitW && unitSep === "-" && !/^percentage/i.test(unitW)) unitW = undefined as unknown as string;
    const dropped = unitWRaw && !unitW ? (unitSep ?? "").length + unitWRaw.length : 0;
    if (dropped) raw = raw.slice(0, raw.length - dropped);
    const unit = unitA ?? unitW;
    let kind: Kind = cur ? "money" : unitKind(unit) ?? "plain";
    if (cur && unitKind(unit) === "pct") kind = "pct";
    const end = m.index + whole.length - dropped;
    const bare = !cur && !frac && !scaleS && !unit;
    const why = bare ? allowed(text, start, end, int) : false;
    const sgnS = sign1 || sign2;
    // sign: explicit +/- (before or after the currency), or "(12.3)%"; "($24.99)" in prose is a parenthetical
    const sign: -1 | 0 | 1 = /[-−]/.test(sgnS) ? -1 : sgnS === "+" ? 1 : paren && unit?.trim() === "%" ? -1 : 0;
    const scale = scaleS ? SCALE[scaleS.toLowerCase()] : 1;
    const dp = frac ? frac.length - 1 : 0;
    // an integer's trailing zeros are ambiguous ("$500 million" may mean ±$0.5M or ±$50M); grounds() tries both readings
    const tz = frac ? 0 : (int.replace(/,/g, "").match(/[1-9](0+)$/)?.[1].length ?? 0);
    const abs = Number(int.replace(/,/g, "") + frac);
    const norm = kind === "bp" ? 0.01 : 1;
    const t: Tok = { raw: raw.trim(), index: start, end, kind, cur: kind === "money" ? CURRENCY[cur ?? "$"] : null,
      mag: abs * scale * norm, sign, dp, scale, tz, res: Math.pow(10, -dp) * scale * norm, sig: sigDigits(int, frac) };
    if (decade && !frac && !scaleS && !unit) {
      if (YEAR.test(int.replace(/0$/, "0"))) t.allow = "other";                       // the 1990s
      else t.band = Math.pow(10, (int.match(/0*$/)?.[0].length ?? 0)) * scale;       // $190s → [190, 200)
    }
    if (why && !(why === "small" && mode === "index") && !t.band) t.allow = why;
    out.push(t);
  }
  inherit(text, out);
  return out.filter((t) => !t.allow);
}

function sigDigits(int: string, frac: string): number {
  const digits = (int.replace(/,/g, "") + frac.replace(".", "")).replace(/^0+/, "");
  return Math.max(1, digits.length);
}
const numOf = (t: Tok) => t.mag / (t.scale * (t.kind === "bp" ? 0.01 : 1));

/** "40-50%", "$1.2–1.5B", "5 to 7 percent", "$350–600", "$415 to $455 million": a bare end inherits the other end's unit, scale and currency. */
function inherit(text: string, ts: Tok[]): void {
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1];
    const gap = text.slice(a.end, b.index);
    // "40-50%", "5 to 7 percent", and "between $8.15 and $8.25 billion" ("and" joins a range only after "between")
    const between = /^ and $/.test(gap) && /\bbetween $/i.test(text.slice(Math.max(0, a.index - 8), a.index));
    if (!/^\s?(?:[-–—]|to)\s?$/.test(gap) && !between) continue;
    if (a.allow === "other" || b.allow === "other") continue;          // a year, date, form or label never joins a range
    const aBare = a.kind === "plain" && a.scale === 1, bBare = b.kind === "plain" && b.scale === 1;
    const set = (t: Tok, kind: Kind, cur: string | null, scale: number) => {
      const v = numOf(t), norm = kind === "bp" ? 0.01 : 1;
      t.kind = kind; t.cur = cur; t.scale = scale; t.mag = v * scale * norm; t.res = Math.pow(10, -t.dp) * scale * norm; delete t.allow;
    };
    if (aBare && b.kind !== "plain") set(a, b.kind, b.cur, b.scale);                                        // 40-50%, 300-400 basis points
    else if (aBare && !bBare && b.kind === "plain") set(a, "plain", null, b.scale);                         // 1.2-1.5 million
    else if (a.kind === "money" && bBare && !b.allow && /^\s?[-–—]\s?$/.test(gap)) set(b, "money", a.cur, 1); // $350–600
    else if (a.kind === "money" && a.scale === 1 && b.kind === "plain" && b.scale !== 1) { set(a, "money", a.cur, b.scale); set(b, "money", a.cur, b.scale); } // $1.2–1.5B
    else if (a.kind === "money" && a.scale === 1 && b.kind === "money" && b.scale !== 1) set(a, "money", a.cur, b.scale); // $1.750 to $1.810 billion
  }
}

/* ------------------------------------------------------------------ index ------------------------------------------------------------------ */
export type Src = "facts" | "calls" | "judgment" | "context";
export interface Entry extends Tok { src: Src }

const TABLE_KIND: Record<CellFormat, { kind: Kind; scale: number }> = {
  usdB: { kind: "money", scale: 1e9 }, usdT: { kind: "money", scale: 1e12 }, pct: { kind: "pct", scale: 1 }, pctSigned: { kind: "pct", scale: 1 },
  mult: { kind: "mult", scale: 1 }, eps: { kind: "money", scale: 1 }, num2: { kind: "plain", scale: 1 }, num1: { kind: "plain", scale: 1 },
  usd0: { kind: "money", scale: 1 }, usd2: { kind: "money", scale: 1 },
};

/** Statement-table cells: unit and scale come from the row's format, the digits from formatCell — exactly the cell the author sees. */
export function tableEntries(tables: FinancialTable[]): Entry[] {
  const out: Entry[] = [];
  for (const t of tables) for (const r of t.rows) for (const v of r.values) {
    if (v == null) continue;
    if (typeof v === "string") { for (const tk of tokens(v, "index")) out.push({ ...tk, src: "facts", sign: tk.sign || 1 }); continue; }
    const s = formatCell(v, r.format);
    const { kind, scale } = TABLE_KIND[r.format];
    const mm = s.match(/^[+\-−]?\$?([\d,]+)(\.\d+)?/);
    if (!mm) continue;
    const dp = mm[2] ? mm[2].length - 1 : 0;
    const abs = Number(mm[1].replace(/,/g, "") + (mm[2] ?? ""));
    out.push({ raw: s, index: 0, end: 0, kind, cur: kind === "money" ? "$" : null, mag: abs * scale, sign: v < 0 ? -1 : 1, dp, scale,
      res: Math.pow(10, -dp) * scale, sig: sigDigits(mm[1], mm[2] ?? ""), src: "facts" });
  }
  return out;
}

/** Facts-block lines outside the tables. compactUSD/compactNum trim trailing zeros ("$27B" is 27.0 at 1 dp), so restore the formatter's precision. */
export function factsLineEntries(factsBlock: string): Entry[] {
  const out: Entry[] = [];
  for (const line of factsBlock.split("\n")) {
    if (line.startsWith("|")) continue;
    for (const t of tokens(line, "index")) {
      let { dp } = t;
      if (t.scale >= 1e6) dp = Math.max(dp, t.kind === "money" ? (t.scale === 1e12 ? 2 : 1) : 2);
      out.push({ ...t, dp, res: t.scale >= 1e6 ? Math.pow(10, -dp) * t.scale : t.res, src: "facts", sign: t.sign || 1 });
    }
  }
  return out;
}

/** Calls and judgment blocks are structured (sign known); context text is not (an unsigned "12%" may be a decline). */
export function textEntries(text: string, src: Src): Entry[] {
  const out: Entry[] = [];
  for (const t of tokens(text, "index")) {
    out.push({ ...t, src, sign: src === "context" ? t.sign : (t.sign || 1) });
    // a "%" on the next line of a shredded table may belong to a column header, so the cell is also indexed bare
    if (src === "context" && t.kind === "pct" && /\n%$/.test(t.raw) && t.scale === 1) out.push({ ...t, kind: "plain", src });
  }
  return out;
}

/* ------------------------------------------------------------------ matching ------------------------------------------------------------------ */
export interface Policy {
  ctxCoarsenSig: number;    // a prose figure may round a context figure only if it keeps ≥ this many significant digits
  surfCoarsenSig: number;   // ... a Facts/Calls/judgment figure: ≥ min(this, the source's own significant digits)
  wildMinSig: number;       // a bare context cell grounds a typed prose figure (any kind, table scales) only with ≥ this many sig digits
  checkSign: boolean;
  ppFromPct: boolean;       // "46.9 points" of growth grounded by a context "46.9%"
  multFromRatio: boolean;   // "17.26x current ratio" grounded by the Facts' "17.26"
  bands: boolean;           // "$190s"
  multWild: boolean;        // may a multiple ("22x") ground against a bare context cell? (no: multiples are not table cells)
  moneyCellMinSig: number;  // a scaled money figure ("$5 billion") grounds against an unscaled "$ 5" table cell only with ≥ this many sig digits
  secondReadingMinSig: number; // the trailing-zeros-insignificant reading only matches entries with ≥ this many sig digits
  bpFromPct: boolean;       // may basis points ground against a % level? (no)
  perShareNoScaleUp: boolean; // a 2-decimal context money cell ("$4.56", a per-share figure) is never scaled up to millions/billions
  wildMinSigPct: number;    // the wildcard floor for % and percentage-point prose (single-digit change cells: "(4)", "<1", "0.5")
}
export const POLICY: Policy = { ctxCoarsenSig: 3, surfCoarsenSig: 2, wildMinSig: 2, checkSign: true, ppFromPct: true, multFromRatio: true, bands: true, multWild: false, wildMinSigPct: 1, moneyCellMinSig: 1, bpFromPct: false, perShareNoScaleUp: true, secondReadingMinSig: 2 };

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const roundAt = (x: number, res: number) => Math.round(x / res + 1e-9 * Math.max(1, Math.abs(x / res)));

function kindOk(p: Tok, e: Entry, pol: Policy): boolean {
  switch (p.kind) {
    case "plain": return true;                                                        // a unitless prose number: any kind, by magnitude
    case "money": return (e.kind === "money" && e.cur === p.cur) || (e.src === "context" && e.kind === "plain" && e.scale >= 1e6); // never a Facts share count
    case "pct": return e.kind === "pct";
    case "mult": return e.kind === "mult" || (pol.multFromRatio && e.src === "facts" && e.kind === "plain" && e.dp > 0);
    case "pp": return e.kind === "pp" || e.kind === "bp" || (pol.ppFromPct && e.kind === "pct");
    case "bp": return e.kind === "pp" || e.kind === "bp" || (pol.bpFromPct && e.kind === "pct");   // "540 bps" is a change, not a 5.4% level
  }
}

export type MatchClass = "exact" | "lossless" | "coarse" | "band" | "none";

/** Compare magnitudes under the resolution rule. */
function compare(p: Tok, eMag: number, eRes: number, eSig: number, src: Src, pol: Policy): MatchClass {
  if (p.band != null) return eMag >= p.mag - 1e-9 && eMag < p.mag + p.band - 1e-9 ? "band" : "none";
  if (p.res < eRes * (1 - 1e-9)) return "none";                                     // prose may not be finer than the source
  if (near(p.res, eRes)) return roundAt(p.mag, p.res) === roundAt(eMag, p.res) ? "exact" : "none";
  if (roundAt(eMag, p.res) !== roundAt(p.mag, p.res)) return "none";
  if (near(roundAt(eMag, p.res) * p.res, eMag)) return "lossless";                   // "$495.00" → "$495", "$1,148 million" → "$1.148 billion"
  const floor = src === "context" ? pol.ctxCoarsenSig : Math.min(pol.surfCoarsenSig, eSig);
  return p.sig >= floor ? "coarse" : "none";
}

export function matchOne(p: Tok, e: Entry, pol: Policy): MatchClass {
  if (p.band != null && !pol.bands) return "none";
  if (pol.checkSign && p.sign !== 0 && e.sign !== 0 && p.sign !== e.sign) return "none";
  // A bare context cell ("15,955" under "(in millions)", "27.3" under "Percent change"): unit and scale sit in a header the
  // tokenizer cannot see, so it grounds a prose figure of any kind at any table scale — if the prose figure is specific enough.
  if (e.src === "context" && e.kind === "plain" && e.scale === 1) {
    if (p.kind === "plain" && p.scale === 1) return compare(p, e.mag, e.res, e.sig, e.src, pol);
    if (p.kind === "mult" && !pol.multWild) return "none";
    const floor = p.kind === "pct" || p.kind === "pp" || p.kind === "bp" ? pol.wildMinSigPct : pol.wildMinSig;
    if (p.sig < floor && p.band == null) return "none";
    const scales = p.kind === "money" || p.kind === "plain" ? [1, 1e3, 1e6, 1e9] : p.kind === "bp" ? [0.01] : [1];
    return best(scales.map((s) => compare(p, e.mag * s, e.res * s, e.sig, e.src, pol)));
  }
  // An unscaled money cell in context ("$\n15,955"): known kind, scale from a header.
  if (e.src === "context" && e.kind === "money" && e.scale === 1 && p.kind === "money" && e.cur === p.cur) {
    if (pol.perShareNoScaleUp && e.dp === 2 && p.scale !== 1) return compare(p, e.mag, e.res, e.sig, e.src, pol);
    if (p.scale === 1 || p.sig >= pol.moneyCellMinSig) return best([1, 1e3, 1e6, 1e9].map((s) => compare(p, e.mag * s, e.res * s, e.sig, e.src, pol)));
    return compare(p, e.mag, e.res, e.sig, e.src, pol);
  }
  if (!kindOk(p, e, pol)) return "none";
  return compare(p, e.mag, e.res, e.sig, e.src, pol);
}
const RANK: Record<MatchClass, number> = { exact: 4, lossless: 3, band: 2, coarse: 1, none: 0 };
const best = (cs: MatchClass[]) => cs.reduce((a, c) => (RANK[c] > RANK[a] ? c : a), "none" as MatchClass);

/** The readings of a prose figure: as written, and — for an integer with trailing zeros — with them insignificant. */
export function readings(p: Tok): Tok[] {
  if (!p.tz || p.band != null) return [p];
  return [p, { ...p, res: p.res * Math.pow(10, p.tz), sig: Math.max(1, p.sig - p.tz) }];
}

export function grounds(p0: Tok, entries: Entry[], pol: Policy = POLICY): { ok: boolean; cls: MatchClass; by?: Entry } {
  let r: { cls: MatchClass; by?: Entry } = { cls: "none" };
  readings(p0).forEach((p, i) => { for (const e of entries) {
    // the second (trailing-zeros-insignificant) reading may only match an entry with ≥2 significant digits: a 1-digit
    // $B Facts cell ("0.3") would otherwise vouch for every "$300 million" (round-number density, review rev. 2)
    if (i === 1 && e.sig < pol.secondReadingMinSig) continue;
    const c = matchOne(p, e, pol);
    if (RANK[c] > RANK[r.cls]) r = { cls: c, by: e };
    if (r.cls === "exact") break;
  } });
  return { ok: r.cls !== "none", ...r };
}

/* ------------------------------------------------------------------ diagnostics (prototype of Task 6) ------------------------------------------------------------------ */
export type MissReason = "sign" | "finer" | "rounding" | "short-cell" | "unit" | "none";
const isBareCell = (e: Entry) => e.src === "context" && e.kind === "plain" && e.scale === 1;

/** Why a figure missed: the first single relaxation under which it would ground. */
export function explain(p: Tok, entries: Entry[], pol: Policy = POLICY): { reason: MissReason; by?: Entry } {
  const tryWith = (q: Policy, es: Entry[] = entries, tok: Tok = p) => grounds(tok, es, q);
  let g = tryWith({ ...pol, checkSign: false });
  if (g.ok) return { reason: "sign", by: g.by };
  // finer than the surface: the prose rounded to the entry's resolution equals the entry
  for (const e of entries) {
    if (isBareCell(e) && p.kind !== "plain") continue;
    if (!(e.kind === p.kind || p.kind === "plain") || (p.kind === "money" && e.cur !== p.cur)) continue;
    if (e.mag !== 0 && p.res < e.res * (1 - 1e-9) && roundAt(p.mag, e.res) === roundAt(e.mag, e.res)) return { reason: "finer", by: e };
  }
  g = tryWith({ ...pol, surfCoarsenSig: 1, ctxCoarsenSig: 1 });
  if (g.ok) return { reason: "rounding", by: g.by };
  g = tryWith({ ...pol, wildMinSig: 1, wildMinSigPct: 1, perShareNoScaleUp: false });
  if (g.ok) return { reason: "short-cell", by: g.by };
  // the same written digits under another unit or scale, on a typed entry (a bare table cell is excluded: it has no unit to differ)
  const written = (t: Tok) => t.mag / (t.scale * (t.kind === "bp" ? 0.01 : 1));
  for (const e of entries) {
    if (isBareCell(e)) continue;
    // same written digits at the same precision; across kinds only for a specific figure (≥3 significant digits), never a coincidental "14"
    if (e.dp !== p.dp || !near(written(e), written(p))) continue;
    if ((e.kind === p.kind && e.scale !== p.scale) || (e.kind !== p.kind && p.kind !== "plain" && p.sig >= 3)) return { reason: "unit", by: e };
  }
  return { reason: "none" };
}

/** A grounded figure is "weak" when it grounds only through a path that cannot check its unit, scale or sign. */
export function weakness(p: Tok, entries: Entry[], pol: Policy = POLICY): null | "bare-cell" | "money-cell-scale-up" | "unsigned-context" {
  if (!grounds(p, entries, pol).ok) return null;
  const noBare = entries.filter((e) => !(isBareCell(e) && !(p.kind === "plain" && p.scale === 1)));
  if (!grounds(p, noBare, pol).ok) return "bare-cell";
  const noScaleUp = noBare.filter((e) => !(e.src === "context" && e.kind === "money" && e.scale === 1 && p.scale !== 1));
  if (!grounds(p, noScaleUp, pol).ok) return "money-cell-scale-up";
  if (p.sign !== 0 && !grounds(p, noScaleUp.filter((e) => !(e.src === "context" && e.sign === 0)), pol).ok) return "unsigned-context";
  return null;
}

```

### `corpus.ts`

```ts
// Shared loader: every judgment paired with its FactPack exactly as scripts/synth-build.ts pairs them
// (data/facts/<T>/<ACC>.json + data/judgment/<T>/<ACC>.json), plus the extraText validateJudgment passes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const R = "C:/Users/nicopc/Documents/juniresearch/";
import { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import { projectReportFacts } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/project";
import { Judgment } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/judgment.schema";
import { renderFactsBlock, renderContextBlock, renderCalls } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt";
import { renderJudgmentBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment";

import { Desk } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/desk.schema";
const DESK = Desk.parse(JSON.parse(readFileSync(R + "data/desk/desk.json", "utf8")));
export interface Case {
  ticker: string; accession: string; published: boolean;
  pack: FactPack; judgment: Judgment; facts: ReturnType<typeof projectReportFacts>;
  factsBlock: string; judgmentBlock: string; contextBlock: string; callsBlock: string;
}

import { execFileSync } from "node:child_process";
const git = (...a: string[]) => execFileSync("git", ["-C", R, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
/** The pack and judgment as committed with the report's last commit — what the reviewer saw. */
function atReportCommit(t: string, acc: string): { pack: string; judgment: string; commit: string } | null {
  const commit = git("log", "-1", "--format=%h", "--", `data/${t.toLowerCase()}.json`).trim();
  if (!commit) return null;
  try {
    return { commit, pack: git("show", `${commit}:data/facts/${t}/${acc}.json`), judgment: git("show", `${commit}:data/judgment/${t}/${acc}.json`) };
  } catch { return null; }
}

export function loadCorpus(mode: "head" | "report" = (process.env.PACK_AT as "head" | "report") ?? "head"): { cases: Case[]; skipped: string[] } {
  const cases: Case[] = [], skipped: string[] = [];
  const jdir = join(R, "data", "judgment");
  for (const t of readdirSync(jdir).sort()) {
    for (const f of readdirSync(join(jdir, t)).sort()) {
      if (!/^[0-9]{10}-[0-9]{2}-[0-9]{6}\.json$/.test(f)) continue; // judgment files only (skip .editorial/.errors/.prompt)
      const acc = f.replace(/\.json$/, "");
      const packPath = join(R, "data", "facts", t, `${acc}.json`);
      if (!existsSync(packPath)) { skipped.push(`${t}/${acc}: no pack`); continue; }
      const reportPath = join(R, "data", `${t.toLowerCase()}.json`);
      const published = existsSync(reportPath) && JSON.parse(readFileSync(reportPath, "utf8")).meta?.filing?.accession === acc;
      let packText = readFileSync(packPath, "utf8"), jText = readFileSync(join(jdir, t, f), "utf8");
      if (mode === "report") {
        if (!published) { skipped.push(`${t}/${acc}: not the published accession`); continue; }
        const at = atReportCommit(t, acc);
        if (!at) { skipped.push(`${t}/${acc}: no pack at report commit`); continue; }
        if (JSON.stringify(JSON.parse(at.judgment)) !== JSON.stringify(JSON.parse(jText))) skipped.push(`${t}/${acc}: NOTE judgment differs from report commit ${at.commit}`);
        packText = at.pack; jText = at.judgment;
      }
      const pack = FactPack.parse(JSON.parse(packText));
      const jp = Judgment.safeParse(JSON.parse(jText));
      if (!jp.success) { skipped.push(`${t}/${acc}: Judgment.parse failed`); continue; }
      const facts = projectReportFacts(pack);
      cases.push({ ticker: t, accession: acc, published, pack, judgment: jp.data, facts,
        factsBlock: renderFactsBlock(facts, pack), judgmentBlock: renderJudgmentBlock(jp.data, pack.quote.price), contextBlock: renderContextBlock(pack), callsBlock: renderCalls(DESK.rating) });
    }
  }
  return { cases, skipped };
}

```

### `current.ts`

```ts
import { loadCorpus } from "./corpus";
import { buildAllowedIndex, checkGrounding, numericTokens } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";

const { cases, skipped } = loadCorpus();
let tokens = 0, fails = 0;
const byKind: Record<string, number> = {};
for (const c of cases) {
  const idx = buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock]);
  for (const { text } of stringLeaves(c.judgment)) for (const t of numericTokens(text)) { tokens++; byKind[t.kind] = (byKind[t.kind] ?? 0) + 1; }
  const issues = checkGrounding(c.judgment, idx);
  fails += issues.length;
  if (issues.length) console.log(`${c.ticker} ${c.accession} ${c.published ? "PUB" : "old"}: ${issues.map((i) => `${i.field}=${i.value}`).join("; ")}`);
}
console.log({ cases: cases.length, published: cases.filter((c) => c.published).length, skipped, tokens, byKind, fails });

```

### `measure.ts`

```ts
import { writeFileSync } from "node:fs";
import { loadCorpus, type Case } from "./corpus";
import { tokens, tableEntries, factsLineEntries, textEntries, grounds, POLICY, type Policy, type Entry } from "./proto";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";
import { buildAllowedIndex, checkGrounding, numericTokens } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";

export function entriesFor(c: Pick<Case, "facts" | "factsBlock" | "judgmentBlock" | "contextBlock" | "callsBlock">, parts = { facts: true, calls: true, judgment: true, context: true }): Entry[] {
  const f = c.facts.sections.financials;
  return [
    ...(parts.facts ? [...tableEntries([f.income, f.balance, f.cashflow]), ...factsLineEntries(c.factsBlock)] : []),
    ...(parts.calls ? textEntries(c.callsBlock, "calls") : []),
    ...(parts.judgment ? textEntries(c.judgmentBlock, "judgment") : []),
    ...(parts.context ? textEntries(c.contextBlock, "context") : []),
  ];
}

const VARIANTS: Record<string, Policy> = {
  "P proposed": POLICY,
  "P1 ctxCoarsenSig 2": { ...POLICY, ctxCoarsenSig: 2 },
  "P2 ctxCoarsenSig 4": { ...POLICY, ctxCoarsenSig: 4 },
  "P3 surfCoarsenSig 1": { ...POLICY, surfCoarsenSig: 1 },
  "P4 wildMinSig 1 (all kinds)": { ...POLICY, wildMinSig: 1, wildMinSigPct: 1 },
  "P5 wildMinSig 3": { ...POLICY, wildMinSig: 3 },
  "P6 no sign check": { ...POLICY, checkSign: false },
  "P7 no pp←pct": { ...POLICY, ppFromPct: false },
  "P8 no mult←ratio": { ...POLICY, multFromRatio: false },
  "P9 no bands": { ...POLICY, bands: false },
  "P10 mult wildcard ON": { ...POLICY, multWild: true },
  "P11 wildMinSigPct 2": { ...POLICY, wildMinSigPct: 2 },
  "P12 moneyCellMinSig 2": { ...POLICY, moneyCellMinSig: 2 },
  "P13 bp←pct ON": { ...POLICY, bpFromPct: true },
  "P14 per-share cells may scale up (M1' off)": { ...POLICY, perShareNoScaleUp: false },
};

if (process.argv[1]?.endsWith("measure.ts")) {
  const { cases } = loadCorpus();
  const pub = cases.filter((c) => c.published);
  let curTokens = 0, curFails = 0, protoTokens = 0;
  const fails: Record<string, { t: string; acc: string; field: string; raw: string; kind: string; text: string }[]> = {};
  const classes: Record<string, number> = {};
  const bySrc: Record<string, number> = {};
  const loose: string[] = [];
  for (const c of pub) {
    curFails += checkGrounding(c.judgment, buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock])).length;
    const entries = entriesFor(c);
    for (const { path, text } of stringLeaves(c.judgment)) {
      curTokens += numericTokens(text).length;
      for (const p of tokens(text)) {
        protoTokens++;
        for (const [name, pol] of Object.entries(VARIANTS)) {
          const g = grounds(p, entries, pol);
          if (name === "P proposed") { classes[g.cls] = (classes[g.cls] ?? 0) + 1; if (g.by) bySrc[g.by.src] = (bySrc[g.by.src] ?? 0) + 1; if (g.cls === "band" || g.cls === "coarse") loose.push(`${g.cls} ${c.ticker} ${JSON.stringify(p.raw)} <= ${g.by!.src}:${JSON.stringify(g.by!.raw)} | ${text.slice(Math.max(0, p.index - 50), p.end + 20).replace(/\s+/g, " ")}`); }
          if (!g.ok) (fails[name] ??= []).push({ t: c.ticker, acc: c.accession, field: path, raw: p.raw, kind: p.kind, text: text.slice(Math.max(0, p.index - 90), p.end + 40).replace(/\s+/g, " ") });
        }
      }
    }
  }
  console.log(`published=${pub.length} currentTokens=${curTokens} currentFails=${curFails} protoTokens=${protoTokens} (PACK_AT=${process.env.PACK_AT ?? "head"})`);
  console.log("proposed: match class", classes, "grounded by source", bySrc);
  for (const name of Object.keys(VARIANTS)) {
    const f = fails[name] ?? [];
    const byKind: Record<string, number> = {};
    for (const x of f) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    console.log(`${name}: ${f.length} fails in ${new Set(f.map((x) => x.t)).size} reports`, byKind);
  }
  writeFileSync("C:/Users/nicopc/AppData/Local/Temp/claude/C--Users-nicopc-Documents-juniresearch/63a937f0-f812-4b73-91d1-14b72f7bdb18/scratchpad/loose.txt", loose.join("\n"));
  writeFileSync(process.env.OUT ?? "C:/Users/nicopc/AppData/Local/Temp/claude/C--Users-nicopc-Documents-juniresearch/63a937f0-f812-4b73-91d1-14b72f7bdb18/scratchpad/fails.json", JSON.stringify(fails, null, 1));
}

```

### `drift.ts`

```ts
import { readFileSync } from "node:fs";
import { loadCorpus } from "./corpus";
import { buildAllowedIndex, checkGrounding } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";
const S = "C:/Users/nicopc/AppData/Local/Temp/claude/C--Users-nicopc-Documents-juniresearch/63a937f0-f812-4b73-91d1-14b72f7bdb18/scratchpad/";
const head = JSON.parse(readFileSync(S + "fails-head.json", "utf8"))["P proposed"] as { t: string; field: string; raw: string; text: string }[];
const rep = JSON.parse(readFileSync(S + "fails-report.json", "utf8"))["P proposed"] as { t: string; field: string; raw: string; text: string }[];
const k = (x: { t: string; field: string; raw: string; text: string }) => `${x.t}|${x.field}|${x.raw}|${x.text}`;
const repSet = new Set(rep.map(k));
const { cases } = loadCorpus("head");
const curHead = new Set<string>();
for (const c of cases.filter((x) => x.published)) for (const i of checkGrounding(c.judgment, buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock]))) curHead.add(`${c.ticker}|${i.field}|${i.value}`);
const extra = head.filter((x) => !repSet.has(k(x)));
const both = extra.filter((x) => curHead.has(`${x.t}|${x.field}|${x.raw}`));
const only = extra.filter((x) => !curHead.has(`${x.t}|${x.field}|${x.raw}`));
const byT = (xs: typeof head) => Object.entries(xs.reduce((a, x) => ((a[x.t] = (a[x.t] ?? 0) + 1), a), {} as Record<string, number>)).map(([t, n]) => `${t}:${n}`).join(" ");
console.log(`HEAD proposed fails ${head.length}; also at report packs ${head.length - extra.length}; drift-only ${extra.length} (also failed by current lint at HEAD: ${both.length}; new-lint only: ${only.length})`);
console.log("drift, both lints:", byT(both));
console.log("drift, new lint only:", byT(only));
for (const x of only) console.log("  ", x.t, JSON.stringify(x.raw), x.field, "|", x.text.slice(40, 150));
const missing = [...curHead].filter((s) => !head.some((x) => `${x.t}|${x.field}|${x.raw}` === s));
console.log(`current-lint HEAD fails that the new lint passes: ${missing.length}`, missing.slice(0, 20));

```

### `silentdrift.ts`

```ts
import { loadCorpus } from "./corpus";
import { renderFactsBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt";
const rep = loadCorpus("report").cases, head = loadCorpus("head").cases.filter((c) => c.published);
const lint = new Set(["BAM","CAT","CRWD","EXFY","ICE","INTU","MPWR","MQ","RDVT","VRT"]);
const changed: string[] = [];
for (const r of rep) { const h = head.find((x) => x.ticker === r.ticker)!; if (r.factsBlock !== h.factsBlock || r.contextBlock !== h.contextBlock) changed.push(r.ticker + (lint.has(r.ticker) ? "*" : "") + (r.contextBlock !== h.contextBlock ? "(ctx)" : "")); }
console.log(`published reports whose rendered Facts/Context differ between build-time and HEAD: ${changed.length}`, changed.join(" "));

```

### `reasons.ts`

```ts
// R-5 / R-4: the reason each prototype miss carries, and the per-report "weakly grounded" counts.
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds, explain, weakness } from "./proto";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";
const pub = loadCorpus().cases.filter((c) => c.published);
const ASSUMED = /^sections\.valuation\.(scenarios\[\d+\]\.driver|scenarioCommentary)$/;
let errs = 0, warns = 0; const errReports = new Set<string>(), warnReports = new Set<string>();
const weak: Record<string, number> = {}; const weakPer: number[] = []; let weakTotal = 0;
for (const c of pub) {
  const e = entriesFor(c); let w = 0;
  for (const { path, text } of stringLeaves(c.judgment)) for (const p of tokens(text)) {
    const g = grounds(p, e);
    if (!g.ok) {
      const x = explain(p, e);
      const anyWhereWarn = x.reason === "none" && (p.kind === "mult" || p.kind === "pct");
      const locWarn = anyWhereWarn && ASSUMED.test(path);
      if (process.env.ANYWHERE ? anyWhereWarn : locWarn) { warns++; warnReports.add(c.ticker); } else { errs++; errReports.add(c.ticker); }
      console.log(`${c.ticker} ${path.replace("sections.", "")} ${JSON.stringify(p.raw)} reason=${x.reason}${x.by ? ` by ${x.by.src}:${JSON.stringify(x.by.raw)}` : ""} → ${(process.env.ANYWHERE ? anyWhereWarn : locWarn) ? "WARNING (assumed figure)" : "ERROR"}`);
    } else {
      const k = weakness(p, e);
      if (k) { weak[k] = (weak[k] ?? 0) + 1; w++; weakTotal++; }
    }
  }
  weakPer.push(w);
}
weakPer.sort((a, b) => a - b);
console.log(`\nrescoped D2 (${process.env.ANYWHERE ? "reason=none, mult/pct, any field" : "reason=none, mult/pct, scenario fields"}): errors ${errs} in ${errReports.size} reports [${[...errReports].join(" ")}]; warnings ${warns} in ${warnReports.size} [${[...warnReports].join(" ")}]`);
console.log(`weakly grounded: ${weakTotal} figures`, weak, `per report: median ${weakPer[Math.floor(weakPer.length / 2)]}, mean ${(weakTotal / weakPer.length).toFixed(1)}, max ${weakPer.at(-1)}, reports with any ${weakPer.filter((x) => x > 0).length}`);

```

### `need2nd.ts`

```ts
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";
for (const c of loadCorpus().cases.filter((x) => x.published)) { const E = entriesFor(c);
  for (const { path, text } of stringLeaves(c.judgment)) for (const p of tokens(text)) {
    if (!p.tz) continue; const g = grounds(p, E), g0 = grounds({ ...p, tz: 0 }, E);
    if (g.ok && !g0.ok) console.log(c.ticker, path, JSON.stringify(p.raw), "<=", g.by!.src, JSON.stringify(g.by!.raw), g.cls, "sig", g.by!.sig); } }

```

### `tr-check.ts`

```ts
import { tokens, grounds, textEntries, tableEntries, type Entry } from "./proto";
const tbl = (fmt: string, v: number) => tableEntries([{ title: "t", columns: ["FY25"], rows: [{ label: "r", values: [v], format: fmt }] }] as never);
const C: [string, Entry[]][] = [
  ["$500 million", textEntries("revenue of $0.50 billion", "context")],
  ["$500 million", tbl("usdB", 5e8)],
  ["$63,900 million", tbl("usdB", 63.9e9)],
  ["50 bps", textEntries("up 0.50 percentage points", "context")],
  ["50 bps", textEntries("up 0.5 percentage points", "context")],
  ["40%", tbl("pct", 0.401)],
  ["$300 million", tbl("usdB", 3e8)],
];
for (const [p, e] of C) console.log(p.padEnd(16), "vs", JSON.stringify(e.map((x) => x.raw)), "→", tokens(p).every((t) => grounds(t, e).ok) ? "PASS" : "FAIL");

```

### `probes.ts`

```ts
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds, POLICY, type Policy } from "./proto";
import { buildAllowedIndex, checkGrounding } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";

const { cases } = loadCorpus();
const c = cases.find((x) => x.ticker === (process.env.T ?? "AVGO") && x.published)!;
const stripped = { ...c.pack, context: { description: { ...c.pack.context.description, text: "" }, mdaExcerpt: null, riskFactorsExcerpt: null, riskFactorsSource: null, pressRelease: null, proxyStatement: null, transcriptHighlights: null, headlines: [] } };

const S1 = ["$63.9 million", "$63.9M", "$63.9K", "$63.9T", "63.9 thousand", "63.9%", "63.9x", "$63.9", "477%", "$477", "477x", "4.77%", "600%", "$6", "250%", "$250"];
const steps5 = Array.from({ length: 19 }, (_, i) => `${(i + 1) * 5}%`);
const S2 = [...steps5, "1.5x", "2x", "3x", "5x", "10x", "20x", "50x",
  "$1B", "$2B", "$5B", "$10B", "$20B", "$50B", "$100B", "$200B", "$500B", "$1T", "$100", "$200", "$500",
  ...[1, 3, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97].map((n) => `${n}%`),
  "0.1%", "0.5%", "0.3%", "0.9%", "4.2x", "7.3x", "9.9x", "12.4x", "15.5x", "25.1x", "$0.01", "$1.00", "$2.50", "$7.77",
  "17", "23", "150", "1,000", "2,500", "33.3", "$1.5bn", "40 bps", "150bp", "63.9 percent", "$3.3B", "12.5%"];
const CONTROLS = ["$63.9B", "$64B", "$4.77", "2.50", "44.9x", "86%", "+85.5%", "$509.61", "$510", "$1.72T", "67.8%", "-$623M", "$11.63", "0.70%", "$21.7 billion", "221%", "Buy 54 and Hold 6 among 60 analysts"];

function run(label: string, probes: string[], withContext: boolean, pol: Policy) {
  const src = withContext ? c : { ...c, contextBlock: "" };
  const entries = entriesFor(src);
  const curIdx = buildAllowedIndex(withContext ? c.pack : stripped, [c.factsBlock, c.judgmentBlock]);
  let cur = 0, proto = 0;
  const passedProto: string[] = [], failedControls: string[] = [];
  for (const s of probes) {
    const curOk = checkGrounding({ p: s }, curIdx).length === 0;
    const toks = tokens(s);
    const protoOk = toks.length > 0 && toks.every((t) => grounds(t, entries, pol).ok);
    if (curOk) cur++;
    if (protoOk) { proto++; passedProto.push(s); } else failedControls.push(s);
  }
  return { label, n: probes.length, cur, proto, passedProto, failedControls };
}

const variants: Record<string, Policy> = { proposed: POLICY, "wildMinSig 1": { ...POLICY, wildMinSig: 1 }, "ctxCoarsenSig 2": { ...POLICY, ctxCoarsenSig: 2 }, "surfCoarsenSig 1": { ...POLICY, surfCoarsenSig: 1 } };
for (const [vn, pol] of Object.entries(variants)) {
  const a = run("S-1 (context stripped)", S1, false, pol);
  const b = run("S-2 (full index)", S2, true, pol);
  const d = run("controls (full index)", CONTROLS, true, pol);
  console.log(`\n### ${c.ticker} · ${vn}`);
  console.log(`${a.label}: current ${a.cur}/${a.n} pass, prototype ${a.proto}/${a.n} pass ${a.passedProto.length ? "→ " + a.passedProto.join(", ") : ""}`);
  console.log(`${b.label}: current ${b.cur}/${b.n} pass, prototype ${b.proto}/${b.n} pass → ${b.passedProto.join(", ")}`);
  console.log(`${d.label}: current ${d.cur}/${d.n}, prototype ${d.proto}/${d.n}${d.failedControls.length ? " — FAILED: " + d.failedControls.join(", ") : ""}`);
}

```

### `probes2.ts`

```ts
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
import { buildAllowedIndex, checkGrounding } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";
const c = loadCorpus().cases.find((x) => x.ticker === "AVGO" && x.published)!;
const e = entriesFor(c), idx = buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock]);
const sets: Record<string, string[]> = {
  "should FAIL (sign / per-share vs aggregate / unit)": ["-23.9%", "-86%", "+$6.3B of buybacks", "-$63.9B", "$4.77B", "$4.77 million", "4.77x", "44.9%", "$44.9", "1.98x", "$509.61 million", "$1,722.2B"],
  "should PASS (sign dropped, scale converted losslessly, own calls)": ["23.9%", "+23.9%", "$6.3B of buybacks", "-$6.3B", "$623M", "capex of $0.6B", "$400 to $500", "+10.5% to +38.1%", "0.70x", "$1.72T", "30%"],
};
for (const [name, ps] of Object.entries(sets)) {
  console.log(`\n${name}`);
  for (const s of ps) {
    const cur = checkGrounding({ p: s }, idx).length === 0;
    const pr = tokens(s).every((t) => grounds(t, e).ok);
    console.log(`  ${s.padEnd(22)} current ${cur ? "PASS" : "fail"}  proposed ${pr ? "PASS" : "fail"}`);
  }
}

```

### `probes-golden.ts`

```ts
// The AVGO probe battery against the surface the unit tests will build: the AVGO pack + the golden judgment fixture.
import { readFileSync } from "node:fs";
import { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import { projectReportFacts } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/project";
import { Judgment } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/judgment.schema";
import { Desk } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/desk.schema";
import { renderFactsBlock, renderContextBlock, renderCalls } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt";
import { renderJudgmentBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
const R = "C:/Users/nicopc/Documents/juniresearch/";
const pack = FactPack.parse(JSON.parse(readFileSync(R + "data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const j = Judgment.parse(JSON.parse(readFileSync(R + "lib/__fixtures__/avgo-golden-judgment.json", "utf8")));
const desk = Desk.parse(JSON.parse(readFileSync(R + "data/desk/desk.json", "utf8")));
const facts = projectReportFacts(pack);
const surf = { facts, factsBlock: renderFactsBlock(facts, pack), judgmentBlock: renderJudgmentBlock(j, pack.quote.price), contextBlock: renderContextBlock(pack), callsBlock: renderCalls(desk.rating) };
const S1 = ["$63.9 million", "$63.9M", "$63.9K", "$63.9T", "63.9 thousand", "63.9%", "63.9x", "$63.9", "477%", "$477", "477x", "4.77%", "600%", "$6", "250%", "$250"];
const steps5 = Array.from({ length: 19 }, (_, i) => `${(i + 1) * 5}%`);
const S2 = [...steps5, "1.5x", "2x", "3x", "5x", "10x", "20x", "50x", "$1B", "$2B", "$5B", "$10B", "$20B", "$50B", "$100B", "$200B", "$500B", "$1T", "$100", "$200", "$500",
  ...[1, 3, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97].map((n) => `${n}%`),
  "0.1%", "0.5%", "0.3%", "0.9%", "4.2x", "7.3x", "9.9x", "12.4x", "15.5x", "25.1x", "$0.01", "$1.00", "$2.50", "$7.77", "17", "23", "150", "1,000", "2,500", "33.3", "$1.5bn", "40 bps", "150bp", "63.9 percent", "$3.3B", "12.5%"];
const run = (ps: string[], ctx: boolean) => { const e = entriesFor(ctx ? surf : { ...surf, contextBlock: "" }); const pass = ps.filter((s) => tokens(s).length > 0 && tokens(s).every((t) => grounds(t, e).ok)); return pass; };
const a = run(S1, false), b = run(S2, true);
console.log(`golden surface — S-1 (no context): ${a.length}/${S1.length} pass ${a.join(", ")}`);
console.log(`golden surface — S-2 (full): ${b.length}/${S2.length} pass`);
console.log(`S-2 must-fail subset (odd decimals, unit edges):`, ["0.1%", "0.3%", "0.9%", "4.2x", "7.3x", "9.9x", "12.4x", "15.5x", "25.1x", "$0.01", "$1.00", "$2.50", "$7.77", "1,000", "2,500", "33.3", "40 bps", "150bp", "63.9 percent", "$3.3B", "12.5%"].filter((s) => b.includes(s)));
const CONTROLS = ["$63.9B", "$64B", "$4.77", "2.50", "44.9x", "86%", "+85.5%", "$509.61", "$510", "$1.72T", "67.8%", "-$623M", "$11.63", "0.70%", "$21.7 billion", "221%", "Buy 54 and Hold 6 among 60 analysts"];
const MUST_FAIL = ["-23.9%", "+$6.3B of buybacks", "4.77x", "44.9%", "$44.9", "$509.61 million", "$1,722.2B"];
const full = entriesFor(surf);
const ok = (s: string) => tokens(s).length > 0 && tokens(s).every((t) => grounds(t, full).ok);
console.log(`golden surface — controls pass ${CONTROLS.filter(ok).length}/${CONTROLS.length}; must-fail set passes ${MUST_FAIL.filter(ok).length}/${MUST_FAIL.length}`, CONTROLS.filter((s) => !ok(s)), MUST_FAIL.filter(ok));

```

### `s1full.ts`

```ts
// Reviewer probe: the S-1 transformation list applied to each pack's own revenue and EPS, WITH context (as production runs),
// plus how many corpus tokens ground only through the bare-cell wildcard.
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";
const { cases } = loadCorpus();
const pub = cases.filter((c) => c.published);
let n = 0, pass = 0, nNo = 0, passNo = 0; const per: Record<string, [number, number]> = {};
let wild = 0, wildNonPlain = 0, total = 0, moneyCell = 0;
for (const c of pub) {
  const ents = entriesFor(c), noCtx = entriesFor({ ...c, contextBlock: "" });
  const rev = c.pack.statements.income.find((r) => r.key === "revenue")?.values.filter((x): x is number => typeof x === "number").pop();
  const eps = c.pack.statements.income.find((r) => r.key === "epsDiluted")?.values.filter((x): x is number => typeof x === "number").pop();
  if (rev == null || eps == null) continue;
  const R = (rev / 1e9).toFixed(1), E = Math.abs(eps).toFixed(2), E100 = Math.round(Math.abs(eps) * 100);
  const probes: Record<string, string> = { "$R million": `$${R} million`, "$RM": `$${R}M`, "$RK": `$${R}K`, "$RT": `$${R}T`, "R%": `${R}%`, "Rx": `${R}x`, "$R": `$${R}`,
    "E00%": `${E100}%`, "$E00": `$${E100}`, "E00x": `${E100}x`, "E%": `${E}%`, "$E billion": `$${E} billion`, "$E million": `$${E} million` };
  for (const [k, s] of Object.entries(probes)) {
    if ([c.factsBlock, c.contextBlock, c.judgmentBlock].some((t) => t.includes(s))) continue;
    const tk = tokens(s); if (!tk.length) continue;
    const ok = tk.every((t) => grounds(t, ents).ok), okNo = tk.every((t) => grounds(t, noCtx).ok);
    n++; if (ok) pass++; nNo++; if (okNo) passNo++;
    const p = (per[k] ??= [0, 0]); p[0]++; if (ok) p[1]++;
  }
  for (const { text } of stringLeaves(c.judgment)) for (const p of tokens(text)) {
    total++; const g = grounds(p, ents);
    if (g.ok && g.by?.src === "context" && g.by.kind === "plain" && g.by.scale === 1) { wild++; if (p.kind !== "plain") wildNonPlain++; }
    if (g.ok && g.by?.src === "context" && g.by.kind === "money" && g.by.scale === 1 && p.scale > 1) moneyCell++;
  }
}
console.log(`S-1-style probes over ${pub.length} packs: with context ${pass}/${n} (${(100 * pass / n).toFixed(1)}%) pass; context stripped ${passNo}/${nNo} (${(100 * passNo / nNo).toFixed(1)}%)`);
for (const [k, [a, b]] of Object.entries(per)) console.log(`  ${k}: ${b}/${a}`);
console.log(`corpus tokens ${total}; grounded via bare context cell ${wild} (non-plain prose ${wildNonPlain}); via unscaled money cell scaled up ${moneyCell}`);

```

### `random-d3.ts`

```ts
// False-accept rate: random figures of each form, checked against every published pack's index (seeded, reproducible).
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds, POLICY, type Policy } from "./proto";
import { buildAllowedIndex, checkGrounding } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";

let seed = 20261007;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// the round-number rows use their own stream so the original nine rows keep seed 20261007's sequence
let seed2 = 20261008;
const rnd2 = () => ((seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (lo: number, hi: number, dp: number) => (lo + rnd() * (hi - lo)).toFixed(dp);
const FORMS: Record<string, () => string> = {
  "N.N%": () => `${pick(0.1, 99.9, 1)}%`,
  "N% (int)": () => `${Math.floor(1 + rnd() * 99)}%`,
  "N.Nx": () => `${pick(1, 60, 1)}x`,
  "Nx (int)": () => `${Math.floor(2 + rnd() * 59)}x`,
  "$N.NB": () => `$${pick(1, 99.9, 1)}B`,
  "$N,NNN million": () => `$${Math.floor(1000 + rnd() * 9000).toLocaleString("en-US")} million`,
  "$NN.NN": () => `$${pick(1, 99.99, 2)}`,
  "$N (int)": () => `$${Math.floor(1 + rnd() * 9)}`,
  "NNN bps": () => `${Math.floor(1 + rnd() * 99) * 10} bps`,
  "$N00 million": () => `$${1 + Math.floor(rnd2() * 9)}00 million`,
  "$N,000 million": () => `$${1 + Math.floor(rnd2() * 9)},000 million`,
  "$0.NB": () => `$0.${1 + Math.floor(rnd2() * 9)}B`,
};
const N = Number(process.env.N ?? 20);
const { cases } = loadCorpus();
const pub = cases.filter((c) => c.published);
const variants: Record<string, Policy> = { proposed: POLICY, "surf1": { ...POLICY, surfCoarsenSig: 1 }, "wildcard floor 1 (money/plain)": { ...POLICY, wildMinSig: 1 }, "mult wildcard on": { ...POLICY, multWild: true }, "bp←pct on": { ...POLICY, bpFromPct: true }, "M1' off": { ...POLICY, perShareNoScaleUp: false }, "2nd reading unrestricted": { ...POLICY, secondReadingMinSig: 0 } };
const res: Record<string, Record<string, number>> = {};
for (const c of pub) {
  const curIdx = buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock]);
  const entries = entriesFor(c);
  for (const [form, gen] of Object.entries(FORMS)) for (let i = 0; i < N; i++) {
    const s = gen();
    const r = (res[form] ??= { n: 0, current: 0 });
    r.n++;
    if (checkGrounding({ p: s }, curIdx).length === 0) r.current++;
    const toks = tokens(s);
    for (const [vn, pol] of Object.entries(variants)) if (toks.length && toks.every((t) => grounds(t, entries, pol).ok)) r[vn] = (r[vn] ?? 0) + 1;
  }
}
const cols = ["current", ...Object.keys(variants)];
console.log(`random probes: ${N} per form per pack × ${pub.length} packs (seed 20261007) — share of random figures each lint ACCEPTS`);
console.log(`| form | ${cols.join(" | ")} |\n|---|${cols.map(() => "---").join("|")}|`);
const ROUND = new Set(["$N00 million", "$N,000 million", "$0.NB"]);
const tot: Record<string, number> = { n: 0 };
for (const [form, r] of Object.entries(res)) {
  console.log(`| ${form} | ${cols.map((k) => `${(100 * (r[k] ?? 0) / r.n).toFixed(1)}%`).join(" | ")} |`);
  if (ROUND.has(form)) continue;
  tot.n += r.n; for (const k of cols) tot[k] = (tot[k] ?? 0) + (r[k] ?? 0);
}
console.log(`| all (original nine forms) | ${cols.map((k) => `${(100 * tot[k] / tot.n).toFixed(1)}%`).join(" | ")} |`);

```

### `attacks.ts`

```ts
// Reviewer probe: realistic invented-number attacks per pack, prototype vs current lint, plus a "cell-only wildcard" mitigation.
import { loadCorpus, type Case } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds as g0, POLICY, type Entry, type Tok } from "./proto";
const grounds = (t: Tok, e: Entry[]) => g0(t, e, process.env.M1P ? { ...POLICY, perShareNoScaleUp: true } : POLICY);
import { buildAllowedIndex, checkGrounding } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";

const { cases } = loadCorpus();
const pub = cases.filter((c) => c.published);
const f1 = (x: number) => x.toFixed(1);
const lastNum = (vs: (number | string | null)[]) => { for (let i = vs.length - 1; i >= 0; i--) if (typeof vs[i] === "number") return { v: vs[i] as number, i }; return null; };
const row = (c: Case, key: string) => [...c.pack.statements.income, ...c.pack.statements.balance, ...c.pack.statements.cashflow].find((r) => r.key === key)?.values ?? [];

/** Mitigation: a bare context cell may act as the wildcard only if it stands on its own line (a shredded table cell). */
function cellOnly(entries: Entry[], ctx: string): Entry[] {
  return entries.filter((e) => {
    if (!(e.src === "context" && e.kind === "plain" && e.scale === 1)) return true;
    const ls = ctx.lastIndexOf("\n", e.index - 1) + 1; let le = ctx.indexOf("\n", e.end); if (le < 0) le = ctx.length;
    const line = ctx.slice(ls, le).trim();
    return /^[(<$\-−+]*\s*[\d.,]+\s*[)%]*$/.test(line);
  });
}

type Gen = (c: Case) => string[];
const ATTACKS: Record<string, Gen> = {
  "Facts $B → million (scale swap)": (c) => { const r = lastNum(row(c, "revenue")); return r ? [`$${f1(r.v / 1e9)} million`] : []; },
  "Facts $B → $X,XXX million at false precision": (c) => { const r = lastNum(row(c, "revenue")); return r ? [`$${Math.round(r.v / 1e6).toLocaleString("en-US")} million`] : []; },
  "EPS as aggregate ($E billion)": (c) => { const r = lastNum(row(c, "epsDiluted")); return r ? [`$${Math.abs(r.v).toFixed(2)} billion`] : []; },
  "EPS as aggregate ($E million)": (c) => { const r = lastNum(row(c, "epsDiluted")); return r ? [`$${Math.abs(r.v).toFixed(2)} million`] : []; },
  "TTM P/E written as % ": (c) => (c.pack.ttm.pe ? [`${f1(c.pack.ttm.pe)}%`] : []),
  "Quarter YoY written as x": (c) => (c.pack.latestQuarter.revenueYoY != null ? [`${f1(Math.abs(c.pack.latestQuarter.revenueYoY * 100))}x`] : []),
  "sign flip on quarter YoY (signed)": (c) => { const y = c.pack.latestQuarter.revenueYoY; return y != null && Math.abs(y) > 0.001 ? [`${y > 0 ? "-" : "+"}${f1(Math.abs(y * 100))}%`] : []; },
  "computed 3y revenue CAGR 1dp": (c) => { const v = row(c, "revenue").filter((x): x is number => typeof x === "number"); if (v.length < 4) return []; const a = v[v.length - 4], b = v[v.length - 1]; return a > 0 ? [`${f1((Math.pow(b / a, 1 / 3) - 1) * 100)}%`] : []; },
  "computed capex/revenue 1dp": (c) => { const r = lastNum(row(c, "revenue")), k = lastNum(row(c, "capex")); return r && k && r.v ? [`${f1(Math.abs(k.v / r.v) * 100)}%`] : []; },
  "computed buybacks/FCF 1dp": (c) => { const b = lastNum(row(c, "buybacks")), f = lastNum(row(c, "freeCashFlow")); return b && f && f.v > 0 ? [`${f1(Math.abs(b.v / f.v) * 100)}%`] : []; },
  "computed payout (div/NI) integer": (c) => { const d = lastNum(row(c, "dividends")), n = lastNum(row(c, "netIncome")); return d && n && n.v > 0 && d.v ? [`${Math.round(Math.abs(d.v / n.v) * 100)}%`] : []; },
  "computed capex/revenue integer": (c) => { const r = lastNum(row(c, "revenue")), k = lastNum(row(c, "capex")); return r && k && r.v ? [`${Math.round(Math.abs(k.v / r.v) * 100)}%`] : []; },
  "raw pack: gross profit $X.XB (unrendered)": (c) => { const g = lastNum(row(c, "grossProfit")); return g ? [`$${f1(g.v / 1e9)}B`] : []; },
  "raw pack: revenue at 2dp $X.XXB": (c) => { const r = lastNum(row(c, "revenue")); return r ? [`$${(r.v / 1e9).toFixed(2)}B`] : []; },
  "peer P/E N.Nx": (c) => (c.pack.peers?.[0]?.pe ? [`${f1(c.pack.peers[0].pe)}x`] : []),
  "peer P/E integer Nx": (c) => (c.pack.peers?.[0]?.pe ? [`${Math.round(c.pack.peers[0].pe)}x`] : []),
};

const res: Record<string, { n: number; cur: number; proto: number; cell: number; ex: string[] }> = {};
for (const c of pub) {
  const cur = buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock]);
  const ents = entriesFor(c), cents = cellOnly(ents, c.contextBlock);
  for (const [name, gen] of Object.entries(ATTACKS)) for (const s of gen(c)) {
    const r = (res[name] ??= { n: 0, cur: 0, proto: 0, cell: 0, ex: [] });
    // skip probes whose literal string is on the surface (then it's legitimately quotable)
    if ([c.factsBlock, c.contextBlock, c.callsBlock, c.judgmentBlock].some((t) => t.includes(s))) continue;
    r.n++;
    if (checkGrounding({ p: s }, cur).length === 0) r.cur++;
    const tk = tokens(s);
    const ok = tk.length > 0 && tk.every((t) => grounds(t, ents).ok);
    if (ok) { r.proto++; if (r.ex.length < 3) { const g = grounds(tk[0], ents); r.ex.push(`${c.ticker} ${s} <= ${g.by?.src}:${JSON.stringify(g.by?.raw)}`); } }
    if (tk.length > 0 && tk.every((t) => grounds(t, cents).ok)) r.cell++;
  }
}
console.log("| attack | n | current | proto | proto+cell-only-wildcard | examples |");
for (const [k, r] of Object.entries(res)) console.log(`| ${k} | ${r.n} | ${(100 * r.cur / r.n).toFixed(0)}% | ${(100 * r.proto / r.n).toFixed(0)}% | ${(100 * r.cell / r.n).toFixed(0)}% | ${r.ex.join("; ")} |`);

```

### `mitig.ts`

```ts
// Reviewer probe: two cheap mitigations measured on corpus fails, random probes and the EPS-as-aggregate attack.
//  M1: the unscaled-money-cell scale-up applies only to table-shaped cells ("$\n15,955", "$ 15,952"), not inline "$4.56".
//  M2: a bare context cell grounds %/pp/bp prose only if "%" or "percent" appears within W chars of it.
import { loadCorpus, type Case } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds, type Entry, type Tok } from "./proto";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";

const W = Number(process.env.W ?? 300);
const isBare = (e: Entry) => e.src === "context" && e.kind === "plain" && e.scale === 1;
const isMoneyCell = (e: Entry) => e.src === "context" && e.kind === "money" && e.scale === 1;
function prep(c: Pick<Case, "contextBlock">, ents: Entry[]) {
  const ctx = c.contextBlock;
  const nearPct = new Set<Entry>(), tableMoney = new Set<Entry>();
  for (const e of ents) {
    if (isBare(e) && /%|percent/i.test(ctx.slice(Math.max(0, e.index - W), e.end + W))) nearPct.add(e);
    if (isMoneyCell(e) && /^(US)?[$€£]\s/.test(e.raw.replace(/^[(+\-−]/, "")) ) tableMoney.add(e);
  }
  return (p: Tok, m1: boolean, m2: boolean) => ents.filter((e) => {
    if (m2 && isBare(e) && (p.kind === "pct" || p.kind === "pp" || p.kind === "bp") && !nearPct.has(e)) return false;
    if (m1 && isMoneyCell(e) && p.kind === "money" && p.scale > 1 && !tableMoney.has(e)) return false;
    return true;
  });
}
const VARS: [string, boolean, boolean][] = [["proposed", false, false], ["M1", true, false], ["M2", false, true], ["M1+M2", true, true]];

const { cases } = loadCorpus();
const pub = cases.filter((c) => c.published);
// corpus fails
const fails: Record<string, string[]> = {};
for (const c of pub) {
  const ents = entriesFor(c), sel = prep(c, ents);
  for (const { path, text } of stringLeaves(c.judgment)) for (const p of tokens(text))
    for (const [n, a, b] of VARS) if (!grounds(p, sel(p, a, b)).ok) (fails[n] ??= []).push(`${c.ticker} ${path} ${JSON.stringify(p.raw)} | ${text.slice(Math.max(0, p.index - 60), p.end + 20).replace(/\s+/g, " ")}`);
}
for (const [n] of VARS) console.log(`${n}: corpus fails ${fails[n]?.length ?? 0} in ${new Set((fails[n] ?? []).map((s) => s.split(" ")[0])).size}`);
const base = new Set(fails["proposed"] ?? []);
for (const n of ["M1", "M2"]) for (const s of fails[n] ?? []) if (!base.has(s)) console.log(`  NEW under ${n}: ${s}`);

// random probes (same LCG as random-probes.ts)
let seed = 20261007;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (lo: number, hi: number, dp: number) => (lo + rnd() * (hi - lo)).toFixed(dp);
const FORMS: Record<string, () => string> = {
  "N.N%": () => `${pick(0.1, 99.9, 1)}%`, "N% (int)": () => `${Math.floor(1 + rnd() * 99)}%`, "N.Nx": () => `${pick(1, 60, 1)}x`,
  "Nx (int)": () => `${Math.floor(2 + rnd() * 59)}x`, "$N.NB": () => `$${pick(1, 99.9, 1)}B`, "$N,NNN million": () => `$${Math.floor(1000 + rnd() * 9000).toLocaleString("en-US")} million`,
  "$NN.NN": () => `$${pick(1, 99.99, 2)}`, "$N (int)": () => `$${Math.floor(1 + rnd() * 9)}`, "NNN bps": () => `${Math.floor(1 + rnd() * 99) * 10} bps`,
};
const acc: Record<string, Record<string, number>> = {};
let eps: Record<string, number> = {}, epsN = 0;
for (const c of pub) {
  const ents = entriesFor(c), sel = prep(c, ents);
  for (const [form, gen] of Object.entries(FORMS)) for (let i = 0; i < 20; i++) {
    const s = gen(); const tk = tokens(s); const r = (acc[form] ??= { n: 0 }); r.n++;
    for (const [n, a, b] of VARS) if (tk.length && tk.every((t) => grounds(t, sel(t, a, b)).ok)) r[n] = (r[n] ?? 0) + 1;
  }
  const e = [...c.pack.statements.income].find((r) => r.key === "epsDiluted")?.values.filter((x): x is number => typeof x === "number").pop();
  if (e != null) {
    const s = `$${Math.abs(e).toFixed(2)} billion`;
    if (![c.factsBlock, c.contextBlock].some((t) => t.includes(s))) { epsN++; const tk = tokens(s); for (const [n, a, b] of VARS) if (tk.every((t) => grounds(t, sel(t, a, b)).ok)) eps[n] = (eps[n] ?? 0) + 1; }
  }
}
console.log(`| form | ${VARS.map((v) => v[0]).join(" | ")} |`);
const tot: Record<string, number> = { n: 0 };
for (const [f, r] of Object.entries(acc)) { console.log(`| ${f} | ${VARS.map(([n]) => `${(100 * (r[n] ?? 0) / r.n).toFixed(1)}%`).join(" | ")} |`); tot.n += r.n; for (const [n] of VARS) tot[n] = (tot[n] ?? 0) + (r[n] ?? 0); }
console.log(`| all | ${VARS.map(([n]) => `${(100 * tot[n] / tot.n).toFixed(1)}%`).join(" | ")} |`);
console.log(`EPS-as-$billion attack (n=${epsN}):`, VARS.map(([n]) => `${n} ${(100 * (eps[n] ?? 0) / epsN).toFixed(0)}%`).join(", "));

```

### `wildonly.ts`

```ts
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";
const pub = loadCorpus().cases.filter((c) => c.published);
let total = 0, typed = 0, only = 0, onlyByKind: Record<string, number> = {}, reports = 0;
for (const c of pub) {
  const e = entriesFor(c);
  const strict = e.filter((x) => !(x.src === "context" && x.scale === 1 && (x.kind === "plain" || x.kind === "money")) );
  let r = 0;
  for (const { text } of stringLeaves(c.judgment)) for (const p of tokens(text)) {
    total++; if (p.kind === "plain") continue; typed++;
    if (grounds(p, e).ok && !grounds(p, strict).ok && !(p.kind === "money" && p.scale === 1)) { only++; r++; onlyByKind[p.kind] = (onlyByKind[p.kind] ?? 0) + 1; }
  }
  if (r) reports++;
}
console.log({ total, typed, onlyViaUnitlessCell: only, onlyByKind, reports });

```

### `formats.ts`

```ts
// Reviewer probe: legitimate future formats vs the prototype (and today's lint) on synthetic surfaces.
import { tokens, grounds, textEntries, factsLineEntries, tableEntries, type Entry } from "./proto";
import { buildAllowedIndex, checkGrounding, numericTokens } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/grounding";
import { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import { readFileSync } from "node:fs";
const pack = FactPack.parse(JSON.parse(readFileSync("C:/Users/nicopc/Documents/juniresearch/data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const empty = { ...pack, context: { ...pack.context, description: { ...pack.context.description, text: "" }, mdaExcerpt: null, riskFactorsExcerpt: null, pressRelease: null, proxyStatement: null, transcriptHighlights: null, headlines: [] }, peers: [], statements: { ...pack.statements, income: [], balance: [], cashflow: [] }, segments: { ...pack.segments, items: [] }, geoMix: [] } as unknown as typeof pack;

type Src = { ctx?: string; facts?: string; table?: { fmt: string; v: number } };
const CASES: [string, Src, string][] = [
  ["$1.72 trillion vs facts ~$1.72T", { facts: "Market cap ~$1.72T" }, "a market value of $1.72 trillion"],
  ["$500 million vs table 0.5 ($B)", { table: { fmt: "usdB", v: 5e8 } }, "capex of $500 million"],
  ["$0.5 billion vs table 0.5 ($B)", { table: { fmt: "usdB", v: 5e8 } }, "capex of $0.5 billion"],
  ["$1.5 billion vs ctx $1,512 million", { ctx: "revenue of $1,512 million" }, "about $1.5 billion of revenue"],
  ["$1.2bn vs facts $1.2B", { facts: "FCF $1.2B" }, "FCF of $1.2bn"],
  ["1.2bn (no $) vs facts $1.2B", { facts: "FCF $1.2B" }, "FCF of 1.2bn"],
  ["$1.2b lowercase vs facts $1.2B", { facts: "FCF $1.2B" }, "FCF of $1.2b"],
  ["$5m lowercase vs ctx $5 million", { ctx: "a charge of $5 million" }, "a $5m charge"],
  ["$12.3K vs ctx $12.3 thousand", { ctx: "fees of $12.3 thousand" }, "fees of $12.3K"],
  ["12.3k lowercase vs ctx 12,300 employees", { ctx: "about 12,300 employees" }, "about 12.3k employees"],
  ["$63.9-billion hyphenated vs table 63.9", { table: { fmt: "usdB", v: 63.9e9 } }, "a $63.9-billion top line"],
  ["(0.5)% vs table -0.5%", { table: { fmt: "pctSigned", v: -0.005 } }, "growth of (0.5)%"],
  ["-0.5% vs table -0.5%", { table: { fmt: "pctSigned", v: -0.005 } }, "growth of -0.5%"],
  ["50 bps vs ctx 0.5 percentage points", { ctx: "margin up 0.5 percentage points" }, "margin up 50 bps"],
  ["€12.3 million vs ctx €12.3 million", { ctx: "a fine of €12.3 million" }, "a €12.3 million fine"],
  ["$40–47 vs judgment $40.00–$47.00", { facts: "Target range $40.00–$47.00" }, "a $40–47 target"],
  ["40-47 bare vs judgment $40.00–$47.00", { facts: "Target range $40.00–$47.00" }, "a 40-47 target"],
  ["2–3x vs ctx 2x to 3x", { ctx: "leverage of 2x to 3x" }, "leverage of 2–3x"],
  ["($0.12) vs table EPS -0.12", { table: { fmt: "eps", v: -0.12 } }, "EPS of ($0.12)"],
  ["$(0.12) vs table EPS -0.12", { table: { fmt: "eps", v: -0.12 } }, "EPS of $(0.12)"],
  ["−$1.3B vs table net debt -1.3", { table: { fmt: "usdB", v: -1.3e9 } }, "net debt of −$1.3B"],
  ["-$1.3 billion vs table net debt -1.3", { table: { fmt: "usdB", v: -1.3e9 } }, "net debt of -$1.3 billion"],
  ["$1.3B (unsigned) vs table -1.3", { table: { fmt: "usdB", v: -1.3e9 } }, "net cash of $1.3B"],
  ["S&P 500 (index name)", { ctx: "" }, "a member of the S&P 500 index"],
  ["Russell 1000 (index name)", { ctx: "" }, "joined the Russell 1000"],
  ["401(k) (plan name)", { ctx: "" }, "its 401(k) match"],
  ["24/7 (service)", { ctx: "" }, "24/7 monitoring"],
  ["C$5.2 billion (other currency)", { ctx: "" }, "a C$5.2 billion deal"],
  ["HK$12 (other currency)", { ctx: "" }, "HK$12 per share"],
  ["¥120 billion", { ctx: "" }, "¥120 billion of sales"],
  ["1.2 turns leverage vs facts 1.2x", { facts: "Net debt/EBITDA 1.2x" }, "1.2 turns of leverage"],
  ["2.6X uppercase vs facts 2.6x", { facts: "Net debt/EBITDA 2.6x" }, "about 2.6X leverage"],
  ["3.1-percentage-point vs ctx 3.1 points", { ctx: "up 3.1 points" }, "a 3.1-percentage-point gain"],
  ["+10% vs calls +10.0%", { facts: "BUY needs E ≥ +10.0%" }, "the +10% bar"],
  ["one-third (word)", { ctx: "" }, "one-third of revenue"],
  ["$63.9 billion vs table 63.9", { table: { fmt: "usdB", v: 63.9e9 } }, "$63.9 billion of revenue"],
  ["$63,900 million vs table 63.9", { table: { fmt: "usdB", v: 63.9e9 } }, "$63,900 million of revenue"],
  ["63.9 billion dollars", { table: { fmt: "usdB", v: 63.9e9 } }, "63.9 billion dollars"],
  ["USD 63.9 billion", { table: { fmt: "usdB", v: 63.9e9 } }, "USD 63.9 billion"],
  ["$64 billion vs table 63.9", { table: { fmt: "usdB", v: 63.9e9 } }, "about $64 billion"],
  ["$60 billion vs table 63.9 (1 sig)", { table: { fmt: "usdB", v: 63.9e9 } }, "over $60 billion"],
  ["45% vs table 45.3%", { table: { fmt: "pct", v: 0.453 } }, "a 45% margin"],
  ["45% vs ctx 45.3%", { ctx: "margin of 45.3%" }, "a 45% margin"],
  ["$1.4 billion vs ctx $1,412 million", { ctx: "capex of $1,412 million" }, "capex of $1.4 billion"],
  ["$1.41 billion vs ctx $1,412 million", { ctx: "capex of $1,412 million" }, "capex of $1.41 billion"],
];
const tbl = (fmt: string, v: number) => [{ title: "t", columns: ["FY25"], rows: [{ label: "r", values: [v], format: fmt }] }] as never;
for (const [name, src, prose] of CASES) {
  const ents: Entry[] = [
    ...(src.ctx ? textEntries(src.ctx, "context") : []),
    ...(src.facts ? factsLineEntries(src.facts) : []),
    ...(src.table ? tableEntries(tbl(src.table.fmt, src.table.v)) : []),
  ];
  const tk = tokens(prose);
  const ok = tk.length > 0 && tk.every((t) => grounds(t, ents).ok);
  const srcText = src.ctx ?? src.facts ?? (src.table ? String(src.table.v) : "");
  const cur = checkGrounding({ p: prose }, buildAllowedIndex(empty, [srcText])).length === 0 && numericTokens(prose).length > 0;
  console.log(`${ok ? "PASS" : "FAIL"} (old ${numericTokens(prose).length ? (cur ? "pass" : "fail") : "no-token"})  ${name}  →  toks ${JSON.stringify(tk.map((t) => `${t.raw}:${t.kind}${t.scale !== 1 ? "×" + t.scale : ""}${t.sign ? (t.sign > 0 ? "+" : "-") : ""}`))}`);
}

```

### `oldcases.ts`

```ts
import { tokens } from "./proto";
const T = (s: string) => tokens(s).map((t) => ({ raw: t.raw, mag: (t.sign < 0 ? -1 : 1) * t.mag, kind: t.kind, dp: t.dp }));
for (const s of ["revenue of $29.6B rose 86% YoY", "AI revenue grew +221% to $16.7 billion", "trades at 44.9x earnings and ~19.3x sales", "a $350–$600 range", "16,700 employees and 4.76B shares", "-3.3% in FY2024",
  "six customers, 3 hyperscalers, Q3'26 and Q4 FY2026, ended Aug 2, 2026, the 10-Q, a 10:1 split, since 2023", "$361.99 and 0.855 and 68%", "Q3'26 revenue and Q4'26 guidance", "by 2040 and beyond", "by 2045 and beyond",
  "the quarter ended August 30, 2026 and December 31, 2025; as of 2026-08-30", "fiscal years ended December 31 and quarters ended Sept. 30", "in May 25 stores opened", "since December, 31 stores opened",
  "the 52-week low and a 12-month view over a 90-day window", "over 52 weeks", "up 40-50% next year", "300-400 basis points", "up 20-30% next year", "10-25 units of growth",
  // plan Task 1/2 cases
  "$5mn", "$5mm", "$500K", "(12.3)%", "($24.99)", "($1.45) loss", "40 bps", "150bp", "5.4 points", "0.5 point", "0.5\npt", "(0.7)\npts", "0.50×", "2.6 times", "met 4 times", "400 times", "€12", "£5", "US$5", "$ 15,952", "$\n15,952", "13.3\n%", "0.2 %", "$-0.08", "-$0.08", "$\n.07", "(.4)", "20 percent", "2.3 per cent", "February 17, 2026 point to", "$190s", "$3s", "mid-80s", "the 1990s", "5 to 7 percent", "$350–600", "$1.2–1.5 billion", "$1.750 to $1.810 billion", "$415 to $455 million", "fiscal year 2027 to $1.225 billion", "54 B",
  "Schedule 13G/A", "the 14A", "13G", "Item 1A", "Note 14", "Notes 3", "Tier 1", "Section 232", "Phase 3", "ISO 9001", "FAST-41", "COVID-19", "Intel 14A", "30 September 2026", "a 52/53-week year", "the past 52 weeks", "53rd percentile", "over 25 years", "in 15 countries", "$14A", "14 analysts", "PDK 0.9",
  "grew 8% to $1.2B in 2025, 3 times", "Q2 2026 revenue of 1,234", "rose 12 points", "about 8 points of growth", "3.5% to 4.0%", "a 1-for-10 split", "Level 3 inputs", "Gen 5", "Rule 10b5-1", "the 2026-2027 period", "2025-26", "FY2025-FY2027", "from 2024 to 2026"]) console.log(JSON.stringify(s), "→", JSON.stringify(T(s)));

```

### `tok-between.ts`

```ts
import { tokens } from "./proto";
for (const s of ["between $8.15 and $8.25 billion", "$45 and $1.2 billion", "between 5 and 7 percent", "revenue of $45 and capex of $1.2 billion"]) console.log(JSON.stringify(s), "→", tokens(s).map((t) => `${t.raw}:${t.kind}×${t.scale}`).join(" "));

```

### `tok-extra.ts`

```ts
import { tokens } from "./proto";
for (const s of ["Fortune 500", "Russell 2000", "12.3k employees", "$12.3k of fees", "a 10-point plan", "about 2.6X leverage", "$5m charge", "$4.50", "40%", "$500 million", "50 bps", "$63,900 million"])
  console.log(JSON.stringify(s), "→", JSON.stringify(tokens(s).map((t) => `${t.raw}:${t.kind}×${t.scale} tz${t.tz}`)));

```

### `task1state.ts`

```ts
/**
 * grounding.ts — "do not invent numbers", as a check rather than a promise.
 * ---------------------------------------------------------------------------
 * numericTokens() pulls every figure out of prose. buildAllowedIndex() collects
 * every number a report may legitimately contain: FactPack values at their
 * display scalings, the rendered facts block, and the captured context text.
 * checkGrounding() reports each prose figure that matches nothing.
 */
import type { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import type { ValidationIssue } from "C:/Users/nicopc/Documents/juniresearch/lib/validate";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";

export interface NumberToken {
  raw: string;
  value: number;      // as written, sign applied: "$29.6B" → 29.6
  magnitude: number;  // with the multiplier: "$29.6B" → 2.96e10; "86%" → 86
  precision: number;  // decimals written
  kind: "money" | "pct" | "mult" | "plain";
}

const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

// Lookbehind: not preceded by letter, straight or curly apostrophe, $, digit, or period. Prevents Q3'26 → "26" leak.
// Capture groups: (1) sign [+\-−], (2) $, (3) integer with thousands-separators or bare, (4) decimals,
// (5) scaled unit (K/M/B/T or spelled-out), (6) percent sign, (7) x multiplier.
const TOKEN = /(?<![A-Za-z'’$\d.])([+\-−]?)(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(K|M|B|T|thousand|million|billion|trillion)(?![A-Za-z])|(%)|(x)(?![A-Za-z]))?/g;
const YEAR = /^(199\d|20[0-3]\d|2040)$/;
const MONTH_BEFORE = /(^|[^A-Za-z])(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sept?(ember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\.? $/i;

/** Figures that never need grounding: small counts, years, fiscal/quarter labels, dates, form names, ratios like 10:1, period phrases like 52-week. */
function allowListed(m: RegExpExecArray, text: string): boolean {
  const [whole, , dollar, int, frac, suffix, pctSign, xSign] = m;
  const bare = !dollar && !frac && !suffix && !pctSign && !xSign;
  const n = Number(int.replace(/,/g, ""));
  const before = text.slice(Math.max(0, m.index - 3), m.index);
  const after = text.slice(m.index + whole.length, m.index + whole.length + 8);
  if (/(^|[^A-Za-z])(Q|FY)$/.test(before) || /^'?\d{2}\b/.test(after) && /Q$/.test(before)) return true; // Q3'26, FY24, FY2026
  if (bare && n <= 12) return true;
  if (bare && YEAR.test(int)) return true;
  if (bare && /^-[QK]\b/.test(after)) return true;                          // 10-Q, 10-K
  if (bare && /^:\d/.test(after)) return true;                              // 10:1
  if (bare && /^-(week|month|day|year|quarter)s?\b/i.test(after)) return true; // 52-week, 12-month, 90-day, 5-year
  if (/^,? ?(19|20)\d\d\b/.test(after)) return true;         // "August 30, 2026", "30 2026"
  if (bare && n >= 1 && n <= 31 && /(19|20)\d\d-(\d{1,2}-)?$/.test(text.slice(Math.max(0, m.index - 8), m.index))) return true; // ISO date component, e.g. 2026-08-30
  if (bare && n >= 1 && n <= 31 && MONTH_BEFORE.test(text.slice(Math.max(0, m.index - 12), m.index))) return true; // yearless month-name date, e.g. "December 31", "Sept. 30"
  return false;
}

export function numericTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    const [raw, sign, dollar, int, frac = "", suffix, pctSign, xSign] = m;
    if (allowListed(m, text)) continue;
    const abs = Number(int.replace(/,/g, "") + frac);
    const value = /[-−]/.test(sign) ? -abs : abs;
    const mult = suffix ? MULT[suffix.toLowerCase()] : 1;
    const kind: NumberToken["kind"] = dollar ? "money" : pctSign ? "pct" : xSign ? "mult" : "plain";
    out.push({ raw: raw.trim(), value, magnitude: value * mult, precision: frac ? frac.length - 1 : 0, kind });
  }
  return out;
}

const roundTo = (x: number, dp: number) => Number(x.toFixed(dp));

export class AllowedIndex {
  private values: number[] = [];
  /** precision → every indexed value rounded to it; built on first lookup at that precision, kept current by add(). */
  private rounded = new Map<number, Set<number>>();
  add(v: number): void {
    if (!Number.isFinite(v)) return;
    this.values.push(v);
    for (const [dp, set] of this.rounded) set.add(roundTo(v, dp));
  }
  addToken(t: NumberToken): void { this.add(t.value); this.add(t.magnitude); this.add(Math.abs(t.value)); this.add(Math.abs(t.magnitude)); }
  /**
   * A prose figure is grounded if some indexed value rounds to it at the figure's own precision.
   * No relative tolerance: a 0.5% band let unrelated numbers vouch for each other (EPS 1.23 ×100 for "123.4x").
   * Rounded values are finite, so Set membership is exactly the `===` comparison it replaces.
   */
  has(t: NumberToken): boolean {
    if (!this.values.length) return false;
    const dp = t.precision;
    let set = this.rounded.get(dp);
    if (!set) {
      set = new Set(this.values.map((v) => roundTo(v, dp)));
      this.rounded.set(dp, set);
    }
    const targets = [t.value, t.magnitude, Math.abs(t.value), Math.abs(t.magnitude)];
    return targets.some((x) => set.has(roundTo(x, dp)));
  }
}

/** Every number in the FactPack, at the scalings the page and the prose use. */
function factNumbers(pack: FactPack): number[] {
  const out: number[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "number") out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit({ quote: pack.quote, statements: pack.statements, latestQuarter: pack.latestQuarter, ttm: pack.ttm,
          estimates: pack.estimates, analysts: pack.analysts, segments: pack.segments, geoMix: pack.geoMix, peers: pack.peers });
  return out;
}

export function buildAllowedIndex(pack: FactPack, extraText: string[]): AllowedIndex {
  const index = new AllowedIndex();
  for (const n of factNumbers(pack)) {
    index.add(n);
    if (Math.abs(n) >= 1e6) for (const d of [1e3, 1e6, 1e9, 1e12]) index.add(n / d);
    if (Math.abs(n) < 50) index.add(n * 100);            // ratios as percentages
  }
  const c = pack.context;
  const texts = [c.description.text, c.mdaExcerpt?.text, c.riskFactorsExcerpt?.text, c.pressRelease?.text, c.proxyStatement?.text, c.transcriptHighlights?.text,
                 ...c.headlines.map((h) => h.text), ...extraText].filter((t): t is string => typeof t === "string");
  for (const t of texts) for (const tok of numericTokens2(t)) index.addToken(tok);
  return index;
}

export function checkGrounding(obj: unknown, index: AllowedIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, text } of stringLeaves(obj))
    for (const tok of numericTokens2(text))
      if (!index.has(tok))
        issues.push({ field: path, message: `"${tok.raw}" is not in the facts or the captured context`, value: tok.raw });
  return issues;
}
import { tokens as protoTokens } from "./proto";
// Task-1 state: old index, new tokenizer.
export function numericTokens2(text: string): NumberToken[] {
  return protoTokens(text).map((t) => { const s = t.sign < 0 ? -1 : 1; const unscaled = t.mag / (t.scale * (t.kind === "bp" ? 0.01 : 1)); return { raw: t.raw, value: s * unscaled, magnitude: s * t.mag, precision: t.dp, kind: (t.kind === "pp" || t.kind === "bp" ? "plain" : t.kind) as NumberToken["kind"] }; });
}

```

### `task1run.ts`

```ts
import { readFileSync } from "node:fs";
import { loadCorpus } from "./corpus";
import { buildAllowedIndex, checkGrounding } from "./task1state";
import { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import { projectReportFacts } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/project";
import { Judgment } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/judgment.schema";
import { renderFactsBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt";
import { renderJudgmentBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment";
const R = "C:/Users/nicopc/Documents/juniresearch/";
const pack = FactPack.parse(JSON.parse(readFileSync(R + "data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const j = Judgment.parse(JSON.parse(readFileSync(R + "lib/__fixtures__/avgo-golden-judgment.json", "utf8")));
const facts = projectReportFacts(pack);
console.log("golden misses in Task-1 state:", checkGrounding(j, buildAllowedIndex(pack, [renderFactsBlock(facts, pack), renderJudgmentBlock(j, pack.quote.price)])).map((i) => `${i.field}: ${i.value}`));
const { cases } = loadCorpus();
let f = 0; const ts = new Set<string>();
for (const c of cases.filter((x) => x.published)) { const n = checkGrounding(c.judgment, buildAllowedIndex(c.pack, [c.factsBlock, c.judgmentBlock])); f += n.length; if (n.length) { ts.add(c.ticker); } }
console.log(`corpus (PACK_AT=${process.env.PACK_AT ?? "head"}) fails in Task-1 state: ${f} in ${ts.size}`, [...ts].join(" "));

```

### `lintdiff.ts`

```ts
import { readFileSync } from "node:fs";
import { loadCorpus } from "./corpus";
import { lintJudgment as oldLint } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/lint";
import { lintJudgment as newLint } from "./lintcopy/lint/index";
import { Desk } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/desk.schema";
const desk = Desk.parse(JSON.parse(readFileSync("C:/Users/nicopc/Documents/juniresearch/data/desk/desk.json", "utf8")));
const { cases } = loadCorpus();
let oe = 0, ne = 0, ow = 0, nw = 0;
for (const c of cases.filter((x) => x.published)) {
  const o = oldLint(c.judgment, desk, { currentPrice: c.pack.quote.price }), n = newLint(c.judgment, desk, { currentPrice: c.pack.quote.price });
  const key = (i: { rule: string; field: string; value: unknown; severity: string }) => `${i.severity} ${i.rule} ${i.field} ${JSON.stringify(i.value)}`;
  const os = new Set(o.map(key)), ns = new Set(n.map(key));
  oe += o.filter((i) => i.severity === "error").length; ne += n.filter((i) => i.severity === "error").length;
  ow += o.filter((i) => i.severity === "warning").length; nw += n.filter((i) => i.severity === "warning").length;
  for (const k of ns) if (!os.has(k)) console.log(`${c.ticker} NEW   ${k.slice(0, 200)}`);
  for (const k of os) if (!ns.has(k)) console.log(`${c.ticker} GONE  ${k.slice(0, 200)}`);
}
console.log({ oldErrors: oe, newErrors: ne, oldWarnings: ow, newWarnings: nw });

```

### `lintcopy/shim-grounding.ts`

```ts
import { tokens } from "../proto";
export function numericTokens(text: string) {
  return tokens(text).map((t) => ({ raw: t.raw, value: t.sign < 0 ? -t.mag : t.mag, magnitude: t.mag, precision: t.dp, kind: t.kind }));
}

```

### `golden.ts`

```ts
import { readFileSync } from "node:fs";
import { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import { projectReportFacts } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/project";
import { Judgment } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/judgment.schema";
import { Desk } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/desk.schema";
import { renderFactsBlock, renderContextBlock, renderCalls } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt";
import { renderJudgmentBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment";
import { stringLeaves } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/walk";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
const R = "C:/Users/nicopc/Documents/juniresearch/";
const pack = FactPack.parse(JSON.parse(readFileSync(R + "data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const j = Judgment.parse(JSON.parse(readFileSync(R + "lib/__fixtures__/avgo-golden-judgment.json", "utf8")));
const desk = Desk.parse(JSON.parse(readFileSync(R + "data/desk/desk.json", "utf8")));
const facts = projectReportFacts(pack);
const e = entriesFor({ facts, factsBlock: renderFactsBlock(facts, pack), judgmentBlock: renderJudgmentBlock(j, pack.quote.price), contextBlock: renderContextBlock(pack), callsBlock: renderCalls(desk.rating) });
const miss: string[] = [];
for (const { path, text } of stringLeaves(j)) for (const t of tokens(text)) if (!grounds(t, e).ok) miss.push(`${path}: ${t.raw}`);
console.log(miss.sort());

```

### `why-golden.ts`

```ts
import { readFileSync } from "node:fs";
import { FactPack } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/schema";
import { projectReportFacts } from "C:/Users/nicopc/Documents/juniresearch/lib/facts/project";
import { Judgment } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/judgment.schema";
import { Desk } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/desk.schema";
import { renderFactsBlock, renderCalls } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/prompt";
import { renderJudgmentBlock } from "C:/Users/nicopc/Documents/juniresearch/lib/synth/validate-judgment";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
const R = "C:/Users/nicopc/Documents/juniresearch/";
const pack = FactPack.parse(JSON.parse(readFileSync(R + "data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const j = Judgment.parse(JSON.parse(readFileSync(R + "lib/__fixtures__/avgo-golden-judgment.json", "utf8")));
const desk = Desk.parse(JSON.parse(readFileSync(R + "data/desk/desk.json", "utf8")));
const facts = projectReportFacts(pack);
const e = entriesFor({ facts, factsBlock: renderFactsBlock(facts, pack), judgmentBlock: renderJudgmentBlock(j, pack.quote.price), contextBlock: "", callsBlock: renderCalls(desk.rating) });
for (const s of process.argv.slice(2)) for (const t of tokens(s)) { const g = grounds(t, e); console.log(s, g.cls, g.by && { src: g.by.src, raw: g.by.raw }); }

```

### `find.js`

```js
const fs=require('fs');
const [t,...needles]=process.argv.slice(2);
const r=require(`C:/Users/nicopc/Documents/juniresearch/data/${t.toLowerCase()}.json`);const acc=r.meta.filing.accession;
const p=require(`C:/Users/nicopc/Documents/juniresearch/data/facts/${t}/${acc}.json`);const c=p.context;
const all=[c.description,c.mdaExcerpt,c.riskFactorsExcerpt,c.pressRelease,c.proxyStatement,c.transcriptHighlights,...c.headlines].filter(Boolean);
for(const n of needles){let hits=0;for(const e of all){let i=-1;while((i=e.text.indexOf(n,i+1))>=0&&hits<4){hits++;console.log(t,JSON.stringify(n),e.source,'::',JSON.stringify(e.text.slice(Math.max(0,i-60),i+n.length+25)))}} if(!hits)console.log(t,n,'NOT FOUND IN CONTEXT')}

```

### `why.ts`

```ts
import { loadCorpus } from "./corpus";
import { entriesFor } from "./measure";
import { tokens, grounds } from "./proto";
const [t, probe, ctx] = process.argv.slice(2);
const c = loadCorpus().cases.find((x) => x.ticker === t && x.published)!;
const e = entriesFor(ctx === "noctx" ? { ...c, contextBlock: "" } : c);
for (const p of tokens(probe)) { const g = grounds(p, e); console.log(probe, "→", g.cls, g.by && { src: g.by.src, raw: g.by.raw, kind: g.by.kind, mag: g.by.mag }); }

```

### `show.ts`

```ts
import { loadCorpus } from "./corpus";
const [want, ...greps] = process.argv.slice(2);
const { cases } = loadCorpus();
for (const c of cases.filter((x) => x.published && x.ticker === want)) {
  console.log(`== ${c.ticker} judgment block:\n${c.judgmentBlock}`);
  for (const g of greps) for (const line of c.factsBlock.split("\n")) if (line.toLowerCase().includes(g.toLowerCase())) console.log("  facts:", line.slice(0, 220));
}

```
