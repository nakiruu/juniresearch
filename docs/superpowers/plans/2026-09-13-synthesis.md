# Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a FactPack into a published `Report` by having a model author only the judgment half, under a code-owned prompt, contract, validator, and merge — with every number in the prose machine-checked against the facts.

**Architecture:** `lib/synth/` holds pure modules: the `Judgment` Zod contract (exported to JSON Schema for the prompt), `renderPrompt` (facts rendered through the frozen `lib/format.ts` plus verbatim context), `grounding` (numeric tokens ↔ an allowed index built from the FactPack, the facts block, and the context), `validateJudgment` (rating envelope, grounding, Markdown lint, segments), and `mergeReport` (facts + judgment + desk config → `Report`). Two `tsx` CLIs do the I/O; the `/synthesize` skill runs the ≤ 3-round loop with the session model behind a `Synthesizer` seam. The hand-built `data/avgo.json` becomes a test fixture; `data/` holds generated reports.

**Tech Stack:** TypeScript, Zod 4 (`z.toJSONSchema`), Vitest 5, `tsx` CLIs, the existing `lib/format.ts` / `lib/validate.ts` / `lib/facts/project.ts`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-synthesis-design.md`

## Global Constraints

- **The model writes prose and calls only.** Every derivable field (`rating.tone`, `thesis.label`, `snapshot`, `quote`, tables and their notes, `meta` identity fields, `disclaimer`, `schemaVersion`) is set by `mergeReport`, never accepted from the judgment. The `Judgment` schema is `strictObject` throughout so an extra key is a Zod error.
- **Numbers in judgment prose must be grounded.** Every numeric token in every judgment string must match the allowed index (FactPack numbers at display scalings, facts-block tokens, context tokens) at the token's own precision or within 0.5%, except the allow-list: integers 0–12, years 1990–2040, `Q1`–`Q4`, `FY24`-style labels, dates.
- **`lib/format.ts`, `lib/report.schema.ts`, `lib/validate.ts`, `lib/facts/schema.ts` are frozen.** `lib/facts/project.ts` changes only as Task 5 specifies (adds `quote.history`).
- **Nothing under `lib/synth/` performs I/O.** The scripts read and write files; no module in `lib/` imports `node:fs`.
- **Rating envelope (spec):** upside `u` = Σ(`impliedPrice × probability`) ÷ `currentPrice` − 1. STRONG BUY `u ≥ 0.25`; BUY `u ≥ 0.10`; HOLD `−0.10 ≤ u ≤ 0.15`; SELL `u ≤ −0.05`; STRONG SELL `u ≤ −0.20`.
- **Markdown subset (from `components/report/Markdown.tsx`):** `**bold**`, `### `/`#### ` at block start, `- `/`* ` list lines, blank-line paragraphs, `{+ +}`/`{- -}` spans; no nesting, no HTML, no tables, no links, no images.
- **Output paths:** prompt `data/judgment/<T>/<acc>.prompt.md` (git-ignored), judgment `data/judgment/<T>/<acc>.json` (committed), errors `data/judgment/<T>/<acc>.errors.txt` (git-ignored), report `data/<ticker-lowercase>.json`. `<T>` is the upper-case ticker; `<acc>` keeps its dashes.
- **`synth:build` writes the report only after `Judgment.parse`, `Report.parse`, `validateReport`, and `validateJudgment` all pass.** On failure it writes the errors file and exits 1; `data/*.json` is untouched.
- **Desk config is `data/desk/desk.json`** (one level below `data/`, because `lib/reports.ts` treats every `data/*.json` as a report).
- **CLIs run via `tsx`:** `node --env-file-if-exists=.env.local --import tsx scripts/<name>.ts`. Scripts import `lib/` with relative paths.
- **Test output stays pristine.** `npm test` green after every task (190 tests at the start); `npx tsc --noEmit -p .` clean; `npx eslint lib scripts components/chart components/report` clean (a pre-existing failure in `components/theme-toggle.tsx` is outside this plan); `npm run build` green after Task 8.
- **Commit after every task.** Conventional prefixes. End every commit message with the `Co-Authored-By:` and `Claude-Session:` trailer lines the session instructs.
- **Fixture facts:** the AVGO FactPack is `data/facts/AVGO/0001730168-26-000080.json` (price 361.99; FY25 revenue 63,887,000,000; Q3'26 revenue 29,591,000,000, YoY 0.8551; FY26E revenue 105,864,823,726, EPS 11.62904; FY27E EPS 19.28126; segments "Semiconductor Solutions" 36,858,000,000 and "Infrastructure Software" 27,029,000,000; the transcript excerpt contains "$16.7 billion" and "infrastructure software"; quote `asOf` "2026-09-11"). The hand-built report has rating BUY 440–525 with scenarios Bull 600 / 0.3, Base 490 / 0.5, Bear 300 / 0.2 (weighted 485, upside +0.34).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/__fixtures__/avgo-golden.json` | the hand-built report, moved out of `data/`; every existing test imports it |
| `lib/__fixtures__/avgo-golden-judgment.json` | the golden's judgment slice, extracted once (Task 2) |
| `lib/synth/desk.schema.ts` | `Desk` Zod contract |
| `data/desk/desk.json` | desk identity, disclaimer, style rules |
| `lib/synth/judgment.schema.ts` | `Judgment` Zod contract, `RatingLabel`, `judgmentJsonSchema()` |
| `lib/synth/grounding.ts` | `numericTokens`, `buildAllowedIndex`, `checkGrounding` |
| `lib/synth/prompt.ts` | `renderFactsBlock`, `renderContextBlock`, `renderPrompt` |
| `lib/synth/merge.ts` | `mergeReport`, `toneFor`, date helpers |
| `lib/synth/validate-judgment.ts` | `validateJudgment` |
| `lib/synth/synthesizer.ts` | the `Synthesizer` interface (seam only) |
| `lib/synth/walk.ts` | `stringLeaves(obj)` — shared by grounding and the Markdown lint |
| `scripts/synth-prompt.ts`, `scripts/synth-build.ts` | the two CLIs |
| `.claude/skills/synthesize/SKILL.md` | the loop |
| `data/judgment/AVGO/0001730168-26-000080.json`, `data/avgo.json` | the real run's artefacts (Task 8) |

---

## Task 1: Move the golden fixture, add the desk config, ignore the loop's scratch files

**Files:**
- Create: `lib/__fixtures__/avgo-golden.json` (copy of `data/avgo.json`), `lib/synth/desk.schema.ts`, `data/desk/desk.json`
- Modify: `components/chart/geometry.test.ts`, `components/chart/ProjectionChart.test.tsx`, `components/report/EquityReport.test.tsx`, `components/report/primitives.test.tsx`, `lib/facts/project.test.ts`, `lib/format.test.ts`, `lib/validate.test.ts` (import path), `lib/facts/project.ts` (one comment), `.gitignore`
- Test: `lib/synth/desk.schema.test.ts`

**Interfaces:**
- Produces: `Desk` (Zod object + type) with `{ analyst: string; analystName: string; disclaimer: string; styleRules: string[] }`; the golden fixture path `@/lib/__fixtures__/avgo-golden.json` used by every later task's tests.

- [ ] **Step 1: Copy the golden and re-point every importer**

```bash
mkdir -p lib/__fixtures__ && cp data/avgo.json lib/__fixtures__/avgo-golden.json
```
In each of the seven test files replace `@/data/avgo.json` with `@/lib/__fixtures__/avgo-golden.json` (the import identifier stays whatever it is — `avgo`, `report`, …). In `lib/facts/project.ts` change the header comment "match data/avgo.json" to "match the golden fixture (`lib/__fixtures__/avgo-golden.json`)". Run `npm test` — 190 passing, nothing else changes. (`data/avgo.json` stays in place for now; Task 8 replaces it with the generated report.)

Append to `.gitignore`:
```
# synthesis loop scratch (prompts are reproducible; error lists are transient)
data/judgment/**/*.prompt.md
data/judgment/**/*.errors.txt
```

- [ ] **Step 2: Write the failing test**

`lib/synth/desk.schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "@/lib/synth/desk.schema";

describe("Desk config", () => {
  it("parses data/desk/desk.json with the desk identity and at least three style rules", () => {
    const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
    expect(desk.analyst).toBe("Juniper Finance Research Desk");
    expect(desk.analystName).toBe("Nico — Senior Analyst");
    expect(desk.disclaimer.startsWith("DISCLAIMER:")).toBe(true);
    expect(desk.styleRules.length).toBeGreaterThanOrEqual(3);
  });
  it("rejects a blank analyst and an empty rule list", () => {
    expect(() => Desk.parse({ analyst: " ", analystName: "x", disclaimer: "x", styleRules: [] })).toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run lib/synth` → module not found.

- [ ] **Step 4: Implement**

`lib/synth/desk.schema.ts`:
```ts
/**
 * desk.schema.ts — the research desk's identity and house style.
 * -----------------------------------------------------------------------------
 * Config, not judgment: the model never authors these. Loaded from
 * data/desk/desk.json by the synth CLIs (one level below data/, because
 * lib/reports.ts treats every data/*.json as a report).
 */
import { z } from "zod";

const text = (max: number) => z.string().regex(/\S/, "must not be blank").max(max);

export const Desk = z.strictObject({
  analyst: text(80),
  analystName: text(80),
  disclaimer: text(1200),
  styleRules: z.array(text(200)).min(3).max(10),
});
export type Desk = z.infer<typeof Desk>;
```

`data/desk/desk.json`:
```json
{
  "analyst": "Juniper Finance Research Desk",
  "analystName": "Nico — Senior Analyst",
  "disclaimer": "DISCLAIMER: This report is for informational/educational purposes only and does not constitute investment advice. Technology and AI-infrastructure stocks carry significant risk and volatility. Past performance is not indicative of future results. Conduct your own due diligence. The author may hold positions in securities discussed.",
  "styleRules": [
    "Evidence-led: every claim rests on a figure or a quoted fact from the Facts or Context blocks; name the period when you quote a figure.",
    "One claim per sentence; short paragraphs; no rhetorical questions.",
    "No hype vocabulary (no 'massive', 'incredible', 'game-changing', 'skyrocket'); let the numbers carry the weight.",
    "Balance: every bullish section names the counter-case; the bear scenario is a real scenario, not a formality.",
    "American spelling; company and product names exactly as the filing writes them.",
    "Use {+ +} and {- -} only around signed changes or explicit positives/negatives, never around whole sentences."
  ]
}
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run lib/synth` → 2 passing; `npm test` → 192 passing.

- [ ] **Step 6: Commit** — `git add -A lib data/desk .gitignore components && git commit -m "chore: move the golden AVGO report into fixtures; add the desk config"`

---

## Task 2: The Judgment contract and the golden judgment slice

**Files:**
- Create: `lib/synth/judgment.schema.ts`, `lib/__fixtures__/avgo-golden-judgment.json`
- Test: `lib/synth/judgment.schema.test.ts`

**Interfaces:**
- Produces: `RatingLabel` (enum), `Judgment` (Zod strict object + type), `judgmentJsonSchema(): Record<string, unknown>`; the fixture `@/lib/__fixtures__/avgo-golden-judgment.json`.

- [ ] **Step 1: Extract the golden judgment slice** (one-off; the result is committed)

```bash
node -e '
const r = require("./lib/__fixtures__/avgo-golden.json"); const s = r.sections;
const j = {
  meta: { subtitle: r.meta.subtitle, fiscalYearEnd: r.meta.fiscalYearEnd },
  rating: { label: r.rating.label, targetLow: r.rating.targetLow, targetHigh: r.rating.targetHigh },
  analystCommentary: r.analystSentiment.commentary,
  sections: {
    executiveSummary: { companyOverview: s.executiveSummary.companyOverview, thesis: { body: s.executiveSummary.thesis.body },
      catalysts: s.executiveSummary.catalysts, risks: s.executiveSummary.risks },
    financials: { incomeCommentary: s.financials.incomeCommentary, balanceCommentary: s.financials.balanceCommentary, cashflowCommentary: s.financials.cashflowCommentary },
    valuation: { multiplesCommentary: s.valuation.multiplesCommentary, scenarios: s.valuation.scenarios, scenarioCommentary: s.valuation.scenarioCommentary },
    businessMoat: { segments: s.businessMoat.segments.map(({ name, body }) => ({ name, body })), moatRating: s.businessMoat.moatRating,
      moatFactors: s.businessMoat.moatFactors, durability: s.businessMoat.durability },
    growth: s.growth, management: s.management, risks: s.risks, finalRecommendation: s.finalRecommendation,
  },
};
require("fs").writeFileSync("lib/__fixtures__/avgo-golden-judgment.json", JSON.stringify(j, null, 2) + "\n");'
```

- [ ] **Step 2: Write the failing tests**

`lib/synth/judgment.schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Judgment, judgmentJsonSchema } from "@/lib/synth/judgment.schema";
import golden from "@/lib/__fixtures__/avgo-golden-judgment.json";

describe("Judgment contract", () => {
  it("accepts the golden judgment slice", () => {
    const j = Judgment.parse(golden);
    expect(j.rating.label).toBe("BUY");
    expect(j.sections.valuation.scenarios).toHaveLength(3);
    expect(j.sections.businessMoat.segments.map((s) => s.name)).toEqual(["Semiconductor Solutions", "Infrastructure Software"]);
  });
  it("rejects an over-long thesis", () => {
    const j = structuredClone(golden); j.sections.executiveSummary.thesis.body = "x".repeat(1501);
    expect(() => Judgment.parse(j)).toThrow(/thesis/);
  });
  it("rejects two scenarios and a fourth", () => {
    const two = structuredClone(golden); two.sections.valuation.scenarios = golden.sections.valuation.scenarios.slice(0, 2);
    expect(() => Judgment.parse(two)).toThrow(/scenarios/);
  });
  it("rejects null and unknown keys — facts do not belong in a judgment", () => {
    const n = structuredClone(golden) as Record<string, unknown>; (n.sections as Record<string, unknown>).growth = null;
    expect(() => Judgment.parse(n)).toThrow();
    const extra = { ...structuredClone(golden), quote: { currentPrice: 1 } };
    expect(() => Judgment.parse(extra)).toThrow(/quote/);
  });
  it("rejects a blank catalyst and a probability outside (0, 1)", () => {
    const b = structuredClone(golden); b.sections.executiveSummary.catalysts[0] = "   ";
    expect(() => Judgment.parse(b)).toThrow(/blank/);
    const p = structuredClone(golden); p.sections.valuation.scenarios[0].probability = 1;
    expect(() => Judgment.parse(p)).toThrow(/probability/);
  });
  it("exports a JSON Schema naming the top-level keys and the rating enum", () => {
    const js = judgmentJsonSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(js.required.sort()).toEqual(["analystCommentary", "meta", "rating", "sections"]);
    expect(JSON.stringify(js)).toContain("STRONG BUY");
  });
});
```

- [ ] **Step 3: Run to verify they fail** — module not found.

- [ ] **Step 4: Implement**

`lib/synth/judgment.schema.ts`:
```ts
/**
 * judgment.schema.ts — the contract the synthesis model targets.
 * -----------------------------------------------------------------------------
 * The judgment half of a Report: calls and prose only. Everything derivable
 * (tone, thesis label, snapshot, tables, notes, identity, disclaimer) is set by
 * merge.ts. Strict objects everywhere: an extra key is an error, so a model that
 * "helpfully" returns facts fails fast. Bounds are the page's shape.
 */
import { z } from "zod";

export const RatingLabel = z.enum(["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"]);
export type RatingLabel = z.infer<typeof RatingLabel>;

/** Markdown prose: non-blank, capped. `.regex` (not `.trim`) keeps the JSON Schema export lossless. */
const md = (max: number) => z.string().regex(/\S/, "must not be blank").max(max);

const scenario = z.strictObject({
  name: md(20),
  driver: md(600),
  impliedPrice: z.number().positive(),
  probability: z.number().gt(0, "probability must be within (0, 1)").lt(1, "probability must be within (0, 1)"),
});

export const Judgment = z.strictObject({
  meta: z.strictObject({ subtitle: md(160), fiscalYearEnd: md(40) }),
  rating: z.strictObject({ label: RatingLabel, targetLow: z.number().positive(), targetHigh: z.number().positive() }),
  analystCommentary: md(2500),
  sections: z.strictObject({
    executiveSummary: z.strictObject({
      companyOverview: md(2500),
      thesis: z.strictObject({ body: md(1500) }),
      catalysts: z.array(md(600)).min(3).max(6),
      risks: z.array(md(600)).min(3).max(6),
    }),
    financials: z.strictObject({ incomeCommentary: md(2500), balanceCommentary: md(2500), cashflowCommentary: md(2500) }),
    valuation: z.strictObject({
      multiplesCommentary: md(2500),
      scenarios: z.array(scenario).length(3, "exactly three scenarios"),
      scenarioCommentary: md(2500),
    }),
    businessMoat: z.strictObject({
      segments: z.array(z.strictObject({ name: md(80), body: md(1200) })).min(1),
      moatRating: z.enum(["WIDE", "NARROW", "NONE"]),
      moatFactors: z.array(z.strictObject({ name: md(60), strength: md(30), body: md(800) })).min(2).max(5),
      durability: md(1500),
    }),
    growth: z.strictObject({ points: z.array(md(600)).min(3).max(6) }),
    management: z.strictObject({ leadership: md(1500), capitalAllocation: md(1500), governance: md(1500), insiderOwnership: md(1500).optional() }),
    risks: z.strictObject({ idiosyncratic: z.array(md(800)).min(2).max(5), systemic: md(1500) }),
    finalRecommendation: z.strictObject({ body: z.array(md(1200)).min(1).max(3) }),
  }),
});
export type Judgment = z.infer<typeof Judgment>;

/** The same contract as JSON Schema, embedded in the prompt. */
export function judgmentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(Judgment) as Record<string, unknown>;
}
```

- [ ] **Step 5: Run to verify they pass** — `npx vitest run lib/synth` → 8 passing. If a Zod error message differs from a regex in the tests (e.g. the path-naming of `thesis`), print the actual message and adjust the *regex* to Zod 4's wording — never the bound.

- [ ] **Step 6: Commit** — `git add lib && git commit -m "feat: the Judgment contract and the golden judgment slice"`

---

## Task 3: Grounding — numeric tokens and the allowed index

**Files:**
- Create: `lib/synth/walk.ts`, `lib/synth/grounding.ts`
- Test: `lib/synth/grounding.test.ts`

**Interfaces:**
- Consumes: `FactPack` type; the AVGO FactPack file.
- Produces: `stringLeaves(obj: unknown, path?: string): { path: string; text: string }[]`; `NumberToken { raw: string; value: number; magnitude: number; precision: number; kind: "money" | "pct" | "mult" | "plain" }`; `numericTokens(text: string): NumberToken[]`; `AllowedIndex` (a class with `has(token): boolean`); `buildAllowedIndex(pack: FactPack, extraText: string[]): AllowedIndex`; `checkGrounding(obj: unknown, index: AllowedIndex): ValidationIssue[]`.

- [ ] **Step 1: Write the failing tests**

`lib/synth/grounding.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { numericTokens, buildAllowedIndex, checkGrounding } from "@/lib/synth/grounding";
import { stringLeaves } from "@/lib/synth/walk";
import { FactPack } from "@/lib/facts/schema";
import { readFileSync } from "node:fs";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));

describe("numericTokens", () => {
  const cases: [string, { raw: string; magnitude: number; kind: string }[]][] = [
    ["revenue of $29.6B rose 86% YoY", [{ raw: "$29.6B", magnitude: 29.6e9, kind: "money" }, { raw: "86%", magnitude: 86, kind: "pct" }]],
    ["AI revenue grew +221% to $16.7 billion", [{ raw: "+221%", magnitude: 221, kind: "pct" }, { raw: "$16.7 billion", magnitude: 16.7e9, kind: "money" }]],
    ["trades at 44.9x earnings and ~19.3x sales", [{ raw: "44.9x", magnitude: 44.9, kind: "mult" }, { raw: "19.3x", magnitude: 19.3, kind: "mult" }]],
    ["a $350–$600 range", [{ raw: "$350", magnitude: 350, kind: "money" }, { raw: "$600", magnitude: 600, kind: "money" }]],
    ["16,700 employees and 4.76B shares", [{ raw: "16,700", magnitude: 16700, kind: "plain" }, { raw: "4.76B", magnitude: 4.76e9, kind: "plain" }]],
    ["-3.3% in FY2024", [{ raw: "-3.3%", magnitude: -3.3, kind: "pct" }]],
  ];
  for (const [text, want] of cases) {
    it(`extracts ${JSON.stringify(text)}`, () => {
      expect(numericTokens(text).map((t) => ({ raw: t.raw, magnitude: t.magnitude, kind: t.kind }))).toEqual(want);
    });
  }
  it("allow-lists small counts, years, quarter and fiscal labels, dates, and form names", () => {
    expect(numericTokens("six customers, 3 hyperscalers, Q3'26 and Q4 FY2026, ended Aug 2, 2026, the 10-Q, a 10:1 split, since 2023")).toEqual([]);
  });
  it("records precision as the number of decimals written", () => {
    expect(numericTokens("$361.99 and 0.855 and 68%").map((t) => t.precision)).toEqual([2, 3, 0]);
  });
});

describe("the allowed index on the AVGO FactPack", () => {
  const index = buildAllowedIndex(pack, []);
  const ok = (s: string) => checkGrounding({ p: s }, index);
  it("accepts figures that round from FactPack values at their own precision", () => {
    expect(ok("Revenue of $29.6B rose 86% YoY; FY25 revenue was $63.9B; EPS of $4.77")).toEqual([]);
  });
  it("accepts figures within 0.5% of a FactPack value", () => {
    expect(ok("consensus target $509.61, market cap ~$1.72T, P/E of 44.9x")).toEqual([]);
  });
  it("accepts a figure only because the transcript contains it", () => {
    expect(ok("AI semiconductor revenue of $16.7 billion")).toEqual([]);
    expect(buildAllowedIndex({ ...pack, context: { ...pack.context, transcriptHighlights: null } }, []).has(numericTokens("$16.7 billion")[0])).toBe(false);
  });
  it("rejects a figure that is nowhere in the facts or the context, naming the field and the token", () => {
    const issues = checkGrounding({ sections: { thesis: { body: "Revenue of $17.9B" } } }, index);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("sections.thesis.body");
    expect(issues[0].message).toMatch(/\$17\.9B.*not in the facts or the captured context/);
  });
  it("indexes extra text, such as the rendered facts block", () => {
    const withExtra = buildAllowedIndex(pack, ["Fwd P/E (NTM) 31.1x"]);
    expect(checkGrounding({ p: "at 31.1x forward earnings" }, withExtra)).toEqual([]);
    expect(checkGrounding({ p: "at 31.1x forward earnings" }, index)).toHaveLength(1);
  });
});

describe("stringLeaves", () => {
  it("walks nested objects and arrays with dotted, indexed paths", () => {
    expect(stringLeaves({ a: { b: ["x", "y"] }, c: 1, d: "z" })).toEqual([
      { path: "a.b[0]", text: "x" }, { path: "a.b[1]", text: "y" }, { path: "d", text: "z" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`lib/synth/walk.ts`:
```ts
/** Every string leaf of a JSON-like value, with its dotted/indexed path. */
export function stringLeaves(obj: unknown, path = ""): { path: string; text: string }[] {
  if (typeof obj === "string") return [{ path, text: obj }];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  if (obj && typeof obj === "object")
    return Object.entries(obj).flatMap(([k, v]) => stringLeaves(v, path ? `${path}.${k}` : k));
  return [];
}
```

`lib/synth/grounding.ts`:
```ts
/**
 * grounding.ts — "do not invent numbers", as a check rather than a promise.
 * -----------------------------------------------------------------------------
 * numericTokens() pulls every figure out of prose. buildAllowedIndex() collects
 * every number a report may legitimately contain: FactPack values at their
 * display scalings, the rendered facts block, and the captured context text.
 * checkGrounding() reports each prose figure that matches nothing.
 */
import type { FactPack } from "../facts/schema";
import type { ValidationIssue } from "../validate";
import { stringLeaves } from "./walk";

export interface NumberToken {
  raw: string;
  value: number;      // as written, sign applied: "$29.6B" → 29.6
  magnitude: number;  // with the multiplier: "$29.6B" → 2.96e10; "86%" → 86
  precision: number;  // decimals written
  kind: "money" | "pct" | "mult" | "plain";
}

const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

// sign? $? digits(,ddd)* (.ddd)? then an optional unit: suffix letter, spelled multiplier, %, or x.
const TOKEN = /(?<![A-Za-z'’$\d.])([+\-−–]?)(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(K|M|B|T|thousand|million|billion|trillion)(?![A-Za-z])|(%)|(x)(?![A-Za-z]))?/g;
const YEAR = /^(19[9]\d|20[0-4]\d)$/;

/** Figures that never need grounding: small counts, years, fiscal/quarter labels, dates, form names, ratios like 10:1. */
function allowListed(m: RegExpExecArray, text: string): boolean {
  const [whole, , dollar, int, frac, suffix, pctSign, xSign] = m;
  const bare = !dollar && !frac && !suffix && !pctSign && !xSign;
  const n = Number(int.replace(/,/g, ""));
  const before = text.slice(Math.max(0, m.index - 3), m.index);
  const after = text.slice(m.index + whole.length, m.index + whole.length + 3);
  if (/(^|[^A-Za-z])(Q|FY)$/.test(before) || /^'?\d{2}\b/.test(after) && /Q$/.test(before)) return true; // Q3'26, FY24, FY2026
  if (bare && n <= 12) return true;
  if (bare && YEAR.test(int)) return true;
  if (bare && /^[-:]\s?[A-Z\d]/.test(after)) return true;   // 10-Q, 10-K, 10:1
  if (/^, ?(19|20)\d\d/.test(after) || /^,? (19|20)\d\d/.test(after)) return true; // "Aug 2, 2026"
  return false;
}

export function numericTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    const [raw, sign, dollar, int, frac = "", suffix, pctSign, xSign] = m;
    if (allowListed(m, text)) continue;
    const abs = Number(int.replace(/,/g, "") + frac);
    const value = /[-−–]/.test(sign) ? -abs : abs;
    const mult = suffix ? MULT[suffix.toLowerCase()] : 1;
    const kind: NumberToken["kind"] = dollar ? "money" : pctSign ? "pct" : xSign ? "mult" : "plain";
    out.push({ raw: raw.trim(), value, magnitude: value * mult, precision: frac ? frac.length - 1 : 0, kind });
  }
  return out;
}

const roundTo = (x: number, dp: number) => Number(x.toFixed(dp));

export class AllowedIndex {
  private values: number[] = [];
  add(v: number): void { if (Number.isFinite(v)) this.values.push(v); }
  addToken(t: NumberToken): void { this.add(t.value); this.add(t.magnitude); this.add(Math.abs(t.value)); this.add(Math.abs(t.magnitude)); }
  /** A prose figure is grounded if some indexed value rounds to it at its own precision, or lies within 0.5% of it. */
  has(t: NumberToken): boolean {
    const targets = [t.value, t.magnitude, Math.abs(t.value), Math.abs(t.magnitude)];
    return this.values.some((v) => targets.some((x) =>
      roundTo(v, t.precision) === roundTo(x, t.precision) || (x !== 0 && Math.abs(v - x) / Math.abs(x) <= 0.005)));
  }
}

/** Every number in the FactPack, at the scalings the page and the prose use. */
function factNumbers(pack: FactPack): number[] {
  const out: number[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "number") out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit({ quote: pack.quote, statements: pack.statements, latestQuarter: pack.latestQuarter, ttm: pack.ttm,
          estimates: pack.estimates, analysts: pack.analysts, segments: pack.segments, geoMix: pack.geoMix, peers: pack.peers });
  return out;
}

export function buildAllowedIndex(pack: FactPack, extraText: string[]): AllowedIndex {
  const index = new AllowedIndex();
  for (const n of factNumbers(pack)) {
    index.add(n);
    if (Math.abs(n) >= 1e6) for (const d of [1e3, 1e6, 1e9, 1e12]) index.add(n / d);
    if (Math.abs(n) < 50) index.add(n * 100);            // ratios as percentages
  }
  const c = pack.context;
  const texts = [c.description.text, c.mdaExcerpt?.text, c.riskFactorsExcerpt?.text, c.transcriptHighlights?.text,
                 ...c.headlines.map((h) => h.text), ...extraText].filter((t): t is string => typeof t === "string");
  for (const t of texts) for (const tok of numericTokens(t)) index.addToken(tok);
  return index;
}

export function checkGrounding(obj: unknown, index: AllowedIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, text } of stringLeaves(obj))
    for (const tok of numericTokens(text))
      if (!index.has(tok))
        issues.push({ field: path, message: `"${tok.raw}" is not in the facts or the captured context`, value: tok.raw });
  return issues;
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run lib/synth/grounding.test.ts`. The tokenizer cases are exact; if one fails, fix the regex or the allow-list, not the expected output — each case states a real report phrase. Note in the report which case needed a change and why.

- [ ] **Step 5: Commit** — `git add lib/synth && git commit -m "feat: grounding — numeric tokens and the allowed index from facts and context"`

---

## Task 4: The prompt

**Files:**
- Create: `lib/synth/prompt.ts`
- Test: `lib/synth/prompt.test.ts`

**Interfaces:**
- Consumes: `ReportFacts`, `projectReportFacts` (`lib/facts/project.ts`); `FactPack`; `Desk`; `judgmentJsonSchema`; `formatSnapshot`, `formatCell`, `compactUSD`, `usd`, `pct`, `mult` (`lib/format.ts`).
- Produces: `renderFactsBlock(facts, pack): string`; `renderContextBlock(pack): string`; `renderPrompt(pack, facts, desk, opts?: { priorErrors?: string[]; judgmentPath?: string }): string`.

- [ ] **Step 1: Write the failing tests**

`lib/synth/prompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk } from "@/lib/synth/desk.schema";
import { renderFactsBlock, renderContextBlock, renderPrompt } from "@/lib/synth/prompt";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));

describe("renderFactsBlock", () => {
  const block = renderFactsBlock(facts, pack);
  it("renders the snapshot exactly as the page formats it", () => {
    expect(block).toContain("- Current Price: $361.99");
    expect(block).toContain("- Q3'26 Revenue: $29.6B (+86%)");
    expect(block).toContain("- Fwd P/E (FY27E): ~18.8x");
  });
  it("renders the three statement tables cell by cell", () => {
    expect(block).toMatch(/\| Revenue \(\$B\) \| 27\.5 \| 33\.2 \| 35\.8 \| 51\.6 \| 63\.9 \|/);
    expect(block).toMatch(/\| Gross Margin \| 61\.4% \|/);
    expect(block).toMatch(/\| Free Cash Flow \|/);
  });
  it("renders estimates, TTM margins, analyst split, segments and geography", () => {
    expect(block).toContain("FY26E revenue $105.9B, EPS $11.63");
    expect(block).toContain("FY27E revenue $174.8B, EPS $19.28");
    expect(block).toMatch(/Buy 54 · Hold 6 · Sell 0/);
    expect(block).toMatch(/Semiconductor Solutions: 57\.7% \(\$36\.9B\)/);
    expect(block).toMatch(/Asia Pacific: 56\.2%/);
  });
});

describe("renderContextBlock", () => {
  const ctx = renderContextBlock(pack);
  it("labels every excerpt with its source and date and keeps the text verbatim", () => {
    expect(ctx).toMatch(/### MD&A \(edgar:10-Q, 2026-09-10, truncated\)/);
    expect(ctx).toMatch(/### Risk factors \(edgar:10-Q, 2026-09-10, truncated\)/);
    expect(ctx).toMatch(/### Transcript highlights \(bigdata:Quartr Transcripts, 2026-09-02/);
    expect(ctx).toContain(pack.context.mdaExcerpt!.text.slice(0, 200));
    expect(ctx).toMatch(/### Headlines\n- 2026-08-04 · Benzinga · What Is Going on With Broadcom Stock on Tuesday\?/);
  });
});

describe("renderPrompt", () => {
  it("assembles the six sections in order, with the errors section only on a re-prompt", () => {
    const p = renderPrompt(pack, facts, desk, { judgmentPath: "data/judgment/AVGO/0001730168-26-000080.json" });
    const order = ["# Role", "# Authoring contract", "# Facts", "# Context", "# Output"].map((h) => p.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(p).not.toContain("# Prior errors");
    expect(p).toContain(desk.styleRules[0]);
    expect(p).toContain('"STRONG BUY"');
    expect(p).toContain("data/judgment/AVGO/0001730168-26-000080.json");
    const re = renderPrompt(pack, facts, desk, { priorErrors: ["rating.label: BUY is inconsistent with an upside of -3.0%"] });
    expect(re).toMatch(/# Prior errors[\s\S]*- rating\.label: BUY is inconsistent/);
  });
  it("is deterministic and within the expected size", () => {
    const a = renderPrompt(pack, facts, desk), b = renderPrompt(pack, facts, desk);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(30000);
    expect(a.length).toBeLessThan(60000);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`lib/synth/prompt.ts`:
```ts
/**
 * prompt.ts — the one document the synthesis model reads.
 * -----------------------------------------------------------------------------
 * Facts are rendered through lib/format.ts exactly as the page will show them,
 * so the model can quote them without arithmetic and the grounding index (built
 * from the same strings) accepts every quoted figure. Context is verbatim.
 * Pure: same inputs, same text.
 */
import type { FactPack } from "../facts/schema";
import type { ReportFacts } from "../facts/project";
import type { Desk } from "./desk.schema";
import { judgmentJsonSchema } from "./judgment.schema";
import { formatSnapshot, formatCell, compactUSD, usd, pct, mult, type SnapshotCell } from "../format";
import type { FinancialTable } from "../report.schema";

const table = (title: string, t: FinancialTable): string => {
  const head = `| ${t.columns.join(" | ")} |\n| ${t.columns.map(() => "---").join(" | ")} |`;
  const rows = t.rows.map((r) => `| ${r.label} | ${r.values.map((v) => formatCell(v, r.format)).join(" | ")} |`);
  return `### ${title}\n${head}\n${rows.join("\n")}`;
};
const money = (x: number | null) => (x == null ? "—" : compactUSD(x));
const eps = (x: number | null) => (x == null ? "—" : usd(x));
const ratio = (x: number | null, dp = 1) => (x == null ? "—" : pct(x, { dp }));

export function renderFactsBlock(facts: ReportFacts, pack: FactPack): string {
  const snap = facts.snapshot.map((c) => `- ${c.label}: ${formatSnapshot(c as SnapshotCell)}`).join("\n");
  const e = pack.estimates, t = pack.ttm, a = facts.analystSentiment, lq = pack.latestQuarter;
  const multiples = facts.sections.valuation.multiplesCompanyColumn.map((m) => `- ${m.label}: ${m.value == null ? "—" : mult(m.value)}`).join("\n");
  const segments = facts.sections.businessMoat.segments.map((s) => `- ${s.name}: ${pct(s.sharePct)} (${compactUSD(s.revenue)})`).join("\n");
  const geo = facts.sections.businessMoat.geoMix.map((g) => `- ${g.region}: ${pct(g.sharePct)}`).join("\n");
  return [
    "### Snapshot", snap,
    table(`Income statement (${facts.sections.financials.income.columns.slice(1).join(", ")})`, facts.sections.financials.income),
    table("Balance sheet ($B)", facts.sections.financials.balance),
    table("Cash flow ($B)", facts.sections.financials.cashflow),
    "### Estimates (consensus means)",
    `- ${e.nextFY.label} revenue ${money(e.nextFY.revenue)}, EPS ${eps(e.nextFY.eps)}`,
    `- ${e.followingFY.label} revenue ${money(e.followingFY.revenue)}, EPS ${eps(e.followingFY.eps)}`,
    "### Trailing twelve months",
    `- Gross margin ${ratio(t.grossMargin)} · Operating margin ${ratio(t.operatingMargin)} · Net margin ${ratio(t.netMargin)}`,
    `- Latest quarter ${lq.label} (ended ${lq.periodEnd}): revenue ${compactUSD(lq.revenue)}, operating margin ${pct(lq.operatingMargin)}${lq.revenueYoY == null ? "" : `, revenue ${pct(lq.revenueYoY, { signed: true })} YoY`}`,
    "### Multiples (company column; peers pending a peer data source)", multiples,
    "### Street view",
    `- ${a.numAnalysts} analysts: Buy ${a.buy} · Hold ${a.hold} · Sell ${a.sell}; consensus ${a.consensusRating}`,
    `- Targets: consensus ${usd(a.consensusTarget)}, median ${usd(a.medianTarget)}, range ${usd(a.lowTarget)}–${usd(a.highTarget)}`,
    `### Segments (${facts.sections.businessMoat.segmentsBasis})`, segments,
    `### Geography (${facts.sections.businessMoat.geographyBasis})`, geo,
    `### Quote`,
    `- Price ${usd(pack.quote.price)} as of ${pack.quote.asOf}; 52-week ${usd(pack.quote.week52Low)}–${usd(pack.quote.week52High)}; market cap ${compactUSD(pack.quote.marketCap)}; dividend yield ${pct(pack.quote.dividendYield, { dp: 2 })}`,
  ].join("\n\n");
}

export function renderContextBlock(pack: FactPack): string {
  const c = pack.context;
  const ex = (title: string, e: { text: string; source: string; asOf: string; truncated?: boolean } | null) =>
    e ? `### ${title} (${e.source}, ${e.asOf}${e.truncated ? ", truncated" : ""})\n${e.text}` : `### ${title}\n(not captured)`;
  const headlines = c.headlines.length
    ? c.headlines.map((h) => `- ${h.asOf} · ${h.source.replace(/^bigdata:/, "")} · ${h.text}`).join("\n")
    : "(none captured)";
  return [
    ex("Company description", c.description),
    ex("MD&A", c.mdaExcerpt),
    ex("Risk factors", c.riskFactorsExcerpt),
    ex("Transcript highlights", c.transcriptHighlights),
    `### Headlines\n${headlines}`,
  ].join("\n\n");
}

const CONTRACT = `- Write Markdown using only: **bold**, "### " or "#### " at the start of a block, "- " list lines, blank lines between paragraphs, and {+ text +} / {- text -} for bullish / bearish spans. No HTML, no links, no images, no tables, and never nest markers (no **{+ +}**).
- Numeric fields (targets, implied prices, probabilities) are plain numbers; probabilities are ratios (0.30, not 30 or "30%").
- Quote figures exactly as they appear in the Facts or Context blocks below — the same rounding, the same unit. Never compute a new figure, never recall one from memory. A figure that appears in neither block fails validation.
- Do not write null anywhere; omit an optional field instead.
- Keep every field within its schema bounds; the page has a fixed shape.
- Order your thinking as the schema orders the fields: rating and scenarios first, then the prose that argues for them.`;

export function renderPrompt(pack: FactPack, facts: ReportFacts, desk: Desk, opts: { priorErrors?: string[]; judgmentPath?: string } = {}): string {
  const path = opts.judgmentPath ?? `data/judgment/${pack.ticker}/${pack.filing.accession}.json`;
  const parts = [
    `# Role\n\nYou are ${desk.analystName} at ${desk.analyst}, writing the judgment half of an equity research report on ${pack.company} (${pack.ticker}) following its ${pack.filing.form} for the period ended ${pack.filing.periodEnd}. House style:\n${desk.styleRules.map((r) => `- ${r}`).join("\n")}`,
    `# Authoring contract\n\n${CONTRACT}`,
    `# Facts\n\n${renderFactsBlock(facts, pack)}`,
    `# Context\n\n${renderContextBlock(pack)}`,
    `# Output\n\nWrite one JSON object matching this schema, and nothing else, to \`${path}\`. Return the complete object every time.\n\n\`\`\`json\n${JSON.stringify(judgmentJsonSchema(), null, 2)}\n\`\`\``,
  ];
  if (opts.priorErrors?.length)
    parts.push(`# Prior errors\n\nYour previous object failed validation. Fix every item below and return the full object again.\n${opts.priorErrors.map((e) => `- ${e}`).join("\n")}`);
  return parts.join("\n\n") + "\n";
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run lib/synth/prompt.test.ts`. The formatted strings asserted come from `lib/format.ts` on the committed FactPack; if one differs, print the rendered line and correct the *test string* to what the frozen formatter produces — record it.

- [ ] **Step 5: Commit** — `git add lib/synth && git commit -m "feat: render the synthesis prompt — formatted facts, verbatim context, the judgment schema"`

---

## Task 5: Merge — facts + judgment + desk → Report

**Files:**
- Create: `lib/synth/merge.ts`, `lib/synth/synthesizer.ts`
- Modify: `lib/facts/project.ts` (add `quote.history`), `lib/facts/project.test.ts` (one assertion)
- Test: `lib/synth/merge.test.ts`

**Interfaces:**
- Consumes: `ReportFacts`, `Judgment`, `Desk`, `Report`/`SCHEMA_VERSION` (`lib/report.schema.ts`), `validateReport`.
- Produces: `toneFor(label): Report["rating"]["tone"]`; `longDate(ymd)` ("September 13, 2026"), `shortDate(ymd)` ("Sep 11, 2026"); `mergeReport(facts, judgment, desk, buildDate: string): Report`; `interface Synthesizer`.

- [ ] **Step 1: Add `quote.history` to the projection**

In `lib/facts/project.ts`, in the returned `quote` object, append `history: p.history.map((h) => ({ date: h.date, close: h.close }))`. Add to `lib/facts/project.test.ts`:
```ts
it("carries the FactPack's daily closes as quote.history", () => {
  expect(facts.quote.history).toHaveLength(30);
  expect(facts.quote.history![29]).toMatchObject({ date: "2026-09-11" });
});
```
(`scripts/report-history.ts` stays for now; Task 7 removes it once `synth:build` is the single writer.)

- [ ] **Step 2: Write the failing tests**

`lib/synth/merge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk } from "@/lib/synth/desk.schema";
import { Judgment } from "@/lib/synth/judgment.schema";
import { mergeReport, toneFor, longDate, shortDate } from "@/lib/synth/merge";
import { Report, SCHEMA_VERSION } from "@/lib/report.schema";
import { validateReport } from "@/lib/validate";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const judgment = Judgment.parse(goldenJudgment);

describe("mergeReport with the golden judgment and the AVGO facts", () => {
  const report = mergeReport(facts, judgment, desk, "2026-09-13");
  it("produces a Report that parses and passes validateReport", () => {
    expect(() => Report.parse(report)).not.toThrow();
    expect(validateReport(report)).toEqual([]);
    expect(report.schemaVersion).toBe(SCHEMA_VERSION);
  });
  it("sets identity, dates and disclaimer from facts and desk, not from the judgment", () => {
    expect(report.meta).toMatchObject({ company: "Broadcom Inc.", ticker: "AVGO", exchange: "NASDAQ", analyst: desk.analyst, analystName: desk.analystName,
      reportDate: "September 13, 2026", asOf: "Sep 11, 2026", currency: "USD", subtitle: judgment.meta.subtitle, fiscalYearEnd: judgment.meta.fiscalYearEnd });
    expect(report.meta.filing).toEqual(facts.meta.filing);
    expect(report.disclaimer).toBe(desk.disclaimer);
  });
  it("derives tone and the thesis label from the rating", () => {
    expect(report.rating).toEqual({ label: "BUY", tone: "bull", targetLow: 440, targetHigh: 525 });
    expect(report.sections.executiveSummary.thesis.label).toBe("BUY");
  });
  it("passes facts through untouched: snapshot, quote with history, tables, analyst numbers", () => {
    expect(report.snapshot).toEqual(facts.snapshot);
    expect(report.quote).toEqual(facts.quote);
    expect(report.quote.history).toHaveLength(30);
    expect(report.sections.financials.income.rows).toEqual(facts.sections.financials.income.rows);
    expect(report.analystSentiment).toEqual({ ...facts.analystSentiment, commentary: judgment.analystCommentary });
  });
  it("sets code-owned table notes and a company-only multiples table", () => {
    expect(report.sections.financials.income.note).toBe("Source: Bigdata.com company tearsheet (FMP); fiscal years ended early November.");
    const m = report.sections.valuation.multiples;
    expect(m.columns).toEqual(["Multiple (TTM)", "AVGO"]);
    expect(m.rows.map((r) => r.label)).toEqual(["P/E", "P/S", "EV/EBITDA", "Fwd P/E (NTM)"]);
    expect(m.rows.every((r) => r.values.length === 1 && r.format === "mult")).toBe(true);
    expect(m.note).toBe("Peer multiples pending a peer data source.");
  });
  it("joins segment bodies to the fact segments by name and copies the rest of the moat section", () => {
    const seg = report.sections.businessMoat.segments;
    expect(seg.map((s) => s.name)).toEqual(["Semiconductor Solutions", "Infrastructure Software"]);
    expect(seg[0]).toMatchObject({ sharePct: facts.sections.businessMoat.segments[0].sharePct, revenue: facts.sections.businessMoat.segments[0].revenue, body: judgment.sections.businessMoat.segments[0].body });
    expect(report.sections.businessMoat.segmentsBasis).toBe("FY25 mix");
    expect(report.sections.businessMoat.moatRating).toBe("WIDE");
  });
});

describe("helpers", () => {
  it("maps labels to tones", () => {
    expect(["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"].map((l) => toneFor(l as never))).toEqual(["bull", "bull", "secondary", "bear", "bear"]);
  });
  it("formats dates in UTC", () => {
    expect(longDate("2026-09-13")).toBe("September 13, 2026");
    expect(shortDate("2026-09-11")).toBe("Sep 11, 2026");
  });
});
```

- [ ] **Step 3: Run to verify they fail** — module not found.

- [ ] **Step 4: Implement**

`lib/synth/synthesizer.ts`:
```ts
/**
 * synthesizer.ts — the seam between the pipeline and whoever runs the model.
 * -----------------------------------------------------------------------------
 * Today the /synthesize skill is the implementation: the session model reads
 * the rendered prompt and writes the judgment file. An API-backed Synthesizer
 * (Anthropic Messages API with structured output) plugs in here later without
 * touching prompt, contract, validation, or merge.
 */
export interface Synthesizer {
  /** Returns the model's judgment object (unvalidated) for a rendered prompt. */
  synthesize(prompt: string, priorErrors?: string[]): Promise<unknown>;
}
```

`lib/synth/merge.ts`:
```ts
/**
 * merge.ts — facts + judgment + desk → one Report.
 * -----------------------------------------------------------------------------
 * Everything derivable is set here, never taken from the judgment: rating tone,
 * thesis label, snapshot, quote, tables and their notes, identity, disclaimer.
 * Pure; the CLI validates the result before anything is written.
 */
import type { ReportFacts } from "../facts/project";
import type { Judgment, RatingLabel } from "./judgment.schema";
import type { Desk } from "./desk.schema";
import { SCHEMA_VERSION, type Report } from "../report.schema";

export const toneFor = (label: RatingLabel): Report["rating"]["tone"] =>
  label === "HOLD" ? "secondary" : label.endsWith("BUY") ? "bull" : "bear";

const fmt = (ymd: string, month: "long" | "short") =>
  new Date(ymd + "T00:00:00Z").toLocaleDateString("en-US", { month, day: "numeric", year: "numeric", timeZone: "UTC" });
export const longDate = (ymd: string): string => fmt(ymd, "long");
export const shortDate = (ymd: string): string => fmt(ymd, "short");

export function mergeReport(facts: ReportFacts, j: Judgment, desk: Desk, buildDate: string): Report {
  const note = `Source: Bigdata.com company tearsheet (FMP); fiscal years ended ${j.meta.fiscalYearEnd}.`;
  const bodies = new Map(j.sections.businessMoat.segments.map((s) => [s.name, s.body]));
  const f = facts.sections;
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      company: facts.meta.company, ticker: facts.meta.ticker, exchange: facts.meta.exchange,
      subtitle: j.meta.subtitle, reportDate: longDate(buildDate), asOf: shortDate(facts.meta.asOf),
      analyst: desk.analyst, analystName: desk.analystName, fiscalYearEnd: j.meta.fiscalYearEnd, currency: "USD",
      filing: facts.meta.filing,
    },
    quote: facts.quote,
    rating: { label: j.rating.label, tone: toneFor(j.rating.label), targetLow: j.rating.targetLow, targetHigh: j.rating.targetHigh },
    snapshot: facts.snapshot,
    analystSentiment: { ...facts.analystSentiment, commentary: j.analystCommentary },
    sections: {
      executiveSummary: {
        companyOverview: j.sections.executiveSummary.companyOverview,
        thesis: { label: j.rating.label, body: j.sections.executiveSummary.thesis.body },
        catalysts: j.sections.executiveSummary.catalysts, risks: j.sections.executiveSummary.risks,
      },
      financials: {
        income: { ...f.financials.income, note }, incomeCommentary: j.sections.financials.incomeCommentary,
        balance: { ...f.financials.balance, note }, balanceCommentary: j.sections.financials.balanceCommentary,
        cashflow: { ...f.financials.cashflow, note }, cashflowCommentary: j.sections.financials.cashflowCommentary,
      },
      valuation: {
        multiples: {
          columns: ["Multiple (TTM)", facts.meta.ticker],
          rows: f.valuation.multiplesCompanyColumn.map((m) => ({ label: m.label, values: [m.value], format: "mult" as const })),
          note: "Peer multiples pending a peer data source.",
        },
        multiplesCommentary: j.sections.valuation.multiplesCommentary,
        scenarios: j.sections.valuation.scenarios,
        scenarioCommentary: j.sections.valuation.scenarioCommentary,
      },
      businessMoat: {
        segments: f.businessMoat.segments.map((s) => ({ ...s, body: bodies.get(s.name) ?? "" })),
        segmentsBasis: f.businessMoat.segmentsBasis, geographyBasis: f.businessMoat.geographyBasis, geoMix: f.businessMoat.geoMix,
        moatRating: j.sections.businessMoat.moatRating, moatFactors: j.sections.businessMoat.moatFactors, durability: j.sections.businessMoat.durability,
      },
      growth: j.sections.growth,
      management: j.sections.management,
      risks: j.sections.risks,
      finalRecommendation: j.sections.finalRecommendation,
    },
    disclaimer: desk.disclaimer,
  };
}
```
(A segment name the judgment does not cover gets an empty body here; `validateJudgment` reports it in Task 6 — merge stays total.)

- [ ] **Step 5: Run to verify they pass** — `npx vitest run lib/synth lib/facts/project.test.ts`; then `npm test`, `npx tsc --noEmit -p .`. If `Report.parse` rejects the merged object, the message names the field — fix `mergeReport`, not the schema.

- [ ] **Step 6: Commit** — `git add lib && git commit -m "feat: merge facts, judgment and desk config into a Report; the Synthesizer seam"`

---

## Task 6: validateJudgment — rating envelope, grounding, Markdown lint, segments

**Files:**
- Create: `lib/synth/validate-judgment.ts`
- Test: `lib/synth/validate-judgment.test.ts`

**Interfaces:**
- Consumes: `Judgment`, `ReportFacts`, `FactPack`, `computeScenarios` (`lib/format.ts`), `buildAllowedIndex`/`checkGrounding`, `renderFactsBlock`, `stringLeaves`, `ValidationIssue`.
- Produces: `ENVELOPES`, `ratingIssues(judgment, currentPrice)`, `markdownIssues(judgment)`, `segmentIssues(judgment, facts)`, `validateJudgment(judgment, facts, pack): ValidationIssue[]`.

- [ ] **Step 1: Write the failing tests**

`lib/synth/validate-judgment.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Judgment } from "@/lib/synth/judgment.schema";
import { validateJudgment, ratingIssues, markdownIssues, segmentIssues } from "@/lib/synth/validate-judgment";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const pack = FactPack.parse(JSON.parse(readFileSync("data/facts/AVGO/0001730168-26-000080.json", "utf8")));
const facts = projectReportFacts(pack);
const golden = Judgment.parse(goldenJudgment);
const withRating = (label: Judgment["rating"]["label"], prices: [number, number, number]) => {
  const j = structuredClone(golden); j.rating.label = label;
  j.sections.valuation.scenarios = [{ name: "Bull", driver: "x", impliedPrice: prices[0], probability: 0.3 },
    { name: "Base", driver: "x", impliedPrice: prices[1], probability: 0.5 }, { name: "Bear", driver: "x", impliedPrice: prices[2], probability: 0.2 }];
  return j;
};

describe("rating envelope (price 100)", () => {
  // weighted fair value = 0.3·bull + 0.5·base + 0.2·bear
  const table: [Judgment["rating"]["label"], [number, number, number], boolean][] = [
    ["BUY", [150, 140, 100], true],          // +34% — the golden's shape
    ["BUY", [115, 110, 100], true],          // +10.5%
    ["BUY", [105, 100, 80], false],          // -0.5%
    ["STRONG BUY", [140, 125, 110], true],   // +26.5%
    ["STRONG BUY", [120, 115, 100], false],  // +13.5%
    ["HOLD", [120, 110, 90], true],          // +9%
    ["HOLD", [160, 140, 120], false],        // +42%
    ["SELL", [100, 90, 80], true],           // -11%
    ["SELL", [120, 110, 100], false],        // +11%
    ["STRONG SELL", [90, 75, 60], false],    // -17.5%
    ["STRONG SELL", [85, 70, 50], true],     // -24.5%
  ];
  for (const [label, prices, ok] of table)
    it(`${label} at ${prices.join("/")} ${ok ? "passes" : "fails"}`, () => {
      const issues = ratingIssues(withRating(label, prices), 100).filter((i) => i.field === "rating.label");
      expect(issues.length === 0).toBe(ok);
      if (!ok) expect(issues[0].message).toMatch(/inconsistent with an upside of/);
    });
  it("requires bull ≥ base ≥ bear when the names say so", () => {
    const j = withRating("BUY", [140, 150, 100]);
    expect(ratingIssues(j, 100).map((i) => i.field)).toContain("sections.valuation.scenarios");
  });
});

describe("markdown lint", () => {
  const withThesis = (body: string) => { const j = structuredClone(golden); j.sections.executiveSummary.thesis.body = body; return j; };
  it("accepts the contract's subset", () => {
    expect(markdownIssues(withThesis("### Heading\n\nA **bold** claim with {+ +21% +} growth.\n\n- one\n- two"))).toEqual([]);
  });
  it.each([
    ["HTML", "A <b>bold</b> claim"],
    ["nested markers", "**{+ up +}**"],
    ["a table", "| a | b |\n| - | - |"],
    ["a link", "see [the filing](https://sec.gov)"],
    ["a heading mid-block", "First line\n### Not at block start"],
  ])("rejects %s", (_name, body) => {
    const issues = markdownIssues(withThesis(body));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].field).toBe("sections.executiveSummary.thesis.body");
  });
});

describe("segments", () => {
  it("reports a missing and an extra segment body", () => {
    const j = structuredClone(golden); j.sections.businessMoat.segments = [{ name: "Semiconductor Solutions", body: "x" }, { name: "Mainframes", body: "y" }];
    expect(segmentIssues(j, facts).map((i) => i.message).join(" ")).toMatch(/Infrastructure Software.*Mainframes|Mainframes.*Infrastructure Software/);
  });
  it("rejects duplicate moat factor names", () => {
    const j = structuredClone(golden); j.sections.businessMoat.moatFactors[1].name = j.sections.businessMoat.moatFactors[0].name;
    expect(segmentIssues(j, facts).some((i) => i.field === "sections.businessMoat.moatFactors")).toBe(true);
  });
});

describe("validateJudgment on the golden judgment", () => {
  it("passes everything except grounding, and reports exactly the hand-written figures the capture cannot support", () => {
    const issues = validateJudgment(golden, facts, pack);
    expect(issues.filter((i) => !/not in the facts/.test(i.message))).toEqual([]);
    const misses = issues.map((i) => `${i.field}: ${i.value}`).sort();
    // Calibration record: fill this list from the first run (Step 4) — every entry must be a figure that is
    // genuinely absent from data/facts/AVGO/0001730168-26-000080.json and its context excerpts.
    expect(misses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement**

`lib/synth/validate-judgment.ts`:
```ts
/**
 * validate-judgment.ts — the checks Zod cannot express on a judgment.
 * -----------------------------------------------------------------------------
 * Rating envelope (conviction may differ from arithmetic; contradiction may
 * not), grounding (every figure in the prose exists in the facts or context),
 * the Markdown subset, and segment/moat naming. Every issue names field and
 * value; the list is the re-prompt payload.
 */
import type { FactPack } from "../facts/schema";
import type { ReportFacts } from "../facts/project";
import type { ValidationIssue } from "../validate";
import { computeScenarios, pct } from "../format";
import type { Judgment, RatingLabel } from "./judgment.schema";
import { buildAllowedIndex, checkGrounding } from "./grounding";
import { renderFactsBlock } from "./prompt";
import { stringLeaves } from "./walk";

/** Upside envelopes overlap so a conservative label passes; only a contradiction fails. */
export const ENVELOPES: Record<RatingLabel, { min?: number; max?: number }> = {
  "STRONG BUY": { min: 0.25 },
  BUY: { min: 0.10 },
  HOLD: { min: -0.10, max: 0.15 },
  SELL: { max: -0.05 },
  "STRONG SELL": { max: -0.20 },
};

export function ratingIssues(j: Judgment, currentPrice: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { fairValue } = computeScenarios(j.sections.valuation.scenarios);
  const upside = fairValue / currentPrice - 1;
  const env = ENVELOPES[j.rating.label];
  if ((env.min != null && upside < env.min) || (env.max != null && upside > env.max))
    issues.push({ field: "rating.label", message: `${j.rating.label} is inconsistent with an upside of ${pct(upside, { signed: true })} (probability-weighted fair value ${fairValue.toFixed(2)} vs price ${currentPrice})`, value: j.rating.label });
  const byName = (re: RegExp) => j.sections.valuation.scenarios.find((s) => re.test(s.name))?.impliedPrice;
  const bull = byName(/bull/i), base = byName(/base/i), bear = byName(/bear/i);
  if (bull != null && base != null && bear != null && !(bull >= base && base >= bear))
    issues.push({ field: "sections.valuation.scenarios", message: "implied prices must satisfy bull ≥ base ≥ bear", value: [bull, base, bear] });
  return issues;
}

const HTML = /<\/?[a-zA-Z][^>]*>/;
const NESTED = /\*\*\s*\{[+-]|[+-]\}\s*\*\*|\{[+-][^}]*\*\*/;
const LINK = /\]\(|!\[/;
export function markdownIssues(j: Judgment): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, text } of stringLeaves(j)) {
    const bad = (why: string) => issues.push({ field: path, message: why, value: text.slice(0, 80) });
    if (HTML.test(text)) bad("contains HTML; only the Markdown subset is allowed");
    if (NESTED.test(text)) bad("nests emphasis markers; pick **bold** or {+ +}/{- -}, never both");
    if (LINK.test(text)) bad("contains a link or image; not allowed in report prose");
    if (/^\s*\|/m.test(text)) bad("contains a table; not allowed in report prose");
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n");
      if (lines.slice(1).some((l) => /^#{1,6}\s/.test(l))) bad("has a heading that is not at the start of a block");
    }
  }
  return issues;
}

export function segmentIssues(j: Judgment, facts: ReportFacts): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const want = facts.sections.businessMoat.segments.map((s) => s.name);
  const got = j.sections.businessMoat.segments.map((s) => s.name);
  const missing = want.filter((n) => !got.includes(n)), extra = got.filter((n) => !want.includes(n));
  if (missing.length || extra.length)
    issues.push({ field: "sections.businessMoat.segments", message: `segment bodies must cover exactly the fact segments; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`, value: got });
  const names = j.sections.businessMoat.moatFactors.map((f) => f.name);
  if (new Set(names).size !== names.length)
    issues.push({ field: "sections.businessMoat.moatFactors", message: "moat factor names must be unique", value: names });
  return issues;
}

export function validateJudgment(j: Judgment, facts: ReportFacts, pack: FactPack): ValidationIssue[] {
  const index = buildAllowedIndex(pack, [renderFactsBlock(facts, pack)]);
  return [
    ...ratingIssues(j, pack.quote.price),
    ...segmentIssues(j, facts),
    ...markdownIssues(j),
    ...checkGrounding(j, index),
  ];
}
```

- [ ] **Step 4: Run, then calibrate the golden's miss list**

`npx vitest run lib/synth/validate-judgment.test.ts`. Every test except the last passes on a faithful implementation. The last test's `expect(misses).toEqual([])` fails with the actual list of hand-written figures the capture cannot support (expect the non-GAAP "68%", guidance figures not in the transcript excerpt, and similar). **For each entry, confirm it is genuinely absent** by searching `data/facts/AVGO/0001730168-26-000080.json` (`grep -c '16.7' …`, etc.); then paste the sorted list into the test as the expected value and update the comment to say "calibrated on 2026-09-13". If an entry *is* present in the facts or context, the tokenizer or index has a gap — fix `grounding.ts`, add the phrase as a tokenizer test case in `grounding.test.ts`, and re-run. Report the final list and any grounding fix.

- [ ] **Step 5: Commit** — `git add lib/synth && git commit -m "feat: validateJudgment — rating envelope, grounding, Markdown lint, segment naming"`

---

## Task 7: The CLIs, the skill, and the docs

**Files:**
- Create: `scripts/synth-prompt.ts`, `scripts/synth-build.ts`, `.claude/skills/synthesize/SKILL.md`
- Modify: `package.json` (add `synth:prompt`, `synth:build`; remove `report:history`), `README.md`
- Delete: `scripts/report-history.ts`
- Test: none new (the CLIs are thin; Task 8 exercises them end to end). `npm test` must stay green after the deletion.

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run synth:prompt -- <T> <acc> [--with-errors]`; `npm run synth:build -- <T> <acc> [--date YYYY-MM-DD]`; the `/synthesize` skill.

- [ ] **Step 1: The prompt CLI**

`scripts/synth-prompt.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { renderPrompt } from "../lib/synth/prompt";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
const withErrors = args.includes("--with-errors");
if (!tickerArg || !accession) { console.error("usage: npm run synth:prompt -- <TICKER> <ACCESSION> [--with-errors]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const pack = FactPack.parse(JSON.parse(read(join("data", "facts", ticker, `${accession}.json`))));
const desk = Desk.parse(JSON.parse(read(join("data", "desk", "desk.json"))));
const dir = join("data", "judgment", ticker);
mkdirSync(dir, { recursive: true });
const errorsPath = join(dir, `${accession}.errors.txt`);
const priorErrors = withErrors ? read(errorsPath).split("\n").filter(Boolean) : undefined;

const judgmentPath = join(dir, `${accession}.json`).replace(/\\/g, "/");
const prompt = renderPrompt(pack, projectReportFacts(pack), desk, { priorErrors, judgmentPath });
const out = join(dir, `${accession}.prompt.md`);
writeFileSync(out, prompt);
console.log(`Wrote ${out} (${prompt.length.toLocaleString("en-US")} chars${priorErrors ? `, ${priorErrors.length} prior errors` : ""})\nJudgment goes to ${judgmentPath}`);
```

- [ ] **Step 2: The build CLI**

`scripts/synth-build.ts`:
```ts
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { Judgment } from "../lib/synth/judgment.schema";
import { mergeReport } from "../lib/synth/merge";
import { validateJudgment } from "../lib/synth/validate-judgment";
import { Report } from "../lib/report.schema";
import { validateReport, type ValidationIssue } from "../lib/validate";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
const dateFlag = args.indexOf("--date");
const buildDate = dateFlag >= 0 ? args[dateFlag + 1] : new Date().toISOString().slice(0, 10);
if (!tickerArg || !accession || !/^\d{4}-\d{2}-\d{2}$/.test(buildDate ?? "")) { console.error("usage: npm run synth:build -- <TICKER> <ACCESSION> [--date YYYY-MM-DD]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const pack = FactPack.parse(JSON.parse(read(join("data", "facts", ticker, `${accession}.json`))));
const desk = Desk.parse(JSON.parse(read(join("data", "desk", "desk.json"))));
const judgmentPath = join("data", "judgment", ticker, `${accession}.json`);
const errorsPath = join("data", "judgment", ticker, `${accession}.errors.txt`);
const judgmentText = read(judgmentPath);

const fail = (issues: ValidationIssue[], stage: string): never => {
  const lines = issues.map((i) => `${i.field}: ${i.message} (received ${JSON.stringify(i.value)})`);
  writeFileSync(errorsPath, lines.join("\n") + "\n");
  console.error(`${stage}: ${issues.length} issue(s) — written to ${errorsPath}\n` + lines.map((l) => `  - ${l}`).join("\n"));
  process.exit(1);
};

let raw: unknown;
try { raw = JSON.parse(judgmentText); } catch (e) { fail([{ field: judgmentPath, message: `not valid JSON: ${(e as Error).message}`, value: null }], "parse"); }
const parsed = Judgment.safeParse(raw);
if (!parsed.success) fail(parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message, value: null })), "Judgment.parse");
const judgment = parsed.data!;

const facts = projectReportFacts(pack);
const report = mergeReport(facts, judgment, desk, buildDate);
const rp = Report.safeParse(report);
if (!rp.success) fail(rp.error.issues.map((i) => ({ field: i.path.join("."), message: i.message, value: null })), "Report.parse");
const issues = [...validateReport(rp.data), ...validateJudgment(judgment, facts, pack)];
if (issues.length) fail(issues, "validate");

const out = join("data", `${ticker.toLowerCase()}.json`);
writeFileSync(out, JSON.stringify(rp.data, null, 2) + "\n");
if (existsSync(errorsPath)) rmSync(errorsPath);
console.log(`Wrote ${out}\n  ${report.meta.company} · ${report.rating.label} ${report.rating.targetLow}–${report.rating.targetHigh} · report date ${report.meta.reportDate} · ${report.quote.history?.length ?? 0} closes`);
```

`package.json`: add `"synth:prompt": "node --env-file-if-exists=.env.local --import tsx scripts/synth-prompt.ts"` and `"synth:build": "node --env-file-if-exists=.env.local --import tsx scripts/synth-build.ts"`; remove `"report:history"` and `git rm scripts/report-history.ts` (`synth:build` is now the only writer of `data/<ticker>.json`; `quote.history` arrives through the merge).

- [ ] **Step 3: The skill**

`.claude/skills/synthesize/SKILL.md`:
```markdown
---
name: synthesize
description: Author the judgment half of an equity report for a captured filing and build the published Report. Usage — /synthesize <TICKER> <ACCESSION>
---

# Synthesize

You are the `Synthesizer` for this run: the code renders the prompt, you write the judgment, the code validates and merges. Three rounds at most.

## Steps

1. `npm run synth:prompt -- <TICKER> <ACCESSION>` — prints the prompt path and the judgment path.
2. Read the prompt file in full. Write the complete judgment object it asks for to the judgment path (valid JSON, nothing else in the file).
3. `npm run synth:build -- <TICKER> <ACCESSION>`.
4. If it fails: `npm run synth:prompt -- <TICKER> <ACCESSION> --with-errors`, read the new prompt (its last section lists every error), rewrite the **whole** judgment file, and return to step 3. Stop after the third failed build and report the residual errors verbatim.
5. On success report the summary line the build prints and the report path.

## Rules

- The prompt is the only brief. It contains the facts you may quote, the context you may draw on, the contract, and the schema. Do not read the FactPack, the raw captures, or other reports.
- Never edit anything except the judgment file. Never edit the errors file, the prompt file, the facts, or `data/<ticker>.json`.
- Every figure you write must appear in the prompt's Facts or Context block, in the same form. If a claim needs a number the prompt does not contain, make the claim without the number.
```

- [ ] **Step 4: README**

Under "The fact pipeline (subsystem 2)" replace the `report:history` line with nothing and add a new section after it:
```markdown
## Synthesis (subsystem 3)

```bash
npm run synth:prompt -- AVGO 0001730168-26-000080   # FactPack + desk config → data/judgment/AVGO/<acc>.prompt.md
/synthesize AVGO 0001730168-26-000080               # in Claude Code: writes data/judgment/AVGO/<acc>.json, then builds
npm run synth:build  -- AVGO 0001730168-26-000080   # judgment + facts → validated data/avgo.json (or an errors file)
```

The model writes only the judgment (`lib/synth/judgment.schema.ts`); code sets everything derivable, checks the rating against the
scenarios' probability-weighted upside, lints the Markdown, and verifies that every figure in the prose exists in the FactPack or
the captured context (`lib/synth/grounding.ts`). Desk identity and house style live in `data/desk/desk.json`. The hand-built
report that seeded the project is now the test fixture `lib/__fixtures__/avgo-golden.json`.
```
In "Pipeline flow", make step 3 the synthesis (`/synthesize`, `synth:build`) and drop any mention of `report:history`. Update the "Data" / directory tree if the README has one (`data/desk/`, `data/judgment/`, `lib/synth/`).

- [ ] **Step 5: Verify** — `npm test` (green; the deleted script had no test of its own — confirm with `grep -rn report-history --include=*.test.* .`), `npx tsc --noEmit -p .`, `npx eslint lib scripts`. Smoke the CLIs without a judgment: `npm run synth:prompt -- AVGO 0001730168-26-000080` writes the prompt (paste the printed line); `npm run synth:build -- AVGO 0001730168-26-000080` exits 2 naming the missing judgment file.

- [ ] **Step 6: Commit** — `git add -A package.json scripts .claude README.md && git commit -m "feat: synth:prompt and synth:build CLIs, the /synthesize skill, docs"`

---

## Task 8: The real AVGO run

**Files:**
- Create (by running the loop): `data/judgment/AVGO/0001730168-26-000080.json`
- Modify (by running the loop): `data/avgo.json` — becomes the generated report
- Modify: `docs/superpowers/specs/2026-09-13-synthesis-design.md` only if the run reveals a documented behaviour that differs (record in the Revision style used by subsystem 2's spec)

**This task requires a model to author the judgment.** The controller dispatches it to the most capable available model; the implementer *is* the Synthesizer for this run and follows `.claude/skills/synthesize/SKILL.md` exactly.

- [ ] **Step 1: Run the loop** — `/synthesize AVGO 0001730168-26-000080` per the skill: prompt → judgment → build, re-prompting on errors, three rounds at most. Keep a log of each round's error count and the first three errors.

- [ ] **Step 2: Reproducibility** — note the `--date` the successful build used (the build prints the report date); run `npm run synth:build -- AVGO 0001730168-26-000080 --date <that date>` again and confirm `git status --short` shows `data/avgo.json` unchanged by the second run.

- [ ] **Step 3: Verify** — `npm test` (the golden-based tests are unaffected; 190 + the new suites), `npx tsc --noEmit -p .`, `npx eslint lib scripts`, `npm run build` (renders `/research/avgo` from the generated report). Read `data/avgo.json` once and check by eye: the rating, the thesis, one commentary — no `null`, no HTML, figures that appear in the prompt.

- [ ] **Step 4: Commit** — `git add data/judgment data/avgo.json && git commit -m "feat: first generated report — Broadcom 10-Q judgment and the merged AVGO report"`. Report: the round log, the final build summary line, the reproducibility check, and anything the prompt or validator should say differently (for the controller to ledger, not to fix here).

**Controller step after Task 8 (not dispatched):** start the dev server and screenshot `/research/avgo` in both themes at desktop and phone width for the user, as in subsystem 1.

---

## Self-Review

**Spec coverage.** Decisions 1, 2 → Tasks 5 (seam), 7 (skill loop). Decision 3 + Validation/Grounding → Tasks 3, 6. Decision 4 + rating envelope → Task 6. Decision 5 + the Judgment contract table → Task 2. Decision 6 + the prompt → Task 4. Decision 7 (company-only multiples) → Task 5. Decision 8 (fixture move) → Task 1. Decision 9 (desk config) → Task 1. Decision 10 (commit/ignore rules) → Tasks 1, 7. Merge details incl. `--date` reproducibility → Tasks 5, 7, 8. Error handling (exit codes, errors file, no partial report) → Task 7. Testing section → Tasks 1–6, 8. README → Task 7.

**Type consistency.** `ValidationIssue` is `lib/validate.ts`'s `{ field, message, value }` everywhere. `NumberToken` (Task 3) is consumed by `AllowedIndex.has`. `renderFactsBlock(facts, pack)` (Task 4) is called by `validateJudgment` (Task 6) with the same argument order. `mergeReport(facts, judgment, desk, buildDate)` (Task 5) is called by `synth-build.ts` (Task 7). `RatingLabel` (Task 2) keys `ENVELOPES` (Task 6). `ReportFacts.quote.history` (Task 5) is what `mergeReport` passes through. `Desk` (Task 1) is consumed by Tasks 4, 5, 7.

**Placeholder scan.** Task 6 Step 4 asks the implementer to fill the golden miss list from a real run; the procedure (confirm each entry is absent, fix the tokenizer if not) is explicit, so this is a calibration step, not a gap. No TBDs.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks. Task 8 needs the most capable model as the author.
2. **Inline Execution** — tasks executed in this session with batch checkpoints.
