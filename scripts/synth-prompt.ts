import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { renderPrompt } from "../lib/synth/prompt";

const args = process.argv.slice(2);
const [tickerArg, accession] = args.filter((a) => !a.startsWith("--"));
const withErrors = args.includes("--with-errors");
if (!tickerArg || !accession) { console.error("usage: npm run synth:prompt -- <TICKER> <ACCESSION> [--with-errors]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const pack = FactPack.parse(JSON.parse(read(join("data", "facts", ticker, `${accession}.json`))));
const desk = Desk.parse(JSON.parse(read(join("data", "desk", "desk.json"))));
const dir = join("data", "judgment", ticker);
mkdirSync(dir, { recursive: true });
const errorsPath = join(dir, `${accession}.errors.txt`);
const priorErrors = withErrors ? read(errorsPath).split("\n").filter(Boolean) : undefined;

const judgmentPath = join(dir, `${accession}.json`).replace(/\\/g, "/");
const prompt = renderPrompt(pack, projectReportFacts(pack), desk, { priorErrors, judgmentPath });
const out = join(dir, `${accession}.prompt.md`);
writeFileSync(out, prompt);
console.log(`Wrote ${out} (${prompt.length.toLocaleString("en-US")} chars${priorErrors ? `, ${priorErrors.length} prior errors` : ""})\nJudgment goes to ${judgmentPath}`);
