# Shibui cross-check — FactPack input review (2026-10-03)

> **Status:** review only. No pack, report, code or test was changed. The field changes below are proposals.
> **Arbiter:** SEC XBRL companyfacts (fetched 2026-10-03) and the filed 10-Q/10-K/8-K text in `data/raw/<T>/<ACC>/`.
> **TTM method:** last FY + current YTD − prior-year YTD, to the pack's `latestQuarter.periodEnd` (2026-06-30 for all five).
> This is the same method as `lib/facts/enrich.ts` `ttmFromYtd`. Values are in $M unless stated.

## Summary

| Ticker | Label (E / R:R) | Which source is right | Corrected figure(s) | Materiality |
|---|---|---|---|---|
| FOUR | BUY (+16.2% / 0.63) | **Shibui** on FCF (it equals the company's own reported FCF). **Pack** on shares and market cap. | TTM FCF **$311M**, so `ttm.fcfYield` 0.1999 → **0.1085**. FY25 FCF $624M → **$400M**. Shares 78.96M and market cap $2.87B are correct. | **Re-synthesize.** The thesis cites a "20% FCF yield" and says capex is small. R:R sits 0.13 above the 0.5 BUY floor, so a modest reweight would flip the label to HOLD. |
| DSP | BUY (+17.2% / 0.56) | **Shibui** (capitalized software is capex) | TTM FCF **$47.7M**, so `ttm.fcfYield` 0.0811 → **0.0586**. FY25 FCF $51.7M → **$34.3M**. | **Re-synthesize (light).** Prose and snapshot figures are wrong. The scenarios do not use FCF, so the label probably holds, but R:R 0.56 is close to the 0.5 floor. |
| DD | BUY (+17.5% / 1.10) | **Pack** (continuing operations). Shibui mixes bases. | TTM FCF **$702M** (continuing operations, GAAP). No change. | **No action** on values. Add a provenance note. |
| CVLG | BUY (+18.0% / 0.70) | **Both defensible.** The pack uses gross capex (−$37.9M). Shibui nets equipment-sale proceeds (+$25.6M). | Gross −$37.9M (Juniper's definition, so keep it). Net-of-disposals +$25.6M, but that is inflated by a one-off fleet sell-down. | **Correct FactPack only** (provenance and definition note). The scenarios are EPS-driven, so the label is unaffected. |
| BAM | BUY (+12.9% / 0.74) | FCF: **pack** right. Shibui put *investing* cash flow in its OCF field. Revenue: **Shibui = GAAP** total revenues. The pack's figure is a fee-revenue subset. | TTM FCF **$2,319M** (no change). Q2'26 GAAP revenue **$1,753M** (+60.8% YoY) against the pack's $1,047M (management + incentive fees, +12.5%). | **Correct FactPack** (revenue basis). Fix the growth prose at the next synthesis: the "FY26E step-up is the main risk" point compares fee revenue with GAAP-basis consensus. The label is unlikely to fall. |

**Recommendation:**
- **Re-synthesize FOUR now.**
- **Re-synthesize DSP**, which is lower urgency: its figures are wrong but its label probably holds.
- **BAM** needs its revenue basis corrected in the pack and its growth/multiples prose refreshed. That can wait for the next synthesis.
- **DD and CVLG** need no re-synthesis.

One systemic cause sits behind FOUR and DSP: the vendor tearsheet's `free_cash_flow_yield` is OCF − purchases of PP&E only. Juniper's own SEC fallback (`CAPEX_RAW` in `lib/facts/free/sec.ts`: PP&E / ProductiveAssets / OtherPPE) would make the same mistake for both names. It would miss `PaymentsToDevelopSoftware` (DSP), `PaymentsToAcquireEquipmentOnLease` (FOUR) and untagged capitalized-software lines (FOUR). See "Follow-ups".

---

## FOUR — Shift4 Payments (10-Q 0001794669-26-000045, CIK 1794669)

### Evidence: TTM FCF

| Concept / line | FY25 (10-K 0001794669-26-000010) | H1'26 (10-Q -26-000045) | H1'25 (10-Q -26-000045, comparative) | TTM 2026-06-30 |
|---|---|---|---|---|
| NetCashProvidedByUsedInOperatingActivities | 634 | 197 | 238 | **593** |
| PaymentsToAcquirePropertyPlantAndEquipment | 10 | 12 | 2 | 20 |
| PaymentsToAcquireEquipmentOnLease ("Acquisition of equipment to be leased") | 125 | 68 | 53 | 140 |
| Capitalized software development costs (untagged in us-gaap; read from the cash-flow statement in both filings) | 99 | 60 | 37 | 122 |
| **FCF = OCF − all three capex lines** | 400 | 57 | 146 | **311** |
| OCF − PP&E only (the vendor / pack basis) | 624 | 185 | 236 | 573 |

- **Cross-check against the company's own definition.** The Q2'26 shareholder letter (8-K ex. 99.1) reconciles FCF as OCF less capital expenditures, where capex covers all three lines.
  - Quarterly FCF: Q3'25 $98M, Q4'25 $156M, Q1'26 $66M, Q2'26 **−$9M**.
  - Sum = **$311M**, which matches Shibui's $311.3M to the dollar.
  - Adjusted FCF (adds back acquisition, restructuring and integration costs): $141M + $171M + $88M + $21M = $421M TTM. FY26 guide: $465–475M.
- **Settlement flows are not the issue.** Settlement assets and obligations sit outside operating cash flow; the 10-Q MD&A says the settlement mix "drives increases or decreases in financing cash flow". The only settlement-related item is in investing: "Acquisitions, net of cash acquired" includes $185M of Bambora settlement cash. That line is excluded from FCF either way.
- **Verdict:** the pack's $573M leaves out $262M of recurring capex (leased POS equipment and capitalized software). Shibui and the company are right.

### Evidence: shares and market cap

- **Cover page.** The 10-Q (dei:EntityCommonStockSharesOutstanding, accn -26-000045) shows **78,960,120 Class A shares as of 2026-07-31**. It is the only class outstanding.
  - In February 2026 the Up-C Collapse exchanged all Class B (Rook LLC units) and all Class C shares one-for-one into Class A.
  - The balance sheet shows Class C "no and 1,123,309 shares … at June 30, 2026 and December 31, 2025".
- **The pack is right.** The pack's derived 78,960,122.5 (market cap ÷ price) equals the cover count. Market cap = $36.31 × 78.96M = **$2,867M**, which is correct.
- **Where 88.6M came from.** Shibui's earlier ~88.6M (Q2'25–Q4'25 `shares_outstanding`) was the pre-collapse A+B+C total. Its Q1/Q2'26 rows (81.2M, 79.3M) are already post-collapse.
- **Caveat that is not in either figure.** 10,423,296 shares of 6.00% Series A Mandatory Convertible Preferred are outstanding.
  - Liquidation preference is about $1.0B, and $63M of dividends are expected over the next 12 months.
  - These are a senior claim and a future Class A dilution.
  - After preferred dividends, FCF to common is about $311M − $63M = $248M, an 8.7% yield.

### Affected report content (`data/four.json`)

- **`snapshot` "FCF Yield (TTM)"** shows 0.1999. It should be 0.1085.
- **`executiveSummary.thesis.body`** contains two wrong claims:
  - "a 20.0% trailing FCF yield, a price that implies serious trouble"
  - "a business that converts most of its operating cash flow into free cash flow"
  - In fact FCF/OCF is 52% TTM and 63% in FY25, and Q2'26 FCF was negative.
- **`financials.cashflow` table (from `statements.cashflow`).** Capex shows only PP&E, so FCF is overstated:
  - FY25 shows $624M, 14.9% margin. Correct: **$400M, 9.6%**.
  - FY24 shows $493M. Correct: **$327M, 9.8%**.
  - FY23 shows $332M. Correct: **$210M, 8.2%**.
  - FY21–22 were not verified: capitalized software for those years is not in the local filings.
- **`financials.cashflowCommentary`**: "Free cash flow was $624M in FY25, a 14.9% FCF margin … Capital expenditure is small. The trailing FCF yield is 20.0%." All three statements are wrong.
- **`valuation.scenarios`**:
  - Bull: "free cash flow reduces debt", $55, 30%.
  - `scenarioCommentary`: "cash generation supports a recovery" is the stated reason Bull gets equal weight to Bear.
  - The implied prices are anchored to Street targets, not to an FCF multiple. But the probability weights rest on a cash-generation premise that is about half as strong as stated: $311M FCF against $4.5B of debt and a $1.0B preferred.
- **Rating:**
  - Today: E = +16.2%, bear −25.6%, R:R 0.63 → BUY. The BUY floor is E ≥ 10% and R:R ≥ 0.5.
  - Moving 5pp from Bull to Bear gives a fair value of $40.80, E +12.4% and R:R 0.48 → **HOLD**.
- **`rating.decision.intrinsic`** (MoS 9.19, i.e. +919%) was computed on owner earnings of $573M − $88M SBC = $485M. Corrected: $311M − $88M = $223M.
  - The reverse DCF now abstains on the fail.
  - Once the pack equals Shibui, the check passes and the DCF re-runs on the halved base.
- **Materiality: high. Re-synthesize.**

### Proposed FactPack correction (`data/facts/FOUR/0001794669-26-000045.json`)

- `ttm.fcfYield`: 0.1998575501882559 → **0.10847416772870434** (311,000,000 / 2,867,042,048)
- `statements.cashflow` `capex`:
  - FY23 −14,000,000 → **−136,000,000**
  - FY24 −7,000,000 → **−173,000,000**
  - FY25 −10,000,000 → **−234,000,000**
  - FY21/FY22: fetch from the FY2023 10-K before changing.
- `statements.cashflow` `freeCashFlow`:
  - FY23 332,000,000 → **210,000,000**
  - FY24 493,000,000 → **327,000,000**
  - FY25 624,000,000 → **400,000,000**
- `quote.sharesOutstanding`, `quote.marketCap`: no change. Optionally set `quote.sharesSource` to `"sec-cover"` with 78,960,120.
- Provenance entries to add:
  ```json
  {"field": "ttm.fcfYield", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "companyfacts TTM to 2026-06-30 (FY25 + H1'26 − H1'25): NetCashProvidedByUsedInOperatingActivities 593 − (PaymentsToAcquirePropertyPlantAndEquipment 20 + PaymentsToAcquireEquipmentOnLease 140 + capitalized software 122 [untagged; 10-K 0001794669-26-000010 and 10-Q 0001794669-26-000045 cash-flow statements]) = $311M ÷ quote.marketCap; matches the company's FCF reconciliation (8-K ex. 99.1, Q2'26). Replaces vendor free_cash_flow_yield (OCF − PP&E only)."}
  {"field": "statements.cashflow.capex", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "10-K 0001794669-26-000010 cash-flow statement: PP&E + equipment to be leased + capitalized software development costs (FY23–FY25)"}
  ```

---

## DSP — Viant Technology (10-Q 0001828791-26-000072, CIK 1828791)

### Evidence: TTM FCF

| Concept | FY25 (10-K 0001828791-26-000019) | H1'26 (10-Q -26-000072) | H1'25 (comparative in -26-000072) | TTM |
|---|---|---|---|---|
| NetCashProvidedByUsedInOperatingActivities | 52,607 | 31,265 | 16,482 | **67,390** |
| PaymentsToAcquirePropertyPlantAndEquipment | 926 | 1,029 | 599 | 1,356 |
| PaymentsToDevelopSoftware ("Capitalized software development costs") | 17,367 | 8,847 | 7,923 | 18,291 |
| **FCF (OCF − PP&E − capitalized software)** | 34,314 | | | **47,743** |
| OCF − PP&E only (pack basis) | 51,681 | | | 66,034 |

(Values in $K.)

- **Shibui's $47,743K equals SEC to the dollar.** Its quarterly FCF sums −1,818 + 28,172 − 1,005 + 22,394.
- **The pack leaves out capitalized software.** For an ad-tech platform this is a recurring development cost of about 5% of revenue, not discretionary capex.
- **SBC is large relative to FCF.** TTM SBC is $29.4M (Shibui `sbcTtm`; SEC ShareBasedCompensation FY25 24.8 + H1'26 16.5 − H1'25 12.0 = $29.4M). Owner earnings are about $18.4M.
- **Shares (cover of -26-000072, as of 2026-08-07):**
  - Class A 21,135,122 + Class B 45,339,716 = **66,474,838**.
  - The pack's derived 66.52M is the A+B total. Class B pairs with LLC units in the Up-C, and consolidated FCF accrues to both, so that is the right basis.
  - Market cap $814M is correct.

### Affected report content (`data/dsp.json`)

- **`snapshot`:**
  - "FY25 Free Cash Flow" shows $51.7M. Correct: **$34.3M**.
  - "FCF Yield (TTM)" shows 8.1%. Correct: **5.9%**.
- **`financials.cashflow` table:**
  - FY23 FCF shows $36.6M. Correct: **$24.3M, 10.9% margin**.
  - FY24 FCF shows $49.3M. Correct: **$34.0M, 11.8% margin**.
  - FY25 FCF shows $51.7M at 15.0%. Correct: **$34.3M, 10.0%**.
  - The capex row omits capitalized software.
- **`financials.cashflowCommentary`**: "$51.7M … 15.0% FCF margin … Capital expenditure is very small. The trailing FCF yield is 8.1%." The figures are wrong, and "very small" is wrong too: total capex is about $19M a year.
- **Qualitative claims that still hold:**
  - `meta.subtitle` ("positive free cash flow"), `thesis.body` ("generates free cash flow") and `analystSentiment.commentary` ("cash generation") remain true, at a smaller magnitude.
  - The note about the "gap to earnings" in the cash-flow commentary is partly explained by the omitted capitalized software, plus SBC.
- **`valuation.scenarios`** rest on the forward P/E and Street targets. No FCF figure enters them.
  - Today: E +17.2%, R:R 0.56.
  - The label would change only if the author re-weighted.
- **`rating.decision.intrinsic`** (MoS +129%) used owner earnings of $66.0M − $29.4M = $36.6M. Corrected: $18.4M, so MoS falls by roughly half or more.
  - Decision conviction (84) would likely drop.
- **Materiality: medium.** Re-synthesize to correct the figures. The label probably holds.

### Proposed FactPack correction (`data/facts/DSP/0001828791-26-000072.json`)

- `ttm.fcfYield`: 0.0810977915030481 → **0.05863421661159441** (47,743,000 / 814,251,520)
- `statements.cashflow` `capex`:
  - FY23 −1,195,000 → **−13,476,000**
  - FY24 −2,498,000 → **−17,744,000**
  - FY25 −926,000 → **−18,293,000**
  - FY21/22: verify from the FY2022 10-K.
- `statements.cashflow` `freeCashFlow`:
  - FY23 36,557,000 → **24,276,000**
  - FY24 49,269,000 → **34,023,000**
  - FY25 51,681,000 → **34,314,000**
- Provenance:
  ```json
  {"field": "ttm.fcfYield", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "companyfacts TTM to 2026-06-30: NetCashProvidedByUsedInOperatingActivities 67,390K − PaymentsToAcquirePropertyPlantAndEquipment 1,356K − PaymentsToDevelopSoftware 18,291K = $47,743K ÷ quote.marketCap (10-K 0001828791-26-000019, 10-Q 0001828791-26-000072). Replaces vendor free_cash_flow_yield (OCF − PP&E only)."}
  ```

---

## DD — DuPont de Nemours (10-Q 0001666700-26-000053, CIK 1666700)

### Evidence

- **Separations.** Qnity (Electronics) was spun on 2025-11-01, and Aramids was sold on 2026-04-01. Both are discontinued operations. A 1-for-3 reverse split took effect on 2026-06-24.

| Concept | FY25 (10-K 0001666700-26-000013) | H1'26 (10-Q -26-000053) | H1'25 (recast in -26-000053) | TTM |
|---|---|---|---|---|
| NetCashProvidedByUsedInOperatingActivitiesContinuingOperations | 560 | 632 | 151 | **1,041** |
| PaymentsToAcquireProductiveAssets (continuing) | 333 | 178 | 172 | **339** |
| **FCF, continuing operations** | 227 | 454 | −21 | **702** |
| CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations | 852 | −158 | 540 | 154 |

- **The pack's $702M equals GAAP continuing-operations OCF − capex exactly.** It is also the basis on which the company reports. Adjusted FCF H1'26 is $454M against −$21M in H1'25 (8-K ex. 99.1 reconciliation).
- **Shibui's $1,049M mixes bases.** It sums Q3'25 as originally reported, while Qnity was still in continuing operations (revenue $3,072M, FCF $532M), with a Q4'25 plug derived as recast FY25 − original 9M. That plug has revenue **−$1,871M** and capex **+$150M**, so it is an artefact. Neither total-company nor continuing operations gives $1,049M.
- **Total-operations TTM is not the right basis for the post-spin equity.** OCF would be 1,195 (= 560+852 + 632−158 − (151+540)). The market cap is post-spin and post-reverse-split.
- **Shares.** The cover shows 135,042,975 as of 2026-07-31 (post-split), against the pack's derived 135.04M, so they match.
- **Caveat.** Trailing continuing-operations FCF is depressed by separation-related cash costs: FY25 continuing OCF was $560M. The company's transaction-adjusted FCF is higher (H1'26 $473M).

### Affected report content (`data/dd.json`)

- The cash-flow commentary cites FY25 FCF of $227M, a 3.3% margin and a 4.0% trailing FCF yield. All are correct on the continuing basis.
- The thesis and catalysts quote the company's Q2 transaction-adjusted FCF. Correct.
- The scenarios are driven by EBITDA/EPS guidance and Street targets. Not affected.
- **Materiality: none. No action.**
- Optional: add a provenance note so the next cross-check reviewer does not re-open this. The Shibui check will keep failing until Shibui recasts Q3'25.
  ```json
  {"field": "ttm.fcfYield", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "verified vs companyfacts: continuing-ops TTM to 2026-06-30 = NetCashProvidedByUsedInOperatingActivitiesContinuingOperations 1,041 − PaymentsToAcquireProductiveAssets 339 = $702M (10-K 0001666700-26-000013, 10-Q 0001666700-26-000053). Shibui fcfTtm 1,049 mixes Q3'25 as originally reported (incl. Qnity) with a recast Q4 plug — not adopted."}
  ```

---

## CVLG — Covenant Logistics (10-Q 0001437749-26-026547, CIK 928658)

### Evidence

| Concept | FY25 (10-K 0001437749-26-006086) | H1'26 (10-Q -26-026547) | H1'25 (comparative) | TTM |
|---|---|---|---|---|
| NetCashProvidedByUsedInOperatingActivities | 113,648 | 18,110 | 46,737 | **85,021** |
| PaymentsToAcquirePropertyPlantAndEquipment | 147,570 | 45,171 | 69,864 | **122,877** |
| ProceedsFromSaleOfPropertyPlantAndEquipment | 35,518 | 44,987 | 17,054 | **63,451** |
| **FCF, gross capex (pack)** | −33,922 | | | **−37,856** |
| **FCF, net of disposals (Shibui)** | 1,596 | | | **25,595** |

(Values in $K.)

- **Both figures reconcile to SEC to the dollar.** They differ only by definition.
- **Shibui's net basis is the trucking convention.** The 10-Q speaks of "net capital expenditures", and used-equipment proceeds are a recurring part of fleet replacement.
- **But the TTM proceeds are not run-rate.** H1'26 disposals of 573 used tractors against 181 new deliveries (10-Q investing-activities discussion) are a deliberate fleet sell-down. H1'26 proceeds were $45M, against $17M in H1'25.
- **What is missing from both figures.** Equipment financed through finance leases and installment notes never appears as capex.
- **Shibui's Q1'26 row has a sign error.** It shows capex +$24.2M, which is the net of proceeds 35.6 and purchases 11.4, booked with the sign flipped.
- **Shares.** Class A 20,677,778 + Class B 4,700,000 = 25,377,778 (cover), against the pack's 25.38M, so they match.

### Affected report content (`data/cvlg.json`)

- **Statements that are correct on the gross basis but would read differently net of disposals:**
  - `financials.cashflowCommentary` ("FCF margin was negative in each of FY23, FY24 and FY25 … trailing FCF yield is −4.4%")
  - `executiveSummary.risks[1]`
  - `management.capitalAllocation` ("FY25 share repurchases … in a year of negative free cash flow")
- **Net of disposals:** FY23 −$40.9M, FY24 **+$20.4M**, FY25 **+$1.6M**, TTM +$25.6M (+3.0% yield).
- **Scenarios** run on EPS and Street targets (FY27E $2.73). FCF does not enter them. Label: E +18.0%, R:R 0.70.
- **Intrinsic** is null today. On the net basis, owner earnings of about +$24.6M would let the DCF run, but on an unrepresentative base.
- **Materiality: low.** Keep the pack value. It is consistent with Juniper's OCF − capex-payments definition, and the net TTM is flattered by a one-off fleet sell-down.

### Proposed FactPack correction

- `ttm.fcfYield`: **no change** (−0.04418539279469584).
- Add a provenance entry so the definitional `fail` is documented:
  ```json
  {"field": "ttm.fcfYield", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "verified vs companyfacts TTM to 2026-06-30: NetCashProvidedByUsedInOperatingActivities 85,021K − PaymentsToAcquirePropertyPlantAndEquipment 122,877K = −$37,856K (gross capex, Juniper definition). Net of ProceedsFromSaleOfPropertyPlantAndEquipment 63,451K = +$25,595K (Shibui basis); H1'26 proceeds reflect a fleet sell-down (573 tractors disposed) and are not run-rate. 10-K 0001437749-26-006086, 10-Q 0001437749-26-026547."}
  ```
- At the next synthesis the author should show both bases in the cash-flow commentary.

---

## BAM — Brookfield Asset Management (10-Q 0001628280-26-054933, CIK 1937926)

### Evidence: TTM FCF

| Concept | FY25 (10-K 0001628280-26-013098) | H1'26 (10-Q -26-054933) | H1'25 (comparative) | TTM |
|---|---|---|---|---|
| NetCashProvidedByUsedInOperatingActivities | 2,101 | 883 | 643 | **2,341** |
| PaymentsToAcquireOtherPropertyPlantAndEquipment ("Other assets") | 9 | 16 | 3 | 22 |
| **FCF** | 2,092 | | | **2,319** |
| NetCashProvidedByUsedInInvestingActivities (Q2'26 / Q2'25 quarters) | | (308) | (490) | |

- **The pack's $2,319M equals SEC exactly.**
- **Shibui's quarterly `operating_cash_flow` is BAM's net cash from investing activities.** Q2'26 −308 and Q2'25 −490 match the 10-Q's investing subtotals to the dollar, against GAAP OCF of +545 and +529. Shibui's −$232M is a field-mapping error on Shibui's side.
- **Consolidation basis is not the cause.** The 10-Q statements are BAM's condensed consolidated statements, including consolidated funds, after the February 2025 Arrangement. Shibui's revenue uses the same basis as the SEC figures.
- **Shares.** Pack 1,597.3M (derived) against Shibui 1,596.8M. Fine.

### Evidence: revenue

| | Q2'26 | Q2'25 | YoY | FY23 | FY24 | FY25 |
|---|---|---|---|---|---|---|
| GAAP `Revenues` (companyfacts) | **1,753** | 1,090 | +60.8% | 4,062 | 3,980 | 4,817 |
| Base management & advisory fees + incentive fees (10-Q income statement) | **1,047** (919+128) | 931 (815+116) | +12.5% | — | — | — |
| Pack / vendor `revenue` | 1,047 | 931 | +12.5% | 3,142 | 3,381 | 3,944 |

- **The vendor series is fee revenue.** It excludes unrealized carried interest ($553M in Q2'26), interest and dividend revenue, and other revenues.
- **Both figures are defensible as analytics.** Fee revenue is the more stable measure of an asset manager's growth.
- **But the pack labels fee revenue as "Revenue" and sets it against consensus estimates that are on a GAAP-total basis.** FY26E is $6.09B. GAAP H1'26 is already $3.09B and GAAP TTM is $5.74B, so consensus is on the GAAP-total basis.

### Affected report content (`data/bam.json`)

- **The FCF content is correct and unaffected:**
  - "FY25 free cash flow $2.1B"
  - "trailing FCF yield 3.2%"
  - "distribution ran ahead of FCF" (FY25 dividends $2.8B against OCF $2.1B)
- **Wrong because the revenue bases are mixed:**
  - **`growth.points[0]`**: "FY26E revenue of about $6.1B, up 54% from $3.9B". On the GAAP basis it is +26% on FY25 and +6% on TTM.
  - **`growth.points[1]`**: "That step-up runs well above the +12.5% … we treat that gap as the main risk to the base case". The gap is a basis mismatch. GAAP Q2 revenue grew 61%, helped by unrealized carry.
  - **`financials.incomeCommentary`** and **`analystSentiment.commentary`**: "FY25 revenue +16.7% to $3.9B" is the fee-revenue basis. GAAP is $4.8B, +21%.
  - The **Base driver** ("Revenue advances toward the consensus FY26E figure of about $6.1B") reads as a stretch but is nearly on track on a GAAP basis.
- **Multiples on the wrong basis:**
  - **P/S 17.9x** (`ttm.ps`, used in the multiples table, `multiplesCommentary` and the Bear driver) uses fee-revenue TTM ($4.10B). The GAAP TTM P/S is **12.8x**.
  - The 74.8% net margin pairs GAAP net income with fee revenue.
- **Rating:**
  - Today: E +12.9%, R:R 0.74. The implied prices are anchored to the 52-week range and Street targets.
  - The correction removes a stated risk rather than adding one. If anything the Base weight would rise, so the label would not fall.
- **Materiality: medium for prose, low for the label.** Correct the FactPack revenue basis and refresh the growth and multiples prose at the next synthesis.

### Proposed FactPack correction (`data/facts/BAM/0001628280-26-054933.json`)

Recommended option: put GAAP figures in the fields, so actuals and consensus share one basis.

- `latestQuarter.revenue`: 1,047,000,000 → **1,753,000,000**
- `latestQuarter.revenueYoY`: 0.12459720730397428 → **0.6082568807339450**
- `statements.income` `revenue`: [3,142, 3,381, 3,944]M → **[4,062, 3,980, 4,817]M** (10-K 0001628280-26-013098)
- `ttm.ps`: 17.941782 → **12.81** (73,489,539,072 / 5,737,000,000 GAAP TTM revenue)
- `ttm.netMargin`: recompute on GAAP TTM revenue.
  - Net income TTM = 2,398 + 1,758 − 1,091 = 3,065, so 3,065 / 5,737 = **0.534**.
  - The vendor's 0.748 used fee revenue as the denominator.
- Provenance:
  ```json
  {"field": "latestQuarter.revenue", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "companyfacts us-gaap:Revenues 2026-04-01→2026-06-30 = $1,753M (10-Q 0001628280-26-054933). Vendor value $1,047M was base management & advisory fees ($919M) + incentive fees ($128M) only; replaced so actuals share the GAAP basis of consensus estimates."}
  {"field": "ttm.fcfYield", "source": "edgar", "capturedAt": "2026-10-03T00:00:00.000Z",
   "endpoint": "verified vs companyfacts TTM to 2026-06-30: NetCashProvidedByUsedInOperatingActivities 2,341 − PaymentsToAcquireOtherPropertyPlantAndEquipment 22 = $2,319M. Shibui fcfTtm −232 sums net cash from INVESTING activities (Q2'26 −308, Q2'25 −490 match the 10-Q investing subtotals) — Shibui mapping error, not adopted."}
  ```

Alternative option: keep fee revenue and add `revenueBasis: "fee revenues (base management + incentive)"`. In that case the consensus revenue estimates must not be compared with it in prose.

---

## Follow-ups (not done here — code and tests are out of scope for this review)

1. **Vendor FCF yield.** The tearsheet's `free_cash_flow_yield` is OCF − PP&E purchases. For any name with capitalized software, leased equipment or other capex-like investing lines, it overstates FCF.
   - The SEC fallback list `CAPEX_RAW` in `lib/facts/free/sec.ts` has the same gap.
   - Consider adding `PaymentsToDevelopSoftware`, `PaymentsForSoftware` and `PaymentsToAcquireEquipmentOnLease`.
   - Consider a Shibui-fail → SEC-recompute step before synthesis.
2. **Shibui-check levels.** DD (mixed-basis Q3) and BAM (investing-as-OCF) are Shibui data errors. CVLG is a definition difference.
   - The `fail` level is right to block the DCF, but a reviewed `fail` should be recordable as "SEC-verified, pack retained". The provenance notes above can carry that.
3. **FOUR FY21/FY22 capitalized software** is not in the local filings. Fetch the FY2023 10-K before correcting those two columns.
