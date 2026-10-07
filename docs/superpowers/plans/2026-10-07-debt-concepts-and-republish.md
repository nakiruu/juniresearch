# Debt-concept fallbacks, TTM consecutiveness, Shibui-fail gate, and the ten-name republish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four audit findings in the free fact path (D-1 debt concepts — both the understated packs and the overstated GE/TMO ones — and the fabricated current-only zero, D-7 non-consecutive TTM quarters, D-27 ungated Shibui `fail` levels, D-4 the stale CFG revenue pack), then re-capture twelve published packs (plus SCHW for the diff) on the fixed code without moving their quote date, and republish each report through the author/reviewer loop with its original report date.

**Architecture:** Phase 1 is pure code on a branch: concept lists and `deriveTotalDebt` in `lib/facts/free/sec.ts`, a span check in `lib/facts/free/ttm.ts`, a new pure gate in `lib/synth/crosscheck-gate.ts` wired into `scripts/synth-build.ts`, a `--keep-quote` mode for `facts:free` so a re-capture keeps the pack's price and `asOf`, persisted companyfacts JSON per capture, and two read-only scripts (an offline debt sweep over the verified packs and a pack-to-pack diff). Phase 2 re-captures the packs and produces before/after diffs plus gate outcomes. Phase 3 republishes, one batch branch at a time, following the FOUR/DSP precedent (`synth:build --date <original>`, fresh reviewer on `--full-brief`, editorial gate, full vitest, `--no-ff` merge). Three STOP points require the owner.

**Revision 2 (2026-10-07, after the adversarial review, verdict APPROVE WITH CHANGES):** CVX/SCHW same-value lease-line rule (F-1), balance-sheet-total expectations (F-1), GE and TMO in scope and their overstatement diagnosed (F-2), carry-forward of enrich-filled TTM fields (F-3), zero-vs-gap rule for current-only debt (F-4), `DebtInstrumentCarryingAmount` dropped (F-5), re-estimated rounds (F-6), trade-engine exit bars corrected (F-7), persisted companyfacts (F-13a), and the owner-default decisions marked as such. Owner defaults made on the owner's behalf by the coordinator, which the owner may override at STOP (b): **GE and TMO are IN scope; SCHW is IN the Phase 2 diff and its republish is decided at STOP (b) because it is held; companyfacts JSON is persisted on re-capture.**

**Tech Stack:** TypeScript (tsx), vitest, zod, Node 22. No new dependencies.

**Spec:** The audit brief embedded in the orchestrator's request (findings D-1, D-4, D-7, D-27, dated 2026-10-06); process rules in `docs/10022026learning.md`; the republish precedent in `docs/superpowers/specs/2026-10-03-crosscheck-input-review.md`.

## Global Constraints

- Work on branch `claude/debt-concepts-2026-10-07` for Phase 1 and on `claude/republish-debt-batch-<n>` branches for Phase 3. Never commit to `main` directly; every merge is `--no-ff` and only after STOP (c).
- Nothing reaches `main` unreviewed (learnings §1). Drafts commit as `wip(<T>): … (unreviewed; not for main)`.
- "After ANY change to concept order, re-run the debt check on every pack verified earlier": BSX, NET, ADI, VST, CSCO, AEIS, CALX FY total debt must be byte-identical before and after (Task 6).
- "After any debt or cash fix, check the gate outcome" (learnings §8): every Phase 2 diff prints `evaluateGates` before/after.
- Re-publishing keeps the original report date: `synth:build -- <T> <ACC> --date YYYY-MM-DD` with the date in `data/<t>.json` `meta.reportDate` (learnings §1).
- Run the full vitest suite (`npm test`) before every merge to `main` (learnings §7).
- Do not touch: `data/trade/**` (ledger, fills, runs, locks), any token or secret, `.env.local`, `lib/trade/locks*`, the Schwab auth files. Ask the owner before anything involving a lock (learnings §5).
- Never put the owner's email in an outbound request; `EDGAR_CONTACT` from `.env.local` is the only User-Agent source.
- No model IDs in commit messages or PRs; no PRs unless asked. Commit messages end with the attribution lines the session reminder gives.
- Author and reviewer are separate agents; the review round caps at 2 (schema); a Minor still open after the last re-check is declined with a note, not fixed.

## Review Focus

1. A filer whose `LongTermDebtAndCapitalLeaseObligations` and `…IncludingCurrentMaturities` carry the SAME value for the period (CVX 10-K 39,781 = 39,781; SCHW 22,199 = 22,199) has tagged the all-in line twice; adding `DebtCurrent` (a note subtotal before reclassification) on top overstates by 24–34%. Only `ShortTermBorrowings`/`CommercialPaper` may be added, never `DebtCurrent`. Fixtures in Task 1 (CVX-10-K and SCHW shapes); every FY column of CVX reconciled to the 10-K before STOP (b).
2. A current-portion line at zero means "no long-term tag this period" only when the filer tags a long-term concept in some other period of the same series (a gap); a filer that never tags a long-term concept (DSP FY22–FY25, PLTR, RDVT, LASR, AMSC) has an honest zero that must stay `0`. Test in Task 1 (DSP-shape, gap-shape).
3. A TTM built from four quarters that do not span one year (V: Jun-25, Dec-25, Mar-26, Jun-26) must null every summed metric but keep the balance-sheet ratios and the Yahoo P/E fallback. Test in Task 4.
4. The Shibui gate must block on a `fail` without an accepted override, pass on a `fail` with one, and only warn when the pack carries no `shibuiCheck` at all (older packs). Test in Task 5.
5. `facts:free --keep-quote` must leave `quote.price`, `quote.marketCap`, `quote.asOf`, targets, estimates and ratings byte-identical, and change only the SEC-derived statements and the TTM rows. Round-trip test in Task 7.
6. A filer whose `LongTermDebt` already includes current maturities and who also tags `DebtCurrent` without `LongTermDebtCurrent` (TMO: 39,172 + 3,533 read as 42,705; balance sheet 39,385) must not have `DebtCurrent` added on top. Diagnosed and fixed with a fixture in Task 2b.

---

## Phase 0 — Orientation (read-only, 10 minutes)

### Task 0: Branch and baseline

**Files:** none modified.

- [ ] **Step 1: Create the branch from `main`**

```powershell
git status            # must be clean apart from the untracked VSCodium installer under docs/scoreconcepts/
git checkout -b claude/debt-concepts-2026-10-07
```

- [ ] **Step 2: Baseline the test suite**

Run: `npm test`
Expected: all green (the tree at `d1f036c` is green). Record the test count in the task ledger.

- [ ] **Step 3: Baseline debt values on the seven verified packs (before any code change)**

Run this read-only one-liner and keep its output in the scratchpad as `debt-baseline-before.txt`:

```powershell
foreach ($t in "BSX","NET","ADI","VST","CSCO","AEIS","CALX") { $f = Get-ChildItem "data/facts/$t/*.json" | Select-Object -First 1; $p = Get-Content $f.FullName -Raw | ConvertFrom-Json; $td = ($p.statements.balance | Where-Object { $_.key -eq "totalDebt" }).values -join ","; $ci = ($p.statements.balance | Where-Object { $_.key -eq "cashAndInvestments" }).values -join ","; "$t fy=[$($p.statements.fiscalYears -join ',')] totalDebt=[$td] cash=[$ci] ndEbitda=$($p.ttm.netDebtToEbitda)" }
```

These are the published packs; they are not rebuilt in this plan. Task 6's offline sweep re-parses each one's filing iXBRL and must reproduce the FY total debt shown here.

---

## Phase 1 — Code (branch `claude/debt-concepts-2026-10-07`)

### Task 1: Per-filer fixtures for the new debt concepts (tests first, all failing)

**Files:**
- Test: `lib/facts/free/sec.test.ts` (append after the `describe("deriveTotalDebt", …)` block at the end of the file)

**Interfaces:**
- Consumes: `parseCompanyFacts(facts)` and `deriveTotalDebt(r)` from `lib/facts/free/sec.ts` (existing).
- Produces: the test names Task 2 and Task 3 make pass. The `none` object gains three keys: `ltdLeaseTotal`, `combinedTotal`, `unsecuredLtd` (Task 2 adds them to `RawValues`). `deriveTotalDebt` gains a second parameter `{ filerTagsLongTerm: boolean }` (Task 2).

**Expected FY2025 totals are the filings' BALANCE-SHEET totals** (the reviewer's reconciliation, $M): RTX 37,904; XOM 43,537; CVX 40,758 (FY24 24,541); CME 3,422; USFD 5,200; CSTM 1,944; DOW 18,071 (18,161 including `ShortTermBankLoansAndNotesPayable` 90, a concept no list holds — noted, not added without a fixture); ATO 8,919 (September-2025 fiscal year-end); GE 20,494; TMO 39,385; SCHW ≈ 31,012. The audit's "≈37,075" for CVX was the June-2026 quarter, not FY25. Where a fixture below says "from the 10-K", the implementer opens `data/raw/<T>/<ACC>/edgar-10k-primary.html`, lists the debt concepts (`Select-String -Path <file> -Pattern 'name="us-gaap:[A-Za-z]*(Debt|Borrow|NotesPayable|CommercialPaper)[A-Za-z]*"' -AllMatches | % { $_.Matches.Value } | sort -Unique`) and reads each FY25 instant value, then writes the fixture with those values and the balance-sheet total as the expectation. A fixture that cannot reach the balance-sheet total from the tagged concepts under the rules in Task 2 is a STOP (a) finding, not a reason to loosen the expectation.

- [ ] **Step 1: Append the fixtures**

```ts
// Audit 2026-10-06 (D-1) and review F-1/F-2/F-4: filers that tag total debt under concepts no list held, two that
// were OVERSTATED by a double-add, and the zero-vs-gap rule. Values in $M from the filings' inline XBRL; every
// expectation is the balance-sheet total debt the 10-K prints.
describe("total debt — concepts and rules added 2026-10-07 (D-1)", () => {
  const fy = (val: number) => ({ start: "2025-01-01", end: "2025-12-31", val, form: "10-K", filed: "2026-02-20" });
  const inst = (val: number, end = "2025-12-31") => ({ end, val, form: "10-K", filed: "2026-02-20" });
  const base = { Revenues: { units: { USD: [fy(1_000)] } }, NetIncomeLoss: { units: { USD: [fy(100)] } } };
  const fy2025 = (gaap: Record<string, unknown>) => parseCompanyFacts({ facts: { "us-gaap": { ...base, ...gaap } } }).annual.find((p) => p.fiscal_year === 2025)!;

  it("CVX-10-K-shape: the noncurrent lease line equals the including-current line → all-in; add short-term borrowings only, never DebtCurrent", () => {
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(39_781)] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(39_781)] } },
      DebtCurrent: { units: { USD: [inst(10_918)] } },          // note subtotal before ~$9.9B reclass — must NOT be added
      LongTermDebtCurrent: { units: { USD: [inst(2_345)] } },
      CommercialPaper: { units: { USD: [inst(4_642)] } },       // inside the lease line; ShortTermBorrowings outranks it per period
      ShortTermBorrowings: { units: { USD: [inst(977)] } },
    });
    expect(p.total_debt).toBe(40_758); // balance sheet FY2025: 977 + 39,781
  });

  it("SCHW-shape (held): the same equal-value pattern, 22,199 = 22,199", () => {
    // Fill ShortTermBorrowings from SCHW's FY2025 10-K; the reviewer's balance-sheet total is ≈ 31,012 (pack reads 1,900 today).
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(22_199)] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(22_199)] } },
      ShortTermBorrowings: { units: { USD: [inst(/* from the 10-K: the figure that makes the total 31,012 */ 8_813)] } },
    });
    expect(p.total_debt).toBe(31_012);
  });

  it("RTX-shape: the including-current line DIFFERS from the noncurrent lease line, so the noncurrent line + all current debt is used", () => {
    // From RTX's FY2025 10-K: LongTermDebtAndCapitalLeaseObligations 31,858; …IncludingCurrentMaturities 37,154;
    // …Current 5,296; ShortTermBorrowings 229 — and whichever further current line the balance sheet carries so
    // the total equals its printed 37,904. Fill the missing current concept from the 10-K; do not fit the number.
    const p = fy2025({
      LongTermDebtAndCapitalLeaseObligations: { units: { USD: [inst(31_858)] } },
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: { units: { USD: [inst(37_154)] } },
      LongTermDebtAndCapitalLeaseObligationsCurrent: { units: { USD: [inst(5_296)] } },
      ShortTermBorrowings: { units: { USD: [inst(229)] } },
      /* + the 10-K's remaining current debt concept(s) */
    });
    expect(p.total_debt).toBe(37_904);
  });

  it("GE-shape: DebtLongtermAndShorttermCombinedAmount is the whole figure (nothing added)", () => {
    const p = fy2025({
      DebtLongtermAndShorttermCombinedAmount: { units: { USD: [inst(20_494)] } },
      ShortTermBorrowings: { units: { USD: [inst(1_000)] } }, // already inside the combined amount
    });
    expect(p.total_debt).toBe(20_494);
  });

  it("CME-shape: UnsecuredLongTermDebt + a zero LongTermDebtCurrent", () => {
    const p = fy2025({
      UnsecuredLongTermDebt: { units: { USD: [inst(3_422)] } },
      LongTermDebtCurrent: { units: { USD: [inst(0)] } },
    });
    expect(p.total_debt).toBe(3_422);
  });

  it("gap-shape: a zero current-only period is null when the filer tags a long-term concept in another period", () => {
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [fy(1_000), { start: "2024-01-01", end: "2024-12-31", val: 900, form: "10-K", filed: "2025-02-20" }] } },
      NetIncomeLoss: { units: { USD: [fy(100), { start: "2024-01-01", end: "2024-12-31", val: 90, form: "10-K", filed: "2025-02-20" }] } },
      LongTermDebtNoncurrent: { units: { USD: [inst(500)] } },                 // FY2025 only
      LongTermDebtCurrent: { units: { USD: [inst(0, "2024-12-31"), inst(0)] } }, // both years
    } } };
    const { annual } = parseCompanyFacts(facts);
    expect(annual.find((p) => p.fiscal_year === 2024)!.total_debt).toBeNull(); // a gap, not a zero
    expect(annual.find((p) => p.fiscal_year === 2025)!.total_debt).toBe(500);
  });

  it("DSP-shape: a filer that never tags a long-term concept keeps its honest zero (DSP FY22–FY25, PLTR, RDVT, LASR, AMSC)", () => {
    const p = fy2025({ LongTermDebtCurrent: { units: { USD: [inst(0)] } } });
    expect(p.total_debt).toBe(0);
    expect(p.net_debt).not.toBeNull();
  });

  it("existing shapes are unchanged: BSX, VST, AEIS, CSCO, NET", () => {
    const none = {
      ltdNoncurrent: null, ltdTotal: null, ltdLeaseNoncurrent: null, ltdCurrent: null, debtCurrent: null,
      shortTermBorrowings: null, convertibleNoncurrent: null, convertibleCurrent: null,
      ltdLeaseTotal: null, combinedTotal: null, unsecuredLtd: null,
    };
    const lt = { filerTagsLongTerm: true };
    expect(deriveTotalDebt({ ...none, ltdLeaseNoncurrent: 11_137, debtCurrent: 299 }, lt)).toBe(11_436);                         // BSX
    expect(deriveTotalDebt({ ...none, ltdTotal: 17_043, ltdLeaseNoncurrent: 15_842, ltdCurrent: 1_201, shortTermBorrowings: 1_800 }, lt)).toBe(18_843); // VST
    expect(deriveTotalDebt({ ...none, ltdTotal: 567.5, ltdCurrent: 567.5 }, lt)).toBe(567.5);                                     // AEIS
    expect(deriveTotalDebt({ ...none, ltdNoncurrent: 19_372, ltdTotal: 22_872, ltdCurrent: 3_500, debtCurrent: 10_161 }, lt)).toBe(29_533); // CSCO
    expect(deriveTotalDebt({ ...none, convertibleNoncurrent: 1_974.12, convertibleCurrent: 1_291.281 }, lt)).toBe(3_265.401);     // NET
    expect(deriveTotalDebt({ ...none, ltdCurrent: 100, shortTermBorrowings: 50 }, lt)).toBe(150);                                // non-zero current-only stays
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, lt)).toBeNull();                                                          // zero current-only in a filer with long-term tags → gap
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, { filerTagsLongTerm: false })).toBe(0);                                   // honest zero
  });
});
```

Also update the two existing `none` objects in `describe("deriveTotalDebt with the debt-and-lease line")` (line ~231) and `describe("deriveTotalDebt")` (line ~590) to include the three new keys (`ltdLeaseTotal: null, combinedTotal: null, unsecuredLtd: null`) and pass `{ filerTagsLongTerm: true }` as the second argument, otherwise TypeScript rejects the calls after Task 2.

- [ ] **Step 2: Run to confirm the new block fails**

Run: `npx vitest run lib/facts/free/sec.test.ts`
Expected: the new `it` blocks FAIL (`total_debt` null, the current-only figure, or the double-added total); every pre-existing test still PASSES. If a pre-existing test fails here, stop — the fixture helper has a typo.

- [ ] **Step 3: Commit the failing tests**

```powershell
git add lib/facts/free/sec.test.ts
git commit -m "test(sec): per-filer debt fixtures for CVX, RTX, GE, CME, TMO shapes (D-1)"
```

### Task 2: Add the four concept lists and extend `deriveTotalDebt`

**Files:**
- Modify: `lib/facts/free/sec.ts:142-162` (concept lists), `:438-467` (`RawValues`), `:471-496` (`deriveTotalDebt`), `:615-625` and `:648-655` (series + `rawAt`)
- Test: `lib/facts/free/sec.test.ts` (Task 1)

**Interfaces:**
- Produces: `deriveTotalDebt(r, opts)` now accepts `ltdLeaseTotal`, `combinedTotal`, `unsecuredLtd` (all `number | null`) in addition to the eight existing keys, and a second parameter `opts: { filerTagsLongTerm: boolean }` (whether ANY long-term concept — `LTD_NONCURRENT`, `LTD_TOTAL`, `LTD_LEASE_NONCURRENT`, `LTD_LEASE_TOTAL`, `DEBT_COMBINED_TOTAL`, `UNSECURED_LTD`, `CONVERTIBLE_NONCURRENT` — reports any period of the series). Return type stays `number | null`.

- [ ] **Step 1: Add the concept lists** (after `CONVERTIBLE_CURRENT`, line 162)

```ts
// Audit 2026-10-06 (D-1) and review 2026-10-07: total-debt concepts no list held. Each is read only when no
// higher-priority concept reports the period (see deriveTotalDebt), so the seven packs verified before this change
// (BSX, NET, ADI, VST, CSCO, AEIS, CALX) are untouched — scripts/debt-sweep.ts proves it offline.
//   - LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities already holds its current portion. CVX and
//     SCHW tag it AND LongTermDebtAndCapitalLeaseObligations at the SAME value (one balance-sheet line tagged
//     twice: CVX FY2025 39,781 = 39,781; SCHW 22,199 = 22,199), beside a DebtCurrent that is a note subtotal before
//     reclassification (CVX 10,918). Adding DebtCurrent there overstates by 24–34%; only short-term borrowings /
//     commercial paper may be added. When the two lease lines differ (RTX: 31,858 vs 37,154), the noncurrent
//     line + all current debt is the right read, as today.
//   - DebtLongtermAndShorttermCombinedAmount is the whole figure, long and short (GE 10-Q $20,494M).
//   - UnsecuredLongTermDebt is CME's only long-term line ($3,422M at FY2025); its LongTermDebtCurrent is 0.
// DebtInstrumentCarryingAmount was considered and DROPPED (review F-5): it is a note-level, often subset figure
// (CVX 30,922; SCHW 22,237) with no filer that needs it. UnsecuredDebt likewise waits for a fixture.
// ShortTermBankLoansAndNotesPayable (DOW: 90) is also unlisted; DOW's FY2025 reads 18,071 against a 18,161 balance
// sheet. Add it only with a fixture.
const LTD_LEASE_TOTAL = ["LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"];
const DEBT_COMBINED_TOTAL = ["DebtLongtermAndShorttermCombinedAmount"];
const UNSECURED_LTD = ["UnsecuredLongTermDebt"];
```

- [ ] **Step 2: Extend `RawValues`** (after `convertibleCurrent: number | null;`)

```ts
  ltdLeaseTotal: number | null;
  combinedTotal: number | null;
  unsecuredLtd: number | null;
```

- [ ] **Step 3: Rewrite `deriveTotalDebt`**

```ts
/**
 * Total debt for one period, by the first concept group that reports it:
 *   0. both lease lines (noncurrent and including-current) report the period with the SAME value → that value is
 *      the all-in balance-sheet line (CVX, SCHW); add only short-term borrowings / commercial paper, never DebtCurrent;
 *   1. LongTermDebtNoncurrent + all current debt;
 *   2. LongTermDebt (already holds its current portion) + non-long-term current debt only;
 *   3. LongTermDebtAndCapitalLeaseObligations (noncurrent) + all current debt (RTX, BSX);
 *   4. …IncludingCurrentMaturities alone when it is the only lease line (holds its current portion) + non-long-term current debt only;
 *   5. DebtLongtermAndShorttermCombinedAmount alone (it is the whole figure);
 *   6. UnsecuredLongTermDebt + all current debt;
 *   7. convertible notes: noncurrent convertibles + all current debt (else current convertibles);
 *   8. current debt alone. A zero current-only figure is null when the filer tags a long-term concept in some
 *      other period of the series (a gap in the tags, e.g. CME FY2023 before UnsecuredLongTermDebt is read); a
 *      filer that never tags a long-term concept (DSP, PLTR, RDVT, LASR, AMSC) keeps its honest 0.
 * Null when no debt concept reports the period.
 */
export function deriveTotalDebt(
  r: Pick<
    RawValues,
    | "ltdNoncurrent" | "ltdTotal" | "ltdLeaseNoncurrent" | "ltdCurrent" | "debtCurrent" | "shortTermBorrowings"
    | "convertibleNoncurrent" | "convertibleCurrent" | "ltdLeaseTotal" | "combinedTotal" | "unsecuredLtd"
  >,
  opts: { filerTagsLongTerm: boolean },
): number | null {
  const otherCurrent =
    r.debtCurrent != null && r.ltdCurrent != null ? r.debtCurrent - r.ltdCurrent : r.shortTermBorrowings;
  const allCurrent =
    r.debtCurrent ??
    (r.ltdCurrent == null && r.shortTermBorrowings == null ? null : (r.ltdCurrent ?? 0) + (r.shortTermBorrowings ?? 0));
  if (r.ltdLeaseTotal != null && r.ltdLeaseNoncurrent != null && r.ltdLeaseTotal === r.ltdLeaseNoncurrent)
    return r.ltdLeaseTotal + (r.shortTermBorrowings ?? 0);
  if (r.ltdNoncurrent != null) return r.ltdNoncurrent + (allCurrent ?? 0);
  if (r.ltdTotal != null) return r.ltdTotal + (otherCurrent ?? 0);
  if (r.ltdLeaseNoncurrent != null) return r.ltdLeaseNoncurrent + (allCurrent ?? 0);
  if (r.ltdLeaseTotal != null) return r.ltdLeaseTotal + (otherCurrent ?? 0);
  if (r.combinedTotal != null) return r.combinedTotal;
  if (r.unsecuredLtd != null) return r.unsecuredLtd + (allCurrent ?? 0);
  const current = allCurrent ?? r.convertibleCurrent;
  if (r.convertibleNoncurrent != null) return r.convertibleNoncurrent + (current ?? 0);
  if (current == null) return null;
  return current === 0 && opts.filerTagsLongTerm ? null : current;
}
```

Rule 0 is deliberately narrow (exact equality of the two lease lines for the period). CVX FY2025: 39,781 + `shortTermBorrowings` — `SHORT_TERM_BORROWINGS` is `["ShortTermBorrowings", "CommercialPaper"]` merged per period, so `ShortTermBorrowings` 977 wins over `CommercialPaper` 4,642 → 40,758, the balance sheet. If a CVX year tags only `CommercialPaper` for the period, the merge takes it — reconcile each FY column (Task 11 Step 5). RTX stays on rule 3 because its lines differ. The Task 2b diagnosis may add a rule for the TMO shape; keep rule numbers stable.

- [ ] **Step 4: Wire the three series and the series-level flag into `parseCompanyFacts` and `rawAt`**

After `const convertibleCurrent = instantSeries(facts, CONVERTIBLE_CURRENT);`:

```ts
  const ltdLeaseTotal = instantSeries(facts, LTD_LEASE_TOTAL);
  const combinedTotal = instantSeries(facts, DEBT_COMBINED_TOTAL);
  const unsecuredLtd = instantSeries(facts, UNSECURED_LTD);
  // Does the filer tag ANY long-term debt concept anywhere in its history? Decides whether a zero current-only
  // period is a gap (null) or an honest zero (see deriveTotalDebt rule 8). Modelled on combineDa's tagsAmortization.
  const filerTagsLongTerm = [ltdNoncurrent, ltdTotal, ltdLeaseNoncurrent, ltdLeaseTotal, combinedTotal, unsecuredLtd, convertibleNoncurrent]
    .some((s) => s.annual.size > 0 || s.quarter.size > 0);
```

In `rawAt`, after `convertibleCurrent: at(...)`:

```ts
    ltdLeaseTotal: at(ltdLeaseTotal[side] as Map<K, UnitEntry>, key),
    combinedTotal: at(combinedTotal[side] as Map<K, UnitEntry>, key),
    unsecuredLtd: at(unsecuredLtd[side] as Map<K, UnitEntry>, key),
```

`deriveFields(r)` becomes `deriveFields(r, { filerTagsLongTerm })` and passes the option through to `deriveTotalDebt`; update its two call sites (annual rows, real quarter rows).

- [ ] **Step 5: Run the file's tests**

Run: `npx vitest run lib/facts/free/sec.test.ts`
Expected: PASS, including the LLY fixture tests (LLY tags `LongTermDebtNoncurrent`, so step 1 still wins: `42_503_000_000`).

- [ ] **Step 6: Run the whole free-path and mapper suites**

Run: `npx vitest run lib/facts`
Expected: PASS. `emit.test.ts` and `scripts/facts-free.test.ts` exercise the emitted shape, which is unchanged.

- [ ] **Step 7: Commit**

```powershell
git add lib/facts/free/sec.ts lib/facts/free/sec.test.ts
git commit -m "fix(sec): same-value lease lines are all-in; read combined and unsecured debt totals; zero current-only debt is null only in a gap (D-1)"
```

### Task 2b: Diagnose and fix the OVERSTATED packs (GE 22,180 vs 20,494; TMO 42,705 vs 39,385) — review F-2

**Files:**
- Modify: `lib/facts/free/sec.ts` (`deriveTotalDebt`, one more rule or concept-order change, decided by the diagnosis), `lib/facts/free/sec.test.ts` (GE and TMO fixtures from their 10-Ks)

**Interfaces:** unchanged from Task 2.

- [ ] **Step 1: Diagnose which concepts produced 22,180 and 42,705** (offline; no SEC call)

Run the Task 6 sweep in verbose mode once it exists, or list the concepts directly:

```powershell
foreach ($t in "GE","TMO") { $d = Get-ChildItem "data/raw/$t" -Directory | Select-Object -First 1; Select-String -Path (Join-Path $d.FullName "edgar-10k-primary.html") -Pattern 'name="us-gaap:[A-Za-z]*(Debt|Borrow|NotesPayable|CommercialPaper)[A-Za-z]*"' -AllMatches | % { $_.Matches.Value } | sort -Unique }
```

Then read each concept's FY2025 (GE: FY2025 10-K; TMO: FY2025 10-K) non-dimensioned instant value from the same file and write down the arithmetic the current `deriveTotalDebt` performs. The reviewer's finding for TMO: `LongTermDebt` 39,172 already includes current maturities and `DebtCurrent` 3,533 was added on top (rule 2 adds `otherCurrent` = `DebtCurrent − LongTermDebtCurrent` when both report, else `ShortTermBorrowings`; so either TMO tags `LongTermDebtCurrent` 0 or an equivalent). TMO tags `LongTermDebt` non-dimensioned. Balance sheet: 39,385 (= 39,172 + 213 of short-term). For GE (`DebtLongtermAndShorttermCombinedAmount` 20,494 in the 10-Q) find what summed to 22,180 — most likely a noncurrent line + `DebtCurrent` where the combined amount already holds both; rule 5 only fires when rules 1–4 do not.

- [ ] **Step 2: Write the two fixtures from the 10-K values with the balance-sheet totals as expectations**

```ts
  it("TMO-shape: LongTermDebt includes current maturities; DebtCurrent is not added on top", () => {
    const p = fy2025({
      LongTermDebt: { units: { USD: [inst(39_172)] } },
      DebtCurrent: { units: { USD: [inst(3_533)] } },
      /* + whatever LongTermDebtCurrent / ShortTermBorrowings the 10-K tags (the short-term piece is 213) */
    });
    expect(p.total_debt).toBe(39_385);
  });

  it("GE-shape (10-K): the combined amount wins over a noncurrent line + DebtCurrent that double-counts", () => {
    const p = fy2025({ /* the GE 10-K concepts found in Step 1 */ });
    expect(p.total_debt).toBe(20_494);
  });
```

- [ ] **Step 3: Run** `npx vitest run lib/facts/free/sec.test.ts` — Expected: the two new tests FAIL with 42,705 / 22,180.

- [ ] **Step 4: Fix with the narrowest rule the diagnosis supports.** Candidates, in order of preference: (a) when `LongTermDebt` and `DebtCurrent` both report and `LongTermDebtCurrent` does not, `DebtCurrent` is not a non-long-term subtotal, so rule 2 adds only `ShortTermBorrowings`/`CommercialPaper`; (b) rank `DebtLongtermAndShorttermCombinedAmount` above the noncurrent-plus-current paths when it reports the period (it is by definition the whole figure). Whichever is chosen, re-run the Task 1 and the pre-existing tests: AEIS (`LongTermDebt` = `LongTermDebtCurrent` 567.5), CSCO and VST must be unchanged, and the Task 6 sweep must still print zero mismatches on the seven verified names.

- [ ] **Step 5: Run** `npx vitest run lib/facts` — Expected: PASS.
- [ ] **Step 6: Commit** `git add lib/facts/free/sec.ts lib/facts/free/sec.test.ts; git commit -m "fix(sec): stop double-adding DebtCurrent on LongTermDebt-inclusive filers (TMO) and on combined-amount filers (GE)"`

### Task 3: Align the existing current-only `deriveTotalDebt` test with the zero-vs-gap rule

**Files:**
- Modify: `lib/facts/free/sec.test.ts:619-622` (`"falls back to current debt alone, and is null when nothing is tagged"`)

- [ ] **Step 1: Extend that test with both zero cases**

```ts
  it("falls back to current debt alone; a zero current-only figure is null in a filer with long-term tags elsewhere, 0 otherwise", () => {
    const lt = { filerTagsLongTerm: true }, noLt = { filerTagsLongTerm: false };
    expect(deriveTotalDebt({ ...none, ltdCurrent: 100e6, shortTermBorrowings: 50e6 }, lt)).toBe(150e6);
    expect(deriveTotalDebt(none, lt)).toBeNull();
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, lt)).toBeNull();                   // gap (CME FY2023 before UnsecuredLongTermDebt)
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0, shortTermBorrowings: 0 }, lt)).toBeNull();
    expect(deriveTotalDebt({ ...none, debtCurrent: 0 }, lt)).toBeNull();
    expect(deriveTotalDebt({ ...none, ltdCurrent: 0 }, noLt)).toBe(0);                    // honest zero (DSP-shape)
    expect(deriveTotalDebt({ ...none, debtCurrent: 0 }, noLt)).toBe(0);
  });
```

- [ ] **Step 2: Run** `npx vitest run lib/facts/free/sec.test.ts` — Expected: PASS.
- [ ] **Step 3: Commit** `git commit -am "test(sec): zero current-only debt — gap vs honest zero"`

### Task 4: TTM consecutiveness check (D-7)

**Files:**
- Modify: `lib/facts/free/ttm.ts:48-67`
- Test: `lib/facts/free/ttm.test.ts`

**Interfaces:**
- Produces: `computeTtm(quarters, yh)` unchanged signature. New exported constant `TTM_SPAN_DAYS = { lo: 250, hi: 300 }` (same bounds `lib/facts/shibui-check.ts` uses for Shibui's TTM).

- [ ] **Step 1: Write the failing tests** (append to `ttm.test.ts`)

```ts
describe("computeTtm requires the last four quarters to be consecutive (D-7)", () => {
  // V-shape, captured 2026-09-21 before the non-December Q4 derivation: no September quarter at all.
  const gapped = [
    q({ report_date: "2025-06-30" }), q({ report_date: "2025-12-31" }),
    q({ report_date: "2026-03-31" }), q({ report_date: "2026-06-30" }),
  ];

  it("nulls every summed metric when the four quarters span more than ~300 days", () => {
    const t = computeTtm(gapped, { price: 100, marketCap: 4000, dividendYield: 0.01, trailingPe: 31.3 });
    expect(t.keyMetrics.price_to_sales).toBeNull();
    expect(t.keyMetrics.ev_to_ebitda).toBeNull();
    expect(t.keyMetrics.free_cash_flow_yield).toBeNull();
    expect(t.ratios.net_margin).toBeNull();
    expect(t.ratios.gross_margin).toBeNull();
    expect(t.ratios.operating_margin).toBeNull();
    expect(t.ratios.net_debt_to_ebitda).toBeNull();
    expect(t.ratios.interest_coverage).toBeNull();
  });

  it("keeps the balance-sheet ratios and falls back to Yahoo's trailing P/E", () => {
    const t = computeTtm(gapped, { price: 100, marketCap: 4000, dividendYield: 0.01, trailingPe: 31.3 });
    expect(t.ratios.current_ratio).toBeCloseTo(2, 6);
    expect(t.ratios.dividend_yield).toBe(0.01);
    expect(t.keyMetrics.pe_ratio).toBe(31.3);
  });

  it("accepts a 52/53-week filer whose four quarter ends span 250–300 days", () => {
    const fiftyTwo = [
      q({ report_date: "2025-09-27" }), q({ report_date: "2025-12-27" }),
      q({ report_date: "2026-03-28" }), q({ report_date: "2026-06-27" }),
    ];
    const t = computeTtm(fiftyTwo, { price: 100, marketCap: 4000, dividendYield: 0.01 });
    expect(t.ratios.net_margin).toBeCloseTo(120 / 400, 6);
  });

  it("uses the latest four by report_date even when more than four are supplied", () => {
    const five = [q({ report_date: "2025-06-30", revenue: 999 }), ...[
      q({ report_date: "2025-09-30" }), q({ report_date: "2025-12-31" }),
      q({ report_date: "2026-03-31" }), q({ report_date: "2026-06-30" }),
    ]];
    const t = computeTtm(five, { price: 100, marketCap: 4000, dividendYield: 0.01 });
    expect(t.keyMetrics.price_to_sales).toBeCloseTo(4000 / 400, 6); // the 999 quarter is outside the window
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/facts/free/ttm.test.ts` — Expected: the first test FAILS (today P/S is `4000/400`), the other three PASS already.

- [ ] **Step 3: Implement**

In `ttm.ts`, after the `safeDiv` helper:

```ts
/** Four consecutive quarter ends span ~273 days; outside this range the window has a gap (see shibui-check.ts). */
export const TTM_SPAN_DAYS = { lo: 250, hi: 300 } as const;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
```

In `computeTtm`, after `const latest = last4[last4.length - 1];`:

```ts
  // D-7: the last four rows are a trailing twelve months only when they are consecutive quarters. V's
  // 2026-09-21 capture had no September quarter, so Jun-25 + Dec-25 + Mar-26 + Jun-26 were summed as
  // a year. A gapped window nulls every summed metric; balance-sheet ratios and the Yahoo P/E stand.
  const span = daysBetween(last4[0].report_date, latest.report_date);
  const consecutive = span >= TTM_SPAN_DAYS.lo && span <= TTM_SPAN_DAYS.hi;
  const sum4 = (field: FlowField) => (consecutive ? sum(last4, field) : null);
```

Replace the nine `sum(last4, "…")` calls with `sum4("…")`.

- [ ] **Step 4: Run** `npx vitest run lib/facts/free/ttm.test.ts lib/facts/free/emit.test.ts scripts/facts-free.test.ts` — Expected: PASS.

- [ ] **Step 5: Check the mapper tolerates all-null TTM rows**

`lib/facts/map/statements.ts:109-112` reads `key_metrics`/`ratios` with `optional: true`, so a null `price_to_sales` maps to `ttm.ps: null`. Confirm by running `npx vitest run lib/facts/map` — Expected: PASS. (If a validator in `lib/facts/validate.ts` requires `ttm.ps`, add the V-shape to `lib/facts/map/__fixtures__` and relax it; do not fabricate a value.)

- [ ] **Step 6: Commit**

```powershell
git add lib/facts/free/ttm.ts lib/facts/free/ttm.test.ts
git commit -m "fix(ttm): null the summed TTM metrics when the last four quarters are not consecutive (D-7)"
```

### Task 5: Shibui-fail gate with a recorded override (D-27)

**Design.** The override lives on the FactPack, not in the judgment: a `fail` is a data verdict about the pack, it must survive judgment rewrites, and the 2026-10-03 spec already proposed recording "SEC-verified, pack retained" on the pack. New optional field `crosscheckOverrides: [{ field, reason, verifiedAgainst, capturedAt }]`, stamped by `npm run facts:crosscheck -- <T> <ACC> --accept <field> --reason "<text>" --verified-against "<source>"`. `synth:build` refuses on any `fail` diff without a matching override; a `fail` with one prints as a warning that carries the reason into the errors file (the author and reviewer see it); a pack with no `shibuiCheck` warns `input check: none`.

**Files:**
- Create: `lib/synth/crosscheck-gate.ts`, `lib/synth/crosscheck-gate.test.ts`
- Modify: `lib/facts/schema.ts` (after the `shibuiCheck` block, ~line 64-75), `lib/facts/shibui-check.ts` (export the override type + `stampCrosscheckOverride`), `scripts/facts-crosscheck.ts`, `scripts/synth-build.ts:86-101`

**Interfaces:**
- Produces:
  ```ts
  export interface CrosscheckOverride { field: CrossCheckField; reason: string; verifiedAgainst: string; capturedAt: string }
  export function crosscheckGate(pack: { shibuiCheck?: ShibuiCheck; crosscheckOverrides?: CrosscheckOverride[] }):
    { blocked: boolean; errors: string[]; warnings: string[] }
  export function stampCrosscheckOverride<T extends { crosscheckOverrides?: CrosscheckOverride[]; provenance?: … }>(pack: T, o: CrosscheckOverride): T
  ```

- [ ] **Step 1: Write the failing gate tests** (`lib/synth/crosscheck-gate.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { crosscheckGate } from "./crosscheck-gate";

const check = (diffs: { field: "price" | "marketCap" | "sharesOutstanding" | "revenueQuarter" | "fcfTtm"; level: "ok" | "warn" | "fail"; pack: number; shibui: number; relDiff: number }[]) => ({
  asOf: "2026-09-23", quarterEnd: "2026-06-30", price: 1, marketCap: 1, sharesOutstanding: 1, revenueQuarter: 1, fcfTtm: 1, sbcTtm: null, diffs, source: "shibui" as const,
});

describe("crosscheckGate (D-27)", () => {
  it("blocks on a fail without an override, naming the field and both figures", () => {
    const g = crosscheckGate({ shibuiCheck: check([{ field: "revenueQuarter", level: "fail", pack: 451e6, shibui: 2149e6, relDiff: 0.7901 }]) });
    expect(g.blocked).toBe(true);
    expect(g.errors[0]).toMatch(/revenueQuarter/);
    expect(g.errors[0]).toMatch(/79%/);
  });

  it("passes a fail that has an accepted override and surfaces the reason as a warning", () => {
    const g = crosscheckGate({
      shibuiCheck: check([{ field: "fcfTtm", level: "fail", pack: 702e6, shibui: 1049e6, relDiff: 0.3308 }]),
      crosscheckOverrides: [{ field: "fcfTtm", reason: "Shibui mixes Q3'25 as originally reported with a recast Q4 plug; pack equals continuing-ops SEC figure", verifiedAgainst: "10-Q 0001666700-26-000053", capturedAt: "2026-10-03T00:00:00.000Z" }],
    });
    expect(g.blocked).toBe(false);
    expect(g.errors).toEqual([]);
    expect(g.warnings[0]).toMatch(/override.*fcfTtm.*recast Q4 plug/);
  });

  it("an override for a different field does not cover the fail", () => {
    const g = crosscheckGate({
      shibuiCheck: check([{ field: "revenueQuarter", level: "fail", pack: 1, shibui: 2, relDiff: 0.5 }]),
      crosscheckOverrides: [{ field: "fcfTtm", reason: "x", verifiedAgainst: "y", capturedAt: "2026-10-03T00:00:00.000Z" }],
    });
    expect(g.blocked).toBe(true);
  });

  it("warn levels never block", () => {
    const g = crosscheckGate({ shibuiCheck: check([{ field: "price", level: "warn", pack: 100, shibui: 85, relDiff: 0.17 }]) });
    expect(g.blocked).toBe(false);
    expect(g.warnings[0]).toMatch(/warn price/);
  });

  it("a pack with no shibuiCheck is a warning, not a block", () => {
    const g = crosscheckGate({});
    expect(g.blocked).toBe(false);
    expect(g.warnings).toEqual(["input check (Shibui): none on this pack"]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/synth/crosscheck-gate.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure gate** (`lib/synth/crosscheck-gate.ts`)

```ts
/**
 * crosscheck-gate.ts — the build refuses a FactPack whose Shibui cross-check holds a `fail` the owner has not
 * accepted. Audit 2026-10-06 (D-27): CFG was published on a fee-revenue subset five days after the check had
 * stamped `revenueQuarter 79% fail`, because the levels gated nothing. An accepted fail is recorded on the pack
 * (`crosscheckOverrides`, stamped by `facts:crosscheck --accept`) with the reason and what it was verified against.
 */
import type { ShibuiCheck } from "../facts/shibui-check";
import type { CrosscheckOverride } from "../facts/shibui-check";
import { compactNumber } from "./intrinsic";

export interface CrosscheckGateResult { blocked: boolean; errors: string[]; warnings: string[] }

export function crosscheckGate(pack: { shibuiCheck?: ShibuiCheck; crosscheckOverrides?: CrosscheckOverride[] }): CrosscheckGateResult {
  const sc = pack.shibuiCheck;
  if (!sc) return { blocked: false, errors: [], warnings: ["input check (Shibui): none on this pack"] };
  const overrides = new Map((pack.crosscheckOverrides ?? []).map((o) => [o.field, o]));
  const errors: string[] = [], warnings: string[] = [];
  for (const d of sc.diffs) {
    if (d.level === "ok") continue;
    const line = `${d.level === "fail" ? "FAIL" : "warn"} ${d.field} ${compactNumber(d.pack)} vs ${compactNumber(d.shibui)} (${(Math.abs(d.relDiff) * 100).toFixed(0)}%)`;
    if (d.level !== "fail") { warnings.push(`input check (Shibui, ${sc.asOf}): ${line}`); continue; }
    const o = overrides.get(d.field);
    if (o) warnings.push(`input check (Shibui, ${sc.asOf}): ${line} — override accepted for ${d.field}: ${o.reason} [verified against ${o.verifiedAgainst}, ${o.capturedAt.slice(0, 10)}]`);
    else errors.push(`input check (Shibui, ${sc.asOf}): ${line} — a fail blocks the build; verify the pack against the filing and record the verdict with: npm run facts:crosscheck -- <TICKER> <ACCESSION> --accept ${d.field} --reason "<why the pack is right>" --verified-against "<filing or source>"`);
  }
  return { blocked: errors.length > 0, errors, warnings };
}
```

(`compactNumber` is exported from `lib/synth/intrinsic.ts`; `synth-build.ts` already imports it from there.)

- [ ] **Step 4: Add the type and stamper to `lib/facts/shibui-check.ts`** (append)

```ts
/** An owner-accepted `fail`: the pack was verified against the filing and kept. Stamped by facts:crosscheck --accept. */
export interface CrosscheckOverride { field: CrossCheckField; reason: string; verifiedAgainst: string; capturedAt: string }

/** Add or replace the override for one field (mutates and returns the pack); provenance carries a matching row. */
export function stampCrosscheckOverride<T extends CheckStampable & { crosscheckOverrides?: CrosscheckOverride[] }>(pack: T, o: CrosscheckOverride): T {
  if (!o.reason.trim() || !o.verifiedAgainst.trim()) throw new Error("an override needs a non-empty --reason and --verified-against");
  pack.crosscheckOverrides = [...(pack.crosscheckOverrides ?? []).filter((x) => x.field !== o.field), o];
  const field = `crosscheckOverrides.${o.field}`;
  if (pack.provenance) pack.provenance = pack.provenance.filter((p) => p.field !== field);
  pack.provenance?.push({ field, source: "edgar", capturedAt: o.capturedAt, endpoint: `accepted Shibui fail on ${o.field}: ${o.reason} (verified against ${o.verifiedAgainst})` });
  return pack;
}
```

Add a test to `lib/facts/shibui-check.test.ts`:

```ts
describe("stampCrosscheckOverride", () => {
  it("records the override once per field and a provenance row", () => {
    const pack = { provenance: [] as { field: string; source: string; endpoint: string; capturedAt: string }[] };
    stampCrosscheckOverride(pack, { field: "fcfTtm", reason: "r1", verifiedAgainst: "10-Q", capturedAt: "2026-10-07T00:00:00.000Z" });
    stampCrosscheckOverride(pack, { field: "fcfTtm", reason: "r2", verifiedAgainst: "10-Q", capturedAt: "2026-10-07T00:00:00.000Z" });
    expect((pack as { crosscheckOverrides?: unknown[] }).crosscheckOverrides).toHaveLength(1);
    expect(pack.provenance.filter((p) => p.field === "crosscheckOverrides.fcfTtm")).toHaveLength(1);
  });
  it("refuses an empty reason", () => {
    expect(() => stampCrosscheckOverride({}, { field: "price", reason: " ", verifiedAgainst: "x", capturedAt: "2026-10-07T00:00:00.000Z" })).toThrow(/non-empty/);
  });
});
```

- [ ] **Step 5: Schema** — in `lib/facts/schema.ts`, after the `shibuiCheck` object (keep it optional):

```ts
  // Owner-accepted Shibui `fail`s (lib/synth/crosscheck-gate.ts): the pack was verified against the filing and kept.
  crosscheckOverrides: z.array(z.object({
    field: z.enum(["price", "marketCap", "sharesOutstanding", "revenueQuarter", "fcfTtm"]),
    reason: z.string().min(1), verifiedAgainst: z.string().min(1), capturedAt: z.string(),
  })).optional(),
```

Run `npx vitest run lib/facts` — Expected: PASS (the fixture packs under `lib/synth/__fixtures__/packs` carry no overrides; an optional field adds nothing).

- [ ] **Step 6: CLI** — in `scripts/facts-crosscheck.ts`, replace the `const [tickerArg, accession, flag]` parse with an args scan and add the `--accept` branch before the `--apply` branch:

```ts
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && !["--accept", "--reason", "--verified-against", "--from"].includes(args[i - 1]));
const [tickerArg, accession] = positional;
const flag = args.includes("--apply") ? "--apply" : args.includes("--accept") ? "--accept" : undefined;
// usage line becomes:
// npm run facts:crosscheck -- <TICKER> <ACCESSION> [--apply [--from <batch.json>]] | [--accept <field> --reason "<text>" --verified-against "<source>"]
```

`--accept` branch:

```ts
if (flag === "--accept") {
  const field = opt("--accept") as CrossCheckField, reason = opt("--reason") ?? "", verifiedAgainst = opt("--verified-against") ?? "";
  const { atime, mtime } = statSync(packPath);
  stampCrosscheckOverride(pack, { field, reason, verifiedAgainst, capturedAt: new Date().toISOString() });
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + "\n");
  utimesSync(packPath, atime, mtime);
  console.log(`${packPath}: accepted Shibui fail on ${field} — ${reason}`);
  process.exit(0);
}
```

`--from <batch.json>` (needed in Phase 2 because these packs were stamped from `data/raw/_shibui/crosscheck-backfill-2026-10-03.json`, not from a per-ticker file): when present, read rows from that file instead of `rawPath`; the key lookup is unchanged.

Add to `scripts/facts-free.test.ts` (or a new `scripts/facts-crosscheck.test.ts`) a spawn-free test that imports nothing from the script but asserts the pure pieces: `crosscheckGate` + `stampCrosscheckOverride` round-trip — already covered by Steps 1 and 4. The CLI is exercised by hand in Step 8.

- [ ] **Step 7: Wire into `scripts/synth-build.ts`** — replace lines 86-95 (`shibuiWarning`) with:

```ts
import { crosscheckGate } from "../lib/synth/crosscheck-gate";
// …
// Independent input check (Shibui): a `fail` without an accepted override refuses the build (D-27); warns and
// accepted fails are surfaced so author and reviewer see them. A guarded-input fail still abstains the reverse DCF.
const packFacts: IntrinsicFacts = pack;
const cg = crosscheckGate(pack);
const dcfAbstained = inputCheckReason(packFacts) && dcfApplicable(pack).reason === inputCheckReason(packFacts);
const shibuiWarnings = cg.warnings.map((w, i) => (i === 0 && dcfAbstained ? `${w} — reverse DCF abstained` : w));
extraWarnings = [
  ...(gateWarning ? [gateWarning] : []),
  ...shibuiWarnings,
  `decision: …` // unchanged
];
```

and, immediately after `const errors = [...issues, ...lint.filter(...)]` (line 116):

```ts
if (cg.blocked) fail(cg.errors.map((m) => ({ field: "shibuiCheck", message: m, value: null })), warnings, "input check");
```

The build now refuses before the editorial gate; `--skip-review` does not bypass it (there is no flag to skip a data verdict).

- [ ] **Step 8: Hand-check the gate on CFG and on an accepted fail (read-only for the pack; the build writes only `data/cfg.json`, which `git checkout` restores)**

Run: `npm run synth:build -- CFG 0000759944-26-000148 --skip-review`
Expected: `input check: 1 issue(s)` naming `revenueQuarter 451.0M vs 2.1B (79%)` and the `--accept` hint; exit code 1; `data/cfg.json` unchanged.
Then delete the rewritten `data/judgment/CFG/0000759944-26-000148.errors.txt` (`*.errors.txt` is gitignored, so a plain `Remove-Item` is enough; nothing to check out). The `FactPack` schema is a plain `z.object`, so the new optional `crosscheckOverrides` field is safe on every existing pack.
Do NOT accept CFG's fail — it is a real bug (D-4) fixed by re-capture in Phase 2.

- [ ] **Step 9: Run the synth suite** `npx vitest run lib/synth scripts` — Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add lib/synth/crosscheck-gate.ts lib/synth/crosscheck-gate.test.ts lib/facts/shibui-check.ts lib/facts/shibui-check.test.ts lib/facts/schema.ts scripts/facts-crosscheck.ts scripts/synth-build.ts
git commit -m "feat(synth): refuse a build on an unaccepted Shibui fail; record accepted fails on the pack (D-27)"
```

### Task 5b: Apply the held-name Shibui-fail dispositions BEFORE the gate reaches `main` (owner's answer 2026-10-07)

**Why.** Once the gate is live, a pack with an unaccepted `fail` cannot be re-synthesized at its next filing, and a held name that cannot be re-synthesized drifts toward the 150-day staleness exit (`stalenessMaxDays`). The owner wants the five HELD names reviewed now, not at a later STOP. A separate read-only agent is reconciling each fail against the filing in parallel; this task only applies what that agent returns.

**Files:**
- Modify (data only, via the CLI from Task 5): `data/facts/BAC/0000070858-26-000394.json`, `data/facts/BAM/0001628280-26-054933.json`, `data/facts/DD/0001666700-26-000053.json`, `data/facts/AMZN/0001018724-26-000026.json`, `data/facts/CEG/0001868275-26-000104.json` — only those whose disposition is "accept".

**Inputs:** the reconciliation agent's report, one line per name: `accept` with the reason and the filing it was verified against, or `investigate` with what is wrong in the pack. Expected shapes from the 2026-10-03 spec and the BAC memory: BAC `revenueQuarter` 57% (vendor revenue gross of interest expense — a definition); BAM `fcfTtm` 1,100% (Shibui put investing cash flow in its OCF field); DD `fcfTtm` 33% (Shibui mixes Q3'25 as originally reported with a recast Q4 plug); AMZN `fcfTtm` 53% and CEG `marketCap` 76% have no prior reconciliation and may come back `investigate`.

- [ ] **Step 1: Wait for the reconciliation report.** Do not accept a fail on a prior memory or on the spec alone; the accept text must quote the filing figure the agent read.

- [ ] **Step 2: For each `accept`,** run (the pack's mtime is preserved by the CLI, so `latestFactPack` ordering is unchanged):

```powershell
npm run facts:crosscheck -- BAC 0000070858-26-000394 --accept revenueQuarter --reason "<the agent's reason, with the filing figure>" --verified-against "<10-Q accession / 8-K ex. 99.1>"
```

and the same for BAM/DD (and AMZN/CEG if accepted). Then `npm run synth:build -- <T> <ACC> --skip-review` must no longer fail at `input check` (it may still fail or warn at later stages for unrelated reasons — note that and delete the rewritten `*.errors.txt`; `data/<t>.json` is rewritten by a passing `--skip-review` build, so `git checkout -- data/<t>.json` afterwards to leave the published report untouched).

- [ ] **Step 3: For each `investigate`,** do NOT accept. Record the finding in the STOP (a) report with the agent's reason, and list it under Task 15 as an open item the owner decides; the gate will block that name's next synthesis until it is resolved, which is the intended behaviour for an unreconciled input.

- [ ] **Step 4: Commit** `git add data/facts/BAC data/facts/BAM data/facts/DD <…>; git commit -m "facts: record accepted Shibui fails on held names (BAC, BAM, DD[, AMZN, CEG]) before the input-check gate lands"`

This task sits before the gate is merged (STOP (b) merge of the Phase 1+2 branch); CVLG (not held) keeps its disposition at Task 15.

### Task 6: Offline debt sweep over the previously verified packs (regression guard for concept order)

**Files:**
- Create: `scripts/debt-sweep.ts` (read-only; parses the captured iXBRL, calls no network, writes nothing)

**Interfaces:**
- Consumes: `parseFilingXbrl(html, { form, filed })` and `mergeFilingFacts(companyfacts, filingFacts)` from `lib/facts/free/filing-xbrl.ts`; `parseCompanyFacts` from `sec.ts`.

- [ ] **Step 1: Write the script**

```ts
/**
 * debt-sweep.ts — read-only regression check for the debt concept order (learnings §11: "a concept-order fix for
 * one filer can break another"). For each ticker it parses the captured filing iXBRL (edgar-primary.html and
 * edgar-10k-primary.html — no SEC call), runs parseCompanyFacts, and prints the FY total debt / cash / net debt
 * next to the published pack's values. A mismatch on BSX, NET, ADI, VST, CSCO, AEIS or CALX means the change
 * must not merge.
 *
 *   node --import tsx scripts/debt-sweep.ts BSX NET ADI VST CSCO AEIS CALX
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCompanyFacts } from "../lib/facts/free/sec";
import { parseFilingXbrl, mergeFilingFacts, type CompanyFactsLike } from "../lib/facts/free/filing-xbrl";

const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
if (!tickers.length) { console.error("usage: node --import tsx scripts/debt-sweep.ts <TICKER ...>"); process.exit(2); }
let mismatches = 0;
for (const t of tickers) {
  const accs = readdirSync(join("data", "raw", t)).filter((d) => existsSync(join("data", "raw", t, d, "edgar-primary.html")));
  for (const acc of accs) {
    const dir = join("data", "raw", t, acc);
    const meta = JSON.parse(readFileSync(join(dir, "edgar-filing.json"), "utf8")) as { form: "10-Q" | "10-K"; filedDate: string };
    let facts: CompanyFactsLike = { facts: { "us-gaap": {} } };
    facts = mergeFilingFacts(facts, parseFilingXbrl(readFileSync(join(dir, "edgar-primary.html"), "utf8"), { form: meta.form, filed: meta.filedDate }));
    const tenK = join(dir, "edgar-10k-primary.html");
    if (existsSync(tenK)) {
      const html = readFileSync(tenK, "utf8");
      const periodEnd = html.match(/name="dei:DocumentPeriodEndDate"[^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1] ?? "2000-01-01";
      facts = mergeFilingFacts(facts, parseFilingXbrl(html, { form: "10-K", filed: periodEnd }));
    }
    let sec: ReturnType<typeof parseCompanyFacts>;
    try { sec = parseCompanyFacts(facts); } catch (e) { console.log(`${t} ${acc}: cannot parse (${(e as Error).message})`); continue; }
    const packPath = join("data", "facts", t, `${acc}.json`);
    const pack = existsSync(packPath) ? JSON.parse(readFileSync(packPath, "utf8")) : null;
    const row = (key: string) => pack?.statements.balance.find((r: { key: string }) => r.key === key)?.values ?? [];
    const years: string[] = pack?.statements.fiscalYears ?? [];
    // EVERY fiscal-year column (review F-10), not only the latest: the 10-K iXBRL carries two balance-sheet years and
    // the 10-Q one; a column the iXBRL does not cover prints "n/a" and is not counted as a mismatch.
    years.forEach((fyLabel, i) => {
      const year = Number("20" + fyLabel.slice(2));
      const fy = sec.annual.find((p) => p.fiscal_year === year);
      const packDebt = row("totalDebt")[i] ?? null, packCash = row("cashAndInvestments")[i] ?? null;
      if (!fy) { console.log(`   ${t} ${fyLabel}: iXBRL n/a | pack totalDebt=${packDebt} cash+inv=${packCash}`); return; }
      const same = fy.total_debt === packDebt;
      if (!same) mismatches++;
      console.log(`${same ? "  " : "! "}${t} ${fyLabel}: iXBRL totalDebt=${fy.total_debt} cash+inv=${fy.cash_and_short_term_investments} netDebt=${fy.net_debt} | pack totalDebt=${packDebt} cash+inv=${packCash}`);
    });
    if (process.argv.includes("--concepts")) {
      const gaap = (facts.facts?.["us-gaap"] ?? {}) as Record<string, { units?: { USD?: { end: string; start?: string; val: number }[] } }>;
      for (const [c, node] of Object.entries(gaap)) if (/Debt|Borrow|NotesPayable|CommercialPaper/.test(c))
        console.log(`     ${c}: ${(node.units?.USD ?? []).filter((e) => !e.start).map((e) => `${e.end}=${e.val}`).join(", ")}`);
    }
  }
}
console.log(`\n${mismatches} mismatch(es).`);
process.exitCode = mismatches ? 1 : 0;
```

`--concepts` prints every debt-ish instant concept the iXBRL carries, per period — this is the diagnosis tool for Task 2b and for any name whose total does not reconcile.

Caveat for the implementer: the published packs were built from companyfacts + iXBRL, while the sweep uses iXBRL alone. A 10-K's iXBRL carries two balance-sheet years and the 10-Q's one, so three columns are compared at most; older columns print `n/a`. If `parseCompanyFacts` throws for a bank-shaped filer because the 10-K iXBRL lacks a revenue concept, print "cannot parse" and compare that name by the Phase 2 diff instead; none of the seven verified names is a bank.

- [ ] **Step 2: Run the sweep ON `main`'s code first, to prove the sweep reproduces the packs** (stash nothing — the script is new and untracked; check out the old `sec.ts` temporarily)

```powershell
git stash push -- lib/facts/free/sec.ts lib/facts/free/ttm.ts
node --import tsx scripts/debt-sweep.ts BSX NET ADI VST CSCO AEIS CALX
git stash pop
```

Expected: `0 mismatch(es)`. If the sweep cannot reproduce a pack even on the old code (an earlier-year-only difference, a `cannot parse`), note it and compare that name in Phase 2 by re-capture diff instead.

- [ ] **Step 3: Run the sweep on the new code**

Run: `node --import tsx scripts/debt-sweep.ts BSX NET ADI VST CSCO AEIS CALX`
Expected: `0 mismatch(es)`, identical lines to Step 2. Save both outputs to the scratchpad as `debt-sweep-before.txt` / `debt-sweep-after.txt` and attach them to the STOP (a) report.

- [ ] **Step 4: Also run the sweep on the twelve re-capture names plus SCHW** (read-only preview of what Phase 2 will produce)

Run: `node --import tsx scripts/debt-sweep.ts RTX XOM CVX ATO DOW CME USFD CSTM CFG V GE TMO SCHW --concepts`
Expected: `!` lines for the names whose packs are wrong today, with iXBRL FY2025 totals equal to the balance-sheet figures in Task 1: RTX 37,904; XOM 43,537; CVX 40,758 (and FY24 24,541); CME 3,422; USFD 5,200; CSTM 1,944; DOW 18,071 (balance sheet 18,161 — the 90 of `ShortTermBankLoansAndNotesPayable` is unlisted; note it in the STOP (a) report); ATO 8,919 (Sep-25); GE 20,494; TMO 39,385; SCHW ≈ 31,012. A name that still prints null, a current-only figure, or a total off the balance sheet is a STOP (a) finding: use the `--concepts` listing to find the concept, add it with a fixture (as in Task 1) before Phase 2; do not hand-edit a pack.

- [ ] **Step 5: Commit**

```powershell
git add scripts/debt-sweep.ts
git commit -m "chore(scripts): offline debt sweep over captured iXBRL (concept-order regression guard)"
```

### Task 7: `facts:free --keep-quote` — re-capture statements without moving the quote

**Why.** The FOUR/DSP precedent kept the original report date. A plain `facts:free` re-capture would stamp today's Yahoo price and `asOf`, so E/D/R (and possibly the label) would move for price reasons, and a report dated September 23 would show an October price. `--keep-quote` regenerates only the SEC-derived parts.

**Files:**
- Modify: `lib/facts/free/emit.ts` (add `yahooFromTearsheet`), `scripts/facts-free.ts`
- Test: `lib/facts/free/emit.test.ts`

**Interfaces:**
- Produces: `yahooFromTearsheet(tearsheet: unknown): { yahoo: YahooData; capturedAt: string }` — the inverse of the Yahoo blocks `buildTearsheetFiles` writes. `trailingPe` is taken from `fundamentals.key_metrics[0].pe_ratio` (a fallback only; `computeTtm` prefers the SEC EPS sum), `dividendYield` from `fundamentals.ratios[0].dividend_yield`.

- [ ] **Step 1: Failing round-trip test** — add it INSIDE the existing `describe("buildTearsheetFiles → real mappers (shape parity)")` block in `emit.test.ts`, after its last `it`, because `sec`, `yahoo`, `ttm` and `files` are `const`s scoped to that describe (review F-9):

```ts
  it("yahooFromTearsheet round-trips the Yahoo blocks of the emitted tearsheet (facts:free --keep-quote)", () => {
    const back = yahooFromTearsheet(files.tearsheetAnnual);
    expect(back.capturedAt).toBe(files.tearsheetAnnual.company_overview.timestamp);
    expect(back.yahoo.price).toBe(yahoo.price);
    expect(back.yahoo.marketCap).toBe(yahoo.marketCap);
    expect(back.yahoo.targets).toEqual(yahoo.targets);
    // parseQuoteSummary keeps estimate years whose sales and eps are both null; estimateRecords drops them, so the
    // round-trip is exact only after the same filter.
    expect(back.yahoo.estimates).toEqual(yahoo.estimates.filter((e) => e.sales != null || e.eps != null));
    const again = buildTearsheetFiles({ cik: files.tearsheetAnnual.company_overview.cik, sec, yahoo: back.yahoo, ttm, capturedAt: back.capturedAt });
    const strip = (t: unknown) => { const { fundamentals, ...rest } = t as Record<string, unknown>; return rest; };
    expect(JSON.stringify(strip(again.tearsheetAnnual))).toBe(JSON.stringify(strip(files.tearsheetAnnual)));
  });
```

(If `files.tearsheetAnnual` is typed `unknown` there, cast it once at the top of the test.)

- [ ] **Step 2: Run** `npx vitest run lib/facts/free/emit.test.ts` — Expected: FAIL (`yahooFromTearsheet` not exported).

- [ ] **Step 3: Implement in `emit.ts`**

```ts
/** Inverse of the Yahoo blocks buildTearsheetFiles writes, so a re-capture can keep the pack's quote (--keep-quote). */
export function yahooFromTearsheet(t: unknown): { yahoo: YahooData; capturedAt: string } {
  const ts = t as { company_overview: Record<string, unknown>; price_performance: { current_market: Record<string, number> }; analyst_data: { price_targets: Record<string, number>; ratings: Record<string, unknown> }; estimates: { records: { metric: "SALES" | "EPS"; fiscal_year: number; estimate_mean: number }[] }; fundamentals: { key_metrics: Record<string, unknown>[]; ratios: Record<string, unknown>[] } };
  const ov = ts.company_overview, pt = ts.analyst_data.price_targets, r = ts.analyst_data.ratings;
  const byYear = new Map<number, YahooEstimate>();
  for (const e of ts.estimates.records) {
    const row = byYear.get(e.fiscal_year) ?? { fiscal_year: e.fiscal_year, sales: null, eps: null };
    if (e.metric === "SALES") row.sales = e.estimate_mean; else row.eps = e.estimate_mean;
    byYear.set(e.fiscal_year, row);
  }
  const num = (x: unknown) => (typeof x === "number" ? x : null);
  return {
    capturedAt: String(ov.timestamp),
    yahoo: {
      price: ov.price as number, marketCap: ov.market_cap as number, companyName: ov.company_name as string,
      exchange: ov.exchange as string, description: ov.description as string,
      week52Low: ts.price_performance.current_market.year_low, week52High: ts.price_performance.current_market.year_high,
      dividendYield: num(ts.fundamentals.ratios[0]?.dividend_yield) ?? 0,
      targets: { consensus: pt.target_consensus, median: pt.target_median, high: pt.target_high, low: pt.target_low },
      trailingPe: num(ts.fundamentals.key_metrics[0]?.pe_ratio),
      ratings: { strong_buy: r.strong_buy as number, buy: r.buy as number, hold: r.hold as number, sell: r.sell as number, strong_sell: r.strong_sell as number, consensus: r.consensus as string },
      estimates: [...byYear.values()].sort((a, b) => a.fiscal_year - b.fiscal_year),
    },
  };
}
```

Check `YahooData` in `lib/facts/free/yahoo.ts:20-43` for any field this misses (e.g. a `shortName`), and add it from the tearsheet or as `null` where the type allows.

- [ ] **Step 4: Add the flag to `scripts/facts-free.ts`**

```ts
const args = process.argv.slice(2);
const keepQuote = args.includes("--keep-quote");
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
// usage: npm run facts:free -- <TICKER> <ACCESSION> [--keep-quote]
```

`scripts/facts-free.ts:82` already declares `const dir = join("data", "raw", ticker, accession)` just before the emit; move that one declaration up to right after the ticker parse (do not declare it twice), then replace the Yahoo fetch (`const yrawPending = fetchQuoteSummary(ticker)` … `const yahoo = parseQuoteSummary(yraw, { latestFY })`) with:

```ts
const existingTearsheet = join(dir, "bigdata-tearsheet-annual.json");
let yrawPending: Promise<unknown> | null = null;
if (keepQuote) {
  if (!existsSync(existingTearsheet)) { console.error(`--keep-quote needs an existing ${existingTearsheet}`); process.exit(2); }
} else {
  yrawPending = fetchQuoteSummary(ticker);
  yrawPending.catch(() => {});
}
// … SEC block unchanged …
const kept = keepQuote ? yahooFromTearsheet(JSON.parse(readFileSync(existingTearsheet, "utf8"))) : null;
const yahoo = kept ? kept.yahoo : parseQuoteSummary(await yrawPending!, { latestFY });
const capturedAt = kept ? kept.capturedAt : new Date().toISOString();
const ttm = computeTtm(sec.quarter, { price: yahoo.price, marketCap: yahoo.marketCap, dividendYield: yahoo.dividendYield, trailingPe: yahoo.trailingPe });
const files = buildTearsheetFiles({ cik, sec, yahoo, ttm, capturedAt });
```

and print `· quote kept from <capturedAt>` in the final line when `keepQuote`. Note: none of the thirteen raw directories holds `free-capture.json` today (they were captured before the marker existed and are detected by shape); the re-capture writes it, so `git add data/raw/<T>/<ACC>/` in Task 11 picks up a new file — expected.

- [ ] **Step 5: Run** `npx vitest run lib/facts/free scripts/facts-free.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/facts/free/emit.ts lib/facts/free/emit.test.ts scripts/facts-free.ts
git commit -m "feat(facts:free): --keep-quote regenerates SEC statements and TTM without moving the pack's quote"
```

### Task 7b: Persist the SEC companyfacts JSON per capture (D-9; owner default: yes, may be overridden at STOP (b))

**Why.** Today a re-run of `facts:free` re-downloads companyfacts, so no capture is reproducible offline and the Task 6 sweep has to work from the filing iXBRL alone. Saving the full response (gzipped) under the raw directory makes every later rebuild deterministic and lets the sweep use the same input the pack was built from.

**Files:**
- Modify: `scripts/facts-free.ts`, `lib/facts/manifest.ts` (export the filename constant only), `.gitattributes` (mark `*.json.gz` binary if not already)
- Test: `scripts/facts-free.test.ts`

**Interfaces:**
- Produces: `export const COMPANYFACTS_FILE = "sec-companyfacts.json.gz"` in `lib/facts/manifest.ts`. `facts:free` reads it when present and `--refetch` is absent; writes it after a successful fetch.

- [ ] **Step 1: Failing test** (in `scripts/facts-free.test.ts`, next to its existing pure-helper tests): a helper `loadOrFetchCompanyFacts(dir, cik, contact, { refetch }, fetchImpl)` returns the gunzipped JSON from `dir/sec-companyfacts.json.gz` without calling `fetchImpl` when the file exists; calls `fetchImpl` and writes the gzip when it does not or when `refetch` is true. Use a temp dir under the scratchpad and a stub `fetchImpl`.

- [ ] **Step 2: Implement** the helper in `scripts/facts-free.ts` (or `lib/facts/free/companyfacts-cache.ts` if the test wants a pure import) with `node:zlib` `gzipSync`/`gunzipSync`; wire it where `fetchCompanyFacts(cik, contact)` is called; add `--refetch` to the args parse and the usage line.

- [ ] **Step 3: Run** `npx vitest run scripts/facts-free.test.ts` — PASS. Size check: a large filer's companyfacts is 5–20 MB raw, ≈ 1–3 MB gzipped; thirteen files ≈ 30 MB in git — acceptable per the owner default, but list the sizes in the STOP (a) report.

- [ ] **Step 4: Commit** `git add scripts/facts-free.ts scripts/facts-free.test.ts lib/facts/manifest.ts .gitattributes; git commit -m "feat(facts:free): persist companyfacts JSON (gzipped) per capture; --refetch to bypass (D-9)"`

### Task 8: Pack-to-pack diff script with gate outcome

**Files:**
- Create: `scripts/facts-pack-diff.ts` (read-only)

**Interfaces:**
- Consumes: `evaluateGates(f: GateFacts)` from `lib/synth/gates.ts`; `crosscheckGate` from Task 5.

- [ ] **Step 1: Write the script**

```ts
/**
 * facts-pack-diff.ts — read-only before/after of two FactPack files (the same ticker and accession): balance-sheet
 * rows per fiscal year, the latest quarter, every TTM field, the Shibui diffs, and the fundamental gate on each.
 *
 *   node --import tsx scripts/facts-pack-diff.ts <before.json> <after.json>
 */
import { readFileSync } from "node:fs";
import { evaluateGates, type GateFacts } from "../lib/synth/gates";
import { crosscheckGate } from "../lib/synth/crosscheck-gate";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: node --import tsx scripts/facts-pack-diff.ts <before.json> <after.json>"); process.exit(2); }
type Row = { key: string; values: (number | null)[] };
type Pack = GateFacts & { quote: { price: number; asOf: string; marketCap: number }; latestQuarter: Record<string, unknown> | null; ttm: Record<string, number | null>; statements: { fiscalYears: string[]; balance: Row[]; income: Row[]; cashflow: Row[] }; shibuiCheck?: { diffs: { field: string; level: string; pack: number; shibui: number; relDiff: number }[] } };
const before = JSON.parse(readFileSync(a, "utf8")) as Pack, after = JSON.parse(readFileSync(b, "utf8")) as Pack;
const m = (x: number | null | undefined) => (x == null ? "—" : Math.abs(x) >= 1e6 ? `${(x / 1e6).toFixed(0)}M` : String(Math.round(x * 1000) / 1000));
let changed = 0;
const line = (label: string, x: unknown, y: unknown) => { const same = JSON.stringify(x) === JSON.stringify(y); if (!same) changed++; console.log(`${same ? "  " : "! "}${label.padEnd(40)} ${String(x).padEnd(22)} ${y}`); };

console.log(`quote: price ${before.quote.price} → ${after.quote.price}; asOf ${before.quote.asOf} → ${after.quote.asOf}  (must be unchanged under --keep-quote)`);
for (const sec of ["balance", "income", "cashflow"] as const)
  for (const key of ["totalDebt", "cashAndInvestments", "netDebt", "totalEquity", "revenue", "ebitda", "capex", "freeCashFlow"]) {
    const r1 = before.statements[sec].find((r) => r.key === key), r2 = after.statements[sec].find((r) => r.key === key);
    if (!r1 && !r2) continue;
    after.statements.fiscalYears.forEach((fy, i) => line(`${sec}.${key}[${fy}]`, m(r1?.values[i]), m(r2?.values[i])));
  }
for (const k of ["periodEnd", "revenue", "revenueYoY", "operatingMargin"]) line(`latestQuarter.${k}`, before.latestQuarter?.[k], after.latestQuarter?.[k]);
for (const k of Object.keys({ ...before.ttm, ...after.ttm })) line(`ttm.${k}`, m(before.ttm[k]), m(after.ttm[k]));
const sc = (p: Pack) => (p.shibuiCheck?.diffs ?? []).map((d) => `${d.level} ${d.field} ${(d.relDiff * 100).toFixed(0)}%`).join("; ") || "(none)";
line("shibuiCheck", sc(before), sc(after));
const g1 = evaluateGates(before), g2 = evaluateGates(after);
line("gate.sector", g1.sector, g2.sector);
line("gate.distress", `${g1.distress.zone} ${g1.distress.reasons.join("; ")}`, `${g2.distress.zone} ${g2.distress.reasons.join("; ")}`);
line("gate.ceiling/confidence", `${g1.ceiling} ${g1.confidence}`, `${g2.ceiling} ${g2.confidence}`);
line("crosscheckGate.blocked", crosscheckGate(before).blocked, crosscheckGate(after).blocked);
console.log(`\n${changed} field(s) differ.`);
```

- [ ] **Step 2: Smoke it on an unchanged pack (must print 0 differences)**

Run: `node --import tsx scripts/facts-pack-diff.ts data/facts/BSX/0000885725-26-000053.json data/facts/BSX/0000885725-26-000053.json`
Expected: `0 field(s) differ.`

- [ ] **Step 3: Commit** `git add scripts/facts-pack-diff.ts; git commit -m "chore(scripts): read-only FactPack before/after diff with gate outcome"`

### Task 9: Docs and skills

**Files:**
- Modify: `.claude/skills/fetch-facts/SKILL.md` (step 8), `.claude/skills/synthesize/SKILL.md` (step 4), `docs/10022026learning.md` (§3 table + a new §12)

- [ ] **Step 1: fetch-facts step 8** — append:

> A FAIL is now a build blocker: `synth:build` refuses the pack until the fail is either fixed in the pack (re-capture, concept fix) or accepted with `npm run facts:crosscheck -- <T> <ACC> --accept <field> --reason "<why the pack is right>" --verified-against "<filing>"`. Only the owner or the orchestrator accepts a fail, never the author, and only after reading the filing's own figure. On a pack re-captured with `facts:free --keep-quote`, re-apply the saved response with `--apply --from data/raw/_shibui/<batch>.json` (same quote date, so the row still matches).

- [ ] **Step 2: synthesize step 4** — append one sentence: "A build that fails at `input check` (a Shibui FAIL) is not an authoring error: stop and report it; the pack must be re-captured or the fail accepted before any judgment is written."

- [ ] **Step 3: learnings** — add four rows to the §3 table (D-1 concepts + null-not-zero, D-7 TTM span, D-27 gate + override, D-4 CFG refresh) in the table's existing voice, and a §12 "Added 2026-10-07" with: the `--keep-quote` re-capture rule for a same-date republish; "a Shibui FAIL blocks the build"; "a zero in a current-only debt line is a missing long-term tag, not zero debt".

- [ ] **Step 4: Commit** `git add .claude/skills docs/10022026learning.md; git commit -m "docs: Shibui-fail gate, --keep-quote republish rule, debt-concept lessons"`

### Task 10: Full suite and STOP (a)

- [ ] **Step 1:** `npm test` — Expected: green; count ≥ the Task 0 baseline + the new tests.
- [ ] **Step 2:** `npx tsc --noEmit` (if the repo has a typecheck script, use it) — Expected: clean.
- [ ] **Step 3:** `git log --oneline main..HEAD` — list the commits; `git status` clean.

**STOP (a).** Report to the owner: the commit list, the test count, `debt-sweep-before.txt` vs `debt-sweep-after.txt` (seven verified names identical), the Task 6 Step 4 preview for the thirteen names against the balance-sheet totals, the Task 2b diagnosis for GE and TMO, the DOW 90 of unlisted short-term notes, the companyfacts file sizes, and the gate design (override on the pack, CLI `--accept`). Do not start Phase 2 until the owner says so. The branch is NOT merged at this point; Phase 2 runs on the same branch so the re-captured packs are built by the fixed code.

---

## Phase 2 — Re-capture the twelve packs, plus SCHW for the diff (same branch, after STOP (a))

Order: CFG and V first (they are also the D-4 / D-7 cases), then RTX, XOM, CVX, DOW, CME, USFD, CSTM, ATO, GE, TMO, and SCHW last. GE (`data/ge.json`, BUY $330–390) and TMO (`data/tmo.json`, HOLD) DO have published reports and both packs are OVERSTATED (GE 22,180 vs 20,494; TMO 42,705 vs 39,385); GE's cash is null in every year and its commentary says "we cannot state net debt" — `main`'s restricted-cash fallback now reads 12,392, so that sentence fails grounding on re-capture. **Owner default (coordinator, may be overridden at STOP (b)): GE and TMO are in scope; SCHW is re-captured and diffed here, and whether SCHW is republished is decided at STOP (b) because it is held (47 sh).**

Accessions (from `data/facts/<T>/`; SCHW's from `Get-ChildItem data/facts/SCHW`):

| T | ACC | report date | label | held (ledger asOf 2026-09-26) |
|---|---|---|---|---|
| RTX | 0000101829-26-000027 | 2026-09-23 | BUY | yes (17 sh) |
| XOM | 0000034088-26-000093 | 2026-09-24 | HOLD | no |
| CVX | 0000093410-26-000167 | 2026-09-23 | HOLD | no |
| ATO | 0000731802-26-000102 | 2026-10-02 | HOLD | no |
| DOW | 0001751788-26-000147 | 2026-09-24 | HOLD | no |
| CME | 0001156375-26-000047 | 2026-09-20 | HOLD | no |
| USFD | 0001665918-26-000045 | 2026-09-28 | BUY | no (eligible, unfunded) |
| CSTM | 0001563411-26-000192 | 2026-09-29 | BUY | no (eligible, unfunded) |
| CFG | 0000759944-26-000148 | 2026-09-23 | BUY | yes (3 sh) |
| V | 0001403161-26-000104 | 2026-09-21 | BUY | yes (1 sh) |
| GE | 0000040545-26-000049 | from `data/ge.json` `meta.reportDate` | BUY | no |
| TMO | 0000097745-26-000144 | from `data/tmo.json` `meta.reportDate` | HOLD | no |
| SCHW | from `data/facts/SCHW/` | from `data/schw.json` | from `data/schw.json` | yes (47 sh) — diff only; republish decided at STOP (b) |

The ledger (read-only) holds 28 names in all, including BAC, BAM, DD, AMZN, CEG, SCHW, SOLS and EVLV — relevant to Task 15.

### Task 11: Re-capture one name (repeat for each name in the table; one commit per name)

**Files touched per name:** `data/raw/<T>/<ACC>/bigdata-*.json` + `free-capture.json` (rewritten by `facts:free`), `data/facts/<T>/<ACC>.json` (rebuilt). Nothing under `data/<t>.json` or `data/judgment/` changes in this phase.

**Network:** `facts:free --keep-quote` calls SEC companyfacts only (User-Agent from `EDGAR_CONTACT`). No Yahoo call.

- [ ] **Step 1: Save the before-pack from `main` (read-only git)**

```powershell
git show main:data/facts/<T>/<ACC>.json > "$env:SCRATCH/<T>-before.json"
```

(`$env:SCRATCH` = the session scratchpad directory.)

- [ ] **Step 2: Re-capture the SEC half**

Run: `npm run facts:free -- <T> <ACC> --keep-quote`
Expected: `Wrote 3 free tearsheet files … · quote kept from <original capturedAt>`; the printed FY and quarter counts. For V, confirm the quarter count rose by the derived September quarters (the non-December Q4 derivation now runs).

- [ ] **Step 3: Rebuild the pack**

Run: `npm run facts:build -- <T> <ACC>`
Expected: `Wrote data/facts/<T>/<ACC>.json`. If `assertValidFactPack` throws (e.g. "Missing numeric …"), stop and report; do not patch by hand.

- [ ] **Step 4: Carry forward the enrichment stamps without new network calls**

`facts:build` writes a fresh pack without `goodwill`, `goodwillRestated`, `sbc`, `beta`, the peer multiples, `shibuiCheck`, their provenance rows — and without the two TTM fields `facts:enrich` fills when the build leaves them null: `ttm.fcfYield` (`lib/facts/enrich.ts:405`, `fillFcfYield`; provenance on ATO, DOW, USFD, V, GE) and `ttm.evToEbitda` (`enrich.ts:365`, `fillEvToEbitda`; provenance on XOM, CVX, ATO, DOW, CME, USFD, CSTM, GE, TMO). Re-running `facts:enrich` would hit SEC and Yahoo again and let peer multiples drift; instead copy those fields from the before-pack with this one-off script (create once as `scripts/facts-carry-forward.ts`). The two TTM fields are carried ONLY when the rebuilt value is null (the rebuilt SEC figure wins when it exists), and the script prints which path each came from (review F-3):

```ts
/** facts-carry-forward.ts — copy enrichment stamps (goodwill, sbc, beta, peer multiples, shibuiCheck, overrides, and the
 *  enrich-filled ttm.fcfYield / ttm.evToEbitda when the rebuild left them null) from a previous build of the SAME pack
 *  onto a freshly rebuilt one. Used for a same-quote re-capture (facts:free --keep-quote).
 *    node --import tsx scripts/facts-carry-forward.ts <from.json> <data/facts/T/ACC.json> */
import { readFileSync, writeFileSync } from "node:fs";
const [from, to] = process.argv.slice(2);
const src = JSON.parse(readFileSync(from, "utf8")), dst = JSON.parse(readFileSync(to, "utf8"));
if (src.ticker !== dst.ticker || src.filing.accession !== dst.filing.accession || src.quote.asOf !== dst.quote.asOf) throw new Error("carry-forward needs the same ticker, accession and quote date");
const { schemaVersion, ticker, cik, company, exchange, sic, sicDescription, ...rest } = dst;
const out: Record<string, unknown> = { schemaVersion, ticker, cik, company, exchange, ...(sic != null ? { sic } : {}), ...(sicDescription != null ? { sicDescription } : {}) };
if (src.goodwill != null) out.goodwill = src.goodwill;
if (src.goodwillRestated != null) out.goodwillRestated = src.goodwillRestated;
if (src.sbc != null) out.sbc = src.sbc;
Object.assign(out, rest);
out.peers = dst.peers.map((p: { ticker: string }) => src.peers.find((q: { ticker: string }) => q.ticker === p.ticker) ?? p);
for (const f of ["beta", "shibuiCheck", "crosscheckOverrides"]) if (src[f] != null) out[f] = src[f];
const carriedProv = new Set(["goodwill", "sbc", "beta", "shibuiCheck", "peers"]);
const ttmCarried: string[] = [];
for (const f of ["fcfYield", "evToEbitda"] as const) {
  const rebuilt = (out.ttm as Record<string, number | null>)[f], old = src.ttm[f];
  if (rebuilt == null && old != null) { (out.ttm as Record<string, number | null>)[f] = old; ttmCarried.push(`ttm.${f}`); console.log(`  ttm.${f}: rebuilt null → carried enrich value ${old}`); }
  else console.log(`  ttm.${f}: rebuilt ${rebuilt} (old ${old})${rebuilt == null ? " — null on both" : ""}`);
}
out.provenance = [...dst.provenance, ...src.provenance.filter((p: { field: string }) => carriedProv.has(p.field) || ttmCarried.includes(p.field) || p.field.startsWith("crosscheckOverrides."))];
writeFileSync(to, JSON.stringify(out, null, 2) + "\n");
console.log(`carried ${["goodwill", "goodwillRestated", "sbc", "beta", "shibuiCheck", "crosscheckOverrides"].filter((f) => src[f] != null).join(", ")} + peer multiples${ttmCarried.length ? " + " + ttmCarried.join(", ") : ""} onto ${to}`);
```

Run: `node --import tsx scripts/facts-carry-forward.ts "$env:SCRATCH/<T>-before.json" data/facts/<T>/<ACC>.json`

Then re-evaluate the Shibui diffs against the NEW pack values (revenue and FCF changed; the saved Shibui row has not):

Run: `npm run facts:crosscheck -- <T> <ACC> --apply --from data/raw/_shibui/crosscheck-backfill-2026-10-03.json`
Expected: the diffs line; for CFG `revenueQuarter` should now be `ok`/`warn` (2,283M vs 2,149M ≈ 6%). If the script says "no row for <key>", the quote date changed — `--keep-quote` failed; stop. For DOW the `fcfTtm` diff must be PRESENT after this step (its `ttm.fcfYield` was enrich-filled; if the rebuild nulled it and the carry-forward did not restore it, the diff silently vanishes and the gate would pass a fail by omission). No `--accept` on DOW until the diff line shows the `fcfTtm` row.

- [ ] **Step 5: Diff and gate**

Run: `node --import tsx scripts/facts-pack-diff.ts "$env:SCRATCH/<T>-before.json" data/facts/<T>/<ACC>.json | Tee-Object "$env:SCRATCH/<T>-diff.txt"`

Check, per name:
- `quote.price`/`asOf` unchanged.
- `balance.totalDebt[FY25]` EQUAL to the balance-sheet total (RTX 37,904; XOM 43,537; CVX 40,758 and FY24 24,541; CME 3,422; USFD 5,200; CSTM 1,944; DOW 18,071 — 90 short of the 18,161 balance sheet, noted; ATO 8,919 at its September-2025 year-end; GE 20,494; TMO 39,385; SCHW ≈ 31,012). **CVX: reconcile EVERY FY column (FY21–FY25) to the 10-K balance sheets before STOP (b)** — the same-value rule must hold in each year it fires, and a year where only `CommercialPaper` is tagged takes the merged short-term figure; write the five reconciled totals into the diff file. For CVX, `cashAndInvestments[FY24/FY25]` is null today — see whether it now reads; if still null, find the cash concept with `debt-sweep --concepts` (extend the regex to `Cash`) and add it with a fixture before continuing. GE: cash now reads (restricted-cash fallback, 12,392) — record the before/after net debt.
- `gate.distress` before → after. Expected: RTX/XOM/CVX/USFD/CSTM/GE/TMO stay SAFE (net debt/EBITDA well under 6x); CME, CFG and SCHW are `financial` → NA; ATO is `utility` (its DISTRESS today comes from the current ratio + negative FCF, not debt, and does not change); DOW may move SAFE → WEAK if FY25 EBITDA is small and net debt/EBITDA > 6 — record it, it is a HOLD already, but the conviction row changes.
- `crosscheckGate.blocked` after: must be `false` for every name except DOW (`fcfTtm` 116% fail). For DOW, read the 10-Q cash-flow statement and the Shibui figure; if the pack's `fcfTtm` is the SEC continuing-ops figure, accept with `--accept fcfTtm --reason … --verified-against "10-Q 0001751788-26-000147"`; if the pack is wrong (a capex-extras or YTD issue), fix the code with a fixture first. Do not accept a fail you have not reconciled to the filing.
- V: `ttm.ps`, `ttm.evToEbitda`, `ttm.netMargin` change (the window is now Sep-25…Jun-26). Note the old vs new multiples for the author.

- [ ] **Step 6: Commit the pack**

```powershell
git add data/raw/<T>/<ACC>/ data/facts/<T>/<ACC>.json
git commit -m "facts(<T>): re-capture statements on the 2026-10-07 debt/TTM fixes (quote kept at <asOf>)"
```

### Task 12: STOP (b) — the diff report

- [ ] **Step 1:** Assemble `$env:SCRATCH/phase2-summary.md`: one table (ticker, FY25 total debt before → after, cash before → after, net debt before → after, latest-quarter revenue before → after, TTM P/S / EV/EBITDA / net-debt/EBITDA before → after, gate zone before → after, Shibui status before → after), plus each `<T>-diff.txt`.
- [ ] **Step 2:** Run `npm test` on the branch (the fixture packs under `lib/synth/__fixtures__/packs` are untouched; expected green).
- [ ] **Step 3:** For each name, a one-line prose-impact verdict (used in Phase 3): which published figures no longer ground.

**STOP (b).** Hand the summary to the owner. Ask: (1) merge the code + packs branch to `main` now, before any report is republished (recommended: the trade engine reads the packs only for `sic` and `beta` — `lib/trade/runtime.ts:97`, `scripts/portfolio-build.ts:52` — and neither field changes in this work; the label, E/D/R and targets come from `data/<t>.json`, which Phase 2 does not touch), or hold it until the reports are ready; (2) the DOW `fcfTtm` fail disposition; (3) whether RTX, CFG and V (held) should be locked before their reports are republished (see Phase 3 timing); (4) confirm or override the coordinator's defaults — GE and TMO in scope, SCHW's republish (held, 47 sh; its debt moves 1,900 → ≈ 31,012), companyfacts persisted; (5) confirm the held-name Shibui dispositions applied in Task 5b (BAC, BAM, DD accepted or not; AMZN, CEG accepted or still under investigation) — the owner asked for these before the gate lands, so by STOP (b) they are done, and any still open is listed here; (6) note that republishing REPLACES each name's point in the calibration log — `label-revised` is not in the `EXCLUDING` set at `lib/calibration/realized.ts:523`, so the realized E/D/R for RTX, XOM, CVX, ATO, DOW, CME, USFD, CSTM, CFG, V, GE, TMO (and SCHW if republished) will be the revised reports', not the originals'. Do not merge without the answer.

---

## Phase 3 — Republish (branches `claude/republish-debt-batch-1..4`, after STOP (b) and the owner's answer)

### Prose survival per name (from the published `balanceCommentary` and the grounding rule "every figure verbatim from the Facts block")

| T | Does the existing judgment survive? | Why | Author work |
|---|---|---|---|
| RTX | **No** — fix round | Commentary calls the series "a data-source artifact", quotes `$0.2B`, `-$7.2B`, "re-verified before use" — all false after the fix; those strings vanish from the prompt and fail grounding. The thesis and scenarios are EPS/target-driven; label likely holds but conviction may move (net debt now ≈ $29B; net debt/EBITDA becomes a real figure). | Rewrite balance commentary and any leverage mention in risks/capital allocation; keep scenarios unless the reviewer argues leverage into Bear. |
| XOM | **No** — fix round | Quotes `$9.3B` debt, `-$1.4B` net debt, "effectively a net cash position". After the fix XOM is a net debtor (≈ $42B debt vs ≈ $10.7B cash). | Rewrite balance commentary, the "net cash cushion" catalyst/risk line, and the capital-allocation paragraph that leans on net cash. |
| CVX | **No** — fix round | Quotes `$3.3 billion`, `$30.9 billion → $3.3 billion`, the unreconciled "$8.4 billion reduction" tension (which the fix resolves), and FY22/FY23 net cash figures that may change if cash now reads. | Rewrite balance commentary; remove the "pack does not reconcile" paragraph; re-anchor on the series. |
| ATO | **No** — fix round | "The third-party debt series is incomplete … we set that series aside." Now it is complete. Utility leverage is normal; prose must describe it. | Rewrite balance commentary; check the DISTRESS gate advisory text is still consistent (unchanged by this work). |
| DOW | **No** — fix round | Quotes `$0.1 billion`, `-$2.9 billion`, "leaves FY24-FY25 blank", "treat leverage as unquantified". Risk bullet repeats it. | Rewrite balance commentary and the leverage risk; if the gate turns WEAK, the report must say so (conviction −10, HOLD ceiling — label unchanged). |
| CME | **No** — light fix round | 10-Q figures ($2.3B cash vs $3.4B debt) are from the filing and survive, but "the five-year series shows it running at or near net cash throughout" and the FY column (debt 0 → 3,424M) contradict. "Almost no net debt" wording in other sections. | Rewrite the series sentence; check `multiplesCommentary` ("leverage ratios read as not-meaningful") still holds for a financial-sector name. |
| USFD | **No** — light fix round | "The summary financials do not break out a total-debt line" — now they do, and the press-release $5.2B net debt should reconcile to the series. | One paragraph; confirm the press-release figure and the series agree in words. |
| CSTM | **No** — light fix round | "The Facts block shows only $39 million of total debt … a mapping gap". | Replace with the real series; keep the 2.5x leverage from the proxy as the company's measure. |
| CFG | **No** — substantial pass | Revenue basis changes everywhere: `latestQuarter.revenue` 451M → 2,283M, `revenueYoY`, `ttm.ps` 15.7x → ≈ 3x, `netMargin`, growth points, income commentary, multiples commentary, the Base/Bear drivers if they cite revenue. The debt series (11.3B) is unchanged. | Treat as a fresh authoring of income/growth/valuation sections on the same thesis; a fresh author (not the original) is acceptable here because the inputs changed, but the reviewer must be fresh too. |
| V | **No** — substantial pass (the reviewer's grounding re-run: 12 new failures across 7 sections) | TTM multiples and margins move once the September quarters exist; the "0.4x EBITDA" / "44.7x coverage" figures and every TTM-derived number in multiples, income, cash-flow and growth prose change. Debt unchanged. V's quarterly EPS cannot be summed (class-A-only EPS), so `ttm.pe` stays the Yahoo trailing-P/E fallback (31.3) — say so in the author brief so the P/E is not re-explained as an SEC figure. | Rewrite every section that cites a TTM figure; scenarios are forward-EPS-anchored and likely unchanged. |
| GE | **No** — fix round | Total debt 22,180 → 20,494 and cash null → 12,392 (restricted-cash fallback): "we cannot state net debt" is now false and the net-debt row fills. | Rewrite balance commentary and any leverage mention; GE is a BUY ($330–390), so re-check E/D/R. |
| TMO | **No** — fix round | Total debt 42,705 → 39,385; any debt, net-debt or net-debt/EBITDA figure in prose fails. | Rewrite balance commentary; HOLD likely holds. |
| SCHW | decided at STOP (b) | Pack debt 1,900 → ≈ 31,012 (a brokerage: leverage is funding, and the gate is `financial` → NA), held 47 sh. If the owner says republish, it joins batch 5 with the same loop. | Balance commentary rewrite framed as a financial (deposit/funding model), as the CFG report does. |

Estimated rounds (review F-6): the reviewer's grounding re-run counted XOM 5 and RTX 2 new failures, V 12; plan for up to 2 author passes + 2 reviewer passes per name across 12–13 names ≈ **24 author passes and 24 reviewer passes**, not the 10/20 first estimated. Run at most 2–3 agents concurrently (memory: four concurrent Opus reviewers hit the 429 session limit; nested dispatch stalls). Reviewers are main-spawned; authors are rolling subagents or inline.

### Batching and branches

Because a `--no-ff` merge carries every file on the branch, an approved report waits for every other draft on its branch. Use five short branches off `main` (after the Phase 2 merge), two or three names each, so one slow review does not hold twelve reports:

- `claude/republish-debt-batch-1`: CFG, V (the held BUYs with the largest input change)
- `claude/republish-debt-batch-2`: RTX, USFD, CSTM (the remaining BUYs)
- `claude/republish-debt-batch-3`: XOM, CVX, DOW
- `claude/republish-debt-batch-4`: CME, ATO
- `claude/republish-debt-batch-5`: GE, TMO (+ SCHW if the owner says so at STOP (b))

**Concurrency and checkouts (review F-11):** batches run SEQUENTIALLY on the single working checkout — one batch branch is checked out at a time; the next is cut from `main` after the previous merge. Within a batch the 2–3 author/reviewer agents share that checkout, which is safe because each writes only its own `data/judgment/<T>/*` and `data/<t>.json`. If the owner wants two batches in flight at once, use `superpowers:using-git-worktrees` to give the second batch its own worktree (`git worktree add ../juniresearch-batch-<n> claude/republish-debt-batch-<n>`); agents in a worktree must be given that absolute path, since every `npm run` resolves `data/` relative to its cwd.

### Task 13: Republish one name (repeat per name; the loop is the `synthesize` skill with two deviations: `--date` and `--full-brief`)

- [ ] **Step 1: Render the prompt and the delta**

Run: `npm run synth:prompt -- <T> <ACC>` then `npm run synth:build -- <T> <ACC> --date <original report date> --skip-review`
Expected: the build fails at `validate` with grounding errors naming the vanished figures (that is the author's to-do list), or passes lint but is `stale` at the editorial gate. Then `npm run synth:prompt -- <T> <ACC> --with-errors` and hand the author the printed delta file.

- [ ] **Step 2: Author fix round (a subagent that is not the reviewer)**

Brief: "Read `<prompt path>` and `<delta path>`. The balance-sheet inputs were corrected on 2026-10-07; the published commentary described the old, wrong series. Rewrite the whole judgment at `<judgment path>` so every figure is verbatim from the prompt; argue leverage once, in the balance commentary; do not keep any sentence that calls the data an artifact or a mapping gap. Keep the thesis and the scenarios unless the corrected leverage changes the Bear case — if it does, say so in the scenario commentary and argue the weight. Do not read the FactPack or the raw captures." Include the house lessons list from `docs/10022026learning.md` §2 verbatim in the brief. For V add: "The trailing P/E (31.3) is a Yahoo figure because V's quarterly EPS cannot be summed; do not describe it as derived from the quarters." For GE add: "Cash and net debt now read; do not say they cannot be stated."

- [ ] **Step 3: Build and commit the draft**

Run: `npm run synth:build -- <T> <ACC> --date <original> --skip-review` — Expected: `Wrote data/<t>.json`; read the printed summary line (label, E/D/R via the conviction row). If the label moved, record it for STOP (c).
Commit: `git add data/judgment/<T>/ data/<t>.json; git commit -m "wip(<T>): corrected balance-sheet inputs, author fix round (unreviewed; not for main)"`

- [ ] **Step 4: Fresh reviewer on a full brief (FOUR/DSP precedent)**

Run: `npm run synth:review-brief -- <T> <ACC> --full-brief` and dispatch a fresh Opus subagent (`desk.review.model`) whose entire brief is "Read `<brief path>` and follow it." Keep the agent for round 2.

- [ ] **Step 5: Gate build**

Run: `npm run synth:build -- <T> <ACC> --date <original>` (no `--skip-review`). On open findings: `synth:prompt --with-review`, author rewrites, rebuild with `--skip-review`, commit `wip`, continue the same reviewer with the delta brief. Cap at two review rounds; decline remaining Minors with a note.
Expected on approval: `Wrote data/<t>.json … report date <original>` and the editorial review `clean`.

- [ ] **Step 6: Commit the approved report**

`git add data/judgment/<T>/ data/<t>.json; git commit -m "<T>: republish on corrected balance-sheet inputs, review approved (<LABEL> $<low>–<high>)"`

### Task 14: STOP (c) per batch — the owner approves every merge

- [ ] **Step 1:** `npm test` on the batch branch — green.
- [ ] **Step 2:** `node --import tsx scripts/gates-preview.ts` (read-only) — confirm no name in the batch is capped unexpectedly.
- [ ] **Step 3:** Prepare the batch note: per name, old label/targets/E/D/R → new; conviction before → after; any declined Minor; whether the name is held.

**Trade-engine timing (held names RTX 17 sh, CFG 3 sh, V 1 sh, SCHW 47 sh if republished; plus any name that becomes held before the merge — re-read `data/trade/ledger.json` read-only on the day; the ledger is asOf 2026-09-26 and holds 28 names).** The scheduler fires at 15:10 ET (`cronTimesET` in `lib/trade/config.ts`) and submits until 15:50 ET. The stored label does not move with the price; it moves when `data/<t>.json` changes on the deployed checkout. `lib/trade/hysteresis.ts:34-35` classifies a held name EXIT when its `label` is not buy-side OR its `gatedLabel` (the gate ceiling) is not buy-side, and `:36-40` when `mu < muExit` or `R < rExit` — **`rExit` is 0.15** (`lib/trade/config.ts:73`), not 0.35 — unless the name is locked. Therefore:

**Owner's answer (2026-10-07): the deployed container is ARMED (live Schwab) on `main` and does NOT pull `main` automatically.** So a merge or push is not a deployment; the exit risk arises only when the owner pulls the container. Consequently:

- Merges may land at any time of day. The owner pulls the container outside the 15:10–15:50 ET window and decides locks before pulling.
- The STOP (c) note for every batch still carries the analysis the owner needs for that pull: which held name's label, gate ceiling (e.g. a new WEAK zone at high confidence) or E/R under the exit bars will make the engine classify it EXIT at the first 15:10 ET run after the pull, and why (label, gate, μ or R).
- If the owner wants to keep the position, the owner places the lock (`trade:*` tooling; never from this plan — learnings §5 "ask the owner before changing anything involving a lock").
- A label that stays BUY with a lower E/R above the bars needs no action but goes in the note.

**STOP (c).** The owner approves the merge for the batch; the note states what the next pull will do to held names. Then:

```powershell
git checkout main; git pull --ff-only
git merge --no-ff claude/republish-debt-batch-<n> -m "Merge republished <names> on corrected balance-sheet inputs"
npm test
git push
git checkout claude/republish-debt-batch-<n+1>; git rebase main   # or branch the next batch from main now
```

(The Phase 1+2 branch is merged the same way at the owner's STOP (b) answer: `git merge --no-ff claude/debt-concepts-2026-10-07 -m "Merge debt-concept fallbacks, TTM span check, Shibui-fail gate and ten re-captured packs"`; the four batch branches are cut from `main` after that merge.)

### Task 15: After the last batch

- [ ] Run `node --import tsx scripts/backfill-crosscheck.ts --query`? **No** — the backfill touches every pack; do not run it. The complete list of packs the gate will block at their next build is AMZN, BAC, BAM, CEG, CFG (cleared by Phase 2), CVLG, DD, DOW (handled in Phase 2). Of these, BAC, BAM, DD, AMZN and CEG are HELD and were dispositioned in Task 5b before the gate merged (any `investigate` outcome is still open here); CVLG (`fcfTtm` 248%: definition, not held — `--accept` candidate) is the one remaining. Record the list and the owner's answers in the STOP (c) note of the last batch; accepting any of them is a separate, owner-approved step with the filing open.
- [ ] Update `docs/10022026learning.md` §12 with the outcomes (labels that moved, rounds used), commit on the last batch branch before its merge.

---

## Risks and rollback

| Phase | Risk | Mitigation / rollback |
|---|---|---|
| 1 (code) | A new concept outranks a verified filer's line (the VST lesson). | Every new concept sits below `LongTermDebtNoncurrent`, `LongTermDebt` and the noncurrent lease line; Task 6 sweep must print zero mismatches on the seven verified names; the LLY fixture asserts `42,503M`. Rollback: `git revert` the Task 2 commit. |
| 1 | The same-value lease rule (rule 0) fires on a filer where the two lines coincide by accident while `DebtCurrent` is real current debt outside the lease line. | Exact equality is rare outside the one-line-tagged-twice pattern; the rule adds short-term borrowings, so only `DebtCurrent`'s non-STB part could be missed. Every FY column of CVX and SCHW is reconciled to the 10-K (Task 11 Step 5); a third filer showing the pattern gets a fixture before its pack is trusted. |
| 1 | The zero-vs-gap rule nulls a period on a filer that switched from a current-only tag set to a long-term one mid-history (an early year with an honest 0 becomes null). | Null is the conservative reading for that year (the gate falls through to `nd`/`ndE`); DSP/PLTR/RDVT/LASR/AMSC never tag a long-term concept and keep their zeros, which the DSP-shape fixture pins. CME FY23/FY25 read `UnsecuredLongTermDebt` either way. |
| 1 | Annual-only `CAPEX_EXTRA` lines (a filer tagging capitalized software in the 10-K but not the 10-Qs) land entirely in the derived Q4 (FY − Q1..Q3), so a Q4-heavy capex and a TTM FCF that includes that Q4 absorb the whole year's extra. | Known shape, one sentence in the STOP (a) note; not changed here. |
| 1 | TTM span check nulls multiples on 52/53-week filers with an unusual year. | Bounds 250–300 days match Shibui's; the `fiftyTwo` test covers 273-day windows; a 53-week year (≈ 280 days between four ends) is inside. |
| 1 | The Shibui gate blocks packs with legacy fails at their next synthesis (BAC, BAM, DD, CVLG, AMZN, CEG). | Intended. Dispositions listed in Task 15; `--accept` records the reason on the pack. |
| 1 | `--keep-quote` reconstructs `YahooData` imperfectly (a field the tearsheet lacks). | Round-trip test in Task 7; the Yahoo blocks of the re-emitted tearsheet must be byte-identical. |
| 2 (packs) | companyfacts now contains a newer filing than the captured one (a 10-K filed since). | `facts:build` validates `latestQuarter ≥ filing.periodEnd`; a newer FY would show as an extra column in the diff. If a pack's `fiscalYears` grows, stop and ask: the report's accession is the 10-Q and the newer 10-K deserves its own capture. |
| 2 | The Shibui row no longer matches (quote date moved). | `--keep-quote` prevents it; `facts:crosscheck --apply --from` refuses with "no row" otherwise. Rollback: `git checkout main -- data/raw/<T>/<ACC> data/facts/<T>/<ACC>.json`. |
| 2 | The CVX cash series stays null. | Investigate the cash concept (`debt-sweep --concepts`, regex widened to `Cash`) and add it with a fixture; do not hand-edit. |
| 2 | The carry-forward restores an enrich-filled `ttm.fcfYield` / `ttm.evToEbitda` that the rebuilt SEC figures would have superseded. | Carried only when the rebuilt value is null; the script prints the path per field; the diff shows both values. |
| 2 | Republishing replaces the calibration-log point for each name (`label-revised` not in `EXCLUDING`, `lib/calibration/realized.ts:523`). | Stated at STOP (b) question (6); accepted or the owner adds `label-revised` to the exclusion set in a separate change. |
| 3 (reports) | A held BUY (RTX, CFG, V; SCHW if republished) drops to HOLD, gains a non-buy-side gate ceiling, or falls under `muExit`/`rExit` 0.15 → EXIT at 15:10 ET. | The container is armed and does not auto-pull (owner, 2026-10-07): merges land any time; the owner pulls outside 15:10–15:50 ET and decides locks first, using the per-batch STOP (c) note that names the exit cause (label, gate, μ or R). |
| 3 | Review spirals (CME: 6 rounds in its first run). | De-dup the judgment before round 1; cap at 2 rounds; decline Minors with notes. |
| 3 | A batch stalls on one name. | Four small branches; cut the next batch from `main` after each merge; a stalled name can be moved to a later branch by cherry-picking its `wip` commits. |
| any | Usage-limit 429 kills agents. | Resume with `SendMessage` after the reset; keep to 2–3 concurrent agents. |

## What NOT to touch

- `data/trade/**` (ledger, fills, runs, cron log), `lib/trade/locks*`, anything that places or cancels an order; the engine is read only to state what it would do.
- Tokens, secrets, `.env.local`, the Schwab refresh token; never run `trade:auth`.
- `data/portfolio/**` snapshots (read-only reference).
- Any other published report or pack than the ten (and GE/TMO if they have reports); no `backfill-*` script, since each rewrites every pack.
- The judgment of a report while its review is clean (edit-after-approval makes the review stale and blocks the gate).
- `main` directly; `--force` anything.

---

## Self-review

- Spec coverage: D-1 → Tasks 1–3 (understated) and 2b (overstated GE/TMO), 6; D-7 → Task 4; D-27 → Task 5; D-4 → Phase 2 (CFG re-capture) + Task 5 (the gate that would have caught it); D-9 → Task 7b; re-capture with before/after diff and gate outcome → Tasks 7, 8, 11, 12; republish with the FOUR/DSP precedent → Tasks 13–14; STOP points (a) Task 10, (b) Task 12, (c) Task 14; risks/rollback and the do-not-touch list above; held names and the 15:10 ET window → Task 14.
- Owner answers folded in (2026-10-07): the container is armed and does not auto-pull (Task 14: merges any time, the owner pulls outside 15:10–15:50 ET and decides locks first; the timing analysis stays as advice for the pull); held-name Shibui dispositions are applied in Phase 1 (Task 5b) before the gate lands.
- Review items folded in: F-1 (rule 0, balance-sheet totals, CVX every-column reconciliation), F-2 (GE/TMO in scope, Task 2b), F-3 (carry-forward of enrich-filled TTM fields, DOW diff presence), F-4 (zero vs gap, `filerTagsLongTerm`, DSP/gap fixtures), F-5 (`DebtInstrumentCarryingAmount` dropped), F-6 (24/24 rounds, V P/E note), F-7 (`rExit` 0.15, gate ceiling, held list), F-8 (STOP (b) wording), F-9 (test placement, estimate filter, `const dir`, marker file), F-10 (all FY columns), F-11 (sequential batches / worktrees), F-12 (errors.txt gitignored, plain z.object), F-13 a–e (companyfacts persisted, `_shibui` tracked, calibration-log note, CAPEX_EXTRA Q4 sentence, held-name dispositions at STOP (b)), reviewer question 5 at STOP (c).
- Type consistency: the three new `RawValues` keys are named identically in Tasks 1, 2, 2b and 3 (`ltdLeaseTotal`, `combinedTotal`, `unsecuredLtd`); `deriveTotalDebt(r, { filerTagsLongTerm })` in Tasks 1, 2 and 3; `crosscheckGate` returns `{ blocked, errors, warnings }` in Tasks 5 and 8; `CrosscheckOverride` has `{ field, reason, verifiedAgainst, capturedAt }` in Tasks 5, 11 and the schema; `yahooFromTearsheet` returns `{ yahoo, capturedAt }` in Tasks 7 and 11; `COMPANYFACTS_FILE` in Task 7b.
- Open judgment calls flagged for the owner: `UnsecuredDebt` and `ShortTermBankLoansAndNotesPayable` left out pending fixtures; the override lives on the pack (not the judgment); `--keep-quote` instead of a full re-capture; DOW's fail disposition; the coordinator's defaults (GE/TMO in scope, SCHW diff + STOP (b) republish decision, companyfacts persisted); batch order; held-name legacy fails.
