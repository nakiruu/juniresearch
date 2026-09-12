import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async () => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    }),
  };
});

import { loadReport } from "@/lib/reports";

describe("loadReport error boundary", () => {
  it("rethrows read failures that are not ENOENT instead of returning null", async () => {
    await expect(loadReport("avgo")).rejects.toThrow(/EACCES/);
  });
});
