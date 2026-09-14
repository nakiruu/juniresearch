import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEditorialReview } from "../lib/synth/editorial";
import { renderReviewBrief } from "../lib/synth/review-brief";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
if (!tickerArg || !accession) { console.error("usage: npm run synth:review-brief -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const dir = join("data", "judgment", ticker);
mkdirSync(dir, { recursive: true });

const paths = {
  report: join("data", `${ticker.toLowerCase()}.json`).replace(/\\/g, "/"),
  prompt: join(dir, `${accession}.prompt.md`).replace(/\\/g, "/"),
  judgment: join(dir, `${accession}.json`).replace(/\\/g, "/"),
  facts: join("data", "facts", ticker, `${accession}.json`).replace(/\\/g, "/"),
  findings: join(dir, `${accession}.editorial.json`).replace(/\\/g, "/"),
  rubric: join("data", "desk", "editorial-rubric.md").replace(/\\/g, "/"),
};

const judgmentText = read(paths.judgment);
const rubric = read(paths.rubric);
const previousReview = loadEditorialReview(paths.findings);
const round = previousReview ? (Math.min(previousReview.round + 1, 2) as 1 | 2) : 1;

const brief = renderReviewBrief({ ticker, accession, judgmentText, previousReview, round, rubric, paths });
const out = join(dir, `${accession}.review-brief.md`);
writeFileSync(out, brief);
console.log(`Wrote ${out} (${brief.length.toLocaleString("en-US")} chars, round ${round}${previousReview ? ", re-check" : ""})\nFindings go to ${paths.findings}`);
