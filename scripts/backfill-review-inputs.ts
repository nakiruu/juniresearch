/**
 * backfill-review-inputs.ts — stamp the findings files written before reviews carried `inputs` (plan 2026-10-08, S-3).
 *
 *   node --import tsx scripts/backfill-review-inputs.ts [--apply] [TICKER ...]
 *
 * Dry run by default: prints each file as clean or stale (components) against today's inputs, then a summary and the
 * schema-default report. --apply writes the one-line inserts; it is refused while BACKFILL_CUTOFF is unset, on a dirty
 * data tree, and when any file is refused (a review after the cutoff, or a pre-rating review outside D6's lists). There
 * is no cutoff argument: reviews after BACKFILL_CUTOFF went through the new brief and carry the reviewer's own copy.
 * Re-run the dry run immediately before merging: every file must be skipped as stamped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { Desk } from "../lib/synth/desk.schema";
import { reviewInputs } from "../lib/synth/review-inputs";
import { planBackfill, parseBackfillArgs, BACKFILL_USAGE, type BackfillGit, type FindingsFile } from "../lib/synth/review-backfill";

/** Set once, in the switch-over commit, to that commit's parent; never edited on its own. null: dry run only. */
export const BACKFILL_CUTOFF: string | null = "4322742b1a049d0be8046457ee6db9b6913283c6";

const parsed = parseBackfillArgs(process.argv.slice(2));
if ("error" in parsed) { console.error(`${parsed.error}\n${BACKFILL_USAGE}`); process.exit(2); }

const run = (args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const git: BackfillGit = {
  lastCommit: (p) => run(["log", "-1", "--format=%h", "--", p]).trim(),
  show: (c, p) => { try { return run(["show", `${c}:${p}`]); } catch { return null; } },
  isAncestor: (a, b) => { try { run(["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; } },
  dirtyData: () => run(["status", "--porcelain", "--", "data/facts", "data/judgment", "data/desk"]),
};

const files: FindingsFile[] = [];
for (const t of readdirSync(join("data", "judgment")).sort()) {
  if (parsed.tickers.length && !parsed.tickers.includes(t)) continue;
  const report = join("data", `${t.toLowerCase()}.json`);
  const publishedAcc = existsSync(report) ? (JSON.parse(readFileSync(report, "utf8")).meta?.filing?.accession as string | undefined) : undefined;
  for (const f of readdirSync(join("data", "judgment", t)).filter((x) => x.endsWith(".editorial.json")).sort()) {
    const accession = f.replace(/\.editorial\.json$/, "");
    const path = `data/judgment/${t}/${f}`;
    files.push({ ticker: t, accession, path, text: readFileSync(path, "utf8"), published: accession === publishedAcc });
  }
}

const desk = Desk.parse(JSON.parse(readFileSync(join("data", "desk", "desk.json"), "utf8")));
const packPath = (t: string, a: string) => join("data", "facts", t, `${a}.json`);
const plan = planBackfill({
  files, git, cutoff: BACKFILL_CUTOFF, apply: parsed.apply,
  headPackText: (t, a) => (existsSync(packPath(t, a)) ? readFileSync(packPath(t, a), "utf8") : null),
  current: (t, a) => (existsSync(packPath(t, a)) ? reviewInputs(FactPack.parse(JSON.parse(readFileSync(packPath(t, a), "utf8"))), desk) : null),
});

for (const f of plan.files) {
  const o = f.outcome;
  const tag = `${f.ticker} ${f.accession}${f.published ? "" : " (superseded)"}`;
  if (o.kind === "stamp") console.log(`${tag} @${o.commit}: ${o.changed.length ? `stale (${o.changed.join(", ")})` : "clean"}${o.preRating ? ` [pre-rating: ${o.preRating}]` : ""}`);
  else console.log(`${tag}: ${o.kind} — ${o.reason}`);
}

const stamps = plan.files.filter((f) => f.outcome.kind === "stamp");
const count = (k: string) => plan.files.filter((f) => f.outcome.kind === k).length;
const names = (xs: typeof plan.files) => xs.map((f) => (f.published ? f.ticker : `${f.ticker} ${f.accession}`)).join(" ");
const changedOf = (f: (typeof plan.files)[number]) => (f.outcome.kind === "stamp" ? f.outcome.changed : []);
const pubStale = stamps.filter((f) => f.published && changedOf(f).length), pubClean = stamps.filter((f) => f.published && !changedOf(f).length);
console.log(`\ncutoff ${plan.cutoff}${BACKFILL_CUTOFF == null ? " (provisional: BACKFILL_CUTOFF is unset)" : ""}`);
console.log(`files ${plan.files.length}: stamp ${stamps.length}, skipped ${count("skipped")}, refused ${count("refused")}`);
console.log(`owner-accepted pre-rating: ${stamps.filter((f) => f.outcome.kind === "stamp" && f.outcome.preRating === "accept").length}: ${names(stamps.filter((f) => f.outcome.kind === "stamp" && f.outcome.preRating === "accept"))}`);
console.log(`published stale: ${pubStale.length}: ${names(pubStale)}`);
for (const c of ["facts", "calls", "context"] as const) {
  const xs = pubStale.filter((f) => changedOf(f).includes(c));
  console.log(`  on ${c}: ${xs.length}: ${names(xs)}`);
}
console.log(`published clean: ${pubClean.length}`);
const superseded = stamps.filter((f) => !f.published);
if (superseded.length) console.log(`superseded: ${superseded.map((f) => `${f.ticker} ${f.accession} ${changedOf(f).length ? `stale (${changedOf(f).join(", ")})` : "clean"}`).join("; ")}`);
console.log("\nschema defaults at the review commit (HEAD fills these):");
for (const [k, v] of Object.entries(plan.deskDefaults)) console.log(`  desk.json lacks "${k}": ${v.length}: ${v.join(" ")}`);
for (const [k, v] of Object.entries(plan.packAbsent)) console.log(`  pack lacks "${k}" (present at HEAD): ${v.length}`);
console.log(`  inside a fingerprint component: ${plan.flagged.length ? plan.flagged.join("; ") : "none"}`);

if (plan.refused) { console.error(`\nrefused: ${plan.refused}`); process.exit(1); }
if (parsed.apply) {
  for (const f of stamps) if (f.outcome.kind === "stamp") writeFileSync(f.path, f.outcome.text);
  console.log(`\napplied: ${stamps.length} file(s) stamped`);
} else console.log("\ndry run: nothing written (--apply writes)");
