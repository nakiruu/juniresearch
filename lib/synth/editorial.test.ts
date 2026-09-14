import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorialReview } from "@/lib/synth/editorial.schema";
import { judgmentSha256, loadEditorialReview, openFindings, reviewStatus, editorialGateMessage, renderEditorialFindings } from "@/lib/synth/editorial";

const TEXT = '{\n  "rating": { "label": "BUY" }\n}\n';
const finding = (over: Record<string, unknown> = {}) => ({
  id: "F-1", severity: "Minor", field: "sections.management.governance",
  quote: "record revenue", issue: "unattributed superlative", fix: "attribute it", status: "open", ...over,
});
const review = (over: Record<string, unknown> = {}) => EditorialReview.parse({
  judgmentSha256: judgmentSha256(TEXT), reviewedAt: "2026-09-14T10:00:00Z", reviewer: "opus",
  round: 1, verdict: "approved-with-minors", findings: [finding()], ...over,
});

describe("judgmentSha256", () => {
  it("is 64 lowercase hex characters", () => expect(judgmentSha256(TEXT)).toMatch(/^[0-9a-f]{64}$/));
  it("is unchanged by a CRLF conversion", () => expect(judgmentSha256(TEXT.replace(/\n/g, "\r\n"))).toBe(judgmentSha256(TEXT)));
  it("changes when the judgment changes", () => expect(judgmentSha256(TEXT + " ")).not.toBe(judgmentSha256(TEXT)));
});

describe("reviewStatus", () => {
  it("is missing with no file", () => expect(reviewStatus(TEXT, null)).toBe("missing"));
  it("is stale when the hash does not match the judgment", () => expect(reviewStatus(TEXT + "x", review())).toBe("stale"));
  it("is clean when only Minors are open", () => expect(reviewStatus(TEXT, review())).toBe("clean"));
  it("is clean with no findings at all", () => expect(reviewStatus(TEXT, review({ findings: [], verdict: "approved" }))).toBe("clean"));
  it("is open with an open Critical", () => expect(reviewStatus(TEXT, review({ findings: [finding({ severity: "Critical" })], verdict: "needs-fix-round" }))).toBe("open"));
  it("is open with an open Important", () => expect(reviewStatus(TEXT, review({ findings: [finding({ severity: "Important" })], verdict: "needs-fix-round" }))).toBe("open"));
  it("is clean once every Critical is addressed", () => expect(reviewStatus(TEXT, review({ findings: [finding({ severity: "Critical", status: "addressed" })], verdict: "approved" }))).toBe("clean"));
  it("is clean with a declined Minor", () => expect(reviewStatus(TEXT, review({ findings: [finding({ status: "declined", note: "no" })] }))).toBe("clean"));
  it("prefers stale over open — a stale review says nothing about the current judgment", () =>
    expect(reviewStatus(TEXT + "x", review({ findings: [finding({ severity: "Critical" })], verdict: "needs-fix-round" }))).toBe("stale"));
});

describe("openFindings and editorialGateMessage", () => {
  it("returns only the open Criticals and Importants", () => {
    const r = review({ findings: [finding({ id: "F-1", severity: "Critical" }), finding({ id: "F-2" }), finding({ id: "F-3", severity: "Important", status: "addressed" })], verdict: "needs-fix-round" });
    expect(openFindings(r).map((f) => f.id)).toEqual(["F-1"]);
  });
  it("says what to run for each status", () => {
    expect(editorialGateMessage("missing", 0)).toBe("no editorial review — run synth:review-brief and dispatch a reviewer");
    expect(editorialGateMessage("stale", 0)).toBe("the review predates the current judgment — re-run the review");
    expect(editorialGateMessage("open", 2)).toBe("2 Critical/Important finding(s) open — run synth:prompt --with-review");
  });
});

describe("loadEditorialReview", () => {
  const dir = mkdtempSync(join(tmpdir(), "editorial-"));
  it("returns null for a file that is not there", () => expect(loadEditorialReview(join(dir, "nope.json"))).toBeNull());
  it("parses a well-formed file", () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, JSON.stringify(review()));
    expect(loadEditorialReview(p)!.reviewer).toBe("opus");
  });
  it("throws on a malformed file — malformed is not missing", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(() => loadEditorialReview(bad)).toThrow();
    const wrong = join(dir, "wrong.json");
    writeFileSync(wrong, JSON.stringify({ ...review(), round: 9 }));
    expect(() => loadEditorialReview(wrong)).toThrow();
  });
});

describe("renderEditorialFindings", () => {
  const r = review({
    findings: [
      finding({ id: "F-1", severity: "Critical", field: "sections.financials.incomeCommentary", quote: "up 121%", issue: "the period is wrong", fix: "date it to FY26" }),
      finding({ id: "F-2", severity: "Minor", status: "addressed" }),
      finding({ id: "F-3", severity: "Important", field: "sections.risks.systemic", quote: "the counter-case", issue: "no counter-case", fix: "name the reading that cuts the other way" }),
    ],
    verdict: "needs-fix-round",
  });
  const text = renderEditorialFindings(r);
  it("renders every open finding with severity, field, quote, issue and fix", () => {
    for (const s of ["F-1", "Critical", "sections.financials.incomeCommentary", "up 121%", "the period is wrong", "date it to FY26", "F-3", "Important"]) expect(text).toContain(s);
  });
  it("leaves out findings that are addressed", () => expect(text).not.toContain("F-2"));
  it("names the round and the reviewer", () => {
    expect(text).toContain("round 1");
    expect(text).toContain("opus");
  });
  it("says so when nothing is open", () => expect(renderEditorialFindings(review({ findings: [], verdict: "approved" }))).toMatch(/no open findings/i));
});
