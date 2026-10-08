/**
 * review-backfill.ts — stamp the findings files written before reviews carried `inputs`, from git at each review commit.
 * -----------------------------------------------------------------------------
 * Pure: git is injected. For each unstamped file, the review commit is the last commit touching it; the pack, judgment
 * and desk there give the inputs that review read, computed with HEAD code (102 of 102 published reports reproduce what
 * their reviewers saw). Already-stamped files are skipped, so the run is idempotent. The run refuses on a dirty data
 * tree, on a review made after the cutoff (it must carry the reviewer's own copy), and on a pre-rating review the owner
 * has not ruled on (decision D6). The insert is textual: one line after `judgmentSha256`, in the file's own layout and
 * EOL. Plan: 2026-10-08-review-fingerprint.md, Section 3 and Task 7.
 */
import { FactPack } from "../facts/schema";
import { projectReportFacts } from "../facts/project";
import { Desk } from "./desk.schema";
import { EditorialReview, readInputsStamp, type ReviewInputsStamp } from "./editorial.schema";
import { judgmentSha256 } from "./editorial";
import { canon, changedComponents, inputsLine, reviewInputs, LEGACY_ENVELOPE_CALLS, type Component, type ReviewInputs } from "./review-inputs";

/** Desk `rating` arrived in 1ea28c5 and the Calls block began rendering it in 02d1335; no review falls between them. */
export const RATING_BLOCK_ADDED = "1ea28c5";
export const CALLS_FROM_RATING = "02d1335";

/** D6, final: pre-rating reviews whose prose argues the retired envelope get a calls stamp that is always stale. */
export const PRE_RATING_SENTINEL = [
  "BAC 0000070858-26-000394", "CBRS 0001628280-26-056357", "HON 0000773840-26-000124", "KTOS 0001069258-26-000077", "T 0000732717-26-000297",
];
/** D6, final: pre-rating reviews the owner accepted under today's rule without a re-review. */
export const PRE_RATING_ACCEPT = [
  "EWBC 0001069157-26-000044", "INTC 0000050863-26-000157", "JPM 0001628280-26-054343", "ORCL 0001193125-26-389274", "UEC 0001437749-26-019889",
];
export const OWNER_ACCEPT_SOURCE = "owner-accept:pre-rating";

export interface BackfillGit {
  /** The last commit touching the path (`git log -1 --format=%h`); "" when none. */
  lastCommit(path: string): string;
  /** The file at a commit; null when absent there. */
  show(commit: string, path: string): string | null;
  isAncestor(ancestor: string, descendant: string): boolean;
  /** `git status --porcelain` for data/facts, data/judgment and data/desk. */
  dirtyData(): string;
}

export interface FindingsFile { ticker: string; accession: string; path: string; text: string; published: boolean }

export type FileOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "refused"; reason: string }
  | { kind: "stamp"; commit: string; stamp: ReviewInputsStamp; text: string; changed: Component[]; preRating?: "sentinel" | "accept" };

export interface BackfillPlan {
  /** A whole-run refusal (nothing is applied). */
  refused?: string;
  cutoff: string;
  files: (FindingsFile & { outcome: FileOutcome })[];
  /** Top-level desk.json keys absent at a review commit (HEAD's schema fills them), by key. */
  deskDefaults: Record<string, string[]>;
  /** Pack keys absent at a review commit but present at HEAD, by key path. */
  packAbsent: Record<string, string[]>;
  /** Of those, the ones whose presence moves a fingerprint component. */
  flagged: string[];
}

const SHA_LINE = /^(\s*)"judgmentSha256"\s*:\s*"[0-9a-f]{64}"\s*,\s*$/;

/** Insert `"inputs": …,` after the judgmentSha256 line, with its indentation and the file's EOL; exactly one line added. */
export function insertInputsLine(text: string, stamp: ReviewInputsStamp): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const at = lines.flatMap((l, i) => (SHA_LINE.test(l) ? [i] : []));
  if (at.length !== 1) throw new Error(`expected exactly one judgmentSha256 line, found ${at.length}`);
  const indent = SHA_LINE.exec(lines[at[0]])![1];
  const line = JSON.stringify({ ...JSON.parse(inputsLine(stamp)), ...(stamp.source ? { source: stamp.source } : {}) });
  const out = [...lines.slice(0, at[0] + 1), `${indent}"inputs": ${line},`, ...lines.slice(at[0] + 1)].join(eol);
  const before = JSON.parse(text) as Record<string, unknown>, after = JSON.parse(out) as Record<string, unknown>;
  const { inputs, ...rest } = after;
  if (JSON.stringify(rest) !== JSON.stringify(before) || canon(inputs) !== canon(stamp) || out.split(eol).length !== lines.length + 1)
    throw new Error("the inserted text does not parse to the original plus inputs");
  return out;
}

const DESK_KEYS = Object.keys(Desk.shape);
/** Keys present in `head` and absent in `then`, recursing only where both hold an object (the probe's rule). */
function absentKeys(head: unknown, then: unknown, pre = ""): string[] {
  if (!head || typeof head !== "object" || Array.isArray(head)) return [];
  return Object.keys(head).flatMap((k) => {
    const t = then as Record<string, unknown> | null | undefined;
    return t == null || !(k in t) ? [pre + k] : absentKeys((head as Record<string, unknown>)[k], t[k], `${pre}${k}.`);
  });
}
const getPath = (o: unknown, path: string[]) => path.reduce<unknown>((x, k) => (x == null ? undefined : (x as Record<string, unknown>)[k]), o);

export function planBackfill(input: {
  files: FindingsFile[];
  git: BackfillGit;
  cutoff: string | null;
  apply: boolean;
  /** HEAD's raw pack text for an accession (for the absent-key report); null when absent. */
  headPackText: (ticker: string, accession: string) => string | null;
  /** Today's inputs for an accession (the working pack and desk), to report clean or stale; null when the pack is gone. */
  current: (ticker: string, accession: string) => ReviewInputs | null;
}): BackfillPlan {
  const { files, git, apply, headPackText, current } = input;
  const cutoff = input.cutoff ?? "HEAD";
  const plan: BackfillPlan = { cutoff, files: [], deskDefaults: {}, packAbsent: {}, flagged: [] };
  if (apply && input.cutoff == null) return { ...plan, refused: "BACKFILL_CUTOFF is unset: only a dry run (provisional cutoff HEAD) is allowed" };
  const dirty = git.dirtyData().trim();
  if (dirty) return { ...plan, refused: `uncommitted changes under data/facts, data/judgment or data/desk:\n${dirty}` };
  const note = (into: Record<string, string[]>, key: string, who: string) => { (into[key] ??= []).push(who); };

  for (const f of files) {
    const done = (outcome: FileOutcome) => plan.files.push({ ...f, outcome });
    const who = `${f.ticker}/${f.accession}`;
    const review = EditorialReview.parse(JSON.parse(f.text));
    if ("stamp" in readInputsStamp(review)) { done({ kind: "skipped", reason: "already stamped" }); continue; }
    const commit = git.lastCommit(f.path);
    if (!commit) { done({ kind: "skipped", reason: "never committed" }); continue; }
    if (!git.isAncestor(commit, cutoff)) { done({ kind: "refused", reason: `review commit ${commit} is not an ancestor of the cutoff ${cutoff}: it must carry the reviewer's own copy` }); continue; }
    if (git.isAncestor(RATING_BLOCK_ADDED, commit) && !git.isAncestor(CALLS_FROM_RATING, commit)) {
      done({ kind: "refused", reason: `review commit ${commit} falls between ${RATING_BLOCK_ADDED} and ${CALLS_FROM_RATING}` }); continue;
    }
    const packText = git.show(commit, `data/facts/${f.ticker}/${f.accession}.json`);
    const judgmentText = git.show(commit, `data/judgment/${f.ticker}/${f.accession}.json`);
    const deskText = git.show(commit, "data/desk/desk.json");
    if (packText == null || judgmentText == null || deskText == null) { done({ kind: "skipped", reason: `pack, judgment or desk missing at ${commit}` }); continue; }
    if (judgmentSha256(judgmentText) !== review.judgmentSha256) { done({ kind: "skipped", reason: `the judgment at ${commit} does not hash to the review's judgmentSha256` }); continue; }

    const deskRaw = JSON.parse(deskText) as Record<string, unknown>;
    const packRaw = JSON.parse(packText) as Record<string, unknown>;
    const pack = FactPack.parse(packRaw), desk = Desk.parse(deskRaw), facts = projectReportFacts(pack);
    const then = reviewInputs(pack, desk, facts);
    // R-4: blocks HEAD's schemas fill by default, and pack keys absent then but present now.
    for (const k of DESK_KEYS.filter((k) => !(k in deskRaw))) note(plan.deskDefaults, k, who);
    const headText = headPackText(f.ticker, f.accession);
    const head: unknown = headText == null ? null : JSON.parse(headText);
    for (const k of absentKeys(head, packRaw)) {
      note(plan.packAbsent, k, who);
      // Inside a component when filling it in from HEAD would move the inputs computed at the commit.
      const filled = structuredClone(packRaw);
      const path = k.split(".");
      (getPath(filled, path.slice(0, -1)) as Record<string, unknown>)[path.at(-1)!] = getPath(head, path);
      const p = FactPack.safeParse(filled);
      if (!p.success || changedComponents(then, reviewInputs(p.data, desk)).length) plan.flagged.push(`${who}: ${k}`);
    }

    let stamp: ReviewInputsStamp = { ...then, source: `backfill:${commit}` };
    let preRating: "sentinel" | "accept" | undefined;
    if (!("rating" in deskRaw)) {
      const key = `${f.ticker} ${f.accession}`;
      if (PRE_RATING_SENTINEL.includes(key)) { stamp = { ...stamp, calls: LEGACY_ENVELOPE_CALLS }; preRating = "sentinel"; }
      else if (PRE_RATING_ACCEPT.includes(key)) {
        const now = current(f.ticker, f.accession);
        if (!now) { done({ kind: "refused", reason: "owner-accepted pre-rating review with no current pack" }); continue; }
        stamp = { ...then, calls: now.calls, source: OWNER_ACCEPT_SOURCE }; preRating = "accept";
      } else { done({ kind: "refused", reason: `pre-rating review (desk at ${commit} has no rating block) that the owner has not ruled on (D6)` }); continue; }
    }
    const now = current(f.ticker, f.accession);
    done({ kind: "stamp", commit, stamp, text: insertInputsLine(f.text, stamp), changed: now ? changedComponents(stamp, now) : ["facts", "calls", "context"], ...(preRating ? { preRating } : {}) });
  }
  const refusedFiles = plan.files.filter((f) => f.outcome.kind === "refused");
  if (refusedFiles.length) plan.refused = `${refusedFiles.length} file(s) refused`;
  return plan;
}

export const BACKFILL_USAGE = "usage: node --import tsx scripts/backfill-review-inputs.ts [--apply] [TICKER ...]";
/** Only --apply and tickers: there is no cutoff argument (the cutoff is the script's BACKFILL_CUTOFF constant). */
export function parseBackfillArgs(argv: string[]): { apply: boolean; tickers: string[] } | { error: string } {
  const bad = argv.filter((a) => a.startsWith("-") && a !== "--apply");
  if (bad.length) return { error: `unknown argument ${bad[0]}` };
  const tickers = argv.filter((a) => !a.startsWith("-"));
  if (tickers.some((t) => !/^[A-Za-z][A-Za-z0-9.-]*$/.test(t))) return { error: `not a ticker: ${tickers.find((t) => !/^[A-Za-z][A-Za-z0-9.-]*$/.test(t))}` };
  return { apply: argv.includes("--apply"), tickers: tickers.map((t) => t.toUpperCase()) };
}
