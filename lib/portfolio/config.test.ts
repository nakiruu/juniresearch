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
