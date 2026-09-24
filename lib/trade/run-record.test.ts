import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecord, newRunId, writeRunRecord } from "./run-record";

const rec = (): RunRecord => ({
  runId: "2026-09-25-deadbeef", today: "2026-09-25", markMode: "settled", broker: "fake",
  marks: { NVT: 100 }, signals: [{ ticker: "NVT", label: "BUY", gatedLabel: "BUY", mu: 0.15, R: 0.8, kappa: 0.6, quality: 1, ageDays: 10 }],
  classifications: [{ ticker: "NVT", classification: "ENTER", reasons: [] }],
  locks: { buyLockUntil: {}, sellLockUntil: {} },
  plan: { trades: [], skipped: [] }, orders: [], fills: [], notes: [],
});

describe("run record", () => {
  it("newRunId is the day plus 8 hex chars and is unique", () => {
    const a = newRunId("2026-09-25"), b = newRunId("2026-09-25");
    expect(a).toMatch(/^2026-09-25-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
  it("writes <dir>/<runId>.json, creating the dir, and the file parses back", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "runs-")), "runs");
    const p = writeRunRecord(dir, rec());
    expect(p).toBe(join(dir, "2026-09-25-deadbeef.json"));
    expect(RunRecord.parse(JSON.parse(readFileSync(p, "utf8")))).toEqual(rec());
  });
  it("rejects a record with a bad markMode", () => {
    expect(() => RunRecord.parse({ ...rec(), markMode: "guess" })).toThrow();
  });
});
