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
