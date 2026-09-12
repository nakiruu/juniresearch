import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
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
