import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { FactPack } from "@/lib/facts/schema";
import { Desk } from "@/lib/synth/desk.schema";
import { judgmentSha256 } from "@/lib/synth/editorial";
import { reviewInputs, LEGACY_ENVELOPE_CALLS } from "@/lib/synth/review-inputs";
import { planBackfill, insertInputsLine, parseBackfillArgs, type BackfillGit, type FindingsFile } from "@/lib/synth/review-backfill";

const FIX = "lib/__fixtures__/review-inputs";
const packText = readFileSync(`${FIX}/AVGO.pack.json`, "utf8");
const judgmentText = readFileSync(`${FIX}/AVGO.judgment.json`, "utf8");
const deskText = readFileSync(`${FIX}/desk.json`, "utf8");
const desk = Desk.parse(JSON.parse(deskText));
const inputsNow = reviewInputs(FactPack.parse(JSON.parse(packText)), desk);

/** A linear history: each commit is an ancestor of every later one; "HEAD" is last. */
const HISTORY = ["0aaaaaa", "1ea28c5", "1bbbbbb", "02d1335", "c0ffee1", "c0ffee2", "HEAD"];
type Tree = Record<string, string>;
function fakeGit(trees: Record<string, Tree>, last: Record<string, string>, dirty = ""): BackfillGit {
  return {
    lastCommit: (p) => last[p] ?? "",
    show: (c, p) => trees[c]?.[p] ?? null,
    isAncestor: (a, b) => HISTORY.indexOf(a) >= 0 && HISTORY.indexOf(a) <= HISTORY.indexOf(b),
    dirtyData: () => dirty,
  };
}
const findingsText = (over: Record<string, unknown> = {}, indent = 2) => JSON.stringify({
  judgmentSha256: judgmentSha256(judgmentText), reviewedAt: "2026-10-01T10:00:00Z", reviewer: "opus", round: 1, verdict: "approved", findings: [], ...over,
}, null, indent) + "\n";
const file = (ticker = "AVGO", accession = "0001730168-26-000080", text = findingsText()): FindingsFile =>
  ({ ticker, accession, path: `data/judgment/${ticker}/${accession}.editorial.json`, text, published: true });
const treeFor = (f: FindingsFile, over: Partial<{ pack: string | null; judgment: string; desk: string }> = {}): Tree => {
  const t: Tree = {
    [`data/judgment/${f.ticker}/${f.accession}.json`]: over.judgment ?? judgmentText,
    "data/desk/desk.json": over.desk ?? deskText,
  };
  if (over.pack !== null) t[`data/facts/${f.ticker}/${f.accession}.json`] = over.pack ?? packText;
  return t;
};
const plan = (files: FindingsFile[], git: BackfillGit, over: Partial<Parameters<typeof planBackfill>[0]> = {}) =>
  planBackfill({ files, git, cutoff: "c0ffee2", apply: false, headPackText: () => packText, current: () => inputsNow, ...over });

describe("planBackfill", () => {
  it("stamps an unstamped file from its review commit, with the backfill source, and reports clean", () => {
    const f = file();
    const p = plan([f], fakeGit({ c0ffee1: treeFor(f) }, { [f.path]: "c0ffee1" }));
    expect(p.refused).toBeUndefined();
    expect(p.files[0].outcome).toMatchObject({ kind: "stamp", commit: "c0ffee1", changed: [], stamp: { ...inputsNow, source: "backfill:c0ffee1" } });
  });
  it("reports a file whose pack moved since its review as stale on facts", () => {
    const f = file();
    const old = JSON.parse(packText); old.ttm.netMargin += 0.01;
    const p = plan([f], fakeGit({ c0ffee1: treeFor(f, { pack: JSON.stringify(old) }) }, { [f.path]: "c0ffee1" }));
    expect(p.files[0].outcome).toMatchObject({ kind: "stamp", changed: ["facts"] });
  });
  it("skips an already-stamped file", () => {
    const f = file(undefined, undefined, findingsText({ inputs: inputsNow }));
    expect(plan([f], fakeGit({}, {})).files[0].outcome).toEqual({ kind: "skipped", reason: "already stamped" });
  });
  it("skips a file whose judgment at the review commit does not match its hash", () => {
    const f = file();
    const p = plan([f], fakeGit({ c0ffee1: treeFor(f, { judgment: judgmentText + " " }) }, { [f.path]: "c0ffee1" }));
    expect(p.files[0].outcome).toMatchObject({ kind: "skipped", reason: expect.stringMatching(/does not hash/) });
  });
  it("skips a file whose pack is missing at the review commit", () => {
    const f = file();
    expect(plan([f], fakeGit({ c0ffee1: treeFor(f, { pack: null }) }, { [f.path]: "c0ffee1" })).files[0].outcome).toMatchObject({ kind: "skipped", reason: expect.stringMatching(/missing/) });
  });

  describe("the cutoff (R-6)", () => {
    const f = file();
    const git = fakeGit({ c0ffee2: treeFor(f) }, { [f.path]: "c0ffee2" });
    it("unset: --apply is refused, and a dry run uses HEAD", () => {
      expect(plan([f], git, { cutoff: null, apply: true }).refused).toMatch(/BACKFILL_CUTOFF is unset/);
      const dry = plan([f], git, { cutoff: null });
      expect(dry.cutoff).toBe("HEAD");
      expect(dry.refused).toBeUndefined();
      expect(dry.files[0].outcome.kind).toBe("stamp");
    });
    it("set: a review commit that is not an ancestor of it is refused, and the run fails", () => {
      const p = plan([f], git, { cutoff: "c0ffee1", apply: true });
      expect(p.files[0].outcome).toMatchObject({ kind: "refused", reason: expect.stringMatching(/not an ancestor of the cutoff c0ffee1/) });
      expect(p.refused).toMatch(/1 file\(s\) refused/);
    });
    it("no argument can change it", () => {
      expect(parseBackfillArgs(["--cutoff", "x"])).toEqual({ error: "unknown argument --cutoff" });
      expect(parseBackfillArgs(["--cutoff=x"])).toEqual({ error: "unknown argument --cutoff=x" });
      expect(parseBackfillArgs(["--apply", "nbix"])).toEqual({ apply: true, tickers: ["NBIX"] });
    });
  });

  it("refuses a dirty data tree", () => {
    expect(plan([file()], fakeGit({}, {}, " M data/facts/AVGO/x.json")).refused).toMatch(/uncommitted changes/);
  });

  it("refuses a review commit between the rating block and the Calls render", () => {
    const f = file();
    expect(plan([f], fakeGit({ "1bbbbbb": treeFor(f) }, { [f.path]: "1bbbbbb" })).files[0].outcome).toMatchObject({ kind: "refused", reason: expect.stringMatching(/between 1ea28c5 and 02d1335/) });
  });

  it("reports schema-default blocks: absent desk and pack keys, flagging one inside a component", () => {
    const f = file();
    const d = JSON.parse(deskText); delete d.recurringTraps;
    const head = JSON.parse(packText); head.context.mdaExcerpt.truncated = true;                 // HEAD has the flag…
    const then = JSON.parse(packText); delete then.beta; delete then.context.mdaExcerpt.truncated; // …the commit lacked it
    const p = plan([f], fakeGit({ c0ffee1: treeFor(f, { pack: JSON.stringify(then), desk: JSON.stringify(d) }) }, { [f.path]: "c0ffee1" }), { headPackText: () => JSON.stringify(head) });
    expect(p.deskDefaults).toEqual({ recurringTraps: ["AVGO/0001730168-26-000080"] });
    expect(Object.keys(p.packAbsent).sort()).toEqual(["beta", "context.mdaExcerpt.truncated"]);
    expect(p.flagged).toEqual(["AVGO/0001730168-26-000080: context.mdaExcerpt.truncated"]);
  });

  describe("pre-rating reviews (D6)", () => {
    const noRating = (() => { const d = JSON.parse(deskText); delete d.rating; return JSON.stringify(d); })();
    const run = (ticker: string, accession: string) => {
      const f = file(ticker, accession);
      return plan([f], fakeGit({ c0ffee1: treeFor(f, { desk: noRating }) }, { [f.path]: "c0ffee1" }));
    };
    it("a sentinel review gets the legacy calls stamp, always stale on calls", () => {
      const p = run("BAC", "0000070858-26-000394");
      expect(p.files[0].outcome).toMatchObject({ kind: "stamp", preRating: "sentinel", changed: ["calls"], stamp: { calls: LEGACY_ENVELOPE_CALLS, source: "backfill:c0ffee1" } });
    });
    it("an accepted review gets today's calls with the owner-accept source", () => {
      const p = run("UEC", "0001437749-26-019889");
      expect(p.files[0].outcome).toMatchObject({ kind: "stamp", preRating: "accept", changed: [], stamp: { calls: inputsNow.calls, source: "owner-accept:pre-rating" } });
    });
    it("a pre-rating review in neither list is refused", () => {
      const p = run("AVGO", "0001730168-26-000080");
      expect(p.files[0].outcome).toMatchObject({ kind: "refused", reason: expect.stringMatching(/not ruled on/) });
      expect(p.refused).toBeDefined();
    });
  });
});

describe("BACKFILL_CUTOFF in scripts/backfill-review-inputs.ts", () => {
  // Read from source: the script runs on import. Set in the switch-over commit to its parent; never edited on its own.
  const src = readFileSync("scripts/backfill-review-inputs.ts", "utf8");
  const m = /^export const BACKFILL_CUTOFF: string \| null = (.+);$/m.exec(src);
  it("is a 40-hex SHA, so --apply is enabled from the switch-over on", () => expect(m?.[1]).toMatch(/^"[0-9a-f]{40}"$/));
  it("is an ancestor of HEAD", () => {
    const sha = JSON.parse(m![1]) as string;
    expect(() => execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" })).not.toThrow();
  });
});

describe("insertInputsLine", () => {
  const stamp = { ...inputsNow, source: "backfill:c0ffee1" };
  it("keeps two-space and four-space layouts and CRLF, and adds exactly one line", () => {
    const crwd = findingsText({}, 4).replace('"judgmentSha256": ', '"judgmentSha256":  ');
    for (const base of [findingsText(), crwd]) for (const eol of ["\n", "\r\n"]) {
      const text = base.replace(/\n/g, eol);
      const out = insertInputsLine(text, stamp);
      const [a, b] = [text.split(eol), out.split(eol)];
      expect(b.length).toBe(a.length + 1);
      const i = a.findIndex((l) => l.includes('"judgmentSha256"'));
      expect(b.slice(0, i + 1)).toEqual(a.slice(0, i + 1));
      expect(b.slice(i + 2)).toEqual(a.slice(i + 1));
      expect(b[i + 1]).toBe(`${a[i].match(/^\s*/)![0]}"inputs": ${JSON.stringify(stamp)},`);
      expect(JSON.parse(out)).toEqual({ ...JSON.parse(text), inputs: stamp });
      if (eol === "\r\n") expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    }
  });
  it("refuses a file without exactly one judgmentSha256 line", () => {
    expect(() => insertInputsLine(`{ "judgmentSha256": "${"a".repeat(64)}", "round": 1 }`, stamp)).toThrow(/exactly one/);
  });
});
