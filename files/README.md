# Juniper Equity Report — Data-Driven Rendering

Renders a Juniper Finance equity report as a themeable Next.js page from a single
JSON sidecar. **The model that writes reports emits barebones data; this project
owns every pixel of presentation.** One `avgo.json` renders as web (dark/light)
and as the two PDFs, with zero per-report markup.

```
lib/
  report.schema.ts    Zod contract (facts + judgment) — the single source of truth
  format.ts           every "$ / x / % / B/T / ~ / +/-" + all derived values
components/
  EquityReport.tsx     renders the whole report from a `Report` object
  ProjectionChart.tsx  d3 "Editorial Hairline" chart, DERIVED from the contract
  Markdown.tsx         tiny renderer for the prose subset
data/
  avgo.json            reference report (proves parity with the PDF)
```

---

## The core idea

The AVGO PDF baked presentation into content: numbers were pre-formatted strings
(`"$361.99"`, `"+40.8%"`), the rating cells were composed strings, and sections
1–8 were hand-written JSX. That is the thing to kill.

Here the split is strict:

- **Facts** — raw numbers pulled deterministically from Bigdata.com / FMP.
  No formatting. `currentPrice: 361.99`, `consensusTarget: 509.61`,
  `marketCap: 1720000000000`. **Every percentage is a decimal ratio**
  (`0.408`, never `40.8`).
- **Judgment** — the analyst's prose, authored by the model as plain **Markdown
  strings**. No HTML, no inline styling.
- **Presentation** — lives entirely in `format.ts` (numbers) and the components
  + stylesheet (layout, theme, tables, chart).
- **Derived values** — computed by the project, never stored: the upside range,
  scenario weighted values and probability-weighted fair value, the analyst
  implied upside, the whole projection chart. The model supplies base inputs
  (target range, scenario prices + probabilities); the project does the math, so
  every report is internally consistent and arithmetically correct.

Because formatting and math live in code, the same JSON renders identically in
Forest Night, Linen, or PDF, and swapping tickers is a data change only.

---

## Authoring contract (lift this into the pipeline prompt)

The report-generation model returns **one JSON object** matching
`lib/report.schema.ts`. Rules:

1. **Numbers are numbers.** Emit `361.99`, not `"$361.99"`. Emit large values in
   full USD (`63900000000`), not `"$63.9B"`. The project scales and labels them.
2. **Percentages are ratios.** `40.8% → 0.408`, `+221% → 2.21`, `30% → 0.30`,
   `-3.3% → -0.033`.
3. **Prose is Markdown**, not HTML. Supported subset:
   - `**bold**`
   - `### ` / `#### ` sub-headings at the start of a block
   - `- ` / `* ` bullet lines
   - blank line = paragraph break
   - `{+ text +}` = bullish emphasis (green), `{- text -}` = bearish (terracotta).
     Use for signed deltas you want colored (`{+ +221% YoY +}`). **Don't nest**
     markers (no `**{+ +}**`); pick one.
4. **Do not format, compute, or lay out.** No `$`, `%`, `x`, `~`, `+/-` inside
   numeric fields. Never send an upside %, a weighted scenario value, a fair
   value, or the chart — the project derives them.
5. **Do not invent numbers.** All figures come from the data source injected into
   context. If a value isn't available, omit it or use `null` in a table cell
   (renders as `—`); never estimate from memory.
6. **Escape hatches, used sparingly:**
   - Financial-table cells accept `number | null | string`. Use a **string**
     only for genuinely indicative values (`"~40x"` peer multiples); the
     company's own historicals must be numeric so the project can format and
     recompute.
   - Snapshot cells accept `raw` for composite/text cells (a range, a rating
     distribution). Everything else is `{ value, unit, ... }`.

### Snapshot cell shape

```jsonc
{ "label": "Consensus Target", "value": 509.61, "unit": "usd", "change": 0.408 }
// -> "$509.61 (+40.8%)"
{ "label": "Market Cap", "value": 1720000000000, "unit": "usdLarge", "approx": true }
// -> "~$1.72T"
{ "label": "Q3'26 Operating Margin", "value": 0.68, "unit": "pct", "dp": 0, "note": "record" }
// -> "68% (record)"
```
`unit`: `usd | usdLarge | mult | pct | shares`. Modifiers: `approx` (~), `dp`,
`change` (a ratio → ` (+X%)`), `changeDp`, `note`, `raw`.

### Financial table shape

```jsonc
{
  "columns": ["Metric", "FY21", "FY22", "FY23", "FY24", "FY25"],
  "rows": [
    { "label": "Revenue ($B)", "values": [27500000000, ...], "format": "usdB" },
    { "label": "Gross Margin", "values": [0.614, ...], "format": "pct" }
  ],
  "note": "Source: …"
}
```
`format`: `usdB | usdT | pct | pctSigned | mult | eps | num1 | num2 | usd0 | usd2`.

---

## Pipeline flow

1. **Detect** a new 10-Q / 10-K (SEC EDGAR EFTS).
2. **Fetch facts** from Bigdata.com / FMP — financials, ratios, peers, analyst
   targets, segments, transcript. These populate the numeric half of the JSON
   deterministically.
3. **Synthesize** — one model call with the facts in context, using **structured
   outputs / a forced tool call** so the return conforms to the schema. The model
   fills only judgment + prose (rating, target range, scenario probabilities,
   section Markdown).
4. **Validate** — `Report.parse(json)`. On failure, re-prompt with the Zod error
   and let the model self-heal. Add sanity checks (probabilities sum to 1;
   margins in [0,1]; target range brackets the base case).
5. **Persist** `data/<ticker>.json` — the canonical, versioned artifact.
6. **Render** — the page reads the JSON (SSG/ISR). Generate both PDFs by
   Playwright print-to-PDF against `?theme=dark|light&print=1` with print CSS —
   one codebase for web + PDF, replacing the standalone weasyprint engine (or
   keep weasyprint, pointed at the same JSON).
7. **Publish** to juniperfin.com.

Keep `schemaVersion` on every file and store them in git/DB — that's the report
archive, and it lets you re-render historical reports in a new theme.

---

## Using it

```tsx
// app/research/avgo/page.tsx
import EquityReport from "@/components/EquityReport";
import avgo from "@/data/avgo.json";
import { Report } from "@/lib/report.schema";

export default function Page() {
  const data = Report.parse(avgo); // validate at the boundary
  return <EquityReport data={data} />;
}
```

Dependencies: `d3`, `lucide-react`, `zod`. Fonts (Cormorant Garamond / EB
Garamond / Inter / JetBrains Mono) are pulled in `EquityReport.tsx`.

---

## shadcn mapping

The presentational primitives are plain styled elements so this renders
standalone. Swapping to shadcn touches only these components — **not the data
contract**, which is the whole point of the separation:

| here            | shadcn/ui                                             |
|-----------------|-------------------------------------------------------|
| `Snapshot`      | `Table`, or a `dl` grid inside `Card`                 |
| `RatingBlock`   | `Card` + `Badge` (tone → variant)                     |
| `StatTable` / `FinTable` | `Table` (`TableHeader/Row/Cell`) with the dark-header class |
| `.callout`      | `Alert` / `Card`                                      |
| section wrapper | `Separator` + Typography                              |
| mode toggle     | `next-themes` + `Button` (`variant="ghost"`)          |

Theme tokens (`--primary … --bull/--bear`) already map to CSS variables, so
Forest Night / Linen become a token swap — wire them to your Tailwind theme and
`next-themes` and drop the local `THEMES` object.

---

## Why not Quarto here

Quarto is great where the Quarto-rendered artifact *is* the deliverable (the
long-form analysis site). It renders Pandoc → HTML/LaTeX with its own theming; to
get shadcn components + d3 you'd embed raw HTML/OJS and rebuild the look by hand,
losing the component model. For a page inside the Next.js app that must match the
report design, JSON-contract → React reuses the sidecar the pipeline already
emits and gives total style control. Keep Quarto for the analysis site; use this
path for the component reports.

---

## Conventions & gotchas

- **Derive from full precision.** `format.ts` can compute a YoY-growth or margin
  row, but derive from full-precision source values, not the rounded display
  numbers, or results drift a tenth from the filing. In `avgo.json` the YoY row
  is provided data for exact parity; wire live derivation to the raw Bigdata
  figures.
- **`emphasize: true`** on a table row (or the scenario summary) adds the
  bold last-row treatment via `.emph-last`.
- `data/avgo.json` is the regression fixture. `node` spot-checks in the repo
  confirm every formatter output matches the source PDF; keep it green when the
  schema changes.
