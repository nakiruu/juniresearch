import { describe, it, expect } from "vitest";
import { DEFAULT_TRADE_CONFIG, resolveTradeConfig } from "./config";

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
