import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { renderPrompt, promptTail } from "../lib/synth/prompt";
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
const tailOpts = {
  priorErrors: prior.errors.length ? prior.errors : undefined,
  priorWarnings: prior.warnings.length ? prior.warnings : undefined,
  editorial,
};
const prompt = renderPrompt(pack, projectReportFacts(pack), desk, { ...tailOpts, judgmentPath });
const out = join(dir, `${accession}.prompt.md`);
writeFileSync(out, prompt);

// On a re-render, the base sections (Role, Contract, Traps, Calls, Facts, Context, Output) are
// byte-identical to the prompt the author already read; only the tail changed. Emit it on its own so
// the author re-reads what changed, not the whole ~20K-token brief. The full prompt still stands for
// the reviewer, which reads it cold as the grounding surface.
const delta = withErrors || withReview ? promptTail(tailOpts) : "";
let deltaOut: string | undefined;
if (delta) {
  deltaOut = join(dir, `${accession}.prompt.delta.md`);
  writeFileSync(deltaOut, delta + "\n");
}
console.log(
  `Wrote ${out} (${prompt.length.toLocaleString("en-US")} chars` +
    `${withErrors ? `, ${prior.errors.length} prior errors, ${prior.warnings.length} warnings` : ""}` +
    `${editorial ? `, ${openFindings(editorial).length} open findings` : ""})` +
    `${deltaOut ? `\nDelta — read this instead of the full prompt: ${deltaOut} (${delta.length.toLocaleString("en-US")} chars)` : ""}` +
    `\nJudgment goes to ${judgmentPath}`,
);
