import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEditorialReview, malformedReviewMessage } from "../lib/synth/editorial";
import { readInputsStamp } from "../lib/synth/editorial.schema";
import { renderReviewBrief, briefGroundingLists, briefOverwriteGuard, briefPreflight } from "../lib/synth/review-brief";
import { changedComponents, inputsUnder, reviewInputs } from "../lib/synth/review-inputs";
import { Desk } from "../lib/synth/desk.schema";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
if (!tickerArg || !accession) { console.error("usage: npm run synth:review-brief -- <TICKER> <ACCESSION> [--full-brief]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const fullBrief = args.includes("--full-brief");

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const readIf = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const dir = join("data", "judgment", ticker);
mkdirSync(dir, { recursive: true });

const paths = {
  report: join("data", `${ticker.toLowerCase()}.json`).replace(/\\/g, "/"),
  prompt: join(dir, `${accession}.prompt.md`).replace(/\\/g, "/"),
  judgment: join(dir, `${accession}.json`).replace(/\\/g, "/"),
  findings: join(dir, `${accession}.editorial.json`).replace(/\\/g, "/"),
  rubric: join("data", "desk", "editorial-rubric.md").replace(/\\/g, "/"),
};

const judgmentText = read(paths.judgment);
const rubric = read(paths.rubric);
const desk = Desk.parse(JSON.parse(read(join("data", "desk", "desk.json"))));
const packPath = join("data", "facts", ticker, `${accession}.json`);
const packText = read(packPath);
const pack = FactPack.parse(JSON.parse(packText));
const facts = projectReportFacts(pack);
const inputs = reviewInputs(pack, desk, facts);
const previousReview = (() => {
  try { return loadEditorialReview(paths.findings); }
  catch (e) { console.error(malformedReviewMessage(paths.findings, e)); return process.exit(1); }
})();
const round = previousReview ? (Math.min(previousReview.round + 1, 2) as 1 | 2) : 1;

// The reviewer reads prompt.md and the report; refuse unless both carry the inputs it will copy.
const reportText = readIf(paths.report);
const pre = briefPreflight({ promptText: readIf(paths.prompt), report: reportText == null ? null : JSON.parse(reportText), facts, pack, desk, accession });
if (!pre.ok) { console.error(`brief refused:\n${pre.errors.map((e) => `  - ${e}`).join("\n")}`); process.exit(1); }

// Never swap a brief under a reviewer that may still be reading it.
const out = join(dir, `${accession}.review-brief.md`);
const guard = briefOverwriteGuard({
  existingBriefText: readIf(out), currentInputs: inputs, findings: previousReview,
  briefMtime: existsSync(out) ? statSync(out).mtimeMs : null,
  findingsMtime: existsSync(paths.findings) ? statSync(paths.findings).mtimeMs : null,
  briefPath: out.replace(/\\/g, "/"),
});
if (!guard.ok) { console.error(`brief refused: ${guard.message}`); process.exit(1); }

// What moved since the previous review's stamp; any change forces the full brief.
const inputsChanged = (() => {
  if (!previousReview) return [];
  const r = readInputsStamp(previousReview);
  return "stamp" in r ? changedComponents(r.stamp, inputsUnder(r.stamp.scheme, pack, desk, facts)) : "unstamped" as const;
})();

// The weak and assumed lists for the reviewer; on a judgment that does not parse, the brief goes out without them.
const lists = briefGroundingLists(judgmentText, packText, desk);
if ("warning" in lists) console.warn(`grounding lists omitted from the brief: ${lists.warning}`);
const grounding = "warning" in lists ? null : lists;

const brief = renderReviewBrief({ ticker, accession, judgmentText, previousReview, round, rubric, paths, recurringTraps: desk.recurringTraps, fullBrief,
  weak: grounding?.weak, assumed: grounding?.assumed, inputs, inputsChanged });
writeFileSync(out, brief);
const forced = inputsChanged === "unstamped" ? " — previous review unstamped" : inputsChanged.length ? ` — inputs changed: ${inputsChanged.join(", ")}` : "";
const mode = previousReview ? (fullBrief || forced ? `, re-check (full brief${forced})` : ", re-check (delta — warm reviewer)") : "";
console.log(`Wrote ${out} (${brief.length.toLocaleString("en-US")} chars, round ${round}${mode})\nFindings go to ${paths.findings}`);
