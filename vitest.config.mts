import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Pinned explicitly so Vitest stops suggesting `pool: "vmThreads"` ("jsdom
    // was created N times … "). forks is already the default; vmThreads is
    // rejected because it shares one VM context across test files and weakens
    // the isolation lib/reports.errors.test.ts depends on.
    pool: "forks",
    // Pinned explicitly so Vitest stops suggesting `isolate: false` ("6 workers
    // spawned … ~282ms faster with isolate: false"). Isolation stays on because
    // lib/reports.errors.test.ts mocks node:fs/promises and must not leak into
    // sibling test files.
    isolate: true,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
