/**
 * instrumentation.ts — Next.js boot hook (repo root, per Next 16 convention).
 * Next calls `register()` in BOTH the Node.js and Edge runtimes. All trade-scheduler code lives in
 * `instrumentation-node.ts` and is imported only behind the literal `process.env.NEXT_RUNTIME ===
 * "nodejs"` check (the pattern from Next's instrumentation guide): the bundler inlines NEXT_RUNTIME
 * per target, so the Edge bundle dead-code-eliminates the import instead of shipping the scheduler.
 * Arming rules (shouldArm, never-throw) are unchanged and live in instrumentation-node.ts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
