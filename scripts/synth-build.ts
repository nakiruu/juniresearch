import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { Judgment } from "../lib/synth/judgment.schema";
import { mergeReport } from "../lib/synth/merge";
import { evaluateGates, gateAdvisory } from "../lib/synth/gates";
import { moatRead, moatApplicable, costOfEquity } from "../lib/synth/moat";
import { intrinsicRead, dcfApplicable } from "../lib/synth/intrinsic";
import { compositeScore } from "../lib/synth/composite";
import { decide, SAFE_DEFAULTS } from "../lib/synth/decide";
import { computeConviction, scenarioDispersion } from "../lib/synth/conviction";
import { MACRO } from "../lib/synth/macro";
import { classifySector } from "../lib/synth/gates";
import { uncertaintyTier, segmentHHI } from "../lib/synth/uncertainty";
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

// Fundamental-scoring advisories (gate warning + decision summary), computed once the layers run.
// They are surfaced even when the build fails validation, so the author sees the fundamental read
// and the next --with-errors render carries it (7.md I8).
let extraWarnings: string[] = [];
const fail = (issues: (ValidationIssue | LintIssue)[], warnings: LintIssue[], stage: string): never => {
  const errorLines = issues.map(issueLine);
  const warningLines = [...warnings.map(issueLine), ...extraWarnings];
  writeErrorsFile(errorsPath, errorLines, warningLines);
  console.error(`${stage}: ${issues.length} issue(s) — written to ${errorsPath}\n` + errorLines.map((l) => `  - ${l}`).join("\n"));
  if (warningLines.length) console.warn(`  ${warningLines.length} warning(s):\n` + warningLines.map((l) => `  - ${l}`).join("\n"));
  process.exit(1);
};

const raw: unknown = (() => { try { return JSON.parse(judgmentText) as unknown; } catch (e) { return fail([{ field: judgmentPath, message: `not valid JSON: ${(e as Error).message}`, value: null }], [], "parse"); } })();
const parsed = Judgment.safeParse(raw);
const judgment = parsed.success ? parsed.data : fail(parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message, value: null })), [], "Judgment.parse");

const facts = projectReportFacts(pack);

// Fundamental scoring layers (advisory under safe defaults — they do not move the label).
const gate = evaluateGates(pack);
const moat = moatApplicable(pack).ok ? moatRead(pack) : null;
const discountRate = costOfEquity(pack, MACRO);
const intrinsic = dcfApplicable(pack).ok ? intrinsicRead(pack, { r: discountRate, terminalGrowth: 0.03, horizon: 10 }) : null;
const composite = compositeScore(pack);
const conviction = computeConviction(judgment.sections.valuation.scenarios, pack.quote.price);
const a = pack.analysts;
const fin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const targetDispersion = fin(a.highTarget) && fin(a.lowTarget) && fin(a.medianTarget) && a.medianTarget > 0 ? (a.highTarget - a.lowTarget) / a.medianTarget : null;
const eStreet = fin(a.consensusTarget) && pack.quote.price > 0 ? a.consensusTarget / pack.quote.price - 1 : null;
const divergence = intrinsic && eStreet != null ? Math.abs(intrinsic.eMechanical - eStreet) : null;
const netDebtRow = pack.statements.balance.find((r) => r.key === "netDebt")?.values;
const abstentions = (moat ? 0 : 1) + (intrinsic ? 0 : 1) + (composite.percentile == null ? 1 : 0);
const uncertainty = uncertaintyTier({
  dispersion: targetDispersion,
  sic: pack.sic ?? null,
  netDebtToEbitda: pack.ttm.netDebtToEbitda,
  netDebtor: fin(netDebtRow?.at(-1)) && (netDebtRow!.at(-1) as number) > 0,
  fiscalYears: pack.statements.fiscalYears.length,
  abstentions,
  segmentHHI: segmentHHI(pack.segments.items),
  sector: classifySector(pack),
});
const sigmaScen = scenarioDispersion(judgment.sections.valuation.scenarios, pack.quote.price);
const dec = decide({ conviction, gate, moat, intrinsic, composite, market: { targetDispersion, divergence }, uncertainty: { tier: uncertainty.tier, scenarioDispersion: sigmaScen }, published: judgment.rating.label }, desk.rating, SAFE_DEFAULTS);
const gateWarning = gateAdvisory(judgment.rating.label, gate);
extraWarnings = [
  ...(gateWarning ? [gateWarning] : []),
  `decision: composed ${dec.label} · conviction ${dec.conviction} ${dec.tier} · uncertainty ${uncertainty.tier}`,
  ...dec.advisories.map((s) => `  ${s}`),
];
const decisionBlock = {
  conviction: dec.conviction, tier: dec.tier, proposed: dec.proposed, reasons: dec.reasons, advisories: dec.advisories,
  moat: moat ? { width: moat.width, trend: moat.trend, contingent: moat.contingent, bearFloor: moat.bearFloor } : null,
  intrinsic: intrinsic
    ? { marginOfSafety: intrinsic.marginOfSafety, impliedGrowth: intrinsic.impliedGrowth, achievableGrowth: intrinsic.achievableGrowth }
    : null,
  composite: { percentile: composite.percentile, confidence: composite.confidence },
  uncertainty: { tier: uncertainty.tier, points: uncertainty.points, drivers: uncertainty.drivers },
};
const report = mergeReport(facts, judgment, desk, buildDate, gate, decisionBlock);
const rp = Report.safeParse(report);
const valid = rp.success ? rp.data : fail(rp.error.issues.map((i) => ({ field: i.path.join("."), message: i.message, value: null })), [], "Report.parse");
const issues = [...validateReport(valid), ...validateJudgment(judgment, facts, pack, desk)];
const lint = lintJudgment(judgment, desk, { currentPrice: pack.quote.price });
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

// The fundamental gate is advisory here: it never blocks the build, but a rating above its ceiling
// (and the composed decision) is surfaced and fed back into the next prompt via the errors file.
const warningLines = [...warnings.map(issueLine), ...extraWarnings];

const out = join("data", `${ticker.toLowerCase()}.json`);
writeFileSync(out, JSON.stringify(valid, null, 2) + "\n");
if (warningLines.length) writeErrorsFile(errorsPath, [], warningLines);
else if (existsSync(errorsPath)) rmSync(errorsPath);
console.log(`Wrote ${out}\n  ${valid.meta.company} · ${valid.rating.label} ${valid.rating.targetLow}–${valid.rating.targetHigh} · report date ${valid.meta.reportDate} · ${valid.quote.history?.length ?? 0} closes · gate ${gate.sector}/${valid.rating.gate?.gatedLabel ?? "—"} · conviction ${dec.conviction} ${dec.tier}`);
if (warningLines.length)
  console.warn(`  ${warningLines.length} warning(s) — kept in ${errorsPath} for the next --with-errors render:\n` + warningLines.map((w) => `  - ${w}`).join("\n"));
