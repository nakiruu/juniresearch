# Render Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js + shadcn/ui application that renders a validated `Report` JSON into the themed Juniper equity research page, plus an index of available reports.

**Architecture:** A React Server Component tree reads `data/<ticker>.json` at build time, validates it with Zod plus project sanity checks, and renders it. All number formatting lives in `lib/format.ts`; all chart math lives in `components/chart/geometry.ts` as pure functions whose output is mapped to JSX SVG. Theming is CSS variables toggled by a `dark` class on `<html>`, so only the theme toggle is a client component.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, next-themes, Zod, d3-scale + d3-shape, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-render-site-design.md`

## Global Constraints

- **Facts are raw numbers.** No `$`, `%`, `x`, `~`, `+/-`, `B`, `T` ever appears in a JSON field. Every percentage is a decimal ratio (`0.408` means 40.8%).
- **Nothing derived is stored.** Upside, weighted scenario values, probability-weighted fair value, and every chart input are computed at render time. There is no `chart` object in the contract.
- **All number presentation lives in `lib/format.ts`.** No component formats a number inline.
- **`lib/report.schema.ts` and `lib/format.ts` are moved byte-for-byte unchanged** from `files/`. They are the contract that subsystems 2 and 3 will import. Do not edit them in this plan.
- **Green never does two jobs.** `--accent` is structural only (eyebrow, section rules, links, rating chip). `--bull` / `--bear` carry gains and losses only.
- **Zero border radius.** `--radius: 0rem` globally, including every shadcn primitive.
- **Report tokens are `--ink` / `--muted` / `--hairline`**, aliased onto shadcn's `--foreground` / `--muted-foreground` / `--border`. Never map the report's body-ink colour onto shadcn's `--primary`, which means button fill.
- **Only `components/theme-toggle.tsx` carries `"use client"`.** Everything else is a Server Component.
- **`EquityReport` and all its children must be synchronous** function components. Only route-level `page.tsx` files may be `async`. This keeps the whole tree renderable by Testing Library.
- **Palette values, verbatim.**
  - Linen: `--page:#f5f3e9` `--surface:#eeece0` `--ink:#23241d` `--muted:#6b6d5f` `--accent:#315438` `--hairline:#dcdbcb` `--bull:#4a7a52` `--bear:#a24a30`
  - Forest Night: `--page:#12140f` `--surface:#191c16` `--ink:#eae9dc` `--muted:#9ca08b` `--accent:#7fb083` `--hairline:#2f342a` `--bull:#8fc48a` `--bear:#d68a5f`
- **Type faces.** Cormorant Garamond (display), Inter (sans/body), JetBrains Mono (data). EB Garamond is the display fallback.
- **Commit after every task.** Conventional commit prefixes (`chore:`, `feat:`, `test:`).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/report.schema.ts` | Zod contract. Moved unchanged. |
| `lib/format.ts` | All number presentation + derived values. Moved unchanged. |
| `lib/validate.ts` | Sanity checks Zod cannot express. |
| `lib/reports.ts` | Filesystem access: load one report, list all. |
| `app/globals.css` | Token layer, dark variant, report typography. |
| `app/layout.tsx` | Fonts, ThemeProvider, html/body shell. |
| `components/theme-toggle.tsx` | The only client component. |
| `components/ui/*` | shadcn primitives, restyled to the tokens. |
| `components/report/Markdown.tsx` | The contract's Markdown subset. |
| `components/report/*.tsx` | Nine presentational primitives. |
| `components/report/sections/*.tsx` | One file per numbered section, 1–8. |
| `components/report/EquityReport.tsx` | Composition root. |
| `components/chart/types.ts` | Shared chart types. |
| `components/chart/geometry.ts` | Pure chart math. |
| `components/chart/ProjectionChart.tsx` | Maps geometry output to JSX SVG. |
| `app/research/[ticker]/page.tsx` | Report route. |
| `app/research/page.tsx` | Index route. |

---

## Task 1: Scaffold, move the contract, prove the formatters

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`
- Create: `lib/report.schema.ts`, `lib/format.ts`, `data/avgo.json` (moved from `files/`)
- Test: `lib/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every export of `lib/format.ts` (`usd`, `compactUSD`, `compactNum`, `mult`, `pct`, `formatCell`, `formatSnapshot`, `upside`, `priceTargetLine`, `upsideRangeText`, `computeScenarios`) and `lib/report.schema.ts` (`Report`, `SCHEMA_VERSION`, types `Report`, `FinancialTable`, `SnapshotCellData`). Path alias `@/*` resolves to the repo root.

- [ ] **Step 1: Scaffold Next.js into a temp directory**

`create-next-app` refuses to run in a non-empty directory, so scaffold aside and copy in.

```bash
npx --yes create-next-app@latest .scaffold \
  --typescript --tailwind --app --no-src-dir \
  --import-alias "@/*" --eslint --use-npm --turbopack
```

- [ ] **Step 2: Copy the scaffold in and restore our .gitignore**

```bash
cp -r .scaffold/. .
rm -rf .scaffold
git checkout -- .gitignore
git status --short
```

Expected: `package.json`, `tsconfig.json`, `next.config.ts`, `app/`, `postcss.config.mjs` now present; `.gitignore` unchanged from ours.

- [ ] **Step 3: Install runtime and test dependencies**

```bash
npm install zod next-themes d3-scale d3-shape lucide-react
npm install -D vitest @vitejs/plugin-react jsdom vite-tsconfig-paths \
  @testing-library/react @testing-library/dom @testing-library/jest-dom \
  @types/d3-scale @types/d3-shape
```

- [ ] **Step 4: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Move the contract files unchanged**

```bash
mkdir -p lib data
git mv files/report.schema.ts lib/report.schema.ts
git mv files/format.ts lib/format.ts
git mv files/avgo.json data/avgo.json
```

Do not edit their contents. Verify:

```bash
git diff --cached --stat
```

Expected: three renames, zero content changes.

- [ ] **Step 6: Write the failing formatter tests**

Every expected string below was verified against `data/avgo.json`. Create `lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  usd, compactUSD, compactNum, mult, pct,
  formatCell, formatSnapshot, upside, upsideRangeText, computeScenarios,
} from "@/lib/format";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const report = Report.parse(avgo);
const CURRENT = 361.99;

describe("scalar formatters", () => {
  it("formats small dollar amounts", () => {
    expect(usd(361.99)).toBe("$361.99");
    expect(usd(600, 0)).toBe("$600");
  });

  it("scales large dollar amounts and trims redundant zeros", () => {
    expect(compactUSD(1_720_000_000_000, { approx: true })).toBe("~$1.72T");
    expect(compactUSD(63_900_000_000)).toBe("$63.9B");
  });

  it("scales bare counts", () => {
    expect(compactNum(4_760_000_000, { approx: true })).toBe("~4.76B");
  });

  it("formats multiples and percentages from ratios", () => {
    expect(mult(44.9)).toBe("44.9x");
    expect(pct(0.408, { signed: true })).toBe("+40.8%");
    expect(pct(0.68, { dp: 0 })).toBe("68%");
    expect(pct(0.0072, { dp: 2 })).toBe("0.72%");
  });
});

describe("table cells", () => {
  it("renders null as an em dash", () => {
    expect(formatCell(null, "usdB")).toBe("—");
  });

  it("passes strings through verbatim as the escape hatch", () => {
    expect(formatCell("~40x", "mult")).toBe("~40x");
  });

  it("scales usdB without a currency symbol", () => {
    expect(formatCell(63_900_000_000, "usdB")).toBe("63.9");
  });
});

describe("snapshot cells", () => {
  it("appends a signed change from a ratio", () => {
    expect(formatSnapshot({
      label: "Consensus Target", value: 509.61, unit: "usd", change: 0.408,
    })).toBe("$509.61 (+40.8%)");
  });

  it("appends a note", () => {
    expect(formatSnapshot({
      label: "Q3'26 Operating Margin", value: 0.68, unit: "pct", dp: 0, note: "record",
    })).toBe("68% (record)");
  });

  it("honours the raw escape hatch", () => {
    expect(formatSnapshot({ label: "52-Week Range", raw: "$289.96 – $495.00" }))
      .toBe("$289.96 – $495.00");
  });
});

describe("derived values", () => {
  it("computes upside as a ratio", () => {
    expect(pct(upside(509.61, CURRENT), { signed: true })).toBe("+40.8%");
  });

  it("reproduces the upside range quoted in the report prose", () => {
    expect(upsideRangeText(440, 525, CURRENT)).toBe("+21.6% to +45.0%");
  });

  it("derives fair value from the fixture's own scenarios", () => {
    const { rows, fairValue } = computeScenarios(report.sections.valuation.scenarios);
    expect(rows.map((r) => r.weighted)).toEqual([180, 245, 60]);
    expect(usd(fairValue)).toBe("$485.00");
  });
});

describe("the contract", () => {
  it("parses the reference fixture", () => {
    expect(report.meta.ticker).toBe("AVGO");
    expect(report.schemaVersion).toBe("1.0.0");
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL — module resolution errors for `@/lib/format`, because `resolveJsonModule` is not yet enabled and the alias is untested.

- [ ] **Step 8: Enable JSON imports**

In `tsconfig.json`, inside `compilerOptions`, ensure:

```json
"resolveJsonModule": true
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, 13 tests. If `upsideRangeText` does not return `+21.6% to +45.0%`, stop — `format.ts` was modified and must be restored.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app and move the report contract into lib/"
```

---

## Task 2: Token layer, fonts, theme provider, toggle

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`
- Create: `components/theme-provider.tsx`, `components/theme-toggle.tsx`
- Test: `components/theme-toggle.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: CSS variables `--page --surface --ink --muted --accent --hairline --bull --bear` and the shadcn aliases; Tailwind utilities `bg-page text-ink text-muted border-hairline text-accent text-bull text-bear font-display font-sans font-mono`; `<ThemeToggle />`.

- [ ] **Step 1: Write the token layer**

Replace the whole of `app/globals.css`:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --page: #f5f3e9;
  --surface: #eeece0;
  --ink: #23241d;
  --muted: #6b6d5f;
  --accent: #315438;
  --hairline: #dcdbcb;
  --bull: #4a7a52;
  --bear: #a24a30;
}

.dark {
  --page: #12140f;
  --surface: #191c16;
  --ink: #eae9dc;
  --muted: #9ca08b;
  --accent: #7fb083;
  --hairline: #2f342a;
  --bull: #8fc48a;
  --bear: #d68a5f;
}

/* shadcn vocabulary, aliased onto the report tokens.
   --primary is shadcn's BUTTON FILL, not the report's body ink. */
:root, .dark {
  --background: var(--page);
  --foreground: var(--ink);
  --card: var(--surface);
  --card-foreground: var(--ink);
  --popover: var(--surface);
  --popover-foreground: var(--ink);
  --primary: var(--accent);
  --primary-foreground: var(--page);
  --secondary: var(--surface);
  --secondary-foreground: var(--ink);
  --muted-foreground: var(--muted);
  --accent-foreground: var(--page);
  --destructive: var(--bear);
  --border: var(--hairline);
  --input: var(--hairline);
  --ring: var(--accent);
  --radius: 0rem;
}

@theme inline {
  --color-page: var(--page);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-hairline: var(--hairline);
  --color-bull: var(--bull);
  --color-bear: var(--bear);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --font-display: var(--font-cormorant), var(--font-eb-garamond), Georgia, serif;
  --font-sans: var(--font-inter), "Helvetica Neue", Arial, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, monospace;

  --radius-sm: 0rem;
  --radius-md: 0rem;
  --radius-lg: 0rem;
  --radius-xl: 0rem;
}

body {
  background: var(--page);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.6;
}

/* Report prose. Applied by the .report-prose wrapper only. */
.report-prose p { margin: 0 0 10px; text-align: justify; }
.report-prose ul { margin: 4px 0 10px; padding-left: 18px; }
.report-prose li { margin-bottom: 4px; line-height: 1.55; }
.report-prose h3 { font-size: 15.5px; font-weight: 600; margin: 16px 0 4px; }
.report-prose h4 { font-size: 14px; font-weight: 600; margin: 12px 0 4px; }
.report-prose .pos { color: var(--bull); font-weight: 700; }
.report-prose .neg { color: var(--bear); font-weight: 700; }
```

- [ ] **Step 2: Wire fonts and the provider into the layout**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Cormorant_Garamond, EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"], weight: ["600"], style: ["normal", "italic"],
  variable: "--font-cormorant", display: "swap",
});
const ebGaramond = EB_Garamond({
  subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"],
  variable: "--font-eb-garamond", display: "swap",
});
const inter = Inter({
  subsets: ["latin"], weight: ["400", "600", "700", "800"],
  variable: "--font-inter", display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "700"],
  variable: "--font-jetbrains", display: "swap",
});

export const metadata: Metadata = {
  title: "Juniper Finance — Equity Research",
  description: "Automated equity research reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = [cormorant, ebGaramond, inter, jetbrains]
    .map((f) => f.variable).join(" ");
  return (
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create the provider**

Create `components/theme-provider.tsx`:

```tsx
"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 4: Write the failing toggle test**

Create `components/theme-toggle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/theme-toggle";

const setTheme = vi.fn();
let currentTheme = "dark";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: currentTheme, setTheme, resolvedTheme: currentTheme }),
}));

beforeEach(() => { setTheme.mockClear(); currentTheme = "dark"; });

describe("ThemeToggle", () => {
  it("offers the opposite theme by name when mounted in dark", async () => {
    render(<ThemeToggle />);
    expect(await screen.findByRole("button", { name: /linen/i })).toBeInTheDocument();
  });

  it("switches to light when clicked in dark", async () => {
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole("button", { name: /linen/i }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("offers Forest Night when mounted in light", async () => {
    currentTheme = "light";
    render(<ThemeToggle />);
    expect(await screen.findByRole("button", { name: /forest night/i })).toBeInTheDocument();
  });
});
```

Install the interaction helper:

```bash
npm install -D @testing-library/user-event
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx vitest run components/theme-toggle.test.tsx
```

Expected: FAIL — cannot resolve `@/components/theme-toggle`.

- [ ] **Step 6: Implement the toggle**

Create `components/theme-toggle.tsx`. It renders nothing until mounted, because the server does not know the stored theme and a mismatched first paint would flash.

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="fixed top-4 right-4 z-50 h-8 w-28" aria-hidden />;
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="fixed top-4 right-4 z-50 flex items-center gap-2 border border-hairline
                 bg-surface px-3 py-1.5 font-sans text-xs font-semibold text-muted
                 transition-colors hover:text-ink"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      {isDark ? "Linen" : "Forest Night"}
    </button>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx vitest run components/theme-toggle.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Forest & Linen token layer, fonts, and theme toggle"
```

---

## Task 3: Contract sanity checks

**Files:**
- Create: `lib/validate.ts`
- Test: `lib/validate.test.ts`

**Interfaces:**
- Consumes: `Report` type from `@/lib/report.schema`.
- Produces:
  - `interface ValidationIssue { field: string; message: string; value: unknown }`
  - `validateReport(report: Report): ValidationIssue[]`
  - `assertValidReport(report: Report, ticker: string): void` — throws `Error` listing every issue.

- [ ] **Step 1: Write the failing tests**

Create `lib/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateReport, assertValidReport } from "@/lib/validate";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const base = () => Report.parse(structuredClone(avgo));

describe("validateReport", () => {
  it("accepts the reference fixture", () => {
    expect(validateReport(base())).toEqual([]);
  });

  it("rejects scenario probabilities that do not sum to 1", () => {
    const r = base();
    r.sections.valuation.scenarios[0].probability = 0.4;
    const issues = validateReport(r);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("sections.valuation.scenarios[].probability");
    expect(issues[0].value).toBeCloseTo(1.1, 10);
  });

  it("tolerates floating point drift within 0.001", () => {
    const r = base();
    r.sections.valuation.scenarios[0].probability = 0.3005;
    r.sections.valuation.scenarios[2].probability = 0.1995;
    expect(validateReport(r)).toEqual([]);
  });

  it("rejects an inverted rating band", () => {
    const r = base();
    r.rating.targetLow = 600;
    const issues = validateReport(r);
    expect(issues.some((i) => i.field === "rating.targetLow")).toBe(true);
  });

  it("rejects analyst counts that do not sum to numAnalysts", () => {
    const r = base();
    r.analystSentiment.hold = 9;
    const issues = validateReport(r);
    expect(issues.some((i) => i.field === "analystSentiment.numAnalysts")).toBe(true);
  });

  it("rejects a ratio outside [0,1] where one is required", () => {
    const r = base();
    r.sections.businessMoat.geoMix[0].sharePct = 1.4;
    const issues = validateReport(r);
    expect(issues.some((i) => i.field.includes("geoMix"))).toBe(true);
  });

  it("flags a rating band that does not bracket the base case", () => {
    const r = base();
    r.rating.targetHigh = 460; // base case is 490
    const issues = validateReport(r);
    expect(issues.some((i) => i.field === "rating")).toBe(true);
  });

  it("skips the bracket check when no scenario is named base", () => {
    const r = base();
    r.sections.valuation.scenarios[1].name = "Central";
    r.rating.targetHigh = 460;
    expect(validateReport(r).some((i) => i.field === "rating")).toBe(false);
  });
});

describe("assertValidReport", () => {
  it("does not throw on the reference fixture", () => {
    expect(() => assertValidReport(base(), "AVGO")).not.toThrow();
  });

  it("throws naming the ticker and every offending field", () => {
    const r = base();
    r.rating.targetLow = 600;
    r.analystSentiment.sell = 3;
    expect(() => assertValidReport(r, "AVGO")).toThrow(/AVGO/);
    expect(() => assertValidReport(r, "AVGO")).toThrow(/rating\.targetLow/);
    expect(() => assertValidReport(r, "AVGO")).toThrow(/numAnalysts/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/validate.test.ts
```

Expected: FAIL — cannot resolve `@/lib/validate`.

- [ ] **Step 3: Implement the checks**

Create `lib/validate.ts`:

```ts
/**
 * validate.ts — the sanity checks the Zod schema cannot express.
 * -----------------------------------------------------------------------------
 * Zod proves the SHAPE of a report. These functions prove it is internally
 * CONSISTENT: that probabilities sum, bands are ordered, and counts agree.
 *
 * Failures name the ticker, the field and the offending value, because these
 * messages become the re-prompt payload for the synthesis subsystem.
 */
import type { Report } from "./report.schema";

export interface ValidationIssue {
  field: string;
  message: string;
  value: unknown;
}

const EPSILON = 0.001;

export function validateReport(report: Report): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { rating, analystSentiment: a, sections } = report;
  const scenarios = sections.valuation.scenarios;

  const probSum = scenarios.reduce((sum, s) => sum + s.probability, 0);
  if (Math.abs(probSum - 1) > EPSILON) {
    issues.push({
      field: "sections.valuation.scenarios[].probability",
      message: `scenario probabilities must sum to 1, got ${probSum}`,
      value: probSum,
    });
  }

  if (rating.targetLow >= rating.targetHigh) {
    issues.push({
      field: "rating.targetLow",
      message: `targetLow must be below targetHigh (${rating.targetHigh})`,
      value: rating.targetLow,
    });
  }

  const ratingCount = a.buy + a.hold + a.sell;
  if (ratingCount !== a.numAnalysts) {
    issues.push({
      field: "analystSentiment.numAnalysts",
      message: `buy + hold + sell (${ratingCount}) must equal numAnalysts`,
      value: a.numAnalysts,
    });
  }

  const ratios: [string, number][] = [
    ...scenarios.map((s, i): [string, number] =>
      [`sections.valuation.scenarios[${i}].probability`, s.probability]),
    ...sections.businessMoat.segments.map((s, i): [string, number] =>
      [`sections.businessMoat.segments[${i}].sharePct`, s.sharePct]),
    ...sections.businessMoat.geoMix.map((g, i): [string, number] =>
      [`sections.businessMoat.geoMix[${i}].sharePct`, g.sharePct]),
  ];
  for (const [field, value] of ratios) {
    if (value < 0 || value > 1) {
      issues.push({ field, message: "ratio must fall within [0,1]", value });
    }
  }

  // The schema leaves scenario.name freeform, so the base case is identified by
  // a case-insensitive match. No match means the check is skipped, never failed:
  // this rule must not fire on a naming choice.
  const baseCase = scenarios.find((s) => s.name.trim().toLowerCase() === "base");
  if (baseCase) {
    const { impliedPrice } = baseCase;
    if (impliedPrice < rating.targetLow || impliedPrice > rating.targetHigh) {
      issues.push({
        field: "rating",
        message:
          `rating band ${rating.targetLow}–${rating.targetHigh} must bracket ` +
          `the base case implied price`,
        value: impliedPrice,
      });
    }
  }

  return issues;
}

export function assertValidReport(report: Report, ticker: string): void {
  const issues = validateReport(report);
  if (issues.length === 0) return;
  const detail = issues
    .map((i) => `  - ${i.field}: ${i.message} (received ${JSON.stringify(i.value)})`)
    .join("\n");
  throw new Error(`Invalid report for ${ticker}:\n${detail}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run lib/validate.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/validate.ts lib/validate.test.ts
git commit -m "feat: add contract sanity checks beyond the Zod schema"
```

---

## Task 4: Report loading

**Files:**
- Create: `lib/reports.ts`
- Test: `lib/reports.test.ts`

**Interfaces:**
- Consumes: `Report` from `@/lib/report.schema`; `assertValidReport` from `@/lib/validate`.
- Produces:
  - `interface ReportSummary { ticker: string; company: string; exchange: string; subtitle: string; reportDate: string; rating: Report["rating"]; currentPrice: number }`
  - `listReportTickers(): Promise<string[]>` — lowercase tickers, sorted.
  - `loadReport(ticker: string): Promise<Report | null>` — case-insensitive; `null` when absent.
  - `listReports(): Promise<ReportSummary[]>` — sorted by `reportDate` descending.

- [ ] **Step 1: Write the failing tests**

Create `lib/reports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { listReportTickers, loadReport, listReports } from "@/lib/reports";

describe("listReportTickers", () => {
  it("finds the reference fixture", async () => {
    expect(await listReportTickers()).toContain("avgo");
  });
});

describe("loadReport", () => {
  it("loads and validates a report", async () => {
    const r = await loadReport("avgo");
    expect(r?.meta.ticker).toBe("AVGO");
  });

  it("is case-insensitive", async () => {
    expect((await loadReport("AVGO"))?.meta.ticker).toBe("AVGO");
  });

  it("returns null for an unknown ticker", async () => {
    expect(await loadReport("nosuchticker")).toBeNull();
  });

  it("refuses a path-traversal ticker", async () => {
    expect(await loadReport("../../etc/passwd")).toBeNull();
  });
});

describe("listReports", () => {
  it("summarises each report for the index", async () => {
    const summaries = await listReports();
    const avgo = summaries.find((s) => s.ticker === "AVGO");
    expect(avgo).toMatchObject({
      ticker: "AVGO",
      company: "Broadcom Inc.",
      exchange: "NASDAQ",
      currentPrice: 361.99,
    });
    expect(avgo?.rating.label).toBe("BUY");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/reports.test.ts
```

Expected: FAIL — cannot resolve `@/lib/reports`.

- [ ] **Step 3: Implement the loader**

Create `lib/reports.ts`:

```ts
/**
 * reports.ts — the only place the report archive is read from disk.
 * -----------------------------------------------------------------------------
 * Every read passes through Report.parse() and assertValidReport(), so a
 * malformed or internally inconsistent report fails the build rather than
 * rendering a broken page.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Report } from "./report.schema";
import { assertValidReport } from "./validate";

const DATA_DIR = path.join(process.cwd(), "data");
const TICKER_PATTERN = /^[a-z0-9.-]+$/;

export interface ReportSummary {
  ticker: string;
  company: string;
  exchange: string;
  subtitle: string;
  reportDate: string;
  rating: Report["rating"];
  currentPrice: number;
}

export async function listReportTickers(): Promise<string[]> {
  const entries = await readdir(DATA_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "").toLowerCase())
    .sort();
}

export async function loadReport(ticker: string): Promise<Report | null> {
  const slug = ticker.toLowerCase();
  if (!TICKER_PATTERN.test(slug)) return null;

  let raw: string;
  try {
    raw = await readFile(path.join(DATA_DIR, `${slug}.json`), "utf8");
  } catch {
    return null;
  }

  const report = Report.parse(JSON.parse(raw));
  assertValidReport(report, report.meta.ticker);
  return report;
}

export async function listReports(): Promise<ReportSummary[]> {
  const tickers = await listReportTickers();
  const reports = await Promise.all(tickers.map((t) => loadReport(t)));
  return reports
    .filter((r): r is Report => r !== null)
    .map((r) => ({
      ticker: r.meta.ticker,
      company: r.meta.company,
      exchange: r.meta.exchange,
      subtitle: r.meta.subtitle,
      reportDate: r.meta.reportDate,
      rating: r.rating,
      currentPrice: r.quote.currentPrice,
    }))
    .sort((a, b) => Date.parse(b.reportDate) - Date.parse(a.reportDate));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run lib/reports.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/reports.ts lib/reports.test.ts
git commit -m "feat: add report loading with validation at the filesystem boundary"
```

---

## Task 5: Restyled shadcn primitives

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/{table,card,badge,alert,separator,button}.tsx`
- Test: `components/ui/badge.test.tsx`

**Interfaces:**
- Consumes: the token layer from Task 2.
- Produces: `Table, TableHeader, TableBody, TableRow, TableHead, TableCell`; `Card, CardContent`; `Badge` with `variant` in `"bull" | "bear" | "accent" | "secondary"`; `Alert`; `Separator`; `Button`; `cn()`.

- [ ] **Step 1: Initialise shadcn and add the primitives**

```bash
npx --yes shadcn@latest init -d
npx --yes shadcn@latest add table card badge alert separator button
```

If `init` asks to overwrite `app/globals.css`, decline. The token layer from Task 2 is authoritative.

- [ ] **Step 2: Verify the token layer survived**

```bash
grep -c "font-display\|--bull" app/globals.css
```

Expected: at least 2. If the file was overwritten, restore it:

```bash
git checkout -- app/globals.css
```

- [ ] **Step 3: Restyle Table for the editorial look**

In `components/ui/table.tsx`, replace the `className` defaults so tables are dense, mono, and hairline-ruled. Set:

- `Table`: `"w-full caption-bottom border-collapse font-mono text-[12.5px]"`
- `TableHead`: `"border border-hairline border-t-0 border-b-2 border-b-ink px-2.5 py-1.5 text-right font-sans text-xs font-bold text-ink first:text-left"`
- `TableCell`: `"border border-hairline px-2.5 py-1.5 text-right first:text-left"`
- `TableRow`: `"even:bg-surface"`

Remove any `rounded-*`, `shadow-*`, and `hover:bg-muted/50` classes the generator emitted.

- [ ] **Step 4: Write the failing badge test**

Create `components/ui/badge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("carries the call through the variant", () => {
    render(<Badge variant="bull">BUY</Badge>);
    expect(screen.getByText("BUY").className).toContain("bg-bull");
  });

  it("supports the bear variant", () => {
    render(<Badge variant="bear">SELL</Badge>);
    expect(screen.getByText("SELL").className).toContain("bg-bear");
  });

  it("never rounds its corners", () => {
    render(<Badge variant="accent">HOLD</Badge>);
    expect(screen.getByText("HOLD").className).not.toMatch(/rounded-(?!none)/);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx vitest run components/ui/badge.test.tsx
```

Expected: FAIL — the generated `Badge` has no `bull` variant.

- [ ] **Step 6: Add the tone variants to Badge**

In `components/ui/badge.tsx`, replace the `variants.variant` map with:

```ts
variant: {
  bull: "bg-bull text-page",
  bear: "bg-bear text-page",
  accent: "bg-accent text-page",
  secondary: "bg-muted text-page",
},
```

Set `defaultVariants: { variant: "accent" }`, and strip `rounded-*` from the base class string.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx vitest run components/ui/badge.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add shadcn primitives restyled to the Forest & Linen tokens"
```

---

## Task 6: The Markdown subset

**Files:**
- Create: `components/report/Markdown.tsx` (moved from `files/Markdown.tsx`)
- Test: `components/report/Markdown.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<MD>{string}</MD>` for inline contexts; `<Markdown text={string} />` for block contexts.

- [ ] **Step 1: Move the file unchanged**

```bash
mkdir -p components/report
git mv files/Markdown.tsx components/report/Markdown.tsx
```

Update its import of nothing — it has no project imports. Confirm no changes are needed:

```bash
grep -n "import" components/report/Markdown.tsx
```

Expected: only `import React from "react";`.

- [ ] **Step 2: Write the failing tests**

Create `components/report/Markdown.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, MD } from "@/components/report/Markdown";

describe("MD (inline)", () => {
  it("renders bold", () => {
    const { container } = render(<MD>{"a **bold** word"}</MD>);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders a bullish span", () => {
    const { container } = render(<MD>{"growth of {+ +221% YoY +} here"}</MD>);
    const span = container.querySelector("span.pos");
    expect(span?.textContent).toBe(" +221% YoY ");
  });

  it("renders a bearish span", () => {
    const { container } = render(<MD>{"a {- -3.3% -} decline"}</MD>);
    expect(container.querySelector("span.neg")?.textContent).toBe(" -3.3% ");
  });

  it("returns null for null input", () => {
    const { container } = render(<div><MD>{null}</MD></div>);
    expect(container.firstChild?.textContent).toBe("");
  });
});

describe("Markdown (block)", () => {
  it("splits blank lines into paragraphs", () => {
    const { container } = render(<Markdown text={"one\n\ntwo"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders a bullet block as a list", () => {
    const { container } = render(<Markdown text={"- alpha\n- beta"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders sub-headings", () => {
    render(<Markdown text={"### Heading"} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Heading");
  });

  it("joins soft line breaks inside a paragraph", () => {
    const { container } = render(<Markdown text={"one\ntwo"} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("one two");
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

```bash
npx vitest run components/report/Markdown.test.tsx
```

Expected: PASS, 8 tests. The component was already correct; these tests lock its behaviour before anything depends on it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: lock the Markdown subset behaviour and move it into components/report"
```

---

## Task 7: Chart geometry

**Files:**
- Create: `components/chart/types.ts`, `components/chart/geometry.ts`
- Test: `components/chart/geometry.test.ts`

**Interfaces:**
- Consumes: `Report` from `@/lib/report.schema`; `pct`, `upside` from `@/lib/format`.
- Produces: everything in `types.ts` below, plus `buildChartModel`, `chartDims`, `niceStep`, `computeScales`, `buildLabelRows`, `declutterLabels`, `historySeries`.

**Note on dimensions.** `editorial-hairline-design.md` specifies a top margin of 100. The prototype uses 132 because its header type is larger than the doc's mock-up assumed, and 100 would collide with the meta line at y=109. The prototype's proven values are used here.

- [ ] **Step 1: Define the types**

Create `components/chart/types.ts`:

```ts
export type Tone = "bull" | "accent" | "secondary" | "bear";
export type ChartLayout = "wide" | "narrow";

export interface ChartTarget {
  key: string;
  name: string;
  value: number;
  tone: Tone;
}

export interface ChartModel {
  company: string;
  exchange: string;
  ticker: string;
  asOf: string;
  current: number;
  bandLo: number;
  bandHi: number;
  bandPctText: string;
  targets: ChartTarget[];
}

export interface ChartDims {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** x of the right-margin label column; null when the layout has none. */
  labelX: number | null;
}

export interface ChartScales {
  x: (day: number) => number;
  y: (price: number) => number;
  gridValues: number[];
  nowX: number;
  curY: number;
  yMin: number;
  yMax: number;
}

export interface LabelRow {
  key: string;
  name: string;
  value: string;
  tone: Tone;
  /** y of the true price on the axis — where the leader line starts. */
  anchorY: number;
  /** y the label is drawn at after decluttering. */
  labelY: number;
}

export interface HistoryPoint { day: number; price: number }

export interface HistorySeries {
  points: HistoryPoint[];
  /** True while the series is synthetic. Surfaced as a caption in the report. */
  placeholder: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

Create `components/chart/geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildChartModel, chartDims, niceStep, computeScales,
  buildLabelRows, declutterLabels, historySeries, MIN_LABEL_GAP,
} from "@/components/chart/geometry";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const report = Report.parse(avgo);
const model = buildChartModel(report);

describe("buildChartModel", () => {
  it("derives every input from the contract's facts", () => {
    expect(model.current).toBe(361.99);
    expect(model.bandLo).toBe(440);
    expect(model.bandHi).toBe(525);
    expect(model.ticker).toBe("AVGO");
  });

  it("derives the band caption rather than storing it", () => {
    expect(model.bandPctText).toBe("+21.6% to +45.0%");
  });

  it("orders targets high, median, consensus, low with their tones", () => {
    expect(model.targets.map((t) => [t.key, t.value, t.tone])).toEqual([
      ["high", 600, "bull"],
      ["median", 517.5, "accent"],
      ["consensus", 509.61, "secondary"],
      ["low", 350, "bear"],
    ]);
  });
});

describe("niceStep", () => {
  it("snaps to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceStep(12)).toBe(10);
    expect(niceStep(23)).toBe(20);
    expect(niceStep(61)).toBe(50);
    expect(niceStep(88)).toBe(100);
  });
});

describe("chartDims", () => {
  it("gives the wide layout a right-margin label column", () => {
    const d = chartDims("wide");
    expect(d.width).toBe(960);
    expect(d.labelX).toBe(758);
  });

  it("drops the label column in the narrow layout and widens the plot", () => {
    const wide = chartDims("wide");
    const narrow = chartDims("narrow");
    expect(narrow.labelX).toBeNull();
    const wideFrac = (wide.plotRight - wide.plotLeft) / wide.width;
    const narrowFrac = (narrow.plotRight - narrow.plotLeft) / narrow.width;
    expect(narrowFrac).toBeGreaterThan(wideFrac);
  });
});

describe("computeScales", () => {
  const scales = computeScales(model, chartDims("wide"));

  it("maps the current price onto curY", () => {
    expect(scales.y(model.current)).toBeCloseTo(scales.curY, 6);
  });

  it("places Now at day zero", () => {
    expect(scales.x(0)).toBeCloseTo(scales.nowX, 6);
  });

  it("pads the domain beyond the extreme targets", () => {
    expect(scales.yMin).toBeLessThan(350);
    expect(scales.yMax).toBeGreaterThan(600);
  });

  it("puts every gridline inside the domain", () => {
    for (const v of scales.gridValues) {
      expect(v).toBeGreaterThanOrEqual(scales.yMin);
      expect(v).toBeLessThanOrEqual(scales.yMax);
    }
  });

  it("inverts y so higher prices sit higher on the canvas", () => {
    expect(scales.y(600)).toBeLessThan(scales.y(350));
  });
});

describe("declutterLabels", () => {
  const scales = computeScales(model, chartDims("wide"));
  const rows = declutterLabels(buildLabelRows(model, scales), MIN_LABEL_GAP);

  it("enforces the minimum gap between every adjacent pair", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].labelY - rows[i - 1].labelY).toBeGreaterThanOrEqual(MIN_LABEL_GAP - 1e-9);
    }
  });

  it("separates the near-colliding median and consensus pair", () => {
    const median = rows.find((r) => r.key === "median")!;
    const consensus = rows.find((r) => r.key === "consensus")!;
    expect(Math.abs(median.anchorY - consensus.anchorY)).toBeLessThan(MIN_LABEL_GAP);
    expect(Math.abs(median.labelY - consensus.labelY)).toBeGreaterThanOrEqual(MIN_LABEL_GAP - 1e-9);
  });

  it("keeps the anchor at the true price so leaders stay accurate", () => {
    const high = rows.find((r) => r.key === "high")!;
    expect(high.anchorY).toBeCloseTo(scales.y(600), 6);
  });

  it("includes the current price as a muted row", () => {
    const current = rows.find((r) => r.key === "current")!;
    expect(current.tone).toBe("secondary");
    expect(current.value).toBe("$361.99");
  });

  it("formats target values with signed upside", () => {
    expect(rows.find((r) => r.key === "high")!.value).toBe("$600.00  +65.8%");
  });
});

describe("historySeries", () => {
  const series = historySeries(361.99, 30);

  it("is marked as a placeholder until real closes are wired", () => {
    expect(series.placeholder).toBe(true);
  });

  it("spans the requested window and lands exactly on the current price", () => {
    expect(series.points).toHaveLength(31);
    expect(series.points[0].day).toBe(-30);
    expect(series.points.at(-1)).toEqual({ day: 0, price: 361.99 });
  });

  it("is deterministic", () => {
    expect(historySeries(361.99, 30)).toEqual(series);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run components/chart/geometry.test.ts
```

Expected: FAIL — cannot resolve `@/components/chart/geometry`.

- [ ] **Step 4: Implement the geometry**

Create `components/chart/geometry.ts`:

```ts
/**
 * geometry.ts — all chart math, as pure functions.
 * -----------------------------------------------------------------------------
 * These take numbers and return numbers. Nothing here touches React, the DOM,
 * or colour: ProjectionChart maps this output to JSX and computes nothing.
 *
 * That split is what lets the chart render server-side, which the PDF subsystem
 * depends on, and what makes the declutter algorithm directly testable.
 */
import { scaleLinear } from "d3-scale";
import type { Report } from "@/lib/report.schema";
import { pct, upside, usd } from "@/lib/format";
import type {
  ChartDims, ChartLayout, ChartModel, ChartScales, HistorySeries, LabelRow,
} from "./types";

/** Minimum vertical gap between label rows, per editorial-hairline-design.md. */
export const MIN_LABEL_GAP = 28;

const HISTORY_DAYS = 30;
const HORIZON_DAYS = 365;

export function buildChartModel(r: Report): ChartModel {
  const current = r.quote.currentPrice;
  const s = r.analystSentiment;
  return {
    company: r.meta.company,
    exchange: r.meta.exchange,
    ticker: r.meta.ticker,
    asOf: r.meta.asOf,
    current,
    bandLo: r.rating.targetLow,
    bandHi: r.rating.targetHigh,
    bandPctText:
      `${pct(upside(r.rating.targetLow, current), { signed: true })} to ` +
      `${pct(upside(r.rating.targetHigh, current), { signed: true })}`,
    targets: [
      { key: "high", name: "High target", value: s.highTarget, tone: "bull" },
      { key: "median", name: "Median target", value: s.medianTarget, tone: "accent" },
      { key: "consensus", name: "Consensus target", value: s.consensusTarget, tone: "secondary" },
      { key: "low", name: "Low target", value: s.lowTarget, tone: "bear" },
    ],
  };
}

export function chartDims(layout: ChartLayout): ChartDims {
  if (layout === "narrow") {
    return {
      width: 640, height: 420,
      plotLeft: 52, plotRight: 620, plotTop: 120, plotBottom: 360,
      labelX: null,
    };
  }
  return {
    width: 960, height: 480,
    plotLeft: 66, plotRight: 750, plotTop: 132, plotBottom: 440,
    labelX: 758,
  };
}

export function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return s * pow;
}

export function computeScales(model: ChartModel, dims: ChartDims): ChartScales {
  const values = [
    model.current, model.bandLo, model.bandHi,
    ...model.targets.map((t) => t.value),
  ];
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const pad = (yMax - yMin) * 0.12 || 10;
  yMin -= pad;
  yMax += pad;

  const x = scaleLinear()
    .domain([-HISTORY_DAYS, HORIZON_DAYS])
    .range([dims.plotLeft, dims.plotRight]);
  const y = scaleLinear()
    .domain([yMin, yMax])
    .range([dims.plotBottom, dims.plotTop]);

  const step = niceStep((yMax - yMin) / 5);
  const gridValues: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    gridValues.push(v);
  }

  return {
    x: (day) => x(day), y: (price) => y(price),
    gridValues, nowX: x(0), curY: y(model.current), yMin, yMax,
  };
}

export function buildLabelRows(model: ChartModel, scales: ChartScales): LabelRow[] {
  const rows: LabelRow[] = model.targets.map((t) => ({
    key: t.key,
    name: t.name,
    value: `${usd(t.value)}  ${pct(upside(t.value, model.current), { signed: true })}`,
    tone: t.tone,
    anchorY: scales.y(t.value),
    labelY: scales.y(t.value),
  }));
  rows.push({
    key: "current",
    name: "Current",
    value: usd(model.current),
    tone: "secondary",
    anchorY: scales.curY,
    labelY: scales.curY,
  });
  return rows;
}

/**
 * Desired y is each row's true price. Sort top to bottom, then push any row that
 * sits closer than minGap down to exactly minGap below its predecessor. anchorY
 * is never moved, so the leader line still points at the real price.
 */
export function declutterLabels(rows: LabelRow[], minGap: number): LabelRow[] {
  const sorted = [...rows].sort((a, b) => a.anchorY - b.anchorY);
  const out: LabelRow[] = [];
  for (const row of sorted) {
    const previous = out[out.length - 1];
    const labelY = previous && row.labelY - previous.labelY < minGap
      ? previous.labelY + minGap
      : row.labelY;
    out.push({ ...row, labelY });
  }
  return out;
}

/**
 * PLACEHOLDER. A deterministic wave that terminates exactly on the current
 * price. Swap the body for real daily closes (FMP historical-price-eod-light,
 * trailing ~30 days) and set placeholder to false — no caller changes.
 */
export function historySeries(current: number, days = HISTORY_DAYS): HistorySeries {
  const points = Array.from({ length: days + 1 }, (_, i) => ({
    day: -days + i,
    price: current + 6 * Math.sin(i / 4.3) + 3 * Math.cos(i / 2) - 0.1 * (days - i),
  }));
  points[points.length - 1] = { day: 0, price: current };
  return { points, placeholder: true };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run components/chart/geometry.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add components/chart lib
git commit -m "feat: add pure chart geometry with label decluttering"
```

---

## Task 8: The projection chart

**Files:**
- Create: `components/chart/ProjectionChart.tsx`
- Test: `components/chart/ProjectionChart.test.tsx`
- Delete: `files/ProjectionChart.tsx`

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: `<ProjectionChart model={ChartModel} layout={ChartLayout} />`, a synchronous Server Component returning `<svg>`.

- [ ] **Step 1: Write the failing tests**

Create `components/chart/ProjectionChart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProjectionChart } from "@/components/chart/ProjectionChart";
import { buildChartModel } from "@/components/chart/geometry";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const model = buildChartModel(Report.parse(avgo));
const renderWide = () => render(<ProjectionChart model={model} layout="wide" />);

describe("ProjectionChart", () => {
  it("renders synchronously into markup, with no hydration required", () => {
    const { container } = renderWide();
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 960 480");
    expect(svg!.querySelectorAll("*").length).toBeGreaterThan(30);
  });

  it("takes colour from CSS variables so one SVG serves both themes", () => {
    const { container } = renderWide();
    const markup = container.innerHTML;
    expect(markup).toContain("var(--bull)");
    expect(markup).toContain("var(--bear)");
    expect(markup).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("labels every target and the current price", () => {
    const { container } = renderWide();
    const text = container.textContent ?? "";
    for (const label of ["High target", "Median target", "Consensus target", "Low target", "Current"]) {
      expect(text).toContain(label);
    }
  });

  it("captions the Juniper band with its derived range", () => {
    expect(renderWide().container.textContent).toContain("+21.6% to +45.0%");
  });

  it("draws one dashed ray per target", () => {
    const { container } = renderWide();
    expect(container.querySelectorAll("line[data-role='target-ray']")).toHaveLength(4);
  });

  it("omits the label column in the narrow layout", () => {
    const { container } = render(<ProjectionChart model={model} layout="narrow" />);
    expect(container.querySelectorAll("polyline[data-role='leader']")).toHaveLength(0);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 640 420");
  });

  it("renders the header rows left-aligned to the plot edge", () => {
    const text = renderWide().container.textContent ?? "";
    expect(text).toContain("EQUITY RESEARCH");
    expect(text).toContain("Broadcom Inc. · NASDAQ: AVGO");
    expect(text).toContain("as of Sep 11, 2026");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run components/chart/ProjectionChart.test.tsx
```

Expected: FAIL — cannot resolve `@/components/chart/ProjectionChart`.

- [ ] **Step 3: Implement the chart**

Create `components/chart/ProjectionChart.tsx`:

```tsx
/**
 * ProjectionChart.tsx — the Editorial Hairline 1-year projection.
 * -----------------------------------------------------------------------------
 * A synchronous Server Component. It maps geometry.ts output to JSX and computes
 * nothing itself. Colour is emitted as var(--token), so one rendered SVG serves
 * both themes and the browser resolves the values.
 */
import { line, curveMonotoneX } from "d3-shape";
import {
  chartDims, computeScales, buildLabelRows, declutterLabels, historySeries,
  MIN_LABEL_GAP,
} from "./geometry";
import type { ChartLayout, ChartModel, Tone } from "./types";

const v = (tone: Tone) => `var(--${tone === "secondary" ? "muted" : tone})`;

const X_TICKS: [number, string][] = [
  [-30, "−1M"], [0, "Now"], [91, "+3M"], [182, "+6M"], [273, "+9M"], [365, "+1Y"],
];

export function ProjectionChart({
  model, layout = "wide",
}: { model: ChartModel; layout?: ChartLayout }) {
  const dims = chartDims(layout);
  const scales = computeScales(model, dims);
  const { plotLeft: PL, plotRight: PR, plotTop: PT, plotBottom: PB, labelX } = dims;
  const { nowX, curY } = scales;

  const bandTop = scales.y(model.bandHi);
  const bandBottom = scales.y(model.bandLo);
  const history = historySeries(model.current);
  const gradientId = `band-${model.ticker.toLowerCase()}-${layout}`;

  const path = line<{ day: number; price: number }>()
    .x((p) => scales.x(p.day))
    .y((p) => scales.y(p.price))
    .curve(curveMonotoneX)(history.points) ?? "";

  const rows = declutterLabels(buildLabelRows(model, scales), MIN_LABEL_GAP);
  const bandCaptionX = scales.x(66);
  const bandMidY = (bandTop + bandBottom) / 2;

  return (
    <svg
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`One-year price projection for ${model.company}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--bull)" stopOpacity={0.1} />
          <stop offset="1" stopColor="var(--bull)" stopOpacity={0.06} />
        </linearGradient>
      </defs>

      <rect x={0.5} y={0.5} width={dims.width - 1} height={dims.height - 1}
        fill="var(--surface)" stroke="var(--hairline)" strokeWidth={1} />

      <text x={PL} y={40} fill="var(--accent)" fontFamily="var(--font-sans)"
        fontSize={15} fontWeight={600} letterSpacing={3}>EQUITY RESEARCH</text>
      <text x={PL} y={83} fill="var(--ink)" fontFamily="var(--font-display)"
        fontSize={40} fontWeight={600}>
        {model.company} · {model.exchange}: {model.ticker}
      </text>
      <text x={PL} y={109} fill="var(--muted)" fontFamily="var(--font-mono)" fontSize={14.5}>
        1-Year price projection · as of {model.asOf} · current ${model.current.toFixed(2)}
      </text>

      {scales.gridValues.map((value) => (
        <g key={value}>
          <line x1={PL} x2={PR} y1={scales.y(value)} y2={scales.y(value)}
            stroke="var(--hairline)" strokeWidth={1} strokeDasharray="1 4" />
          <text x={PL - 8} y={scales.y(value) + 4} textAnchor="end" fill="var(--muted)"
            fontFamily="var(--font-mono)" fontSize={13}>{value}</text>
        </g>
      ))}

      <rect x={nowX} y={bandTop} width={PR - nowX} height={bandBottom - bandTop}
        fill={`url(#${gradientId})`} />
      {[bandTop, bandBottom].map((y) => (
        <line key={y} x1={nowX} x2={PR} y1={y} y2={y} stroke="var(--bull)"
          strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
      ))}

      <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1.3} />

      <line x1={nowX} x2={nowX} y1={PT} y2={PB} stroke="var(--muted)"
        strokeWidth={1} strokeDasharray="2 4" opacity={0.5} />
      <line x1={PL} x2={PR} y1={PB} y2={PB} stroke="var(--ink)" strokeWidth={1} opacity={0.55} />
      {X_TICKS.map(([day, label]) => (
        <g key={label}>
          <line x1={scales.x(day)} x2={scales.x(day)} y1={PB} y2={PB + 5}
            stroke="var(--muted)" strokeWidth={1} />
          <text x={scales.x(day)} y={PB + 21} textAnchor="middle" fill="var(--muted)"
            fontFamily="var(--font-mono)" fontSize={13}>{label}</text>
        </g>
      ))}

      {model.targets.map((t) => (
        <line key={t.key} data-role="target-ray"
          x1={nowX} y1={curY} x2={PR} y2={scales.y(t.value)}
          stroke={v(t.tone)} strokeWidth={1.4} strokeDasharray="5 5" />
      ))}

      <circle cx={nowX} cy={curY} r={5} fill="var(--surface)" />
      <circle cx={nowX} cy={curY} r={3} fill="var(--ink)" />

      <g>
        <rect x={bandCaptionX - 94} y={bandMidY - 21} width={188} height={34}
          fill="var(--page)" stroke="var(--bull)" strokeWidth={1} />
        <text x={bandCaptionX} y={bandMidY - 4} textAnchor="middle" fill="var(--bull)"
          fontFamily="var(--font-sans)" fontSize={13} fontWeight={700}>
          Juniper target {model.bandLo}–{model.bandHi}
        </text>
        <text x={bandCaptionX} y={bandMidY + 11} textAnchor="middle" fill="var(--bull)"
          fontFamily="var(--font-mono)" fontSize={10}>{model.bandPctText}</text>
      </g>

      {labelX !== null && rows.map((r) => (
        <g key={r.key}>
          <polyline data-role="leader"
            points={`${PR},${r.anchorY} ${PR + 6},${r.anchorY} ${labelX - 4},${r.labelY} ${labelX},${r.labelY}`}
            fill="none" stroke={v(r.tone)} strokeWidth={1} opacity={0.65} />
          <rect x={labelX} y={r.labelY - 16} width={9} height={9} fill={v(r.tone)} />
          <text x={labelX + 15} y={r.labelY - 7} fill="var(--ink)"
            fontFamily="var(--font-sans)" fontSize={14.5} fontWeight={600}>{r.name}</text>
          <text x={labelX + 15} y={r.labelY + 9} fill={v(r.tone)}
            fontFamily="var(--font-mono)" fontSize={12.5}>{r.value}</text>
        </g>
      ))}

      {labelX === null && rows.map((r, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const lx = PL + col * ((PR - PL) / 2), ly = PB + 44 + row * 20;
        return (
          <g key={r.key}>
            <rect x={lx} y={ly - 9} width={9} height={9} fill={v(r.tone)} />
            <text x={lx + 14} y={ly} fill="var(--ink)" fontFamily="var(--font-sans)"
              fontSize={11} fontWeight={600}>{r.name}</text>
            <text x={lx + 14} y={ly + 13} fill={v(r.tone)} fontFamily="var(--font-mono)"
              fontSize={10}>{r.value}</text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run components/chart/ProjectionChart.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Delete the superseded prototype**

```bash
git rm files/ProjectionChart.tsx
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: render the Editorial Hairline chart as server-side JSX SVG"
```

---

## Task 9: Report primitives

**Files:**
- Create: `components/report/{ReportHeader,Snapshot,RatingBlock,FinTable,ScenarioTable,Callout,Section,Src}.tsx`
- Test: `components/report/primitives.test.tsx`

**Interfaces:**
- Consumes: `formatCell`, `formatSnapshot`, `usd`, `pct`, `priceTargetLine`, `upsideRangeText`, `computeScenarios` from `@/lib/format`; the shadcn primitives from Task 5; `MD` from Task 6.
- Produces:
  - `<ReportHeader meta={Report["meta"]} />`
  - `<Snapshot cells={SnapshotCellData[]} />`
  - `<RatingBlock rating={Report["rating"]} current={number} upsideLabel={string} />`
  - `<FinTable table={FinancialTable} />`
  - `<ScenarioTable scenarios={Report["sections"]["valuation"]["scenarios"]} />`
  - `<Callout label={string} body={string} />`
  - `<Section title={string}>{children}</Section>`
  - `<Src>{children}</Src>`

- [ ] **Step 1: Write the failing tests**

Create `components/report/primitives.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Snapshot } from "@/components/report/Snapshot";
import { RatingBlock } from "@/components/report/RatingBlock";
import { FinTable } from "@/components/report/FinTable";
import { ScenarioTable } from "@/components/report/ScenarioTable";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const report = Report.parse(avgo);

describe("Snapshot", () => {
  it("formats every cell through format.ts", () => {
    render(<Snapshot cells={report.snapshot} />);
    expect(screen.getByText("~$1.72T")).toBeInTheDocument();
    expect(screen.getByText("$509.61 (+40.8%)")).toBeInTheDocument();
    expect(screen.getByText("68% (record)")).toBeInTheDocument();
  });

  it("lays cells out two pairs to a row", () => {
    const { container } = render(<Snapshot cells={report.snapshot} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(
      Math.ceil(report.snapshot.length / 2),
    );
  });
});

describe("RatingBlock", () => {
  it("shows the call, the target line and the derived upside", () => {
    render(<RatingBlock rating={report.rating} current={361.99} upsideLabel="Upside Potential:" />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("Price Target: $440.00 – $525.00")).toBeInTheDocument();
    expect(screen.getByText(/\+21\.6% to \+45\.0%/)).toBeInTheDocument();
  });

  it("colours the badge from the rating tone", () => {
    render(<RatingBlock rating={report.rating} current={361.99} upsideLabel="Upside:" />);
    expect(screen.getByText("BUY").className).toContain("bg-bull");
  });
});

describe("FinTable", () => {
  it("formats numeric cells by the row's format", () => {
    render(<FinTable table={report.sections.financials.income} />);
    expect(screen.getByText("63.9")).toBeInTheDocument();
  });

  it("renders every column header", () => {
    render(<FinTable table={report.sections.financials.income} />);
    for (const c of report.sections.financials.income.columns) {
      expect(screen.getByText(c)).toBeInTheDocument();
    }
  });
});

describe("ScenarioTable", () => {
  it("derives the weighted column and the fair value row", () => {
    render(<ScenarioTable scenarios={report.sections.valuation.scenarios} />);
    expect(screen.getByText("$180.00")).toBeInTheDocument();
    expect(screen.getByText("Probability-Weighted Fair Value")).toBeInTheDocument();
    expect(screen.getByText("$485.00")).toBeInTheDocument();
  });

  it("shows probabilities as whole percentages", () => {
    render(<ScenarioTable scenarios={report.sections.valuation.scenarios} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run components/report/primitives.test.tsx
```

Expected: FAIL — cannot resolve the primitive modules.

- [ ] **Step 3: Implement Snapshot**

Create `components/report/Snapshot.tsx`:

```tsx
import { formatSnapshot } from "@/lib/format";
import type { SnapshotCellData } from "@/lib/report.schema";

export function Snapshot({ cells }: { cells: SnapshotCellData[] }) {
  const rows: (SnapshotCellData | undefined)[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i], cells[i + 1]]);
  return (
    <table className="my-2 w-full border-collapse font-mono">
      <tbody>
        {rows.map((pair, i) => (
          <tr key={i}>
            {pair.map((cell, j) => (
              <Fragment key={j}>
                <td className="w-[22%] border-b border-hairline py-1.5 pr-2.5 text-left font-sans text-[12.5px] text-muted">
                  {cell?.label ?? ""}
                </td>
                <td className="w-[28%] border-b border-hairline py-1.5 pr-2.5 text-left text-[13px] font-bold text-ink">
                  {cell ? formatSnapshot(cell) : ""}
                </td>
              </Fragment>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Add `import { Fragment } from "react";` at the top.

- [ ] **Step 4: Implement RatingBlock**

Create `components/report/RatingBlock.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { priceTargetLine, upsideRangeText } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

export function RatingBlock({
  rating, current, upsideLabel,
}: { rating: Report["rating"]; current: number; upsideLabel: string }) {
  return (
    <div className="my-4 flex">
      <Badge
        variant={rating.tone}
        className="flex w-[34%] items-center justify-center p-3.5 font-sans text-[26px] font-extrabold tracking-[2px]"
      >
        {rating.label}
      </Badge>
      <div className="flex w-[66%] flex-col">
        <div className="flex flex-1 items-center border border-l-0 border-hairline bg-surface px-4 py-3 text-[15px] font-bold text-ink">
          {priceTargetLine(rating.targetLow, rating.targetHigh)}
        </div>
        <div className="flex flex-1 items-center border border-t-0 border-l-0 border-hairline bg-surface px-4 py-3 text-[15px] font-bold text-ink">
          {upsideLabel} {upsideRangeText(rating.targetLow, rating.targetHigh, current)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement FinTable**

Create `components/report/FinTable.tsx`:

```tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCell } from "@/lib/format";
import type { FinancialTable } from "@/lib/report.schema";

export function FinTable({ table }: { table: FinancialTable }) {
  const emphasize = table.rows.some((r) => r.emphasize);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Table>
        <TableHeader>
          <TableRow>
            {table.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, i) => (
            <TableRow
              key={row.label}
              className={emphasize && i === table.rows.length - 1 ? "font-bold" : undefined}
            >
              <TableCell>{row.label}</TableCell>
              {row.values.map((v, j) => (
                <TableCell key={j}>{formatCell(v, row.format)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: Implement ScenarioTable**

Create `components/report/ScenarioTable.tsx`:

```tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MD } from "./Markdown";
import { computeScenarios, pct, usd } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

type Scenarios = Report["sections"]["valuation"]["scenarios"];

export function ScenarioTable({ scenarios }: { scenarios: Scenarios }) {
  const { rows, fairValue } = computeScenarios(scenarios);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Table>
        <TableHeader>
          <TableRow>
            {["Scenario", "Driver", "Implied Price", "Prob.", "Weighted"].map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              <TableCell>{r.name}</TableCell>
              <TableCell><MD>{r.driver}</MD></TableCell>
              <TableCell>{usd(r.impliedPrice, 0)}</TableCell>
              <TableCell>{pct(r.probability, { dp: 0 })}</TableCell>
              <TableCell>{usd(r.weighted)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell>Probability-Weighted Fair Value</TableCell>
            <TableCell /><TableCell /><TableCell />
            <TableCell>{usd(fairValue)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 7: Implement the remaining primitives**

Create `components/report/ReportHeader.tsx`:

```tsx
import type { Report } from "@/lib/report.schema";

export function ReportHeader({ meta }: { meta: Report["meta"] }) {
  return (
    <header>
      <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">
        EQUITY RESEARCH
      </div>
      <h1 className="mt-1.5 mb-0.5 text-center font-display text-[42px] leading-[1.08] font-semibold text-ink">
        {meta.company} ({meta.exchange}: {meta.ticker})
      </h1>
      <div className="mb-3.5 text-center font-display text-[21px] italic text-muted">
        {meta.subtitle}
      </div>
      <hr className="my-3.5 border-0 border-t border-accent" />
    </header>
  );
}
```

Create `components/report/Section.tsx`:

```tsx
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mt-7 mb-2.5 border-b border-accent pb-1 font-sans text-[19px] font-bold text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}
```

Create `components/report/Src.tsx`:

```tsx
export function Src({ children }: { children: React.ReactNode }) {
  return <div className="mt-0.5 mb-3 font-sans text-[11px] italic text-muted">{children}</div>;
}
```

Create `components/report/Callout.tsx`:

```tsx
import { MD } from "./Markdown";

export function Callout({ label, body }: { label: string; body: string }) {
  return (
    <div className="my-3 border border-hairline bg-surface px-4 py-3">
      <span className="font-bold">Investment Thesis — {label}.</span>{" "}
      <MD>{body}</MD>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run components/report/primitives.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add components/report
git commit -m "feat: add the report presentational primitives"
```

---

## Task 10: Sections and the composition root

**Files:**
- Create: `components/report/sections/Section{1..8}.tsx`, `components/report/sections/AnalystSentiment.tsx`
- Create: `components/report/EquityReport.tsx`
- Test: `components/report/EquityReport.test.tsx`
- Delete: `files/EquityReport.tsx`

**Interfaces:**
- Consumes: every primitive from Task 9, `ProjectionChart` and `buildChartModel` from Tasks 7–8.
- Produces: `<EquityReport data={Report} />`, synchronous.

- [ ] **Step 1: Write the failing test**

Create `components/report/EquityReport.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EquityReport from "@/components/report/EquityReport";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const report = Report.parse(avgo);

describe("EquityReport", () => {
  it("renders the whole report without throwing", () => {
    expect(() => render(<EquityReport data={report} />)).not.toThrow();
  });

  it("renders all eight numbered sections plus the sentiment summary", () => {
    render(<EquityReport data={report} />);
    for (const title of [
      "1. Executive Summary",
      "2. Financial Performance & Health",
      "3. Valuation",
      "4. Business Model & Competitive Moat",
      "5. Growth Strategy & Future Outlook",
      "6. Management & Governance",
      "7. Risk Analysis",
      "Analyst Sentiment Summary",
      "8. Final Recommendation",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("renders the chart once per layout", () => {
    const { container } = render(<EquityReport data={report} />);
    expect(container.querySelectorAll("svg[role='img']")).toHaveLength(2);
  });

  it("captions the placeholder history line", () => {
    render(<EquityReport data={report} />);
    expect(screen.getByText(/history line is indicative/i)).toBeInTheDocument();
  });

  it("falls back to the default disclaimer when none is supplied", () => {
    const stripped = { ...report, disclaimer: undefined };
    render(<EquityReport data={stripped} />);
    expect(screen.getByText(/does not constitute investment advice/i)).toBeInTheDocument();
  });

  it("shows the derived implied upside to consensus", () => {
    render(<EquityReport data={report} />);
    expect(screen.getAllByText("+40.8%").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run components/report/EquityReport.test.tsx
```

Expected: FAIL — cannot resolve `@/components/report/EquityReport`.

- [ ] **Step 3: Implement sections 1 through 3**

Create `components/report/sections/Section1.tsx`:

```tsx
import { Markdown, MD } from "../Markdown";
import { Callout } from "../Callout";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section1({ data }: { data: Report["sections"]["executiveSummary"] }) {
  return (
    <Section title="1. Executive Summary">
      <h3>Company Overview</h3>
      <Markdown text={data.companyOverview} />
      <Callout label={data.thesis.label} body={data.thesis.body} />
      <h3>Key Positive Catalysts</h3>
      <ul>{data.catalysts.map((c, i) => <li key={i}><MD>{c}</MD></li>)}</ul>
      <h3>Major Risks</h3>
      <ul>{data.risks.map((r, i) => <li key={i}><MD>{r}</MD></li>)}</ul>
    </Section>
  );
}
```

Create `components/report/sections/Section2.tsx`:

```tsx
import { Markdown, MD } from "../Markdown";
import { FinTable } from "../FinTable";
import { Section } from "../Section";
import { Src } from "../Src";
import type { Report } from "@/lib/report.schema";

export function Section2({ data }: { data: Report["sections"]["financials"] }) {
  const blocks = [
    { title: "2.1 Income Statement Analysis", table: data.income, commentary: data.incomeCommentary },
    { title: "2.2 Balance Sheet Analysis", table: data.balance, commentary: data.balanceCommentary },
    { title: "2.3 Cash Flow Analysis", table: data.cashflow, commentary: data.cashflowCommentary },
  ];
  return (
    <Section title="2. Financial Performance & Health">
      {blocks.map((b) => (
        <div key={b.title}>
          <h3>{b.title}</h3>
          <FinTable table={b.table} />
          {b.table.note && <Src><MD>{b.table.note}</MD></Src>}
          <Markdown text={b.commentary} />
        </div>
      ))}
    </Section>
  );
}
```

Create `components/report/sections/Section3.tsx`:

```tsx
import { Markdown, MD } from "../Markdown";
import { FinTable } from "../FinTable";
import { ScenarioTable } from "../ScenarioTable";
import { Section } from "../Section";
import { Src } from "../Src";
import type { Report } from "@/lib/report.schema";

export function Section3({ data }: { data: Report["sections"]["valuation"] }) {
  return (
    <Section title="3. Valuation">
      <h3>3.1 Multiples Analysis</h3>
      <FinTable table={data.multiples} />
      {data.multiples.note && <Src><MD>{data.multiples.note}</MD></Src>}
      <Markdown text={data.multiplesCommentary} />
      <h3>3.2 Scenario Summary</h3>
      <ScenarioTable scenarios={data.scenarios} />
      <Markdown text={data.scenarioCommentary} />
    </Section>
  );
}
```

- [ ] **Step 4: Implement sections 4 through 8 and the sentiment summary**

Create `components/report/sections/Section4.tsx`:

```tsx
import { Markdown, MD } from "../Markdown";
import { Section } from "../Section";
import { compactUSD, pct } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

export function Section4({ data }: { data: Report["sections"]["businessMoat"] }) {
  const geoLine =
    `By geography${data.geographyBasis ? ` (${data.geographyBasis})` : ""}: ` +
    data.geoMix.map((g) => `${g.region} ~${pct(g.sharePct, { dp: 0 })}`).join(", ") + ".";
  return (
    <Section title="4. Business Model & Competitive Moat">
      <h3>Business Segments{data.segmentsBasis ? ` (${data.segmentsBasis})` : ""}</h3>
      <ul>
        {data.segments.map((s) => (
          <li key={s.name}>
            <strong>{s.name} (~{pct(s.sharePct, { dp: 0 })}, {compactUSD(s.revenue)}):</strong>{" "}
            <MD>{s.body}</MD>
          </li>
        ))}
      </ul>
      <p className="font-sans text-[11px] italic text-muted">{geoLine}</p>
      <h3>Economic Moat: {data.moatRating}</h3>
      <ul>
        {data.moatFactors.map((f) => (
          <li key={f.name}><strong>{f.name} ({f.strength}):</strong> <MD>{f.body}</MD></li>
        ))}
      </ul>
      <Markdown text={data.durability} />
    </Section>
  );
}
```

Create `components/report/sections/Section5.tsx`:

```tsx
import { MD } from "../Markdown";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section5({ data }: { data: Report["sections"]["growth"] }) {
  return (
    <Section title="5. Growth Strategy & Future Outlook">
      <ul>{data.points.map((p, i) => <li key={i}><MD>{p}</MD></li>)}</ul>
    </Section>
  );
}
```

Create `components/report/sections/Section6.tsx`:

```tsx
import { Markdown } from "../Markdown";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section6({ data }: { data: Report["sections"]["management"] }) {
  return (
    <Section title="6. Management & Governance">
      <Markdown text={data.leadership} />
      <Markdown text={data.capitalAllocation} />
      <Markdown text={data.governance} />
      {data.insiderOwnership && <Markdown text={data.insiderOwnership} />}
    </Section>
  );
}
```

Create `components/report/sections/Section7.tsx`:

```tsx
import { Markdown, MD } from "../Markdown";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section7({ data }: { data: Report["sections"]["risks"] }) {
  return (
    <Section title="7. Risk Analysis">
      <h3>Idiosyncratic Risks</h3>
      {data.idiosyncratic.map((r, i) => <p key={i}><MD>{r}</MD></p>)}
      <h3>Systemic Risks</h3>
      <Markdown text={data.systemic} />
    </Section>
  );
}
```

Create `components/report/sections/AnalystSentiment.tsx`:

```tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Markdown } from "../Markdown";
import { Section } from "../Section";
import { Src } from "../Src";
import { pct, upside, usd } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

export function AnalystSentiment({
  data, current, asOf,
}: { data: Report["analystSentiment"]; current: number; asOf: string }) {
  const rows: [string, React.ReactNode][] = [
    [`Consensus rating (${data.numAnalysts} analysts)`, data.consensusRating],
    ["Rating distribution", `${data.buy} Buy / ${data.hold} Hold / ${data.sell} Sell`],
    ["Consensus price target", usd(data.consensusTarget)],
    ["Median target", usd(data.medianTarget)],
    ["High / Low target", `${usd(data.highTarget)} / ${usd(data.lowTarget)}`],
    ["Implied upside to consensus",
      <span key="u" className="font-bold text-bull">
        {pct(upside(data.consensusTarget, current), { signed: true })}
      </span>],
  ];
  return (
    <Section title="Analyst Sentiment Summary">
      <div className="-mx-1 overflow-x-auto px-1">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Metric</TableHead><TableHead>Value</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([k, v]) => (
              <TableRow key={k}><TableCell>{k}</TableCell><TableCell>{v}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Src>Source: Bigdata.com / FMP aggregated analyst data, as of {asOf}.</Src>
      <Markdown text={data.commentary} />
    </Section>
  );
}
```

Create `components/report/sections/Section8.tsx`:

```tsx
import { Markdown } from "../Markdown";
import { RatingBlock } from "../RatingBlock";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section8({
  data, rating, current,
}: {
  data: Report["sections"]["finalRecommendation"];
  rating: Report["rating"];
  current: number;
}) {
  return (
    <Section title="8. Final Recommendation">
      <RatingBlock rating={rating} current={current} upsideLabel="Upside:" />
      {data.body.map((p, i) => <Markdown key={i} text={p} />)}
    </Section>
  );
}
```

- [ ] **Step 5: Implement the composition root**

Create `components/report/EquityReport.tsx`:

```tsx
/**
 * EquityReport.tsx — the whole report, rendered from the JSON contract.
 * -----------------------------------------------------------------------------
 * Synchronous Server Component: no per-report prose or numbers live here. Swap
 * `data` for any ticker the pipeline emits.
 */
import { ProjectionChart } from "@/components/chart/ProjectionChart";
import { buildChartModel, historySeries } from "@/components/chart/geometry";
import { ReportHeader } from "./ReportHeader";
import { Snapshot } from "./Snapshot";
import { RatingBlock } from "./RatingBlock";
import { Section1 } from "./sections/Section1";
import { Section2 } from "./sections/Section2";
import { Section3 } from "./sections/Section3";
import { Section4 } from "./sections/Section4";
import { Section5 } from "./sections/Section5";
import { Section6 } from "./sections/Section6";
import { Section7 } from "./sections/Section7";
import { Section8 } from "./sections/Section8";
import { AnalystSentiment } from "./sections/AnalystSentiment";
import type { Report } from "@/lib/report.schema";

const DEFAULT_DISCLAIMER =
  "DISCLAIMER: This report is for informational/educational purposes only and does not " +
  "constitute investment advice. Technology and AI-infrastructure stocks carry significant risk " +
  "and volatility. Past performance is not indicative of future results. Conduct your own due " +
  "diligence. The author may hold positions in securities discussed.";

export default function EquityReport({ data }: { data: Report }) {
  const { meta: m, quote, rating, sections: s } = data;
  const current = quote.currentPrice;
  const chartModel = buildChartModel(data);
  const isPlaceholderHistory = historySeries(current).placeholder;

  return (
    <div className="report-prose mx-auto max-w-[900px] px-7 pt-11 pb-20">
      <ReportHeader meta={m} />
      <Snapshot cells={data.snapshot} />
      <RatingBlock rating={rating} current={current} upsideLabel="Upside Potential:" />

      <figure className="my-3.5">
        <div className="hidden md:block">
          <ProjectionChart model={chartModel} layout="wide" />
        </div>
        <div className="md:hidden">
          <ProjectionChart model={chartModel} layout="narrow" />
        </div>
        {isPlaceholderHistory && (
          <figcaption className="mt-1 text-center font-sans text-[11px] italic text-muted">
            The history line is indicative; live daily closes are not yet wired.
          </figcaption>
        )}
      </figure>

      <div className="my-0.5 text-center font-sans text-xs italic text-muted">
        Report Date: {m.reportDate} | Analyst: {m.analyst}
      </div>
      <div className="my-0.5 text-center font-sans text-xs italic text-muted">
        Fiscal Year End: {m.fiscalYearEnd} | Figures in {m.currency} | Auto-generated from
        Form {m.filing.form} ({m.filing.fiscalPeriod}, filed {m.filing.filedDate})
      </div>

      <Section1 data={s.executiveSummary} />
      <Section2 data={s.financials} />
      <Section3 data={s.valuation} />
      <Section4 data={s.businessMoat} />
      <Section5 data={s.growth} />
      <Section6 data={s.management} />
      <Section7 data={s.risks} />
      <AnalystSentiment data={data.analystSentiment} current={current} asOf={m.asOf} />
      <Section8 data={s.finalRecommendation} rating={rating} current={current} />

      <div className="mt-6 border-t border-hairline pt-3 text-center font-sans text-[11px] italic leading-relaxed text-muted">
        {data.disclaimer ?? DEFAULT_DISCLAIMER}
      </div>
      <div className="mt-1.5 text-center font-sans text-xs italic text-muted">
        Prepared by {m.analyst} | {m.reportDate} | {m.analystName} | Auto-generated from
        Form {m.filing.form} (accession {m.filing.accession})
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run components/report/EquityReport.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Delete the superseded prototype**

```bash
git rm files/EquityReport.tsx
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: compose the full equity report from the JSON contract"
```

---

## Task 11: The report route

**Files:**
- Create: `app/research/[ticker]/page.tsx`, `app/research/[ticker]/not-found.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `loadReport`, `listReportTickers` from `@/lib/reports`; `EquityReport`; `ThemeToggle`.
- Produces: the static route `/research/[ticker]`.

- [ ] **Step 1: Implement the route**

Create `app/research/[ticker]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import EquityReport from "@/components/report/EquityReport";
import { ThemeToggle } from "@/components/theme-toggle";
import { listReportTickers, loadReport } from "@/lib/reports";

export const dynamicParams = false;

export async function generateStaticParams() {
  const tickers = await listReportTickers();
  return tickers.map((ticker) => ({ ticker }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Metadata> {
  const { ticker } = await params;
  const report = await loadReport(ticker);
  if (!report) return { title: "Report not found — Juniper Finance" };
  return {
    title: `${report.meta.company} (${report.meta.ticker}) — Juniper Finance`,
    description: report.meta.subtitle,
  };
}

export default async function ReportPage(
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const report = await loadReport(ticker);
  if (!report) notFound();
  return (
    <>
      <ThemeToggle />
      <EquityReport data={report} />
    </>
  );
}
```

- [ ] **Step 2: Implement the not-found page**

Create `app/research/[ticker]/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[900px] px-7 py-24 text-center">
      <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">
        EQUITY RESEARCH
      </div>
      <h1 className="mt-3 font-display text-[42px] font-semibold text-ink">
        No report for that ticker
      </h1>
      <p className="mt-2 text-muted">
        <Link href="/research" className="text-accent underline underline-offset-4">
          Browse all reports
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Redirect the root**

Replace `app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/research");
}
```

- [ ] **Step 4: Build to verify the route renders statically**

```bash
npm run build
```

Expected: build succeeds and the output lists `/research/avgo` as a prerendered static route. If validation fails, the error names the ticker and field — that is the intended behaviour, not a build bug.

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

Open `http://localhost:3000/research/avgo`. Confirm: the chart is present, the theme toggle switches between Forest Night and Linen, and the chart recolours with it. View source and confirm the `<svg>` contains `<line>` and `<text>` elements — proving it rendered server-side.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add the static report route with validation at the boundary"
```

---

## Task 12: The index route

**Files:**
- Create: `app/research/page.tsx`
- Test: `app/research/ReportIndexList.test.tsx`
- Create: `components/report/ReportIndexList.tsx`
- Delete: `files/README.md` (moved to root), `files/` directory

**Interfaces:**
- Consumes: `listReports`, `ReportSummary` from `@/lib/reports`.
- Produces: `<ReportIndexList reports={ReportSummary[]} />` (synchronous, testable) and the route `/research`.

- [ ] **Step 1: Write the failing test**

Create `app/research/ReportIndexList.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportIndexList } from "@/components/report/ReportIndexList";
import type { ReportSummary } from "@/lib/reports";

const summaries: ReportSummary[] = [
  {
    ticker: "AVGO", company: "Broadcom Inc.", exchange: "NASDAQ",
    subtitle: "Custom Silicon at the Center of the AI Buildout",
    reportDate: "September 12, 2026",
    rating: { label: "BUY", tone: "bull", targetLow: 440, targetHigh: 525 },
    currentPrice: 361.99,
  },
];

describe("ReportIndexList", () => {
  it("links each report to its route by lowercase ticker", () => {
    render(<ReportIndexList reports={summaries} />);
    expect(screen.getByRole("link", { name: /Broadcom/ })).toHaveAttribute("href", "/research/avgo");
  });

  it("shows the call and the formatted target range", () => {
    render(<ReportIndexList reports={summaries} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("$440.00 – $525.00")).toBeInTheDocument();
  });

  it("explains itself when the archive is empty", () => {
    render(<ReportIndexList reports={[]} />);
    expect(screen.getByText(/no reports yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run app/research/ReportIndexList.test.tsx
```

Expected: FAIL — cannot resolve `@/components/report/ReportIndexList`.

- [ ] **Step 3: Implement the list**

Create `components/report/ReportIndexList.tsx`:

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { usd } from "@/lib/format";
import type { ReportSummary } from "@/lib/reports";

export function ReportIndexList({ reports }: { reports: ReportSummary[] }) {
  if (reports.length === 0) {
    return <p className="mt-8 text-muted">No reports yet.</p>;
  }
  return (
    <ul className="mt-6 border-t border-hairline">
      {reports.map((r) => (
        <li key={r.ticker} className="border-b border-hairline">
          <Link href={`/research/${r.ticker.toLowerCase()}`}
            className="flex flex-col gap-2 py-4 md:flex-row md:items-baseline md:gap-4">
            <Badge variant={r.rating.tone} className="w-fit px-2 py-0.5 font-sans text-[11px] font-bold tracking-wider">
              {r.rating.label}
            </Badge>
            <div className="flex-1">
              <div className="font-display text-[22px] font-semibold text-ink">
                {r.company} <span className="font-mono text-[13px] text-muted">
                  {r.exchange}: {r.ticker}
                </span>
              </div>
              <div className="font-sans text-[13px] text-muted">{r.subtitle}</div>
            </div>
            <div className="font-mono text-[12.5px] text-muted md:text-right">
              <div>{usd(r.rating.targetLow)} – {usd(r.rating.targetHigh)}</div>
              <div>{r.reportDate}</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run app/research/ReportIndexList.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Implement the route**

Create `app/research/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ReportIndexList } from "@/components/report/ReportIndexList";
import { ThemeToggle } from "@/components/theme-toggle";
import { listReports } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Equity Research — Juniper Finance",
  description: "Automated equity research reports.",
};

export default async function ResearchIndex() {
  const reports = await listReports();
  return (
    <>
      <ThemeToggle />
      <main className="mx-auto max-w-[900px] px-7 pt-11 pb-20">
        <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">
          EQUITY RESEARCH
        </div>
        <h1 className="mt-1.5 font-display text-[42px] leading-[1.08] font-semibold text-ink">
          Juniper Finance
        </h1>
        <p className="font-display text-[21px] italic text-muted">
          Automated equity research, generated from filings.
        </p>
        <hr className="my-3.5 border-0 border-t border-accent" />
        <ReportIndexList reports={reports} />
      </main>
    </>
  );
}
```

- [ ] **Step 6: Retire the prototype directory**

Only `README.md` should remain in `files/` at this point.

```bash
git mv files/README.md README.md
rmdir files
ls files 2>/dev/null || echo "files/ removed"
```

Then update the directory tree inside `README.md` to match the real layout from the File Structure table at the top of this plan, and update the "Using it" snippet to:

```tsx
// app/research/[ticker]/page.tsx — see the real route for the full version
const report = await loadReport(ticker);
if (!report) notFound();
return <EquityReport data={report} />;
```

- [ ] **Step 7: Run the full suite and build**

```bash
npm test && npm run build
```

Expected: all tests pass; build succeeds with `/research` and `/research/avgo` prerendered.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add the research index and retire the files/ prototype"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task:

| Spec section | Task |
|---|---|
| Architecture / file layout | 1, and every task thereafter |
| Token layer, naming collision, role assignments | 2, 5 |
| Data flow, `generateStaticParams` | 4, 11, 12 |
| Chart: geometry, responsive layout, history placeholder | 7, 8 |
| Error handling: Zod at boundary, `validate.ts`, `notFound` | 3, 4, 11 |
| Testing: format, geometry, render | 1, 7, 9, 10 |
| Dependencies, fonts via `next/font` | 1, 2 |
| Migration of the prototype | 1, 6, 8, 10, 12 |

**Type consistency.** `ChartModel`, `ChartDims`, `ChartScales`, `LabelRow`, `HistorySeries` are defined once in Task 7 and consumed unchanged in Task 8. `ReportSummary` is defined in Task 4 and consumed in Task 12. `ValidationIssue` is defined and consumed within Task 3. `Badge` variants (`bull | bear | accent | secondary`) are defined in Task 5 and match `rating.tone` in the schema exactly.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". The one thing named "placeholder" is `historySeries()`, which is a deliberate, tested, captioned product decision from the spec — not an unfinished step.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.
2. **Inline Execution** — tasks executed in this session with batch checkpoints.
