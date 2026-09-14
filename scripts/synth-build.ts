import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { Judgment } from "../lib/synth/judgment.schema";
import { mergeReport } from "../lib/synth/merge";
import { validateJudgment } from "../lib/synth/validate-judgment";
import { Report } from "../lib/report.schema";
import { validateReport, type ValidationIssue } from "../lib/validate";
import { lintJudgment, type LintIssue } from "../lib/synth/lint";
import { issueLine, writeErrorsFile } from "../lib/synth/errors-file";
import { loadEditorialReview, reviewStatus, editorialGateMessage, openFindings } from "../lib/synth/editorial";

const args = process.argv.slice(2);
const dateFlag = args.indexOf("--date");
const buildDate = dateFlag >= 0 ? args[dateFlag + 1] : new Date().toISOString().slice(0, 10);
const skipReview = args.includes("--skip-review");
const [tickerArg, accession] = args.filter((a, i) => !a.startsWith("--") && (dateFlag < 0 || i !== dateFlag + 1));
if (!tickerArg || !accession || !/^\d{4}-\d{2}-\d{2}$/.test(buildDate ?? "")) { console.error("usage: npm run synth:build -- <TICKER> <ACCESSION> [--date YYYY-MM-DD] [--skip-review]"); process.exit(2); }
const ticker = tickerArg.toUpperCase();

const read = (p: string) => { if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(2); } return readFileSync(p, "utf8"); };
const pack = FactPack.parse(JSON.parse(read(join("data", "facts", ticker, `${accession}.json`))));
const desk = Desk.parse(JSON.parse(read(join("data", "desk", "desk.json"))));
const judgmentPath = join("data", "judgment", ticker, `${accession}.json`);
const errorsPath = join("data", "judgment", ticker, `${accession}.errors.txt`);
const editorialPath = join("data", "judgment", ticker, `${accession}.editorial.json`);
const judgmentText = read(judgmentPath);

const fail = (issues: (ValidationIssue | LintIssue)[], warnings: LintIssue[], stage: string): never => {
  const errorLines = issues.map(issueLine);
  const warningLines = warnings.map(issueLine);
  writeErrorsFile(errorsPath, errorLines, warningLines);
  console.error(`${stage}: ${issues.length} issue(s) — written to ${errorsPath}\n` + errorLines.map((l) => `  - ${l}`).join("\n"));
  if (warningLines.length) console.warn(`  ${warningLines.length} warning(s):\n` + warningLines.map((l) => `  - ${l}`).join("\n"));
  process.exit(1);
};

const raw: unknown = (() => { try { return JSON.parse(judgmentText) as unknown; } catch (e) { return fail([{ field: judgmentPath, message: `not valid JSON: ${(e as Error).message}`, value: null }], [], "parse"); } })();
const parsed = Judgment.safeParse(raw);
const judgment = parsed.success ? parsed.data : fail(parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message, value: null })), [], "Judgment.parse");

const facts = projectReportFacts(pack);
const report = mergeReport(facts, judgment, desk, buildDate);
const rp = Report.safeParse(report);
const valid = rp.success ? rp.data : fail(rp.error.issues.map((i) => ({ field: i.path.join("."), message: i.message, value: null })), [], "Report.parse");
const issues = [...validateReport(valid), ...validateJudgment(judgment, facts, pack)];
const lint = lintJudgment(judgment, desk);
const errors = [...issues, ...lint.filter((i) => i.severity === "error")];
const warnings = lint.filter((i) => i.severity === "warning");
if (errors.length) fail(errors, warnings, "validate");

const review = (() => {
  try { return loadEditorialReview(editorialPath); }
  catch (e) { return fail([{ field: editorialPath, message: `malformed editorial review: ${(e as Error).message}`, value: null }], warnings, "editorial"); }
})();
const status = reviewStatus(judgmentText, review);
if (status !== "clean" && !skipReview)
  fail([{ field: editorialPath, message: editorialGateMessage(status, review ? openFindings(review).length : 0), value: status }], warnings, "editorial");
if (status !== "clean") console.warn(`editorial review skipped: ${status}`);

const out = join("data", `${ticker.toLowerCase()}.json`);
writeFileSync(out, JSON.stringify(valid, null, 2) + "\n");
if (warnings.length) writeErrorsFile(errorsPath, [], warnings.map(issueLine));
else if (existsSync(errorsPath)) rmSync(errorsPath);
console.log(`Wrote ${out}\n  ${valid.meta.company} · ${valid.rating.label} ${valid.rating.targetLow}–${valid.rating.targetHigh} · report date ${valid.meta.reportDate} · ${valid.quote.history?.length ?? 0} closes`);
if (warnings.length)
  console.warn(`  ${warnings.length} lint warning(s) — kept in ${errorsPath} for the next --with-errors render:\n` + warnings.map((w) => `  - ${issueLine(w)}`).join("\n"));
