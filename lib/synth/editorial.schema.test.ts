import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EditorialReview, EditorialReviewShape, EditorialFinding } from "@/lib/synth/editorial.schema";

const finding = (over: Partial<z.input<typeof EditorialFinding>> = {}) => ({
  id: "F-1", severity: "Minor" as const, field: "sections.management.governance",
  quote: "record revenue", issue: "unattributed superlative", fix: "attribute it to the proxy", status: "open" as const, ...over,
});
const review = (findings: unknown[] = [finding()]) => ({
  judgmentSha256: "a".repeat(64), reviewedAt: "2026-09-14T10:00:00Z", reviewer: "opus", round: 1,
  verdict: "approved-with-minors", findings,
});

describe("EditorialReview", () => {
  it("parses a well-formed review", () => {
    const r = EditorialReview.parse(review());
    expect(r.findings[0].id).toBe("F-1");
    expect(r.round).toBe(1);
  });
  it("rejects a bad hash, a bad id, an unknown key and a fourth round", () => {
    expect(() => EditorialReview.parse({ ...review(), judgmentSha256: "nope" })).toThrow();
    expect(() => EditorialReview.parse(review([finding({ id: "1" })]))).toThrow();
    expect(() => EditorialReview.parse({ ...review(), extra: 1 })).toThrow();
    expect(() => EditorialReview.parse({ ...review(), round: 3 })).toThrow();
  });
  it("rejects a declined Critical and a declined Important", () => {
    for (const severity of ["Critical", "Important"] as const)
      expect(() => EditorialReview.parse(review([finding({ severity, status: "declined", note: "disagree" })]))).toThrow(/declined/i);
  });
  it("accepts a declined Minor with a note", () => {
    expect(EditorialReview.parse(review([finding({ status: "declined", note: "house style disagrees" })])).findings[0].status).toBe("declined");
  });
  it("accepts an addressed Critical", () => {
    expect(EditorialReview.parse(review([finding({ severity: "Critical", status: "addressed" })])).findings).toHaveLength(1);
  });
  it("caps the findings list at forty", () => {
    expect(() => EditorialReview.parse(review(Array.from({ length: 41 }, (_, i) => finding({ id: `F-${i + 1}` }))))).toThrow();
  });
  it("exports as JSON Schema for the reviewer's brief", () => {
    const schema = z.toJSONSchema(EditorialReviewShape) as Record<string, unknown>;
    expect(JSON.stringify(schema)).toContain("judgmentSha256");
    expect(JSON.stringify(schema)).toContain("needs-fix-round");
  });
});
