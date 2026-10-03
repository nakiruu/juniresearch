# Juniper — from a filing to a live order

Juniper turns a freshly-filed 10-Q/10-K into a published equity research report, scores that report into
a conviction-rated **buy/hold/sell**, sizes a portfolio from every rating, and trades that portfolio through a real broker
(Alpaca paper or Charles Schwab live). One JSON sidecar per company drives a themeable
Next.js report; the same rating that renders on the page is the number the sizing and trading engine
consumes.

**The model that writes reports emits barebones data; this project owns every pixel of presentation and
every piece of arithmetic.** Numbers are numbers, percentages are ratios, prose is Markdown; formatting,
math, scoring, sizing and order-pricing all live in code, so the same JSON renders identically in Forest
Night / Linen / PDF and every derived value is internally consistent.

```
 filing            FactPack             report               rating              book                 orders
 10-Q/10-K   ─►   facts:build   ─►    /synthesize   ─►     score/gate   ─►   portfolio:build  ─►   trade:execute
 (EDGAR)          data/facts/…        data/<t>.json        rating.decision    snapshot             broker (Alpaca/Schwab)
   §2 fetch-facts     §3 synth+lint+review    §3 conviction/gate/intrinsic/moat    §4 sizing            §5 trade layer
```

> **Heads-up (`AGENTS.md`):** this repo pins a Next.js whose APIs may differ from what you remember. Read
> the relevant guide in `node_modules/next/dist/docs/` before writing framework code. Docs work (this file)
> doesn't touch it.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000 → redirects to /research
npm run build        # prerenders /research and /research/<ticker> for all 92 published reports
npm start            # serve the production build
npm test             # Vitest — 1,500+ tests across facts, synth, scoring, portfolio, trade, broker
npm run test:watch   # Vitest in watch mode
npm run lint         # ESLint
```

`EDGAR_CONTACT=<your email>` must be set in `.env.local` (see `.env.example`); SEC requires it on every
request. Broker, scheduler and notifier settings also live in `.env.local` — see [Environment](#environment).
Every `npm run <script>` below loads `.env.local` when it exists. **Any** Next server process (`dev` or
`start`) arms the trade scheduler when `TRADE_SCHEDULER_ENABLED=1`, so keep that flag out of a local
`.env.local` while the deployed trader runs, or each slot fires twice. Docker deployment (the `trader` service)
is covered in `README.Docker.md`.

---

## Directory layout

```
app/
  page.tsx                     / → redirects to /research
  research/page.tsx            index of reports
  research/[ticker]/           the report route (static, validated at build)
  schwab/callback/             Schwab OAuth landing page — shows the redirect URL to paste into trade:auth
  api/trade/status/            GET scheduler status (bearer TRADE_STATUS_TOKEN)
instrumentation.ts             arms the in-app trade scheduler at server start (TRADE_SCHEDULER_ENABLED=1)
components/
  report/                      Markdown subset + report primitives, sections/, EquityReport.tsx
  chart/                       geometry.ts (pure math) + ProjectionChart.tsx (server-rendered SVG)
  schwab/                      OAuth callback view
  ui/ , theme-toggle.tsx       shared UI primitives (badge, table) and the theme switch
lib/
  report.schema.ts             Zod contract (facts + judgment) — single source of truth for the page
  format.ts                    every "$ / x / % / B/T / ~ / +/-" and all derived display values
  reports.ts , validate.ts     filesystem loader (parse + validate at the boundary); report validation
  edgar/                       watchlist, CIK resolution, submissions polling
  facts/                       FactPack build + schema + enrich + Shibui beta/cross-check;
                               facts/free/ = the keyless SEC-XBRL + Yahoo source
  synth/                       judgment schema, prompt, merge, grounding, lint/, editorial review,
                               and the scoring stack: conviction · gates · intrinsic · moat · composite · decide
  screen/                      pre-synthesis screen (Street upside from Shibui)
  calibration/                 report upside vs realized return (Shibui evidence log)
  portfolio/                   signal · eligibility · sizing (+ sizing-v2 kellyTilt) · quality · touch ·
                               benchmark · snapshot
  trade/                       broker-agnostic core: config · ledger · fills · hysteresis · rebalance · locks ·
                               breach (bear breach by cause) · stale-entry + earnings (entry gate) · orders ·
                               limit · costs · breakers · audit · pipeline · run-record · cron · scheduler ·
                               clock · calendar + nyse-calendar · notify · auth-health · runtime
  broker/                      adapter.ts (the port) + alpaca.ts (paper) + schwab.ts (live) + fake.ts,
                               guards.ts (every submit), http.ts, schwab-auth.ts (OAuth token store)
  prices/yahoo.ts              keyless daily closes + quote summaries
data/
  <ticker>.json                92 published reports (avgo.json …; golden fixture in lib/__fixtures__)
  desk/                        desk identity, house style, rating thresholds, editorial rubric, recurring traps
  edgar/                       watchlist.json, seen.json (what detect has already reported)
  raw/                         verbatim captures per filing; raw/_shibui/ = saved Shibui responses
  facts/ , judgment/           built FactPacks and staged judgment per filing
  screen/ , calibration/       screen rankings and the calibration log, by date
  earnings/latest.json         latest earnings per covered name (read by the trader's stale-entry gate)
  portfolio/                   the analytical snapshot (gitignored)
  trade/                       fills.jsonl, ledger.json, runs/<id>.json, cron.log, scheduler-state.json,
                               schwab-token.json (gitignored — never commit)
docs/engine.md                 the full engine functional reference — research → rating → sizing → trade math
docs/superpowers/specs/        design notes and research reviews, by date
scripts/                       every npm-run entrypoint below, plus one-off maintenance scripts
```

---

## §2 — The fact pipeline

Capture a filing's numbers verbatim, then build a validated **FactPack** (`lib/facts/schema.ts`).

```bash
npm run watchlist:add -- NVDA                          # resolve CIK via sec.gov, append to data/edgar/watchlist.json
npm run detect                                         # poll EDGAR for new 10-Q/10-K on the watchlist; print + mark seen
npm run facts:prepare -- AVGO 0001730168-26-000080     # EDGAR record + primary doc + 8-K exhibit 99.1 + prior 10-K + DEF 14A + Yahoo closes → data/raw/…
npm run facts:manifest -- AVGO 0001730168-26-000080    # print the connector calls the capture needs (JSON); --check = verify every raw file is present
/fetch-facts AVGO 0001730168-26-000080                 # (Claude Code) capture vendor responses verbatim to data/raw/…
npm run facts:build  -- AVGO 0001730168-26-000080      # raw → validated FactPack in data/facts/…
npm run facts:enrich -- AVGO 0001730168-26-000080      # stamp goodwill + SBC (SEC), peer multiples (Yahoo); fill a missing TTM EV/EBITDA or FCF yield from SEC
npm run facts:beta   -- AVGO 0001730168-26-000080      # print the Shibui beta query; save its response to data/raw/…/shibui-beta.json
npm run facts:beta   -- AVGO 0001730168-26-000080 --apply  # stamp the measured beta (2y weekly vs SPY, Blume-adjusted) onto the pack
npm run facts:crosscheck -- AVGO 0001730168-26-000080      # print the Shibui cross-check query; save its response to data/raw/…/shibui-crosscheck.json
npm run facts:crosscheck -- AVGO 0001730168-26-000080 --apply  # stamp shibuiCheck (diffs vs Shibui + Shibui TTM SBC) onto the pack
npm run facts:diff   -- AVGO 0001730168-26-000080      # projected facts vs the hand-built golden fixture, formatted
npm run facts:backfill-ev  -- [TICKER ...]             # fill an empty TTM EV/EBITDA on published packs (SEC, else Yahoo); default every pack
npm run facts:backfill-fcf -- [TICKER ...]             # fill an empty TTM FCF yield on published packs from SEC; default every pack
```

Re-render each touched report with `synth:build` after a backfill.

**Two fact sources.** The original path pulls financials/ratios/peers/transcript from **Bigdata.com** and
**FMP** through the Claude connectors (the `fetch-facts` skill runs `lib/facts/manifest.ts`; EDGAR and Yahoo
are fetched by code). When vendor credits ran out, `lib/facts/free/` became the default: a **keyless**
source that assembles the FactPack from **SEC company-facts XBRL** + the filing's own inline XBRL + Yahoo
quote summaries — no API keys, no vendor.

```bash
npm run facts:free -- AVGO 0001730168-26-000080        # SEC-XBRL + filing iXBRL + Yahoo → the same FactPack shape, keyless
```

`facts:free` does per-period concept selection, reconstructs discrete quarters from YTD, derives operating
income, and has sector-aware extensions for banks, utilities and insurers (net-of-interest revenue, no
gross-margin/EBITDA where meaningless). Known limitations live in the memory notes (non-December fiscal-year
quarter **labels**, and an FYE-change annual-splice bug) — both handled by disclose-in-prose + a reviewer note.

**Measured beta (Shibui Finance).** The cost of equity behind the moat WACC and the reverse-DCF discount
rate uses a per-name beta when the pack carries one (`lib/facts/beta.ts`): two years of weekly log returns
vs SPY ending at the pack's quote date, Blume-adjusted (⅔·raw + ⅓) and clamped to [0.3, 2.5]. Shibui is a
Claude connector, not an HTTP API, so `facts:beta` prints the query, the response is saved verbatim, and
`--apply` does the arithmetic. With no beta (no Shibui coverage, or under a year of history) the SIC sector
proxy (`betaFromSic`) applies. `scripts/backfill-beta.ts --query | --apply <file>` re-stamps every pack.

**Shibui cross-check.** Bad vendor inputs, not the model, drove the worst reverse-DCF outputs (FOUR's pack
carried a TTM FCF about double the independent figure). `facts:crosscheck`
(`lib/facts/shibui-check.ts`) compares the pack's price, market cap, shares, latest-quarter revenue and TTM
FCF (fcfYield × market cap) with Shibui's point-in-time values — close and market cap on/before the quote
date, the four fiscal quarters ending at the pack's latest quarter — and stamps `shibuiCheck`: each
relative diff with a level (ok ≤ 10% < warn ≤ 25% < fail), plus Shibui's TTM stock-based compensation for
the DCF. Same two-step capture as beta; `scripts/backfill-crosscheck.ts --query | --apply <file>` re-stamps
every pack (mtimes preserved). The reverse DCF abstains when market cap, shares or TTM FCF *fails* the check
and flags a *warn*; it also charges Shibui's TTM SBC against TTM FCF (`lib/synth/intrinsic.ts`).

**One-off maintenance scripts** (run with `node --import tsx scripts/<name>.ts`; each preserves file mtimes,
because a ticker's newest pack is chosen by mtime):

| Script | What it does |
|---|---|
| `backfill-beta.ts --query \| --apply <file>` | re-stamp the measured beta on every pack (one batched Shibui query) |
| `backfill-crosscheck.ts --query \| --apply <file>` | re-stamp the Shibui cross-check on every pack |
| `backfill-sec-series.ts [--dry]` | re-stamp the SEC per-fiscal-year `goodwill` / `sbc` series (period-end aligned) |
| `backfill-capex-extras.ts [--dry]` | add capex tagged apart from PP&E to SEC-built packs; recompute FCF and TTM FCF yield |
| `backfill-peers.ts` | fill peer P/E, P/S and EV/EBITDA from Yahoo |
| `backfill-sic.ts` | stamp SEC SIC onto packs captured before SIC was stored |
| `backfill-provenance-source.ts [--dry-run] [TICKER ...]` | relabel provenance on packs that `facts:free` built |
| `apply-input-review-2026-10-03.ts` | apply the FOUR/BAM corrections from `docs/superpowers/specs/2026-10-03-crosscheck-input-review.md` |

FactPack context also carries the **press release** (`context.pressRelease`, from the 8-K's exhibit 99.1),
the longer **Risk Factors** excerpt (`context.riskFactorsSource`), and the **DEF 14A proxy**
(`context.proxyStatement`) — the only surface governance claims may rest on.

---

## §3 — Synthesis, scoring & editorial review

The model writes only the **judgment** (`lib/synth/judgment.schema.ts`): rating, target range, scenario
prices + probabilities, and section Markdown. Code derives everything else and refuses to publish an
ungrounded or inconsistent report.

```bash
npm run screen -- --query --pending                               # Shibui call: rank pending filings by Street upside; save the response, then…
npm run screen -- --rank <saved.json>                              # …ranked queue (likely-HOLD < 10% upside) → data/screen/<date>.json
npm run synth:prompt -- AVGO 0001730168-26-000080                  # FactPack + desk config → data/judgment/AVGO/<acc>.prompt.md
/synthesize AVGO 0001730168-26-000080                              # (Claude Code) writes the judgment .json, then builds
npm run synth:build  -- AVGO 0001730168-26-000080                  # judgment + facts → validated data/avgo.json (or an errors file)
npm run synth:review-brief -- AVGO 0001730168-26-000080            # → data/judgment/AVGO/<acc>.review-brief.md
npm run synth:prompt -- AVGO 0001730168-26-000080 --with-review    # re-prompt the author with the open editorial findings
npm run synth:prompt -- AVGO 0001730168-26-000080 --with-errors    # re-prompt with the last build's errors (<acc>.errors.txt)
npm run synth:build  -- AVGO 0001730168-26-000080 --skip-review    # local experiments only; prints a warning
```

More flags:
- `synth:build --date YYYY-MM-DD` sets the report date (default today).
- `synth:review-brief --full-brief` sends a round-2 reviewer the full brief instead of the delta.
- `screen -- --query [TICKER ...]` screens named tickers (default: the watchlist); `--query --published`
  screens every published report; `--calibrate <saved.json>` checks the likely-HOLD flag against published
  ratings; `--as-of YYYY-MM-DD` bounds the query's dates.

`synth:build` runs, in order: `Judgment.parse`, `Report.parse`, `validateReport`, `validateJudgment`
(rating consistency vs the **derived label**, bear-case floor), **grounding** (every figure in the prose
must exist in the FactPack / captured context / the report's own derived values), **desk lint**
(`lib/synth/lint/` — figure/sentence repeats, span scope, hype, unattributed superlatives; errors fail the
build, warnings print), and the **editorial gate** — a fresh reviewer writes `…editorial.json` and the
build refuses to write the report until that file matches the judgment's SHA-256 with no Critical or
Important finding open (two rounds max; Minors may stay open).

### The rating stack (what turns a report into a buy)

A rating is not asserted; it is **derived and gated** (`docs/engine.md` §1). From the probability-weighted
scenarios the engine computes **E** (expected upside), **D** (bear-case downside), **R = E/D** (reward per
unit of bear risk), then:

- **`deriveLabel`** maps (E, R) to STRONG SELL … STRONG BUY; the author may publish **one notch more
  conservative**, never more aggressive.
- **`rating.gate`** — a sector-aware quality gate (distress, Piotroski, accruals, moat) that produces a
  **ceiling**: a headline-BUY can be gate-capped to HOLD on earnings quality.
- **`rating.decision.conviction`** — a 0–100 penalty score over the gate + a reverse-DCF intrinsic layer +
  moat (ROIC−WACC) + a cross-sectional composite percentile. This becomes **κ**, the sizing input.

Read-only demonstrators print each layer over every published FactPack:

```bash
node --import tsx scripts/gates-preview.ts        # the fundamental gate + what enforcement would change
node --import tsx scripts/intrinsic-preview.ts    # reverse-DCF: market-implied vs achievable growth, margin of safety
node --import tsx scripts/moat-preview.ts         # WACC proxy, ROIC spread, incremental ROIC, Width/Trend verdict
node --import tsx scripts/decide-preview.ts       # the composed decision + conviction tier for every report
```

---

**Pre-synthesis screen** (`lib/screen/screen.ts`). A report run is the expensive step, and ~45% of reports
come out HOLD. The screen ranks candidates by Street upside (consensus target / close − 1, from Shibui) and
flags < 10% as likely-HOLD; calibrated on the 92 published reports it flags ~40% of HOLDs for at most one
BUY (AUC 0.82). It **orders** the `/synthesize` queue and never skips a filing (the author sees the
consensus too, so the signal is partly circular). `--calibrate <file>` re-checks it against published ratings.

**Upside vs realized (S3 evidence log)** (`lib/calibration/realized.ts`). `npm run calibration:log -- --query
[--batch N]` prints the Shibui call(s); `--apply <saved.json> [...]` writes `data/calibration/<date>.json`
(both take `--today YYYY-MM-DD`): every prediction point
(current reports plus earlier revisions from git, deleted reports included) with E/D/R/κ/label against the
realized and SPY-excess return at +21/63/126/252 sessions and to date, plus trailing 252-day realized vol.
Aggregates (by label, hit rate, Spearman ρ of E vs excess, realized/E) are null below 10 distinct names.
Price returns only (Shibui closes are split- but not dividend-adjusted). Nothing reads it yet; re-run it
periodically so the evidence accumulates.


## §4 — Portfolio

`portfolio:build` re-marks every published report against the current Yahoo price, screens for eligibility,
and sizes a long-only book — the *analytical* snapshot. Read-only; no broker.

```bash
npm run portfolio:build                                   # → data/portfolio/snapshot-<date>.json + .csv (gitignored)
npm run portfolio:build -- --date 2026-10-01              # mark and date the snapshot as of a given day
npm run portfolio:build -- --model kellyTilt              # experimental sizer (lib/portfolio/sizing-v2.ts) → snapshot-<date>-kellyTilt.*
npm run portfolio:build -- --wMax 0.08 --sectorMax 0.25   # override caps (also --cashCeiling)
npm run portfolio:build -- --muExp 1 --convExp 1 --rExp 1 # override score exponents
npm run portfolio:build -- --bearFloor 0                  # sizing floor on the bear downside (default 0.15; 0 = raw R)
```

A name is eligible only if it's buy-side on **both** the label and the gate ceiling, with μ, R, conviction
and freshness all above their floors (`lib/portfolio/eligibility.ts`). Eligible names are scored
`μ · κ · R · staleness` (R with the bear-case downside floored at the desk's 15%, so a name nearing its bear
price can't blow up to the cap), allocated **proportional to score**, then **water-filled** under a per-name cap
(10%) and a sector cap (30%); shed weight flows to the best remaining names, and any shortfall the caps
can't absorb becomes cash — **never leverage**. The trade layer sizes with the same code and also
multiplies each score by the quality tilt Q (moat and composite percentile, clamped to 0.8–1.2;
`useQualityTilt`). `ICE` is a **hard compliance ban** (the owner is an ICE
employee) that lives outside the config and can't be switched off. See `docs/engine.md` §3 for the full math.

The reusable HTML dashboard renders a snapshot; refresh it by regenerating its embedded data from the new
snapshot and republishing to the same URL.

---

## §5 — The trade layer *(real money when `BROKER=schwab`)*

`portfolio:build` stops at target weights. The trade layer turns *target vs current* into **hybrid** orders —
the whole-share part as a slippage-capped IOC limit, the fractional remainder at market (`docs/engine.md`
§5.1) — with the **broker as the source of truth**. An order under $200 goes entirely at market (when a fresh quote
is within the spread limit), so a small account trades almost only fractional market orders. The core (`lib/trade/`) never names a broker;
`lib/broker/` supplies swappable adapters. `docs/engine.md` §4–§7 is the full spec.

### Commands for the trader

```bash
npm run trade:auth                        # (Schwab only) interactive OAuth — link the account, store tokens. Re-run ~weekly.
npm run trade:auth -- --status            # (Schwab only) when the current refresh token expires. Reads only.
npm run trade:reconcile                   # broker → data/trade/ledger.json. Reads only. Halts on an unexplained position.
npm run trade:reconcile -- --record-missing # append broker orders missing from fills.jsonl (runId "manual"), then reconcile
npm run trade:plan                        # compute + record the plan. NEVER submits. --broker fake (default) | alpaca (read-only)
npm run trade:execute                     # plan → confirm → submit through the guards → record fills → broker-truth audit
npm run trade:execute -- --yes            # same, non-interactive (skips the confirm prompt)
npm run trade:execute -- --preview        # plan only, never submits (works with the market closed / TRADE_DISABLED=1)
npm run trade:cron                        # the scheduler entrypoint: clock → breakers → execute-if-any → audit → notify
npm run trade:cron -- --now               # a deliberate manual run outside the fire window (the market clock still applies)
npm run trade:audit                       # read-only broker-truth cross-check of the latest run.  -- --run <id> | --date <YYYY-MM-DD>
npm run trade:review -- --since 2026-09-01 # weekly digest: turnover, cash band, deferrals, reconciled-every-run, lock violations, cap-binds
npm run trade:earnings -- --query         # print the Shibui call for every report's latest earnings (stale-entry gate input)…
npm run trade:earnings -- --apply <saved.json> # …and write data/earnings/latest.json from the saved response
```

Typical daily loop: `trade:reconcile` (see the book) → `trade:plan` (preview the orders, nothing submitted)
→ `trade:execute` (confirm and place) → `trade:audit` (verify the broker matches the local record).
`trade:cron` does reconcile → plan → execute-if-any in one guarded shot for the scheduler.

`trade:plan` also rewrites `data/trade/ledger.json` and records the run under `data/trade/runs/`.
`--date <YYYY-MM-DD>` overrides the trading day (decisions then use the settled close of the trading day
before it). The fake broker
builds its book from the local ledger and marks from Alpaca (read-only) when keys exist, else Yahoo.
`trade:plan --broker fake --simulate-fills` runs a Phase-0 dry loop: it **appends the simulated fills to
`data/trade/fills.jsonl`** and rewrites the ledger, so never run it against the live trader's data.

**Latest earnings** (`lib/trade/earnings.ts`, `trade:earnings`). The trader can't query Shibui, so the
stale-entry gate reads a committed capture: `--query` prints the call, the response is saved (e.g.
`data/raw/_shibui/earnings-<date>.json`), and `--apply` writes `data/earnings/latest.json` (both take
`--as-of YYYY-MM-DD`). Commit the file and rebuild; refresh it after each earnings season. A result older
than 120 days is ignored, and a missing or unreadable file turns the gate off rather than stopping trading.

### How the engine decides (short version)

- **Two-sided hysteresis** (`lib/trade/hysteresis.ts`): a *held* name has an easier bar to keep than a *new*
  name has to enter (`rEnter 0.60` vs `rExit 0.35`, `muEnter 0.08` vs `muExit 0.03`). The gap is a
  no-churn band, so a winner is never sold for merely dipping below the entry bar.
- **No-trade band** (`tradeBand 0.025`): a held name trades only when its target moves more than 2.5pp.
  Minimum order sizes: a new entry $1 (the fractional minimum); an add or trim the larger of $1 and 0.5% of
  NAV (`TRADE_MIN_USD` / `TRADE_MIN_NAV_PCT`); a full exit, none.
- **Bear breach by cause** (`lib/trade/breach.ts`): a held name at or below its report's bear price is split
  into the part SPY explains (β × SPY move) and its own. Market-driven (< 50% its own) → hold; mixed → freeze
  (no add, no trim); stock-specific (≥ 90%) → exit once the sell lock allows. Any missing input → plain exit.
- **Stale-on-bad-news entry gate** (`lib/trade/stale-entry.ts`): a name that would be bought is skipped
  (`STALE_ENTRY`) when it is ≥ 5% below its report price, the fall is its own (≥ 90%), and its latest earnings
  missed (≤ 120 days ago). The report is likely stale; re-write it. Any missing input lets the buy through.
- **Compliance locks** (`lib/trade/locks.ts`): symmetric, whole-ticker, **5 business days** — a buy fill
  blocks selling for 5 days and vice-versa (same-side adds are legal).
- **Slippage-capped IOC limits** (`lib/trade/limit.ts`): a per-liquidity-bucket anchor waterfall (fresh
  trade → quote touch → prior close) with a spread-aware tolerance τ and a hard cap τ_max. IOC means an
  unmarketable order cancels — **a non-fill is the slippage cap doing its job**, not an error.
- **One decision a day, late, on live prices** (`markMode:"live"`, 15:10 ET): each name is marked at its fresh
  last trade, else its fresh quote mid, else the settled prior-day close — the source is recorded per ticker,
  and a print that has gapped past the gap-halt is set aside for the close. The settled prior close stays the
  execution reference (gap-halt, tier-3 anchor). `markMode:"settled"` restores prior-close decisions.

### Safety rails

| Rail | Where | Effect |
|---|---|---|
| `TRADE_DISABLED=1` | env kill switch | refuses every submission, both brokers |
| confirm prompt | `trade:execute` | requires `y` (or `--yes`) before any order |
| preview-only mode | `trade:cron` / scheduler / `trade:execute` | `PREVIEW_ONLY=true`: plan + post the allocation every run, never submit (no breakers, no run record, halt counter untouched) |
| allocation post | `trade:execute` | every run prints the target book and posts it to Discord — preview, declined, market-closed and executed runs alike |
| market-clock check | `trade:execute` / `trade:cron` | submits nothing outside the regular session (09:30–16:00 ET on trading days); `trade:execute` still posts the allocation |
| fire window | `trade:cron` | a run starting > 20 min after `cronTimeET` (15:10 → 15:30 ET) exits as `late` (`trade:cron -- --now` for a deliberate manual run) |
| submit cutoff | `trade:cron` / `trade:execute` | nothing is submitted at or after `submitCutoffET` (15:50 ET), however late the run started; the rest are recorded as skipped and notified |
| turnover breaker | `trade:cron` / scheduler | **off unless `TURNOVER_BREAKER=true`**; when on, a run over 15% of NAV (25%/day) is clipped (buy-only) or halted (any sell) |
| consecutive-halt breaker | `trade:cron` | blocks further runs after 3 halts in a row |
| orders reconcile | `trade:cron` / `trade:execute` / `trade:reconcile` | halts while any executed broker order in the lock window is missing from `fills.jsonl` (`trade:reconcile -- --record-missing` records them from broker truth) |
| unknown-submit halt | `trade:cron` / `trade:execute` | a submit that times out is looked up, never resent; if it can't be found the run stops sending and halts |
| notional / order-count guards | every submit | refuse if a run exceeds NAV or 40 orders |
| reconcile halt | every run | an unexplained broker position stops the run |
| broker-truth audit | after every execute | a CRITICAL mismatch (unrecorded/orphan fill, qty) fails the run |
| ICE hard-ban | every stage | ICE can never be bought (a disposing sell is allowed) |

### Brokers, notifier & scheduler

`makeBroker()` selects the adapter from `BROKER`:

- **`alpaca-paper`** (default) — the paper test rig; the adapter refuses any non-paper base URL.
- **`schwab`** — **LIVE, real money.** No paper exists; `trade:auth` links the account once, and the OAuth
  refresh token dies every ~7 days → re-run `trade:auth` weekly (the system alerts on the failed run).

The **Discord notifier** (`lib/trade/notify.ts`) posts a per-run embed (orders, fills, the goal book, cash,
audit, bear breaches, names kept out by the stale-entry gate), the target allocation on `trade:execute` and
preview runs, and halt/auth alerts, when `DISCORD_WEBHOOK_URL` is set. It is best-effort: a Discord outage
never fails a run.

**Scheduling.** The deployed app runs `trade:cron` itself.
- With `TRADE_SCHEDULER_ENABLED=1` in `.env.local`, the in-app scheduler (`instrumentation.ts` →
  `lib/trade/scheduler.ts`) arms at server start. It fires at each `cronTimesET` slot in ET on NYSE trading days:
  **15:10 ET** by default, from `lib/trade/config.ts`.
- That config is compiled into the server build, so a change to the time takes effect on rebuild and restart
  (`docker compose up -d --build`).
- A boot before the slot waits for it. A boot inside the fire window (15:10–15:30) catches up once. A boot later
  than that waits for the next trading day.
- Each run self-guards on the market clock. On an early-close day (13:00 ET) the market is already shut at 15:10
  and nothing trades.
- `GET /api/trade/status` (header `Authorization: Bearer $TRADE_STATUS_TOKEN`; 503 when the token is unset)
  returns `armed`, `broker`, `tradeDisabled`, `previewOnly`, `turnoverBreaker`, `nextRunISO`, `lastRun` and,
  for Schwab, `schwabRefreshExpiresAt`.
- `data/trade/scheduler-state.json` records the last fired day and slot, so a restart never fires a slot twice.
- `scripts/register-trade-cron.ps1` / `.sh` (an OS-level Windows Task Scheduler / systemd timer) are **legacy**
  and not used by the Docker deployment. Never run both, or each slot fires twice.

To go back to the morning: set `cronTimesET: ["09:45"]` and `markMode: "settled"`, then rebuild.

> **Rollout plan:** Phase 0 (fake dry-run) → Phase 1 (paper smoke, ≥10 clean runs) → Phase 2 (paper
> event-driven, 4 weeks clean + weekly review).

---

## Configuration

Engine knobs are code, not environment: `lib/portfolio/config.ts` (`DEFAULT_CONFIG`, eligibility and sizing)
and `lib/trade/config.ts` (`DEFAULT_TRADE_CONFIG`, which extends it). `resolveTradeConfig` validates every
invariant at start-up and throws on a bad value. Both files are compiled into the server build, so a change
reaches the deployed trader on rebuild and restart. The only knobs the environment can override are the two
minimum-trade floors (`TRADE_MIN_USD`, `TRADE_MIN_NAV_PCT`). `docs/engine.md` §8 is the full reference.

| Area | Knob | Default |
|---|---|---|
| Eligibility (analytical book) | `muMin` / `rMin` / `convictionMin` / `stalenessMaxDays` | 0.05 / 0.50 / 45 / 120 days |
| Sizing | `muExp` / `convExp` / `rExp`; `bearFloor`; `stalenessHalfLifeDays` | 1 / 1 / 1; 0.15; 90 |
| Caps | `wMax` / `sectorMax` / `wMin`; `cashFloor` / `cashCeiling` | 10% / 30% / 0; 1% / 35% |
| Entry and exit bands | `muEnter` / `muExit`; `rEnter` / `rExit` | 0.08 / 0.03; 0.60 / 0.35 |
| Rebalancing | `tradeBand`; `lockBusinessDays`; `useQualityTilt` | 2.5pp; 5; on |
| Decision timing | `markMode`; `cronTimesET`; `submitCutoffET`; `maxLateMin` | "live"; ["15:10"]; "15:50"; 20 |
| Order sizing | `fractionalShares`; `marketOnlyBelowUsd`; `minEnterUsd`; `minTradeUsd` / `minTradeNavFrac` | on; $200; $1; $1 / 0.5% |
| Order pricing | `limitTol` / `limitTolMax` (large / mid / small) | 0.15/0.35/0.80% · 0.40/1.0/1.5% |
| Market legs and halts | `marketMaxSpread`; `gapHalt`; `maxStaleMin` | 1/1/2.5%; 10/15/25%; 5/15/60 min |
| Bear breach | `breachPolicy`; `breachMarketShareMax` / `breachStockShareMin` | "byCause"; 0.5 / 0.9 |
| Stale-entry gate | `staleEntryGate`; `staleEntryMinFall`; `staleEntryEarningsMaxDays` | on; 5%; 120 days |
| Run limits | `maxOrdersPerRun`; `maxNotionalFrac`; `maxRunTurnoverFrac` / `maxDayTurnoverFrac`; `consecutiveHaltLimit` | 40; 1.0 × NAV; 15% / 25% (breaker off unless `TURNOVER_BREAKER`); 3 |
| Schwab auth | `schwabRefreshLifetimeDays`; `schwabAuthWarnHours` | 7; 72 |

---

## Environment

`.env.local` (template: `.env.example`):

```bash
EDGAR_CONTACT=you@example.com            # required — SEC rejects requests without it

# BROKER=alpaca-paper                    # "alpaca-paper" (default, paper) or "schwab" (LIVE)
APCA_API_KEY_ID=                         # Alpaca paper keys; the adapter refuses a non-paper base URL
APCA_API_SECRET_KEY=
APCA_API_BASE_URL=https://paper-api.alpaca.markets

SCHWAB_CLIENT_ID=                        # Schwab live — register an app at developer.schwab.com
SCHWAB_CLIENT_SECRET=
SCHWAB_REDIRECT_URI=https://127.0.0.1    # must match a callback URL on the app (e.g. https://<site>/schwab/callback)
# SCHWAB_REFRESH_TOKEN=                  # optional, for hosts that can't run trade:auth; tried before the token file
# SCHWAB_REFRESH_OBTAINED_AT=            # ISO-8601 or epoch ms — when that token was issued (expiry warnings)
# SCHWAB_ACCOUNT_HASH=                   # else read from data/trade/schwab-token.json

# TRADE_SCHEDULER_ENABLED=1              # arm the in-app scheduler (unset → serves pages, never trades)
# TRADE_DISABLED=1                       # kill switch — refuse every order; cron stops before any broker call
# PREVIEW_ONLY=true                      # plan + post the allocation, never submit (true/1/yes/on)
# TURNOVER_BREAKER=true                  # cap a scheduled run at 15% of NAV and a day at 25% (off unless set)
# TRADE_MIN_USD=1                        # add/trim floor in dollars…
# TRADE_MIN_NAV_PCT=0.5                  # …or percent of NAV, whichever is larger
# DISCORD_WEBHOOK_URL=                   # run summaries + halt/auth alerts (unset → log only)
# TRADE_STATUS_TOKEN=change-me           # bearer token for GET /api/trade/status (unset → 503)
```

---

## The core idea

The split is strict, and it is the whole point:

- **Facts** — raw numbers pulled deterministically. No formatting. `currentPrice: 361.99`,
  `marketCap: 1720000000000`. **Every percentage is a decimal ratio** (`0.408`, never `40.8`).
- **Judgment** — the analyst's prose, authored by the model as plain **Markdown strings**. No HTML, no
  inline styling.
- **Presentation** — lives entirely in `format.ts` (numbers) and the components + stylesheet (layout, theme,
  tables, chart).
- **Derived values** — computed by the project, never stored: the upside range, probability-weighted fair
  value, the rating, the conviction score, the whole projection chart, and — downstream — the portfolio
  weights and the order prices. The model supplies base inputs; the project does the math, so every report
  is internally consistent and every trade is reproducible from the report.

---

## Authoring contract (lift this into the pipeline prompt)

The report model returns **one JSON object** matching `lib/report.schema.ts`:

1. **Numbers are numbers.** `361.99`, not `"$361.99"`; `63900000000`, not `"$63.9B"`.
2. **Percentages are ratios.** `40.8% → 0.408`, `-3.3% → -0.033`.
3. **Prose is Markdown**, not HTML. Subset: `**bold**`, `### `/`#### ` sub-headings, `- `/`* ` bullets,
   blank line = paragraph, `{+ text +}` = bullish (green) / `{- text -}` = bearish (terracotta) for signed
   deltas. Don't nest markers.
4. **Do not format, compute, or lay out.** No `$ % x ~ +/-` inside numeric fields. Never send an upside %,
   a weighted value, a fair value, or the chart — the project derives them.
5. **Do not invent numbers.** Every figure must be grounded in the injected context; a missing value is
   omitted or `null` (renders `—`), never recalled from memory.
6. **Escape hatches, sparingly:** financial-table cells accept `number | null | string` (string only for
   genuinely indicative values like `"~40x"` peer multiples); snapshot cells accept `raw` for composite/text.

### Snapshot cell

```jsonc
{ "label": "Consensus Target", "value": 509.61, "unit": "usd", "change": 0.408 }   // → "$509.61 (+40.8%)"
{ "label": "Market Cap", "value": 1720000000000, "unit": "usdLarge", "approx": true } // → "~$1.72T"
```
`unit`: `usd | usdLarge | mult | pct | shares`. Modifiers: `approx`, `dp`, `change`, `changeDp`, `note`, `raw`.

### Financial table row

```jsonc
{ "label": "Revenue ($B)", "values": [27500000000, …], "format": "usdB" }
{ "label": "Gross Margin", "values": [0.614, …], "format": "pct", "emphasize": true }
```
`format`: `usdB | usdT | pct | pctSigned | mult | eps | num1 | num2 | usd0 | usd2`. `emphasize: true` bolds
that one row.

---

## Conventions & gotchas

- **Derive from full precision.** `format.ts` computes YoY/margin rows from full-precision source values, not
  rounded display numbers, or results drift a tenth from the filing.
- **`data/<ticker>.json` is the archive.** Keep `schemaVersion` on every file and store them in git — that's
  the report archive and lets you re-render historical reports in a new theme. The Report schema is `1.1.0`;
  `quote.history` (up to 30 daily closes) is optional and drives the chart's history line.
- **`data/avgo.json` + the golden fixture are the regression anchor.** `npm test` asserts every formatter
  output against the source PDF's strings; keep it green when the schema changes.
- **The full engine math** — every symbol, threshold and "better idea" callout from report to fill — is in
  `docs/engine.md`. Read it before touching sizing, hysteresis, limit pricing or the breakers.
```