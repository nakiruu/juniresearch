import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EditorialReview, EditorialReviewShape, EditorialFinding, ReviewInputsStamp, readInputsStamp } from "@/lib/synth/editorial.schema";

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
  it("lists inputs as required in the reviewer's JSON Schema", () => {
    const schema = z.toJSONSchema(EditorialReviewShape) as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toContain("inputs");
    expect(Object.keys(schema.properties).indexOf("inputs")).toBe(Object.keys(schema.properties).indexOf("judgmentSha256") + 1);
  });
});

describe("the inputs stamp", () => {
  const stamp = { scheme: 1, facts: "a".repeat(64), calls: "b".repeat(64), context: "c".repeat(64) };
  const read = (inputs: unknown) => readInputsStamp(EditorialReview.parse(inputs === undefined ? review() : { ...review(), inputs }));
  it("a file with no inputs parses, and reads as missing", () => {
    expect(EditorialReview.safeParse(review()).success).toBe(true);
    expect(read(undefined)).toEqual({ missing: true });
  });
  it("a malformed stamp parses as a file but reads as malformed, with the zod message", () => {
    const cases: [unknown, RegExp][] = [
      [{ ...stamp, facts: "nope" }, /facts/],
      [{ ...stamp, scheme: 2 }, /scheme/],
      [{ ...stamp, extra: 1 }, /extra/],
      [{ ...stamp, source: "copied" }, /source/],
      ["not an object", /object/i],
    ];
    for (const [inputs, re] of cases) {
      expect(EditorialReview.safeParse({ ...review(), inputs }).success).toBe(true);
      const r = read(inputs);
      expect(r).toHaveProperty("malformed");
      expect((r as { malformed: string }).malformed).toMatch(re);
    }
  });
  it("a good stamp reads as a stamp, with or without a source", () => {
    expect(read(stamp)).toEqual({ stamp });
    for (const source of ["backfill:7ce1382", "rekey:" + "f".repeat(40), "owner-accept:pre-rating", "rekey:abc1234+owner-accept"])
      expect(read({ ...stamp, source })).toEqual({ stamp: { ...stamp, source } });
    expect(ReviewInputsStamp.safeParse({ ...stamp, source: "backfill:XYZ" }).success).toBe(false);
  });
});
