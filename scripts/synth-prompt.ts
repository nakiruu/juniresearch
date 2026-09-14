import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { renderPrompt } from "../lib/synth/prompt";
import { parseErrorsFile } from "../lib/synth/errors-file";
import { loadEditorialReview, openFindings } from "../lib/synth/editorial";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
const withErrors = args.includes("--with-errors");
const withReview = args.includes("--with-review");
if (!tickerArg || !accession) { console.error("usage: npm run synth:prompt -- <TICKER> <ACCESSION> [--with-errors] [--with-review]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const pack = FactPack.parse(JSON.parse(read(join("data", "facts", ticker, `${accession}.json`))));
const desk = Desk.parse(JSON.parse(read(join("data", "desk", "desk.json"))));
const dir = join("data", "judgment", ticker);
mkdirSync(dir, { recursive: true });
const errorsPath = join(dir, `${accession}.errors.txt`);
const editorialPath = join(dir, `${accession}.editorial.json`);

const judgmentPath = join(dir, `${accession}.json`).replace(/\\/g, "/");
const prior = withErrors ? parseErrorsFile(read(errorsPath)) : { errors: [], warnings: [] };
const editorial = withReview ? loadEditorialReview(editorialPath) ?? undefined : undefined;
if (withReview && !editorial) { console.error(`Missing ${editorialPath} — run npm run synth:review-brief -- ${ticker} ${accession} and dispatch a reviewer first`); process.exit(2); }
const prompt = renderPrompt(pack, projectReportFacts(pack), desk, {
  priorErrors: prior.errors.length ? prior.errors : undefined,
  priorWarnings: prior.warnings.length ? prior.warnings : undefined,
  judgmentPath,
  editorial,
});
const out = join(dir, `${accession}.prompt.md`);
writeFileSync(out, prompt);
console.log(
  `Wrote ${out} (${prompt.length.toLocaleString("en-US")} chars` +
    `${withErrors ? `, ${prior.errors.length} prior errors, ${prior.warnings.length} warnings` : ""}` +
    `${editorial ? `, ${openFindings(editorial).length} open findings` : ""})\nJudgment goes to ${judgmentPath}`,
);
