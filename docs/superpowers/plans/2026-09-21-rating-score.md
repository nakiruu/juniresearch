# Rating Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive the rating label from two computed numbers — expected upside `E` and bear-case downside `D`, with reward/risk `R = E ÷ D` — enforce a bear-depth floor, show the three numbers beside the rating, and render the thresholds into the authoring prompt from `desk.json`.

**Architecture:** A new pure module `lib/synth/conviction.ts` computes `{ E, D, R }` from the existing scenarios and derives a label from `desk.rating`. `validateJudgment` replaces the overlapping one-dimensional envelope with the derived label + a one-notch-conservative rule + the bear floor; `mergeReport` writes an **optional** `rating.conviction` onto the Report; `RatingBlock` renders it as a third row; `renderPrompt` renders the Calls text from `desk.rating`; a new lint rule warns on a target low below price on a buy. The `Judgment` schema does not change and no published report is touched.

**Tech Stack:** TypeScript (strict), Zod, Vitest (+ @testing-library/react for the component test), Next.js app. Run tests with `npx vitest run <file>`.

**Spec:** `docs/superpowers/specs/2026-09-21-rating-score-design.md`

**Two rulings on file placement (behavior identical to the spec):**
- `computeConviction` / `deriveLabel` live in a new `lib/synth/conviction.ts`, not `lib/format.ts`. `format.ts` is a zero-import presentation module; these functions need `DeskRating` (a synth type) and are not presentation. Only the `rewardRiskText` formatter goes in `format.ts`.
- The target-low rule lives in `lib/synth/lint/rules/rating.ts` and is called by `lintJudgment` when a `{ currentPrice }` context is passed. A `LintRule` receives prose `SectionUnit`s only (no rating fields, no price), so it cannot be registered in `RULES`.

## Global Constraints

- The `Judgment` schema (`lib/synth/judgment.schema.ts`) is not modified; every existing `data/judgment/**/*.json` must still parse.
- `Report.rating.conviction` is **optional**; `Report.parse` of every existing `data/*.json` and of `lib/__fixtures__/avgo-golden.json` must still succeed.
- Every threshold is read from `desk.rating` (defaults `bearFloor 0.15`, `strongBuy { minUpside 0.20, minRewardRisk 1.0 }`, `buy { minUpside 0.10, minRewardRisk 0.5 }`, `sell { maxUpside -0.05 }`, `strongSell { maxUpside -0.20 }`); no threshold is typed into prose or a message — the prompt and the validator interpolate the same config.
- Label derivation order is fixed: STRONG SELL, SELL, STRONG BUY, BUY, else HOLD. `R` is `null` iff `D ≤ 0`; a `null` `R` never satisfies a `≥` test.
- The author's label must equal the derived label or be exactly one notch more conservative: STRONG BUY→BUY, BUY→HOLD, SELL→HOLD, STRONG SELL→SELL; HOLD has no alternative. Anything else is a build error.
- Bear floor is a build **error** (`bear > price × (1 − bearFloor)`); target-low-below-price on a buy (and target-high-above-price on a sell) is a lint **warning**.
- Displayed formats: `E` and `D` via `pct(x, { signed: true })` with `D` shown as a negative move (`pct(-D, …)`); `R` via `rewardRiskText` → two decimals + `×`, or `—` for `null`.
- Existing checks stay exactly as they are: probabilities sum to 1 (±0.001), bull ≥ base ≥ bear, exact scenario names, range brackets Base, `targetLow < targetHigh`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS`

---

### Task 1: `DeskRating` config block

**Files:**
- Modify: `lib/synth/desk.schema.ts` (add `DESK_RATING_DEFAULTS`, `DeskRating`; add `rating` to `Desk`)
- Modify: `data/desk/desk.json` (add the `rating` block explicitly)
- Test: `lib/synth/desk.schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const DESK_RATING_DEFAULTS`, `export const DeskRating` (Zod), `export type DeskRating = { bearFloor: number; strongBuy: { minUpside: number; minRewardRisk: number }; buy: { minUpside: number; minRewardRisk: number }; sell: { maxUpside: number }; strongSell: { maxUpside: number } }`, and `Desk` now has `rating: DeskRating`. Tasks 2, 3, 5, 6 read `desk.rating`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/synth/desk.schema.test.ts` (keep the existing imports; add `DESK_RATING_DEFAULTS` to the import from `@/lib/synth/desk.schema`):

```ts
describe("Desk.rating", () => {
  const base = { analyst: "a", analystName: "b", disclaimer: "c", styleRules: ["one", "two", "three"] };

  it("fills the rating block with the desk defaults when it is absent", () => {
    const desk = Desk.parse(base);
    expect(desk.rating).toEqual({
      bearFloor: 0.15,
      strongBuy: { minUpside: 0.2, minRewardRisk: 1.0 },
      buy: { minUpside: 0.1, minRewardRisk: 0.5 },
      sell: { maxUpside: -0.05 },
      strongSell: { maxUpside: -0.2 },
    });
    expect(desk.rating).toEqual(DESK_RATING_DEFAULTS);
  });

  it("takes overrides and keeps the untouched keys at their defaults", () => {
    const desk = Desk.parse({ ...base, rating: { bearFloor: 0.2, strongBuy: { minUpside: 0.25, minRewardRisk: 0.75 } } });
    expect(desk.rating.bearFloor).toBe(0.2);
    expect(desk.rating.strongBuy).toEqual({ minUpside: 0.25, minRewardRisk: 0.75 });
    expect(desk.rating.buy).toEqual(DESK_RATING_DEFAULTS.buy);
  });

  it.each([
    ["bearFloor at 0", { bearFloor: 0 }],
    ["bearFloor at 1", { bearFloor: 1 }],
    ["buy.minUpside not below strongBuy.minUpside", { buy: { minUpside: 0.2, minRewardRisk: 0.5 } }],
    ["buy.minRewardRisk above strongBuy.minRewardRisk", { buy: { minUpside: 0.1, minRewardRisk: 1.5 } }],
    ["sell.maxUpside not negative", { sell: { maxUpside: 0 } }],
    ["strongSell.maxUpside not below sell.maxUpside", { strongSell: { maxUpside: -0.05 } }],
    ["a zero reward/risk floor", { buy: { minUpside: 0.1, minRewardRisk: 0 } }],
  ])("rejects %s", (_name, rating) => {
    expect(() => Desk.parse({ ...base, rating })).toThrow();
  });

  it("carries the rating block explicitly in the committed desk.json", () => {
    const raw = JSON.parse(readFileSync("data/desk/desk.json", "utf8")) as Record<string, unknown>;
    expect(raw.rating).toEqual(DESK_RATING_DEFAULTS);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/synth/desk.schema.test.ts`
Expected: FAIL — `DESK_RATING_DEFAULTS` is not exported; `desk.rating` is `undefined`.

- [ ] **Step 3: Implement the config block**

In `lib/synth/desk.schema.ts`, after `DeskReview` and before `Desk`:

```ts
/** Rating thresholds: the prompt renders them and validate-judgment enforces them from this one source. */
export const DESK_RATING_DEFAULTS = {
  bearFloor: 0.15,
  strongBuy: { minUpside: 0.2, minRewardRisk: 1.0 },
  buy: { minUpside: 0.1, minRewardRisk: 0.5 },
  sell: { maxUpside: -0.05 },
  strongSell: { maxUpside: -0.2 },
};

const BuyBand = (d: { minUpside: number; minRewardRisk: number }) =>
  z.strictObject({
    minUpside: z.number().gt(0).lt(1).default(d.minUpside),
    minRewardRisk: z.number().gt(0).default(d.minRewardRisk),
  }).default(() => ({ ...d }));
const SellBand = (d: { maxUpside: number }) =>
  z.strictObject({ maxUpside: z.number().lt(0).gt(-1).default(d.maxUpside) }).default(() => ({ ...d }));

export const DeskRating = z
  .strictObject({
    bearFloor: z.number().gt(0).lt(1).default(DESK_RATING_DEFAULTS.bearFloor),
    strongBuy: BuyBand(DESK_RATING_DEFAULTS.strongBuy),
    buy: BuyBand(DESK_RATING_DEFAULTS.buy),
    sell: SellBand(DESK_RATING_DEFAULTS.sell),
    strongSell: SellBand(DESK_RATING_DEFAULTS.strongSell),
  })
  .refine((r) => r.buy.minUpside < r.strongBuy.minUpside, { message: "buy.minUpside must be below strongBuy.minUpside" })
  .refine((r) => r.buy.minRewardRisk <= r.strongBuy.minRewardRisk, { message: "buy.minRewardRisk must not exceed strongBuy.minRewardRisk" })
  .refine((r) => r.strongSell.maxUpside < r.sell.maxUpside, { message: "strongSell.maxUpside must be below sell.maxUpside" })
  .default(() => structuredClone(DESK_RATING_DEFAULTS));
export type DeskRating = z.infer<typeof DeskRating>;
```

Then add `rating: DeskRating,` to the `Desk` object (after `review`).

In `data/desk/desk.json`, add after the `"review"` entry:

```json
  "rating": {
    "bearFloor": 0.15,
    "strongBuy": { "minUpside": 0.2, "minRewardRisk": 1.0 },
    "buy": { "minUpside": 0.1, "minRewardRisk": 0.5 },
    "sell": { "maxUpside": -0.05 },
    "strongSell": { "maxUpside": -0.2 }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/synth/desk.schema.test.ts`
Expected: PASS (all prior tests plus the new block).

- [ ] **Step 5: Commit**

```bash
git add lib/synth/desk.schema.ts data/desk/desk.json lib/synth/desk.schema.test.ts
git commit -m "feat(desk): rating thresholds block with defaults and refinements

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 2: `computeConviction`, `deriveLabel`, `rewardRiskText`

**Files:**
- Create: `lib/synth/conviction.ts`
- Modify: `lib/format.ts` (add `rewardRiskText` after `computeScenarios`)
- Test: `lib/synth/conviction.test.ts` (new), `lib/format.test.ts`

**Interfaces:**
- Consumes: `computeScenarios`, `upside`, `ScenarioIn` from `lib/format.ts`; `RatingLabel` (type) from `lib/synth/judgment.schema.ts`; `DeskRating` (type) from Task 1.
- Produces:
  - `export interface Conviction { expectedUpside: number; bearDownside: number; rewardRisk: number | null }`
  - `export function computeConviction(scenarios: ScenarioIn[], price: number): Conviction`
  - `export function deriveLabel(c: Conviction, cfg: DeskRating): RatingLabel`
  - `export function conservativeNotch(label: RatingLabel): RatingLabel | null` — the one-notch-more-conservative alternative, or `null` for HOLD.
  - `export function rewardRiskText(r: number | null): string` in `lib/format.ts`.

- [ ] **Step 1: Write the failing tests**

Create `lib/synth/conviction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeConviction, deriveLabel, conservativeNotch, type Conviction } from "@/lib/synth/conviction";
import { DESK_RATING_DEFAULTS } from "@/lib/synth/desk.schema";

const cfg = DESK_RATING_DEFAULTS;
const shape = (bull: number, base: number, bear: number) => [
  { name: "Bull", driver: "x", impliedPrice: bull, probability: 0.3 },
  { name: "Base", driver: "x", impliedPrice: base, probability: 0.5 },
  { name: "Bear", driver: "x", impliedPrice: bear, probability: 0.2 },
];

describe("computeConviction (price 100, probabilities 0.3/0.5/0.2)", () => {
  it("works one shape by hand: fair value 131 → E 0.31, bear 80 → D 0.20, R 1.55", () => {
    const c = computeConviction(shape(150, 140, 80), 100);
    expect(c.expectedUpside).toBeCloseTo(0.31, 10);
    expect(c.bearDownside).toBeCloseTo(0.2, 10);
    expect(c.rewardRisk).toBeCloseTo(1.55, 10);
  });
  it("finds the bear by name regardless of order", () => {
    const reordered = [shape(150, 140, 80)[2], shape(150, 140, 80)[0], shape(150, 140, 80)[1]];
    expect(computeConviction(reordered, 100).bearDownside).toBeCloseTo(0.2, 10);
  });
  it("returns a null reward/risk when the bear is at or above the price", () => {
    expect(computeConviction(shape(150, 140, 100), 100).rewardRisk).toBeNull();
    expect(computeConviction(shape(150, 140, 105), 100).rewardRisk).toBeNull();
    expect(computeConviction(shape(150, 140, 105), 100).bearDownside).toBeCloseTo(-0.05, 10);
  });
});

describe("deriveLabel at the band boundaries", () => {
  const c = (expectedUpside: number, bearDownside: number, rewardRisk: number | null): Conviction => ({ expectedUpside, bearDownside, rewardRisk });
  it.each<[string, Conviction, string]>([
    ["strong buy at both thresholds", c(0.2, 0.2, 1.0), "STRONG BUY"],
    ["just under the strong-buy upside", c(0.199, 0.1, 1.99), "BUY"],
    ["just under the strong-buy ratio", c(0.3, 0.31, 0.99), "BUY"],
    ["buy at both thresholds", c(0.1, 0.2, 0.5), "BUY"],
    ["just under the buy upside", c(0.099, 0.1, 0.99), "HOLD"],
    ["just under the buy ratio (the AMD shape)", c(0.121, 0.326, 0.37), "HOLD"],
    ["positive but small", c(0.014, 0.167, 0.08), "HOLD"],
    ["flat", c(0, 0.2, 0), "HOLD"],
    ["just above the sell line", c(-0.049, 0.2, null), "HOLD"],
    ["sell at the line", c(-0.05, 0.2, null), "SELL"],
    ["just above the strong-sell line", c(-0.199, 0.3, null), "SELL"],
    ["strong sell at the line", c(-0.2, 0.3, null), "STRONG SELL"],
    ["a null ratio never earns a buy", c(0.5, 0, null), "HOLD"],
  ])("%s → %s", (_n, conv, label) => {
    expect(deriveLabel(conv, cfg)).toBe(label);
  });
});

describe("conservativeNotch", () => {
  it.each([
    ["STRONG BUY", "BUY"], ["BUY", "HOLD"], ["SELL", "HOLD"], ["STRONG SELL", "SELL"],
  ] as const)("%s → %s", (from, to) => expect(conservativeNotch(from)).toBe(to));
  it("has no alternative for HOLD", () => expect(conservativeNotch("HOLD")).toBeNull());
});
```

Append to `lib/format.test.ts` (add `rewardRiskText` to the import from `@/lib/format`):

```ts
describe("rewardRiskText", () => {
  it("renders two decimals with a multiplication sign", () => {
    expect(rewardRiskText(0.66)).toBe("0.66×");
    expect(rewardRiskText(1)).toBe("1.00×");
    expect(rewardRiskText(1.548)).toBe("1.55×");
  });
  it("renders an em dash for a null ratio", () => {
    expect(rewardRiskText(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/synth/conviction.test.ts lib/format.test.ts`
Expected: FAIL — module `@/lib/synth/conviction` not found; `rewardRiskText` is not exported.

- [ ] **Step 3: Implement**

Create `lib/synth/conviction.ts`:

```ts
/**
 * conviction.ts — the two numbers the rating rests on, and the label they imply.
 * -----------------------------------------------------------------------------
 * Expected upside E is the probability-weighted fair value against the current
 * price; bear-case downside D is the bear implied price against the current price
 * (a positive magnitude); reward/risk R = E / D is the upside earned per unit of
 * bear-case loss, null when the bear is not below the price. The label is a
 * function of (E, R) with no overlap zone; the author may sit one notch more
 * conservative than it (see conservativeNotch), never more aggressive.
 */
import { computeScenarios, upside, type ScenarioIn } from "../format";
import type { RatingLabel } from "./judgment.schema";
import type { DeskRating } from "./desk.schema";

export interface Conviction {
  expectedUpside: number;
  bearDownside: number;
  rewardRisk: number | null;
}

export function computeConviction(scenarios: ScenarioIn[], price: number): Conviction {
  const { fairValue } = computeScenarios(scenarios);
  const expectedUpside = upside(fairValue, price);
  const bear = scenarios.find((s) => /bear/i.test(s.name));
  const bearDownside = bear ? (price - bear.impliedPrice) / price : 0;
  const rewardRisk = bearDownside > 0 ? expectedUpside / bearDownside : null;
  return { expectedUpside, bearDownside, rewardRisk };
}

/** Evaluated top to bottom; the first band that matches wins. A null R never satisfies a ≥ test. */
export function deriveLabel(c: Conviction, cfg: DeskRating): RatingLabel {
  const r = c.rewardRisk;
  if (c.expectedUpside <= cfg.strongSell.maxUpside) return "STRONG SELL";
  if (c.expectedUpside <= cfg.sell.maxUpside) return "SELL";
  if (c.expectedUpside >= cfg.strongBuy.minUpside && r != null && r >= cfg.strongBuy.minRewardRisk) return "STRONG BUY";
  if (c.expectedUpside >= cfg.buy.minUpside && r != null && r >= cfg.buy.minRewardRisk) return "BUY";
  return "HOLD";
}

const NOTCH: Record<RatingLabel, RatingLabel | null> = {
  "STRONG BUY": "BUY", BUY: "HOLD", HOLD: null, SELL: "HOLD", "STRONG SELL": "SELL",
};
/** The one label an author may choose instead of the derived one — a step toward HOLD. */
export const conservativeNotch = (label: RatingLabel): RatingLabel | null => NOTCH[label];
```

In `lib/format.ts`, after `computeScenarios`:

```ts
/** "0.66×" — reward/risk to two decimals; an em dash when the bear is not below the price. */
export const rewardRiskText = (r: number | null): string => (r == null ? "—" : `${num(r, 2)}×`);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/synth/conviction.test.ts lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/synth/conviction.ts lib/synth/conviction.test.ts lib/format.ts lib/format.test.ts
git commit -m "feat(synth): computeConviction, deriveLabel, conservativeNotch and the reward/risk formatter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 3: Validator — derived label, one-notch rule, bear floor, quotable lines

**Files:**
- Modify: `lib/synth/validate-judgment.ts` (replace `ENVELOPES` and the envelope check in `ratingIssues`; extend `renderJudgmentBlock`; `validateJudgment` gains `desk`)
- Modify: `scripts/synth-build.ts:48` (pass `desk` to `validateJudgment`)
- Test: `lib/synth/validate-judgment.test.ts`

**Interfaces:**
- Consumes: `computeConviction`, `deriveLabel`, `conservativeNotch` (Task 2); `rewardRiskText` (Task 2); `DeskRating`, `Desk` (Task 1).
- Produces: `ratingIssues(j: Judgment, currentPrice: number, cfg: DeskRating): ValidationIssue[]`; `validateJudgment(j: Judgment, facts: ReportFacts, pack: FactPack, desk: Desk): ValidationIssue[]`; `renderJudgmentBlock(j, currentPrice)` now ends with three lines `Expected upside …`, `Bear-case downside …`, `Reward/risk …`. `ENVELOPES` is removed.

- [ ] **Step 1: Rewrite the envelope tests and add the new ones**

In `lib/synth/validate-judgment.test.ts`, add to the imports:

```ts
import { Desk, DESK_RATING_DEFAULTS } from "@/lib/synth/desk.schema";
import { pct, rewardRiskText } from "@/lib/format";
import { computeConviction } from "@/lib/synth/conviction";
```

and after `const golden = …` add `const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));` and `const cfg = DESK_RATING_DEFAULTS;`.

Replace the whole `describe("rating envelope (price 100)", …)` block with:

```ts
describe("rating label vs the derived label (price 100, probabilities 0.3/0.5/0.2, bears at least 15% below)", () => {
  // Shapes and their derived labels (E = weighted fair value / 100 − 1; D = (100 − bear) / 100; R = E / D):
  //   A [150,140,80]  E 0.31   D 0.20 R 1.55 → STRONG BUY
  //   B [130,115,80]  E 0.125  D 0.20 R 0.63 → BUY
  //   C [150,110,65]  E 0.13   D 0.35 R 0.37 → HOLD   (the AMD shape: upside bought with a deep bear)
  //   D [100,90,80]   E −0.09           → SELL
  //   E [85,70,50]    E −0.295          → STRONG SELL
  const A: [number, number, number] = [150, 140, 80], B: [number, number, number] = [130, 115, 80],
    C: [number, number, number] = [150, 110, 65], D: [number, number, number] = [100, 90, 80], E: [number, number, number] = [85, 70, 50];
  const table: [Judgment["rating"]["label"], [number, number, number], boolean][] = [
    ["STRONG BUY", A, true], ["BUY", A, true], ["HOLD", A, false],
    ["BUY", B, true], ["HOLD", B, true], ["STRONG BUY", B, false],
    ["HOLD", C, true], ["BUY", C, false], ["STRONG BUY", C, false],
    ["SELL", D, true], ["HOLD", D, true], ["BUY", D, false], ["STRONG SELL", D, false],
    ["STRONG SELL", E, true], ["SELL", E, true], ["HOLD", E, false],
  ];
  for (const [label, prices, ok] of table)
    it(`${label} at ${prices.join("/")} ${ok ? "passes" : "fails"}`, () => {
      const issues = ratingIssues(withRating(label, prices), 100, cfg).filter((i) => i.field === "rating.label");
      expect(issues.length === 0).toBe(ok);
      if (!ok) expect(issues[0].message).toMatch(/is inconsistent with the derived/);
    });
  it("names the derived label and the allowed set in the message", () => {
    const [issue] = ratingIssues(withRating("BUY", C), 100, cfg).filter((i) => i.field === "rating.label");
    expect(issue.message).toBe("BUY is inconsistent with the derived HOLD (expected upside +13.0%, reward/risk 0.37×); allowed: HOLD");
    const [up] = ratingIssues(withRating("HOLD", A), 100, cfg).filter((i) => i.field === "rating.label");
    expect(up.message).toMatch(/allowed: STRONG BUY or BUY$/);
  });
  it("requires bull ≥ base ≥ bear when the names say so", () => {
    const j = withRating("BUY", [140, 150, 80]);
    expect(ratingIssues(j, 100, cfg).map((i) => i.field)).toContain("sections.valuation.scenarios");
  });
});

describe("bear-depth floor (price 100, floor 15%)", () => {
  const bearIssues = (bear: number) =>
    ratingIssues(withRating("HOLD", [150, 140, bear]), 100, cfg).filter((i) => i.field === "sections.valuation.scenarios[bear].impliedPrice");
  it("passes a bear exactly at the floor and below it", () => {
    expect(bearIssues(85)).toEqual([]);
    expect(bearIssues(84)).toEqual([]);
  });
  it("fails a bear inside the floor, naming the shortfall and the floor", () => {
    const [issue] = bearIssues(86);
    expect(issue.message).toBe("bear case $86.00 is only 14.0% below the price; the desk floor is 15.0% — a bear scenario is a real scenario, not a formality");
    expect(issue.value).toBe(86);
  });
  it("fails a bear at or above the price", () => {
    expect(bearIssues(100)).toHaveLength(1);
    expect(bearIssues(110)).toHaveLength(1);
  });
  it("reads the floor from the config", () => {
    expect(ratingIssues(withRating("HOLD", [150, 140, 86]), 100, { ...cfg, bearFloor: 0.1 }).filter((i) => /bear case/.test(i.message))).toEqual([]);
  });
});
```

Replace the `renderJudgmentBlock` test with:

```ts
describe("renderJudgmentBlock", () => {
  it("renders the calls and the page's derived values so the prose may quote them", () => {
    const block = renderJudgmentBlock(golden, pack.quote.price);
    expect(block).toContain("Target range $440.00–$525.00 (+21.6% to +45.0%)");
    expect(block).toContain("Probability-weighted fair value $485.00 (+34.0%)");
    expect(block).toMatch(/Base: \$490\.00 × 50% = \$245\.00/);
  });
  it("ends with expected upside, bear-case downside and reward/risk in the page's format", () => {
    const c = computeConviction(golden.sections.valuation.scenarios, pack.quote.price);
    const lines = renderJudgmentBlock(golden, pack.quote.price).split("\n").slice(-3);
    expect(lines).toEqual([
      `Expected upside ${pct(c.expectedUpside, { signed: true })}`,
      `Bear-case downside ${pct(-c.bearDownside, { signed: true })}`,
      `Reward/risk ${rewardRiskText(c.rewardRisk)}`,
    ]);
    expect(lines[0]).toBe("Expected upside +34.0%");
    expect(lines[1]).toBe("Bear-case downside -17.1%");
    expect(lines[2]).toBe("Reward/risk 1.98×");
  });
});
```

Update all three `validateJudgment(…, facts, pack)` calls in the golden tests — the two on `golden` and the one on `withDupes` in "also runs the highlight checks" — to pass `desk` as the fourth argument, and add to the golden block:

```ts
  it("derives STRONG BUY for the golden (E +34.0%, D 17.1%, R 1.98; bear $300 clears the $307.69 floor) and accepts its one-notch-conservative BUY", () => {
    expect(validateJudgment(golden, facts, pack, desk).filter((i) => i.field === "rating.label")).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/synth/validate-judgment.test.ts`
Expected: FAIL — `ratingIssues` ignores the third argument and still uses `ENVELOPES`; the bear-floor field never appears; `renderJudgmentBlock` lacks the three lines.

- [ ] **Step 3: Implement**

In `lib/synth/validate-judgment.ts`:

Replace the imports of `computeScenarios, pct, usd, upside, upsideRangeText` with:

```ts
import { computeScenarios, pct, usd, upside, upsideRangeText, rewardRiskText } from "../format";
import type { Desk, DeskRating } from "./desk.schema";
import { computeConviction, deriveLabel, conservativeNotch } from "./conviction";
```

Delete the `ENVELOPES` constant and its doc comment. Replace `ratingIssues` with:

```ts
/** The label must be the derived label or one notch more conservative; the bear must sit below the desk floor. */
export function ratingIssues(j: Judgment, currentPrice: number, cfg: DeskRating): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scenarios = j.sections.valuation.scenarios;
  const c = computeConviction(scenarios, currentPrice);
  const derived = deriveLabel(c, cfg);
  const alt = conservativeNotch(derived);
  if (j.rating.label !== derived && j.rating.label !== alt)
    issues.push({
      field: "rating.label",
      message: `${j.rating.label} is inconsistent with the derived ${derived} (expected upside ${pct(c.expectedUpside, { signed: true })}, reward/risk ${rewardRiskText(c.rewardRisk)}); allowed: ${derived}${alt ? ` or ${alt}` : ""}`,
      value: j.rating.label,
    });
  const bear = scenarios.find((s) => /bear/i.test(s.name));
  if (bear && bear.impliedPrice > currentPrice * (1 - cfg.bearFloor))
    issues.push({
      field: "sections.valuation.scenarios[bear].impliedPrice",
      message: `bear case ${usd(bear.impliedPrice)} is only ${pct(c.bearDownside)} below the price; the desk floor is ${pct(cfg.bearFloor)} — a bear scenario is a real scenario, not a formality`,
      value: bear.impliedPrice,
    });
  const names = scenarios.map((s) => s.name.trim());
  const WANT_NAMES = ["Bull", "Base", "Bear"];
  if (names.length !== WANT_NAMES.length || !WANT_NAMES.every((w) => names.includes(w)))
    issues.push({ field: "sections.valuation.scenarios[].name", message: "scenarios must be named exactly Bull, Base and Bear", value: names });
  const byName = (re: RegExp) => scenarios.find((s) => re.test(s.name))?.impliedPrice;
  const bull = byName(/bull/i), base = byName(/base/i), bearPrice = byName(/bear/i);
  if (bull != null && base != null && bearPrice != null && !(bull >= base && base >= bearPrice))
    issues.push({ field: "sections.valuation.scenarios", message: "implied prices must satisfy bull ≥ base ≥ bear", value: [bull, base, bearPrice] });
  return issues;
}
```

In `renderJudgmentBlock`, add after the fair-value line (inside the array):

```ts
    ...(() => {
      const c = computeConviction(j.sections.valuation.scenarios, currentPrice);
      return [
        `Expected upside ${pct(c.expectedUpside, { signed: true })}`,
        `Bear-case downside ${pct(-c.bearDownside, { signed: true })}`,
        `Reward/risk ${rewardRiskText(c.rewardRisk)}`,
      ];
    })(),
```

Change `validateJudgment` to:

```ts
export function validateJudgment(j: Judgment, facts: ReportFacts, pack: FactPack, desk: Desk): ValidationIssue[] {
  const index = buildAllowedIndex(pack, [renderFactsBlock(facts, pack), renderJudgmentBlock(j, pack.quote.price)]);
  return [
    ...ratingIssues(j, pack.quote.price, desk.rating),
    ...segmentIssues(j, facts),
    ...highlightIssues(j, facts),
    ...markdownIssues(j),
    ...checkGrounding(j, index),
  ];
}
```

In `scripts/synth-build.ts` line 48, change `validateJudgment(judgment, facts, pack)` to `validateJudgment(judgment, facts, pack, desk)`.

Note on the bear-floor message: `pct(c.bearDownside)` (unsigned, 1 dp) renders `14.0%` for a bear at 86; `pct(cfg.bearFloor)` renders `15.0%`. The test asserts exactly those strings.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/synth/validate-judgment.test.ts && npx tsc --noEmit -p .`
Expected: PASS, and no type errors (the only other `validateJudgment` caller is `scripts/synth-build.ts`, updated above).

- [ ] **Step 5: Commit**

```bash
git add lib/synth/validate-judgment.ts lib/synth/validate-judgment.test.ts scripts/synth-build.ts
git commit -m "feat(validate): derive the label from expected upside and reward/risk; one-notch rule; bear-depth floor

Replaces the overlapping one-dimensional ENVELOPES with the 2-D rule from desk.rating.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 4: Lint warning — target low below price on a buy

**Files:**
- Create: `lib/synth/lint/rules/rating.ts`
- Modify: `lib/synth/lint/index.ts` (`lintJudgment` gains an optional context and calls the rule)
- Modify: `scripts/synth-build.ts:49` (pass `{ currentPrice: pack.quote.price }`)
- Test: `lib/synth/lint/rules/rating.test.ts` (new), `lib/synth/lint/index.test.ts`

**Interfaces:**
- Consumes: `LintIssue` from `lib/synth/lint/index.ts`; `Judgment` type; `usd`, `pct` from `lib/format.ts`.
- Produces: `export function ratingLint(judgment: Judgment, ctx: { currentPrice: number }): LintIssue[]` (rule name `target-low`, severity `warning`); `lintJudgment(judgment: Judgment, desk: Desk, ctx?: { currentPrice: number }): LintIssue[]`.

- [ ] **Step 1: Write the failing tests**

Create `lib/synth/lint/rules/rating.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Judgment } from "@/lib/synth/judgment.schema";
import { ratingLint } from "@/lib/synth/lint/rules/rating";
import goldenJudgment from "@/lib/__fixtures__/avgo-golden-judgment.json";

const golden = Judgment.parse(goldenJudgment);
const withRange = (label: Judgment["rating"]["label"], targetLow: number, targetHigh: number) => {
  const j = structuredClone(golden); j.rating = { label, targetLow, targetHigh }; return j;
};
const price = 361.99;

describe("target-low (price 361.99)", () => {
  it("warns on a BUY whose low end sits below the price", () => {
    const [issue] = ratingLint(withRange("BUY", 300, 525), { currentPrice: price });
    expect([issue.rule, issue.severity, issue.field, issue.value]).toEqual(["target-low", "warning", "rating.targetLow", 300]);
    expect(issue.message).toBe("target low $300.00 sits 17.1% below the price on a BUY, so the upside line will read negative; raise the low end or address it in the prose");
  });
  it("warns on a STRONG BUY the same way, and not when the low end is at or above the price", () => {
    expect(ratingLint(withRange("STRONG BUY", 300, 525), { currentPrice: price })).toHaveLength(1);
    expect(ratingLint(withRange("BUY", 361.99, 525), { currentPrice: price })).toEqual([]);
    expect(ratingLint(withRange("BUY", 400, 525), { currentPrice: price })).toEqual([]);
  });
  it("mirrors on a SELL or STRONG SELL whose high end sits above the price", () => {
    const [issue] = ratingLint(withRange("SELL", 250, 400), { currentPrice: price });
    expect([issue.rule, issue.severity, issue.field, issue.value]).toEqual(["target-low", "warning", "rating.targetHigh", 400]);
    expect(issue.message).toBe("target high $400.00 sits 10.5% above the price on a SELL, so the downside line will read positive; lower the high end or address it in the prose");
    expect(ratingLint(withRange("STRONG SELL", 250, 400), { currentPrice: price })).toHaveLength(1);
    expect(ratingLint(withRange("SELL", 250, 361.99), { currentPrice: price })).toEqual([]);
  });
  it("never warns on a HOLD", () => {
    expect(ratingLint(withRange("HOLD", 300, 400), { currentPrice: price })).toEqual([]);
  });
});
```

Append to `lib/synth/lint/index.test.ts` (it already loads `desk` and imports `cleanJudgment` from `@/lib/synth/lint/__fixtures__/units` — a Judgment with no prose issues; reuse both, no new imports):

```ts
describe("lintJudgment rating context", () => {
  it("emits the target-low warning only when a current price is supplied", () => {
    const j = cleanJudgment(); j.rating = { label: "BUY", targetLow: 300, targetHigh: 525 };
    expect(lintJudgment(j, desk).filter((i) => i.rule === "target-low")).toEqual([]);
    const withCtx = lintJudgment(j, desk, { currentPrice: 361.99 }).filter((i) => i.rule === "target-low");
    expect(withCtx).toHaveLength(1);
    expect(withCtx[0].severity).toBe("warning");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/synth/lint/rules/rating.test.ts lib/synth/lint/index.test.ts`
Expected: FAIL — module `rules/rating` not found; `lintJudgment` ignores a third argument.

- [ ] **Step 3: Implement**

Create `lib/synth/lint/rules/rating.ts`:

```ts
/**
 * target-low — a buy whose range starts below the price (or a sell whose range ends above it).
 * -----------------------------------------------------------------------------
 * The page prints "Upside Potential: <low> to <high>" against the current price, so a BUY with a
 * low end under the price reads as a negative upside. The house's range is a where-it-could-trade
 * band that brackets the base case, not a Street-style target, so this is a warning the author
 * resolves by raising the low end or saying so in the prose — never a build error. It needs the
 * price, which the prose units do not carry, so lintJudgment calls it directly with a context.
 */
import type { Judgment } from "../../judgment.schema";
import type { LintIssue } from "../index";
import { usd, pct } from "../../../format";

export function ratingLint(judgment: Judgment, ctx: { currentPrice: number }): LintIssue[] {
  const { label, targetLow, targetHigh } = judgment.rating;
  const price = ctx.currentPrice;
  if (label.endsWith("BUY") && targetLow < price)
    return [{
      rule: "target-low", severity: "warning", field: "rating.targetLow", value: targetLow,
      message: `target low ${usd(targetLow)} sits ${pct((price - targetLow) / price)} below the price on a ${label}, so the upside line will read negative; raise the low end or address it in the prose`,
    }];
  if (label.endsWith("SELL") && targetHigh > price)
    return [{
      rule: "target-low", severity: "warning", field: "rating.targetHigh", value: targetHigh,
      message: `target high ${usd(targetHigh)} sits ${pct((targetHigh - price) / price)} above the price on a ${label}, so the downside line will read positive; lower the high end or address it in the prose`,
    }];
  return [];
}
```

In `lib/synth/lint/index.ts`, add `import { ratingLint } from "./rules/rating";` and change `lintJudgment` to:

```ts
export function lintJudgment(judgment: Judgment, desk: Desk, ctx?: { currentPrice: number }): LintIssue[] {
  const units = sectionUnits(judgment);
  const issues = RULES.flatMap((rule) => rule(units, desk));
  return ctx ? [...issues, ...ratingLint(judgment, ctx)] : issues;
}
```

In `scripts/synth-build.ts` line 49, change `lintJudgment(judgment, desk)` to `lintJudgment(judgment, desk, { currentPrice: pack.quote.price })`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/synth/lint/ && npx tsc --noEmit -p .`
Expected: PASS across the lint suite; no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/synth/lint/rules/rating.ts lib/synth/lint/rules/rating.test.ts lib/synth/lint/index.ts lib/synth/lint/index.test.ts scripts/synth-build.ts
git commit -m "feat(lint): target-low warning for a buy whose range starts below the price

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 5: `Report.rating.conviction` (optional) set by `mergeReport`

**Files:**
- Modify: `lib/report.schema.ts:85-90` (extract the label enum; add optional `conviction`)
- Modify: `lib/synth/merge.ts` (compute and set `rating.conviction`)
- Test: `lib/report.schema.test.ts` (new), `lib/synth/merge.test.ts`

**Interfaces:**
- Consumes: `computeConviction`, `deriveLabel` (Task 2); `desk.rating` (Task 1).
- Produces: `Report["rating"]["conviction"]?: { expectedUpside: number; bearDownside: number; rewardRisk: number | null; derivedLabel: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL" }`. Task 7 renders it.

- [ ] **Step 1: Write the failing tests**

Create `lib/report.schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { Report } from "@/lib/report.schema";
import avgo from "@/lib/__fixtures__/avgo-golden.json";

describe("Report.rating.conviction is optional", () => {
  it("parses the golden report, which carries no conviction", () => {
    const r = Report.parse(avgo);
    expect(r.rating.conviction).toBeUndefined();
  });
  it("parses every published report in data/ unchanged", () => {
    for (const f of readdirSync("data").filter((f) => /^[a-z]+\.json$/.test(f)))
      expect(() => Report.parse(JSON.parse(readFileSync(`data/${f}`, "utf8"))), f).not.toThrow();
  });
  it("accepts a full conviction block, with a nullable reward/risk", () => {
    const base = { ...avgo, rating: { ...avgo.rating, conviction: { expectedUpside: 0.105, bearDownside: 0.158, rewardRisk: 0.66, derivedLabel: "BUY" } } };
    expect(Report.parse(base).rating.conviction?.rewardRisk).toBe(0.66);
    const nul = { ...avgo, rating: { ...avgo.rating, conviction: { expectedUpside: 0.1, bearDownside: 0, rewardRisk: null, derivedLabel: "HOLD" } } };
    expect(Report.parse(nul).rating.conviction?.rewardRisk).toBeNull();
  });
  it("rejects a derived label outside the enum", () => {
    const bad = { ...avgo, rating: { ...avgo.rating, conviction: { expectedUpside: 0.1, bearDownside: 0.2, rewardRisk: 0.5, derivedLabel: "ACCUMULATE" } } };
    expect(() => Report.parse(bad)).toThrow();
  });
});
```

Append to `lib/synth/merge.test.ts`, inside `describe("mergeReport with the golden judgment and the AVGO facts", …)` (add `import { computeConviction, deriveLabel } from "@/lib/synth/conviction";` to the imports):

```ts
  it("sets rating.conviction from the scenarios, the quote price and the desk thresholds", () => {
    const c = computeConviction(judgment.sections.valuation.scenarios, facts.quote.currentPrice);
    expect(report.rating.conviction).toEqual({ ...c, derivedLabel: deriveLabel(c, desk.rating) });
    expect(report.rating.conviction?.expectedUpside).toBeCloseTo(0.34, 2);
    expect(report.rating.conviction?.bearDownside).toBeCloseTo(0.171, 3); // bear $300 vs $361.99
    expect(report.rating.conviction?.rewardRisk).toBeCloseTo(1.98, 2);
    expect(report.rating.conviction?.derivedLabel).toBe("STRONG BUY");
    expect(report.rating.label).toBe("BUY"); // the author's one-notch-conservative choice is preserved
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/report.schema.test.ts lib/synth/merge.test.ts`
Expected: FAIL — `Report.parse` strips/rejects `conviction` (unknown key) or the merge test finds `conviction` undefined.

- [ ] **Step 3: Implement**

In `lib/report.schema.ts`, replace the `rating` object with:

```ts
const ratingLabel = z.enum(["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"]);

/** Computed by mergeReport from the scenarios and the quote; optional so reports built before it parse. */
const conviction = z.object({
  expectedUpside: z.number(),
  bearDownside: z.number(),
  rewardRisk: z.number().nullable(),
  derivedLabel: ratingLabel,
});

const rating = z.object({
  label: ratingLabel,
  tone: z.enum(["bull", "accent", "secondary", "bear"]).default("bull"),
  targetLow: z.number(),
  targetHigh: z.number(),
  conviction: conviction.optional(),
});
```

In `lib/synth/merge.ts`, add `import { computeConviction, deriveLabel } from "./conviction";` and replace the `rating:` line in `mergeReport` with:

```ts
    rating: (() => {
      const c = computeConviction(j.sections.valuation.scenarios, facts.quote.currentPrice);
      return { label: j.rating.label, tone: toneFor(j.rating.label), targetLow: j.rating.targetLow, targetHigh: j.rating.targetHigh,
        conviction: { ...c, derivedLabel: deriveLabel(c, desk.rating) } };
    })(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/report.schema.test.ts lib/synth/merge.test.ts && npx tsc --noEmit -p .`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/report.schema.ts lib/report.schema.test.ts lib/synth/merge.ts lib/synth/merge.test.ts
git commit -m "feat(report): optional rating.conviction computed by mergeReport

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 6: Calls text rendered from `desk.rating`

**Files:**
- Modify: `lib/synth/prompt.ts:106-111,123` (replace the `CALLS` constant with `renderCalls(desk.rating)`)
- Test: `lib/synth/prompt.test.ts`

**Interfaces:**
- Consumes: `DeskRating` (Task 1); `pct`, `rewardRiskText` from `lib/format.ts`.
- Produces: `export function renderCalls(cfg: DeskRating): string`; `renderPrompt` output's `# Calls` section now interpolates the thresholds.

- [ ] **Step 1: Write the failing tests**

Append to `lib/synth/prompt.test.ts` (add `renderCalls` to the import from `@/lib/synth/prompt`):

```ts
describe("renderCalls", () => {
  it("interpolates the desk thresholds into the rating, bear and target-low rules", () => {
    const calls = renderCalls(desk.rating);
    expect(calls).toContain("STRONG BUY needs E ≥ +20.0% and R ≥ 1.00×; BUY needs E ≥ +10.0% and R ≥ 0.50×; SELL is E ≤ -5.0%; STRONG SELL is E ≤ -20.0%; anything else is HOLD.");
    expect(calls).toContain("one notch more conservative (STRONG BUY→BUY, BUY→HOLD, SELL→HOLD, STRONG SELL→SELL); a more aggressive label fails.");
    expect(calls).toContain("the Bear implied price must sit at least 15.0% below the current price");
    expect(calls).toContain("On a BUY, a target low below the current price");
    expect(calls).toContain("expected upside, bear-case downside and reward/risk");
    expect(calls).not.toMatch(/envelope|−10% to \+15%/);
  });
  it("follows a changed threshold, so the prompt and the validator cannot drift", () => {
    const tuned = Desk.parse({ ...JSON.parse(readFileSync("data/desk/desk.json", "utf8")), rating: { bearFloor: 0.2, strongBuy: { minUpside: 0.25, minRewardRisk: 1.5 } } });
    const calls = renderCalls(tuned.rating);
    expect(calls).toContain("at least 20.0% below");
    expect(calls).toContain("STRONG BUY needs E ≥ +25.0% and R ≥ 1.50×");
  });
  it("is what renderPrompt puts under # Calls", () => {
    expect(renderPrompt(pack, facts, desk)).toContain(`# Calls\n\n${renderCalls(desk.rating)}`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/synth/prompt.test.ts`
Expected: FAIL — `renderCalls` is not exported.

- [ ] **Step 3: Implement**

In `lib/synth/prompt.ts`, add `import { pct, rewardRiskText } from "../format";` and `import type { DeskRating } from "./desk.schema";` (keep the existing `Desk` type import), delete the `CALLS` constant, and add:

```ts
/** The author's calls, with every threshold interpolated from desk.rating — the same numbers validate-judgment enforces. */
export function renderCalls(cfg: DeskRating): string {
  const up = (x: number) => pct(x, { signed: true });
  return `- Scenarios: exactly three, named exactly \`Bull\`, \`Base\`, \`Bear\`, with implied prices Bull ≥ Base ≥ Bear and probabilities that sum to 1.
- Target range: \`targetLow\` < \`targetHigh\`, and the range must bracket the Base implied price.
- Rating: the page derives a label from two numbers you set through the scenarios — expected upside E (probability-weighted fair value vs the current price) and bear-case downside D (Bear implied price vs the current price), with reward/risk R = E ÷ D. STRONG BUY needs E ≥ ${up(cfg.strongBuy.minUpside)} and R ≥ ${rewardRiskText(cfg.strongBuy.minRewardRisk)}; BUY needs E ≥ ${up(cfg.buy.minUpside)} and R ≥ ${rewardRiskText(cfg.buy.minRewardRisk)}; SELL is E ≤ ${up(cfg.sell.maxUpside)}; STRONG SELL is E ≤ ${up(cfg.strongSell.maxUpside)}; anything else is HOLD. Your label must be the derived label or one notch more conservative (STRONG BUY→BUY, BUY→HOLD, SELL→HOLD, STRONG SELL→SELL); a more aggressive label fails.
- Bear case: the Bear implied price must sit at least ${pct(cfg.bearFloor)} below the current price — a bear scenario is a real scenario, not a formality.
- On a BUY, a target low below the current price makes the page's upside line read negative; the lint warns so you can raise it or address it in the prose.
- Numbers you may quote from your own calls: the target range and its upside range, each scenario's weighted value, the weighted fair value, and the expected upside, bear-case downside and reward/risk — the page renders these.
- Scenario probabilities are quotable as percentages (e.g. 48%).
- \`highlights\`: up to four keys from the "Highlight cells you may add" list below, no repeats; the code computes the values, you only choose which keys to append.`;
}
```

In `renderPrompt`, change `` `# Calls\n\n${CALLS}` `` to `` `# Calls\n\n${renderCalls(desk.rating)}` ``.

Note on formats: `pct(0.2, { signed: true })` → `+20.0%`; `pct(-0.05, { signed: true })` → `-5.0%` (the `num` helper's ASCII minus); `rewardRiskText(1)` → `1.00×`; `pct(0.15)` → `15.0%`. The tests assert exactly these.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/synth/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/synth/prompt.ts lib/synth/prompt.test.ts
git commit -m "feat(prompt): render the Calls rules from desk.rating so prompt and validator share one source

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 7: The conviction row in `RatingBlock`, and the full verification

**Files:**
- Modify: `components/report/RatingBlock.tsx`
- Test: `components/report/RatingBlock.test.tsx` (new)

**Interfaces:**
- Consumes: `Report["rating"]["conviction"]` (Task 5); `pct`, `rewardRiskText` from `lib/format.ts`.
- Produces: a third row, rendered only when `rating.conviction` is present, with the text `Expected upside {E} · Bear case {−D} · Reward/risk {R}`. Section 8 reuses `RatingBlock`, so the row appears there too with no change.

- [ ] **Step 1: Write the failing test**

Create `components/report/RatingBlock.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RatingBlock } from "@/components/report/RatingBlock";
import type { Report } from "@/lib/report.schema";

const base: Report["rating"] = { label: "BUY", tone: "bull", targetLow: 345, targetHigh: 455 };
const conviction = { expectedUpside: 0.105, bearDownside: 0.158, rewardRisk: 0.66, derivedLabel: "BUY" as const };

describe("RatingBlock conviction row", () => {
  it("renders expected upside, bear case and reward/risk when conviction is present", () => {
    render(<RatingBlock rating={{ ...base, conviction }} current={368.29} upsideLabel="Upside Potential:" />);
    expect(screen.getByText(/Expected upside \+10\.5% · Bear case -15\.8% · Reward\/risk 0\.66×/)).toBeInTheDocument();
    expect(screen.getByText(/Upside Potential: -6\.3% to \+23\.5%/)).toBeInTheDocument();
  });
  it("renders an em dash for a null reward/risk", () => {
    render(<RatingBlock rating={{ ...base, conviction: { ...conviction, rewardRisk: null } }} current={368.29} upsideLabel="Upside Potential:" />);
    expect(screen.getByText(/Reward\/risk —/)).toBeInTheDocument();
  });
  it("renders no third row for a report built without conviction", () => {
    render(<RatingBlock rating={base} current={368.29} upsideLabel="Upside Potential:" />);
    expect(screen.queryByText(/Reward\/risk/)).toBeNull();
    expect(screen.getByText(/Price Target: \$345\.00 – \$455\.00/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/report/RatingBlock.test.tsx`
Expected: FAIL — the conviction text is not found.

- [ ] **Step 3: Implement**

Replace `components/report/RatingBlock.tsx` with:

```tsx
import { Badge } from "@/components/ui/badge";
import { pct, priceTargetLine, rewardRiskText, upsideRangeText } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

const row = "flex flex-1 items-center border border-l-0 border-hairline bg-surface px-4 py-3 text-[15px] font-bold text-ink";

export function RatingBlock({
  rating, current, upsideLabel,
}: { rating: Report["rating"]; current: number; upsideLabel: string }) {
  const c = rating.conviction;
  return (
    <div className="my-4 flex">
      <Badge
        variant={rating.tone}
        className="flex h-auto w-[34%] self-stretch items-center justify-center p-3.5 font-sans text-[26px] font-extrabold tracking-[2px]"
      >
        {rating.label}
      </Badge>
      <div className="flex w-[66%] flex-col">
        <div className={row}>{priceTargetLine(rating.targetLow, rating.targetHigh)}</div>
        <div className={`${row} border-t-0`}>
          {upsideLabel} {upsideRangeText(rating.targetLow, rating.targetHigh, current)}
        </div>
        {c && (
          <div className={`${row} border-t-0`}>
            Expected upside {pct(c.expectedUpside, { signed: true })} · Bear case {pct(-c.bearDownside, { signed: true })} · Reward/risk {rewardRiskText(c.rewardRisk)}
          </div>
        )}
      </div>
    </div>
  );
}
```

(The two existing rows keep their exact classes; the shared `row` string is those classes, with `border-t-0` added to every row after the first, as before.)

- [ ] **Step 4: Run the component test, then the whole suite and the site build**

Run: `npx vitest run components/report/RatingBlock.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: all files pass (the count rises from the pre-plan baseline by the new tests; no existing test fails — the old envelope rows were rewritten in Task 3 by design).

Run: `npm run build`
Expected: the Next.js build succeeds and prerenders every `/research/<ticker>` page — the 20 published reports carry no `conviction` and render unchanged.

- [ ] **Step 5: End-to-end check on one report**

Run: `npm run synth:build -- V 0001403161-26-000104 --skip-review`
Expected: the build passes lint/grounding; `data/v.json` now carries `rating.conviction` (E ≈ +10.5%, D ≈ 15.8%, R ≈ 0.66, derived BUY, label BUY). The `--skip-review` render is not a publish; do **not** commit `data/v.json` from this check — revert it with `git checkout -- data/v.json` so the published report stays as it was.

Run: `npm run synth:prompt -- V 0001403161-26-000104`
Expected: the printed prompt's `# Calls` section shows the interpolated thresholds (`STRONG BUY needs E ≥ +20.0% and R ≥ 1.00×` …). Revert the regenerated prompt file too: `git checkout -- data/judgment/V/`.

- [ ] **Step 6: Commit**

```bash
git add components/report/RatingBlock.tsx components/report/RatingBlock.test.tsx
git commit -m "feat(report): conviction row — expected upside, bear case and reward/risk beside the rating

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

## Self-review against the spec

- **Spec coverage:** measures (Task 2) · label rule and one-notch (Tasks 2–3) · bear floor (Task 3) · target-low warning + mirror (Task 4) · `DeskRating` with refinements and explicit `desk.json` (Task 1) · `Report.rating.conviction` optional + `mergeReport` (Task 5) · Calls rendered from config + extended quotable bullet (Task 6) · `renderJudgmentBlock` three lines (Task 3) · `RatingBlock` third row, Section 8 inherits (Task 7) · `ENVELOPES` removed (Task 3) · published reports untouched (Task 5 test, Task 7 build) · golden regression (Tasks 3, 5). The spec's "`format.test.ts` boundary tests" live in `conviction.test.ts` per the placement ruling; the spec's error and warning messages are reproduced verbatim in Tasks 3 and 4.
- **Placeholders:** none; every step carries its code and its expected output.
- **Type consistency:** `computeConviction(scenarios: ScenarioIn[], price: number): Conviction` and `deriveLabel(c: Conviction, cfg: DeskRating): RatingLabel` are used with those exact signatures in Tasks 3, 5; `ratingIssues(j, currentPrice, cfg)` and `validateJudgment(j, facts, pack, desk)` match between Task 3's implementation, its tests and `synth-build.ts`; `lintJudgment(judgment, desk, ctx?)` matches Task 4's tests and `synth-build.ts`; `rewardRiskText(r: number | null): string` is the same in Tasks 2, 3, 6, 7; `Report["rating"]["conviction"]` fields match between Task 5's schema, its tests and Task 7's render.
