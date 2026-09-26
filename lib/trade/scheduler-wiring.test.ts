import { describe, it, expect } from "vitest";
import { buildSchedulerDeps } from "./scheduler-wiring";

describe("buildSchedulerDeps", () => {
  it("with TRADE_DISABLED=1, runOnce returns 'disabled' and needs no broker keys", async () => {
    const deps = buildSchedulerDeps({ TRADE_DISABLED: "1", BROKER: "alpaca-paper" } as unknown as NodeJS.ProcessEnv);
    expect(deps.broker).toBe("alpaca-paper");
    expect(typeof deps.now()).toBe("number");
    const result = await deps.runOnce();
    expect(result.status).toBe("disabled"); // runCron short-circuits on disabled before any adapter call
  });
});
