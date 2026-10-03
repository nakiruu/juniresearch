# Research C — Engine map for a dynamic growth/core sleeve overlay (read-only)

## 1. Sizing (lib/portfolio)
- config.ts:35-43 DEFAULT_CONFIG: muMin .05, rMin .5, convictionMin 45, stalenessMaxDays 120, mu/conv/rExp 1/1/1,
  alpha .4 + sigmaMin .05 (legacy, UNUSED), quality tilt qGainComposite .10 / qGainMoat .20 / qPenaltyEroding .10 clamp [.8,1.2],
  stalenessHalfLifeDays 90, wMax .10, sectorMax .30, wMin 0, cashFloor .01, cashCeiling .35, minNamesForCeiling 4.
  NOTE: cashCeiling/minNamesForCeiling are NOT enforced by any sizer — only reported (scripts/trade-review.ts:239, portfolio-build.ts:26).
- sizing.ts:24-36 scoreWeight = mu^muExp * kappa^convExp * R^rExp * staleness * (quality if tilt). kappa = conviction/100.
- sizing.ts:55-110 allocateCapped(items, target, cfg): water-fill proportional to score; name clamp at wMax (:80), sector scale-to-cap (:94-102).
  Shortfall becomes cash; never leverage.
- sizing.ts:116-158 sizePortfolio: eligibility -> target = 1 - cashFloor (:132) -> allocate -> dust loop -> ban filter. `scorer` injectable (:122).
- sizing-v2.ts:26-44,55-65 kellyTilt (experimental, flag only, NOT used by trade layer): w = core*(C/50)^1.0*(Q/50)^0.6*staleness*L,
  core = mu*R (default) or mu/max(sigma,.05); L = 1.0/0.9/0.7 by cap bucket. Raw Kelly mu/sigma^2 explicitly rejected.
- eligibility.ts:16 BANNED_TICKERS={ICE} (hard, outside config); :23-38 gate: buy-side label+gate, mu>=muMin, R>=rMin, kappa, age.
- signal.ts:32-73 buildSignal: mu/sigma/sigmaDown from 3 scenarios vs live mark; D = worst-scenario loss; R = mu/D; quality = clamped
  composite/moat tilt; staleness = 0.5^(age/90); `touch` (display only) from report.quote.history via realizedVol.
- quality.ts:23-25,91-101 cross-sectional Q 0-100 (ROIC .4, ROE stability .2, FCF conv .15, balance .15, moat .1) — used only by kellyTilt.
- benchmark.ts:1-16 activeWeights vs 1/N equal-weight of covered universe (NOT SPY).
- HOOK POINTS for sleeves: (a) cleanest = call allocateCapped twice — once per sleeve with target = sleeveWeight*(1-cashFloor-frozen) —
  in rebalance.ts:56-71 (trade path) and sizing.ts:132-141 (analytical); (b) add a per-sleeve cap as a third freeze class inside
  allocateCapped next to the sector cap (:94-102), keyed by a `sleeve` field that would need to be added to Scored/Signal;
  (c) regime scalar on cashFloor/target (rebalance.ts:56) = cash overlay, but see §6 doctrine conflict.
  Sleeve membership (growth vs core) has no existing field — would need a new classifier (e.g. Q, beta, SIC, mu).

## 2. Trade layer (lib/trade)
- config.ts:54-71 defaults: muEnter .08 / muExit .03, rEnter .60 / rExit .35 (hysteresis; invariant-checked :122-123), tradeBand .025,
  lockBusinessDays 5, markMode "settled", fractionalShares true, minEnterUsd 1, minTradeUsd 1, minTradeNavFrac .005, marketOnlyBelowUsd 200,
  maxOrdersPerRun 40, maxNotionalFrac 1.0, useQualityTilt TRUE (trade path differs from analytical snapshot), cronTimesET ["09:45"],
  maxRunTurnoverFrac .15, maxDayTurnoverFrac .25, consecutiveHaltLimit 3, gapHalt .10/.15/.25, maxLateMin 20, residualBand .005 (off).
  Env overrides only TRADE_MIN_USD / TRADE_MIN_NAV_PCT (:95-109).
- hysteresis.ts:19-44 classify: held -> EXIT if banned / label or gate not BUY|STRONG BUY / mu<.03 / R<.35 / stale; else HOLD.
  Sell-locked exit -> DEFER_EXIT. Not held -> ENTER if mu>=.08, R>=.60, kappa>=45, fresh, not buy-locked (else BARRED_ENTRY).
- rebalance.ts:35-138 emitTrades: freeze NO_SIGNAL + DEFER_EXIT weight (:46-53); sizingTarget = 1-cashFloor-frozen (:56);
  scoreWeight+allocateCapped on HOLD∪ENTER (:61-71); ENTER band-exempt; HOLD trades only if |Δw|>2.5pp and side unlocked (:92-110);
  buyScale never-leverage (:115-125); asserts no negative cash / no banned buy (:134-135).
- breakers.ts:17-21 turnover (Σ|qty·limit|/NAV>15%); :33-46 buy-only clip; :53-62 day turnover; :99-101 consecutive-halt; run-lock.
  IMPORTANT: runtime.ts:38-40 TURNOVER_BREAKER env unset => breaker OFF in production (owner choice 2026-10-01); engine.md §6.1 still
  describes it as on. cron.ts:209-247.
- costs.ts:5 ROUND_TRIP_BPS large 8 / mid 15 / small 30 — reporting only, not in sizing.
- locks.ts:15-34 symmetric whole-ticker 5-business-day lock from every fill (buy -> sell-locked, sell -> buy-locked); guards re-check.
- orders.ts:62-67 floors: ENTER >= $1; ADD/TRIM >= max($1, 0.5% NAV); EXIT none.
- Cadence: one run per trading day at 09:45 ET (register-trade-cron.sh / in-app scheduler, TRADE_SCHEDULER_ENABLED=1), late >20 min refused,
  closed days self-skip. Marks = prior settled close (pipeline.ts:63,70).
- Regime/drawdown/vol logic: NONE. No SPY, VIX, drawdown, NAV high-water or vol logic anywhere in lib/trade. Breakers are operational
  (turnover, halts, reconcile, gapHalt per-name vs reference price, cash backstop) — none market-keyed. Cash is purely emergent (floor 1%).

## 3. Data reachable from the LOCAL trading path
- planRun (pipeline.ts:53-110) reads only: broker calendar, positions, orders, account, getLastClose for report tickers + held (single
  close on markDate), latest trade/quote for traded tickers. SPY is never requested.
- Adapter (lib/broker/adapter.ts:18-40) has no history method. Alpaca getLastClose uses /v2/stocks/bars with start=end (alpaca.ts:84-89)
  — the endpoint supports ranges and SPY, so a getDailyCloses(sym, from, to) is a small extension. Schwab pricehistory (schwab.ts:184-196)
  pulls a 10-day window per symbol; can take longer periods; one call per symbol (concurrency 4).
- Yahoo (lib/prices/yahoo.ts:17) fetchDailyCloses — keyless, any symbol (SPY, ^GSPC, ^VIX plausible), used by portfolio-build.ts:57 (SPY
  spot for snapshot) and facts-prepare.ts:46 (filing period-end −45d → today). Not in the trade path; unofficial endpoint.
- History kept: lib/facts/map/history.ts:7 HISTORY_DAYS=30 -> report.quote.history (~30 closes, frozen at capture, not refreshed).
  Run records store one mark per ticker per run (data/trade/runs) — no SPY. No local price store of ≥252 closes exists.
- FRED/macro: NOT fetched anywhere. lib/synth/macro.ts:11 MACRO = {riskFree .043, erp .045} static; FRED only in comments/docs.
- Shibui: Claude connector only (beta.ts:22-27, calibration/realized.ts:15-17). Code renders SQL; responses saved under data/raw/_shibui/
  (e.g. calibration-2026-10-03.json incl. SPY + 252-day vol). Cannot be called from Node/cron. SPY beta (2y weekly) lives in FactPacks.

## 4. Tax and turnover
- No tax lots, ST/LT gains, holding-period or wash-sale logic anywhere (grep lib/trade, lib/broker, scripts/trade-*). Trade-layer spec
  2026-09-24 §3 (line 126-127) and §15 (:405-408): "no tax-lot accounting"; Schwab spec non-goals don't add any.
  Broker avgEntryPrice is read (positions) but unused for tax. The 5-day lock is a compliance rule, not a wash-sale rule (30 days).
- Turnover limits: per-run 15% / per-day 25% exist but are OFF unless TURNOVER_BREAKER set. No monthly/annual turnover budget.
  trade:review reports turnover per run after the fact.

## 5. Docs — constraints and deferred items relevant to overlays
- portfolio/01-conceptual-outline.md §1 (:49-54) + §13.3: cash is "bounded cash-emergent ... a bottom-up de-risking lever, never a
  top-down market-timing bet the desk has no edge on" (owner-locked decision). §7: turnover deliberately low, wide band, "clock is the
  filing cycle". §12 v2: ≥250-400 closes only as a SECONDARY drawdown check; Ledoit-Wolf cov only for exposure control.
  Benchmarks locked: 1/N coverage (primary) + SPY (secondary). Long-only.
- engine.md:152-156 DEFERRED blend scenario σ with realized vol — only if invSigma is A/B'd, then on ≥252 closes (not ~30).
  engine.md:236-256 kellyTilt pending backtest. engine.md:323-335 "Not an option: per-lot locking". Mean-CVaR and σ↓ rejected (:192-197).
- engine-improvements spec 2026-09-26 §3 (:488-495) σ/realized-vol DEFER; §6 (:464-487) no backtest harness; RunRecord now stores σ, D, scenarios.
- pipeline-audit 2026-09-28 S3 (:146): μ uncalibrated = "largest strategy risk"; calibration:log started 2026-10-03, recalibration waits
  for ≥10 names per horizon (:6).
- scoreconcepts/10.md §2 (:80-83): factor/regime timing evidence weak; defensible regime use = conditional BEAR sizing (HY OAS / VIX top
  quintile -> bear floor 15%→20-25% for net debtors), "desk policy, not a model". Data: FRED DGS10/HY OAS/VIX keyless, 400-d Yahoo closes (§10).
  9.md covers momentum/revisions sleeve (slow 6-12m tilt). Others (1-8, 11) = rating/scoring frameworks, not portfolio overlays.
- No earlier spec on regimes, sleeves or dynamic benchmarks in docs/superpowers/specs.
- 10022026learning.md §5: "Ask the owner before changing anything involving a lock"; don't trade/reconcile from the cloud; don't use the
  Schwab token from the cloud. §4: R just over 0.5 is fragile (labels flip in review).

## 6. Hazards for a dynamic overlay
- Locks: 5-business-day whole-ticker symmetric lock from EVERY fill (lockBusinessDays 5 = ICE employer rule); ICE hard ban. Owner-set;
  do not change without asking. A regime shift that trims many names locks them all against re-buys for 6 trading days -> whipsaw
  becomes impossible to undo quickly; frozen DEFER_EXIT/DEFER_TRIM weight distorts sleeve totals.
- Position change speed: 1 run/day; HOLD names move only past ±2.5pp; ADD/TRIM floor 0.5% NAV; sells after a buy wait 5 days. A gradual
  regime weight path will mostly sit inside the band (no trades) then jump; a shift of e.g. 20pp across ~15 names = many band crossings at once.
- Turnover breaker OFF by default: a regime flip would send its full turnover in one run on a LIVE Schwab account (sell-containing plans
  are never clipped; with breaker ON they halt instead and count toward the 3-halt block).
- Correction to the brief: a held name whose rating becomes HOLD is EXITED (hysteresis.ts:23-24, label not buy-side), not kept — unless
  sell-locked (then DEFER_EXIT, frozen). What is "kept but not bought" is a held name in the hysteresis band (mu .03-.08 / R .35-.60):
  classified HOLD, re-sized, can ADD or TRIM. A non-held name in that band cannot ENTER. Held names with no report -> NO_SIGNAL frozen.
- reconcile halts on any broker position without a buy fill (ledger.ts:43) and NAV = whole account equity (ledger.ts:46) — any
  outside/ballast holding (e.g. an index ETF sleeve) must be bought through the engine or recorded in fills.jsonl.
- Core/ballast sleeve has no instruments: every holding must have a report (BUY/STRONG BUY); an ETF ballast (SPY, BND) has no Signal
  and would be EXIT-ineligible/NO_SIGNAL-frozen. Needs a new non-report sleeve path.
- No tax awareness on a LIVE taxable(?) Schwab account: regime-driven trims realize ST gains blindly; wash sales unchecked (lock is 5d, not 30d).
- No regime data in-process: SPY/VIX/FRED history would need a new fetch (broker bars or Yahoo; FRED keyless CSV) and storage; ~30-close
  report history is insufficient for 252-day vol. μ itself is uncalibrated, so sleeve tilts on μ inherit that error.
- Doctrine conflict: the locked cash doctrine forbids top-down market timing; a regime overlay that varies cash or equity beta needs an
  explicit owner decision; framing as growth/core *mix* within a fully invested book is closer to allowed, but still a timing bet per 10.md.
