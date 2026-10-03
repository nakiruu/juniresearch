# Adversarial review: dynamic sleeve plan (2026-10-03)

Reviewed: `docs/superpowers/specs/2026-10-03-dynamic-sleeve-plan.md`, research reports A–E, the engine (`lib/trade`, `lib/portfolio`), `docs/portfolio/01-conceptual-outline.md` and `docs/scoreconcepts/10.md`.
Reviewers' stance: a skeptical quant PM and a risk officer. No repo files were changed.

## How the 3-state rule was tested

The plan says the graded 3-state rule "isn't tested yet" (§2.2). Report E's data made the test cheap, so we ran it with `scratchpad/critique_bt.py` and `critique_bt2.py`. The design:

- **Simulation:** a daily simulation. Votes are taken at the month-end close and the first trade happens at the next day's close.
- **Rules as specified:**
  - glide of 15 points per sleeve per month, plus 10% of NAV gross per daily run;
  - a ±3-point dead band;
  - one-step de-risking, with 3 votes going straight to Defensive;
  - 2-month or trend-cleared re-risking;
  - the 24-month rebound guard.
- **Signals and costs:**
  - volatility in the top quintile of an expanding history from 1928 (the threshold is about 19.5% today);
  - Baa−10y 3-month change above 0.40;
  - T-bills from TB3MS;
  - 10 bp per unit of one-way turnover.
- **Engine check:** the engine reproduces report E's own numbers within about 0.3 pp. Static 70/30 gives a monthly max drawdown of −51.7 against E's −51.6, and trend→T-bills gives −39.6 against E's −40.0.

**IWO/SPY, 2000-09 to 2026-09.** In-sample (IS) runs to 2013-08; out-of-sample (OOS) is after that. Max drawdown is measured on daily NAV.

| Rule | CAGR | MaxDD | Sharpe | State changes (per yr) | IS MaxDD / Sharpe | OOS MaxDD / Sharpe | Time in R/C/D (%) | Average G/C/T (%) |
|---|---|---|---|---|---|---|---|---|
| Static 50/50 | 7.51 | −56.1 | 0.36 | 0 | −56.1 / 0.17 | −36.0 / 0.60 | – | 50/50/0 |
| Static 47/46/7 (the plan's average, same exposure) | 7.30 | −53.4 | 0.36 | 0 | −53.4 / 0.17 | −34.1 / 0.60 | – | 47/46/7 |
| **3-state as specified** | 7.27 | −46.6 | 0.37 | 68 (2.6) | −46.6 / 0.20 | −33.3 / 0.55 | 66/13/21 | 46/47/6.5 |
| 3-state, votes mapped straight to states (no transition rules) | 7.23 | −46.4 | 0.37 | 72 (2.8) | −46.4 / 0.20 | −32.9 / 0.55 | 69/11/20 | 47/47/6.0 |
| 3-state without the credit leg | 7.35 | −47.3 | 0.37 | 68 | −47.3 / 0.21 | −33.3 / 0.55 | – | – |
| **Trend-only → Defensive (25/50/25)** | **7.39** | **−46.8** | **0.38** | **38 (1.5)** | −46.8 / **0.22** | **−32.9** / 0.54 | 74/0/26 | 48/46/6 |
| Trend-only → Caution only (40/50/10) | 7.43 | −52.5 | 0.36 | 38 | −52.5 / 0.19 | −33.4 / 0.57 | – | – |

**NAESX/VFINX, 1990-02 to 2026-09.** IS runs to 2008-05.

| Rule | CAGR | MaxDD | Sharpe | Changes (per yr) | IS MaxDD / Sharpe | OOS MaxDD / Sharpe | Time in R/C/D (%) | Average G/C/T (%) |
|---|---|---|---|---|---|---|---|---|
| Static 50/50 | 10.88 | −57.3 | 0.50 | 0 | −43.5 / 0.49 | −53.6 / 0.52 | – | 50/50/0 |
| Static 47/46/7 | 10.49 | −54.1 | 0.50 | 0 | −40.6 / 0.49 | −50.6 / 0.52 | – | 47/46/7 |
| **3-state as specified** | 10.24 | −47.9 | 0.51 | 94 (2.6) | −37.0 / 0.51 | −43.0 / 0.52 | 68/16/17 | 47/47/5.6 |
| 3-state without the credit leg | 10.26 | −48.3 | 0.51 | 95 | −37.1 / 0.50 | −43.0 / 0.52 | – | – |
| **Trend-only → Defensive** | **10.45** | **−47.3** | **0.52** | **51 (1.4)** | **−36.2 / 0.52** | **−41.8 / 0.53** | 78/0/22 | 49/46/5 |

What the test shows:

- **Trend-only matches or beats the 3-state rule.** Across both pairs and both halves it does as well or better on max drawdown, Sharpe and CAGR (within ±0.01 Sharpe and ±0.4 pp of max drawdown in the two near-ties). It does this with about 55% of the state changes.
- **The plan's other estimates mostly hold.**
  - Share of time: the plan says about 65–70 / 10–15 / 15–20; the test gives 66–68 / 13–16 / 17–21.
  - Average split: the plan says 47/46/7; the test gives 46–47 / 47 / 5.6–6.5.
  - Volatility signal: the quintile threshold gives the same results as a fixed 20%.
- **The credit leg is worth about 0.4–0.7 pp of max drawdown.** When a single vote fires, the trend leg causes 32 of those months, volatility 25 and credit 3.
- **The transition rules and rebound guard change nothing measurable.**
- **The help is concentrated in a few bears.** Against static 50/50, the 3-state rule cut the drawdown by 10.1 pp in 2000–02, 9.5 pp in 2008, 2.7 pp in 2020 and 3.8 pp in 2022. In 2011, 2015–16 and Q4 2018 it gained 0 to 1 pp, and in 2015–16 the drawdown was 1.1 pp deeper.

---

## Findings, ranked

### Critical

**C1. The plan's own pre-registered tie-break already picks trend-only.**
The plan, §2.2 (line 96), says: "If trend-only wins in both the in-sample and held-out periods, adopt trend-only with the same weights." Our test shows it does, on both proxy pairs. The 3-state rule also makes 2.6 state changes a year. That breaks the plan's own expectation of "1–2 state changes a year" (line 109) and its stage-1 pass limit of "2 a year or fewer" (line 197).

Three parts of the graded design add nothing:
- the Caution state on its own buys about 3–4 pp of drawdown;
- the credit leg adds about 0.5 pp;
- the transition rules make no difference.

The rule fails the simplicity test.

*Fix:* replace §2.2–2.3 with a two-state trend rule:
- Risk-on 55/45/0 and Defensive 25/50/25.
- The S&P's 10-month SMA (total return) as the only vote.
- Glide limit of at most 15 points a month.

Keep volatility and credit as logged, displayed context. Revisit the 3-state rule only if the Ken French stage-1 backtest reverses this result, and say that the burden of proof sits on the more complex rule (report A, §c: "adopt the composite only if it beats trend-only on Calmar in the holdout").

**C2. The integration design would either do nothing or mis-size the LIVE book.** Four separate problems:

1. **Per-name trade band.** `rebalance.ts:92-110` trades a HOLD name only when |Δw| > `tradeBand` 0.025. A sleeve shift is spread pro rata across names, so a 15-point Risk-on→Caution cut over about 25 growth names is about 0.6 pp per name. Even over 8 names it is about 1.9 pp. Every name lands in BELOW_BAND.
   - The T-bill buy then has no cash to use.
   - The never-leverage scaler (`rebalance.ts:113-125`) scales it to zero and records it as NO_CAPACITY.
   - Report C §6 warned about this, but the plan does not handle it.
2. **The sizing formula has a unit error.** Line 187 sets target = sleeve weight × (1 − cash floor − frozen − T-bill weight). The state weights (25/50/25) already sum to 100% *including* the T-bill leg, so the T-bill share gets taken out twice.
   - Example: Defensive growth comes out at 0.25 × (0.99 − 0.2475) = 18.6% of NAV instead of 24.75%.
   - Frozen weight is subtracted from every sleeve, yet line 188 says it "counts toward its sleeve's total".
3. **No existing mechanism can clip a de-risking plan.** `clipToTurnover` (`breakers.ts`) clips buy-only plans and returns null for any plan with a sell, and that null means the run halts.
   - Suppose someone builds the "10% of NAV per run" cap by setting `TURNOVER_BREAKER=1`.
   - Every de-risking run would then halt.
   - Three halts trip `consecutiveHaltLimit` and block all trading, in the middle of a drawdown, on Schwab.
4. **Ballast double-count.** A held T-bill ETF with no Signal is frozen as NO_SIGNAL and added to `frozenWeight` (`rebalance.ts:47-51`). That already lowers `sizingTarget`. If the ballast path is half-built, the T-bill weight is deducted twice.

*Fixes:*
- Define the per-sleeve target as w_s × (1 − cashFloor) − frozen_s.
- Make overlay deltas band-exempt, or apply a sleeve-level band: when the overlay target moves, rescale every name in the sleeve.
- Add a new sell-capable glide clipper. It should move the target along a path; it must not halt.
- Give the ballast its own classification inside `emitTrades`.
- Say in the plan that `TURNOVER_BREAKER` stays as the owner set it.
- Add unit tests for all four cases before Alpaca paper.

**C3. The validation gate is mis-specified, and the 3-state rule fails it anyway.** Three problems (§6, line 197):

1. **Wrong baseline.** The gate compares against static 50/50, which has more average equity than the plan's 47/46/7. About 2.5–3 pp of the "improvement" is simply less equity on average. Against an exposure-matched static mix, the 3-state rule improves max drawdown by 6.3–6.8 pp, which is under the 8 pp bar.
2. **It fails in a held-out half.** In IWO/SPY OOS the improvement is 2.7 pp, and in NAESX IS it is 6.5 pp. The plan requires 8 pp in both halves. Trend-only also fails IWO/SPY OOS (3.1 pp).
   - A single max drawdown is one event per half (2020 in the OOS half), so this gate is fragile by construction.
3. **The CAGR cost is hidden.** The plan says "equal or better Sharpe", but the CAGR give-up against static 50/50 is 0.2–0.6 pp a year over the full samples and 1.0–1.5 pp a year in the recent halves, before tax.

*Fixes:*
- Benchmark against a static mix with the same average equity exposure.
- Use multi-episode metrics: the mean of the 5 worst drawdowns, monthly CVaR(5%) and the Ulcer index.
- Pre-register a CAGR give-up budget (for example ≤0.5 pp a year).
- State the expected trade-off in §0: about 7–10 pp less max drawdown in slow bears, almost nothing in V-shaped or choppy markets, and about 0.2–1.5 pp a year of return given up.

### Important

**I1. The doctrine argument misreads 10.md.** The plan, §2.4 (line 116), says "`scoreconcepts/10.md` §2 already allows conditional bear-case sizing *as a desk policy*", and calls this "the doctrine's own exception".
- **What 10.md §2 (lines 80–83) actually says:** "Factor-timing evidence is weak … the defensible use of regime is conditional bear sizing: when HY spreads or the VIX sit in their top quintile, raise the desk bear floor from 15% to 20–25% for net debtors."
  - That is a name-level *valuation input*: a scenario floor that feeds D and R.
  - It is not a top-down cash or T-bill allocation.
  - "Desk policy, not a model" describes *how to encode* the input; it does not license portfolio-level timing.
  - 10.md is a "missing factors" research note, not the locked doctrine.
- **The quote's location is wrong.** The plan attributes the quote to "§1 and §13.3". The quote is in §1 (line 52). §13 item 3 says "breadth-driven not timing-driven".
- **The two options contradict each other.** Option B is described as "deliver[ing] nothing" (line 117) and then as "still worth doing" (line 119).

*Fix:*
- Drop the "exception" argument.
- Present the T-bill leg plainly as an amendment, justified by a *risk* edge (drawdown) with its cost stated per C3.
- Say that no return edge is claimed, which is consistent with the doctrine's concern.
- If the owner declines, the honest fallback is **no overlay**: a static, exposure-chosen mix plus the hardened core. Report E shows a growth↔core swap is noise, so it isn't worth the complexity or the tax.

**I2. The strategic split and name caps quietly depart from report B.**
- **B's recommendation (§c):** CORE 60 / GROWTH 40, with the overlay band at 25–55 and "50/50 is the most defensible ceiling". B also recommends single-name caps of 2.5% (growth) and 5% (core) of the whole portfolio (B §d).
- **What the plan does:** Risk-on 55/45 sits above that ceiling for about two-thirds of the time. Within each sleeve the plan keeps `wMax` 0.10 (line 187), so one small-cap growth name could reach 10% of NAV.
- **What is missing:** the plan's line 31 cites B §c for its split without saying it departs from B. "The owner wants growth-led" is stated, but no quote from the owner supports it.

*Fix:* show B's 40/60 alongside the plan's choice and let the owner choose. Adopt B's per-sleeve name caps (`wMax` set per sleeve), or justify 10%.

**I3. The case for the credit leg overstates its evidence.**
- **Line 32 says "each leg has robust evidence".** Report A rates credit "weak as a tested trading rule; my thresholds are judgment calls".
- **Report E's diagnostics show next-month returns *higher* after credit risk-off.** IWO/SPY: growth 2.23 vs 0.58 %/mo; NAESX: 1.93 vs 0.90.
- **Credit→T-bills made max drawdown *worse* on IWO/SPY:** −53.2 vs −51.6.
- **The design contradicts the stated role.** Line 72 says credit is "never a trigger on its own", yet with the graded states one credit vote alone moves the book to Caution.
- **The plan omits all of this.**

*Fix:* demote credit to context (keep the HY logging, since it is cheap), or drop it with trend-only (C1).

**I4. Robustness claims are applied to the wrong test.**
- **"9-, 10- and 12-month windows … give identical results (E §3), so there is no parameter to overfit" (line 70; repeated at line 210).** That sensitivity was run on the equity-only *swap*, where nothing works. Report E says it "mostly confirms there is no edge to overfit". It says nothing about the T-bill version, and E ran no window sensitivity on the T-bill variant.
- **"Hurst-Ooi-Pedersen: trend is positive in 8 of the 10 largest 60/40 drawdowns".** That result is for diversified long/short futures trend, not a long-only S&P filter. Report A: "transfers only partly".
- **"Daily signals double the false alarms".** The figures are 3.9 vs 2.4, which is 1.6×.

*Fix:* re-run the window sensitivity on the T-bill variant in stage 1 and correct the wording.

**I5. Sleeve sizing breaks the sector cap and leaves names with no sleeve.**
- **The sector cap stops working across sleeves.** `allocateCapped` applies `sectorMax` 0.30 as an absolute share of NAV within each call (`sizing.ts:89-102`). Calling it once per sleeve allows up to 0.60 of NAV in one sector across both sleeves, for example technology in growth and in core.
- **Some names fit no sleeve.** Names between $20B and $50B that were never in growth fit neither sleeve. Neither does a BUY-rated name over $50B that fails the core rules. Phase 0 ("classify the current list") has no rule for them.
- **Unfilled sleeve weight becomes extra cash.** If a sleeve is short of eligible names, its unfilled weight becomes cash (the "shortfall becomes cash" rule) on top of the T-bill leg. `cashCeiling` 0.35 is reported but not enforced.

*Fixes:*
- Add a global sector cap pass after the per-sleeve allocation.
- Write an explicit rule for unassigned names, such as "core-eligible if it passes the core rules, otherwise growth until its next check".
- Define where unfilled sleeve weight goes: the other sleeve, or T-bills, with a reporting cap.

**I6. There is no failure mode for data or schedule problems on a LIVE path.** The overlay depends on Yahoo, an unofficial endpoint, and FRED at month-end. The plan doesn't say what happens in any of these cases:
- a fetch fails;
- the data is stale;
- the month-end run is missed;
- the owner wants a manual override or kill switch.

*Fix:* add these rules:
- On missing or stale inputs, hold the last state, never transition, and alert.
- Add an `OVERLAY_ENABLED` flag and a manual state pin.
- Notify the owner on every state change before the first trade.
- Run the overlay only from the local runner, never from the cloud (per `10022026learning.md` §5).

**I7. Rollout order lets unvalidated screens reach Schwab.**
- **The ordering problem.** Phase 2 turns on *automatic adds* while validation stages 1–3, including the screen backtest (stage 2), run in parallel.
- **Why it reaches LIVE.** `trade:cron` already ENTERs any fresh BUY report.
- **The result.** New, untested admission rules start shaping the LIVE book before stage 2 reports.

*Fix:* keep the manager in proposal-only mode until stage 2 is done.

**I8. Taxes and wash sales are only flagged, not handled.**
- **The re-risk path allows a round trip inside 30 days.** The "S&P closes a month above its 10-month average with fewer than 2 votes" path permits de-risking at one month-end and re-risking at the next.
- **The 5-day lock does not prevent wash sales.** It is a compliance rule, not a wash-sale rule (report C §4).

*Fix:*
- Answer the taxable-account question before stage 4.
- Run stage 1 after tax as well.
- Consider a separate 30-day wash-sale check on loss lots. It must not touch the employer lock logic, so it needs owner sign-off.

**I9. Several figures are misquoted, and the errors lean in the plan's favour.** Each item gives the plan's line, then what the source says.

- **Line 109, "1–2 state changes a year … 28–40 switches over 26 years":**
  - The 28–40 are *binary* 2-state switch counts from report E.
  - The 3-state rule makes 68 changes over 26 years (2.6 a year).
- **Line 33, "within ±2 pp of the static mix in every test":**
  - In report E's NAESX IS half the swaps made drawdowns *worse*: exit-confirm −39.7 vs static −35.0, and the RV>18% variant −41.3.
  - This strengthens the plan's thesis, but "every test" is false.
- **Line 91, "matches report E's measured gain … 11–12 pp":**
  - That gain came from the trend-only rule.
  - The 2-of-3 rule managed 6.5 pp on IWO/SPY in E.
  - The 3-state rule managed about 9.5 pp against static 55/45 in our test.

### Minor

- **Line 36.** Report D gives "turnover −41%, costs −42%" as the average buy/hold-spread result across 23 anomalies, not a result specific to the 10%/20% rule.
- **Lines 50–56.** The text says "four proxy pairs" but the table shows three. For NAESX the "best switched" Sharpe difference is −0.01, not 0.00.
- **Line 76.** VIX > 30 and breadth < 30% were not in report E's next-month diagnostics, which tested VIX > 25 and breadth < 40%. The claim comes from E's prose recommendation.
- **Line 187.** The `sizing.ts:132-141` reference misses the `allocateCapped` call at `:142`; the loop spans `:132-146`. The `rebalance.ts:56-71` reference is correct.
- **Rule 2 vs rule 5.** "3 votes go straight to Defensive" is moot, because the 15-point monthly glide still spreads the 30-point growth cut over 2 months.
- **The dead band** of ±3 points is tighter than report B's ±5 pp, and is set in different units from the per-name 2.5 pp band. Pick one unit system.
- **Line 88.** The "hardened-core beta 0.95" is report B's figure for the *unhardened* MSCI USA Quality index (0.93). A Blume-shrunk cap of ≤1.0 probably yields about 0.85–0.9, which helps the case; say so.
- **Line 172.** Deleting raw data for names without a report conflicts with report D ("keep everything; it costs little") and with the owner's archive preference. Archive it instead.
- **Choice of T-bill instrument.** A Schwab bank sweep yields far less than SGOV or BIL (about 4% today). At an average T-bill weight of about 6%, that gap costs about 0.25% a year. Recommend SGOV or BIL through the engine so reconcile sees buy fills. Note: `bucketFor(null)` puts it in the "mid" bucket, which is harmless.
- **T-bill leg.** The plan's 7% average is closer to 6% in our test.

### Over-engineered (cut)

- the 3-state grading;
- the credit vote;
- the expanding volatility quintile (same results as a fixed 20%);
- the rebound guard and its core-first step;
- two confirmation paths;
- two glide limits plus a dead band.

None of these moved a result measurably. A two-state trend rule with one glide limit needs about 4 parameters instead of about 12.

### Kept, and well done

- The central insight that a sleeve swap doesn't cut drawdowns, and that the lever is equity exposure.
- The hardened core definition.
- The banded watchlist with hard exits.
- Archive metadata for μ calibration.
- Staged shadow → paper → live rollout.
- The explicit statement that locks are untouched and that any lock change goes to the owner.
- The phase 0 drift items: we checked all of them against `data/edgar` and `data/judgment` and they are accurate.

---

## Verdict

**The direction is right but the plan isn't ready to approve as written.** The thesis ("swaps don't cut drawdowns; only a T-bill leg does") is sound and is supported by report E and by our independent re-run. Three problems block approval:

- the overlay is over-engineered, and its own pre-registered test picks trend-only;
- the integration section would no-op or mis-size trades on the LIVE engine;
- the doctrine argument leans on a misreading of 10.md.

**What to do:**
- **Approve now:** the watchlist manager (phases 0–1, proposal-only) and the sleeve definitions, once the per-name caps and the sector cap are fixed.
- **Rewrite** the overlay as two-state trend-only, the integration section (C2), the validation gate (C3) and the doctrine case (I1).
- **Then** resubmit the overlay for owner sign-off.
