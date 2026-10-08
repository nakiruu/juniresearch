import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorialReview } from "@/lib/synth/editorial.schema";
import { judgmentSha256, loadEditorialReview, openFindings, reviewStatus, editorialGateMessage, renderEditorialFindings, malformedReviewMessage, reviewVerdict, reviewVerdictMessage, verdictLabel } from "@/lib/synth/editorial";
import { LEGACY_ENVELOPE_CALLS, type ReviewInputs } from "@/lib/synth/review-inputs";

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

describe("malformedReviewMessage", () => {
  it("names the parse error and tells the caller to fix or delete the file", () => {
    let caught: unknown;
    try { JSON.parse("{ not json"); } catch (e) { caught = e; }
    const message = malformedReviewMessage("data/judgment/AVGO/x.editorial.json", caught);
    expect(message).toContain("malformed editorial review:");
    expect(message).toContain((caught as Error).message);
    expect(message).toContain("data/judgment/AVGO/x.editorial.json");
    expect(message).toMatch(/fix or delete/);
  });
  it("stringifies a non-Error throw rather than losing it", () => {
    expect(malformedReviewMessage("p.json", "boom")).toContain("boom");
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

describe("reviewVerdict", () => {
  const cur: ReviewInputs = { scheme: 1, facts: "1".repeat(64), calls: "2".repeat(64), context: "3".repeat(64) };
  const stamped = (inputs: unknown, over: Record<string, unknown> = {}) => review({ inputs, ...over });
  const at = () => cur;
  const req = { requireInputs: true };
  it("is missing with no file", () => expect(reviewVerdict(TEXT, null, at, req)).toEqual({ status: "missing" }));
  it("puts the judgment first: a stale judgment wins over unstamped and stale inputs", () => {
    expect(reviewVerdict(TEXT + "x", review(), at, req)).toEqual({ status: "stale", changed: ["judgment"] });
    expect(reviewVerdict(TEXT + "x", stamped({ ...cur, facts: "9".repeat(64) }), at, req)).toEqual({ status: "stale", changed: ["judgment"] });
  });
  it("is unstamped when the stamp is missing or malformed and inputs are required", () => {
    expect(reviewVerdict(TEXT, review(), at, req)).toMatchObject({ status: "unstamped", unstamped: "missing" });
    expect(reviewVerdict(TEXT, stamped({ ...cur, facts: "x" }), at, req)).toMatchObject({ status: "unstamped", unstamped: expect.stringMatching(/^mis-copied: facts/) });
  });
  it("puts unstamped before open findings", () =>
    expect(reviewVerdict(TEXT, review({ findings: [finding({ severity: "Critical" })], verdict: "needs-fix-round" }), at, req).status).toBe("unstamped"));
  it("treats an unstamped review as today's status when inputs are not required", () => {
    expect(reviewVerdict(TEXT, review(), at, { requireInputs: false })).toEqual({ status: "clean" });
    expect(reviewVerdict(TEXT, stamped("junk"), at, { requireInputs: false })).toEqual({ status: "clean" });
  });
  it("is stale on inputs and names the components that moved", () => {
    expect(reviewVerdict(TEXT, stamped({ ...cur, facts: "9".repeat(64) }), at, req)).toEqual({ status: "stale", changed: ["facts"] });
    expect(reviewVerdict(TEXT, stamped({ ...cur, calls: "9".repeat(64), context: "8".repeat(64) }), at, req)).toEqual({ status: "stale", changed: ["calls", "context"] });
  });
  it("puts stale inputs before open findings, and is open or clean once the inputs match", () => {
    expect(reviewVerdict(TEXT, stamped({ ...cur, facts: "9".repeat(64) }, { findings: [finding({ severity: "Critical" })], verdict: "needs-fix-round" }), at, req).status).toBe("stale");
    expect(reviewVerdict(TEXT, stamped(cur, { findings: [finding({ severity: "Critical" })], verdict: "needs-fix-round" }), at, req)).toEqual({ status: "open" });
    expect(reviewVerdict(TEXT, stamped({ ...cur, source: "backfill:abc1234" }), at, req)).toEqual({ status: "clean" });
  });
  it("recomputes under the stamp's scheme", () => {
    const schemes: number[] = [];
    reviewVerdict(TEXT, stamped(cur), (s) => { schemes.push(s); return cur; }, req);
    expect(schemes).toEqual([1]);
  });
  describe("the hint, anchored on the brief's copy block", () => {
    const sha = judgmentSha256(TEXT);
    const bad = stamped({ ...cur, facts: "9".repeat(64) });
    const hint = (r: ReturnType<typeof review>, brief: { judgmentSha256: string; inputs: ReviewInputs } | null | undefined) =>
      reviewVerdict(TEXT, r, at, { ...req, brief }).hint;
    it("gives none without a brief, or for a legacy brief (null)", () => {
      expect(hint(bad, undefined)).toBeUndefined();
      expect(hint(bad, null)).toBeUndefined();
    });
    it("says mis-copied when the brief told the reviewer to copy today's inputs and the stamp differs", () =>
      expect(hint(bad, { judgmentSha256: sha, inputs: cur })).toMatch(/differs from the brief's copy block.*mis-copied; continue the reviewer to re-copy/));
    it("never suggests re-copying when the brief's inputs differ from today's: it says re-review", () => {
      for (const s of [bad, stamped({ ...cur, facts: "8".repeat(64) })]) {
        const h = hint(s, { judgmentSha256: sha, inputs: { ...cur, facts: "9".repeat(64) } });
        expect(h).toMatch(/re-render the brief and re-review/);
        expect(h).not.toMatch(/re-copy/);
      }
    });
    it("gives none for a brief of another judgment, or a stamp nobody copied", () => {
      expect(hint(bad, { judgmentSha256: "c".repeat(64), inputs: cur })).toBeUndefined();
      expect(hint(stamped({ ...cur, facts: "9".repeat(64), source: "backfill:abc1234" }), { judgmentSha256: sha, inputs: cur })).toBeUndefined();
    });
  });
  it("names the retired envelope for a legacy calls stamp", () =>
    expect(reviewVerdict(TEXT, stamped({ ...cur, calls: LEGACY_ENVELOPE_CALLS, source: "backfill:abc1234" }), at, req)).toMatchObject({ status: "stale", changed: ["calls"], hint: expect.stringMatching(/pre-rating envelope/) }));
  it("leaves reviewStatus as it was", () => expect(reviewStatus(TEXT, review())).toBe("clean"));
});

describe("verdictLabel", () => {
  it("is the status, with what moved or why it is unstamped", () => {
    expect(verdictLabel({ status: "clean" })).toBe("clean");
    expect(verdictLabel({ status: "open" })).toBe("open");
    expect(verdictLabel({ status: "missing" })).toBe("missing");
    expect(verdictLabel({ status: "stale", changed: ["facts", "calls"] })).toBe("stale (facts, calls)");
    expect(verdictLabel({ status: "stale", changed: ["judgment"] })).toBe("stale (judgment)");
    expect(verdictLabel({ status: "unstamped", unstamped: "missing" })).toBe("unstamped (missing)");
  });
});

describe("reviewVerdictMessage", () => {
  it("keeps the judgment, missing and open messages", () => {
    expect(reviewVerdictMessage({ status: "stale", changed: ["judgment"] }, 0)).toBe(editorialGateMessage("stale", 0));
    expect(reviewVerdictMessage({ status: "missing" }, 0)).toBe(editorialGateMessage("missing", 0));
    expect(reviewVerdictMessage({ status: "open" }, 2)).toBe(editorialGateMessage("open", 2));
  });
  it("names the inputs that changed and what to run", () => {
    const m = reviewVerdictMessage({ status: "stale", changed: ["facts"] }, 0);
    expect(m).toBe("the review predates the current inputs (facts changed) — rebuild with --skip-review, re-render the brief (it will be a full brief) and re-run the review");
    expect(reviewVerdictMessage({ status: "stale", changed: ["calls", "context"], hint: "HINT" }, 0)).toMatch(/\(calls, context changed\).* — HINT$/);
  });
  it("tells an unstamped review to continue the same reviewer, distinguishing missing from mis-copied, and never has the orchestrator copy", () => {
    const missing = reviewVerdictMessage({ status: "unstamped", unstamped: "missing" }, 0);
    const bad = reviewVerdictMessage({ status: "unstamped", unstamped: "mis-copied: facts: Invalid string" }, 0);
    expect(missing).toMatch(/no valid `inputs` \(missing\)/);
    expect(bad).toMatch(/no valid `inputs` \(mis-copied: facts: Invalid string\)/);
    for (const m of [missing, bad]) {
      expect(m).toMatch(/continue the same reviewer to re-copy it from the `Inputs fingerprint` line of prompt\.md/);
      expect(m).toMatch(/re-render the brief and re-run the review/);
      expect(m).toMatch(/never copy or edit `inputs` on the reviewer's behalf/i);
      expect(m).not.toMatch(/orchestrator (should )?(re-)?cop/i);
    }
  });
});
