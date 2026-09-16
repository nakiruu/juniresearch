import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("facts:free CLI", () => {
  it("exits 2 with usage when args are missing", () => {
    try {
      execFileSync("node", ["--import", "tsx", "scripts/facts-free.ts"], { stdio: "pipe" });
      throw new Error("should have exited non-zero");
    } catch (e) {
      const err = e as { status?: number; stderr?: unknown };
      expect(err.status).toBe(2);
      expect(String(err.stderr)).toContain("usage: npm run facts:free");
    }
  });
});
