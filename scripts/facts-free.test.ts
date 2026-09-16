import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("facts:free CLI", () => {
  it("exits 2 with usage when args are missing", () => {
    try {
      execFileSync("node", ["--import", "tsx", "scripts/facts-free.ts"], { stdio: "pipe" });
      throw new Error("should have exited non-zero");
    } catch (e: any) {
      expect(e.status).toBe(2);
      expect(String(e.stderr)).toContain("usage: npm run facts:free");
    }
  });
});
