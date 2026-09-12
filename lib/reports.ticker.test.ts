import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const avgoJson = readFileSync(path.join(process.cwd(), "data", "avgo.json"), "utf8");

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(async () => avgoJson) };
});

import { loadReport } from "@/lib/reports";

describe("loadReport ticker agreement", () => {
  it("rejects a file whose name disagrees with meta.ticker", async () => {
    await expect(loadReport("msft")).rejects.toThrow(/meta\.ticker "AVGO"/);
  });
});
