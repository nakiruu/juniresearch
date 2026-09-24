import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEditorialReview, malformedReviewMessage } from "../lib/synth/editorial";
import { renderReviewBrief } from "../lib/synth/review-brief";
import { Desk } from "../lib/synth/desk.schema";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
if (!tickerArg || !accession) { console.error("usage: npm run synth:review-brief -- <TICKER> <ACCESSION> [--full-brief]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const fullBrief = args.includes("--full-brief");

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
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
const previousReview = (() => {
  try { return loadEditorialReview(paths.findings); }
  catch (e) { console.error(malformedReviewMessage(paths.findings, e)); return process.exit(1); }
})();
const round = previousReview ? (Math.min(previousReview.round + 1, 2) as 1 | 2) : 1;

const brief = renderReviewBrief({ ticker, accession, judgmentText, previousReview, round, rubric, paths, recurringTraps: desk.recurringTraps, fullBrief });
const out = join(dir, `${accession}.review-brief.md`);
writeFileSync(out, brief);
const mode = previousReview ? (fullBrief ? ", re-check (full brief)" : ", re-check (delta — warm reviewer)") : "";
console.log(`Wrote ${out} (${brief.length.toLocaleString("en-US")} chars, round ${round}${mode})\nFindings go to ${paths.findings}`);
