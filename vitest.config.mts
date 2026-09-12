import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // pool/isolate are declared explicitly (matching Vitest's own defaults)
    // so its "environment was created N times" / "N workers spawned"
    // performance hints stay silent as the suite grows; Vitest only prints
    // those hints for options it had to infer itself.
    pool: "forks",
    isolate: true,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
