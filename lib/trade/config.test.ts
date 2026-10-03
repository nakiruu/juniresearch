import { describe, it, expect } from "vitest";
import { DEFAULT_TRADE_CONFIG, resolveTradeConfig, bucketFor, tradeConfigFromEnv } from "./config";

describe("resolveTradeConfig", () => {
  it("returns the spec §12 defaults when given no overrides", () => {
    const cfg = resolveTradeConfig();
    expect(cfg.muEnter).toBe(0.08);
    expect(cfg.muExit).toBe(0.03);
    expect(cfg.rEnter).toBe(0.6);
    expect(cfg.rExit).toBe(0.35);
    expect(cfg.lockBusinessDays).toBe(5);
    expect(cfg.markMode).toBe("settled");
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
    // bearFloor 0 (raw R) now needs breachPolicy "exit": the by-cause hold sizes a breached name through the floor.
    expect(resolveTradeConfig({ bearFloor: 0, breachPolicy: "exit" }).bearFloor).toBe(0);
  });
});

describe("bear-breach config", () => {
  it("defaults to the by-cause rule with thresholds 0.5 / 0.9", () => {
    expect(resolveTradeConfig()).toMatchObject({ breachPolicy: "byCause", breachMarketShareMax: 0.5, breachStockShareMin: 0.9 });
    expect(resolveTradeConfig({ breachPolicy: "exit" }).breachPolicy).toBe("exit");
  });
  it("rejects an unknown policy", () => {
    expect(() => resolveTradeConfig({ breachPolicy: "hold" as never })).toThrow(/breachPolicy/);
  });
  it("needs 0 < breachMarketShareMax < breachStockShareMin <= 1.5", () => {
    expect(() => resolveTradeConfig({ breachMarketShareMax: 0 })).toThrow(/breach thresholds/);
    expect(() => resolveTradeConfig({ breachMarketShareMax: 0.9 })).toThrow(/breach thresholds/);   // equal is not below
    expect(() => resolveTradeConfig({ breachMarketShareMax: 0.95 })).toThrow(/breach thresholds/);
    expect(() => resolveTradeConfig({ breachStockShareMin: 1.6 })).toThrow(/breach thresholds/);
    expect(() => resolveTradeConfig({ breachMarketShareMax: Number.NaN })).toThrow(/breach thresholds/);
    expect(resolveTradeConfig({ breachMarketShareMax: 0.3, breachStockShareMin: 1.2 })).toMatchObject({ breachMarketShareMax: 0.3, breachStockShareMin: 1.2 });
  });
  it("byCause needs a bear floor (a market-driven hold is sized through it); exit does not", () => {
    expect(() => resolveTradeConfig({ bearFloor: 0 })).toThrow(/byCause.*bearFloor/);
    expect(() => resolveTradeConfig({ bearFloor: 0, breachPolicy: "exit" })).not.toThrow();
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
  it("defaults to one slot and keeps cronTimeET as the first slot", () => {
    expect(resolveTradeConfig()).toMatchObject({ cronTimeET: "09:45", cronTimesET: ["09:45"] });
    expect(resolveTradeConfig({ cronTimeET: "09:50" }).cronTimesET).toEqual(["09:50"]);
    expect(resolveTradeConfig({ cronTimesET: ["09:45", "10:40"] }).cronTimeET).toBe("09:45");
  });
  it("rejects unsorted, duplicate, malformed, empty or too many slots", () => {
    for (const cronTimesET of [["10:40", "09:45"], ["09:45", "09:45"], ["9:45"], [], ["09:40", "10:00", "11:00", "12:00", "13:00"]]) {
      expect(() => resolveTradeConfig({ cronTimesET })).toThrow();
    }
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
