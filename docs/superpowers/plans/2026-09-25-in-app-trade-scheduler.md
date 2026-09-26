# In-App Trade Scheduler + Operable Container — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 09:45 ET trade trigger off the OS scheduler into the Next server process (`instrumentation.ts` → the existing `runCron`), and ship a full-app `trader` Docker image so the Unraid container also runs the `trade:*` CLI by hand.

**Architecture:** A new `lib/trade/runtime.ts` holds the broker/report wiring both the CLI and the server share. A pure `lib/trade/scheduler.ts` computes the next ET fire time and the boot catch-up decision; `startScheduler` arms an injected timer that calls `runCron`. `instrumentation.ts` arms it on boot, only when `TRADE_SCHEDULER_ENABLED=1`. A token-gated `GET /api/trade/status` exposes state. A `trader` Dockerfile stage packages the full app + `tsx` so the container is operable.

**Tech Stack:** TypeScript, Next.js 16 (`instrumentation.ts`, Route Handlers), Vitest, Zod, Docker. Time math uses `Intl.DateTimeFormat` (no external tz library).

**Spec:** `docs/superpowers/specs/2026-09-25-in-app-trade-scheduler-design.md`

## Global Constraints

- **Never edit `lib/trade/cron.ts` decision logic.** `runCron` is the fully-guarded orchestrator; the scheduler only *calls* it. (New optional plumbing is fine only if a task explicitly says so; this plan adds none.)
- **Two independent off-switches must remain:** `TRADE_SCHEDULER_ENABLED` (arm) is separate from `TRADE_DISABLED` (kill). Deploying code with neither set trades nothing.
- **Broker is env-driven:** `BROKER` defaults to `"alpaca-paper"`; `"schwab"` is LIVE. No task may hardcode a broker.
- **The web server must still serve `/research` even if the scheduler cannot arm** (missing broker keys, etc.). Scheduler wiring failures are caught and logged, never thrown out of `register()`.
- **ET wall-clock is `America/New_York`**, DST-aware; the default fire time is `cfg.cronTimeET` (`"09:45"`).
- **Data path:** all trade state lives under `data/trade/` (constants in `lib/trade/runtime.ts`); the new state file is `data/trade/scheduler-state.json`.
- **Tests:** colocated `*.test.ts`; run one file with `npx vitest run <path>`, the whole suite with `npm test`. No test may hit a live broker, the network, or Docker.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Branch is `trade-layer`.

---

### Task 1: Extract shared runtime wiring → `lib/trade/runtime.ts`

Move the broker/report/path wiring out of the CLI-only `scripts/_trade-common.ts` so the compiled Next server can import it. Broker builders **throw** on missing config (catchable by the server) instead of `process.exit`; the CLI keeps its clean-exit UX via a thin wrapper.

**Files:**
- Create: `lib/trade/runtime.ts`
- Create: `lib/trade/runtime.test.ts`
- Modify: `scripts/_trade-common.ts` (re-export from runtime; keep CLI-only helpers; wrap `makeBroker` for clean exit)

**Interfaces:**
- Consumes: `lib/broker/*` (`AlpacaPaperBroker`, `SchwabBroker`, `SchwabTokenStore`, `SCHWAB_HOST`, `BrokerAdapter`), `lib/reports`, `lib/facts/schema` (`FactPack`), `lib/trade/fills` (`readFills`), `lib/trade/run-record` (`RunRecord`).
- Produces (imported by later tasks and by `scripts/_trade-common.ts`):
  - Path consts: `TRADE_DIR, FILLS_PATH, LEDGER_PATH, RUNS_DIR, CRON_LOCK_PATH, CRON_LOG_PATH, HALT_STATE_PATH, SCHWAB_TOKEN_PATH: string`
  - `makeAlpaca(env?: NodeJS.ProcessEnv): BrokerAdapter` — throws `Error` if `APCA_*` missing
  - `makeBroker(env?: NodeJS.ProcessEnv): BrokerAdapter` — throws `Error` on missing/unknown config (no `process.exit`)
  - `brokerBaseUrl(adapter: BrokerAdapter): string`
  - `loadReportsAndMeta(): Promise<{ reports: Report[]; sics: Record<string, number|null>; marketCapUsd: Record<string, number|null> }>`
  - `readRunRecord(runId: string): RunRecord`
  - `latestRunRecord(): RunRecord | null`
  - re-export `readFills`

- [ ] **Step 1: Write the failing test**

Create `lib/trade/runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as runtime from "./runtime";

describe("lib/trade/runtime", () => {
  it("exposes the data/trade path constants", () => {
    expect(runtime.TRADE_DIR.replace(/\\/g, "/")).toBe("data/trade");
    expect(runtime.FILLS_PATH.replace(/\\/g, "/")).toBe("data/trade/fills.jsonl");
    expect(runtime.SCHWAB_TOKEN_PATH.replace(/\\/g, "/")).toBe("data/trade/schwab-token.json");
  });

  it("makeBroker THROWS (never process.exits) on missing Alpaca keys", () => {
    const env = { BROKER: "alpaca-paper" } as NodeJS.ProcessEnv; // no APCA_* keys
    expect(() => runtime.makeBroker(env)).toThrowError(/APCA_API_KEY_ID/);
  });

  it("makeBroker rejects an unknown broker", () => {
    expect(() => runtime.makeBroker({ BROKER: "etrade" } as NodeJS.ProcessEnv))
      .toThrowError(/not a known broker/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/trade/runtime.test.ts`
Expected: FAIL — `Cannot find module './runtime'`.

- [ ] **Step 3: Create `lib/trade/runtime.ts`**

Move the reusable bodies verbatim from `scripts/_trade-common.ts`, changing only: broker builders take `env = process.env` and **throw** instead of `process.exit`.

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { listReportTickers, loadReport } from "../reports";
import { FactPack } from "../facts/schema";
import type { Report } from "../report.schema";
import type { BrokerAdapter } from "../broker/adapter";
import { AlpacaPaperBroker } from "../broker/alpaca";
import { SchwabBroker } from "../broker/schwab";
import { SchwabTokenStore } from "../broker/schwab-auth";
import { SCHWAB_HOST } from "../broker/guards";
import { readFills } from "./fills";
import { RunRecord } from "./run-record";

export const TRADE_DIR = join("data", "trade");
export const FILLS_PATH = join(TRADE_DIR, "fills.jsonl");
export const LEDGER_PATH = join(TRADE_DIR, "ledger.json");
export const RUNS_DIR = join(TRADE_DIR, "runs");
export const CRON_LOCK_PATH = join(TRADE_DIR, "cron.lock");
export const CRON_LOG_PATH = join(TRADE_DIR, "cron.log");
export const HALT_STATE_PATH = join(TRADE_DIR, "halt-state.json");
export const SCHWAB_TOKEN_PATH = join(TRADE_DIR, "schwab-token.json");

export function makeAlpaca(env: NodeJS.ProcessEnv = process.env): BrokerAdapter {
  const keyId = env.APCA_API_KEY_ID, secretKey = env.APCA_API_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error("APCA_API_KEY_ID / APCA_API_SECRET_KEY are not set. Add them to .env.local (paper keys only).");
  return new AlpacaPaperBroker({ keyId, secretKey, baseUrl: env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets" });
}

/** Live broker chosen by BROKER: "alpaca-paper" (default paper) | "schwab" (LIVE). Throws on missing config. */
export function makeBroker(env: NodeJS.ProcessEnv = process.env): BrokerAdapter {
  const broker = env.BROKER ?? "alpaca-paper";
  if (broker === "alpaca-paper") return makeAlpaca(env);
  if (broker === "schwab") {
    const clientId = env.SCHWAB_CLIENT_ID, clientSecret = env.SCHWAB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("SCHWAB_CLIENT_ID / SCHWAB_CLIENT_SECRET are not set. Add them to .env.local (see .env.example).");
    const tokenStore = new SchwabTokenStore(SCHWAB_TOKEN_PATH);
    const tokens = tokenStore.read();
    if (!tokens?.accountHash) throw new Error("Schwab account not linked. Run: npm run trade:auth");
    return new SchwabBroker({ tokenStore, clientId, clientSecret, accountHash: tokens.accountHash });
  }
  throw new Error(`BROKER=${broker} is not a known broker (expected "alpaca-paper" or "schwab")`);
}

export function brokerBaseUrl(adapter: BrokerAdapter): string {
  if (adapter.kind === "schwab") return `https://${SCHWAB_HOST}`;
  if (adapter.kind === "alpaca-paper") return process.env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets";
  return "memory://";
}

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

export function readRunRecord(runId: string): RunRecord {
  return RunRecord.parse(JSON.parse(readFileSync(join(RUNS_DIR, `${runId}.json`), "utf8")));
}
export function latestRunRecord(): RunRecord | null {
  if (!existsSync(RUNS_DIR)) return null;
  const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;
  const latest = files.map((f) => ({ f, m: statSync(join(RUNS_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f;
  return RunRecord.parse(JSON.parse(readFileSync(join(RUNS_DIR, latest), "utf8")));
}
export { readFills };
```

Note: `AlpacaPaperBroker`'s constructor takes `{ keyId, secretKey, baseUrl }` — confirm the field names against `lib/broker/alpaca.ts` and match them exactly (the old `requireAlpaca()` returned that shape).

- [ ] **Step 4: Run the runtime test to verify it passes**

Run: `npx vitest run lib/trade/runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-wire `scripts/_trade-common.ts` to consume runtime**

Replace the moved bodies with re-exports; keep the CLI-only helpers (`flag`, `has`, `weekdayCalendar`, `yahooLastClose`, `makeFakeBroker`, `shift`); wrap `makeBroker`/`makeAlpaca` so the CLI still prints a clean message and exits 2 instead of throwing a stack. Keep the existing imports the CLI-only helpers still need (`fetchDailyCloses`, `FakeBroker`, `readLedger`, `BrokerCalendarDay`).

```ts
import type { BrokerAdapter } from "../lib/broker/adapter";
export {
  TRADE_DIR, FILLS_PATH, LEDGER_PATH, RUNS_DIR, CRON_LOCK_PATH, CRON_LOG_PATH,
  HALT_STATE_PATH, SCHWAB_TOKEN_PATH, brokerBaseUrl, loadReportsAndMeta,
  readRunRecord, latestRunRecord, readFills,
} from "../lib/trade/runtime";
import * as runtime from "../lib/trade/runtime";

export const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
export const has = (args: string[], name: string) => args.includes(name);

/** CLI wrappers: preserve the clean "message + exit 2" UX (runtime throws instead). */
export function makeAlpaca(): BrokerAdapter {
  try { return runtime.makeAlpaca(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
}
export function makeBroker(): BrokerAdapter {
  try { return runtime.makeBroker(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
}
// ... KEEP the existing weekdayCalendar, yahooLastClose, makeFakeBroker, shift bodies unchanged ...
```

(`makeFakeBroker` still uses `runtime.LEDGER_PATH` via the re-export and its own `AlpacaPaperBroker`/`requireAlpaca` path — leave that Phase-0 helper exactly as it was, importing what it already imports.)

- [ ] **Step 6: Run the full suite to verify nothing regressed**

Run: `npm test`
Expected: PASS — the cron/e2e/audit suites import these helpers through `_trade-common` and must stay green.

- [ ] **Step 7: Commit**

```bash
git add lib/trade/runtime.ts lib/trade/runtime.test.ts scripts/_trade-common.ts
git commit -m "$(printf 'refactor(trade): extract shared broker/report wiring to lib/trade/runtime\n\nCLI keeps clean-exit UX; server can now import broker selection.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Scheduler pure core — time + decisions (`lib/trade/scheduler.ts`)

Pure, dependency-free functions: the next ET fire instant (DST + holiday aware), the boot catch-up decision, and the arm decision.

**Files:**
- Create: `lib/trade/scheduler.ts`
- Create: `lib/trade/scheduler.test.ts`

**Interfaces:**
- Consumes: `lib/trade/nyse-calendar` (`nyseTradingDays`, `COVERAGE_START`, `COVERAGE_END`), `lib/trade/calendar` (`isTradingDay`).
- Produces:
  - `nextRunAtET(nowMs: number, hhmm: string): number` — epoch-ms of the next `hhmm` America/New_York wall-clock that is strictly after `nowMs` and falls on an NYSE trading day.
  - `etDateString(ms: number): string` — the `YYYY-MM-DD` ET calendar date of an instant.
  - `shouldCatchUp(a: { lastFiredDay: string | null; todayET: string; marketOpen: boolean }): boolean`
  - `shouldArm(env: NodeJS.ProcessEnv): boolean`

- [ ] **Step 1: Write the failing tests**

Create `lib/trade/scheduler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextRunAtET, etDateString, shouldCatchUp, shouldArm } from "./scheduler";

// 09:45 EDT (UTC-4) = 13:45Z ; 09:45 EST (UTC-5) = 14:45Z
describe("nextRunAtET", () => {
  it("returns today's 09:45 ET when now is before it (EDT summer day)", () => {
    const now = Date.parse("2026-07-01T12:00:00Z"); // 08:00 ET, a Wednesday
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-07-01T13:45:00.000Z");
  });
  it("rolls to the next day when now is past 09:45 ET", () => {
    const now = Date.parse("2026-07-01T18:00:00Z"); // 14:00 ET Wed
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-07-02T13:45:00.000Z");
  });
  it("skips the weekend: Friday afternoon → Monday 09:45 ET", () => {
    const now = Date.parse("2026-07-03T18:00:00Z"); // Fri 14:00 ET
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-07-06T13:45:00.000Z"); // Mon
  });
  it("skips an NYSE holiday (Jan 1) to the next trading day", () => {
    const now = Date.parse("2027-01-01T05:00:00Z"); // very early Jan 1 (holiday)
    // Jan 1 2027 is a Friday holiday → next trading day Mon Jan 4, 09:45 EST = 14:45Z
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2027-01-04T14:45:00.000Z");
  });
  it("uses EST offset in winter (14:45Z)", () => {
    const now = Date.parse("2026-12-02T05:00:00Z"); // Wed, winter
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2026-12-02T14:45:00.000Z");
  });
  it("handles the spring-forward morning (2027-03-14 is a Sunday → Mon 15th EDT)", () => {
    const now = Date.parse("2027-03-13T20:00:00Z"); // Sat
    expect(new Date(nextRunAtET(now, "09:45")).toISOString()).toBe("2027-03-15T13:45:00.000Z"); // Mon, now EDT
  });
});

describe("etDateString", () => {
  it("gives the ET calendar date, not UTC", () => {
    expect(etDateString(Date.parse("2026-07-02T02:00:00Z"))).toBe("2026-07-01"); // 22:00 ET prev day
  });
});

describe("shouldCatchUp", () => {
  it("runs now when not yet fired today and the market is open", () => {
    expect(shouldCatchUp({ lastFiredDay: "2026-06-30", todayET: "2026-07-01", marketOpen: true })).toBe(true);
  });
  it("does not run when already fired today", () => {
    expect(shouldCatchUp({ lastFiredDay: "2026-07-01", todayET: "2026-07-01", marketOpen: true })).toBe(false);
  });
  it("does not run when the market is closed", () => {
    expect(shouldCatchUp({ lastFiredDay: null, todayET: "2026-07-01", marketOpen: false })).toBe(false);
  });
});

describe("shouldArm", () => {
  it("arms only in the node runtime with the flag on", () => {
    expect(shouldArm({ NEXT_RUNTIME: "nodejs", TRADE_SCHEDULER_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldArm({ NEXT_RUNTIME: "edge", TRADE_SCHEDULER_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldArm({ NEXT_RUNTIME: "nodejs" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/trade/scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/trade/scheduler.ts` (pure section)**

```ts
import { nyseTradingDays, COVERAGE_START, COVERAGE_END } from "./nyse-calendar";
import { isTradingDay } from "./calendar";

const TZ = "America/New_York";
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function partsInTZ(ms: number) {
  const p = Object.fromEntries(FMT.formatToParts(ms).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
/** offset (ms) such that etWallClockAsUTC - actualUTC. */
function tzOffsetMs(ms: number): number {
  const p = partsInTZ(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms;
}
/** The UTC instant whose America/New_York wall clock is exactly Y-M-D h:mi (DST-correct). */
function etWallToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - tzOffsetMs(naive);      // first correction
  utc = naive - tzOffsetMs(utc);            // refine at the candidate instant (handles DST edges)
  return utc;
}

export function etDateString(ms: number): string {
  const p = partsInTZ(ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const TRADING_DAYS = nyseTradingDays(COVERAGE_START, COVERAGE_END).map((d) => d.date);

export function nextRunAtET(nowMs: number, hhmm: string): number {
  const [h, mi] = hhmm.split(":").map(Number);
  // Start from today's ET date, walk forward day by day until the fire instant is strictly future AND a trading day.
  let cursor = etDateString(nowMs);
  for (let i = 0; i < 400; i++) {
    const [y, mo, d] = cursor.split("-").map(Number);
    const fire = etWallToUtc(y, mo, d, h, mi);
    if (fire > nowMs && isTradingDay(TRADING_DAYS, cursor)) return fire;
    // advance one calendar day (ET) — build the next date from a noon-UTC step to avoid DST edges
    cursor = etDateString(Date.parse(`${cursor}T12:00:00Z`) + 86_400_000);
  }
  throw new Error(`nextRunAtET: no trading day found within 400 days of ${cursor}`);
}

export function shouldCatchUp(a: { lastFiredDay: string | null; todayET: string; marketOpen: boolean }): boolean {
  return a.marketOpen && a.lastFiredDay !== a.todayET;
}

export function shouldArm(env: NodeJS.ProcessEnv): boolean {
  return env.NEXT_RUNTIME === "nodejs" && env.TRADE_SCHEDULER_ENABLED === "1";
}
```

Confirm `nyse-calendar` covers the test years (`COVERAGE_END = "2028-12-31"` per the spec inventory, so 2027 dates resolve). If `isTradingDay`'s signature differs, adapt the call — it takes `(days: string[], d: string)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/trade/scheduler.test.ts`
Expected: PASS (all cases, including DST and the Jan-1 holiday skip). If a holiday date is off, verify the expected date against `nyseTradingDays` output rather than loosening the test.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/scheduler.ts lib/trade/scheduler.test.ts
git commit -m "$(printf 'feat(trade): scheduler time core (next ET fire, DST + holiday aware)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Scheduler stateful runtime — state, status, `startScheduler`

Add the persisted `lastFiredDay`, the in-memory status singleton, and `startScheduler` with an injected timer/clock so it is deterministically testable.

**Files:**
- Modify: `lib/trade/scheduler.ts`
- Modify: `lib/trade/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 2's `nextRunAtET`, `etDateString`, `shouldCatchUp`; Task 1's `latestRunRecord`, path consts (`TRADE_DIR`).
- Produces:
  - `readSchedulerState(dir?: string): { lastFiredDay: string | null }`
  - `writeSchedulerState(s: { lastFiredDay: string | null }, dir?: string): void`
  - `getSchedulerStatus(env?: NodeJS.ProcessEnv): SchedulerStatus`
  - `interface SchedulerDeps { runOnce, marketOpenNow, cfg, broker, env, now, setTimer }`
  - `startScheduler(deps: SchedulerDeps): { stop: () => void }`
  - `type SchedulerStatus = { armed: boolean; broker: string; tradeDisabled: boolean; nextRunISO: string | null; lastRun: { id: string | null; day: string | null; at: string | null; status: string; orders?: number; fills?: number } | null }`

- [ ] **Step 1: Write the failing tests** (append to `scheduler.test.ts`)

```ts
import { startScheduler, getSchedulerStatus, readSchedulerState, writeSchedulerState } from "./scheduler";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fakeTimer() {
  let fn: (() => void) | null = null;
  return {
    setTimer: (f: () => void, _ms: number) => { fn = f; return { clear: () => { fn = null; } }; },
    fire: () => { const f = fn; fn = null; f?.(); },
    pending: () => fn !== null,
  };
}

describe("startScheduler", () => {
  it("catches up on boot when the market is open and not fired today, then arms", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    const timer = fakeTimer();
    const runOnce = vi.fn(async () => ({ status: "executed", orders: 2, fills: 2 }));
    const s = startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"), // 10:00 ET, market open, past 09:45
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); await Promise.resolve(); // let the async boot settle
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(readSchedulerState(dir).lastFiredDay).toBe("2026-07-01");
    expect(timer.pending()).toBe(true); // armed for the next day
    s.stop();
    expect(timer.pending()).toBe(false);
  });

  it("does not catch up when already fired today; just arms", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-"));
    writeSchedulerState({ lastFiredDay: "2026-07-01" }, dir);
    const timer = fakeTimer();
    const runOnce = vi.fn(async () => ({ status: "noop" }));
    startScheduler({
      runOnce, marketOpenNow: async () => true,
      cfg: { cronTimeET: "09:45" } as any, broker: "alpaca-paper", env: {} as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-07-01T14:00:00Z"),
      setTimer: timer.setTimer, stateDir: dir,
    });
    await Promise.resolve(); await Promise.resolve();
    expect(runOnce).not.toHaveBeenCalled();
    expect(timer.pending()).toBe(true);
  });
});

describe("getSchedulerStatus", () => {
  it("reports broker + kill-switch from env when disarmed", () => {
    const st = getSchedulerStatus({ BROKER: "schwab", TRADE_DISABLED: "1" } as NodeJS.ProcessEnv);
    expect(st.broker).toBe("schwab");
    expect(st.tradeDisabled).toBe(true);
  });
});
```

Add `import { vi } from "vitest";` to the test file's imports.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/trade/scheduler.test.ts`
Expected: FAIL — `startScheduler`/`getSchedulerStatus` not exported.

- [ ] **Step 3: Implement the stateful section** (append to `lib/trade/scheduler.ts`)

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TradeConfig } from "./config";
import { TRADE_DIR, latestRunRecord } from "./runtime";
import type { CronResult } from "./cron";

const STATE_FILE = (dir: string) => join(dir, "scheduler-state.json");

export function readSchedulerState(dir: string = TRADE_DIR): { lastFiredDay: string | null } {
  const p = STATE_FILE(dir);
  if (!existsSync(p)) return { lastFiredDay: null };
  try { return { lastFiredDay: JSON.parse(readFileSync(p, "utf8")).lastFiredDay ?? null }; }
  catch { return { lastFiredDay: null }; }
}
export function writeSchedulerState(s: { lastFiredDay: string | null }, dir: string = TRADE_DIR): void {
  const p = STATE_FILE(dir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
}

export interface SchedulerStatus {
  armed: boolean; broker: string; tradeDisabled: boolean; nextRunISO: string | null;
  lastRun: { id: string | null; day: string | null; at: string | null; status: string; orders?: number; fills?: number } | null;
}
let _armed = false;
let _nextRunISO: string | null = null;
let _lastFire: { at: string; status: string; orders?: number; fills?: number } | null = null;

export function getSchedulerStatus(env: NodeJS.ProcessEnv = process.env): SchedulerStatus {
  const rec = latestRunRecord();
  const lastRun = _lastFire || rec
    ? {
        id: rec?.runId ?? null, day: rec?.today ?? null, at: _lastFire?.at ?? null,
        status: _lastFire?.status ?? "unknown",
        orders: _lastFire?.orders ?? rec?.orders.length, fills: _lastFire?.fills ?? rec?.fills.length,
      }
    : null;
  return {
    armed: _armed, broker: env.BROKER ?? "alpaca-paper", tradeDisabled: env.TRADE_DISABLED === "1",
    nextRunISO: _nextRunISO, lastRun,
  };
}

export interface SchedulerDeps {
  runOnce: () => Promise<CronResult>;
  marketOpenNow: () => Promise<boolean>;
  cfg: Pick<TradeConfig, "cronTimeET">;
  broker: string;
  env: NodeJS.ProcessEnv;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { clear: () => void };
  stateDir?: string;
}

export function startScheduler(deps: SchedulerDeps): { stop: () => void } {
  const dir = deps.stateDir ?? TRADE_DIR;
  let handle: { clear: () => void } | null = null;

  const fire = async () => {
    const result = await deps.runOnce();
    _lastFire = { at: new Date(deps.now()).toISOString(), status: result.status, orders: result.orders, fills: result.fills };
    writeSchedulerState({ lastFiredDay: etDateString(deps.now()) }, dir);
    arm(); // re-arm for the next day
  };
  const arm = () => {
    const at = nextRunAtET(deps.now(), deps.cfg.cronTimeET);
    _nextRunISO = new Date(at).toISOString();
    handle = deps.setTimer(() => { void fire(); }, Math.max(0, at - deps.now()));
  };

  _armed = true;
  void (async () => {
    const st = readSchedulerState(dir);
    const todayET = etDateString(deps.now());
    if (shouldCatchUp({ lastFiredDay: st.lastFiredDay, todayET, marketOpen: await deps.marketOpenNow() })) {
      await fire();          // fire() re-arms
    } else {
      arm();
    }
  })();

  return { stop: () => { handle?.clear(); handle = null; _armed = false; _nextRunISO = null; } };
}
```

Note the module-level singletons (`_armed`, `_nextRunISO`, `_lastFire`) are what the status route reads — same process as `instrumentation.ts`. `cfg` is narrowed to `Pick<TradeConfig,"cronTimeET">` so tests pass a stub.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/trade/scheduler.test.ts`
Expected: PASS. Then `npm test` to confirm no regression from the new `runtime`/`cron` imports.

- [ ] **Step 5: Commit**

```bash
git add lib/trade/scheduler.ts lib/trade/scheduler.test.ts
git commit -m "$(printf 'feat(trade): scheduler state, status singleton, startScheduler\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Scheduler wiring — `buildSchedulerDeps` (`lib/trade/scheduler-wiring.ts`)

Assemble the real `SchedulerDeps` for production: `runOnce` mirrors `scripts/trade-cron.ts`'s `main()` (build broker, assemble `CronDeps`, call `runCron`), honoring `TRADE_DISABLED` with the unreachable adapter so it needs no broker keys when disabled.

**Files:**
- Create: `lib/trade/scheduler-wiring.ts`
- Create: `lib/trade/scheduler-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 `runtime` (`makeBroker`, `brokerBaseUrl`, `loadReportsAndMeta`, `readFills`, path consts), `lib/trade/cron` (`runCron`), `lib/trade/config` (`resolveTradeConfig`), `lib/trade/run-record` (`newRunId`), `lib/trade/notify` (`makeNotifier`), `lib/broker/adapter` (`BrokerAdapter`).
- Produces:
  - `buildSchedulerDeps(env?: NodeJS.ProcessEnv): SchedulerDeps` (a real timer via `setTimeout`, `now: Date.now`).
  - re-export `getSchedulerStatus`, `startScheduler` from `./scheduler` (so `instrumentation.ts` imports one module).

- [ ] **Step 1: Write the failing test**

Create `lib/trade/scheduler-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSchedulerDeps } from "./scheduler-wiring";

describe("buildSchedulerDeps", () => {
  it("with TRADE_DISABLED=1, runOnce returns 'disabled' and needs no broker keys", async () => {
    const deps = buildSchedulerDeps({ TRADE_DISABLED: "1", BROKER: "alpaca-paper" } as NodeJS.ProcessEnv);
    expect(deps.broker).toBe("alpaca-paper");
    expect(typeof deps.now()).toBe("number");
    const result = await deps.runOnce();
    expect(result.status).toBe("disabled"); // runCron short-circuits on disabled before any adapter call
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/trade/scheduler-wiring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/trade/scheduler-wiring.ts`**

Copy the `unreachableAdapter` + dep assembly from `scripts/trade-cron.ts` (do not re-invent it — same shape), minus the `process.exit` mapping.

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runCron, type CronResult } from "./cron";
import { resolveTradeConfig } from "./config";
import { newRunId } from "./run-record";
import { makeNotifier } from "./notify";
import type { BrokerAdapter } from "../broker/adapter";
import {
  makeBroker, brokerBaseUrl, loadReportsAndMeta, readFills,
  CRON_LOCK_PATH, CRON_LOG_PATH, FILLS_PATH, HALT_STATE_PATH, RUNS_DIR,
} from "./runtime";
import { startScheduler, getSchedulerStatus, type SchedulerDeps } from "./scheduler";
export { startScheduler, getSchedulerStatus };

function unreachableAdapter(): BrokerAdapter {
  const fail = (): never => { throw new Error("scheduler: adapter invoked while TRADE_DISABLED=1 — unreachable."); };
  return { kind: "fake", getClock: fail, getCalendar: fail, getAccount: fail, getPositions: fail, getOrders: fail,
    getLastClose: fail, getLatestTrade: fail, getLatestQuote: fail, isFractionable: fail, submitOrder: fail, cancelOrder: fail } as unknown as BrokerAdapter;
}

export function buildSchedulerDeps(env: NodeJS.ProcessEnv = process.env): SchedulerDeps {
  const cfg = resolveTradeConfig();
  const broker = env.BROKER ?? "alpaca-paper";
  const disabled = env.TRADE_DISABLED === "1";
  const notifier = makeNotifier({
    webhookUrl: env.DISCORD_WEBHOOK_URL,
    onLog: (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      mkdirSync(dirname(CRON_LOG_PATH), { recursive: true });
      appendFileSync(CRON_LOG_PATH, line + "\n");
      console.error(line);
    },
  });

  // Lazily build the adapter per fire so a token refreshed between runs is picked up.
  const runOnce = async (): Promise<CronResult> => {
    const adapter = disabled ? unreachableAdapter() : makeBroker(env);
    const configuredBaseUrl = disabled ? "" : brokerBaseUrl(adapter);
    const today = new Date().toISOString().slice(0, 10);
    const result = await runCron({
      adapter, cfg, today, nowMs: Date.now(), runId: newRunId(today), configuredBaseUrl,
      paths: { lock: CRON_LOCK_PATH, haltState: HALT_STATE_PATH, log: CRON_LOG_PATH, fills: FILLS_PATH, runs: RUNS_DIR },
      loadInputs: async () => { const m = await loadReportsAndMeta(); return { ...m, fills: readFills(FILLS_PATH) }; },
      notify: notifier.message, notifySummary: notifier.runSummary, disabled, env,
    });
    await notifier.flush();
    return result;
  };

  const marketOpenNow = async (): Promise<boolean> => {
    if (disabled) return false;
    try { return (await makeBroker(env).getClock()).isOpen; } catch { return false; }
  };

  return { runOnce, marketOpenNow, cfg, broker, env, now: () => Date.now(),
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return { clear: () => clearTimeout(t) }; } };
}
```

Confirm `makeNotifier`'s option names (`webhookUrl`, `onLog`) and `runCron`'s `CronDeps` field names against the current sources — they must match `scripts/trade-cron.ts` exactly.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/trade/scheduler-wiring.test.ts`
Expected: PASS (the disabled path calls `runCron`, which returns `{status:"disabled"}` before touching the adapter).

- [ ] **Step 5: Commit**

```bash
git add lib/trade/scheduler-wiring.ts lib/trade/scheduler-wiring.test.ts
git commit -m "$(printf 'feat(trade): buildSchedulerDeps — real runOnce wiring over runCron\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Boot hook — `instrumentation.ts`

Arm the scheduler once on server boot, only when `shouldArm(env)`, and never let a wiring failure crash the web server.

**Files:**
- Create: `instrumentation.ts` (repo root — Next 16's boot hook)
- Create: `instrumentation.test.ts`

**Interfaces:**
- Consumes: `lib/trade/scheduler` (`shouldArm`), `lib/trade/scheduler-wiring` (`buildSchedulerDeps`, `startScheduler`, `getSchedulerStatus`).
- Produces: `export async function register(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `instrumentation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { register } from "./instrumentation";

describe("instrumentation.register", () => {
  it("is a no-op (no throw) when the scheduler flag is off", async () => {
    const prev = { ...process.env };
    process.env.NEXT_RUNTIME = "nodejs"; delete process.env.TRADE_SCHEDULER_ENABLED;
    await expect(register()).resolves.toBeUndefined();
    Object.assign(process.env, prev);
  });
  it("is a no-op on the edge runtime", async () => {
    const prev = { ...process.env };
    process.env.NEXT_RUNTIME = "edge"; process.env.TRADE_SCHEDULER_ENABLED = "1";
    await expect(register()).resolves.toBeUndefined();
    Object.assign(process.env, prev);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run instrumentation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `instrumentation.ts`**

```ts
import { shouldArm } from "./lib/trade/scheduler";

export async function register(): Promise<void> {
  if (!shouldArm(process.env)) {
    if (process.env.NEXT_RUNTIME === "nodejs") console.log("[scheduler] disabled (set TRADE_SCHEDULER_ENABLED=1 to arm)");
    return;
  }
  try {
    const { buildSchedulerDeps, startScheduler, getSchedulerStatus } = await import("./lib/trade/scheduler-wiring");
    const { stop } = startScheduler(buildSchedulerDeps(process.env));
    for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, stop);
    const s = getSchedulerStatus();
    console.log(`[scheduler] armed, broker=${s.broker}, next=${s.nextRunISO}`);
  } catch (e) {
    // Never take the web server down because the trader couldn't arm (e.g. missing broker keys).
    console.error(`[scheduler] failed to arm — serving pages without it: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run instrumentation.test.ts`
Expected: PASS (both no-op paths return without arming or throwing).

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts instrumentation.test.ts
git commit -m "$(printf 'feat(app): arm the in-process trade scheduler on server boot\n\nGated by TRADE_SCHEDULER_ENABLED; arm failures never crash the web server.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Status route — `app/api/trade/status/route.ts`

A read-only, token-gated JSON endpoint over `getSchedulerStatus()`.

**Files:**
- Create: `app/api/trade/status/route.ts`
- Create: `app/api/trade/status/route.test.ts`

**Interfaces:**
- Consumes: `lib/trade/scheduler` (`getSchedulerStatus`).
- Produces: `export async function GET(req: Request): Promise<Response>`, plus `export const runtime`, `export const dynamic`.

- [ ] **Step 1: Write the failing test**

Create `app/api/trade/status/route.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { GET } from "./route";

const prev = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k]; Object.assign(process.env, prev); });

describe("GET /api/trade/status", () => {
  it("503 when no token is configured", async () => {
    delete process.env.TRADE_STATUS_TOKEN;
    expect((await GET(new Request("http://x/api/trade/status"))).status).toBe(503);
  });
  it("401 on a wrong/absent bearer token", async () => {
    process.env.TRADE_STATUS_TOKEN = "sekret";
    expect((await GET(new Request("http://x/api/trade/status"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/trade/status", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });
  it("200 with the status shape on the right token", async () => {
    process.env.TRADE_STATUS_TOKEN = "sekret"; process.env.BROKER = "alpaca-paper";
    const res = await GET(new Request("http://x/api/trade/status", { headers: { authorization: "Bearer sekret" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("armed");
    expect(body.broker).toBe("alpaca-paper");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/trade/status/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/api/trade/status/route.ts`**

```ts
import { getSchedulerStatus } from "../../../../lib/trade/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // read state each call; never cache

export async function GET(req: Request): Promise<Response> {
  const token = process.env.TRADE_STATUS_TOKEN;
  if (!token) return Response.json({ error: "status route not configured (set TRADE_STATUS_TOKEN)" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
  return Response.json(getSchedulerStatus());
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/trade/status/route.test.ts`
Expected: PASS. Then `npm test` for the whole suite.

- [ ] **Step 5: Commit**

```bash
git add app/api/trade/status/route.ts app/api/trade/status/route.test.ts
git commit -m "$(printf 'feat(app): token-gated GET /api/trade/status\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Operable container — `trader` Docker stage, compose, env, docs

Add a full-app image stage so the Unraid container serves the site, arms the scheduler, and runs the `trade:*` CLI; wire secrets, the writable volume, and the new env vars.

**Files:**
- Modify: `Dockerfile` (add a `trader` stage after `runner`)
- Modify: `docker-compose.yml` (target `trader`, add `env_file`, the `data/trade` volume)
- Modify: `.env.example` (add `TRADE_SCHEDULER_ENABLED`, `TRADE_STATUS_TOKEN`)
- Modify: `README.Docker.md` (operating the trader in-container)

**Interfaces:** none (build/config/docs only).

- [ ] **Step 1: Add the `trader` stage to `Dockerfile`** (append after the `runner` stage; reuse the existing `deps`/`build` stages)

```dockerfile
# --- trader: full app image so the container both serves the site (arming the in-process
#     scheduler via instrumentation.ts) AND runs the trade:* CLI by hand (docker exec). ---
FROM node:24-alpine AS trader
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Full dependency set (INCLUDING tsx) — the trade:* npm scripts run under `node --import tsx`.
COPY --from=deps /app/node_modules ./node_modules
# The full app: scripts/, lib/, package.json (the trade:* scripts), data/*.json reports, next build output source.
COPY . .
RUN npm run build \
 && addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs \
 && mkdir -p data/trade && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 2: Verify the image builds** (manual — Docker is not in the Vitest suite)

Run: `docker build --target trader -t juniresearch-trader .`
Expected: builds successfully. Then a CLI smoke (no keys needed for the disabled kill-switch path):

Run: `docker run --rm -e TRADE_DISABLED=1 juniresearch-trader npm run trade:reconcile`
Expected: it reaches the app (a clear broker/keys or reconcile message), NOT `ENOENT: /package.json`. (This proves the CLI is present in the image — the original bug.)

If Docker is unavailable in this environment, note that and defer this step to the Unraid host during rollout; do not fake the output.

- [ ] **Step 3: Update `docker-compose.yml`**

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
      target: trader           # full app: site + in-process scheduler + operable trade CLI
    image: juniresearch-trader
    ports:
      - "58472:3000"
    env_file: .env.local        # BROKER, APCA_*/SCHWAB_*, TRADE_SCHEDULER_ENABLED, TRADE_STATUS_TOKEN, DISCORD_WEBHOOK_URL, TRADE_DISABLED?
    volumes:
      - ./data/trade:/app/data/trade   # persist fills.jsonl (compliance ledger) + schwab-token.json across rebuilds
    restart: unless-stopped
```

- [ ] **Step 4: Update `.env.example`** — append:

```bash
# In-app scheduler (instrumentation.ts). Unset → the container serves pages but never trades.
# Separate from TRADE_DISABLED so deploying the code never auto-arms trading.
# TRADE_SCHEDULER_ENABLED=1

# Bearer token for GET /api/trade/status (read-only status). Unset → the route returns 503.
# TRADE_STATUS_TOKEN=change-me
```

- [ ] **Step 5: Update `README.Docker.md`** — add an "Operating the trader" section covering:
  - The deployed service now uses the `trader` target; the lean `runner` (standalone, secretless) stage remains for a site-only deploy (`docker build --target runner`).
  - Arm trading: set `BROKER`, `TRADE_SCHEDULER_ENABLED=1` (and broker keys) in `.env.local`, then `docker compose up -d --build`.
  - Run the CLI in-container: `docker exec -it <service> npm run trade:reconcile` (also `trade:plan`, `trade:audit`, `trade:execute`).
  - **Schwab:** `docker exec -it <service> npm run trade:auth` writes the token to the mounted `data/trade` volume; re-run weekly when the 7-day refresh token expires.
  - Check status: `curl -H "Authorization: Bearer $TRADE_STATUS_TOKEN" http://<host>:58472/api/trade/status`.
  - The `./data/trade` host dir must be writable by uid 1001.

- [ ] **Step 6: Run the full suite one last time**

Run: `npm test`
Expected: PASS (Docker/docs changes don't affect tests; this confirms Tasks 1–6 are still green together).

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example README.Docker.md
git commit -m "$(printf 'feat(docker): full-app trader image + compose secrets/volume\n\nContainer serves the site, arms the in-process scheduler, and runs the\ntrade:* CLI via docker exec. Adds TRADE_SCHEDULER_ENABLED + TRADE_STATUS_TOKEN.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- §1 runtime extraction → Task 1. ✓
- §2 scheduler core (`nextRunAtET`, `shouldCatchUp`, state, status, `startScheduler`) → Tasks 2–3. ✓
- §3 `instrumentation.ts` + enable flag + arm-failure isolation → Task 5 (+ `shouldArm` in Task 2, wiring in Task 4). ✓
- §4 status route (503/401/200, nodejs+dynamic) → Task 6. ✓
- §5 `trader` image, compose env_file + volume, Schwab in-container auth → Task 7. ✓
- §6 `.env.example` additions → Task 7 Step 4. ✓
- Testing (DST, weekend/holiday, catch-up truth table, route auth, extraction stays green) → Tasks 2, 3, 6. ✓
- Rollout is operational (Task 7 docs + the gated flag); no code task needed beyond the flag default (off). ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code. The one judgement call left to the implementer (verify `AlpacaPaperBroker`/`makeNotifier`/`CronDeps` field names against current sources) is a verification instruction, not a placeholder — the code shown matches `scripts/trade-cron.ts` and the old `_trade-common.ts` verbatim.

**Type consistency:** `SchedulerDeps` (Task 3) is consumed unchanged by `buildSchedulerDeps` (Task 4) and `startScheduler` (Task 3). `getSchedulerStatus`/`SchedulerStatus` names match across Tasks 3, 4, 6. `shouldArm` defined in Task 2, used in Task 5. `runOnce: () => Promise<CronResult>` consistent in Tasks 3–4. `stateDir` is an optional `SchedulerDeps` field (Task 3 impl + tests); `buildSchedulerDeps` omits it (defaults to `TRADE_DIR`). Consistent.
