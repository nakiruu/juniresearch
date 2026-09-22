# Portfolio v1 Snapshot Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic engine that reads the published report archive plus live prices and emits a target-portfolio *snapshot* (JSON + CSV) — holdings, weights, cash, per-name signal, exclusions, and equal-weight-coverage active weights — so we can "see how the portfolio looks."

**Architecture:** A pure functional core in `lib/portfolio/` (report + live price → signal → eligibility → sizing → snapshot) with **all I/O and network fetching pushed to one CLI script** (`scripts/portfolio-build.ts`). The core takes prices as injected parameters, so every module is unit-testable and the whole pipeline is deterministic given fixed inputs. No execution, no NAV tracking, no persistence beyond the snapshot file.

**Tech Stack:** TypeScript, `tsx` (script runner), Zod (output schema), Vitest (co-located `*.test.ts`). Reuses `lib/reports.ts` (report loading), `lib/prices/yahoo.ts` (`fetchDailyCloses`), `lib/format.ts`. Follows existing `lib/*.ts` + `scripts/*.ts` conventions.

**Spec:** `docs/portfolio/01-conceptual-outline.md` (the v0 design). The plan implements its v1 slice (§4 eligibility, §5 inputs, §6 sizing, §9 EW-coverage benchmark, §12 v1). Read it alongside this plan.

## Global Constraints

- **Long-only.** No shorts; SELL/STRONG SELL are excluded, never negative weights.
- **Pure core, I/O at the edge.** Nothing under `lib/portfolio/` may call `fetch`, read files, or read the clock. Prices and "today" are parameters. Only `scripts/portfolio-build.ts` fetches and reads/writes files.
- **Re-mark to live price.** Expected return and risk are recomputed against the *live* price passed in, never the report's stored as-of price.
- **`w_max` (max single-name weight) defaults to `0.10` and is a tunable knob** overridable per run.
- **Scenario-derived risk is primary.** `μ` and `σ` come from the Bull/Base/Bear scenarios; no covariance, no realized-vol, no MVO in v1.
- **Determinism.** Given the same reports, prices, and config, the snapshot is byte-identical. No `Date.now()` inside the core; the CLI passes an explicit `asOf` date.
- **Money math in ratios.** Weights and cash are decimal ratios in `[0,1]` summing to `1.0` (holdings + cash), like the rest of the codebase (`0.10`, not `10`).

---

## File Structure

- `lib/portfolio/config.ts` — `PortfolioConfig` type + `DEFAULT_CONFIG` (every knob, incl. `wMax: 0.10`). One responsibility: the parameter set.
- `lib/portfolio/signal.ts` — `buildSignal(...)`: one `Report` + live price + sic + today → one `Signal` (μ, σ, σ⁻, E/D/R, κ, quality inputs, sector, ageDays, staleness). Pure.
- `lib/portfolio/eligibility.ts` — `assessEligibility(signal, config)` → `{ eligible, reasons }`. Pure.
- `lib/portfolio/sizing.ts` — the sizing math: `rawWeight`, `applyConstraints`, `finalizeCash`, and the `sizePortfolio` orchestrator. Pure.
- `lib/portfolio/benchmark.ts` — `equalWeightCoverage(tickers)` + `activeWeights(...)`. Pure.
- `lib/portfolio/snapshot.ts` — Zod `PortfolioSnapshot` schema, `assembleSnapshot(...)`, `toCSV(snapshot)`. Pure.
- `scripts/portfolio-build.ts` — CLI: load reports, fetch live prices + SPY, read pack `sic`, run the core, write `data/portfolio/snapshot-<date>.{json,csv}`, print a summary.
- `lib/portfolio/__fixtures__/reports.ts` — 3 hand-built fixture reports for the golden test.
- Each `lib/portfolio/*.ts` has a co-located `*.test.ts`.

Weight-computation lives together in `sizing.ts`; the signal (what we know about a name) is separate from the sizing (what we do about it), and eligibility is separate from both because it is a gate, not a weight.

---

## Task 1: Config and defaults

**Files:**
- Create: `lib/portfolio/config.ts`
- Test: `lib/portfolio/config.test.ts`

**Interfaces:**
- Produces: `PortfolioConfig` (type), `DEFAULT_CONFIG: PortfolioConfig`, `resolveConfig(overrides: Partial<PortfolioConfig>): PortfolioConfig`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "./config";

describe("portfolio config", () => {
  it("defaults the max single-name weight to 10%", () => {
    expect(DEFAULT_CONFIG.wMax).toBe(0.10);
  });
  it("merges overrides over the defaults without mutating them", () => {
    const c = resolveConfig({ wMax: 0.08 });
    expect(c.wMax).toBe(0.08);
    expect(c.alpha).toBe(DEFAULT_CONFIG.alpha);
    expect(DEFAULT_CONFIG.wMax).toBe(0.10); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/config.test.ts`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * config.ts — every tunable knob for the v1 portfolio, in one place.
 * Ratios are decimals (0.10 == 10%). See docs/portfolio/01-conceptual-outline.md §13.
 */
export interface PortfolioConfig {
  // Eligibility (§4)
  muMin: number;            // min re-marked expected upside to hold (e.g. 0.05)
  rMin: number;             // min reward/risk (e.g. 0.5)
  convictionMin: number;    // min decision.conviction 0-100 (e.g. 45)
  stalenessMaxDays: number; // drop reports older than this (e.g. 120)
  // Sizing (§6)
  alpha: number;            // Kelly fraction (e.g. 0.4)
  sigmaMin: number;         // floor on scenario sigma to avoid blow-up (e.g. 0.05)
  qGainComposite: number;   // quality-tilt gain on composite percentile (e.g. 0.10)
  qGainMoat: number;        // quality-tilt gain on moat score (e.g. 0.20)
  qPenaltyEroding: number;  // quality-tilt penalty for an eroding moat (e.g. 0.10)
  qLo: number;              // quality-tilt clamp low (e.g. 0.8)
  qHi: number;              // quality-tilt clamp high (e.g. 1.2)
  stalenessHalfLifeDays: number; // soft decay half-life (e.g. 90)
  // Constraints (§7)
  wMax: number;             // hard per-name cap — THE knob (default 0.10)
  sectorMax: number;        // max weight per SIC-2-digit sector (e.g. 0.30)
  wMin: number;             // dust floor; below this a name is dropped (e.g. 0.015)
  cashFloor: number;        // frictional min cash (e.g. 0.01)
  cashCeiling: number;      // soft max cash (e.g. 0.35)
  minNamesForCeiling: number; // ceiling binds only with at least this many holdings (e.g. 4)
}

export const DEFAULT_CONFIG: PortfolioConfig = {
  muMin: 0.05, rMin: 0.5, convictionMin: 45, stalenessMaxDays: 120,
  alpha: 0.4, sigmaMin: 0.05,
  qGainComposite: 0.10, qGainMoat: 0.20, qPenaltyEroding: 0.10, qLo: 0.8, qHi: 1.2,
  stalenessHalfLifeDays: 90,
  wMax: 0.10, sectorMax: 0.30, wMin: 0.015,
  cashFloor: 0.01, cashCeiling: 0.35, minNamesForCeiling: 4,
};

export function resolveConfig(overrides: Partial<PortfolioConfig> = {}): PortfolioConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/config.ts lib/portfolio/config.test.ts
git commit -m "feat(portfolio): config knobs with 10% default name cap"
```

---

## Task 2: Signal — scenario-implied μ/σ re-marked to live price

**Files:**
- Create: `lib/portfolio/signal.ts`
- Test: `lib/portfolio/signal.test.ts`

**Interfaces:**
- Consumes: `Report` from `@/lib/report.schema`.
- Produces:
  ```ts
  export interface Signal {
    ticker: string; company: string; sector: string; // sector = 2-digit SIC prefix, "??" if unknown
    label: Report["rating"]["label"];
    gatedLabel: Report["rating"]["label"] | null;
    price: number;      // the live price used
    mu: number;         // scenario expected return, re-marked
    sigma: number;      // scenario stdev (>= 0)
    sigmaDown: number;  // downside semi-deviation (>= 0)
    D: number;          // re-marked bear downside (>= 0)
    R: number | null;   // mu / D, null if D <= 0
    kappa: number;      // decision.conviction / 100 (0 if no decision block)
    quality: number;    // quality tilt in [qLo, qHi]
    ageDays: number;
    staleness: number;  // exp(-ageDays / halfLife) in (0,1]
  }
  export function buildSignal(report: Report, livePrice: number, sic: number | null, today: Date, config: PortfolioConfig): Signal;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSignal } from "./signal";
import { DEFAULT_CONFIG } from "./config";
import type { Report } from "@/lib/report.schema";

// Minimal report stub with the fields buildSignal reads.
const base = {
  meta: { ticker: "TST", company: "Test Co", reportDate: "September 1, 2026" },
  rating: {
    label: "BUY",
    conviction: { expectedUpside: 0.2, bearDownside: 0.2, rewardRisk: 1.0, derivedLabel: "BUY" },
    gate: { sector: "industrial", gatedLabel: "BUY" },
    decision: { conviction: 70, moat: { width: "WIDE", trend: "STABLE" }, composite: { percentile: 60 } },
  },
  sections: { valuation: { scenarios: [
    { name: "Bull", impliedPrice: 150, probability: 0.3 },
    { name: "Base", impliedPrice: 120, probability: 0.5 },
    { name: "Bear", impliedPrice: 80,  probability: 0.2 },
  ] } },
} as unknown as Report;

describe("buildSignal", () => {
  it("re-marks mu and sigma to the live price, not the report's price", () => {
    const s = buildSignal(base, 100, 3674, new Date("2026-09-01T00:00:00Z"), DEFAULT_CONFIG);
    // returns vs 100: +0.5, +0.2, -0.2 ; mu = .3*.5 + .5*.2 + .2*(-.2) = 0.21
    expect(s.mu).toBeCloseTo(0.21, 6);
    // var = .3*(.29)^2 + .5*(-.01)^2 + .2*(-.41)^2 = 0.025230+... ; sigma ~ 0.2588
    expect(s.sigma).toBeCloseTo(0.25883, 4);
    expect(s.D).toBeCloseTo(0.2, 6);       // (100-80)/100
    expect(s.R).toBeCloseTo(1.05, 4);      // 0.21 / 0.2
    expect(s.kappa).toBe(0.7);
    expect(s.sector).toBe("36");           // SIC 3674 -> "36"
    expect(s.quality).toBeGreaterThan(1);  // WIDE moat + 60th pct -> mild positive tilt
    expect(s.ageDays).toBe(0);
  });
  it("halves mu when the name has already rallied above the re-mark price", () => {
    const s = buildSignal(base, 130, 3674, new Date("2026-09-01T00:00:00Z"), DEFAULT_CONFIG);
    // vs 130 the base case (120) is now BELOW price -> much lower mu
    expect(s.mu).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/signal.test.ts`
Expected: FAIL — cannot find module `./signal`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Report } from "@/lib/report.schema";
import type { PortfolioConfig } from "./config";

export interface Signal {
  ticker: string; company: string; sector: string;
  label: Report["rating"]["label"]; gatedLabel: Report["rating"]["label"] | null;
  price: number; mu: number; sigma: number; sigmaDown: number;
  D: number; R: number | null; kappa: number; quality: number;
  ageDays: number; staleness: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const moatScore = (w?: string) => (w === "WIDE" ? 1 : w === "NARROW" ? 0.5 : w === "NONE" ? 0 : 0.25);

export function buildSignal(report: Report, livePrice: number, sic: number | null, today: Date, config: PortfolioConfig): Signal {
  const r = report.rating;
  const scen = report.sections.valuation.scenarios.map((s) => ({
    ret: s.impliedPrice / livePrice - 1, p: s.probability, name: s.name,
  }));
  const mu = scen.reduce((a, s) => a + s.p * s.ret, 0);
  const variance = scen.reduce((a, s) => a + s.p * (s.ret - mu) ** 2, 0);
  const sigma = Math.sqrt(Math.max(0, variance));
  const downVar = scen.filter((s) => s.ret < 0).reduce((a, s) => a + s.p * s.ret ** 2, 0);
  const sigmaDown = Math.sqrt(Math.max(0, downVar));
  const bear = scen.reduce((lo, s) => (s.ret < lo.ret ? s : lo), scen[0]);
  const D = Math.max(0, -bear.ret);
  const R = D > 0 ? mu / D : null;

  const dec = r.decision;
  const kappa = dec ? dec.conviction / 100 : 0;
  const compositePctile = dec?.composite?.percentile ?? 50;
  const eroding = dec?.moat?.trend === "ERODING";
  const quality = clamp(
    1 + config.qGainComposite * (compositePctile - 50) / 50
      + config.qGainMoat * (moatScore(dec?.moat?.width) - 0.5)
      - config.qPenaltyEroding * (eroding ? 1 : 0),
    config.qLo, config.qHi,
  );

  const reportDate = new Date(report.meta.reportDate + " UTC");
  const ageDays = Math.max(0, Math.round((today.getTime() - reportDate.getTime()) / 86_400_000));
  const staleness = Math.exp(-ageDays / config.stalenessHalfLifeDays);

  return {
    ticker: report.meta.ticker, company: report.meta.company,
    sector: sic != null && Number.isFinite(sic) ? String(Math.floor(sic / 100)).padStart(2, "0") : "??",
    label: r.label, gatedLabel: r.gate?.gatedLabel ?? null,
    price: livePrice, mu, sigma, sigmaDown, D, R, kappa, quality, ageDays, staleness,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/signal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/signal.ts lib/portfolio/signal.test.ts
git commit -m "feat(portfolio): scenario-implied signal re-marked to live price"
```

---

## Task 3: Eligibility gate

**Files:**
- Create: `lib/portfolio/eligibility.ts`
- Test: `lib/portfolio/eligibility.test.ts`

**Interfaces:**
- Consumes: `Signal` (Task 2), `PortfolioConfig` (Task 1).
- Produces: `export function assessEligibility(s: Signal, config: PortfolioConfig): { eligible: boolean; reasons: string[] }`. `reasons` lists every failed gate (empty when eligible).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assessEligibility } from "./eligibility";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const ok: Signal = {
  ticker: "TST", company: "Test", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1.0, kappa: 0.7,
  quality: 1.05, ageDays: 10, staleness: 0.9,
};

describe("assessEligibility", () => {
  it("passes a fresh, high-conviction, asymmetric BUY", () => {
    expect(assessEligibility(ok, DEFAULT_CONFIG).eligible).toBe(true);
  });
  it("excludes a HOLD", () => {
    const r = assessEligibility({ ...ok, label: "HOLD" }, DEFAULT_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("label HOLD not buy-side");
  });
  it("excludes a BUY the fundamental gate caps to HOLD", () => {
    const r = assessEligibility({ ...ok, gatedLabel: "HOLD" }, DEFAULT_CONFIG);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("gate ceiling HOLD");
  });
  it("excludes a stale report and a rallied-out (low mu) name", () => {
    expect(assessEligibility({ ...ok, ageDays: 200 }, DEFAULT_CONFIG).eligible).toBe(false);
    expect(assessEligibility({ ...ok, mu: 0.02 }, DEFAULT_CONFIG).eligible).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/eligibility.test.ts`
Expected: FAIL — cannot find module `./eligibility`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";

const BUY_SIDE = new Set(["BUY", "STRONG BUY"]);

export function assessEligibility(s: Signal, config: PortfolioConfig): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!BUY_SIDE.has(s.label)) reasons.push(`label ${s.label} not buy-side`);
  if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) reasons.push(`gate ceiling ${s.gatedLabel}`);
  if (s.mu < config.muMin) reasons.push(`mu ${(s.mu * 100).toFixed(1)}% < ${(config.muMin * 100).toFixed(0)}%`);
  if (s.R == null || s.R < config.rMin) reasons.push(`R ${s.R == null ? "—" : s.R.toFixed(2)} < ${config.rMin}`);
  if (s.kappa * 100 < config.convictionMin) reasons.push(`conviction ${(s.kappa * 100).toFixed(0)} < ${config.convictionMin}`);
  if (s.ageDays > config.stalenessMaxDays) reasons.push(`stale ${s.ageDays}d > ${config.stalenessMaxDays}d`);
  return { eligible: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/eligibility.ts lib/portfolio/eligibility.test.ts
git commit -m "feat(portfolio): eligibility gate (not all BUYs are held)"
```

---

## Task 4: Raw fractional-Kelly weight

**Files:**
- Create: `lib/portfolio/sizing.ts`
- Test: `lib/portfolio/sizing.test.ts`

**Interfaces:**
- Consumes: `Signal` (Task 2), `PortfolioConfig` (Task 1).
- Produces: `export function rawWeight(s: Signal, config: PortfolioConfig): number` — `alpha · kappa · (mu / max(sigma, sigmaMin)^2) · quality · staleness`, floored at 0.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { rawWeight } from "./sizing";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const s: Signal = {
  ticker: "TST", company: "Test", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.20, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1.0, kappa: 0.6,
  quality: 1.0, ageDays: 0, staleness: 1.0,
};

describe("rawWeight", () => {
  it("computes alpha * kappa * mu/sigma^2 * quality * staleness", () => {
    // 0.4 * 0.6 * (0.20 / 0.0625) * 1 * 1 = 0.4*0.6*3.2 = 0.768
    expect(rawWeight(s, DEFAULT_CONFIG)).toBeCloseTo(0.768, 6);
  });
  it("floors sigma so a tight-scenario name doesn't blow up", () => {
    const w = rawWeight({ ...s, sigma: 0.001 }, DEFAULT_CONFIG); // sigma floored to 0.05
    expect(w).toBeCloseTo(0.4 * 0.6 * (0.20 / 0.0025), 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: FAIL — cannot find module `./sizing`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Signal } from "./signal";
import type { PortfolioConfig } from "./config";

export function rawWeight(s: Signal, config: PortfolioConfig): number {
  const sigma = Math.max(s.sigma, config.sigmaMin);
  const kelly = s.mu / (sigma * sigma);
  return Math.max(0, config.alpha * s.kappa * kelly * s.quality * s.staleness);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/sizing.ts lib/portfolio/sizing.test.ts
git commit -m "feat(portfolio): raw confidence-shrunk fractional-Kelly weight"
```

---

## Task 5: Constraints — per-name cap, sector cap, dust floor

**Files:**
- Modify: `lib/portfolio/sizing.ts`
- Test: `lib/portfolio/sizing.test.ts` (add cases)

**Interfaces:**
- Consumes: a `Weighted` list `{ ticker: string; sector: string; weight: number }[]`, `PortfolioConfig`.
- Produces: `export function applyConstraints(items: Weighted[], config: PortfolioConfig): Weighted[]` — caps each weight at `wMax`, scales any sector over `sectorMax` down proportionally, then zeroes weights below `wMin`. Exported type `export interface Weighted { ticker: string; sector: string; weight: number }`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyConstraints, type Weighted } from "./sizing";
// ... (same file, add to the describe block)

describe("applyConstraints", () => {
  it("caps a single name at wMax", () => {
    const out = applyConstraints([{ ticker: "A", sector: "36", weight: 0.5 }], DEFAULT_CONFIG);
    expect(out[0].weight).toBeCloseTo(0.10, 6);
  });
  it("scales an over-weight sector down to sectorMax", () => {
    const out = applyConstraints([
      { ticker: "A", sector: "36", weight: 0.10 },
      { ticker: "B", sector: "36", weight: 0.10 },
      { ticker: "C", sector: "36", weight: 0.10 },
      { ticker: "D", sector: "36", weight: 0.10 }, // 4x10% = 40% in sector 36 > 30%
    ], DEFAULT_CONFIG);
    const sec36 = out.filter((w) => w.sector === "36").reduce((a, w) => a + w.weight, 0);
    expect(sec36).toBeCloseTo(0.30, 6);
    expect(out[0].weight).toBeCloseTo(0.075, 6); // each scaled 0.10 * (0.30/0.40)
  });
  it("drops dust below wMin", () => {
    const out = applyConstraints([{ ticker: "A", sector: "36", weight: 0.005 }], DEFAULT_CONFIG);
    expect(out[0].weight).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: FAIL — `applyConstraints` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `sizing.ts`)

```ts
export interface Weighted { ticker: string; sector: string; weight: number }

export function applyConstraints(items: Weighted[], config: PortfolioConfig): Weighted[] {
  // 1. hard per-name cap
  let out = items.map((w) => ({ ...w, weight: Math.min(w.weight, config.wMax) }));
  // 2. sector cap — scale any sector over the cap down proportionally
  const bySector = new Map<string, number>();
  for (const w of out) bySector.set(w.sector, (bySector.get(w.sector) ?? 0) + w.weight);
  out = out.map((w) => {
    const total = bySector.get(w.sector)!;
    return total > config.sectorMax ? { ...w, weight: w.weight * (config.sectorMax / total) } : w;
  });
  // 3. dust floor
  return out.map((w) => (w.weight < config.wMin ? { ...w, weight: 0 } : w));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/sizing.ts lib/portfolio/sizing.test.ts
git commit -m "feat(portfolio): per-name, sector, and dust constraints"
```

---

## Task 6: Bounded cash-emergence

**Files:**
- Modify: `lib/portfolio/sizing.ts`
- Test: `lib/portfolio/sizing.test.ts` (add cases)

**Interfaces:**
- Consumes: constrained `Weighted[]`, `PortfolioConfig`.
- Produces: `export function finalizeCash(items: Weighted[], config: PortfolioConfig): { holdings: Weighted[]; cash: number }`. Non-zero weights only in `holdings`; `Σ holdings.weight + cash === 1` (to 1e-9). Implements §6 step 5: scale to `1 − cashFloor` if over-invested; let cash emerge otherwise; clamp cash to `[cashFloor, cashCeiling]`, with the ceiling binding only when `holdings.length >= minNamesForCeiling`.

- [ ] **Step 1: Write the failing test**

```ts
import { finalizeCash } from "./sizing";

describe("finalizeCash", () => {
  const w = (ticker: string, weight: number): Weighted => ({ ticker, sector: "36", weight });

  it("scales an over-invested book down to (1 - cashFloor) with floor cash", () => {
    const { holdings, cash } = finalizeCash([w("A", 0.8), w("B", 0.8)], DEFAULT_CONFIG);
    expect(holdings.reduce((a, h) => a + h.weight, 0)).toBeCloseTo(0.99, 6);
    expect(cash).toBeCloseTo(0.01, 6);
  });
  it("lets cash emerge when under-invested and under the ceiling", () => {
    const { cash } = finalizeCash([w("A", 0.4), w("B", 0.3)], DEFAULT_CONFIG); // invested 0.7
    expect(cash).toBeCloseTo(0.30, 6);
  });
  it("binds the cash ceiling up when enough names qualify", () => {
    // invested 0.4 across 4 names -> cash 0.6 > ceiling 0.35, names>=4 -> scale up to invested 0.65
    const { holdings, cash } = finalizeCash([w("A",0.1),w("B",0.1),w("C",0.1),w("D",0.1)], DEFAULT_CONFIG);
    expect(cash).toBeCloseTo(0.35, 6);
    expect(holdings.reduce((a, h) => a + h.weight, 0)).toBeCloseTo(0.65, 6);
  });
  it("allows cash above the ceiling when too few names qualify", () => {
    const { cash } = finalizeCash([w("A", 0.1), w("B", 0.1)], DEFAULT_CONFIG); // 2 names < 4
    expect(cash).toBeCloseTo(0.80, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: FAIL — `finalizeCash` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `sizing.ts`)

```ts
export function finalizeCash(items: Weighted[], config: PortfolioConfig): { holdings: Weighted[]; cash: number } {
  const held = items.filter((w) => w.weight > 0);
  const invested = held.reduce((a, w) => a + w.weight, 0);
  const scale = (target: number) => held.map((w) => ({ ...w, weight: w.weight * (target / invested) }));

  // Over-invested: scale down to (1 - cashFloor), no leverage.
  if (invested > 1 - config.cashFloor) {
    return { holdings: scale(1 - config.cashFloor), cash: config.cashFloor };
  }
  let holdings = held;
  let cash = 1 - invested;
  // Cash ceiling binds only with enough names — never a stealth market-timing bet.
  if (cash > config.cashCeiling && held.length >= config.minNamesForCeiling) {
    const target = 1 - config.cashCeiling;
    holdings = scale(target);
    cash = config.cashCeiling;
  }
  return { holdings, cash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/sizing.ts lib/portfolio/sizing.test.ts
git commit -m "feat(portfolio): bounded cash-emergent finalization"
```

---

## Task 7: sizePortfolio orchestrator

**Files:**
- Modify: `lib/portfolio/sizing.ts`
- Test: `lib/portfolio/sizing.test.ts` (add cases)

**Interfaces:**
- Consumes: `Signal[]`, `PortfolioConfig`, plus `assessEligibility` (Task 3), `rawWeight` (Task 4), `applyConstraints` (Task 5), `finalizeCash` (Task 6).
- Produces:
  ```ts
  export interface Sized {
    holdings: { ticker: string; sector: string; weight: number }[];
    cash: number;
    excluded: { ticker: string; reasons: string[] }[];
  }
  export function sizePortfolio(signals: Signal[], config: PortfolioConfig): Sized;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { sizePortfolio } from "./sizing";
import type { Signal } from "./signal";

const sig = (o: Partial<Signal>): Signal => ({
  ticker: "X", company: "X", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.6,
  quality: 1, ageDays: 0, staleness: 1, ...o,
});

describe("sizePortfolio", () => {
  it("holds eligible names, lists the excluded with reasons, and sums to 1", () => {
    const out = sizePortfolio([
      sig({ ticker: "A" }),
      sig({ ticker: "B", label: "HOLD" }),   // excluded
      sig({ ticker: "C", mu: 0.01 }),         // excluded (rallied out)
    ], DEFAULT_CONFIG);
    expect(out.holdings.map((h) => h.ticker)).toEqual(["A"]);
    expect(out.excluded.map((e) => e.ticker).sort()).toEqual(["B", "C"]);
    expect(out.holdings.reduce((a, h) => a + h.weight, 0) + out.cash).toBeCloseTo(1, 9);
  });
  it("returns an all-cash book when nothing is eligible", () => {
    const out = sizePortfolio([sig({ label: "HOLD" })], DEFAULT_CONFIG);
    expect(out.holdings).toHaveLength(0);
    expect(out.cash).toBeCloseTo(1, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: FAIL — `sizePortfolio` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `sizing.ts`)

```ts
import { assessEligibility } from "./eligibility";

export interface Sized {
  holdings: Weighted[]; cash: number; excluded: { ticker: string; reasons: string[] }[];
}

export function sizePortfolio(signals: Signal[], config: PortfolioConfig): Sized {
  const eligible: Signal[] = [];
  const excluded: { ticker: string; reasons: string[] }[] = [];
  for (const s of signals) {
    const e = assessEligibility(s, config);
    if (e.eligible) eligible.push(s);
    else excluded.push({ ticker: s.ticker, reasons: e.reasons });
  }
  const raw: Weighted[] = eligible.map((s) => ({ ticker: s.ticker, sector: s.sector, weight: rawWeight(s, config) }));
  const constrained = applyConstraints(raw, config);
  const { holdings, cash } = finalizeCash(constrained, config);
  return { holdings, cash, excluded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/sizing.ts lib/portfolio/sizing.test.ts
git commit -m "feat(portfolio): sizePortfolio orchestrator (eligibility -> weights -> cash)"
```

---

## Task 8: Equal-weight-coverage benchmark & active weights

**Files:**
- Create: `lib/portfolio/benchmark.ts`
- Test: `lib/portfolio/benchmark.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ActiveRow { ticker: string; portfolioWeight: number; benchmarkWeight: number; activeWeight: number }
  export function equalWeightCoverage(coveredTickers: string[]): Map<string, number>;
  export function activeWeights(coveredTickers: string[], holdings: { ticker: string; weight: number }[]): ActiveRow[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { equalWeightCoverage, activeWeights } from "./benchmark";

describe("benchmark", () => {
  it("equal-weights every covered name", () => {
    const ew = equalWeightCoverage(["A", "B", "C", "D"]);
    expect(ew.get("A")).toBeCloseTo(0.25, 6);
  });
  it("computes active weight = portfolio - benchmark for every covered name", () => {
    const rows = activeWeights(["A", "B", "C", "D"], [{ ticker: "A", weight: 0.6 }]);
    const a = rows.find((r) => r.ticker === "A")!;
    const b = rows.find((r) => r.ticker === "B")!;
    expect(a.activeWeight).toBeCloseTo(0.6 - 0.25, 6);  // overweight
    expect(b.activeWeight).toBeCloseTo(0 - 0.25, 6);    // underweight (not held)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/benchmark.test.ts`
Expected: FAIL — cannot find module `./benchmark`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ActiveRow { ticker: string; portfolioWeight: number; benchmarkWeight: number; activeWeight: number }

export function equalWeightCoverage(coveredTickers: string[]): Map<string, number> {
  const w = coveredTickers.length ? 1 / coveredTickers.length : 0;
  return new Map(coveredTickers.map((t) => [t, w]));
}

export function activeWeights(coveredTickers: string[], holdings: { ticker: string; weight: number }[]): ActiveRow[] {
  const ew = equalWeightCoverage(coveredTickers);
  const held = new Map(holdings.map((h) => [h.ticker, h.weight]));
  return coveredTickers.map((t) => {
    const portfolioWeight = held.get(t) ?? 0;
    const benchmarkWeight = ew.get(t) ?? 0;
    return { ticker: t, portfolioWeight, benchmarkWeight, activeWeight: portfolioWeight - benchmarkWeight };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/benchmark.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/benchmark.ts lib/portfolio/benchmark.test.ts
git commit -m "feat(portfolio): equal-weight-coverage benchmark and active weights"
```

---

## Task 9: Snapshot schema, assembly, and CSV

**Files:**
- Create: `lib/portfolio/snapshot.ts`
- Test: `lib/portfolio/snapshot.test.ts`

**Interfaces:**
- Consumes: `Signal[]` (Task 2), `Sized` (Task 7), `ActiveRow[]` (Task 8), `PortfolioConfig` (Task 1).
- Produces:
  ```ts
  export const PortfolioSnapshot: z.ZodType<...>;   // Zod schema
  export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshot>;
  export function assembleSnapshot(input: {
    asOf: string; signals: Signal[]; sized: Sized; active: ActiveRow[];
    spyPrice: number; config: PortfolioConfig;
  }): PortfolioSnapshot;
  export function toCSV(snap: PortfolioSnapshot): string;
  ```

**Snapshot shape** (JSON): `{ meta:{ asOf, universeSize, eligibleCount, invested, cash, nEff, spyPrice, config }, holdings:[{ ticker, company, sector, weight, activeWeight, label, mu, sigma, R, conviction }], cash, excluded:[{ ticker, label, reasons }] }`. `nEff = 1 / Σ weight²` over holdings.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assembleSnapshot, PortfolioSnapshot, toCSV } from "./snapshot";
import { DEFAULT_CONFIG } from "./config";
import type { Signal } from "./signal";

const sig = (o: Partial<Signal>): Signal => ({
  ticker: "A", company: "A Co", sector: "36", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.2, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 1, kappa: 0.7,
  quality: 1, ageDays: 0, staleness: 1, ...o,
});

describe("snapshot", () => {
  const input = {
    asOf: "2026-09-22",
    signals: [sig({ ticker: "A" }), sig({ ticker: "B", label: "HOLD" })],
    sized: { holdings: [{ ticker: "A", sector: "36", weight: 0.6 }], cash: 0.4,
             excluded: [{ ticker: "B", reasons: ["label HOLD not buy-side"] }] },
    active: [{ ticker: "A", portfolioWeight: 0.6, benchmarkWeight: 0.5, activeWeight: 0.1 },
             { ticker: "B", portfolioWeight: 0, benchmarkWeight: 0.5, activeWeight: -0.5 }],
    spyPrice: 640, config: DEFAULT_CONFIG,
  };
  it("assembles a schema-valid snapshot with holdings, cash, exclusions and N_eff", () => {
    const snap = assembleSnapshot(input);
    expect(() => PortfolioSnapshot.parse(snap)).not.toThrow();
    expect(snap.holdings[0].ticker).toBe("A");
    expect(snap.holdings[0].activeWeight).toBeCloseTo(0.1, 6);
    expect(snap.cash).toBeCloseTo(0.4, 6);
    expect(snap.meta.nEff).toBeCloseTo(1 / (0.6 ** 2), 4);
    expect(snap.excluded[0].ticker).toBe("B");
  });
  it("renders a CSV with a header, a holding row, and a CASH row", () => {
    const csv = toCSV(assembleSnapshot(input));
    expect(csv.split("\n")[0]).toContain("ticker,weight");
    expect(csv).toMatch(/^A,/m);
    expect(csv).toMatch(/^CASH,0?\.4/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio/snapshot.test.ts`
Expected: FAIL — cannot find module `./snapshot`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";
import type { Signal } from "./signal";
import type { Sized } from "./sizing";
import type { ActiveRow } from "./benchmark";
import type { PortfolioConfig } from "./config";

const holding = z.object({
  ticker: z.string(), company: z.string(), sector: z.string(),
  weight: z.number(), activeWeight: z.number(), label: z.string(),
  mu: z.number(), sigma: z.number(), R: z.number().nullable(), conviction: z.number(),
});
export const PortfolioSnapshot = z.object({
  meta: z.object({
    asOf: z.string(), universeSize: z.number().int(), eligibleCount: z.number().int(),
    invested: z.number(), cash: z.number(), nEff: z.number(), spyPrice: z.number(),
    config: z.record(z.string(), z.number()),
  }),
  holdings: z.array(holding),
  cash: z.number(),
  excluded: z.array(z.object({ ticker: z.string(), label: z.string(), reasons: z.array(z.string()) })),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshot>;

export function assembleSnapshot(input: {
  asOf: string; signals: Signal[]; sized: Sized; active: ActiveRow[];
  spyPrice: number; config: PortfolioConfig;
}): PortfolioSnapshot {
  const { asOf, signals, sized, active, spyPrice, config } = input;
  const byTicker = new Map(signals.map((s) => [s.ticker, s]));
  const activeByTicker = new Map(active.map((a) => [a.ticker, a.activeWeight]));
  const holdings = sized.holdings
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((h) => {
      const s = byTicker.get(h.ticker)!;
      return {
        ticker: h.ticker, company: s.company, sector: h.sector, weight: h.weight,
        activeWeight: activeByTicker.get(h.ticker) ?? h.weight,
        label: s.label, mu: s.mu, sigma: s.sigma, R: s.R, conviction: Math.round(s.kappa * 100),
      };
    });
  const invested = holdings.reduce((a, h) => a + h.weight, 0);
  const nEff = holdings.length ? 1 / holdings.reduce((a, h) => a + h.weight ** 2, 0) : 0;
  const excluded = sized.excluded.map((e) => ({
    ticker: e.ticker, label: byTicker.get(e.ticker)?.label ?? "?", reasons: e.reasons,
  }));
  return {
    meta: {
      asOf, universeSize: signals.length, eligibleCount: holdings.length,
      invested, cash: sized.cash, nEff, spyPrice,
      config: config as unknown as Record<string, number>,
    },
    holdings, cash: sized.cash, excluded,
  };
}

export function toCSV(snap: PortfolioSnapshot): string {
  const header = "ticker,weight,activeWeight,sector,label,mu,sigma,R,conviction";
  const rows = snap.holdings.map((h) =>
    [h.ticker, h.weight.toFixed(4), h.activeWeight.toFixed(4), h.sector, h.label,
     h.mu.toFixed(4), h.sigma.toFixed(4), h.R == null ? "" : h.R.toFixed(2), h.conviction].join(","));
  return [header, ...rows, `CASH,${snap.cash.toFixed(4)},,,,,,,`].join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/snapshot.ts lib/portfolio/snapshot.test.ts
git commit -m "feat(portfolio): snapshot schema, assembly, and CSV"
```

---

## Task 10: CLI — fetch prices, read sic, build, write files

**Files:**
- Create: `scripts/portfolio-build.ts`
- Modify: `package.json` (add `"portfolio:build"` script)

**Interfaces:**
- Consumes: `listReportTickers`/`loadReport` (`@/lib/reports`), `fetchDailyCloses` (`@/lib/prices/yahoo`), all of `lib/portfolio/*`.
- Produces: writes `data/portfolio/snapshot-<asOf>.json` and `.csv`; prints a one-line-per-holding summary. No exported API (script).

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, after `"synth:build"`:
```json
"portfolio:build": "node --env-file-if-exists=.env.local --import tsx scripts/portfolio-build.ts",
```

- [ ] **Step 2: Write the CLI**

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listReportTickers, loadReport } from "../lib/reports";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { FactPack } from "../lib/facts/schema";
import { readFileSync } from "node:fs";
import { resolveConfig, type PortfolioConfig } from "../lib/portfolio/config";
import { buildSignal, type Signal } from "../lib/portfolio/signal";
import { sizePortfolio } from "../lib/portfolio/sizing";
import { activeWeights } from "../lib/portfolio/benchmark";
import { assembleSnapshot, toCSV } from "../lib/portfolio/snapshot";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const asOf = flag("--date") ?? new Date().toISOString().slice(0, 10);
const overrides: Partial<PortfolioConfig> = {};
for (const k of ["wMax", "alpha", "cashCeiling", "sectorMax"] as const) {
  const v = flag(`--${k}`); if (v != null) overrides[k] = Number(v);
}
const config = resolveConfig(overrides);
const today = new Date(asOf + "T00:00:00Z");

// Latest close from Yahoo over a short trailing window == the live mark.
async function livePrice(ticker: string): Promise<number> {
  const from = new Date(today.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
  const raw = JSON.parse(await fetchDailyCloses(ticker, from, asOf));
  const closes: number[] = raw.chart.result[0].indicators.quote[0].close.filter((c: number | null) => c != null);
  return closes[closes.length - 1];
}

function sicFor(ticker: string, accession: string): number | null {
  const p = join("data", "facts", ticker.toUpperCase(), `${accession}.json`);
  if (!existsSync(p)) return null;
  return FactPack.parse(JSON.parse(readFileSync(p, "utf8"))).sic ?? null;
}

const tickers = await listReportTickers();
const spyPrice = await livePrice("SPY");
const signals: Signal[] = [];
for (const t of tickers) {
  const report = await loadReport(t);
  if (!report) continue;
  const price = await livePrice(report.meta.ticker);
  const sic = sicFor(report.meta.ticker, report.meta.filing.accession);
  signals.push(buildSignal(report, price, sic, today, config));
}

const sized = sizePortfolio(signals, config);
const active = activeWeights(signals.map((s) => s.ticker), sized.holdings);
const snap = assembleSnapshot({ asOf, signals, sized, active, spyPrice, config });

const outDir = join("data", "portfolio");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `snapshot-${asOf}.json`), JSON.stringify(snap, null, 2) + "\n");
writeFileSync(join(outDir, `snapshot-${asOf}.csv`), toCSV(snap));

console.log(`Portfolio ${asOf} — ${snap.holdings.length} holdings, cash ${(snap.cash * 100).toFixed(1)}%, N_eff ${snap.meta.nEff.toFixed(1)}`);
for (const h of snap.holdings) console.log(`  ${h.ticker.padEnd(6)} ${(h.weight * 100).toFixed(1).padStart(5)}%  ${h.label}`);
```

- [ ] **Step 3: Smoke-run it (live network)**

Run: `npm run portfolio:build -- --date 2026-09-22`
Expected: writes `data/portfolio/snapshot-2026-09-22.{json,csv}` and prints the holdings summary. (Network-dependent; if Yahoo rate-limits, re-run.)

- [ ] **Step 4: Decide tracking of `data/portfolio/`**

Snapshots are generated outputs. Either add `data/portfolio/` to `.gitignore`, or commit the latest snapshot as an example. Default: **gitignore it** for now (regenerable), and revisit when snapshots become the paper-phase time series.
```bash
echo "data/portfolio/" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add scripts/portfolio-build.ts package.json .gitignore
git commit -m "feat(portfolio): portfolio:build CLI — fetch, size, write snapshot"
```

---

## Task 11: Golden end-to-end snapshot test

**Files:**
- Create: `lib/portfolio/__fixtures__/reports.ts`
- Create: `lib/portfolio/pipeline.test.ts`

**Interfaces:**
- Consumes: `buildSignal`, `sizePortfolio`, `activeWeights`, `assembleSnapshot` — the whole pure pipeline with injected prices (no network).

- [ ] **Step 1: Write the fixture**

```ts
import type { Report } from "@/lib/report.schema";

// Three minimal reports exercising: a strong BUY, a marginal BUY (dropped as dust),
// and a HOLD (excluded). Only the fields the pipeline reads are populated.
export function fixtureReport(o: {
  ticker: string; label: Report["rating"]["label"]; conviction: number;
  scenarios: [number, number][]; // [impliedPrice, probability] Bull, Base, Bear
}): Report {
  const [bull, base, bear] = o.scenarios;
  return {
    meta: { ticker: o.ticker, company: `${o.ticker} Co`, reportDate: "September 1, 2026",
            filing: { accession: "x" } },
    rating: { label: o.label,
      conviction: { expectedUpside: 0, bearDownside: 0, rewardRisk: 0, derivedLabel: o.label },
      gate: { sector: "industrial", gatedLabel: o.label },
      decision: { conviction: o.conviction, moat: { width: "NARROW", trend: "STABLE" }, composite: { percentile: 50 } } },
    sections: { valuation: { scenarios: [
      { name: "Bull", impliedPrice: bull[0], probability: bull[1] },
      { name: "Base", impliedPrice: base[0], probability: base[1] },
      { name: "Bear", impliedPrice: bear[0], probability: bear[1] },
    ] } },
  } as unknown as Report;
}
```

- [ ] **Step 2: Write the golden test**

```ts
import { describe, it, expect } from "vitest";
import { fixtureReport } from "./__fixtures__/reports";
import { DEFAULT_CONFIG } from "./config";
import { buildSignal } from "./signal";
import { sizePortfolio } from "./sizing";
import { activeWeights } from "./benchmark";
import { assembleSnapshot, PortfolioSnapshot } from "./snapshot";

describe("portfolio pipeline (golden)", () => {
  it("produces a valid, fully-summing snapshot from a small universe", () => {
    const today = new Date("2026-09-01T00:00:00Z");
    const reports = [
      fixtureReport({ ticker: "STRONG", label: "BUY", conviction: 80, scenarios: [[160, 0.3], [130, 0.5], [80, 0.2]] }),
      fixtureReport({ ticker: "HELD2",  label: "BUY", conviction: 60, scenarios: [[140, 0.3], [120, 0.5], [85, 0.2]] }),
      fixtureReport({ ticker: "HOLDME", label: "HOLD", conviction: 50, scenarios: [[130, 0.3], [110, 0.5], [80, 0.2]] }),
    ];
    const prices: Record<string, number> = { STRONG: 100, HELD2: 100, HOLDME: 100 };
    const signals = reports.map((r) => buildSignal(r, prices[r.meta.ticker], 3674, today, DEFAULT_CONFIG));
    const sized = sizePortfolio(signals, DEFAULT_CONFIG);
    const active = activeWeights(signals.map((s) => s.ticker), sized.holdings);
    const snap = assembleSnapshot({ asOf: "2026-09-01", signals, sized, active, spyPrice: 640, config: DEFAULT_CONFIG });

    expect(() => PortfolioSnapshot.parse(snap)).not.toThrow();
    expect(snap.holdings.reduce((a, h) => a + h.weight, 0) + snap.cash).toBeCloseTo(1, 9);
    expect(snap.excluded.map((e) => e.ticker)).toContain("HOLDME");
    // STRONG has the higher mu/conviction, so it is the top (or joint-cap) holding.
    expect(snap.holdings[0].ticker).toBe("STRONG");
    // No weight exceeds the 10% cap.
    for (const h of snap.holdings) expect(h.weight).toBeLessThanOrEqual(DEFAULT_CONFIG.wMax + 1e-9);
  });
});
```

- [ ] **Step 3: Run to verify it fails then implement**

Run: `npx vitest run lib/portfolio/pipeline.test.ts`
Expected: PASS once Tasks 1–9 are in (this task adds no new production code — it is the integration guard). If it fails, the failure localizes to whichever module's contract broke.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all pass (existing 822 + the new portfolio tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/__fixtures__/reports.ts lib/portfolio/pipeline.test.ts
git commit -m "test(portfolio): golden end-to-end snapshot pipeline"
```

---

## Out of scope for v1 (explicitly deferred)

- SPY / benchmark **return** tracking, tracking error, attribution — needs a *time series* of snapshots (paper phase). v1 only records `spyPrice` and EW-coverage active weights so a later snapshot-diff can compute returns.
- Realized-vol flooring, covariance, momentum, Black-Litterman (§12 v2/v3).
- Short sleeve (SELL/STRONG SELL), leverage.
- Turnover / no-trade band vs a *previous* book — v1 emits a fresh target each run; hysteresis arrives with the time series.
- Live execution, NAV, tax, liquidity.

---

## Self-review notes

- **Spec coverage:** eligibility §4 → Task 3; per-name inputs §5 → Task 2; sizing §6 (raw Kelly, quality, staleness, caps, cash) → Tasks 4–7; §7 constraints → Tasks 5–6; §9 EW-coverage benchmark → Task 8; §12 v1 CSV/JSON snapshot → Tasks 9–10; determinism/pure-core Global Constraints → enforced by injected prices + `asOf`. SPY-return tracking and everything under §12 v2/v3 are consciously deferred (Out of scope).
- **Type consistency:** `Signal`, `Weighted`, `Sized`, `ActiveRow`, `PortfolioSnapshot`, `PortfolioConfig` are each defined once and imported; `rawWeight`/`applyConstraints`/`finalizeCash`/`sizePortfolio` signatures match across Tasks 4–7 and the CLI.
- **Note for the executor:** `FactPack` import path is `../lib/facts/schema`; confirm `.sic` is on the parsed pack (it is, post-`facts:enrich`). If a covered name's pack is missing, `sicFor` returns `null` and the sector becomes `"??"` (its own sector bucket) — acceptable for v1.
