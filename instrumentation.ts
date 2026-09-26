/**
 * instrumentation.ts — Next.js boot hook (repo root, per Next 16 convention).
 * Arms the in-process trade scheduler once on server start, only when `shouldArm(env)`.
 * A wiring failure (e.g. missing broker keys) is logged and swallowed — it must never
 * throw out of `register()`, since that would take the web server down with it.
 */
import { shouldArm } from "./lib/trade/scheduler";

export async function register(): Promise<void> {
  if (!shouldArm(process.env)) {
    if (process.env.NEXT_RUNTIME === "nodejs") console.log("[scheduler] disabled (set TRADE_SCHEDULER_ENABLED=1 to arm)");
    return;
  }
  try {
    const { buildSchedulerDeps, startScheduler, getSchedulerStatus } = await import("./lib/trade/scheduler-wiring");
    const { stop } = startScheduler(buildSchedulerDeps(process.env));
    for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, stop);
    const s = getSchedulerStatus();
    console.log(`[scheduler] armed, broker=${s.broker}, next=${s.nextRunISO}`);
  } catch (e) {
    // Never take the web server down because the trader couldn't arm (e.g. missing broker keys).
    console.error(`[scheduler] failed to arm — serving pages without it: ${e instanceof Error ? e.message : String(e)}`);
  }
}
