# Juniper Research — Render Site Design

**Date:** 2026-09-12
**Status:** Approved, ready for implementation planning
**Subsystem:** 1 of 5 (render site)

---

## Context

`juniresearch` currently holds two design documents and a standalone React
prototype. There is no application.

- `forest-linen-theme.md` — the 8-token, two-mode palette (Linen / Forest Night)
  plus the three type faces and the zero-radius rule.
- `editorial-hairline-design.md` — the full specification for the 1-year price
  projection chart: canvas, margins, gridlines, target rays, the Juniper target
  band, and the decluttered right-margin label column.
- `files/` — a working prototype proving the approach against one real report
  (`avgo.json`, Broadcom). It contains the data contract (`report.schema.ts`),
  all number formatting (`format.ts`), and three components.

The prototype's governing idea, stated in `files/README.md`:

> The model that writes reports emits barebones data; this project owns every
> pixel of presentation.

This holds through a strict four-way split:

| Layer | Home | Rule |
|---|---|---|
| Facts | `report.schema.ts` | raw numbers only; every percentage a decimal ratio |
| Judgment | same, as Markdown strings | analyst prose, no HTML, no inline styling |
| Presentation | `format.ts` + components | every `$` `%` `x` `~` `+/-` `B/T` applied here |
| Derived | `format.ts`, chart geometry | upside, weighted scenarios, fair value, the chart — computed, never stored |

That split is the project's central asset and this design preserves it exactly.

## Goal

A Next.js + shadcn/ui application that renders a validated `Report` JSON into
the themed research page, plus an index of available reports. It is the
foundation the remaining four subsystems build on.

## Scope

**In scope**

- `/research/[ticker]` — the full equity report, sections 1 through 8
- `/research` — an index of all available reports
- Forest & Linen theming in both modes, via `next-themes` and CSS variables
- The Editorial Hairline projection chart, server-rendered
- Contract validation at the page boundary, with sanity checks beyond Zod
- Graceful degradation to narrow screens
- Unit and render tests

**Out of scope** — each is its own spec/plan/build cycle:

- Subsystem 2: SEC EDGAR filing detection, Bigdata.com / FMP fact fetching
- Subsystem 3: model synthesis with structured outputs, Zod re-prompt self-heal
- Subsystem 4: Playwright print-to-PDF, visual regression
- Subsystem 5: publishing to juniperfin.com, archive, ISR revalidation
- Search, filtering, authentication, marketing pages, chart interactivity

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Build the render site first | Firmest contract; the other four subsystems depend on it; a working fixture already exists |
| 2 | Report page plus index | Enough to be a real site; the index derives from the data directory, so it adds no new contract |
| 3 | Restyled shadcn primitives | Keeps shadcn's accessibility and API surface while the report keeps its exact look; future components drop in already themed |
| 4 | React-rendered SVG, d3 for math only | The chart must exist in server HTML for SSG and for reliable print-to-PDF in subsystem 4 |
| 5 | Graceful degradation on mobile | The print layout stays authoritative; no second design to keep in sync |
| 6 | Server-rendered report, client only where required | Makes decisions 3 and 4 pay off; nothing but HTML, CSS and the toggle reaches the browser |

### On decision 4

The prototype draws the chart inside `useEffect` with roughly eighty imperative
d3 `.append()` calls (`files/ProjectionChart.tsx:59`). The SVG is therefore empty
in server-rendered HTML and populates only after hydration. Three consequences:
the chart is invisible without JavaScript, it cannot be statically exported as
markup, and Playwright print-to-PDF would silently print a blank 960x480 box
unless it explicitly waits for hydration.

Using d3 only for scales and layout math, then returning real JSX elements,
removes all three. The geometry is unchanged; only its output form differs.

### On decision 6

With `next-themes` writing `class="dark"` onto `<html>` and CSS variables
carrying the palette, theme switching needs no React state. The report body
becomes a React Server Component. A consequence worth naming: the chart no
longer receives a theme object. It emits `stroke="var(--bull)"` and the browser
resolves the value per mode, so one server-rendered SVG serves both themes.

This is the same "derive, do not store" principle the schema already applies to
numbers, applied to color.

## Architecture

```
app/
  layout.tsx              fonts via next/font, ThemeProvider, <html suppressHydrationWarning>
  globals.css             token layer + report typography
  page.tsx                redirect to /research
  research/
    page.tsx              index of all reports
    [ticker]/
      page.tsx            RSC: load -> validate -> render
      not-found.tsx
components/
  ui/                     shadcn, restyled: table card badge alert separator button
  theme-toggle.tsx        "use client" — the only client component
  report/
    EquityReport.tsx      composition root
    ReportHeader.tsx      eyebrow, title, subtitle, accent rule
    Snapshot.tsx          the two-column key/value grid
    RatingBlock.tsx       rating badge + price target cells
    FinTable.tsx          FinancialTable -> restyled Table
    ScenarioTable.tsx     scenarios with computed weighted values + fair value
    Callout.tsx           investment thesis box
    Markdown.tsx          the contract's Markdown subset
    Section.tsx           numbered section wrapper
    sections/             one file per numbered section, 1 through 8
  chart/
    ProjectionChart.tsx   RSC, returns JSX <svg>
    geometry.ts           pure functions: model, scales, grid, rays, band, declutter
lib/
  report.schema.ts        moved from files/, unchanged
  format.ts               moved from files/, unchanged
  validate.ts             post-Zod sanity checks (new)
  reports.ts              loadReport() / listReports()
data/
  avgo.json               moved from files/
```

`report.schema.ts` and `format.ts` move byte-for-byte unchanged. They are
already correct, they are the contract, and they are what subsystems 2 and 3
will import. Everything else is rebuilt around them.

The prototype's single 349-line component splits into nine report primitives
plus eight section files. Sections 1 through 8 are the units that change when
the report format evolves; each should be editable without opening the file that
owns table styling for the whole document.

## Token layer

Tailwind v4, CSS-first configuration. The palette is declared once per mode:

```css
:root {                    /* Linen */
  --page:#f5f3e9;  --surface:#eeece0;  --ink:#23241d;
  --muted:#6b6d5f; --accent:#315438;   --hairline:#dcdbcb;
  --bull:#4a7a52;  --bear:#a24a30;
}
.dark {                    /* Forest Night */
  --page:#12140f;  --surface:#191c16;  --ink:#eae9dc;
  --muted:#9ca08b; --accent:#7fb083;   --hairline:#2f342a;
  --bull:#8fc48a;  --bear:#d68a5f;
}
```

### Naming

`forest-linen-theme.md` names the body-ink token `primary`. shadcn/ui also
defines `--primary`, meaning "primary button or chip fill." Mapping the two
together would render every shadcn Button in bark ink and give every heading
button semantics.

The report tokens are therefore renamed `--ink`, `--muted` and `--hairline`,
and aliased onto shadcn's vocabulary in a separate block:

```css
--background: var(--page);      --foreground: var(--ink);
--card:       var(--surface);   --border:     var(--hairline);
--muted-foreground: var(--muted);
--primary:    var(--accent);    /* shadcn sense: chip / button fill */
--radius:     0rem;
```

Two vocabularies, one source of truth. The mapping table in
`forest-linen-theme.md` remains authoritative for roles; only the identifiers
differ.

### Role assignments

Unchanged from `forest-linen-theme.md`. In particular: `accent` is structural
only (eyebrow, section rules, links, rating chip), and `bull` / `bear` carry
gains and losses only. Green never does two jobs.

The rating badge takes its fill from `rating.tone`, so a BUY renders in `bull`,
a SELL in `bear`, and a HOLD in `accent` — the badge carries the call.

## Data flow

1. `generateStaticParams()` enumerates `data/*.json` and produces one static
   route per ticker.
2. The page reads the file, runs `Report.parse()`, then `validateReport()`.
3. Derived values are computed during render by `format.ts` — upside range,
   scenario weighted values, probability-weighted fair value.
4. Chart geometry is computed by pure functions and rendered as JSX.

All of this happens at build time. Nothing but HTML, CSS and the theme toggle
reaches the browser.

The index page uses `listReports()`, which reads each file's `meta` and `rating`
to render ticker, company, rating badge, report date and target range.

## Chart

`geometry.ts` exposes pure functions that take numbers and return numbers:

- `buildChartModel(report)` — moved out of the component so it is testable in
  isolation. Derives every chart input from `quote`, `rating` and
  `analystSentiment`. There is deliberately no `chart` blob in the contract, so
  the chart cannot disagree with the tables elsewhere in the report.
- `computeScales({ model, layout })` — x and y linear scales, the nice-stepped
  gridline values, the Now divider position, the current-price point.
- `targetRays(model, scales)` — the four dashed rays from current price to each
  target at +1Y.
- `declutterLabels(rows, minGap)` — desired y is each target's true price, then
  a minimum gap is enforced top to bottom.
- `historySeries(current, days)` — see below.

`ProjectionChart.tsx` maps that output to JSX and computes nothing itself.

### Responsive layout

Geometry takes a `layout: "wide" | "narrow"` parameter.

- **wide** — 960x480, left price axis, right margin as the label column, exactly
  as specified in `editorial-hairline-design.md`.
- **narrow** — full-width plot, no right label column; targets render below the
  plot as a stacked legend.

Both are server-rendered and toggled with `hidden md:block` and `md:hidden`.
Geometry runs twice; it is pure arithmetic and costs nothing.

Financial tables get horizontal scroll containers with a fade affordance at the
overflow edge. Prose reflows normally.

### Historical series

`historySeries()` currently returns the prototype's deterministic sine
placeholder (`files/ProjectionChart.tsx:113`), which lands exactly on the current
price. It keeps that behaviour but gains a real signature and an explicit
`placeholder: true` marker on its return value, so that:

- a fabricated price line cannot ship unnoticed, and
- wiring real daily closes (FMP `historical-price-eod-light`, trailing 30 days)
  in a later subsystem is a one-function swap rather than a chart rewrite.

The report page renders a small caption noting the history line is indicative
while the placeholder is in use.

## Error handling

Zod parses at the page boundary. A malformed report **fails the build** rather
than rendering a broken page. This is the point of having a contract: the JSON
will eventually be written by a model, and a silent partial render is worse than
a loud failure.

`validate.ts` adds the checks `files/README.md` step 4 calls for, which Zod
cannot express:

- scenario probabilities sum to 1, within 0.001
- ratio fields that must fall within [0, 1] do so
- `rating.targetLow < rating.targetHigh`
- `analystSentiment.buy + hold + sell` equals `numAnalysts`
- the rating band brackets the base-case scenario's implied price. The schema
  leaves `scenario.name` freeform, so the base case is identified by a
  case-insensitive match on `"base"`. If no scenario matches, the check is
  skipped rather than failed — this rule must never fire on a naming choice.

All five rules pass against `avgo.json` as written: probabilities sum to exactly
1.0, 440 <= 490 <= 525, and 54 + 6 + 0 = 60.

Each failure reports the ticker, the field and the offending value. These
messages later become the re-prompt payload for subsystem 3.

Other cases:

- unknown ticker: `notFound()`
- null table cells: render as an em dash, already handled by `formatCell`
- absent `disclaimer`: falls back to the project default

## Testing

Test-driven, using Vitest. Three layers:

**`format.ts`** — `avgo.json` is the regression fixture. Every formatter output
is asserted against the strings in the source PDF. The prototype's informal node
spot-checks become CI-enforced tests.

**`geometry.ts`** — pure functions, directly testable:

- scales map the current price onto the expected y coordinate
- `declutterLabels` genuinely enforces the 28px minimum gap
- the near-colliding Median and Consensus pair described in
  `editorial-hairline-design.md` separates correctly
- narrow layout omits the label column and widens the plot

**Render** — `avgo.json` renders without throwing; key strings are present in
the output; `validate.ts` rejects a deliberately broken fixture.

Visual regression belongs to subsystem 4.

## Dependencies

`next`, `react`, `tailwindcss` v4, `next-themes`, `zod`, `d3` (scale and shape
only), `lucide-react`, shadcn/ui components, `vitest` plus
`@testing-library/react`.

Fonts — Cormorant Garamond, EB Garamond, Inter, JetBrains Mono — load through
`next/font/google` rather than the prototype's CSS `@import`, so they are
self-hosted, preloaded, and do not block first paint.

## Migration of the prototype

`files/` is the source, not a dependency. On completion:

- `report.schema.ts`, `format.ts`, `avgo.json` move to `lib/` and `data/`,
  unchanged
- `Markdown.tsx` moves to `components/report/`, unchanged in behaviour
- `EquityReport.tsx` and `ProjectionChart.tsx` are rebuilt as described above
- `files/README.md` moves to the repository root as the project README, with the
  directory tree updated to match the real layout
- the `files/` directory is removed

## Open items for later subsystems

- Real daily closes for the history line (subsystem 2)
- `?theme=dark|light&print=1` and print CSS (subsystem 4)
- `schemaVersion` migration handling once a second version exists (subsystem 5)
