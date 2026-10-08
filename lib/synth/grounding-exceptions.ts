/**
 * grounding-exceptions.ts — the owner-approved, shrink-only list of published figures the grounding lint may waive.
 * -----------------------------------------------------------------------------
 * The typed grounding lint (plan 2026-10-07) fails figures in a few reports that were reviewed and published under the
 * old lint. Editing a judgment after review would void the review, so those figures are waived here instead, each one
 * keyed to the exact judgment text (judgmentSha256, as the editorial gate hashes it) and the exact rendered surface
 * (surfaceSha256). Any edit to either lapses the entry and the figure must pass on its own.
 *
 * Two guards keep the list from growing quietly:
 *   - synth:build applies the file only when the working copy is byte-equal to both refs/heads/main's and
 *     refs/remotes/origin/main's copies; otherwise it applies none (fail closed), so a branch cannot except its own
 *     figures before a reviewed merge and push;
 *   - grounding-exceptions.test.ts pins every entry's key to a literal list, so adding one is a reviewed code change.
 * The fix queue removes entries as reports are re-synthesized; the file is deleted when it is empty.
 *
 * Re-keying: the surface hash covers the rendered text, so ANY wording change in renderFactsBlock, renderCalls,
 * renderJudgmentBlock or renderContextBlock lapses every entry, even a change with no figure in it. The commit that makes
 * such a change re-keys in the same commit: it runs `grounding:sweep --propose-exceptions`, lists old key → new key one
 * for one in its message, and keeps every judgment SHA unchanged (the pin test checks the judgment-SHA multiset).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { ValidationIssue } from "../validate";
import type { LintIssue } from "./lint";
import type { GroundingSurface } from "./grounding";

export const EXCEPTIONS_PATH = "lib/synth/grounding-exceptions.json";
export const EXCEPTIONS_IGNORED_DIFFERS = "grounding exceptions ignored: file differs from main or origin/main";
export const EXCEPTIONS_IGNORED_UNREADABLE = "grounding exceptions ignored: refs/heads/main or refs/remotes/origin/main has no readable copy (not merged and pushed yet, or no git)";
export const EXCEPTIONS_IGNORED_WORKING = "grounding exceptions ignored: the working copy is unreadable";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
export const GroundingException = z.strictObject({
  ticker: z.string().regex(/^[A-Z][A-Z0-9.-]*$/),
  accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  judgmentSha256: SHA256,
  surfaceSha256: SHA256,
  check: z.enum(["grounding", "lint/figure-repeat"]),
  field: z.string().min(1),
  raw: z.string().min(1),
  class: z.enum(["true-positive", "false-positive", "policy"]),
  reason: z.string().min(1).max(300),
  approvedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GroundingException = z.infer<typeof GroundingException>;
export const GroundingExceptionsFile = z.strictObject({ note: z.string().optional(), entries: z.array(GroundingException) });

/** Every field an entry matches on; the pin test lists these literally. */
export const exceptionKey = (e: GroundingException) => [e.ticker, e.accession, e.judgmentSha256, e.surfaceSha256, e.check, e.field, e.raw].join("|");

/** SHA-256 of the rendered Facts, Calls, judgment and Context blocks: what the author saw and the reviewer approved. */
export function surfaceSha256(s: GroundingSurface): string {
  return createHash("sha256").update(s.factsBlock + s.callsBlock + s.judgmentBlock + s.contextBlock, "utf8").digest("hex");
}

export interface ExceptionReaders {
  readWorking: () => Buffer | string | null;   // null when the file is absent
  readMain: () => Buffer | string;             // refs/heads/main's copy; throws when it has none, or git is unavailable
  readOriginMain: () => Buffer | string;       // refs/remotes/origin/main's copy; likewise
}

/** Fully qualified, so a tag or branch named "main" cannot shadow them. */
export const MAIN_REFS = ["refs/heads/main", "refs/remotes/origin/main"] as const;

/** The production readers: the working copy, and the two refs' copies through git. */
export const gitReaders = (
  path = EXCEPTIONS_PATH,
  run: (args: string[]) => Buffer = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }),
): ExceptionReaders => ({
  readWorking: () => (existsSync(path) ? readFileSync(path) : null),
  readMain: () => run(["show", `${MAIN_REFS[0]}:${path}`]),
  readOriginMain: () => run(["show", `${MAIN_REFS[1]}:${path}`]),
});

/**
 * The entries to apply: only those of a working file byte-equal to both main's and origin/main's copies, so a moved
 * local main or a wip branch excepts nothing. This guards against accidents and wip branches, not a hostile shell: the
 * real control is the reviewed merge plus push. Anything unreadable fails closed with a warning; a malformed file that
 * both refs hold throws (the build stops at the exceptions stage).
 */
export function loadExceptions(r: ExceptionReaders): { entries: GroundingException[]; warning?: string } {
  let working: Buffer | string | null;
  try { working = r.readWorking(); } catch (e) { return { entries: [], warning: `${EXCEPTIONS_IGNORED_WORKING}: ${(e as Error).message}` }; }
  if (working == null) return { entries: [] };
  let main: Buffer, originMain: Buffer;
  try { main = Buffer.from(r.readMain()); originMain = Buffer.from(r.readOriginMain()); }
  catch { return { entries: [], warning: EXCEPTIONS_IGNORED_UNREADABLE }; }
  const bytes = Buffer.from(working);
  if (!bytes.equals(main) || !bytes.equals(originMain)) return { entries: [], warning: EXCEPTIONS_IGNORED_DIFFERS };
  return { entries: GroundingExceptionsFile.parse(JSON.parse(bytes.toString("utf8"))).entries };
}

const GROUNDING_MISS = /^".*" is not in the facts or the captured context/;
const checkOf = (i: ValidationIssue | LintIssue): GroundingException["check"] | null =>
  "rule" in i ? (i.rule === "figure-repeat" ? "lint/figure-repeat" : null) : GROUNDING_MISS.test(i.message) ? "grounding" : null;

/**
 * Waives each error a matching entry covers, as an owner-approved warning. An entry for this accession that covers
 * nothing — its judgment or surface changed, or the figure was fixed — is stale.
 */
export function applyExceptions<T extends ValidationIssue | LintIssue>(
  issues: T[], ctx: { ticker: string; accession: string; judgmentSha256: string; surfaceSha256: string }, entries: GroundingException[],
): { errors: T[]; warnings: LintIssue[]; matched: GroundingException[]; stale: GroundingException[] } {
  const mine = entries.filter((e) => e.ticker === ctx.ticker && e.accession === ctx.accession);
  const live = mine.filter((e) => e.judgmentSha256 === ctx.judgmentSha256 && e.surfaceSha256 === ctx.surfaceSha256);
  const errors: T[] = [], warnings: LintIssue[] = [], matched = new Set<GroundingException>();
  for (const i of issues) {
    const check = checkOf(i);
    const e = check && live.find((x) => x.check === check && x.field === i.field && x.raw === String(i.value));
    if (!e) { errors.push(i); continue; }
    matched.add(e);
    warnings.push({ rule: "grounding-exception", severity: "warning", field: i.field, value: i.value, message: `grounding exception (owner-approved, ${e.class}): ${e.reason}` });
  }
  return { errors, warnings, matched: [...matched], stale: mine.filter((e) => !matched.has(e)) };
}
