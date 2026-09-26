# Juniper — from a filing to a live order

Juniper turns a freshly-filed 10-Q/10-K into a published equity research report, scores that report into
a conviction-rated **buy/hold/sell**, sizes a portfolio from every rating, and — on the `trade-layer`
branch — trades that portfolio through a real broker. One JSON sidecar per company drives a themeable
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
npm run dev      # http://localhost:3000 → redirects to /research
npm test         # Vitest — 1,000+ tests across facts, synth, scoring, portfolio, trade, broker
npm run build    # prerenders /research and /research/<ticker> for all 67 published reports
```

`EDGAR_CONTACT=<your email>` must be set in `.env.local` (see `.env.example`); SEC requires it on every
request. Broker and notifier config also live in `.env.local` — see [Environment](#environment).

---

## Directory layout

```
app/
  research/page.tsx            index of reports
  research/[ticker]/           the report route (static, validated at build)
components/
  report/                      Markdown subset + report primitives, sections/, EquityReport.tsx
  chart/                       geometry.ts (pure math) + ProjectionChart.tsx (server-rendered SVG)
lib/
  report.schema.ts             Zod contract (facts + judgment) — single source of truth for the page
  format.ts                    every "$ / x / % / B/T / ~ / +/-" and all derived display values
  reports.ts                   filesystem loader; parse + validate at the boundary
  edgar/                        watchlist, CIK resolution, submissions polling
  facts/                       FactPack build + schema; facts/free/ = the keyless SEC-XBRL + Yahoo source
  synth/                       judgment schema, prompt, merge, grounding, lint/, editorial review,
                               and the scoring stack: conviction · gates · intrinsic · moat · composite · decide
  portfolio/                   signal · eligibility · sizing (+ sizing-v2 kellyTilt) · benchmark · snapshot
  trade/                       ledger · hysteresis · rebalance · locks · orders · limit · breakers ·
                               guards · audit · pipeline · cron · notify · calendar   (broker-agnostic core)
  broker/                      adapter.ts (the port) + alpaca.ts (paper) + schwab.ts (live) + fake.ts
  prices/yahoo.ts              keyless daily closes + quote summaries
data/
  <ticker>.json                67 published reports (avgo.json … ; golden fixture in lib/__fixtures__)
  desk/                        desk identity, house style, editorial rubric, recurring-trap guardrails
  facts/ , judgment/           built FactPacks and staged judgment per filing
  portfolio/                   the analytical snapshot (gitignored)
  trade/                       fills.jsonl, ledger.json, runs/<id>.json, cron.log (gitignored)
docs/engine.md                 the full engine functional reference — research → rating → sizing → trade math
scripts/                       every npm-run entrypoint below
```

---

## §2 — The fact pipeline

Capture a filing's numbers verbatim, then build a validated **FactPack** (`lib/facts/schema.ts`).

```bash
npm run watchlist:add -- NVDA                          # resolve CIK via sec.gov, append to data/edgar/watchlist.json
npm run detect                                         # poll EDGAR for new 10-Q/10-K on the watchlist; print + mark seen
npm run facts:prepare -- AVGO 0001730168-26-000080     # EDGAR record + primary doc + 8-K exhibit 99.1 + prior 10-K + DEF 14A + Yahoo closes → data/raw/…
/fetch-facts AVGO 0001730168-26-000080                 # (Claude Code) capture vendor responses verbatim to data/raw/…
npm run facts:build  -- AVGO 0001730168-26-000080      # raw → validated FactPack in data/facts/…
npm run facts:enrich -- AVGO 0001730168-26-000080      # stamp goodwill (SEC) + peer multiples (Yahoo) onto the pack
npm run facts:diff   -- AVGO 0001730168-26-000080      # projected facts vs the hand-built golden fixture, formatted
```

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

FactPack context also carries the **press release** (`context.pressRelease`, from the 8-K's exhibit 99.1),
the longer **Risk Factors** excerpt (`context.riskFactorsSource`), and the **DEF 14A proxy**
(`context.proxyStatement`) — the only surface governance claims may rest on.

---

## §3 — Synthesis, scoring & editorial review

The model writes only the **judgment** (`lib/synth/judgment.schema.ts`): rating, target range, scenario
prices + probabilities, and section Markdown. Code derives everything else and refuses to publish an
ungrounded or inconsistent report.

```bash
npm run synth:prompt -- AVGO 0001730168-26-000080                  # FactPack + desk config → data/judgment/AVGO/<acc>.prompt.md
/synthesize AVGO 0001730168-26-000080                              # (Claude Code) writes the judgment .json, then builds
npm run synth:build  -- AVGO 0001730168-26-000080                  # judgment + facts → validated data/avgo.json (or an errors file)
npm run synth:review-brief -- AVGO 0001730168-26-000080            # → data/judgment/AVGO/<acc>.review-brief.md
npm run synth:prompt -- AVGO 0001730168-26-000080 --with-review    # re-prompt the author with the open editorial findings
npm run synth:build  -- AVGO 0001730168-26-000080 --skip-review    # local experiments only; prints a warning
```

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

## §4 — Portfolio

`portfolio:build` re-marks every published report against the current Yahoo price, screens for eligibility,
and sizes a long-only book — the *analytical* snapshot. Read-only; no broker.

```bash
npm run portfolio:build                                   # → data/portfolio/snapshot (gitignored) + CSV
npm run portfolio:build -- --model kellyTilt              # the experimental quality-tilted sizer (lib/portfolio/sizing-v2.ts)
npm run portfolio:build -- --wMax 0.08 --sectorMax 0.25   # override caps
npm run portfolio:build -- --muExp 1 --convExp 1 --rExp 1 # override score exponents
```

A name is eligible only if it's buy-side on **both** the label and the gate ceiling, with μ, R, conviction
and freshness all above their floors (`lib/portfolio/eligibility.ts`). Eligible names are scored
`μ · κ · R · staleness`, allocated **proportional to score**, then **water-filled** under a per-name cap
(10%) and a sector cap (30%); shed weight flows to the best remaining names, and any shortfall the caps
can't absorb becomes cash — **never leverage**. `ICE` is a **hard compliance ban** (the owner is an ICE
employee) that lives outside the config and can't be switched off. See `docs/engine.md` §3 for the full math.

The reusable HTML dashboard renders a snapshot; refresh it by regenerating its embedded data from the new
snapshot and republishing to the same URL.

---

## §5 — The trade layer *(branch `trade-layer`, gated — real money when `BROKER=schwab`)*

`portfolio:build` stops at target weights. The trade layer turns *target vs current* into whole-share,
slippage-capped **IOC limit** orders, with the **broker as the source of truth**. The core (`lib/trade/`)
never names a broker; `lib/broker/` supplies swappable adapters. `docs/engine.md` §4–§7 is the full spec.

### Commands for the trader

```bash
npm run trade:auth                        # (Schwab only) interactive OAuth — link the account, store tokens. Re-run ~weekly.
npm run trade:reconcile                   # broker → data/trade/ledger.json. Reads only. Halts on an unexplained position.
npm run trade:plan                        # compute + record the plan. NEVER submits. --broker fake (default) | alpaca (read-only)
npm run trade:execute                     # plan → confirm → submit through the guards → record fills → broker-truth audit
npm run trade:execute -- --yes            # same, non-interactive (skips the confirm prompt)
npm run trade:cron                        # the scheduler entrypoint: clock → breakers → execute-if-any → audit → notify
npm run trade:audit                       # read-only broker-truth cross-check of the latest run.  -- --run <id> | --date <YYYY-MM-DD>
npm run trade:review -- --since 2026-09-01 # weekly digest: turnover, cash band, deferrals, reconciled-every-run, lock violations, cap-binds
```

Typical daily loop: `trade:reconcile` (see the book) → `trade:plan` (preview the orders, nothing submitted)
→ `trade:execute` (confirm and place) → `trade:audit` (verify the broker matches the local record).
`trade:cron` does reconcile → plan → execute-if-any in one guarded shot for the scheduler.

`--date <YYYY-MM-DD>` on `trade:plan` overrides the trading day; `trade:plan --broker fake --simulate-fills`
runs a Phase-0 dry loop against an in-memory book.

### How the engine decides (short version)

- **Two-sided hysteresis** (`lib/trade/hysteresis.ts`): a *held* name has an easier bar to keep than a *new*
  name has to enter (`rEnter 0.60` vs `rExit 0.35`, `muEnter 0.08` vs `muExit 0.03`). The gap is a
  no-churn band, so a winner is never sold for merely dipping below the entry bar.
- **No-trade band** (`tradeBand 0.025`): sub-2.5pp top-ups are skipped.
- **Compliance locks** (`lib/trade/locks.ts`): symmetric, whole-ticker, **5 business days** — a buy fill
  blocks selling for 5 days and vice-versa (same-side adds are legal).
- **Slippage-capped IOC limits** (`lib/trade/limit.ts`): a per-liquidity-bucket anchor waterfall (fresh
  trade → quote touch → prior close) with a spread-aware tolerance τ and a hard cap τ_max. IOC means an
  unmarketable order cancels — **a non-fill is the slippage cap doing its job**, not an error.
- **Decisions use the settled prior-day close** so the plan is reproducible; only the *fill* crosses at the
  live quote.

### Safety rails

| Rail | Where | Effect |
|---|---|---|
| `TRADE_DISABLED=1` | env kill switch | refuses every submission, both brokers |
| confirm prompt | `trade:execute` | requires `y` (or `--yes`) before any order |
| market-clock check | `trade:execute` / `trade:cron` | exits cleanly outside the regular session (09:30–16:00 ET on trading days) |
| fire window | `trade:cron` | a run starting > 20 min after `cronTimeET` exits as `late` (`trade:cron -- --now` for a deliberate manual run) |
| turnover breaker | `trade:cron` | halts a run whose turnover > 15% of NAV (so the initial deploy must go via `trade:execute`) |
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
audit) plus halt/auth alerts when `DISCORD_WEBHOOK_URL` is set — best-effort; a Discord outage never fails a
run. **Schedule** `trade:cron` for 09:45 ET with `scripts/register-trade-cron.ps1` (Windows Task Scheduler)
or `scripts/register-trade-cron.sh` (systemd `--user` timer / cron); it self-guards on the market clock, so
triggering it daily is safe.

> **Rollout gate:** Phase 0 (fake dry-run) → Phase 1 (paper smoke, ≥10 clean runs) → Phase 2 (paper
> event-driven, 4 weeks clean + weekly review) before any merge to `main`.

---

## Environment

`.env.local` (see `.env.example`):

```bash
EDGAR_CONTACT=you@example.com            # required — SEC rejects requests without it

# BROKER=alpaca-paper                    # "alpaca-paper" (default, paper) or "schwab" (LIVE)
APCA_API_KEY_ID=                         # Alpaca paper keys
APCA_API_SECRET_KEY=
APCA_API_BASE_URL=https://paper-api.alpaca.markets

SCHWAB_CLIENT_ID=                        # Schwab live — register an app at developer.schwab.com (needs both API products)
SCHWAB_CLIENT_SECRET=
SCHWAB_REDIRECT_URI=https://127.0.0.1

# TRADE_DISABLED=1                       # kill switch — refuse every order
# DISCORD_WEBHOOK_URL=                   # run summaries + halt/auth alerts (optional)
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