import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const exclude = ["**/node_modules/**", ".next/**", ".worktrees/**"];

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
    globals: true,
    exclude,
    // Two projects so only component tests pay for jsdom. Booting a jsdom
    // window per file dominated the run (~70% of wall time) while ~90% of the
    // files are pure lib/ + scripts/ code that never touches the DOM. The split
    // is by extension: every *.test.tsx renders React and gets jsdom plus the
    // jest-dom matchers; every *.test.ts runs in plain node. A .ts test that
    // needs a DOM can opt in with a `// @vitest-environment jsdom` docblock.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["**/*.test.tsx"],
          exclude,
        },
      },
    ],
  },
});
