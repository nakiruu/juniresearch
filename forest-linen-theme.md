# Forest & Linen — Report Color Theme

A warm, editorial palette for the Juniper Finance equity-research layout. A deep **pine** accent carries the growth-and-money connotation without fintech neon; it stays structural (eyebrow, rules, links, section markers) while a lighter **leaf** handles gains and a **terracotta** handles losses — so green never does two jobs at once.

Frame is unchanged from the base config: Cormorant Garamond display, Inter body, JetBrains Mono data, hairline rules, zero border-radius.

---

## Tokens

### Light — "Linen"

| Token | Hex | Role |
|---|---|---|
| `primary` | `#23241d` | Bark ink — headings & body |
| `secondary` | `#6b6d5f` | Olive gray — labels, captions |
| `accent` | `#315438` | Deep pine — eyebrow, rules, links, rating chip |
| `neutral` | `#dcdbcb` | Hairline borders, table gridlines |
| `surface` | `#eeece0` | Linen — panels, alternating rows |
| `page` | `#f5f3e9` | Report background |
| `bull` | `#4a7a52` | Gains, up figures, up chart line |
| `bear` | `#a24a30` | Losses, down figures, down chart line |

### Dark — "Forest Night"

| Token | Hex | Role |
|---|---|---|
| `primary` | `#eae9dc` | Warm cream — headings & body |
| `secondary` | `#9ca08b` | Sage gray — labels, captions |
| `accent` | `#7fb083` | Soft sage-emerald — eyebrow, rules, links, rating chip |
| `neutral` | `#2f342a` | Hairline borders on dark |
| `surface` | `#191c16` | Forest-charcoal — panels, raised rows |
| `page` | `#12140f` | Report background |
| `bull` | `#8fc48a` | Gains, up figures, up chart line |
| `bear` | `#d68a5f` | Losses, down figures, down chart line |

---

## Tailwind config

### Light

```js
// tailwind.config.js — Forest & Linen · LIGHT
export default {
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cormorant Garamond"', 'serif'],
        sans:    ['"Inter"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        primary:   '#23241d', // bark ink
        secondary: '#6b6d5f', // olive gray
        accent:    '#315438', // deep pine
        neutral:   '#dcdbcb', // hairline
        surface:   '#eeece0', // linen panel
        page:      '#f5f3e9', // page bg
        bull:      '#4a7a52', // gains / up line (leaf)
        bear:      '#a24a30', // losses / down line (terracotta)
      },
      borderRadius: {
        sm: '0px',
        md: '0px',
        lg: '0px',
      },
    },
  },
};
```

### Dark

```js
// tailwind.config.js — Forest Night · DARK
export default {
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cormorant Garamond"', 'serif'],
        sans:    ['"Inter"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        primary:   '#eae9dc', // warm cream text
        secondary: '#9ca08b', // sage gray
        accent:    '#7fb083', // soft sage-emerald
        neutral:   '#2f342a', // hairline on dark
        surface:   '#191c16', // forest-charcoal panel
        page:      '#12140f', // page bg
        bull:      '#8fc48a', // gains / up line
        bear:      '#d68a5f', // losses / down line
      },
      borderRadius: {
        sm: '0px',
        md: '0px',
        lg: '0px',
      },
    },
  },
};
```

---

## Usage in the report

- **Eyebrow / section markers** (`EQUITY RESEARCH`, `1. Executive Summary`): `accent`.
- **Body & metric values**: `primary`. **Metric labels & captions**: `secondary`.
- **Rating badge** (`HOLD`): `accent` background, `page` text. For Buy use `bull`, for Sell use `bear`, so the badge carries the call.
- **Metric deltas** (`+57%`, `−$23.7B`): `bull` / `bear`.
- **Price-projection chart**: up-scenario lines `bull`, down-scenario `bear`, current/consensus line `accent`, gridlines `neutral`, target band a low-opacity `accent` fill.
- **Tables**: gridlines `neutral`; alternating rows `surface`; header rule `primary`.
- **Panels / callouts** (RPO backlog, thesis box): `surface` fill, `neutral` border.

## Notes

- Two tokens go beyond the original five: `page` (report background, one step off `surface`) and the `bull`/`bear` pair. `fontFamily` and `borderRadius` are unchanged.
- **Contrast:** every `primary`-on-`surface` and `primary`-on-`page` pairing clears WCAG AA for body text in both modes. `accent` clears AA for large text and UI elements; the light `accent` (`#315438`) also clears AA for normal body text on `surface`/`page`.
- If the pine reads too dark against the chart's up-lines, lift the light `accent` toward the leaf tone (`#3d6547`) and keep `bull` for the actual gain lines.
