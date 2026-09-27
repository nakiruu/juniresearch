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
  it("accepts old records without the scenario-risk fields and round-trips new ones", () => {
    expect(() => RunRecord.parse(rec())).not.toThrow();
    const withRisk = { ...rec(), signals: [{ ...rec().signals[0], price: 100, sigma: 0.2, sigmaDown: 0.1, D: 0.2, staleness: 0.9,
      scenarios: [{ name: "bull", impliedPrice: 150, probability: 0.3 }, { name: "base", impliedPrice: 120, probability: 0.5 }, { name: "bear", impliedPrice: 80, probability: 0.2 }] }] };
    expect(RunRecord.parse(JSON.parse(JSON.stringify(withRisk)))).toEqual(withRisk);
  });
  it("rejects a record with a bad markMode", () => {
    expect(() => RunRecord.parse({ ...rec(), markMode: "guess" })).toThrow();
  });
});
