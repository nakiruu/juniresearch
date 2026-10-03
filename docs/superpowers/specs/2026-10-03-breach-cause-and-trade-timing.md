# Bear breaches by cause, and one late-day decision (2026-10-03)

**Question (owner).** What maximizes profit in this system, given that buy orders are placed once daily and
the 5-business-day hold (whole ticker, both sides) is mandatory? More intraday scans are allowed.

**Answer.** Two changes, both built behind config:

1. **Handle a bear breach by its cause** (`breachPolicy: "byCause"`): hold and keep buying market-driven
   breaches, freeze mixed ones, and exit stock-specific ones once the lock allows.
2. **Keep one decision a day, but move it to 15:10 ET on live prices** (`cronTimesET: ["15:10"]`,
   `markMode: "live"`, `submitCutoffET: "15:50"`).

The lock is unchanged and still enforced on every path.

## Method

**Event study on Shibui daily prices (survivor-only).**
- Universe: US common stocks with market cap ≥ $2B on the anchor date.
- Anchors: three blocks (2010–15, 2016–20, 2021–25).
- Each stock-quarter is one synthetic "report":
  - P0 = the close on the quarter's first session.
  - Bear = P0 × (1 − D), where D = clamp(0.6 × trailing-252d vol, 0.15, 0.5). This matches the published
    reports' bear depth (median D ≈ 0.6σ) and the desk floor.
- A breach is the first close below the bear in that quarter. Action happens at the next open (one decision
  per day on the prior close).
- Returns are measured against SPY, and every group is compared with the unconditional baseline from the same
  anchors.
- Cause decomposition at the breach:
  - total = P/P0 − 1
  - residual = total − β·(SPY/SPY0 − 1), with β the trailing-252d daily beta
  - share = residual/total, bucketed as market < 0.5 ≤ mixed < 0.9 ≤ stock-specific
- **Literature:** four reviews (news vs no-news shocks, intraday timing, exit and holding rules, and the
  earlier audit set), summarized below.

## 1. Breaches by cause

Six-month excess return vs a typical stock, in percentage points. "From next open" acts the morning after the
breach; "from day 6" acts on the first day a 5-day sell lock could clear.

| Cause | n | 2010–15 | 2016–20 | 2021–25 | Pooled (next open) | Pooled (day 6) |
|---|---|---|---|---|---|---|
| Market-driven | 2,214 | +2.4 | +1.8 | +6.3 | **+3.5** | **+5.0** |
| Mixed | 2,344 | −1.1 | −1.9 | +0.9 | −0.8 | −0.4 |
| Stock-specific | 2,679 | −3.3 | −2.4 | −3.7 | **−3.3** | **−3.8** |

**Within stock-specific, split by an earnings release in the 5 days before the breach** (from day 6):

| | 2010–20 | 2021–25 |
|---|---|---|
| With earnings | −5.2 | −4.9 |
| Without | −2.6 | −4.1 |

Both are negative. The no-news bounce the literature reports for one-day shocks (Savor 2012, *JFE*; Chan 2003)
is confined to the first week here: +0.4% in each period, then the lag resumes. That is the
brief-reversal-then-momentum pattern of Gutierrez & Kelley (2008, *JF*).

**Market-driven, no news** (from day 6): +5.0pp (2010–20) and +5.4pp (2021–25). This agrees with the evidence
that losers rebound in panic states (Daniel & Moskowitz 2016, *JFE*) and that non-informational shocks revert
(Da, Liu & Schaumburg 2014, *MS*; Hameed & Mian 2015, *JFQA*).

**Why the 5-day lock is no obstacle.**
- A stock-specific exit made on day 6 avoids slightly *more* of the lag than one made the next morning.
- Freezing and holding never trade, so the lock never binds on them.
- The one lock-specific rule: stop adding once a decline turns stock-specific, because every buy restarts the
  sell lock.

**Options tested and rejected.**

| Option | Result |
|---|---|
| Deeper stop (another −15% below the bear) | Deep breaches rebound +4.3pp at 3 months, so this stop is harmful |
| Wait N days to "confirm" a breach | Still being below at day 5 adds no information |
| Exit only on earnings breaches | Weak separator; consistent with Martineau (2022, *CFR*): no post-earnings drift since 2006 above the NYSE 20th percentile |
| Treat every dip by cause | 8% dips show no robust split (market-dip spread −0.6 / +0.8 / +7.1) |
| Sell at target vs let it run | Rallies to target perform like a typical stock (+0.1pp at 3 months, pooled n = 11,589). The momentum-conditioned version is +0.3 / +1.7 / +1.6pp in mean but mixed in median: measure, don't change |

**Expected book effect.**
- Breaches hit about 12% of position-quarters, so about 0.5 per position per year.
- The cause mix is 31% market, 32% mixed and 37% stock-specific.
- That puts the rule about **+0.5pp of NAV a year** over exiting every breach, and **+0.7pp** over freezing
  every breach. Both figures are before the round trips and the rebuy-after-recovery it avoids (86% of
  breached names close back above the bear after the lock).

**Caveats.**
- Synthetic reports, not the desk's own.
- Survivorship: delisted losers are missing. That makes the stock-specific exit result conservative and may
  flatter the market-driven hold.
- Breaches cluster (2020, 2022).
- About ten variants were tested. The cause split was motivated by the literature in advance and replicated in
  every block.

## 2. One late-day decision on live prices

**Evidence for the timing.**
- **Avoid the open.** Spreads are highest at the open and lowest near the close (Upson & Van Ness 2017, *JFM*;
  Bogousslavsky & Muravyev 2023, *JFM*). Opening prices are inflated for attention and hard-to-value stocks
  (Berkman, Koch, Tuttle & Zhang 2012, *JFQA*). Value-type returns accrue intraday (Lou, Polk & Skouras 2019,
  *JFE*).
- **Don't add decision scans.**
  - Institutional alpha decays with a half-life of about 4 months (Di Mascio, Lines & Naik), so acting a few
    hours sooner is worth under 1bp per trade.
  - Checking a threshold four times a day narrows the effective band by about 0.58·σ·√Δt (Broadie, Glasserman
    & Kou 1997), which adds noise trades. Each of those freezes its ticker for 5 days.
  - Active retail traders underperform (Barber & Odean 2000).
- **Decide late on the same day, not the next morning.**
  - The same information arrives about 18 hours sooner.
  - Down-day names are bought before the last-half-hour reversal (Baltussen, Da & Soebhag).
  - The engine's own pattern stays on its side: in the data, dip and breach names rise during the next day's
    session (+0.1 to +0.45% vs SPY) and target-rally names slip (−0.01 to −0.14%).
  - The fill lands a session earlier, so the lock (counted in trading days from the fill date) clears a
    session earlier.
- **Value.** A few bp per trade, roughly 3–25bp of NAV a year. Small, but it costs nothing.

**Design.**
- One slot at 15:10 ET (fire window +20 min).
- Decision marks: the fresh last trade, else the fresh quote mid, else the settled prior close. The fallback is
  recorded per ticker.
- The settled close stays the execution reference for the gap-halt and tier-3 anchor.
- No new order is submitted after 15:50 ET. Sells go first, so a cutoff can only leave cash.
- Early-close days (13:00) read closed at 15:10 and are skipped, about 3 a year.
- **To revert:** set `cronTimesET: ["09:45"]` and `markMode: "settled"`, then re-run the register script.

## Implementation

**Breach rule.** Config: `breachPolicy` / `breachMarketShareMax` / `breachStockShareMin`.
- Code: `lib/trade/breach.ts` (pure cause split), `hysteresis.ts` (HOLD / FREEZE / EXIT, only when the breach is the
  sole exit reason), `rebalance.ts` (FREEZE weight frozen) and `pipeline.ts` `bearBreaches`.
- SPY is read only when a held name is in breach. β comes from the FactPack via `betaFor`.
- Any missing input means the plain exit.

**Live decision.** Config: `markMode` / `cronTimesET` / `submitCutoffET`.
- Code: `pipeline.ts` `liveMark` / `captureLive`, plus `cron.ts`, `scheduler.ts` and `clock.ts` (`etInstantOn`).
- Safeguards added in the build:
  - A live print further from the settled close than the bucket's `gapHalt` is set aside for the close, so a bad
    print can't resize or lock the rest of the book.
  - A live run reuses its decision snapshot as the execution anchor.
  - The in-app scheduler arms for 15:10 after a morning restart instead of firing at once.
  - In a live run the breach rule's SPY decision mark is SPY's own live mark.
- Behaviour is described in `docs/engine.md` §4.2, §5.1 and §7.

**Watch in the first live runs.**
- Rate-limit fallbacks in the run notes ("read failed (429…)"). A batch-quote adapter method would remove the risk.
- The Schwab adapter stamps a quote that has no timestamp with now(), so such a quote counts as fresh.
