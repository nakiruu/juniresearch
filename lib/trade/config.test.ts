import { describe, it, expect } from "vitest";
import { DEFAULT_TRADE_CONFIG, resolveTradeConfig, bucketFor } from "./config";

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
