/**
 * editorial.schema.ts — the contract between the reviewer and the build.
 * -----------------------------------------------------------------------------
 * The reviewer is a fresh model today and an API call tomorrow; this file is the
 * only thing either has to satisfy. Strict objects so a reviewer that invents a
 * key fails fast, and one refinement the schema alone cannot state: a Critical or
 * Important finding may be addressed, never declined — the author does not get to
 * overrule the desk on the two severities that block publication.
 */
import { z } from "zod";

export const EditorialFinding = z.strictObject({
  id: z.string().regex(/^F-\d+$/, "ids are F-1, F-2, …"),
  severity: z.enum(["Critical", "Important", "Minor"]),
  field: z.string().min(1).max(200),
  quote: z.string().min(1).max(600),
  issue: z.string().min(1).max(1200),
  fix: z.string().min(1).max(1200),
  status: z.enum(["open", "addressed", "declined"]),
  note: z.string().max(600).optional(),
});
export type EditorialFinding = z.infer<typeof EditorialFinding>;

/** The plain shape, for z.toJSONSchema — a refinement has no JSON Schema form. */
export const EditorialReviewShape = z.strictObject({
  judgmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  reviewedAt: z.string().min(1),
  reviewer: z.string().min(1).max(120),
  round: z.number().int().min(1).max(2),
  verdict: z.enum(["approved", "approved-with-minors", "needs-fix-round"]),
  findings: z.array(EditorialFinding).max(40),
});
export type EditorialReview = z.infer<typeof EditorialReviewShape>;

export const EditorialReview = EditorialReviewShape.refine(
  (r) => !r.findings.some((f) => f.status === "declined" && f.severity !== "Minor"),
  { message: "a declined Critical or Important finding is invalid — only a Minor may be declined, with a note", path: ["findings"] },
);
