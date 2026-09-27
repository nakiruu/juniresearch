import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestFactPack } from "@/lib/synth/latest-factpack";

describe("latestFactPack", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "latest-factpack-"));
    const multi = join(root, "facts", "AAA");
    mkdirSync(multi, { recursive: true });
    writeFileSync(join(multi, "old.json"), "{}");
    writeFileSync(join(multi, "new.json"), "{}");
    writeFileSync(join(multi, "notes.txt"), "");
    utimesSync(join(multi, "old.json"), 1_000, 1_000);
    utimesSync(join(multi, "new.json"), 2_000, 2_000);
    utimesSync(join(multi, "notes.txt"), 3_000, 3_000);
    const single = join(root, "facts", "BBB");
    mkdirSync(single, { recursive: true });
    writeFileSync(join(single, "only.json"), "{}");
    mkdirSync(join(root, "facts", "EMPTY"), { recursive: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("picks the most recently modified json and flags multiple packs", () => {
    expect(latestFactPack(root, "AAA")).toEqual({ path: join(root, "facts", "AAA", "new.json"), multi: true });
  });
  it("returns the single pack unflagged", () => {
    expect(latestFactPack(root, "BBB")).toEqual({ path: join(root, "facts", "BBB", "only.json"), multi: false });
  });
  it("returns null for a missing or empty ticker directory", () => {
    expect(latestFactPack(root, "NOPE")).toBeNull();
    expect(latestFactPack(root, "EMPTY")).toBeNull();
  });
});
