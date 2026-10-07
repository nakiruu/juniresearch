/**
 * instrumentation-node.ts — Node.js-only half of the boot hook. Loaded by `instrumentation.ts`
 * only behind a literal `process.env.NEXT_RUNTIME === "nodejs"` check, so the bundler can drop this
 * module (and the trade scheduler + node:fs graph behind it) from the Edge instrumentation bundle.
 * Arms the in-process trade scheduler once on server start, only when `shouldArm(env)`.
 * A wiring failure (e.g. missing broker keys) is logged and swallowed — it must never
 * throw out of `register()`, since that would take the web server down with it.
 */
import { shouldArm } from "./lib/trade/scheduler";

/** One scheduler per process: Next may call register() again (a dev reload, a second module graph). */
const g = globalThis as unknown as { __tradeSchedulerRegistered?: boolean };

export async function registerNode(): Promise<void> {
  if (!shouldArm(process.env)) {
    if (process.env.NEXT_RUNTIME === "nodejs") console.log("[scheduler] disabled (set TRADE_SCHEDULER_ENABLED=1 to arm)");
    return;
  }
  // A second arm would start a second timer (two runs per slot, the run-lock turning one into "locked") and stack
  // SIGTERM/SIGINT listeners. The flag is set before the await so concurrent calls can't both arm, and cleared on
  // failure so a later call can retry.
  if (g.__tradeSchedulerRegistered) { console.log("[scheduler] already armed in this process — not arming again"); return; }
  g.__tradeSchedulerRegistered = true;
  try {
    const { buildSchedulerDeps, startScheduler, getSchedulerStatus } = await import("./lib/trade/scheduler-wiring");
    const { stop } = startScheduler(buildSchedulerDeps(process.env));
    for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, stop);
    const s = getSchedulerStatus();
    console.log(`[scheduler] armed, broker=${s.broker}, next=${s.nextRunISO}`);
  } catch (e) {
    g.__tradeSchedulerRegistered = false;
    // Never take the web server down because the trader couldn't arm (e.g. missing broker keys).
    console.error(`[scheduler] failed to arm — serving pages without it: ${e instanceof Error ? e.message : String(e)}`);
  }
}
