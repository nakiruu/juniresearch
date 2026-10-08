/**
 * rekey-review-calls.ts — carry review stamps across a desk.rating change (decision D1). Dry run by default.
 *
 *   node --import tsx scripts/rekey-review-calls.ts --from <old desk commit> --to <new desk commit> [--apply]
 *
 * For every stamped findings file whose `calls` is the old rule's hash, rekeyCalls (lib/synth/review-rekey.ts) restamps
 * `calls` with `rekey:<to>` only where the derived label holds and the judgment passes validate's rating checks and Calls
 * grounding under the new rule; every other such report must be re-reviewed. Run it as an approved data commit alongside
 * every desk.rating change, with the re-review list in the commit message. Refuses on uncommitted data changes.
 * A review already stale on its judgment is left untouched. An owner-accepted pre-rating review keeps its marker as
 * `rekey:<sha>+owner-accept`, and is listed on its own so the commit message can name it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { Judgment } from "../lib/synth/judgment.schema";
import { EditorialReview, readInputsStamp } from "../lib/synth/editorial.schema";
import { canon } from "../lib/synth/review-inputs";
import { rekeyCalls, replaceInputsText } from "../lib/synth/review-rekey";

const USAGE = "usage: node --import tsx scripts/rekey-review-calls.ts --from <old desk commit> --to <new desk commit> [--apply]";
const args = process.argv.slice(2);
const opt: Record<string, string | true> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--apply") opt.apply = true;
  else if ((a === "--from" || a === "--to") && args[i + 1] && !args[i + 1].startsWith("--")) opt[a.slice(2)] = args[++i];
  else { console.error(`unknown argument ${a}\n${USAGE}`); process.exit(2); }
}
if (typeof opt.from !== "string" || typeof opt.to !== "string") { console.error(USAGE); process.exit(2); }

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const dirty = git("status", "--porcelain", "--", "data/facts", "data/judgment", "data/desk").trim();
if (dirty) { console.error(`refused: uncommitted changes under data/facts, data/judgment or data/desk:\n${dirty}`); process.exit(1); }

const deskAt = (c: string) => Desk.parse(JSON.parse(git("show", `${c}:data/desk/desk.json`)));
const [oldDesk, newDesk] = [deskAt(opt.from), deskAt(opt.to)];
if (canon(oldDesk.rating) === canon(newDesk.rating)) { console.log("desk.rating is the same at both commits: nothing to re-key"); process.exit(0); }
const rekeySha = git("rev-parse", "--short=12", opt.to).trim();

const reReview: string[] = [], ownerAccepted: string[] = [];
let restamped = 0, untouched = 0, skipped = 0;
for (const t of readdirSync(join("data", "judgment")).sort())
  for (const f of readdirSync(join("data", "judgment", t)).filter((x) => x.endsWith(".editorial.json")).sort()) {
    const acc = f.replace(/\.editorial\.json$/, "");
    const path = join("data", "judgment", t, f);
    const text = readFileSync(path, "utf8");
    const review = EditorialReview.parse(JSON.parse(text));
    const read = readInputsStamp(review);
    const packPath = join("data", "facts", t, `${acc}.json`), judgmentPath = join("data", "judgment", t, `${acc}.json`);
    if (!("stamp" in read) || !existsSync(packPath) || !existsSync(judgmentPath)) {
      skipped++;
      console.log(`${t} ${acc}: skipped (${"stamp" in read ? "pack or judgment missing" : "unstamped"})`);
      continue;
    }
    const pack = FactPack.parse(JSON.parse(readFileSync(packPath, "utf8")));
    const judgmentText = readFileSync(judgmentPath, "utf8");
    const judgment = Judgment.parse(JSON.parse(judgmentText));
    const r = rekeyCalls({ stamp: read.stamp, judgment, judgmentText, reviewJudgmentSha256: review.judgmentSha256, pack, facts: projectReportFacts(pack),
      desk: newDesk, oldRating: oldDesk.rating, newRating: newDesk.rating, rekeySha });
    console.log(`${t} ${acc}: ${r.action}${r.action === "restamp" ? (r.ownerAccepted ? " (owner-accepted: marker kept)" : "") : ` (${r.reason})`}`);
    if (r.action === "restamp") {
      restamped++;
      if (r.ownerAccepted) ownerAccepted.push(`${t} ${acc}`);
      if (opt.apply) writeFileSync(path, replaceInputsText(text, r.stamp));
    } else if (r.action === "reReview") reReview.push(`${t} ${acc}: ${r.reason}`);
    else untouched++;
  }
console.log(`\n${opt.apply ? "applied" : "dry run"}: restamp ${restamped}, re-review ${reReview.length}, untouched ${untouched}, skipped ${skipped}`);
if (ownerAccepted.length) console.log(`owner-accepted pre-rating reviews restamped as rekey:${rekeySha}+owner-accept (list these in the commit message):\n${ownerAccepted.map((x) => `  ${x}`).join("\n")}`);
if (reReview.length) console.log(`re-review (list these in the commit message):\n${reReview.map((x) => `  ${x}`).join("\n")}`);
