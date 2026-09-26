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
