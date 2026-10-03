import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DEFAULT_TRADE_CONFIG, resolveTradeConfig, bucketFor, tradeConfigFromEnv } from "./config";

describe("resolveTradeConfig", () => {
  it("returns the spec §12 defaults when given no overrides", () => {
    const cfg = resolveTradeConfig();
    expect(cfg.muEnter).toBe(0.08);
    expect(cfg.muExit).toBe(0.03);
    expect(cfg.rEnter).toBe(0.6);
    expect(cfg.rExit).toBe(0.35);
    expect(cfg.lockBusinessDays).toBe(5);
    expect(cfg.markMode).toBe("live"); // 2026-10: decide at 15:10 on live prices (was "settled")
    // inherits the portfolio config it extends
    expect(cfg.wMax).toBe(DEFAULT_TRADE_CONFIG.wMax);
  });

  it("merges valid overrides over the defaults without throwing", () => {
    const cfg = resolveTradeConfig({ lockBusinessDays: 5, tradeBand: 0.05 });
    expect(cfg.lockBusinessDays).toBe(5);
    expect(cfg.tradeBand).toBe(0.05);
    expect(cfg.rEnter).toBe(0.6); // untouched fields keep their default
  });

  it("rejects an inverted reward/risk band (rExit must sit below rEnter)", () => {
    expect(() => resolveTradeConfig({ rExit: 0.6 })).toThrow(/rExit/);   // equal is not below
    expect(() => resolveTradeConfig({ rExit: 0.7 })).toThrow(/rExit/);
  });

  it("rejects an inverted upside band (muExit must sit below muEnter)", () => {
    expect(() => resolveTradeConfig({ muExit: 0.08 })).toThrow(/muExit/); // equal is not below
    expect(() => resolveTradeConfig({ muExit: 0.1 })).toThrow(/muExit/);
  });

  it("rejects a non-positive or non-integer lockBusinessDays", () => {
    expect(() => resolveTradeConfig({ lockBusinessDays: 0 })).toThrow(/positive integer/);
    expect(() => resolveTradeConfig({ lockBusinessDays: -1 })).toThrow(/positive integer/);
    expect(() => resolveTradeConfig({ lockBusinessDays: 2.5 })).toThrow(/positive integer/);
  });
  it("rejects a sizing bear floor outside [0, 1)", () => {
    expect(() => resolveTradeConfig({ bearFloor: -0.01 })).toThrow(/bearFloor/);
    expect(() => resolveTradeConfig({ bearFloor: 1 })).toThrow(/bearFloor/);
    expect(resolveTradeConfig({ bearFloor: 0 }).bearFloor).toBe(0);
  });
});

describe("daily turnover cap config", () => {
  it("defaults to 25% and must sit between the per-run cap and 100%", () => {
    expect(resolveTradeConfig().maxDayTurnoverFrac).toBe(0.25);
    expect(() => resolveTradeConfig({ maxDayTurnoverFrac: 0.1 })).toThrow(/maxDayTurnoverFrac/);
    expect(() => resolveTradeConfig({ maxDayTurnoverFrac: 1.5 })).toThrow(/maxDayTurnoverFrac/);
  });
});

describe("daily slots config", () => {
  it("defaults to one late-day slot and keeps cronTimeET as the first slot", () => {
    expect(resolveTradeConfig()).toMatchObject({ cronTimeET: "15:10", cronTimesET: ["15:10"], submitCutoffET: "15:50", maxLateMin: 20 });
    expect(resolveTradeConfig({ cronTimeET: "09:50" }).cronTimesET).toEqual(["09:50"]);
    expect(resolveTradeConfig({ cronTimesET: ["09:45", "10:40"] }).cronTimeET).toBe("09:45");
  });
  it("rejects unsorted, duplicate, malformed, empty or too many slots", () => {
    for (const cronTimesET of [["10:40", "09:45"], ["09:45", "09:45"], ["9:45"], [], ["09:40", "10:00", "11:00", "12:00", "13:00"]]) {
      expect(() => resolveTradeConfig({ cronTimesET })).toThrow();
    }
  });
});

describe("submit cutoff config (submitCutoffET)", () => {
  it("must be a valid HH:MM before the 16:00 close", () => {
    expect(() => resolveTradeConfig({ submitCutoffET: "3:50" })).toThrow(/HH:MM/);
    expect(() => resolveTradeConfig({ submitCutoffET: "15:60" })).toThrow(/HH:MM/);
    expect(() => resolveTradeConfig({ submitCutoffET: "16:00" })).toThrow(/before the 16:00 ET close/);
    expect(() => resolveTradeConfig({ submitCutoffET: "17:00" })).toThrow(/before the 16:00 ET close/);
    expect(resolveTradeConfig({ submitCutoffET: "15:59" }).submitCutoffET).toBe("15:59");
  });
  it("must fall after every fire slot", () => {
    expect(() => resolveTradeConfig({ submitCutoffET: "15:10" })).toThrow(/after every cronTimesET slot \(last: 15:10\)/); // equal is not after
    expect(() => resolveTradeConfig({ submitCutoffET: "15:00" })).toThrow(/after every cronTimesET slot/);
    expect(() => resolveTradeConfig({ cronTimesET: ["15:10", "15:50"] })).toThrow(/last: 15:50/);
    expect(() => resolveTradeConfig({ cronTimeET: "15:55" })).toThrow(/submitCutoffET/);
    expect(resolveTradeConfig({ cronTimesET: ["09:45", "15:10", "15:45"] }).cronTimesET).toEqual(["09:45", "15:10", "15:45"]);
    expect(resolveTradeConfig({ cronTimesET: ["09:45"], markMode: "settled" })).toMatchObject({ cronTimeET: "09:45", markMode: "settled" }); // the documented revert
  });
});

describe("register-trade-cron scripts read the fire slots from config.ts", () => {
  // The .sh/.ps1 grep config.ts for the first `cronTimesET: [...]` literal; these are the same regexes
  // (asserted against the scripts' own text), so a comment or reformat that breaks the grep fails here.
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const config = read("lib/trade/config.ts");
  it("register-trade-cron.sh gets [\"15:10\"]", () => {
    expect(read("scripts/register-trade-cron.sh")).toContain("grep -oE 'cronTimesET: \\[[^]]*\\]'"); // POSIX ERE: [^]] = not ']'
    const first = config.match(/cronTimesET: \[[^\]]*\]/)?.[0] ?? "";                        // …| head -1
    expect(first.match(/[0-9]{2}:[0-9]{2}/g)).toEqual(["15:10"]);                               // …| grep -oE '[0-9]{2}:[0-9]{2}'
    expect(first.match(/[0-9]{2}:[0-9]{2}/g)).toEqual(DEFAULT_TRADE_CONFIG.cronTimesET);
  });
  it.skipIf(process.platform === "win32")("the .sh's own SLOTS= line, run under bash, yields 15:10", () => {
    const line = read("scripts/register-trade-cron.sh").split("\n").find((l) => l.startsWith("SLOTS="));
    expect(line).toBeDefined();
    const out = execFileSync("bash", ["-c", `REPO=${JSON.stringify(process.cwd())}; ${line}; printf %s "$SLOTS"`], { encoding: "utf8" });
    expect(out.trim()).toBe("15:10");
  });
  it("register-trade-cron.ps1 gets [\"15:10\"]", () => {
    expect(read("scripts/register-trade-cron.ps1")).toContain("-Pattern 'cronTimesET: \\[([^\\]]*)\\]'");
    const group = config.match(/cronTimesET: \[([^\]]*)\]/)?.[1] ?? "";                       // Select-String -First 1, Groups[1]
    expect(group.match(/\d{2}:\d{2}/g)).toEqual(["15:10"]);
  });
});

describe("fire-window config", () => {
  it("defaults maxLateMin to 20 and validates it and cronTimeET", () => {
    expect(resolveTradeConfig().maxLateMin).toBe(20);
    for (const maxLateMin of [0, -5, 2.5, 391]) expect(() => resolveTradeConfig({ maxLateMin })).toThrow(/maxLateMin/);
    expect(() => resolveTradeConfig({ cronTimeET: "9:45" })).toThrow(/HH:MM/);
  });
});

describe("phase-2 config", () => {
  it("ships the phase-2 defaults", () => {
    const c = resolveTradeConfig();
    expect(c.limitTol).toEqual({ large: 0.0015, mid: 0.0035, small: 0.0080 });
    expect(c.limitTolMax).toEqual({ large: 0.0040, mid: 0.0100, small: 0.0150 });
    expect(c.gapHalt).toEqual({ large: 0.10, mid: 0.15, small: 0.25 });
    expect(c.maxStaleMin).toEqual({ large: 5, mid: 15, small: 60 });
    expect(c.exitTolMult).toBe(1.5);
    expect(c.closeAnchorSizeMult).toBe(0.5);
    expect(c.maxRunTurnoverFrac).toBe(0.15);
    expect(c.consecutiveHaltLimit).toBe(3);
  });
  it("buckets by market cap with null → mid", () => {
    expect(bucketFor(50e9)).toBe("large");
    expect(bucketFor(5e9)).toBe("mid");
    expect(bucketFor(1e9)).toBe("small");
    expect(bucketFor(null)).toBe("mid");
  });
  it("rejects an inverted per-bucket cap", () => {
    expect(() => resolveTradeConfig({ limitTolMax: { large: 0.0005, mid: 0.01, small: 0.015 } })).toThrow();
  });
});

describe("tradeConfigFromEnv (TRADE_MIN_USD / TRADE_MIN_NAV_PCT)", () => {
  const e = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
  it("defaults to the ADD/TRIM floor max($1, 0.5% NAV) when unset", () => {
    expect(tradeConfigFromEnv(e({}))).toEqual({});
    expect(resolveTradeConfig(tradeConfigFromEnv(e({})))).toMatchObject({ minTradeUsd: 1, minTradeNavFrac: 0.005 });
  });
  it("reads dollars and a PERCENT of NAV", () => {
    expect(resolveTradeConfig(tradeConfigFromEnv(e({ TRADE_MIN_USD: "5", TRADE_MIN_NAV_PCT: "1" })))).toMatchObject({ minTradeUsd: 5, minTradeNavFrac: 0.01 });
    expect(tradeConfigFromEnv(e({ TRADE_MIN_NAV_PCT: " 0.25 " }))).toEqual({ minTradeNavFrac: 0.0025 });
  });
  it("throws on a malformed or negative value rather than silently falling back", () => {
    expect(() => tradeConfigFromEnv(e({ TRADE_MIN_USD: "five" }))).toThrow(/TRADE_MIN_USD/);
    expect(() => tradeConfigFromEnv(e({ TRADE_MIN_NAV_PCT: "-1" }))).toThrow(/TRADE_MIN_NAV_PCT/);
  });
});
