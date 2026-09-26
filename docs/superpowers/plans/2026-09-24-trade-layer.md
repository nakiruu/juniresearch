# Trade Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the layer that turns the portfolio engine's target book into compliant, low-turnover trades against a live ledger, executable first against Alpaca Paper.

**Architecture:** A pure, deterministic core (`lib/trade/`) — trading calendar, fills log, compliance locks, two-sided hysteresis, trade emitter, order sizing, ledger reconciliation, run records — with two thin I/O edges: a `BrokerAdapter` interface (`lib/broker/`) implemented by an in-memory `FakeBroker` and an `AlpacaPaperBroker`, and three run scripts. Compliance (ICE ticker ban, 5-business-day locks, paper-only) is enforced in the pure emitter *and* re-checked at the broker boundary.

**Tech Stack:** TypeScript (strict), Node 24 (`node --import tsx`), zod v4 for every persisted shape, vitest 5, native `fetch` for the Alpaca REST client (no SDK). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-trade-layer-design.md` — read it first; every task below cites the section it implements.

## Global Constraints

- Branch: all work on **`trade-layer`** (off `main`). **Never merge to `main`** in this plan; merge is gated on spec §11 Phase 1.
- Paper only: the Alpaca client **must refuse** any base URL not containing `paper-api`. There is **no `--live` flag** anywhere in this code.
- The ICE ban (`BANNED_TICKERS` in `lib/portfolio/eligibility.ts`) is never relaxed and is re-checked at `submitOrder`.
- `lockBusinessDays` default is **6** (spec §6.2, conservative reading) until the owner confirms 5.
- Locks are **whole-ticker**, both directions (spec §6.2, §16.0).
- `trade:plan` **never submits an order**. `trade:execute` requires an explicit `--paper` flag.
- Every persisted JSON/JSONL shape is a zod schema; every pure function has a vitest file beside it; TDD (failing test → run → implement → run → commit) for each task.
- Dates: trading dates are `YYYY-MM-DD` strings (lexicographically comparable); timestamps are ISO-8601 strings. Money is `number` (USD); Alpaca returns numeric strings — convert at the adapter boundary, nowhere else.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS`
- Run tests with `npx vitest run <path>`; run a script with `node --env-file-if-exists=.env.local --import tsx scripts/<name>.ts`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/trade/config.ts` | `TradeConfig` (extends `PortfolioConfig`) + defaults + `resolveTradeConfig` |
| `lib/trade/calendar.ts` (+test) | trading-day list helpers: `isTradingDay`, `addTradingDays`, `prevTradingDay` |
| `lib/trade/fills.ts` (+test) | `Fill` zod schema; parse/append/read `fills.jsonl` |
| `lib/trade/locks.ts` (+test) | `locksFor` — buy/sell lock dates per ticker from fills (spec §6.2) |
| `lib/trade/hysteresis.ts` (+test) | `classify` — ENTER/HOLD/EXIT/DEFER_EXIT/BARRED_ENTRY/INELIGIBLE (spec §5) |
| `lib/portfolio/sizing.ts` (modify) + `config.ts` (modify) | quality tilt behind `useQualityTilt` (spec §5.4) |
| `lib/trade/rebalance.ts` (+test) | `emitTrades` — freeze, reduced-target sizing, band, cash, ban (spec §7) |
| `lib/trade/costs.ts` (+test) | round-trip bps by liquidity bucket (spec §7.8) |
| `lib/trade/orders.ts` (+test) | `tradesToOrders` — notional/qty, dust, `clientOrderId` (spec §9) |
| `lib/trade/ledger.ts` (+test) | `Ledger` schema, `reconcile` (halts on unexplained position), read/write (spec §3) |
| `lib/trade/run-record.ts` (+test) | `RunRecord` schema + writer (spec §14) |
| `lib/broker/adapter.ts` | `BrokerAdapter` interface and broker-side types (spec §8.1) |
| `lib/broker/fake.ts` (+test) | in-memory adapter; instant fills at the mark |
| `lib/broker/guards.ts` (+test) | submit-time re-checks: paper URL, ban, locks, caps, kill switch (spec §8.3) |
| `lib/broker/alpaca.ts` (+test w/ mocked fetch) | Alpaca Paper REST client (spec §8.2) |
| `lib/trade/pipeline.ts` (+test) | `planRun` — one pure orchestration of marks→signals→locks→plan→orders (used by scripts + e2e) |
| `scripts/_env.ts` (modify) | `requireAlpaca()` |
| `scripts/trade-plan.ts`, `trade-reconcile.ts`, `trade-execute.ts` | the three commands (spec §10) |
| `.env.example`, `.gitignore`, `package.json` (modify) | keys, `data/trade/` ignore, npm scripts |

`lib/portfolio/signal.ts` is **not** modified: `buildSignal` already takes the price as a parameter, so "previous settled close" (spec §4) is a property of *which price the script fetches*, implemented in the adapter's `getLastClose` and the pipeline.

---

### Task 1: TradeConfig and the trading calendar

**Files:**
- Create: `lib/trade/config.ts`
- Create: `lib/trade/calendar.ts`
- Test: `lib/trade/calendar.test.ts`

**Interfaces:**
- Consumes: `PortfolioConfig`, `DEFAULT_CONFIG` from `lib/portfolio/config.ts`.
- Produces:
  ```ts
  export interface TradeConfig extends PortfolioConfig {
    muEnter: number; muExit: number; rEnter: number; rExit: number;
    tradeBand: number; lockBusinessDays: number; markMode: "settled" | "live";
    minOrderUsd: number; maxOrdersPerRun: number; maxNotionalFrac: number;
  }
  export const DEFAULT_TRADE_CONFIG: TradeConfig;
  export function resolveTradeConfig(overrides?: Partial<TradeConfig>): TradeConfig;
  export type TradingDay = string;                       // YYYY-MM-DD
  export function assertCalendar(days: TradingDay[]): void;
  export function isTradingDay(days: TradingDay[], d: string): boolean;
  export function indexOnOrBefore(days: TradingDay[], d: string): number; // -1 if none
  export function addTradingDays(days: TradingDay[], from: TradingDay, n: number): TradingDay;
  export function prevTradingDay(days: TradingDay[], d: string): TradingDay;
  ```

- [ ] **Step 1: Write the failing calendar test**

`lib/trade/calendar.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { assertCalendar, isTradingDay, indexOnOrBefore, addTradingDays, prevTradingDay } from "./calendar";

// Mon 2026-09-21 … Fri 2026-10-02, with Thu 2026-09-24 removed to stand in for a holiday.
const CAL = [
  "2026-09-21", "2026-09-22", "2026-09-23", /* holiday 09-24 */ "2026-09-25",
  "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
];

describe("assertCalendar", () => {
  it("accepts a sorted, unique list", () => { expect(() => assertCalendar(CAL)).not.toThrow(); });
  it("rejects unsorted or duplicate days", () => {
    expect(() => assertCalendar(["2026-09-22", "2026-09-21"])).toThrow(/sorted/);
    expect(() => assertCalendar(["2026-09-21", "2026-09-21"])).toThrow(/sorted/);
  });
});

describe("isTradingDay / indexOnOrBefore / prevTradingDay", () => {
  it("knows weekends and the holiday are not trading days", () => {
    expect(isTradingDay(CAL, "2026-09-26")).toBe(false); // Sat
    expect(isTradingDay(CAL, "2026-09-24")).toBe(false); // holiday
    expect(isTradingDay(CAL, "2026-09-25")).toBe(true);
  });
  it("finds the last trading day on or before a date", () => {
    expect(indexOnOrBefore(CAL, "2026-09-26")).toBe(3);   // Sat → Fri 09-25
    expect(indexOnOrBefore(CAL, "2026-09-25")).toBe(3);
    expect(indexOnOrBefore(CAL, "2026-09-20")).toBe(-1);  // before the calendar
  });
  it("prevTradingDay is strictly before the date, skipping weekends and holidays", () => {
    expect(prevTradingDay(CAL, "2026-09-28")).toBe("2026-09-25"); // Mon → Fri
    expect(prevTradingDay(CAL, "2026-09-25")).toBe("2026-09-23"); // Fri → Wed (Thu is the holiday)
    expect(prevTradingDay(CAL, "2026-09-27")).toBe("2026-09-25"); // Sun → Fri
    expect(() => prevTradingDay(CAL, "2026-09-21")).toThrow(/no trading day/);
  });
});

describe("addTradingDays", () => {
  it("steps forward n trading days, skipping the weekend and the holiday", () => {
    expect(addTradingDays(CAL, "2026-09-21", 1)).toBe("2026-09-22");
    expect(addTradingDays(CAL, "2026-09-23", 1)).toBe("2026-09-25"); // skips holiday
    expect(addTradingDays(CAL, "2026-09-21", 5)).toBe("2026-09-29"); // Mon +5 → Tue 09-29: the holiday pushes it a day past "next Mon"
    expect(addTradingDays(CAL, "2026-09-21", 6)).toBe("2026-09-30");
  });
  it("requires `from` to be a trading day and stays inside the calendar", () => {
    expect(() => addTradingDays(CAL, "2026-09-24", 1)).toThrow(/not a trading day/);
    expect(() => addTradingDays(CAL, "2026-10-02", 1)).toThrow(/beyond/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/trade/calendar.test.ts`
Expected: FAIL — `Cannot find module './calendar'`.

- [ ] **Step 3: Write config.ts and calendar.ts**

`lib/trade/config.ts`:
```ts
/**
 * config.ts — the trade layer's knobs, layered on the portfolio config.
 * Spec §12. `rMin`/`muMin` stay for the analytical snapshot; trading uses the band pair.
 */
import { DEFAULT_CONFIG, type PortfolioConfig } from "../portfolio/config";

export interface TradeConfig extends PortfolioConfig {
  muEnter: number;          // enter only if re-marked expected upside >= this (0.08)
  muExit: number;           // exit a held name only if upside < this (0.03 — rallied to target)
  rEnter: number;           // enter only if reward/risk >= this (0.60)
  rExit: number;            // exit only if reward/risk < this (0.35 — asymmetry genuinely gone)
  tradeBand: number;        // no-trade band on held names, absolute weight (0.025)
  lockBusinessDays: number; // trading days from a fill to the first legal opposite-side trade (6 = conservative)
  markMode: "settled" | "live";
  minOrderUsd: number;      // skip dust trades below this notional
  maxOrdersPerRun: number;  // run-level sanity cap on order count
  maxNotionalFrac: number;  // run-level cap on total submitted notional as a fraction of NAV
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  ...DEFAULT_CONFIG,
  muEnter: 0.08, muExit: 0.03, rEnter: 0.6, rExit: 0.35,
  tradeBand: 0.025, lockBusinessDays: 6, markMode: "settled",
  minOrderUsd: 25, maxOrdersPerRun: 40, maxNotionalFrac: 1.0,
};

export function resolveTradeConfig(overrides: Partial<TradeConfig> = {}): TradeConfig {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...overrides };
  if (!(cfg.rExit < cfg.rEnter)) throw new Error(`rExit (${cfg.rExit}) must be below rEnter (${cfg.rEnter})`);
  if (!(cfg.muExit < cfg.muEnter)) throw new Error(`muExit (${cfg.muExit}) must be below muEnter (${cfg.muEnter})`);
  if (!Number.isInteger(cfg.lockBusinessDays) || cfg.lockBusinessDays < 1) throw new Error("lockBusinessDays must be a positive integer");
  return cfg;
}
```

`lib/trade/calendar.ts`:
```ts
/**
 * calendar.ts — "business day" means an NYSE trading day (spec §6.1).
 * Pure: every function takes the sorted trading-day list; nothing here reads the clock.
 */
export type TradingDay = string; // YYYY-MM-DD

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function assertCalendar(days: TradingDay[]): void {
  for (let i = 0; i < days.length; i++) {
    if (!DAY.test(days[i])) throw new Error(`calendar: bad date ${JSON.stringify(days[i])}`);
    if (i > 0 && !(days[i - 1] < days[i])) throw new Error(`calendar: not strictly sorted at ${days[i - 1]} -> ${days[i]}`);
  }
}

export function isTradingDay(days: TradingDay[], d: string): boolean {
  const i = indexOnOrBefore(days, d);
  return i >= 0 && days[i] === d;
}

/** Index of the last trading day <= d, or -1 if d precedes the calendar. Binary search. */
export function indexOnOrBefore(days: TradingDay[], d: string): number {
  let lo = 0, hi = days.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The trading day n steps after `from` (which must itself be a trading day). */
export function addTradingDays(days: TradingDay[], from: TradingDay, n: number): TradingDay {
  const i = indexOnOrBefore(days, from);
  if (i < 0 || days[i] !== from) throw new Error(`addTradingDays: ${from} is not a trading day`);
  const j = i + n;
  if (j < 0 || j >= days.length) throw new Error(`addTradingDays: ${from} + ${n} is beyond the loaded calendar`);
  return days[j];
}

/** The last trading day strictly before d (d need not be a trading day). */
export function prevTradingDay(days: TradingDay[], d: string): TradingDay {
  const i = indexOnOrBefore(days, d);
  const j = i >= 0 && days[i] === d ? i - 1 : i;
  if (j < 0) throw new Error(`prevTradingDay: no trading day before ${d} in the loaded calendar`);
  return days[j];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/trade/calendar.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/trade/config.ts lib/trade/calendar.ts lib/trade/calendar.test.ts
git commit -m "feat(trade): TradeConfig defaults and pure trading-calendar helpers

Spec §6.1, §12. lockBusinessDays defaults to the conservative 6 pending
compliance confirmation; rExit/muExit are validated to sit below the
entry thresholds so the hysteresis band can never invert.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 2: Fills log and compliance locks

**Files:**
- Create: `lib/trade/fills.ts`
- Create: `lib/trade/locks.ts`
- Test: `lib/trade/fills.test.ts`, `lib/trade/locks.test.ts`

**Interfaces:**
- Consumes: `TradingDay`, `addTradingDays` (Task 1).
- Produces:
  ```ts
  export const Fill: z.ZodType<Fill>;   // zod schema
  export interface Fill { ticker: string; side: "buy" | "sell"; qty: number; price: number;
                          filledAt: string; tradingDate: TradingDay; orderId: string; runId: string }
  export function parseFillsJsonl(text: string): Fill[];
  export function readFills(path: string): Fill[];            // [] when the file is absent
  export function appendFill(path: string, fill: Fill): void;
  export interface Locks { buyLockUntil: Record<string, TradingDay>; sellLockUntil: Record<string, TradingDay> }
  export function locksFor(fills: Fill[], calendar: TradingDay[], lockBusinessDays: number): Locks;
  export function isBuyLocked(locks: Locks, ticker: string, today: TradingDay): boolean;
  export function isSellLocked(locks: Locks, ticker: string, today: TradingDay): boolean;
  ```
  Semantics (spec §6.2): a **buy** fill on `T` sets `sellLockUntil[ticker] = addTradingDays(cal, T, n)`; a **sell** fill sets `buyLockUntil`. Later fills extend (max). A side is locked on `today` iff `today < lockUntil` — so `lockUntil` **is** the first legal day.

- [ ] **Step 1: Write the failing tests**

`lib/trade/fills.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Fill, parseFillsJsonl, readFills, appendFill } from "./fills";

const fill = (o: Partial<Fill> = {}): Fill => ({
  ticker: "NVT", side: "buy", qty: 10, price: 100, filledAt: "2026-09-21T14:30:00Z",
  tradingDate: "2026-09-21", orderId: "o1", runId: "r1", ...o,
});

describe("Fill schema", () => {
  it("accepts a well-formed fill and rejects a bad trading date or non-positive qty", () => {
    expect(Fill.parse(fill())).toEqual(fill());
    expect(() => Fill.parse(fill({ tradingDate: "21/09/2026" }))).toThrow();
    expect(() => Fill.parse(fill({ qty: 0 }))).toThrow();
  });
});

describe("fills.jsonl round trip", () => {
  it("parses one fill per line, ignoring blank lines", () => {
    const text = JSON.stringify(fill()) + "\n\n" + JSON.stringify(fill({ ticker: "MP", side: "sell" })) + "\n";
    expect(parseFillsJsonl(text).map((f) => f.ticker)).toEqual(["NVT", "MP"]);
  });
  it("appends and reads back in order; a missing file reads as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "fills-"));
    const p = join(dir, "fills.jsonl");
    expect(readFills(p)).toEqual([]);
    appendFill(p, fill());
    appendFill(p, fill({ ticker: "MP" }));
    expect(readFills(p).map((f) => f.ticker)).toEqual(["NVT", "MP"]);
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });
});
```

`lib/trade/locks.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { locksFor, isBuyLocked, isSellLocked } from "./locks";
import type { Fill } from "./fills";

// Mon 09-21 … Fri 10-02, Thu 09-24 is a holiday (see calendar.test.ts).
const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const f = (side: "buy" | "sell", tradingDate: string, ticker = "NVT"): Fill =>
  ({ ticker, side, qty: 1, price: 1, filledAt: `${tradingDate}T15:00:00Z`, tradingDate, orderId: "o", runId: "r" });

describe("locksFor", () => {
  it("a Monday buy with the 6-day default is sellable on Wed 09-30 (six trading days on, holiday skipped)", () => {
    const L = locksFor([f("buy", "2026-09-21")], CAL, 6);
    expect(L.sellLockUntil.NVT).toBe("2026-09-30");
    expect(isSellLocked(L, "NVT", "2026-09-29")).toBe(true);   // day before first legal
    expect(isSellLocked(L, "NVT", "2026-09-30")).toBe(false);  // first legal day
    expect(isBuyLocked(L, "NVT", "2026-09-22")).toBe(false);   // buys are not locked by a buy
  });
  it("with 5 days (the 'count the transaction day' reading) the same buy is sellable on Tue 09-29", () => {
    expect(locksFor([f("buy", "2026-09-21")], CAL, 5).sellLockUntil.NVT).toBe("2026-09-29");
  });
  it("a sell locks buys, not sells", () => {
    const L = locksFor([f("sell", "2026-09-23")], CAL, 6);
    expect(L.buyLockUntil.NVT).toBe("2026-10-02");
    expect(isBuyLocked(L, "NVT", "2026-09-30")).toBe(true);
    expect(isSellLocked(L, "NVT", "2026-09-25")).toBe(false);
  });
  it("adding to a position restarts the whole-ticker sell-lock (later fill wins)", () => {
    const L = locksFor([f("buy", "2026-09-21"), f("buy", "2026-09-23")], CAL, 6);
    expect(L.sellLockUntil.NVT).toBe("2026-10-02"); // from the 09-23 fill, not 09-21
  });
  it("locks are per ticker", () => {
    const L = locksFor([f("buy", "2026-09-21", "NVT"), f("sell", "2026-09-21", "MP")], CAL, 6);
    expect(L.sellLockUntil).toEqual({ NVT: "2026-09-30" });
    expect(L.buyLockUntil).toEqual({ MP: "2026-09-30" });
  });
  it("a fill dated on a non-trading day is an error (fills must carry the fill's trading date)", () => {
    expect(() => locksFor([f("buy", "2026-09-24")], CAL, 6)).toThrow(/not a trading day/);
  });
  it("no fills → no locks", () => {
    expect(locksFor([], CAL, 6)).toEqual({ buyLockUntil: {}, sellLockUntil: {} });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/trade/fills.test.ts lib/trade/locks.test.ts`
Expected: FAIL — cannot find `./fills` / `./locks`.

- [ ] **Step 3: Write fills.ts and locks.ts**

`lib/trade/fills.ts`:
```ts
/**
 * fills.ts — the append-only fills log, the one record the compliance locks derive from (spec §3, §6.2).
 * Parsing is pure; readFills/appendFill are the only fs touches, and appendFill only ever appends.
 */
import { z } from "zod";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const Fill = z.object({
  ticker: z.string().regex(/^[A-Z0-9.-]+$/),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive(),
  price: z.number().positive(),
  filledAt: z.string().min(1),                       // ISO-8601 from the broker
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // the fill's trading date — the lock clock starts here
  orderId: z.string().min(1),
  runId: z.string().min(1),
});
export type Fill = z.infer<typeof Fill>;

export function parseFillsJsonl(text: string): Fill[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).map((l) => Fill.parse(JSON.parse(l)));
}

export function readFills(path: string): Fill[] {
  if (!existsSync(path)) return [];
  return parseFillsJsonl(readFileSync(path, "utf8"));
}

export function appendFill(path: string, fill: Fill): void {
  appendFileSync(path, JSON.stringify(Fill.parse(fill)) + "\n");
}
```

`lib/trade/locks.ts`:
```ts
/**
 * locks.ts — the owner's 5-business-day no-round-trip rule as data (spec §6.2).
 * A buy fill on T forbids selling that ticker before addTradingDays(T, n); a sell fill forbids
 * buying it before the same. Whole-ticker, both directions; the latest fill per side wins.
 * `lockUntil` IS the first legal day: locked iff today < lockUntil.
 */
import { addTradingDays, type TradingDay } from "./calendar";
import type { Fill } from "./fills";

export interface Locks {
  buyLockUntil: Record<string, TradingDay>;
  sellLockUntil: Record<string, TradingDay>;
}

export function locksFor(fills: Fill[], calendar: TradingDay[], lockBusinessDays: number): Locks {
  const locks: Locks = { buyLockUntil: {}, sellLockUntil: {} };
  for (const f of fills) {
    const until = addTradingDays(calendar, f.tradingDate, lockBusinessDays); // throws if tradingDate is not a trading day
    const table = f.side === "buy" ? locks.sellLockUntil : locks.buyLockUntil;
    const prev = table[f.ticker];
    if (prev == null || until > prev) table[f.ticker] = until;
  }
  return locks;
}

export function isBuyLocked(locks: Locks, ticker: string, today: TradingDay): boolean {
  const until = locks.buyLockUntil[ticker];
  return until != null && today < until;
}

export function isSellLocked(locks: Locks, ticker: string, today: TradingDay): boolean {
  const until = locks.sellLockUntil[ticker];
  return until != null && today < until;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/trade/fills.test.ts lib/trade/locks.test.ts`
Expected: PASS (3 + 7 tests). Note the holiday case: a 09-21 buy at n=6 lands on 09-30 — six trading days on, with 09-24 skipped.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/fills.ts lib/trade/fills.test.ts lib/trade/locks.ts lib/trade/locks.test.ts
git commit -m "feat(trade): fills log schema and whole-ticker compliance locks

Spec §3, §6.2. The lock clock starts on the fill's trading date; a buy
locks sells and a sell locks buys for lockBusinessDays trading days,
holidays and weekends skipped via the calendar. lockUntil is the first
legal day, so a 09-21 buy with n=6 is sellable on 09-30 when 09-24 is a
holiday.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 3: Two-sided eligibility (hysteresis)

**Files:**
- Create: `lib/trade/hysteresis.ts`
- Test: `lib/trade/hysteresis.test.ts`

**Interfaces:**
- Consumes: `Signal` (`lib/portfolio/signal.ts`), `isBannedTicker` (`lib/portfolio/eligibility.ts`), `TradeConfig` (Task 1), `Locks`/`isBuyLocked`/`isSellLocked` (Task 2), `TradingDay`.
- Produces:
  ```ts
  export type Classification = "ENTER" | "HOLD" | "EXIT" | "DEFER_EXIT" | "BARRED_ENTRY" | "INELIGIBLE";
  export interface Classified { ticker: string; classification: Classification; reasons: string[]; unlockOn?: TradingDay }
  export function classify(s: Signal, held: boolean, locks: Locks, today: TradingDay, cfg: TradeConfig): Classified;
  ```
  Rules are spec §5 verbatim. Note **conviction is an entry condition only** — a held name is never sold for conviction dipping (§5.3 does not list it).

- [ ] **Step 1: Write the failing test (the full transition table)**

`lib/trade/hysteresis.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classify } from "./hysteresis";
import { DEFAULT_TRADE_CONFIG as cfg } from "./config";
import type { Signal } from "../portfolio/signal";
import type { Locks } from "./locks";

const sig = (o: Partial<Signal> = {}): Signal => ({
  ticker: "NVT", company: "nVent", sector: "35", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.15, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 0.8, kappa: 0.6,
  quality: 1, ageDays: 10, staleness: 0.9, ...o,
});
const NONE: Locks = { buyLockUntil: {}, sellLockUntil: {} };
const TODAY = "2026-09-25";

describe("classify — not held", () => {
  it("ENTERs a fresh BUY above both entry thresholds", () => {
    expect(classify(sig(), false, NONE, TODAY, cfg).classification).toBe("ENTER");
  });
  it("is INELIGIBLE below the entry bar on mu, on R, on conviction, on the gate, on staleness", () => {
    for (const o of [{ mu: 0.05 }, { R: 0.55 }, { kappa: 0.4 }, { gatedLabel: "HOLD" as const }, { ageDays: 130 }, { label: "HOLD" as const }]) {
      const c = classify(sig(o), false, NONE, TODAY, cfg);
      expect(c.classification).toBe("INELIGIBLE");
      expect(c.reasons.length).toBeGreaterThan(0);
    }
  });
  it("is BARRED_ENTRY, with the unlock date, when everything passes but the name is buy-locked", () => {
    const L: Locks = { buyLockUntil: { NVT: "2026-09-29" }, sellLockUntil: {} };
    expect(classify(sig(), false, L, TODAY, cfg)).toEqual({ ticker: "NVT", classification: "BARRED_ENTRY", reasons: ["buy-locked"], unlockOn: "2026-09-29" });
  });
  it("a banned ticker is INELIGIBLE whatever its signal", () => {
    const c = classify(sig({ ticker: "ICE", label: "STRONG BUY", gatedLabel: "STRONG BUY", mu: 0.5, R: 3 }), false, NONE, TODAY, cfg);
    expect(c.classification).toBe("INELIGIBLE");
    expect(c.reasons[0]).toMatch(/banned/);
  });
});

describe("classify — held", () => {
  it("HOLDs a name that dipped below the ENTRY bar but is above the EXIT bar (the whole point)", () => {
    // mu 0.05 < muEnter 0.08 but >= muExit 0.03; R 0.45 < rEnter 0.6 but >= rExit 0.35
    expect(classify(sig({ mu: 0.05, R: 0.45, kappa: 0.3 }), true, NONE, TODAY, cfg).classification).toBe("HOLD");
  });
  it("EXITs on mu below the exit floor (rallied to target)", () => {
    const c = classify(sig({ mu: 0.02 }), true, NONE, TODAY, cfg);
    expect(c.classification).toBe("EXIT");
    expect(c.reasons[0]).toMatch(/thesis played out/);
  });
  it("EXITs on R below the exit floor, on a downgrade, on a gate trip, on staleness, on ban", () => {
    for (const o of [{ R: 0.3 }, { label: "HOLD" as const }, { gatedLabel: "SELL" as const }, { ageDays: 121 }, { ticker: "ICE" }]) {
      expect(classify(sig(o), true, NONE, TODAY, cfg).classification).toBe("EXIT");
    }
  });
  it("DEFERs an exit while sell-locked and reports the unlock date", () => {
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { NVT: "2026-09-29" } };
    const c = classify(sig({ mu: 0.02 }), true, L, TODAY, cfg);
    expect(c.classification).toBe("DEFER_EXIT");
    expect(c.unlockOn).toBe("2026-09-29");
    expect(c.reasons[0]).toMatch(/thesis played out/);
  });
  it("executes the exit on the unlock day itself", () => {
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { NVT: "2026-09-29" } };
    expect(classify(sig({ mu: 0.02 }), true, L, "2026-09-29", cfg).classification).toBe("EXIT");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/trade/hysteresis.test.ts`
Expected: FAIL — cannot find `./hysteresis`.

- [ ] **Step 3: Write hysteresis.ts**

```ts
/**
 * hysteresis.ts — two-sided eligibility (spec §5). Entry and exit have different bars, keyed on
 * whether the name is currently held, so a held name is never sold for merely dipping below the
 * entry bar. Pure: locks and `today` are inputs.
 */
import type { Signal } from "../portfolio/signal";
import { isBannedTicker } from "../portfolio/eligibility";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { isBuyLocked, isSellLocked, type Locks } from "./locks";

const BUY_SIDE = new Set(["BUY", "STRONG BUY"]);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rStr = (r: number | null) => (r == null ? "—" : r.toFixed(2));

export type Classification = "ENTER" | "HOLD" | "EXIT" | "DEFER_EXIT" | "BARRED_ENTRY" | "INELIGIBLE";
export interface Classified { ticker: string; classification: Classification; reasons: string[]; unlockOn?: TradingDay }

export function classify(s: Signal, held: boolean, locks: Locks, today: TradingDay, cfg: TradeConfig): Classified {
  const t = s.ticker;
  if (held) {
    const exits: string[] = [];
    if (isBannedTicker(t)) exits.push(`banned: ${t} (employer holding restriction)`);
    if (!BUY_SIDE.has(s.label)) exits.push(`label ${s.label} not buy-side`);
    if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) exits.push(`gate ceiling ${s.gatedLabel}`);
    if (s.mu < cfg.muExit) exits.push(`mu ${pct(s.mu)} < exit ${pct(cfg.muExit)} (thesis played out)`);
    if (s.R == null || s.R < cfg.rExit) exits.push(`R ${rStr(s.R)} < exit ${cfg.rExit}`);
    if (s.ageDays > cfg.stalenessMaxDays) exits.push(`stale ${s.ageDays}d > ${cfg.stalenessMaxDays}d`);
    if (exits.length === 0) return { ticker: t, classification: "HOLD", reasons: [] };
    if (isSellLocked(locks, t, today)) return { ticker: t, classification: "DEFER_EXIT", reasons: exits, unlockOn: locks.sellLockUntil[t] };
    return { ticker: t, classification: "EXIT", reasons: exits };
  }
  if (isBannedTicker(t)) return { ticker: t, classification: "INELIGIBLE", reasons: [`banned: ${t} (employer holding restriction)`] };
  const fails: string[] = [];
  if (!BUY_SIDE.has(s.label)) fails.push(`label ${s.label} not buy-side`);
  if (s.gatedLabel && !BUY_SIDE.has(s.gatedLabel)) fails.push(`gate ceiling ${s.gatedLabel}`);
  if (s.mu < cfg.muEnter) fails.push(`mu ${pct(s.mu)} < enter ${pct(cfg.muEnter)}`);
  if (s.R == null || s.R < cfg.rEnter) fails.push(`R ${rStr(s.R)} < enter ${cfg.rEnter}`);
  if (s.kappa * 100 < cfg.convictionMin) fails.push(`conviction ${(s.kappa * 100).toFixed(0)} < ${cfg.convictionMin}`);
  if (s.ageDays > cfg.stalenessMaxDays) fails.push(`stale ${s.ageDays}d > ${cfg.stalenessMaxDays}d`);
  if (fails.length) return { ticker: t, classification: "INELIGIBLE", reasons: fails };
  if (isBuyLocked(locks, t, today)) return { ticker: t, classification: "BARRED_ENTRY", reasons: ["buy-locked"], unlockOn: locks.buyLockUntil[t] };
  return { ticker: t, classification: "ENTER", reasons: [] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/trade/hysteresis.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/trade/hysteresis.ts lib/trade/hysteresis.test.ts
git commit -m "feat(trade): two-sided eligibility with deferred exits under sell-locks

Spec §5. Enter at R>=0.6 / mu>=8%; a held name is sold only on mu<3%,
R<0.35, a downgrade, a gate trip, staleness or the ban - never for
dipping below the entry bar. An exit inside a sell-lock is deferred with
its unlock date and fires on the first legal day.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 4: Wire the quality tilt into sizing (opt-in, trade layer only)

**Files:**
- Modify: `lib/portfolio/sizing.ts:24-35` (`scoreWeight`)
- Modify: `lib/trade/config.ts` (add `useQualityTilt`)
- Test: `lib/portfolio/sizing.test.ts` (extend)

**Interfaces:**
- Consumes: `Signal.quality` (already computed in `signal.ts`, currently unused).
- Produces: `scoreWeight(s: Signal, config: PortfolioConfig, opts?: { qualityTilt?: boolean }): number` — **default `false`**, so the analytical `portfolio:build` snapshot and its zod `config: record<number>` are untouched. `TradeConfig.useQualityTilt: boolean` (default `true`); Task 5 passes `{ qualityTilt: cfg.useQualityTilt }`.

- [ ] **Step 1: Write the failing tests** — append to the `describe("scoreWeight")` block in `lib/portfolio/sizing.test.ts`:

```ts
  it("ignores quality by default, so the analytical snapshot is unchanged", () => {
    expect(scoreWeight(sig({ quality: 1.2 }), DEFAULT_CONFIG)).toBeCloseTo(0.12, 9);
  });
  it("multiplies by quality when the tilt is requested", () => {
    expect(scoreWeight(sig({ quality: 1.2 }), DEFAULT_CONFIG, { qualityTilt: true })).toBeCloseTo(0.144, 9);
    expect(scoreWeight(sig({ quality: 0.8 }), DEFAULT_CONFIG, { qualityTilt: true })).toBeCloseTo(0.096, 9);
  });
```

- [ ] **Step 2: Run to verify the second test fails**

Run: `npx vitest run lib/portfolio/sizing.test.ts`
Expected: the "multiplies by quality" test FAILS (extra arg ignored, 0.12 ≠ 0.144); the default test passes.

- [ ] **Step 3: Implement** — replace the `scoreWeight` function body in `lib/portfolio/sizing.ts`:

```ts
export function scoreWeight(s: Signal, config: PortfolioConfig, opts: { qualityTilt?: boolean } = {}): number {
  if (s.R == null) return 0;
  const mu = Math.max(s.mu, 0);
  const conv = Math.max(s.kappa, 0);
  const r = Math.max(s.R, 0);
  const score =
    Math.pow(mu, config.muExp) *
    Math.pow(conv, config.convExp) *
    Math.pow(r, config.rExp) *
    s.staleness *
    (opts.qualityTilt ? s.quality : 1);   // spec §5.4: the moat/composite tilt, opt-in so the analytical snapshot is unchanged
  return Number.isFinite(score) && score > 0 ? score : 0;
}
```

And in `lib/trade/config.ts` add to the interface `useQualityTilt: boolean;` (comment: `// spec §5.4 — multiply scoreWeight by Signal.quality`) and to `DEFAULT_TRADE_CONFIG` the entry `useQualityTilt: true,`.

- [ ] **Step 4: Run the whole portfolio suite to verify nothing else moved**

Run: `npx vitest run lib/portfolio lib/trade`
Expected: PASS; every pre-existing sizing/pipeline test unchanged (they all use `quality: 1` or the default).

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio/sizing.ts lib/portfolio/sizing.test.ts lib/trade/config.ts
git commit -m "feat(sizing): opt-in quality tilt in scoreWeight; on by default for the trade layer

Spec §5.4. Signal.quality (composite pctile, moat width, eroding penalty)
was computed and never used. scoreWeight now applies it behind an
explicit option so the analytical portfolio:build snapshot is unchanged;
TradeConfig.useQualityTilt defaults to true.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 5: The trade emitter (`emitTrades`)

**Files:**
- Create: `lib/trade/rebalance.ts`
- Test: `lib/trade/rebalance.test.ts`

**Interfaces:**
- Consumes: `classify`/`Classified` (Task 3), `scoreWeight`/`allocateCapped` (`lib/portfolio/sizing.ts`, Task 4 signature), `isBannedTicker`, `Locks`/`isBuyLocked`/`isSellLocked` (Task 2), `TradeConfig`, `TradingDay`.
- Produces:
  ```ts
  export type TradeReason = "ENTER" | "EXIT" | "ADD" | "TRIM";
  export interface Trade { ticker: string; sector: string; side: "buy" | "sell"; reason: TradeReason;
                           currentWeight: number; targetWeight: number; deltaWeight: number }
  export type SkipCode = "BELOW_BAND" | "BARRED_ENTRY" | "BARRED_ADD" | "DEFER_EXIT" | "DEFER_TRIM" | "INELIGIBLE" | "NO_SIGNAL" | "NO_CAPACITY";
  export interface Skipped { ticker: string; code: SkipCode; reasons: string[]; unlockOn?: TradingDay;
                             currentWeight: number; targetWeight: number | null }
  export interface TradePlan { today: TradingDay; trades: Trade[]; skipped: Skipped[]; classifications: Classified[];
                               frozenWeight: number; sizingTarget: number; plannedInvested: number; plannedCash: number; buyScale: number }
  export function emitTrades(input: { signals: Signal[]; currentWeights: Record<string, number>;
                                      locks: Locks; today: TradingDay; cfg: TradeConfig }): TradePlan;
  ```
  `currentWeights` is `marketValue / nav` per held ticker from the ledger (Task 7); absent ⇒ 0 ⇒ not held. Spec §7 steps 1–8, plus two rules the spec implies: a **held name with no signal** (its report vanished) is frozen (`NO_SIGNAL`) rather than traded on missing data; and the **ban means never buy** — an EXIT sell of a banned ticker is the remedy and is emitted.

- [ ] **Step 1: Write the failing tests**

`lib/trade/rebalance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { emitTrades } from "./rebalance";
import { resolveTradeConfig } from "./config";
import type { Signal } from "../portfolio/signal";
import type { Locks } from "./locks";

const sig = (o: Partial<Signal> = {}): Signal => ({
  ticker: "A", company: "A", sector: "35", label: "BUY", gatedLabel: "BUY",
  price: 100, mu: 0.15, sigma: 0.25, sigmaDown: 0.1, D: 0.2, R: 0.8, kappa: 0.6,
  quality: 1, ageDays: 10, staleness: 1, ...o,
});
const NONE: Locks = { buyLockUntil: {}, sellLockUntil: {} };
const TODAY = "2026-09-25";
// Wide caps so targets are readable: two equal-score names split the target 50/50.
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 });
const run = (signals: Signal[], currentWeights: Record<string, number>, locks = NONE, c = cfg) =>
  emitTrades({ signals, currentWeights, locks, today: TODAY, cfg: c });

describe("emitTrades", () => {
  it("ENTERs a new name by buying to its target, leaving the cash floor", () => {
    const p = run([sig()], {});
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "A", side: "buy", reason: "ENTER", currentWeight: 0 })]);
    expect(p.trades[0].targetWeight).toBeCloseTo(0.99, 9);
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
  });

  it("freezes a deferred exit and sizes the rest into the reduced target", () => {
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { A: "2026-09-29" } };
    const p = run([sig({ ticker: "A", mu: 0.02 }), sig({ ticker: "B" })], { A: 0.30 }, L);
    expect(p.frozenWeight).toBeCloseTo(0.30, 9);
    expect(p.sizingTarget).toBeCloseTo(0.69, 9);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "DEFER_EXIT", unlockOn: "2026-09-29", targetWeight: 0.30 }));
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "B", side: "buy", reason: "ENTER" })]);
    expect(p.trades[0].deltaWeight).toBeCloseTo(0.69, 9);
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
  });

  it("bars a buy-locked entry and leaves its capital in cash", () => {
    const L: Locks = { buyLockUntil: { A: "2026-09-29" }, sellLockUntil: {} };
    const p = run([sig()], {}, L);
    expect(p.trades).toEqual([]);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BARRED_ENTRY", unlockOn: "2026-09-29" }));
    expect(p.plannedCash).toBeCloseTo(1, 9);
  });

  it("suppresses a drift inside the band and trades one outside it (ADD)", () => {
    // Equal scores → targets 0.495 each. A drifted +1.5pp (inside 2.5pp band); B is 9.5pp under.
    const p = run([sig({ ticker: "A" }), sig({ ticker: "B" })], { A: 0.48, B: 0.40 });
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "BELOW_BAND" }));
    const b = p.trades.find((t) => t.ticker === "B")!;
    expect(b).toEqual(expect.objectContaining({ side: "buy", reason: "ADD" }));
    expect(b.deltaWeight).toBeCloseTo(0.095, 9);
  });

  it("defers a sell-locked trim and never leverages: the freed room is not spent", () => {
    // A is 10.5pp OVER target but sell-locked → DEFER_TRIM. B is 10.5pp under → wants an ADD,
    // but buying it would push invested to 1.095. Buys are scaled to keep cash ≥ floor.
    const L: Locks = { buyLockUntil: {}, sellLockUntil: { A: "2026-09-29" } };
    const p = run([sig({ ticker: "A" }), sig({ ticker: "B" })], { A: 0.60, B: 0.39 }, L);
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "A", code: "DEFER_TRIM", unlockOn: "2026-09-29" }));
    expect(p.buyScale).toBeCloseTo(0, 9);
    expect(p.trades.filter((t) => t.side === "buy")).toEqual([]);           // the scaled-to-zero buy is dropped …
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "B", code: "NO_CAPACITY" })); // … and recorded
    expect(p.plannedCash).toBeCloseTo(0.01, 9);
    expect(p.plannedInvested).toBeLessThanOrEqual(0.99 + 1e-9);
  });

  it("EXITs by selling the whole position", () => {
    const p = run([sig({ mu: 0.02 })], { A: 0.07 });
    expect(p.trades).toEqual([expect.objectContaining({ ticker: "A", side: "sell", reason: "EXIT", currentWeight: 0.07, targetWeight: 0 })]);
    expect(p.trades[0].deltaWeight).toBeCloseTo(-0.07, 9);
  });

  it("never buys a banned ticker, but does emit the sell that disposes of one", () => {
    const ice = sig({ ticker: "ICE", label: "STRONG BUY", gatedLabel: "STRONG BUY", mu: 0.5, R: 3 });
    expect(run([ice], {}).skipped).toContainEqual(expect.objectContaining({ ticker: "ICE", code: "INELIGIBLE" }));
    const held = run([ice], { ICE: 0.05 });
    expect(held.trades).toEqual([expect.objectContaining({ ticker: "ICE", side: "sell", reason: "EXIT" })]);
  });

  it("freezes a held name that has no signal instead of trading on missing data", () => {
    const p = run([sig({ ticker: "B" })], { GONE: 0.20 });
    expect(p.skipped).toContainEqual(expect.objectContaining({ ticker: "GONE", code: "NO_SIGNAL", currentWeight: 0.20 }));
    expect(p.frozenWeight).toBeCloseTo(0.20, 9);
    expect(p.trades.find((t) => t.ticker === "B")!.deltaWeight).toBeCloseTo(0.79, 9);
  });

  it("applies the quality tilt when enabled and not when disabled", () => {
    const hi = sig({ ticker: "A", quality: 1.2 }), lo = sig({ ticker: "B", quality: 0.8 });
    const tilted = run([hi, lo], {});
    const flat = run([hi, lo], {}, NONE, resolveTradeConfig({ wMax: 1, sectorMax: 1, useQualityTilt: false }));
    const w = (p: ReturnType<typeof run>, t: string) => p.trades.find((x) => x.ticker === t)!.targetWeight;
    expect(w(tilted, "A")).toBeGreaterThan(w(tilted, "B"));
    expect(w(flat, "A")).toBeCloseTo(w(flat, "B"), 9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/trade/rebalance.test.ts`
Expected: FAIL — cannot find `./rebalance`.

- [ ] **Step 3: Write rebalance.ts**

```ts
/**
 * rebalance.ts — the pure trade emitter (spec §7). ledger + signals + locks → TradePlan.
 * Reuses the portfolio sizer's scoring and water-fill unchanged; hysteresis decides the set,
 * the locks decide what is frozen or barred, the band decides what is worth trading. Never
 * leverages: if locked names hold weight the sizer wanted to move, buys are scaled down, not
 * cash borrowed.
 */
import type { Signal } from "../portfolio/signal";
import { scoreWeight, allocateCapped } from "../portfolio/sizing";
import { isBannedTicker } from "../portfolio/eligibility";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { isBuyLocked, isSellLocked, type Locks } from "./locks";
import { classify, type Classified } from "./hysteresis";

export type TradeReason = "ENTER" | "EXIT" | "ADD" | "TRIM";
export interface Trade {
  ticker: string; sector: string; side: "buy" | "sell"; reason: TradeReason;
  currentWeight: number; targetWeight: number; deltaWeight: number;
}
export type SkipCode = "BELOW_BAND" | "BARRED_ENTRY" | "BARRED_ADD" | "DEFER_EXIT" | "DEFER_TRIM" | "INELIGIBLE" | "NO_SIGNAL" | "NO_CAPACITY";
export interface Skipped {
  ticker: string; code: SkipCode; reasons: string[]; unlockOn?: TradingDay;
  currentWeight: number; targetWeight: number | null;
}
export interface TradePlan {
  today: TradingDay; trades: Trade[]; skipped: Skipped[]; classifications: Classified[];
  frozenWeight: number; sizingTarget: number; plannedInvested: number; plannedCash: number; buyScale: number;
}

const EPS = 1e-12;

export function emitTrades(input: {
  signals: Signal[]; currentWeights: Record<string, number>; locks: Locks; today: TradingDay; cfg: TradeConfig;
}): TradePlan {
  const { signals, currentWeights, locks, today, cfg } = input;
  const cur = (t: string) => currentWeights[t] ?? 0;
  const bySignal = new Map(signals.map((s) => [s.ticker, s]));
  const classifications = signals.map((s) => classify(s, cur(s.ticker) > 0, locks, today, cfg));
  const trades: Trade[] = [];
  const skipped: Skipped[] = [];

  // 1–2. Freeze set: deferred exits, and held names with no signal at all.
  let frozenWeight = 0;
  for (const [t, w] of Object.entries(currentWeights)) {
    if (w > 0 && !bySignal.has(t)) {
      frozenWeight += w;
      skipped.push({ ticker: t, code: "NO_SIGNAL", reasons: ["held but no current signal — frozen, not traded"], currentWeight: w, targetWeight: null });
    }
  }
  for (const c of classifications) if (c.classification === "DEFER_EXIT") frozenWeight += cur(c.ticker);

  // 3. Size HOLD ∪ ENTER into the reduced target with the existing sizer (dust loop as sizePortfolio).
  const sizingTarget = Math.max(0, 1 - cfg.cashFloor - frozenWeight);
  const sizable = signals.filter((s) => {
    const k = classifications.find((c) => c.ticker === s.ticker)!.classification;
    return k === "HOLD" || k === "ENTER";
  });
  let scored = sizable
    .map((s) => ({ ticker: s.ticker, sector: s.sector, score: scoreWeight(s, cfg, { qualityTilt: cfg.useQualityTilt }) }))
    .filter((i) => i.score > 0);
  let alloc = scored.length ? allocateCapped(scored, sizingTarget, cfg) : [];
  for (let pass = 0; pass < sizable.length + 1 && scored.length; pass++) {
    const survivors = alloc.filter((w) => w.weight >= cfg.wMin);
    if (survivors.length === scored.length) break;
    scored = scored.filter((i) => survivors.some((w) => w.ticker === i.ticker));
    alloc = scored.length ? allocateCapped(scored, sizingTarget, cfg) : [];
  }
  const target = new Map(alloc.map((w) => [w.ticker, w.weight]));

  // 4–5, 7. Decide each name.
  for (const c of classifications) {
    const s = bySignal.get(c.ticker)!;
    const w = cur(c.ticker);
    const k = c.classification;
    if (k === "EXIT") {
      trades.push({ ticker: c.ticker, sector: s.sector, side: "sell", reason: "EXIT", currentWeight: w, targetWeight: 0, deltaWeight: -w });
      continue;
    }
    if (k === "DEFER_EXIT" || k === "BARRED_ENTRY" || k === "INELIGIBLE") {
      skipped.push({ ticker: c.ticker, code: k, reasons: c.reasons, unlockOn: c.unlockOn, currentWeight: w, targetWeight: k === "DEFER_EXIT" ? w : null });
      continue;
    }
    const tw = target.get(c.ticker) ?? 0;
    if (k === "ENTER") {
      if (tw <= EPS) { skipped.push({ ticker: c.ticker, code: "NO_CAPACITY", reasons: ["the caps left no room"], currentWeight: 0, targetWeight: 0 }); continue; }
      trades.push({ ticker: c.ticker, sector: s.sector, side: "buy", reason: "ENTER", currentWeight: 0, targetWeight: tw, deltaWeight: tw });
      continue;
    }
    // HOLD: trade only outside the band, and only if the required side is not locked.
    const d = tw - w;
    if (Math.abs(d) <= cfg.tradeBand) {
      skipped.push({ ticker: c.ticker, code: "BELOW_BAND", reasons: [`|Δw| ${(Math.abs(d) * 100).toFixed(2)}pp ≤ band ${(cfg.tradeBand * 100).toFixed(2)}pp`], currentWeight: w, targetWeight: tw });
    } else if (d > 0) {
      if (isBuyLocked(locks, c.ticker, today)) skipped.push({ ticker: c.ticker, code: "BARRED_ADD", reasons: ["buy-locked"], unlockOn: locks.buyLockUntil[c.ticker], currentWeight: w, targetWeight: tw });
      else trades.push({ ticker: c.ticker, sector: s.sector, side: "buy", reason: "ADD", currentWeight: w, targetWeight: tw, deltaWeight: d });
    } else {
      if (isSellLocked(locks, c.ticker, today)) skipped.push({ ticker: c.ticker, code: "DEFER_TRIM", reasons: ["sell-locked"], unlockOn: locks.sellLockUntil[c.ticker], currentWeight: w, targetWeight: tw });
      else trades.push({ ticker: c.ticker, sector: s.sector, side: "sell", reason: "TRIM", currentWeight: w, targetWeight: tw, deltaWeight: d });
    }
  }

  // 6. Never leverage. Names kept at their current weight (frozen, deferred, below-band) can leave
  //    the book over the invested ceiling once the wanted buys land; scale the buys, never borrow.
  const held = Object.values(currentWeights).reduce((a, w) => a + w, 0);
  const sumDelta = () => trades.reduce((a, t) => a + t.deltaWeight, 0);
  const ceiling = 1 - cfg.cashFloor;
  let buyScale = 1;
  const over = held + sumDelta() - ceiling;
  if (over > EPS) {
    const buys = trades.filter((t) => t.side === "buy");
    const buyTotal = buys.reduce((a, t) => a + t.deltaWeight, 0);
    buyScale = buyTotal > 0 ? Math.max(0, (buyTotal - over) / buyTotal) : 1;
    for (const t of buys) { t.deltaWeight *= buyScale; t.targetWeight = t.currentWeight + t.deltaWeight; }
  }
  // A buy scaled to nothing is not a trade; record it as no-capacity.
  for (const t of trades.filter((t) => t.side === "buy" && t.deltaWeight <= EPS)) {
    skipped.push({ ticker: t.ticker, code: "NO_CAPACITY", reasons: ["buys scaled to zero to respect the cash floor"], currentWeight: t.currentWeight, targetWeight: t.currentWeight });
  }
  const finalTrades = trades.filter((t) => Math.abs(t.deltaWeight) > EPS);

  const plannedInvested = held + finalTrades.reduce((a, t) => a + t.deltaWeight, 0);
  const plannedCash = 1 - plannedInvested;
  if (plannedCash < -1e-9) throw new Error(`emitTrades: planned cash ${plannedCash} is negative — leverage bug`);
  for (const t of finalTrades) if (t.side === "buy" && isBannedTicker(t.ticker)) throw new Error(`emitTrades: buy of banned ticker ${t.ticker}`);

  return { today, trades: finalTrades, skipped, classifications, frozenWeight, sizingTarget, plannedInvested, plannedCash, buyScale };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/trade/rebalance.test.ts`
Expected: PASS (9 tests). If the "defers a sell-locked trim" case fails on `buyScale`, check the arithmetic: held 0.99 + B's +0.105 = 1.095, ceiling 0.99, over 0.105 = the whole buy → scale 0.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/rebalance.ts lib/trade/rebalance.test.ts
git commit -m "feat(trade): pure trade emitter — freeze, reduced-target sizing, band, locks, never leverage

Spec §7. Deferred exits and held names without a signal are frozen and
subtracted from the sizing target; HOLD ∪ ENTER is sized with the
existing scoreWeight + allocateCapped (quality tilt on); the no-trade
band suppresses small drifts; buy-locked adds are barred and sell-locked
trims deferred with unlock dates; buys are scaled so cash never drops
below the floor. Banned tickers are never bought; an EXIT of one is the
disposal remedy and is emitted.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 6: Cost buckets and order sizing

**Files:**
- Create: `lib/trade/costs.ts`, `lib/trade/orders.ts`
- Test: `lib/trade/costs.test.ts`, `lib/trade/orders.test.ts`

**Interfaces:**
- Consumes: `TradePlan`/`Trade`/`TradeReason` (Task 5), `TradeConfig`, `TradingDay`.
- Produces:
  ```ts
  export type LiquidityBucket = "large" | "mid" | "small";
  export const ROUND_TRIP_BPS: Record<LiquidityBucket, number>;          // { large: 8, mid: 15, small: 30 } — spec §7.8
  export function bucketFor(marketCapUsd: number | null): LiquidityBucket; // ≥$10B large, ≥$2B mid, else small; null → mid
  export function estimateCostUsd(notionalUsd: number, bucket: LiquidityBucket): number;
  export interface OrderRequest { ticker: string; side: "buy" | "sell"; kind: "notional" | "qty"; notional?: number; qty?: number;
                                  clientOrderId: string; reason: TradeReason; deltaUsd: number; estCostUsd: number; bucket: LiquidityBucket }
  export interface SizedOrders { orders: OrderRequest[]; skippedDust: { ticker: string; deltaUsd: number }[] }
  export function clientOrderId(runId: string, ticker: string, side: "buy" | "sell", today: TradingDay): string; // sha256 hex, 32 chars
  export function tradesToOrders(input: { plan: TradePlan; nav: number; marks: Record<string, number>;
      positions: Record<string, { qty: number; marketValue: number }>; fractionalOk: (ticker: string) => boolean;
      marketCapUsd: Record<string, number | null>; runId: string; cfg: TradeConfig }): SizedOrders;
  ```
  Spec §9: buys are **notional** when the symbol is fractional-eligible else `floor(Δ$/mark)` shares; an **EXIT sells the broker's exact position qty** (may be fractional); a **TRIM** sells whole shares capped at the position; dust `|Δ$| < minOrderUsd` is skipped (an EXIT is never dust).

- [ ] **Step 1: Write the failing tests**

`lib/trade/costs.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { bucketFor, estimateCostUsd, ROUND_TRIP_BPS } from "./costs";

describe("costs", () => {
  it("buckets by market cap, defaulting to mid when unknown", () => {
    expect(bucketFor(50e9)).toBe("large"); expect(bucketFor(5e9)).toBe("mid");
    expect(bucketFor(500e6)).toBe("small"); expect(bucketFor(null)).toBe("mid");
  });
  it("estimates a round trip in dollars from bps", () => {
    expect(ROUND_TRIP_BPS).toEqual({ large: 8, mid: 15, small: 30 });
    expect(estimateCostUsd(10_000, "large")).toBeCloseTo(8, 9);
    expect(estimateCostUsd(-10_000, "small")).toBeCloseTo(30, 9); // sign-agnostic
  });
});
```

`lib/trade/orders.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tradesToOrders, clientOrderId } from "./orders";
import { DEFAULT_TRADE_CONFIG as cfg } from "./config";
import type { TradePlan, Trade } from "./rebalance";

const trade = (o: Partial<Trade>): Trade => ({ ticker: "A", sector: "35", side: "buy", reason: "ENTER", currentWeight: 0, targetWeight: 0.1, deltaWeight: 0.1, ...o });
const plan = (trades: Trade[]): TradePlan => ({ today: "2026-09-25", trades, skipped: [], classifications: [], frozenWeight: 0, sizingTarget: 0.99, plannedInvested: 0.99, plannedCash: 0.01, buyScale: 1 });
const base = { nav: 100_000, marks: { A: 50, B: 200 }, positions: {}, fractionalOk: () => true, marketCapUsd: { A: 50e9, B: 1e9 }, runId: "run1", cfg };

describe("clientOrderId", () => {
  it("is a deterministic 32-hex id that changes with side", () => {
    const a = clientOrderId("r", "A", "buy", "2026-09-25");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(clientOrderId("r", "A", "buy", "2026-09-25")).toBe(a);
    expect(clientOrderId("r", "A", "sell", "2026-09-25")).not.toBe(a);
  });
});

describe("tradesToOrders", () => {
  it("buys a fractional-eligible name by notional, with cost by bucket", () => {
    const { orders } = tradesToOrders({ ...base, plan: plan([trade({ deltaWeight: 0.1 })]) });
    expect(orders).toEqual([expect.objectContaining({ ticker: "A", side: "buy", kind: "notional", notional: 10_000, bucket: "large", estCostUsd: 8, reason: "ENTER" })]);
  });
  it("buys whole shares (floor) when the name is not fractional-eligible", () => {
    const { orders } = tradesToOrders({ ...base, fractionalOk: () => false, plan: plan([trade({ ticker: "B", deltaWeight: 0.0125 })]) }); // $1,250 / $200 = 6.25
    expect(orders[0]).toEqual(expect.objectContaining({ ticker: "B", kind: "qty", qty: 6, bucket: "small" }));
  });
  it("an EXIT sells the broker's exact (possibly fractional) position qty", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 33.4, marketValue: 1670 } },
      plan: plan([trade({ side: "sell", reason: "EXIT", currentWeight: 0.0167, targetWeight: 0, deltaWeight: -0.0167 })]) });
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 33.4, reason: "EXIT" }));
  });
  it("a TRIM sells whole shares, never more than the position", () => {
    const { orders } = tradesToOrders({ ...base, positions: { A: { qty: 100, marketValue: 5000 } },
      plan: plan([trade({ side: "sell", reason: "TRIM", currentWeight: 0.05, targetWeight: 0.03, deltaWeight: -0.02 })]) }); // $2,000 / $50 = 40
    expect(orders[0]).toEqual(expect.objectContaining({ side: "sell", kind: "qty", qty: 40, reason: "TRIM" }));
  });
  it("skips dust below minOrderUsd, but never an EXIT", () => {
    const { orders, skippedDust } = tradesToOrders({ ...base, positions: { A: { qty: 0.2, marketValue: 10 } }, plan: plan([
      trade({ ticker: "A", deltaWeight: 0.0001 }),                                                         // $10 buy → dust
      trade({ ticker: "A", side: "sell", reason: "EXIT", currentWeight: 0.0001, targetWeight: 0, deltaWeight: -0.0001 }), // $10 exit → kept
    ]) });
    expect(skippedDust).toEqual([{ ticker: "A", deltaUsd: 10 }]);
    expect(orders).toEqual([expect.objectContaining({ side: "sell", reason: "EXIT", qty: 0.2 })]);
  });
  it("refuses a sell with no position or a trade with no mark", () => {
    expect(() => tradesToOrders({ ...base, plan: plan([trade({ side: "sell", reason: "EXIT", deltaWeight: -0.1 })]) })).toThrow(/no position/);
    expect(() => tradesToOrders({ ...base, marks: {}, plan: plan([trade({})]) })).toThrow(/no mark/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run lib/trade/costs.test.ts lib/trade/orders.test.ts` → FAIL, modules not found.

- [ ] **Step 3: Write costs.ts and orders.ts**

`lib/trade/costs.ts`:
```ts
/** costs.ts — round-trip cost by liquidity bucket, for reporting and the dust floor (spec §7.8). */
export type LiquidityBucket = "large" | "mid" | "small";
export const ROUND_TRIP_BPS: Record<LiquidityBucket, number> = { large: 8, mid: 15, small: 30 };

export function bucketFor(marketCapUsd: number | null): LiquidityBucket {
  if (marketCapUsd == null || !Number.isFinite(marketCapUsd)) return "mid";
  if (marketCapUsd >= 10e9) return "large";
  if (marketCapUsd >= 2e9) return "mid";
  return "small";
}

export function estimateCostUsd(notionalUsd: number, bucket: LiquidityBucket): number {
  return (Math.abs(notionalUsd) * ROUND_TRIP_BPS[bucket]) / 10_000;
}
```

`lib/trade/orders.ts`:
```ts
/**
 * orders.ts — weights to broker orders (spec §9). Pure. Buys are notional (fractional-eligible) or
 * floor-shares; an EXIT sells the exact broker qty so no dust is left; a TRIM sells whole shares.
 * clientOrderId is deterministic per (run, ticker, side, day) so a re-run cannot double-submit.
 */
import { createHash } from "node:crypto";
import type { TradePlan, TradeReason } from "./rebalance";
import type { TradeConfig } from "./config";
import type { TradingDay } from "./calendar";
import { bucketFor, estimateCostUsd, type LiquidityBucket } from "./costs";

export interface OrderRequest {
  ticker: string; side: "buy" | "sell"; kind: "notional" | "qty"; notional?: number; qty?: number;
  clientOrderId: string; reason: TradeReason; deltaUsd: number; estCostUsd: number; bucket: LiquidityBucket;
}
export interface SizedOrders { orders: OrderRequest[]; skippedDust: { ticker: string; deltaUsd: number }[] }

export function clientOrderId(runId: string, ticker: string, side: "buy" | "sell", today: TradingDay): string {
  return createHash("sha256").update(`${runId}|${ticker}|${side}|${today}`).digest("hex").slice(0, 32);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function tradesToOrders(input: {
  plan: TradePlan; nav: number; marks: Record<string, number>;
  positions: Record<string, { qty: number; marketValue: number }>; fractionalOk: (ticker: string) => boolean;
  marketCapUsd: Record<string, number | null>; runId: string; cfg: TradeConfig;
}): SizedOrders {
  const { plan, nav, marks, positions, fractionalOk, marketCapUsd, runId, cfg } = input;
  const orders: OrderRequest[] = [];
  const skippedDust: { ticker: string; deltaUsd: number }[] = [];
  for (const t of plan.trades) {
    const mark = marks[t.ticker];
    if (!(mark > 0)) throw new Error(`tradesToOrders: no mark for ${t.ticker}`);
    const deltaUsd = round2(t.deltaWeight * nav);
    const bucket = bucketFor(marketCapUsd[t.ticker] ?? null);
    const common = { ticker: t.ticker, clientOrderId: clientOrderId(runId, t.ticker, t.side, plan.today), reason: t.reason, deltaUsd, estCostUsd: estimateCostUsd(deltaUsd, bucket), bucket };
    if (t.side === "sell") {
      const pos = positions[t.ticker];
      if (!pos || pos.qty <= 0) throw new Error(`tradesToOrders: sell of ${t.ticker} with no position`);
      if (t.reason === "EXIT") { orders.push({ ...common, side: "sell", kind: "qty", qty: pos.qty }); continue; }
      const qty = Math.min(pos.qty, Math.round(-deltaUsd / mark));
      if (qty <= 0 || Math.abs(deltaUsd) < cfg.minOrderUsd) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
      orders.push({ ...common, side: "sell", kind: "qty", qty });
      continue;
    }
    if (deltaUsd < cfg.minOrderUsd) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
    if (fractionalOk(t.ticker)) { orders.push({ ...common, side: "buy", kind: "notional", notional: deltaUsd }); continue; }
    const qty = Math.floor(deltaUsd / mark);
    if (qty <= 0) { skippedDust.push({ ticker: t.ticker, deltaUsd }); continue; }
    orders.push({ ...common, side: "buy", kind: "qty", qty });
  }
  return { orders, skippedDust };
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run lib/trade/costs.test.ts lib/trade/orders.test.ts` → PASS (2 + 7).

- [ ] **Step 5: Commit**

```bash
git add lib/trade/costs.ts lib/trade/costs.test.ts lib/trade/orders.ts lib/trade/orders.test.ts
git commit -m "feat(trade): order sizing (notional/qty, exact-qty exits, dust floor) and cost buckets

Spec §7.8, §9. Deterministic client_order_id per (run, ticker, side,
day) makes a re-run idempotent at the broker.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 7: Ledger and reconciliation

**Files:**
- Create: `lib/trade/ledger.ts`
- Test: `lib/trade/ledger.test.ts`

**Interfaces:**
- Consumes: `Fill` (Task 2).
- Produces:
  ```ts
  export const Ledger: z.ZodType<Ledger>;
  export interface Ledger { asOf: string; nav: number; cash: number;
                            positions: { ticker: string; qty: number; marketValue: number; avgCost: number }[] }
  export class ReconcileError extends Error {}
  export function reconcile(input: { asOf: string; account: { equity: number; cash: number };
      positions: { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }[]; fills: Fill[] }): Ledger;
  export function weightsOf(l: Ledger): Record<string, number>;                                   // marketValue / nav
  export function positionsOf(l: Ledger): Record<string, { qty: number; marketValue: number }>;
  export function readLedger(path: string): Ledger | null;
  export function writeLedger(path: string, l: Ledger): void;
  ```
  Spec §3: the broker is the source of truth; `reconcile` **throws `ReconcileError`** when the broker holds a ticker with no buy fill in the log (a manual trade or corporate action) — the operator appends the missing fill, nothing is guessed.

- [ ] **Step 1: Write the failing test**

`lib/trade/ledger.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile, weightsOf, positionsOf, readLedger, writeLedger, ReconcileError } from "./ledger";
import type { Fill } from "./fills";

const buy = (ticker: string): Fill => ({ ticker, side: "buy", qty: 1, price: 1, filledAt: "2026-09-21T15:00:00Z", tradingDate: "2026-09-21", orderId: "o", runId: "r" });
const acct = { equity: 100_000, cash: 20_000 };
const pos = (symbol: string, qty: number, marketValue: number) => ({ symbol, qty, marketValue, avgEntryPrice: marketValue / qty });

describe("reconcile", () => {
  it("builds the ledger from broker account + positions and derives weights", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000), pos("MP", 600, 30_000)], fills: [buy("NVT"), buy("MP")] });
    expect(l.nav).toBe(100_000);
    expect(weightsOf(l)).toEqual({ NVT: 0.5, MP: 0.3 });
    expect(positionsOf(l)).toEqual({ NVT: { qty: 100, marketValue: 50_000 }, MP: { qty: 600, marketValue: 30_000 } });
  });
  it("halts on a broker position the fills log cannot explain", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [] }))
      .toThrow(ReconcileError);
    expect(() => reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [] }))
      .toThrow(/NVT.*no buy fill/);
  });
  it("accepts an empty book and drops zero-qty positions", () => {
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("X", 0, 0)], fills: [] });
    expect(l.positions).toEqual([]);
  });
  it("rejects a non-positive equity", () => {
    expect(() => reconcile({ asOf: "2026-09-25", account: { equity: 0, cash: 0 }, positions: [], fills: [] })).toThrow(ReconcileError);
  });
});

describe("ledger file", () => {
  it("round-trips through disk and reads null when absent", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "sub", "ledger.json");
    expect(readLedger(p)).toBeNull();
    const l = reconcile({ asOf: "2026-09-25", account: acct, positions: [pos("NVT", 100, 50_000)], fills: [buy("NVT")] });
    writeLedger(p, l);
    expect(readLedger(p)).toEqual(l);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/trade/ledger.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write ledger.ts**

```ts
/**
 * ledger.ts — the current book as the broker reports it (spec §3). The broker is the source of
 * truth; this is a derived cache. reconcile() refuses to guess: a position the fills log cannot
 * explain halts the run so the operator appends the missing fill.
 */
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fill } from "./fills";

export const LedgerPosition = z.object({ ticker: z.string(), qty: z.number().positive(), marketValue: z.number(), avgCost: z.number() });
export const Ledger = z.object({ asOf: z.string(), nav: z.number().positive(), cash: z.number(), positions: z.array(LedgerPosition) });
export type Ledger = z.infer<typeof Ledger>;

export class ReconcileError extends Error { constructor(msg: string) { super(msg); this.name = "ReconcileError"; } }

export function reconcile(input: {
  asOf: string; account: { equity: number; cash: number };
  positions: { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }[]; fills: Fill[];
}): Ledger {
  const { asOf, account, positions, fills } = input;
  if (!(account.equity > 0)) throw new ReconcileError(`account equity ${account.equity} is not positive`);
  const live = positions.filter((p) => p.qty > 0);
  const bought = new Set(fills.filter((f) => f.side === "buy").map((f) => f.ticker));
  const unexplained = live.filter((p) => !bought.has(p.symbol)).map((p) => p.symbol);
  if (unexplained.length) {
    throw new ReconcileError(`broker holds ${unexplained.join(", ")} with no buy fill in fills.jsonl — append the missing fill(s) before running`);
  }
  return Ledger.parse({
    asOf, nav: account.equity, cash: account.cash,
    positions: live.map((p) => ({ ticker: p.symbol, qty: p.qty, marketValue: p.marketValue, avgCost: p.avgEntryPrice })),
  });
}

export function weightsOf(l: Ledger): Record<string, number> {
  return Object.fromEntries(l.positions.map((p) => [p.ticker, p.marketValue / l.nav]));
}
export function positionsOf(l: Ledger): Record<string, { qty: number; marketValue: number }> {
  return Object.fromEntries(l.positions.map((p) => [p.ticker, { qty: p.qty, marketValue: p.marketValue }]));
}
export function readLedger(path: string): Ledger | null {
  return existsSync(path) ? Ledger.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}
export function writeLedger(path: string, l: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Ledger.parse(l), null, 2) + "\n");
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/trade/ledger.test.ts` → PASS (5).

- [ ] **Step 5: Commit**

```bash
git add lib/trade/ledger.ts lib/trade/ledger.test.ts
git commit -m "feat(trade): ledger reconciled from the broker; halts on an unexplained position

Spec §3. Broker account + positions are the source of truth; a held
ticker with no buy fill in fills.jsonl raises ReconcileError rather than
inventing a lock date.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 8: Run record

**Files:**
- Create: `lib/trade/run-record.ts`
- Test: `lib/trade/run-record.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const RunRecord: z.ZodType<RunRecord>;
  export type RunRecord = { runId: string; today: string; markMode: "settled" | "live"; broker: string;
      marks: Record<string, number>; signals: { ticker: string; label: string; gatedLabel: string | null; mu: number; R: number | null; kappa: number; quality: number; ageDays: number }[];
      classifications: { ticker: string; classification: string; reasons: string[]; unlockOn?: string }[];
      locks: { buyLockUntil: Record<string, string>; sellLockUntil: Record<string, string> };
      plan: Record<string, unknown>; orders: Record<string, unknown>[]; fills: Record<string, unknown>[]; notes: string[] };
  export function newRunId(today: TradingDay): string;                    // "<today>-<8 hex>"
  export function writeRunRecord(dir: string, rec: RunRecord): string;    // returns the path
  ```
  Spec §14: everything the backtest needs to replay a run, point-in-time. Nested plan/order/fill objects are stored structurally (`z.record(z.string(), z.unknown())`) — the typed shapes live in their own modules.

- [ ] **Step 1: Write the failing test**

`lib/trade/run-record.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecord, newRunId, writeRunRecord } from "./run-record";

const rec = (): RunRecord => ({
  runId: "2026-09-25-deadbeef", today: "2026-09-25", markMode: "settled", broker: "fake",
  marks: { NVT: 100 }, signals: [{ ticker: "NVT", label: "BUY", gatedLabel: "BUY", mu: 0.15, R: 0.8, kappa: 0.6, quality: 1, ageDays: 10 }],
  classifications: [{ ticker: "NVT", classification: "ENTER", reasons: [] }],
  locks: { buyLockUntil: {}, sellLockUntil: {} },
  plan: { trades: [], skipped: [] }, orders: [], fills: [], notes: [],
});

describe("run record", () => {
  it("newRunId is the day plus 8 hex chars and is unique", () => {
    const a = newRunId("2026-09-25"), b = newRunId("2026-09-25");
    expect(a).toMatch(/^2026-09-25-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
  it("writes <dir>/<runId>.json, creating the dir, and the file parses back", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "runs-")), "runs");
    const p = writeRunRecord(dir, rec());
    expect(p).toBe(join(dir, "2026-09-25-deadbeef.json"));
    expect(RunRecord.parse(JSON.parse(readFileSync(p, "utf8")))).toEqual(rec());
  });
  it("rejects a record with a bad markMode", () => {
    expect(() => RunRecord.parse({ ...rec(), markMode: "guess" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/trade/run-record.test.ts` → FAIL.

- [ ] **Step 3: Write run-record.ts**

```ts
/** run-record.ts — the point-in-time record of one run (spec §14); the backtest's replay input. */
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TradingDay } from "./calendar";

const loose = z.record(z.string(), z.unknown());
export const RunRecord = z.object({
  runId: z.string().min(1), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  markMode: z.enum(["settled", "live"]), broker: z.string().min(1),
  marks: z.record(z.string(), z.number()),
  signals: z.array(z.object({ ticker: z.string(), label: z.string(), gatedLabel: z.string().nullable(), mu: z.number(), R: z.number().nullable(), kappa: z.number(), quality: z.number(), ageDays: z.number() })),
  classifications: z.array(z.object({ ticker: z.string(), classification: z.string(), reasons: z.array(z.string()), unlockOn: z.string().optional() })),
  locks: z.object({ buyLockUntil: z.record(z.string(), z.string()), sellLockUntil: z.record(z.string(), z.string()) }),
  plan: loose, orders: z.array(loose), fills: z.array(loose), notes: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecord>;

export function newRunId(today: TradingDay): string {
  return `${today}-${randomBytes(4).toString("hex")}`;
}

export function writeRunRecord(dir: string, rec: RunRecord): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${rec.runId}.json`);
  writeFileSync(path, JSON.stringify(RunRecord.parse(rec), null, 2) + "\n");
  return path;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/trade/run-record.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add lib/trade/run-record.ts lib/trade/run-record.test.ts
git commit -m "feat(trade): point-in-time run record for backtest replay

Spec §14.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 9: Broker adapter interface, the in-memory FakeBroker, and submit-time guards

**Files:**
- Create: `lib/broker/adapter.ts`, `lib/broker/fake.ts`, `lib/broker/guards.ts`
- Test: `lib/broker/fake.test.ts`, `lib/broker/guards.test.ts`

**Interfaces:**
- Consumes: `isBannedTicker`, `Locks`/`isBuyLocked`/`isSellLocked` (Task 2), `TradeConfig`, `TradingDay`.
- Produces (`lib/broker/adapter.ts`):
  ```ts
  export interface BrokerClock { timestamp: string; isOpen: boolean; nextOpen: string; nextClose: string }
  export interface BrokerCalendarDay { date: string; open: string; close: string }
  export interface BrokerAccount { equity: number; cash: number; buyingPower: number }
  export interface BrokerPosition { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }
  export type BrokerOrderStatus = "new" | "partially_filled" | "filled" | "done_for_day" | "canceled" | "expired" | "replaced"
    | "pending_cancel" | "pending_replace" | "accepted" | "pending_new" | "accepted_for_bidding" | "stopped" | "rejected" | "suspended" | "calculated" | "held";
  export interface BrokerOrder { id: string; clientOrderId: string; symbol: string; side: "buy" | "sell"; status: BrokerOrderStatus;
    qty: number | null; notional: number | null; filledQty: number; filledAvgPrice: number | null; filledAt: string | null; submittedAt: string | null }
  export interface SubmitOrderRequest { symbol: string; side: "buy" | "sell"; qty?: number; notional?: number; clientOrderId: string; estNotionalUsd: number }
  export interface BrokerAdapter {
    readonly kind: "alpaca-paper" | "fake";
    getClock(): Promise<BrokerClock>;
    getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]>;
    getAccount(): Promise<BrokerAccount>;
    getPositions(): Promise<BrokerPosition[]>;
    getOrders(status: "open" | "closed" | "all", after?: string): Promise<BrokerOrder[]>;
    getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>>;
    isFractionable(symbols: string[]): Promise<Record<string, boolean>>;
    submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder>;
    cancelOrder(id: string): Promise<void>;
  }
  export const TERMINAL_STATUSES: ReadonlySet<BrokerOrderStatus>; // filled, canceled, expired, rejected, done_for_day, stopped, suspended, replaced
  ```
  `lib/broker/guards.ts`:
  ```ts
  export const PAPER_HOST = "paper-api.alpaca.markets";
  export class GuardError extends Error {}
  export interface GuardContext { brokerKind: BrokerAdapter["kind"]; configuredBaseUrl: string; locks: Locks; today: TradingDay;
                                  nav: number; cfg: TradeConfig; env: NodeJS.ProcessEnv; counters: { orders: number; notionalUsd: number } }
  export function assertOrderAllowed(req: SubmitOrderRequest, ctx: GuardContext): void;   // throws GuardError
  export function guardedSubmit(adapter: BrokerAdapter, req: SubmitOrderRequest, ctx: GuardContext): Promise<BrokerOrder>;
  ```
  Spec §8.3, plus the Task-5 refinement: the ban refuses **buys** of a banned symbol (a sell disposes of one). The paper-URL check applies only when `brokerKind === "alpaca-paper"`.

- [ ] **Step 1: Write the failing tests**

`lib/broker/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FakeBroker } from "./fake";

const CAL = [{ date: "2026-09-24", open: "09:30", close: "16:00" }, { date: "2026-09-25", open: "09:30", close: "16:00" }];
const mk = () => new FakeBroker({ calendar: CAL, closes: { NVT: { "2026-09-24": 100, "2026-09-25": 110 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });

describe("FakeBroker", () => {
  it("fills a notional buy instantly at today's close and updates cash, positions and equity", async () => {
    const b = mk();
    const o = await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_100, clientOrderId: "c1", estNotionalUsd: 1_100 });
    expect(o).toEqual(expect.objectContaining({ status: "filled", filledQty: 10, filledAvgPrice: 110, notional: 1_100, qty: null, clientOrderId: "c1" }));
    expect(o.filledAt).toMatch(/^2026-09-25T/);
    expect(await b.getPositions()).toEqual([{ symbol: "NVT", qty: 10, marketValue: 1_100, avgEntryPrice: 110 }]);
    expect(await b.getAccount()).toEqual({ equity: 10_000, cash: 8_900, buyingPower: 8_900 });
  });
  it("fills a qty sell, removes an emptied position, and lists orders", async () => {
    const b = mk();
    await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_100, clientOrderId: "c1", estNotionalUsd: 1_100 });
    await b.submitOrder({ symbol: "NVT", side: "sell", qty: 10, clientOrderId: "c2", estNotionalUsd: 1_100 });
    expect(await b.getPositions()).toEqual([]);
    expect((await b.getOrders("all")).map((o) => o.clientOrderId)).toEqual(["c1", "c2"]);
  });
  it("serves the settled close, the calendar, the clock, and fractionability", async () => {
    const b = mk();
    expect(await b.getLastClose(["NVT"], "2026-09-24")).toEqual({ NVT: 100 });
    await expect(b.getLastClose(["ZZZ"], "2026-09-24")).rejects.toThrow(/no close/);
    expect(await b.getCalendar("2026-09-24", "2026-09-25")).toEqual(CAL);
    expect((await b.getClock()).isOpen).toBe(true);
    expect(await b.isFractionable(["NVT"])).toEqual({ NVT: true });
  });
  it("refuses to sell more than it holds", async () => {
    await expect(mk().submitOrder({ symbol: "NVT", side: "sell", qty: 1, clientOrderId: "c", estNotionalUsd: 110 })).rejects.toThrow(/insufficient/);
  });
});
```

`lib/broker/guards.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { assertOrderAllowed, guardedSubmit, GuardError, PAPER_HOST, type GuardContext } from "./guards";
import { FakeBroker } from "./fake";
import { DEFAULT_TRADE_CONFIG as cfg } from "../trade/config";

const ctx = (o: Partial<GuardContext> = {}): GuardContext => ({
  brokerKind: "alpaca-paper", configuredBaseUrl: `https://${PAPER_HOST}`, locks: { buyLockUntil: {}, sellLockUntil: {} },
  today: "2026-09-25", nav: 100_000, cfg, env: {}, counters: { orders: 0, notionalUsd: 0 }, ...o,
});
const buy = { symbol: "NVT", side: "buy" as const, notional: 1_000, clientOrderId: "c", estNotionalUsd: 1_000 };
const sell = { symbol: "NVT", side: "sell" as const, qty: 1, clientOrderId: "c", estNotionalUsd: 100 };

describe("assertOrderAllowed", () => {
  it("allows a plain order", () => { expect(() => assertOrderAllowed(buy, ctx())).not.toThrow(); });
  it("kill switch refuses everything", () => {
    expect(() => assertOrderAllowed(buy, ctx({ env: { TRADE_DISABLED: "1" } }))).toThrow(GuardError);
  });
  it("refuses a non-paper endpoint for the Alpaca kind, but not for the fake", () => {
    expect(() => assertOrderAllowed(buy, ctx({ configuredBaseUrl: "https://api.alpaca.markets" }))).toThrow(/not the paper endpoint/);
    expect(() => assertOrderAllowed(buy, ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" }))).not.toThrow();
  });
  it("refuses a buy of a banned symbol but allows the disposing sell", () => {
    expect(() => assertOrderAllowed({ ...buy, symbol: "ICE" }, ctx())).toThrow(/banned/);
    expect(() => assertOrderAllowed({ ...sell, symbol: "ICE" }, ctx())).not.toThrow();
  });
  it("refuses a buy inside a buy-lock and a sell inside a sell-lock", () => {
    const locks = { buyLockUntil: { NVT: "2026-09-29" }, sellLockUntil: { NVT: "2026-09-29" } };
    expect(() => assertOrderAllowed(buy, ctx({ locks }))).toThrow(/buy-locked/);
    expect(() => assertOrderAllowed(sell, ctx({ locks }))).toThrow(/sell-locked/);
    expect(() => assertOrderAllowed(buy, ctx({ locks, today: "2026-09-29" }))).not.toThrow(); // first legal day
  });
  it("refuses past the order-count and notional caps", () => {
    expect(() => assertOrderAllowed(buy, ctx({ counters: { orders: cfg.maxOrdersPerRun, notionalUsd: 0 } }))).toThrow(/maxOrdersPerRun/);
    expect(() => assertOrderAllowed(buy, ctx({ counters: { orders: 0, notionalUsd: 99_500 } }))).toThrow(/maxNotionalFrac/);
  });
});

describe("guardedSubmit", () => {
  it("submits through the adapter and advances the counters", async () => {
    const b = new FakeBroker({ calendar: [{ date: "2026-09-25", open: "09:30", close: "16:00" }], closes: { NVT: { "2026-09-25": 100 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const c = ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" });
    const o = await guardedSubmit(b, buy, c);
    expect(o.status).toBe("filled");
    expect(c.counters).toEqual({ orders: 1, notionalUsd: 1_000 });
  });
  it("does not call the adapter when a guard refuses", async () => {
    const b = new FakeBroker({ calendar: [{ date: "2026-09-25", open: "09:30", close: "16:00" }], closes: { ICE: { "2026-09-25": 100 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    await expect(guardedSubmit(b, { ...buy, symbol: "ICE" }, ctx({ brokerKind: "fake", configuredBaseUrl: "memory://" }))).rejects.toThrow(GuardError);
    expect(await b.getOrders("all")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run lib/broker` → FAIL, modules not found.

- [ ] **Step 3: Write adapter.ts, fake.ts, guards.ts**

`lib/broker/adapter.ts`:
```ts
/** adapter.ts — the one contract every broker implements (spec §8.1). Numbers are numbers here; string→number conversion is the adapter's job. */
export interface BrokerClock { timestamp: string; isOpen: boolean; nextOpen: string; nextClose: string }
export interface BrokerCalendarDay { date: string; open: string; close: string }
export interface BrokerAccount { equity: number; cash: number; buyingPower: number }
export interface BrokerPosition { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }
export type BrokerOrderStatus =
  | "new" | "partially_filled" | "filled" | "done_for_day" | "canceled" | "expired" | "replaced" | "pending_cancel"
  | "pending_replace" | "accepted" | "pending_new" | "accepted_for_bidding" | "stopped" | "rejected" | "suspended" | "calculated" | "held";
export interface BrokerOrder {
  id: string; clientOrderId: string; symbol: string; side: "buy" | "sell"; status: BrokerOrderStatus;
  qty: number | null; notional: number | null; filledQty: number; filledAvgPrice: number | null; filledAt: string | null; submittedAt: string | null;
}
export interface SubmitOrderRequest { symbol: string; side: "buy" | "sell"; qty?: number; notional?: number; clientOrderId: string; estNotionalUsd: number }
export interface BrokerAdapter {
  readonly kind: "alpaca-paper" | "fake";
  getClock(): Promise<BrokerClock>;
  getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]>;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(status: "open" | "closed" | "all", after?: string): Promise<BrokerOrder[]>;
  getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>>;
  isFractionable(symbols: string[]): Promise<Record<string, boolean>>;
  submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder>;
  cancelOrder(id: string): Promise<void>;
}
export const TERMINAL_STATUSES: ReadonlySet<BrokerOrderStatus> = new Set(["filled", "canceled", "expired", "rejected", "done_for_day", "stopped", "suspended", "replaced"]);
```

`lib/broker/fake.ts`:
```ts
/** fake.ts — in-memory broker for tests and Phase 0 dry runs. Fills instantly at today's close. */
import type { BrokerAdapter, BrokerAccount, BrokerCalendarDay, BrokerClock, BrokerOrder, BrokerPosition, SubmitOrderRequest } from "./adapter";

export class FakeBroker implements BrokerAdapter {
  readonly kind = "fake" as const;
  private cash: number;
  private readonly pos = new Map<string, { qty: number; cost: number }>();
  private readonly orders: BrokerOrder[] = [];
  private today: string;
  constructor(private readonly opts: {
    calendar: BrokerCalendarDay[]; closes: Record<string, Record<string, number>>; equity: number; cash: number;
    isOpen: boolean; today: string; fractionable?: Record<string, boolean>;
  }) { this.cash = opts.cash; this.today = opts.today; }

  setToday(d: string): void { this.today = d; }
  private price(symbol: string, date = this.today): number {
    const p = this.opts.closes[symbol]?.[date];
    if (!(p > 0)) throw new Error(`FakeBroker: no close for ${symbol} on ${date}`);
    return p;
  }
  async getClock(): Promise<BrokerClock> { return { timestamp: `${this.today}T15:00:00Z`, isOpen: this.opts.isOpen, nextOpen: "", nextClose: "" }; }
  async getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]> { return this.opts.calendar.filter((d) => d.date >= from && d.date <= to); }
  async getPositions(): Promise<BrokerPosition[]> {
    return [...this.pos.entries()].filter(([, p]) => p.qty > 0).map(([symbol, p]) => ({ symbol, qty: p.qty, marketValue: p.qty * this.price(symbol), avgEntryPrice: p.cost / p.qty }));
  }
  async getAccount(): Promise<BrokerAccount> {
    const mv = (await this.getPositions()).reduce((a, p) => a + p.marketValue, 0);
    return { equity: this.cash + mv, cash: this.cash, buyingPower: this.cash };
  }
  async getOrders(status: "open" | "closed" | "all"): Promise<BrokerOrder[]> { return status === "open" ? [] : [...this.orders]; }
  async getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>> {
    return Object.fromEntries(symbols.map((s) => [s, this.price(s, tradingDate)]));
  }
  async isFractionable(symbols: string[]): Promise<Record<string, boolean>> {
    return Object.fromEntries(symbols.map((s) => [s, this.opts.fractionable?.[s] ?? true]));
  }
  async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
    const price = this.price(req.symbol);
    const cur = this.pos.get(req.symbol) ?? { qty: 0, cost: 0 };
    let qty: number;
    if (req.side === "buy") {
      qty = req.notional != null ? req.notional / price : (req.qty ?? 0);
      if (!(qty > 0)) throw new Error("FakeBroker: buy needs qty or notional");
      if (qty * price > this.cash + 1e-9) throw new Error("FakeBroker: insufficient cash");
      this.cash -= qty * price;
      this.pos.set(req.symbol, { qty: cur.qty + qty, cost: cur.cost + qty * price });
    } else {
      qty = req.qty ?? (req.notional != null ? req.notional / price : 0);
      if (!(qty > 0) || qty > cur.qty + 1e-9) throw new Error(`FakeBroker: insufficient position in ${req.symbol}`);
      this.cash += qty * price;
      const left = cur.qty - qty;
      if (left <= 1e-9) this.pos.delete(req.symbol); else this.pos.set(req.symbol, { qty: left, cost: cur.cost * (left / cur.qty) });
    }
    const o: BrokerOrder = {
      id: `fake-${this.orders.length + 1}`, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "filled",
      qty: req.qty ?? null, notional: req.notional ?? null, filledQty: qty, filledAvgPrice: price,
      filledAt: `${this.today}T15:30:00Z`, submittedAt: `${this.today}T15:30:00Z`,
    };
    this.orders.push(o);
    return o;
  }
  async cancelOrder(): Promise<void> { /* nothing is ever open in the fake */ }
}
```

`lib/broker/guards.ts`:
```ts
/**
 * guards.ts — the second line of defense (spec §8.3). Every submit re-checks paper-only, the ban,
 * the locks, the run caps and the kill switch, whatever the plan said. The ban refuses BUYS; a sell
 * of a banned symbol is how a prohibited position gets disposed of.
 */
import { isBannedTicker } from "../portfolio/eligibility";
import { isBuyLocked, isSellLocked, type Locks } from "../trade/locks";
import type { TradeConfig } from "../trade/config";
import type { TradingDay } from "../trade/calendar";
import type { BrokerAdapter, BrokerOrder, SubmitOrderRequest } from "./adapter";

export const PAPER_HOST = "paper-api.alpaca.markets";
export class GuardError extends Error { constructor(msg: string) { super(msg); this.name = "GuardError"; } }
export interface GuardContext {
  brokerKind: BrokerAdapter["kind"]; configuredBaseUrl: string; locks: Locks; today: TradingDay;
  nav: number; cfg: TradeConfig; env: NodeJS.ProcessEnv; counters: { orders: number; notionalUsd: number };
}

export function assertOrderAllowed(req: SubmitOrderRequest, ctx: GuardContext): void {
  if (ctx.env.TRADE_DISABLED === "1") throw new GuardError("TRADE_DISABLED=1 — kill switch engaged");
  if (ctx.brokerKind === "alpaca-paper" && !ctx.configuredBaseUrl.includes(PAPER_HOST)) {
    throw new GuardError(`base URL ${ctx.configuredBaseUrl} is not the paper endpoint (${PAPER_HOST})`);
  }
  if (req.side === "buy" && isBannedTicker(req.symbol)) throw new GuardError(`banned: ${req.symbol} (employer holding restriction)`);
  if (req.side === "buy" && isBuyLocked(ctx.locks, req.symbol, ctx.today)) throw new GuardError(`buy-locked: ${req.symbol} until ${ctx.locks.buyLockUntil[req.symbol]}`);
  if (req.side === "sell" && isSellLocked(ctx.locks, req.symbol, ctx.today)) throw new GuardError(`sell-locked: ${req.symbol} until ${ctx.locks.sellLockUntil[req.symbol]}`);
  if (ctx.counters.orders + 1 > ctx.cfg.maxOrdersPerRun) throw new GuardError(`maxOrdersPerRun ${ctx.cfg.maxOrdersPerRun} exceeded`);
  if (ctx.counters.notionalUsd + Math.abs(req.estNotionalUsd) > ctx.cfg.maxNotionalFrac * ctx.nav + 1e-9) {
    throw new GuardError(`maxNotionalFrac ${ctx.cfg.maxNotionalFrac} × NAV exceeded`);
  }
}

export async function guardedSubmit(adapter: BrokerAdapter, req: SubmitOrderRequest, ctx: GuardContext): Promise<BrokerOrder> {
  assertOrderAllowed(req, ctx);
  const order = await adapter.submitOrder(req);
  ctx.counters.orders += 1;
  ctx.counters.notionalUsd += Math.abs(req.estNotionalUsd);
  return order;
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run lib/broker` → PASS (4 + 8).

- [ ] **Step 5: Commit**

```bash
git add lib/broker/adapter.ts lib/broker/fake.ts lib/broker/fake.test.ts lib/broker/guards.ts lib/broker/guards.test.ts
git commit -m "feat(broker): adapter contract, in-memory FakeBroker, and submit-time guards

Spec §8.1, §8.3. Guards re-check paper-only, the ICE ban (buys), both
lock directions, the per-run caps and the TRADE_DISABLED kill switch
on every submit, independent of the plan.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 10: Alpaca Paper client

**Files:**
- Create: `lib/broker/alpaca.ts`
- Test: `lib/broker/alpaca.test.ts` (mocked `fetch`)

**Interfaces:**
- Consumes: everything in `lib/broker/adapter.ts`.
- Produces:
  ```ts
  export interface AlpacaOptions { keyId: string; secretKey: string; baseUrl: string; dataBaseUrl?: string; feed?: "iex" | "sip"; fetchImpl?: typeof fetch }
  export class AlpacaPaperBroker implements BrokerAdapter { constructor(opts: AlpacaOptions) }   // throws unless baseUrl contains PAPER_HOST
  ```
  Endpoints (spec §8.2; field names confirmed against the Alpaca reference for orders, positions, account and bars; clock/calendar use the long-standing `is_open`/`next_open`/`next_close`/`timestamp` and `date`/`open`/`close` and are parsed tolerantly): `GET /v2/clock`, `GET /v2/calendar?start&end`, `GET /v2/account` (`equity`,`cash`,`buying_power` as strings), `GET /v2/positions` (`symbol`,`qty`,`market_value`,`avg_entry_price` as strings), `GET /v2/orders?status&after&limit=500`, `POST /v2/orders` (`symbol`, `side`, `type:"market"`, `time_in_force:"day"`, `client_order_id`, and exactly one of `qty`/`notional`), `GET /v2/assets/{symbol}` (`fractionable`), and bars at `{dataBaseUrl}/v2/stocks/bars?symbols&timeframe=1Day&start&end&limit=1000&adjustment=raw&feed` → `bars[SYM][].c`. Default `feed` is `iex` (the free feed available to paper accounts). **Phase 1's manual smoke test against the paper account is the verification the spec requires** for any field this task assumes.

- [ ] **Step 1: Write the failing test**

`lib/broker/alpaca.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AlpacaPaperBroker } from "./alpaca";

type Call = { url: string; init: RequestInit };
function mockFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const mk = (routes: Record<string, unknown>) => {
  const f = mockFetch(routes);
  return { b: new AlpacaPaperBroker({ keyId: "k", secretKey: "s", baseUrl: "https://paper-api.alpaca.markets", fetchImpl: f.impl }), ...f };
};

describe("AlpacaPaperBroker", () => {
  it("refuses a non-paper base URL at construction", () => {
    expect(() => new AlpacaPaperBroker({ keyId: "k", secretKey: "s", baseUrl: "https://api.alpaca.markets" })).toThrow(/paper/);
  });
  it("sends the two auth headers and converts account strings to numbers", async () => {
    const { b, calls } = mk({ "/v2/account": { equity: "100000.5", cash: "2500", buying_power: "5000", status: "ACTIVE" } });
    expect(await b.getAccount()).toEqual({ equity: 100000.5, cash: 2500, buyingPower: 5000 });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["APCA-API-KEY-ID"]).toBe("k");
    expect(h["APCA-API-SECRET-KEY"]).toBe("s");
  });
  it("parses positions, the clock and the calendar", async () => {
    const { b } = mk({
      "/v2/positions": [{ symbol: "NVT", qty: "10.5", market_value: "1155", avg_entry_price: "100", side: "long" }],
      "/v2/clock": { timestamp: "2026-09-25T14:00:00Z", is_open: true, next_open: "x", next_close: "y" },
      "/v2/calendar": [{ date: "2026-09-25", open: "09:30", close: "16:00", session_open: "0400", session_close: "2000" }],
    });
    expect(await b.getPositions()).toEqual([{ symbol: "NVT", qty: 10.5, marketValue: 1155, avgEntryPrice: 100 }]);
    expect(await b.getClock()).toEqual({ timestamp: "2026-09-25T14:00:00Z", isOpen: true, nextOpen: "x", nextClose: "y" });
    expect(await b.getCalendar("2026-09-25", "2026-09-25")).toEqual([{ date: "2026-09-25", open: "09:30", close: "16:00" }]);
  });
  it("posts a market/day order with exactly one of qty or notional and the client id", async () => {
    const { b, calls } = mk({ "/v2/orders": { id: "id1", client_order_id: "c1", symbol: "NVT", side: "buy", status: "accepted", qty: null, notional: "1000", filled_qty: "0", filled_avg_price: null, filled_at: null, submitted_at: "t", type: "market", time_in_force: "day" } });
    const o = await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1000, clientOrderId: "c1", estNotionalUsd: 1000 });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ symbol: "NVT", side: "buy", type: "market", time_in_force: "day", client_order_id: "c1", notional: "1000" });
    expect(o).toEqual(expect.objectContaining({ id: "id1", clientOrderId: "c1", status: "accepted", notional: 1000, qty: null, filledQty: 0, filledAvgPrice: null }));
  });
  it("reads the settled close from daily bars with the iex feed", async () => {
    const { b, calls } = mk({ "/v2/stocks/bars": { bars: { NVT: [{ t: "2026-09-24T04:00:00Z", o: 1, h: 1, l: 1, c: 101.25, v: 1 }] }, next_page_token: null } });
    expect(await b.getLastClose(["NVT"], "2026-09-24")).toEqual({ NVT: 101.25 });
    expect(calls[0].url).toContain("data.alpaca.markets/v2/stocks/bars");
    expect(calls[0].url).toContain("timeframe=1Day");
    expect(calls[0].url).toContain("feed=iex");
    await expect(b.getLastClose(["ZZZ"], "2026-09-24")).rejects.toThrow(/no bar/);
  });
  it("reads fractionability per asset", async () => {
    const { b } = mk({ "/v2/assets/NVT": { symbol: "NVT", fractionable: true, tradable: true } });
    expect(await b.isFractionable(["NVT"])).toEqual({ NVT: true });
  });
  it("surfaces HTTP errors with the body", async () => {
    const { b } = mk({});
    await expect(b.getAccount()).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/broker/alpaca.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write alpaca.ts**

```ts
/**
 * alpaca.ts — Alpaca Paper Trading REST client (spec §8.2). Thin: native fetch, tolerant zod on every
 * response (only the fields we use), numeric strings converted here and nowhere else. Constructing
 * it against anything but the paper endpoint is an error — there is no live mode in this code.
 */
import { z } from "zod";
import type { BrokerAdapter, BrokerAccount, BrokerCalendarDay, BrokerClock, BrokerOrder, BrokerOrderStatus, BrokerPosition, SubmitOrderRequest } from "./adapter";
import { PAPER_HOST } from "./guards";

export interface AlpacaOptions { keyId: string; secretKey: string; baseUrl: string; dataBaseUrl?: string; feed?: "iex" | "sip"; fetchImpl?: typeof fetch }

const num = z.union([z.number(), z.string()]).transform((v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; });
const numOrNull = z.union([num, z.null(), z.undefined()]).transform((v) => (v == null ? null : v));
const Account = z.object({ equity: num, cash: num, buying_power: num });
const Position = z.object({ symbol: z.string(), qty: num, market_value: num, avg_entry_price: num });
const Clock = z.object({ timestamp: z.string(), is_open: z.boolean(), next_open: z.string(), next_close: z.string() });
const CalendarDay = z.object({ date: z.string(), open: z.string(), close: z.string() });
const Order = z.object({
  id: z.string(), client_order_id: z.string(), symbol: z.string(), side: z.enum(["buy", "sell"]), status: z.string(),
  qty: numOrNull, notional: numOrNull, filled_qty: numOrNull, filled_avg_price: numOrNull, filled_at: z.string().nullable().optional(), submitted_at: z.string().nullable().optional(),
});
const Bars = z.object({ bars: z.record(z.string(), z.array(z.object({ t: z.string(), c: num }))).default({}) });
const Asset = z.object({ symbol: z.string(), fractionable: z.boolean() });

export class AlpacaPaperBroker implements BrokerAdapter {
  readonly kind = "alpaca-paper" as const;
  private readonly base: string; private readonly data: string; private readonly feed: string; private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  constructor(opts: AlpacaOptions) {
    if (!opts.baseUrl.includes(PAPER_HOST)) throw new Error(`AlpacaPaperBroker: baseUrl must be the paper endpoint (${PAPER_HOST}); got ${opts.baseUrl}`);
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.data = (opts.dataBaseUrl ?? "https://data.alpaca.markets").replace(/\/$/, "");
    this.feed = opts.feed ?? "iex";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.headers = { "APCA-API-KEY-ID": opts.keyId, "APCA-API-SECRET-KEY": opts.secretKey, accept: "application/json" };
  }
  private async call<T>(schema: z.ZodType<T>, url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(url, { ...init, headers: { ...this.headers, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Alpaca ${init.method ?? "GET"} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return schema.parse(JSON.parse(text));
  }
  private toOrder(o: z.infer<typeof Order>): BrokerOrder {
    return { id: o.id, clientOrderId: o.client_order_id, symbol: o.symbol, side: o.side, status: o.status as BrokerOrderStatus,
      qty: o.qty, notional: o.notional, filledQty: o.filled_qty ?? 0, filledAvgPrice: o.filled_avg_price, filledAt: o.filled_at ?? null, submittedAt: o.submitted_at ?? null };
  }
  async getClock(): Promise<BrokerClock> {
    const c = await this.call(Clock, `${this.base}/v2/clock`);
    return { timestamp: c.timestamp, isOpen: c.is_open, nextOpen: c.next_open, nextClose: c.next_close };
  }
  async getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]> {
    return this.call(z.array(CalendarDay), `${this.base}/v2/calendar?start=${from}&end=${to}`);
  }
  async getAccount(): Promise<BrokerAccount> {
    const a = await this.call(Account, `${this.base}/v2/account`);
    return { equity: a.equity, cash: a.cash, buyingPower: a.buying_power };
  }
  async getPositions(): Promise<BrokerPosition[]> {
    return (await this.call(z.array(Position), `${this.base}/v2/positions`)).map((p) => ({ symbol: p.symbol, qty: p.qty, marketValue: p.market_value, avgEntryPrice: p.avg_entry_price }));
  }
  async getOrders(status: "open" | "closed" | "all", after?: string): Promise<BrokerOrder[]> {
    const q = new URLSearchParams({ status, limit: "500", direction: "asc" }); if (after) q.set("after", after);
    return (await this.call(z.array(Order), `${this.base}/v2/orders?${q}`)).map((o) => this.toOrder(o));
  }
  async getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>> {
    const q = new URLSearchParams({ symbols: symbols.join(","), timeframe: "1Day", start: tradingDate, end: tradingDate, limit: "1000", adjustment: "raw", feed: this.feed });
    const { bars } = await this.call(Bars, `${this.data}/v2/stocks/bars?${q}`);
    const out: Record<string, number> = {};
    for (const s of symbols) { const b = bars[s]; if (!b?.length) throw new Error(`Alpaca: no bar for ${s} on ${tradingDate}`); out[s] = b[b.length - 1].c; }
    return out;
  }
  async isFractionable(symbols: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const s of symbols) out[s] = (await this.call(Asset, `${this.base}/v2/assets/${encodeURIComponent(s)}`)).fractionable;
    return out;
  }
  async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
    if ((req.qty == null) === (req.notional == null)) throw new Error("submitOrder: exactly one of qty or notional");
    const body = { symbol: req.symbol, side: req.side, type: "market", time_in_force: "day", client_order_id: req.clientOrderId,
      ...(req.notional != null ? { notional: String(req.notional) } : { qty: String(req.qty) }) };
    return this.toOrder(await this.call(Order, `${this.base}/v2/orders`, { method: "POST", body: JSON.stringify(body) }));
  }
  async cancelOrder(id: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/v2/orders/${id}`, { method: "DELETE", headers: this.headers });
    if (!res.ok && res.status !== 404) throw new Error(`Alpaca DELETE order ${id} → ${res.status}`);
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/broker/alpaca.test.ts` → PASS (7).

- [ ] **Step 5: Commit**

```bash
git add lib/broker/alpaca.ts lib/broker/alpaca.test.ts
git commit -m "feat(broker): Alpaca Paper REST client with tolerant parsing and paper-only construction

Spec §8.2. Native fetch, zod on every response reading only the fields
we use, numeric strings converted at this boundary. Constructing the
client against a non-paper base URL throws; there is no live mode.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 11: The pipeline, the three scripts, and the wiring

**Files:**
- Create: `lib/trade/pipeline.ts`, `scripts/_trade-common.ts`, `scripts/trade-plan.ts`, `scripts/trade-reconcile.ts`, `scripts/trade-execute.ts`
- Modify: `scripts/_env.ts`, `.env.example`, `.gitignore`, `package.json`
- Test: `lib/trade/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above; `buildSignal` (`lib/portfolio/signal.ts`, signature `(report, livePrice, sic, today: Date, config)`), `listReportTickers`/`loadReport` (`lib/reports.ts`), `FactPack` (`lib/facts/schema.ts`), `fetchDailyCloses` (`lib/prices/yahoo.ts`, `(ticker, from, to) → raw JSON text`).
- Produces (`lib/trade/pipeline.ts`):
  ```ts
  export interface PlanRunInput { adapter: BrokerAdapter; reports: Report[]; sics: Record<string, number | null>;
      marketCapUsd: Record<string, number | null>; fills: Fill[]; today: TradingDay; cfg: TradeConfig; runId: string }
  export interface PlanRunOutput { ledger: Ledger; calendar: TradingDay[]; markDate: TradingDay; marks: Record<string, number>;
      signals: Signal[]; locks: Locks; plan: TradePlan; sized: SizedOrders; record: RunRecord }
  export async function planRun(input: PlanRunInput): Promise<PlanRunOutput>;   // reads the broker; never submits
  export async function executeOrders(input: { adapter: BrokerAdapter; sized: SizedOrders; ctx: GuardContext; runId: string; fillsPath: string; pollMs?: number }): Promise<Fill[]>;
  ```
  `planRun` is the single orchestration both scripts and the e2e test use: calendar → settled mark date → marks → reconcile → signals → locks → plan → orders → run record. `executeOrders` submits through `guardedSubmit`, polls each order to a terminal status, and appends every fill (with its **trading date**) to `fills.jsonl` — the only place fills are written.

- [ ] **Step 1: Write the failing pipeline test** — `lib/trade/pipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun, executeOrders } from "./pipeline";
import { FakeBroker } from "../broker/fake";
import { resolveTradeConfig } from "./config";
import { readFills } from "./fills";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { GuardContext } from "../broker/guards";

const CAL = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((date) => ({ date, open: "09:30", close: "16:00" }));
const closes = (p: number) => Object.fromEntries(CAL.map((d) => [d.date, p]));
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 });
const nvt = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] }); // at 100: mu +21%, R 1.05

describe("planRun", () => {
  it("marks at the previous settled close, reconciles an empty book, and plans an ENTER", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: { ...closes(100), "2026-09-25": 999 } }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: { NVT: 3500 }, marketCapUsd: { NVT: 3e9 }, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    expect(out.markDate).toBe("2026-09-24");
    expect(out.marks).toEqual({ NVT: 100 });                       // not the 999 intraday print
    expect(out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "ENTER" })]);
    expect(out.sized.orders).toEqual([expect.objectContaining({ ticker: "NVT", kind: "notional", notional: 9_900 })]);
    expect(out.record.runId).toBe("r1");
  });
  it("halts on a broker position the fills log cannot explain", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 9_000, isOpen: true, today: "2026-09-25" });
    await b.submitOrder({ symbol: "NVT", side: "buy", notional: 1_000, clientOrderId: "manual", estNotionalUsd: 1_000 }); // a trade the log never saw
    await expect(planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r" })).rejects.toThrow(/no buy fill/);
  });
});

describe("executeOrders", () => {
  it("submits through the guards and appends fills carrying the trading date", async () => {
    const b = new FakeBroker({ calendar: CAL, closes: { NVT: closes(100) }, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-25" });
    const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: [], today: "2026-09-25", cfg, runId: "r1" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "exec-")), "fills.jsonl");
    const ctx: GuardContext = { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today: "2026-09-25", nav: out.ledger.nav, cfg, env: {}, counters: { orders: 0, notionalUsd: 0 } };
    const fills = await executeOrders({ adapter: b, sized: out.sized, ctx, runId: "r1", fillsPath, pollMs: 0 });
    expect(fills).toEqual([expect.objectContaining({ ticker: "NVT", side: "buy", qty: 99, price: 100, tradingDate: "2026-09-25", runId: "r1" })]);
    expect(readFills(fillsPath)).toEqual(fills);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/trade/pipeline.test.ts` → FAIL.

- [ ] **Step 3: Write pipeline.ts**

```ts
/**
 * pipeline.ts — one run, end to end, with the broker used only for reads in planRun (spec §7, §9, §10).
 * executeOrders is the only writer of fills.jsonl.
 */
import type { Report } from "../report.schema";
import { buildSignal, type Signal } from "../portfolio/signal";
import type { BrokerAdapter } from "../broker/adapter";
import { TERMINAL_STATUSES } from "../broker/adapter";
import { guardedSubmit, type GuardContext } from "../broker/guards";
import type { TradeConfig } from "./config";
import { assertCalendar, prevTradingDay, isTradingDay, type TradingDay } from "./calendar";
import { appendFill, type Fill } from "./fills";
import { locksFor, type Locks } from "./locks";
import { reconcile, weightsOf, positionsOf, type Ledger } from "./ledger";
import { emitTrades, type TradePlan } from "./rebalance";
import { tradesToOrders, type SizedOrders } from "./orders";
import type { RunRecord } from "./run-record";

export interface PlanRunInput {
  adapter: BrokerAdapter; reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null>;
  fills: Fill[]; today: TradingDay; cfg: TradeConfig; runId: string;
}
export interface PlanRunOutput {
  ledger: Ledger; calendar: TradingDay[]; markDate: TradingDay; marks: Record<string, number>; signals: Signal[];
  locks: Locks; plan: TradePlan; sized: SizedOrders; record: RunRecord;
}

const shiftDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

export async function planRun(input: PlanRunInput): Promise<PlanRunOutput> {
  const { adapter, reports, sics, marketCapUsd, fills, today, cfg, runId } = input;
  const calendar = (await adapter.getCalendar(shiftDays(today, -90), shiftDays(today, 45))).map((d) => d.date);
  assertCalendar(calendar);
  const markDate = cfg.markMode === "settled" || !isTradingDay(calendar, today) ? prevTradingDay(calendar, today) : today;
  const tickers = reports.map((r) => r.meta.ticker);
  const held = (await adapter.getPositions()).map((p) => p.symbol);
  const marks = await adapter.getLastClose([...new Set([...tickers, ...held])], markDate);
  const ledger = reconcile({ asOf: today, account: await adapter.getAccount(), positions: await adapter.getPositions(), fills });
  const todayDate = new Date(today + "T00:00:00Z");
  const signals = reports.map((r) => buildSignal(r, marks[r.meta.ticker], sics[r.meta.ticker] ?? null, todayDate, cfg));
  const locks = locksFor(fills, calendar, cfg.lockBusinessDays);
  const plan = emitTrades({ signals, currentWeights: weightsOf(ledger), locks, today, cfg });
  const buyTickers = plan.trades.filter((t) => t.side === "buy").map((t) => t.ticker);
  const fractionable = buyTickers.length ? await adapter.isFractionable(buyTickers) : {};
  const sized = tradesToOrders({ plan, nav: ledger.nav, marks, positions: positionsOf(ledger), fractionalOk: (t) => fractionable[t] ?? false, marketCapUsd, runId, cfg });
  const record: RunRecord = {
    runId, today, markMode: cfg.markMode, broker: adapter.kind, marks,
    signals: signals.map((s) => ({ ticker: s.ticker, label: s.label, gatedLabel: s.gatedLabel, mu: s.mu, R: s.R, kappa: s.kappa, quality: s.quality, ageDays: s.ageDays })),
    classifications: plan.classifications, locks,
    plan: { frozenWeight: plan.frozenWeight, sizingTarget: plan.sizingTarget, plannedInvested: plan.plannedInvested, plannedCash: plan.plannedCash, buyScale: plan.buyScale, trades: plan.trades, skipped: plan.skipped },
    orders: sized.orders as unknown as Record<string, unknown>[], fills: [], notes: sized.skippedDust.map((d) => `dust skipped: ${d.ticker} $${d.deltaUsd.toFixed(2)}`),
  };
  return { ledger, calendar, markDate, marks, signals, locks, plan, sized, record };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function executeOrders(input: { adapter: BrokerAdapter; sized: SizedOrders; ctx: GuardContext; runId: string; fillsPath: string; pollMs?: number }): Promise<Fill[]> {
  const { adapter, sized, ctx, runId, fillsPath, pollMs = 1000 } = input;
  const fills: Fill[] = [];
  for (const o of sized.orders) {
    let order = await guardedSubmit(adapter, { symbol: o.ticker, side: o.side, qty: o.kind === "qty" ? o.qty : undefined, notional: o.kind === "notional" ? o.notional : undefined, clientOrderId: o.clientOrderId, estNotionalUsd: o.deltaUsd }, ctx);
    for (let i = 0; i < 60 && !TERMINAL_STATUSES.has(order.status); i++) {
      await sleep(pollMs);
      order = (await adapter.getOrders("all")).find((x) => x.clientOrderId === o.clientOrderId) ?? order;
    }
    if (order.filledQty > 0 && order.filledAvgPrice != null && order.filledAt) {
      const fill: Fill = { ticker: o.ticker, side: o.side, qty: order.filledQty, price: order.filledAvgPrice, filledAt: order.filledAt, tradingDate: order.filledAt.slice(0, 10), orderId: order.id, runId };
      appendFill(fillsPath, fill);
      fills.push(fill);
    }
  }
  return fills;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/trade/pipeline.test.ts` → PASS (3). (`tradingDate` is taken from the fill timestamp's date; Alpaca reports fills in UTC, and a regular-hours US fill is the same calendar date in UTC — extended hours are out of scope, §9.5.)

- [ ] **Step 5: Wire the scripts, env, ignore, and npm entries**

Append to `scripts/_env.ts`:
```ts
export function requireAlpaca(): { keyId: string; secretKey: string; baseUrl: string } {
  const keyId = process.env.APCA_API_KEY_ID, secretKey = process.env.APCA_API_SECRET_KEY;
  if (!keyId || !secretKey) { console.error("APCA_API_KEY_ID / APCA_API_SECRET_KEY are not set. Add them to .env.local (paper keys only)."); process.exit(2); }
  return { keyId, secretKey, baseUrl: process.env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets" };
}
```

`.env.example` — append:
```
# Alpaca PAPER trading only. The trade layer refuses any non-paper base URL.
APCA_API_KEY_ID=
APCA_API_SECRET_KEY=
APCA_API_BASE_URL=https://paper-api.alpaca.markets
# Set to 1 to refuse every order submission (kill switch).
# TRADE_DISABLED=1
```

`.gitignore` — append after the `data/judgment/**/*.review-brief.md` line:
```
# trade layer runtime state (ledger cache, fills log, run records, calendar cache)
data/trade/
```

`package.json` — add after `"portfolio:build"`:
```json
    "trade:plan": "node --env-file-if-exists=.env.local --import tsx scripts/trade-plan.ts",
    "trade:reconcile": "node --env-file-if-exists=.env.local --import tsx scripts/trade-reconcile.ts",
    "trade:execute": "node --env-file-if-exists=.env.local --import tsx scripts/trade-execute.ts",
```

`scripts/_trade-common.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listReportTickers, loadReport } from "../lib/reports";
import { FactPack } from "../lib/facts/schema";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import type { Report } from "../lib/report.schema";
import type { BrokerAdapter, BrokerCalendarDay } from "../lib/broker/adapter";
import { AlpacaPaperBroker } from "../lib/broker/alpaca";
import { FakeBroker } from "../lib/broker/fake";
import { readFills } from "../lib/trade/fills";
import { readLedger } from "../lib/trade/ledger";
import { requireAlpaca } from "./_env";

export const TRADE_DIR = join("data", "trade");
export const FILLS_PATH = join(TRADE_DIR, "fills.jsonl");
export const LEDGER_PATH = join(TRADE_DIR, "ledger.json");
export const RUNS_DIR = join(TRADE_DIR, "runs");

export const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
export const has = (args: string[], name: string) => args.includes(name);

export async function loadReportsAndMeta(): Promise<{ reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null> }> {
  const reports: Report[] = [], sics: Record<string, number | null> = {}, marketCapUsd: Record<string, number | null> = {};
  for (const t of await listReportTickers()) {
    const r = await loadReport(t); if (!r) continue;
    reports.push(r);
    const p = join("data", "facts", r.meta.ticker.toUpperCase(), `${r.meta.filing.accession}.json`);
    sics[r.meta.ticker] = existsSync(p) ? FactPack.parse(JSON.parse(readFileSync(p, "utf8"))).sic ?? null : null;
    const cell = (r as unknown as { snapshot?: { label: string; value: unknown }[] }).snapshot?.find((c) => /market cap/i.test(c.label));
    marketCapUsd[r.meta.ticker] = typeof cell?.value === "number" ? cell.value : null;
  }
  return { reports, sics, marketCapUsd };
}

/** Weekday calendar for Phase 0 when no Alpaca keys are present (holidays are NOT excluded — a documented approximation). */
export function weekdayCalendar(from: string, to: string): BrokerCalendarDay[] {
  const out: BrokerCalendarDay[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86_400_000)) {
    const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), open: "09:30", close: "16:00" });
  }
  return out;
}

async function yahooClose(ticker: string, date: string): Promise<number> {
  const raw = JSON.parse(await fetchDailyCloses(ticker, date, date));
  const closes: (number | null)[] = raw.chart.result[0].indicators.quote[0].close;
  const c = closes.filter((x): x is number => x != null).at(-1);
  if (c == null) throw new Error(`Yahoo: no close for ${ticker} on ${date}`);
  return c;
}

/** The Phase-0 fake: its book comes from the local ledger; marks come from Alpaca (read-only) when keys exist, else Yahoo. */
export async function makeFakeBroker(tickers: string[], today: string, markDate: string): Promise<FakeBroker> {
  const ledger = readLedger(LEDGER_PATH);
  let calendar: BrokerCalendarDay[], closes: Record<string, Record<string, number>> = {};
  if (process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY) {
    const ro = new AlpacaPaperBroker(requireAlpaca());
    calendar = await ro.getCalendar(shift(today, -90), shift(today, 45));
    const last = await ro.getLastClose(tickers, markDate);
    for (const t of tickers) closes[t] = { [markDate]: last[t], [today]: last[t] };
  } else {
    calendar = weekdayCalendar(shift(today, -90), shift(today, 45));
    for (const t of tickers) { const c = await yahooClose(t, markDate); closes[t] = { [markDate]: c, [today]: c }; }
  }
  const b = new FakeBroker({ calendar, closes, equity: ledger?.nav ?? 100_000, cash: ledger?.cash ?? 100_000, isOpen: true, today });
  for (const p of ledger?.positions ?? []) await b.submitOrder({ symbol: p.ticker, side: "buy", qty: p.qty, clientOrderId: `seed-${p.ticker}`, estNotionalUsd: p.marketValue });
  return b;
}
export const shift = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
export function makeAlpaca(): BrokerAdapter { return new AlpacaPaperBroker(requireAlpaca()); }
export { readFills };
```

`scripts/trade-plan.ts`:
```ts
/** trade:plan — compute and record the plan. NEVER submits. `--broker fake` (default) | `alpaca` (read-only). */
import { resolveTradeConfig } from "../lib/trade/config";
import { planRun } from "../lib/trade/pipeline";
import { newRunId, writeRunRecord } from "../lib/trade/run-record";
import { writeLedger } from "../lib/trade/ledger";
import { flag, has, loadReportsAndMeta, makeFakeBroker, makeAlpaca, readFills, FILLS_PATH, LEDGER_PATH, RUNS_DIR, shift } from "./_trade-common";

const args = process.argv.slice(2);
const today = flag(args, "--date") ?? new Date().toISOString().slice(0, 10);
const broker = flag(args, "--broker") ?? "fake";
const cfg = resolveTradeConfig();
const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
const tickers = reports.map((r) => r.meta.ticker);
const fills = readFills(FILLS_PATH);
const adapter = broker === "alpaca" ? makeAlpaca() : await makeFakeBroker(tickers, today, shift(today, -1));
const runId = newRunId(today);
const out = await planRun({ adapter, reports, sics, marketCapUsd, fills, today, cfg, runId });
writeLedger(LEDGER_PATH, out.ledger);
const path = writeRunRecord(RUNS_DIR, out.record);
console.log(`Plan ${runId} · broker ${adapter.kind} · marks ${out.markDate} (${cfg.markMode}) · NAV $${out.ledger.nav.toFixed(0)} · invested→ ${(out.plan.plannedInvested * 100).toFixed(1)}% · cash→ ${(out.plan.plannedCash * 100).toFixed(1)}%`);
for (const t of out.plan.trades) console.log(`  ${t.side.toUpperCase().padEnd(4)} ${t.ticker.padEnd(6)} ${t.reason.padEnd(5)} ${(t.currentWeight * 100).toFixed(1).padStart(5)}% → ${(t.targetWeight * 100).toFixed(1).padStart(5)}%`);
for (const o of out.sized.orders) console.log(`  order ${o.side} ${o.ticker} ${o.kind === "notional" ? `$${o.notional}` : `${o.qty} sh`} ~cost $${o.estCostUsd.toFixed(2)} (${o.bucket})`);
for (const s of out.plan.skipped.filter((s) => s.code !== "INELIGIBLE")) console.log(`  skip  ${s.ticker.padEnd(6)} ${s.code}${s.unlockOn ? ` until ${s.unlockOn}` : ""} — ${s.reasons.join("; ")}`);
console.log(`Recorded ${path}. No orders were submitted.`);
if (has(args, "--simulate-fills") && adapter.kind === "fake") {
  const { executeOrders } = await import("../lib/trade/pipeline");
  const n = (await executeOrders({ adapter, sized: out.sized, ctx: { brokerKind: "fake", configuredBaseUrl: "memory://", locks: out.locks, today, nav: out.ledger.nav, cfg, env: process.env, counters: { orders: 0, notionalUsd: 0 } }, runId, fillsPath: FILLS_PATH, pollMs: 0 })).length;
  const acct = await adapter.getAccount();
  writeLedger(LEDGER_PATH, { asOf: today, nav: acct.equity, cash: acct.cash, positions: (await adapter.getPositions()).map((p) => ({ ticker: p.symbol, qty: p.qty, marketValue: p.marketValue, avgCost: p.avgEntryPrice })) });
  console.log(`Simulated ${n} fill(s) into the fake book (Phase 0 only).`);
}
```

`scripts/trade-reconcile.ts`:
```ts
/** trade:reconcile — broker → ledger. Reads only. */
import { reconcile, writeLedger } from "../lib/trade/ledger";
import { makeAlpaca, readFills, FILLS_PATH, LEDGER_PATH } from "./_trade-common";
const b = makeAlpaca();
const today = new Date().toISOString().slice(0, 10);
const ledger = reconcile({ asOf: today, account: await b.getAccount(), positions: await b.getPositions(), fills: readFills(FILLS_PATH) });
writeLedger(LEDGER_PATH, ledger);
console.log(`Reconciled ${ledger.positions.length} position(s), NAV $${ledger.nav.toFixed(2)}, cash $${ledger.cash.toFixed(2)} → ${LEDGER_PATH}`);
```

`scripts/trade-execute.ts`:
```ts
/** trade:execute -- --paper [--yes]  — plan, confirm, submit to Alpaca PAPER through the guards, record fills. */
import { createInterface } from "node:readline/promises";
import { resolveTradeConfig } from "../lib/trade/config";
import { planRun, executeOrders } from "../lib/trade/pipeline";
import { newRunId, writeRunRecord } from "../lib/trade/run-record";
import { writeLedger } from "../lib/trade/ledger";
import { PAPER_HOST } from "../lib/broker/guards";
import { requireAlpaca } from "./_env";
import { has, loadReportsAndMeta, makeAlpaca, readFills, FILLS_PATH, LEDGER_PATH, RUNS_DIR } from "./_trade-common";

const args = process.argv.slice(2);
if (!has(args, "--paper")) { console.error("trade:execute requires an explicit --paper flag (there is no live mode)."); process.exit(2); }
if (process.env.TRADE_DISABLED === "1") { console.error("TRADE_DISABLED=1 — refusing to submit."); process.exit(2); }
const { baseUrl } = requireAlpaca();
if (!baseUrl.includes(PAPER_HOST)) { console.error(`APCA_API_BASE_URL is not the paper endpoint: ${baseUrl}`); process.exit(2); }
const cfg = resolveTradeConfig();
const today = new Date().toISOString().slice(0, 10);
const adapter = makeAlpaca();
if (!(await adapter.getClock()).isOpen) { console.log("Market is closed — nothing submitted (spec §9.5)."); process.exit(0); }
const { reports, sics, marketCapUsd } = await loadReportsAndMeta();
const runId = newRunId(today);
const out = await planRun({ adapter, reports, sics, marketCapUsd, fills: readFills(FILLS_PATH), today, cfg, runId });
writeLedger(LEDGER_PATH, out.ledger);
for (const o of out.sized.orders) console.log(`  ${o.side} ${o.ticker} ${o.kind === "notional" ? `$${o.notional}` : `${o.qty} sh`} (${o.reason})`);
if (out.sized.orders.length === 0) { writeRunRecord(RUNS_DIR, out.record); console.log("Nothing to trade."); process.exit(0); }
if (!has(args, "--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`Submit ${out.sized.orders.length} order(s) to Alpaca PAPER? [y/N] `)).trim().toLowerCase(); rl.close();
  if (a !== "y") { console.log("Aborted; nothing submitted."); process.exit(0); }
}
const fills = await executeOrders({ adapter, sized: out.sized, ctx: { brokerKind: "alpaca-paper", configuredBaseUrl: baseUrl, locks: out.locks, today, nav: out.ledger.nav, cfg, env: process.env, counters: { orders: 0, notionalUsd: 0 } }, runId, fillsPath: FILLS_PATH });
out.record.fills = fills as unknown as Record<string, unknown>[];
const path = writeRunRecord(RUNS_DIR, out.record);
console.log(`Submitted ${out.sized.orders.length} order(s); ${fills.length} fill(s) recorded to ${FILLS_PATH}. Run record ${path}. Run trade:reconcile before the next plan.`);
```

- [ ] **Step 6: Typecheck and dry-run**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run trade:plan` (no Alpaca keys needed; Yahoo marks, weekday calendar) → prints a plan and `Recorded data/trade/runs/<id>.json. No orders were submitted.`; `git status` shows nothing new under `data/trade/` (ignored).

- [ ] **Step 7: Commit**

```bash
git add lib/trade/pipeline.ts lib/trade/pipeline.test.ts scripts/_trade-common.ts scripts/trade-plan.ts scripts/trade-reconcile.ts scripts/trade-execute.ts scripts/_env.ts .env.example .gitignore package.json
git commit -m "feat(trade): planRun pipeline, trade:plan/reconcile/execute scripts, env and ignore wiring

Spec §9, §10. trade:plan never submits and runs against the fake by
default (Alpaca read-only or Yahoo marks); trade:execute requires
--paper, checks the clock, confirms interactively, submits through the
guards and records fills with their trading date.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

### Task 12: End-to-end scenario — enter, whipsaw blocked, deferred exit fires on the first legal day

**Files:**
- Test: `lib/trade/e2e.test.ts`

**Interfaces:** consumes `planRun`/`executeOrders` (Task 11), `FakeBroker`, `fixtureReport`, `locksFor`. Proves spec §5–§7 and §13's e2e bullet together, with `lockBusinessDays = 6` and a holiday in the window.

- [ ] **Step 1: Write the test**

`lib/trade/e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun, executeOrders } from "./pipeline";
import { readFills } from "./fills";
import { resolveTradeConfig } from "./config";
import { FakeBroker } from "../broker/fake";
import { fixtureReport } from "../portfolio/__fixtures__/reports";
import type { GuardContext } from "../broker/guards";

// Trading days Mon 09-21 → Fri 10-02 with Thu 09-24 a holiday.
const DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const CAL = DAYS.map((date) => ({ date, open: "09:30", close: "16:00" }));
const cfg = resolveTradeConfig({ wMax: 1, sectorMax: 1 });
// Scenarios fixed; price path drives mu/R. At 100: mu +21%, R 1.05 → ENTER. At 125: mu ≈ −3%, below muExit → EXIT.
const nvt = fixtureReport({ ticker: "NVT", label: "BUY", conviction: 70, scenarios: [[150, 0.3], [120, 0.5], [80, 0.2]] });
const path = (d: string) => (d < "2026-09-23" ? 100 : 125); // rallies through fair value from 09-23

describe("e2e: a whipsaw cannot happen inside the lock window; the deferred exit fires on the first legal day", () => {
  it("runs the book day by day", async () => {
    const closes = { NVT: Object.fromEntries(DAYS.map((d) => [d, path(d)])) };
    const b = new FakeBroker({ calendar: CAL, closes, equity: 10_000, cash: 10_000, isOpen: true, today: "2026-09-22" });
    const fillsPath = join(mkdtempSync(join(tmpdir(), "e2e-")), "fills.jsonl");
    const ctx = (today: string, locks: GuardContext["locks"], nav: number): GuardContext =>
      ({ brokerKind: "fake", configuredBaseUrl: "memory://", locks, today, nav, cfg, env: {}, counters: { orders: 0, notionalUsd: 0 } });
    const run = async (today: string) => {
      b.setToday(today);
      const out = await planRun({ adapter: b, reports: [nvt], sics: {}, marketCapUsd: {}, fills: readFills(fillsPath), today, cfg, runId: `r-${today}` });
      const fills = await executeOrders({ adapter: b, sized: out.sized, ctx: ctx(today, out.locks, out.ledger.nav), runId: `r-${today}`, fillsPath, pollMs: 0 });
      return { out, fills };
    };

    // Day 1 (Tue 09-22, marked at Mon's 100): ENTER and fill.
    const d1 = await run("2026-09-22");
    expect(d1.out.plan.trades.map((t) => t.reason)).toEqual(["ENTER"]);
    expect(d1.fills).toHaveLength(1);
    expect(d1.out.locks.sellLockUntil).toEqual({});                 // locks are computed from fills *before* today's execution

    // Day 2 (Wed 09-23, marked at Tue's 100): HOLD, nothing to do.
    const d2 = await run("2026-09-23");
    expect(d2.out.locks.sellLockUntil.NVT).toBe("2026-10-01");      // 09-22 + 6 trading days, holiday skipped
    expect(d2.out.plan.trades).toEqual([]);

    // Day 3 (Fri 09-25, marked at Wed's 125): the thesis played out → EXIT wanted, but sell-locked → DEFERRED.
    const d3 = await run("2026-09-25");
    expect(d3.out.plan.skipped).toContainEqual(expect.objectContaining({ ticker: "NVT", code: "DEFER_EXIT", unlockOn: "2026-10-01" }));
    expect(d3.fills).toEqual([]);
    expect(d3.out.plan.frozenWeight).toBeGreaterThan(0.9);

    // Day 4 (Wed 09-30, the day before unlock): still deferred.
    expect((await run("2026-09-30")).fills).toEqual([]);

    // Day 5 (Thu 10-01, first legal day): the exit fires and fills.
    const d5 = await run("2026-10-01");
    expect(d5.out.plan.trades).toEqual([expect.objectContaining({ ticker: "NVT", reason: "EXIT" })]);
    expect(d5.fills).toEqual([expect.objectContaining({ side: "sell", tradingDate: "2026-10-01" })]);
    expect(await b.getPositions()).toEqual([]);

    // Day 6 (Fri 10-02): the 10-01 sell buy-locks NVT six trading days out — beyond this test's
    // 9-day calendar. A lock that cannot be dated is a hard error, never silently absent (which is
    // why planRun loads 45 days of calendar in production).
    await expect(run("2026-10-02")).rejects.toThrow(/beyond the loaded calendar/);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run lib/trade/e2e.test.ts` → PASS.

- [ ] **Step 3: Run the whole suite and typecheck** — `npx vitest run` → all green; `npx tsc --noEmit` → 0.

- [ ] **Step 4: Commit**

```bash
git add lib/trade/e2e.test.ts
git commit -m "test(trade): end-to-end scenario — enter, deferred exit under the sell-lock, exit on the first legal day

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QehUFcU33pPTjJJBbJahAS"
```

---

## Plan self-review (run against the spec)

- **Spec coverage.** §3 ledger/fills/halt → Tasks 2, 7. §4 settled mark → Task 11 (`markDate`). §5 hysteresis incl. DEFER/BARRED → Task 3; §5.4 quality tilt → Task 4. §6 calendar, locks, whole-ticker, default 6, day-count parameter → Tasks 1–2. §7 emitter steps 1–8 → Task 5 (+ cost report in Task 6). §8.1 adapter, §8.3 guards → Task 9; §8.2 Alpaca → Task 10. §9 sizing/execution/idempotency/market-hours → Tasks 6, 11. §10 cadence → scripts are manual-trigger in Phases 0–1 (automatic wiring is Phase 2, out of this plan by spec §15). §11 rollout → Task 11 scripts implement Phase 0 (`trade:plan --simulate-fills`) and Phase 1 (`trade:execute --paper`). §12 config → Tasks 1, 4. §13 tests → every task. §14 run record → Task 8, populated in Task 11.
- **Known simplifications, stated:** `weekdayCalendar` (no holidays) is a Phase-0 fallback only when no Alpaca keys exist; `getOrders` polling in `executeOrders` lists all orders rather than fetching one by id (adequate for paper volumes; `GET /v2/orders/{id}` is a Phase-1 refinement); `marketCapUsd` is read from the report's snapshot "Market Cap" cell and defaults to the mid bucket when absent.
- **Type consistency checked:** `SubmitOrderRequest.estNotionalUsd` (Task 9) is supplied from `OrderRequest.deltaUsd` (Task 6) in Task 11; `Classified` (Task 3) is what `TradePlan.classifications` (Task 5) and `RunRecord.classifications` (Task 8) carry; `scoreWeight`'s third argument (Task 4) is used in Task 5; `GuardContext.brokerKind` (Task 9) is set in Tasks 11–12.

<!-- END OF PLAN -->
