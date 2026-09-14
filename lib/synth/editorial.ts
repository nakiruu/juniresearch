/**
 * editorial.ts — the findings file as the build sees it.
 * -----------------------------------------------------------------------------
 * The hash binds a review to the exact judgment text it read, normalised for line
 * endings so the same file hashes the same on Windows and in CI. Everything else
 * here is a pure reading of the review: which findings still block, what the gate
 * should say, and how the open ones render into the author's next prompt.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
// `EditorialReview` is exported twice from editorial.schema.ts — as the parsing const and as the
// inferred type — so this one import binds both, and no alias is needed.
import { EditorialReview, type EditorialFinding } from "./editorial.schema";

export function judgmentSha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** Absent → null. Malformed → throw: a file the reviewer wrote badly is not the same as no review. */
export function loadEditorialReview(path: string): EditorialReview | null {
  if (!existsSync(path)) return null;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return EditorialReview.parse(raw);
}

export function openFindings(review: EditorialReview): EditorialFinding[] {
  return review.findings.filter((f) => f.status === "open" && f.severity !== "Minor");
}

export type ReviewStatus = "missing" | "stale" | "open" | "clean";

export function reviewStatus(judgmentText: string, review: EditorialReview | null): ReviewStatus {
  if (!review) return "missing";
  if (review.judgmentSha256 !== judgmentSha256(judgmentText)) return "stale";
  return openFindings(review).length > 0 ? "open" : "clean";
}

export function editorialGateMessage(status: ReviewStatus, openCount: number): string {
  if (status === "missing") return "no editorial review — run synth:review-brief and dispatch a reviewer";
  if (status === "stale") return "the review predates the current judgment — re-run the review";
  if (status === "open") return `${openCount} Critical/Important finding(s) open — run synth:prompt --with-review`;
  return "the editorial review is clean";
}

export function renderEditorialFindings(review: EditorialReview): string {
  const open = openFindings(review);
  const head = `Editorial review round ${review.round} by ${review.reviewer} (${review.reviewedAt}); verdict ${review.verdict}.`;
  if (open.length === 0) return `${head}\n\nThere are no open findings.`;
  const body = open
    .map((f) => [
      `## ${f.id} — ${f.severity} — \`${f.field}\``,
      `> ${f.quote.replace(/\n+/g, " ")}`,
      `**Issue.** ${f.issue}`,
      `**Fix.** ${f.fix}`,
      ...(f.note ? [`**Reviewer's note.** ${f.note}`] : []),
    ].join("\n\n"))
    .join("\n\n");
  return `${head}\n\nAddress every finding below, then rebuild. A Minor you decline needs a \`note\` in the findings file.\n\n${body}`;
}
