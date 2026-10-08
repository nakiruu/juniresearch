/**
 * editorial.ts — the findings file as the build sees it.
 * -----------------------------------------------------------------------------
 * The hash binds a review to the exact judgment text it read, normalised for line
 * endings so the same file hashes the same on Windows and in CI. Everything else
 * here is a pure reading of the review: which findings still block, what the gate
 * should say, and how the open ones render into the author's next prompt.
 * reviewVerdict adds the inputs the reviewer read (review-inputs.ts): a review is
 * stale when the judgment or any input component moved, and unstamped when its
 * copy of the inputs is missing or mis-copied.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
// `EditorialReview` is exported twice from editorial.schema.ts — as the parsing const and as the
// inferred type — so this one import binds both, and no alias is needed.
import { EditorialReview, readInputsStamp, type EditorialFinding } from "./editorial.schema";
import { changedComponents, LEGACY_ENVELOPE_CALLS, type Component, type ReviewInputs } from "./review-inputs";

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

export type ReviewVerdictStatus = ReviewStatus | "unstamped";
export interface ReviewVerdict {
  status: ReviewVerdictStatus;
  /** What moved on a stale verdict: the judgment, or the input components. */
  changed?: ("judgment" | Component)[];
  /** Why an unstamped verdict has no usable stamp: `missing`, or `mis-copied: <zod message>`. */
  unstamped?: string;
  /** Diagnostic only; it never decides the status. */
  hint?: string;
}

/**
 * Judgment, then the stamp, then the inputs, then the findings. `current` gives the current inputs under a scheme, so a
 * review is compared on the picks its reviewer saw. `atReviewCommit` (the inputs recomputed from git at the findings
 * file's last commit) only adds the mis-copy hint, and only to a stamp the reviewer copied.
 */
export function reviewVerdict(
  judgmentText: string,
  review: EditorialReview | null,
  current: (scheme: number) => ReviewInputs,
  opts: { requireInputs: boolean; atReviewCommit?: ReviewInputs },
): ReviewVerdict {
  if (!review) return { status: "missing" };
  if (review.judgmentSha256 !== judgmentSha256(judgmentText)) return { status: "stale", changed: ["judgment"] };
  const read = readInputsStamp(review);
  if ("stamp" in read) {
    const { stamp } = read;
    const changed = changedComponents(stamp, current(stamp.scheme));
    if (changed.length) {
      const at = opts.atReviewCommit;
      const hint = stamp.calls === LEGACY_ENVELOPE_CALLS ? "the review read the pre-rating envelope, retired in 02d1335"
        : !stamp.source && at && changed.some((k) => stamp[k] !== at[k]) ? "if nothing changed, the inputs were likely mis-copied; continue the reviewer to re-copy them"
          : undefined;
      return { status: "stale", changed, ...(hint ? { hint } : {}) };
    }
  } else if (opts.requireInputs) {
    return { status: "unstamped", unstamped: "missing" in read ? "missing" : `mis-copied: ${read.malformed}` };
  }
  return { status: openFindings(review).length > 0 ? "open" : "clean" };
}

/** One short label for listings (grounding:sweep): `stale (facts)`, `unstamped (missing)`, `clean`, … */
export const verdictLabel = (v: ReviewVerdict): string =>
  v.changed ? `${v.status} (${v.changed.join(", ")})` : v.unstamped ? `${v.status} (${v.unstamped})` : v.status;

export function reviewVerdictMessage(v: ReviewVerdict, openCount: number): string {
  if (v.status === "stale" && v.changed && !v.changed.includes("judgment"))
    return `the review predates the current inputs (${v.changed.join(", ")} changed) — rebuild with --skip-review, re-render the brief (it will be a full brief) and re-run the review${v.hint ? ` — ${v.hint}` : ""}`;
  if (v.status === "unstamped")
    return `the findings file has no valid \`inputs\` (${v.unstamped ?? "missing"}) — continue the same reviewer to re-copy it from the \`Inputs fingerprint\` line of prompt.md (also in the brief's Output section); if the inputs changed since its brief, re-render the brief and re-run the review. Never copy or edit \`inputs\` on the reviewer's behalf`;
  return editorialGateMessage(v.status, openCount);
}

/**
 * The message for a findings file that exists but fails `loadEditorialReview` —
 * bad JSON or a schema violation. `synth:build`'s gate reports this shape as a
 * validation issue (`malformed editorial review: <message>`); this is the same
 * wording for callers, like `synth:review-brief`, that only have a path and a
 * caught error and need a readable line instead of a raw stack.
 */
export function malformedReviewMessage(path: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `malformed editorial review: ${detail} — fix or delete ${path} before re-rendering the brief`;
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
