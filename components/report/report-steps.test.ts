import { describe, it, expect } from "vitest";
import { REPORT_STEPS } from "@/components/report/report-steps";

describe("REPORT_STEPS", () => {
  it("lists the eight numbered sections in order", () => {
    expect(REPORT_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("derives a stable anchor id from the number", () => {
    for (const s of REPORT_STEPS) expect(s.id).toBe(`sec-${s.n}`);
  });

  it("keeps the numbered title the sections render", () => {
    for (const s of REPORT_STEPS) expect(s.title.startsWith(`${s.n}. `)).toBe(true);
    expect(REPORT_STEPS[7].title).toBe("8. Final Recommendation");
  });

  it("refuses a step number outside 1–8", async () => {
    const { stepFor } = await import("@/components/report/report-steps");
    expect(stepFor(8).id).toBe("sec-8");
    expect(() => stepFor(9)).toThrow(/No report step 9/);
    expect(() => stepFor(0)).toThrow(/No report step 0/);
  });

  it("carries a short rail label for every step", () => {
    for (const s of REPORT_STEPS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.label.length).toBeLessThanOrEqual(14);
    }
  });
});
