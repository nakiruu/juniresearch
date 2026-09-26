import { afterEach, describe, it, expect } from "vitest";
import { register } from "./instrumentation";

const prev = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
  Object.assign(process.env, prev);
});

describe("instrumentation.register", () => {
  it("is a no-op (no throw) when the scheduler flag is off", async () => {
    process.env.NEXT_RUNTIME = "nodejs"; delete process.env.TRADE_SCHEDULER_ENABLED;
    await expect(register()).resolves.toBeUndefined();
  });
  it("is a no-op on the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge"; process.env.TRADE_SCHEDULER_ENABLED = "1";
    await expect(register()).resolves.toBeUndefined();
  });
});
