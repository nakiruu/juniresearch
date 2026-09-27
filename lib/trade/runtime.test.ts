import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import * as runtime from "./runtime";

describe("lib/trade/runtime", () => {
  it("exposes the data/trade path constants", () => {
    expect(runtime.TRADE_DIR.replace(/\\/g, "/")).toBe("data/trade");
    expect(runtime.FILLS_PATH.replace(/\\/g, "/")).toBe("data/trade/fills.jsonl");
    expect(runtime.SCHWAB_TOKEN_PATH.replace(/\\/g, "/")).toBe("data/trade/schwab-token.json");
  });

  it("makeBroker THROWS (never process.exits) on missing Alpaca keys", () => {
    const env = { BROKER: "alpaca-paper" } as unknown as NodeJS.ProcessEnv; // no APCA_* keys
    expect(() => runtime.makeBroker(env)).toThrowError(/APCA_API_KEY_ID/);
  });

  it("makeBroker builds a Schwab broker from env alone (no token file needed)", () => {
    const env = { BROKER: "schwab", SCHWAB_CLIENT_ID: "c", SCHWAB_CLIENT_SECRET: "s", SCHWAB_REFRESH_TOKEN: "R", SCHWAB_ACCOUNT_HASH: "H" } as unknown as NodeJS.ProcessEnv;
    expect(runtime.makeBroker(env).kind).toBe("schwab");
  });

  it("makeBroker asks for SCHWAB_ACCOUNT_HASH when env has a refresh token but no hash and no file", () => {
    const env = { BROKER: "schwab", SCHWAB_CLIENT_ID: "c", SCHWAB_CLIENT_SECRET: "s", SCHWAB_REFRESH_TOKEN: "R" } as unknown as NodeJS.ProcessEnv;
    if (existsSync(runtime.SCHWAB_TOKEN_PATH)) return; // a real linked account on this machine supplies the hash
    expect(() => runtime.makeBroker(env)).toThrowError(/SCHWAB_ACCOUNT_HASH/);
  });

  it("makeBroker rejects an unknown broker", () => {
    expect(() => runtime.makeBroker({ BROKER: "etrade" } as unknown as NodeJS.ProcessEnv))
      .toThrowError(/not a known broker/);
  });
});
