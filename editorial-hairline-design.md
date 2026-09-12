# Editorial Hairline — Price-Projection Chart

The quiet member of the projection set. Where **Forecast Fan** shouts with filled
pills and **Gradient Cone** dramatizes dispersion, Editorial Hairline is built to
*disappear into a page of prose* — a figure you can set inside a research note
without it fighting the body text. It reads as a printed exhibit, not a dashboard
widget.

Frame is the base Forest & Linen config: Cormorant Garamond display, Inter body,
JetBrains Mono data, hairline rules, zero border-radius. This style leans hardest
into that frame.

---

## Concept

- **Restraint over emphasis.** Every line is thin, every fill is faint, nothing is
  filled-and-bold. The *data* carries weight through position, not decoration.
- **Structure encodes meaning.** The hairline border, dotted gridlines, and eyebrow
  are information, not ornament — they say "this is a formal exhibit."
- **Green never does two jobs.** Structural accent (pine/sage) stays separate from
  the gain/loss pair (leaf/terracotta), so a reader never has to ask which green
  they're looking at.

Use it as the default chart for the report body. Reach for Forecast Fan when the
chart is the hero of a page or a standalone slide.

---

## Canvas & layout

| Property | Value |
|---|---|
| Artboard | `960 × 480` (2:1), `viewBox`-scaled — export at 2× for print |
| Panel | `surface` fill, `neutral` 1px border (the hairline frame) |
| Margins | top `100` · right `210` · bottom `46` · left `66` |
| Price axis | **left** — freeing the whole right margin for target labels |
| History | ~1 month, occupying the left sliver up to the `Now` divider |
| Projection | `Now → +1Y`, the remaining ~85% of the plot width |

Placing the axis on the left (rather than the TradingView-style right axis) is a
deliberate call: with four labeled targets, the right margin earns its keep as a
label column. The `Now` divider sits far left because history is intentionally
short — the chart is about the forecast, not the past month.

```
┌───────────────────────────────────────────────────────────┐  ← neutral hairline
│ EQUITY RESEARCH                                            │  eyebrow · accent
│ Oracle Corporation · NYSE: ORCL                           │  title · Cormorant
│ 1-Year price projection · as of … · current $150.15      │  meta · mono
│                                                           │
│ 300┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╱ ■ High target    │
│      │                            ╱╱      $325 +116.5%    │
│ 250┈┈│┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╱╱╱  ┈┈┈┈■ Median target    │
│      │                     ╱╱╱ ╱╱          ■ Consensus    │
│ 200┈┈│┈┈┈┈┈┈┈┈┈┈┈┈┈╱╱╱╱╱╱╱╱┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  │
│      │▓▓▓ Juniper 150–185 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ■ Current      │
│ 150 ╱●┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅  $150.15         │
│      ┊ ╲╲╲                                                │
│ 100┈┈┊┈┈┈┈╲╲╲╲╲┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╲╲╲╲   ■ Low target     │
│  −1M Now  +3M    +6M    +9M    +1Y          $95 −36.7%    │
└───────────────────────────────────────────────────────────┘
```

---

## Typography

| Element | Face | Size / weight | Color |
|---|---|---|---|
| Eyebrow `EQUITY RESEARCH` | Inter | 10.5 / 600, `letter-spacing 3` | `accent` |
| Title `Oracle Corporation · NYSE: ORCL` | Cormorant Garamond | 27 / 600 | `primary` |
| Meta line (as-of / current) | JetBrains Mono | 10.5 | `secondary` |
| Axis values, x-ticks | JetBrains Mono | 10.5 / 10 | `secondary` |
| Label — name | Inter | 10.5 / 600 | `primary` |
| Label — value + % | JetBrains Mono | 10 | target tone |
| Band caption | Inter 700 / Mono | 11.5 / 9 | `bull` |

The header is three stacked rows (eyebrow → title → meta), left-aligned to the plot
edge — no centered title, no title/subtitle sharing a baseline. Numbers are always
mono so columns of prices align optically.

---

## Structural devices

- **Gridlines** are dotted (`1 4`) in `neutral` at 100 / 150 / 200 / 250 / 300 — a
  printed-graph-paper texture rather than solid rules.
- **X baseline** is a single `primary` hairline at 55% opacity; ticks at
  `−1M · Now · +3M · +6M · +9M · +1Y`.
- **Now divider** is a faint dashed vertical (`2 4`, `secondary`, 50% opacity)
  marking the history/forecast seam.
- **Start marker** is a small `primary` dot (r3) with a `surface` halo at the
  current price.

---

## Target lines & color logic

Four dashed rays fan from the current-price point to each target at +1Y. Dash is a
tight `5 5`, weight `1.4` — present but never heavy.

| Target | Value | Tone token | Why |
|---|---|---|---|
| High target | `$325.00` | `bull` (leaf) | strongest up case |
| Median target | `$241.00` | `accent` (pine) | central of the up cluster |
| Consensus target | `$236.52` | `secondary` (muted) | a market reference, deliberately quiet |
| Low target | `$95.00` | `bear` (terracotta) | the down case |

Median and Consensus sit ~$4.50 apart and would collide; muting Consensus to
`secondary` keeps them legible without a color clash, and the label declutter
(below) separates them vertically.

---

## The Juniper target band

- A horizontal band between **150 and 185** spanning the whole projection region,
  filled with a low-opacity **leaf-green** gradient (`0.10 → 0.06`) — the "transparent
  green" bound.
- Dashed `bull` edges (`2 3`, 70% opacity) at 150 and 185.
- A caption chip (`page` fill, faint `bull` hairline) lifts **"Juniper target
  150–185"** and **"0% to +23%"** clear of the rays crossing behind it.

The band is the one place the chart raises its voice — it's the house call, so it
gets the only real fill on the canvas.

---

## Label system (right margin)

Each target and the current price get a two-line marker in the right column:

```
■  Median target        ← 9×9 tone swatch + Inter 600, primary
   $241.00 +60.5%       ← JetBrains Mono, tone-colored (current = secondary)
```

No filled pills — a swatch plus text, so the label column reads as a quiet legend.
Labels are **decluttered**: desired y = the target's true price, then a 28px minimum
gap is enforced top-to-bottom, and a thin tone-colored **leader** connects each
label back to its exact price on the axis. This is what lets the near-overlapping
Median/Consensus pair separate cleanly without hand-tuning.

---

## Historical series

- A thin (`1.3`) `primary` line, `curveMonotoneX`, **no area fill** — the fill is a
  Fan/Cone device; Editorial keeps the left sliver as a bare trace.
- The series is deterministic placeholder data that lands exactly on `current`.
  Swap `genHistory()` for real daily closes (e.g. FMP `historical-price-eod-light`,
  trailing ~30 days) when wiring the scanner.

---

## Palette mapping

Pulls straight from `forest-linen-theme.md`; no new tokens beyond the base plus
`page` and the `bull`/`bear` pair.

| Role | Light (Linen) | Dark (Forest Night) |
|---|---|---|
| Panel fill | `surface` `#eeece0` | `surface` `#191c16` |
| Hairline border / gridlines | `neutral` `#dcdbcb` | `neutral` `#2f342a` |
| Headings / body / history line | `primary` `#23241d` | `primary` `#eae9dc` |
| Labels / captions / axis | `secondary` `#6b6d5f` | `secondary` `#9ca08b` |
| Eyebrow / accent line | `accent` `#315438` | `accent` `#7fb083` |
| High target / band / up | `bull` `#4a7a52` | `bull` `#8fc48a` |
| Low target / down | `bear` `#a24a30` | `bear` `#d68a5f` |

**Contrast.** Body/label text is `primary`/`secondary` on `surface`, clearing WCAG
AA in both modes. Target values use the tone color on `surface`; the light `bull`
and `bear` clear AA for the small mono value text, and the muted `secondary`
consensus stays comfortably readable.

---

## Configuration

Everything the chart draws comes from `ChartCore.CONFIG`:

```js
{
  ticker: 'ORCL', name: 'Oracle Corporation', exchange: 'NYSE',
  current: 150.15, asOf: 'Sep 11, 2026',
  histDays: 30, horizonDays: 365,
  band: { lo: 150, hi: 185, label: 'Juniper target' },
  targets: [
    { key:'high',      label:'High target',      value:325.00, tone:'bull' },
    { key:'median',    label:'Median target',    value:241.00, tone:'accent' },
    { key:'consensus', label:'Consensus target', value:236.52, tone:'secondary→muted' },
    { key:'low',       label:'Low target',       value: 95.00, tone:'bear' },
  ],
  yDomain: [80, 340], yTicks: [100,150,200,250,300],
}
```

Per ticker, swap `current`, `targets`, `band`, `asOf`, and the y-domain/ticks; the
declutter and leaders handle any label positions that result. Render with
`ChartCore.drawChart(svg, 960, 480, { style:'editorial', theme:'light'|'dark' })`.

## Notes

- The chart uses estimated text widths (not `getBBox`) so it renders identically in
  the browser and in a headless rasterizer — handy for server-side report PNGs.
- Export **SVG** for embedding (vector, keeps the three faces); PNG rasterizes at 2×
  as a convenience.
- If the band caption ever sits directly on the Median/Consensus crossing for a
  given ticker, nudge `bandCx` (currently `x(horizonDays·0.19)`) left toward the
  divider, where the rays are lower.
