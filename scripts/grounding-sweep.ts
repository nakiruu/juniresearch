/**
 * grounding-sweep.ts — read-only: re-runs the grounding check on published judgments, the way synth:build would.
 * Run it before any republish (`synth:build --date`): a report whose prose no longer grounds fails at `validate`.
 *
 *   node --import tsx scripts/grounding-sweep.ts [TICKER ...] [--pack-at head|report] [--all] [--json]
 *                                               [--propose-exceptions] [--preview-exceptions]
 *
 * Judgments pair with packs exactly as synth:build pairs them (data/facts/<T>/<ACC>.json + data/judgment/<T>/<ACC>.json).
 * By default only each ticker's published accession (data/<t>.json) is checked; a named ticker with no published report
 * checks every paired judgment; --all adds superseded judgments too.
 *
 * --pack-at report checks the pack and judgment as committed with the last commit of data/<t>.json — what the reviewer
 * approved. The default, head, checks today's pack, which a republish uses. Either way, every published report is also
 * compared across the two snapshots: "drift" counts misses at HEAD that build time did not have, and "silent surface
 * drift" lists reports whose rendered surface changed without any such miss.
 *
 * Per report: the legacy lint's misses (a frozen copy of main's grounding.ts, scripts/lib/grounding-legacy.ts), the new
 * misses with their reasons (errors, and assumed-figure warnings that do not fail a build), the excepted and stale
 * exception entries, and the weak count. Exits 1 when any error-class miss remains that no exception covers.
 *
 * Exceptions (lib/synth/grounding-exceptions.json) apply here exactly as in synth:build: only when the file is byte-equal
 * to both refs/heads/main's and refs/remotes/origin/main's copies. --preview-exceptions evaluates the working copy instead (a branch's view, which synth:build ignores).
 * --propose-exceptions prints candidate entries for the remaining misses of reports whose surface and judgment are
 * unchanged since build time; a report that drifted is never proposed, and any entry matching one aborts the sweep.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FactPack } from "../lib/facts/schema";
import { projectReportFacts } from "../lib/facts/project";
import { Desk } from "../lib/synth/desk.schema";
import { Judgment } from "../lib/synth/judgment.schema";
import { renderFactsBlock } from "../lib/synth/prompt";
import { groundingSurface, groundJudgment, renderJudgmentBlock } from "../lib/synth/validate-judgment";
import { numericTokens, type GroundingMiss } from "../lib/synth/grounding";
import { judgmentSha256 } from "../lib/synth/editorial";
import { GroundingExceptionsFile, loadExceptions, gitReaders, applyExceptions, surfaceSha256, EXCEPTIONS_PATH } from "../lib/synth/grounding-exceptions";
import { stringLeaves } from "../lib/synth/walk";
import { buildAllowedIndex, checkGrounding as legacyCheck } from "./lib/grounding-legacy";

const args = process.argv.slice(2);
const at = args.indexOf("--pack-at");
const packAt = at >= 0 ? args[at + 1] : "head";
const USAGE = "usage: grounding-sweep [TICKER ...] [--pack-at head|report] [--all] [--json] [--propose-exceptions] [--preview-exceptions]";
if (packAt !== "head" && packAt !== "report") { console.error(USAGE); process.exit(2); }
const named = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1)).map((t) => t.toUpperCase());
const all = args.includes("--all"), asJson = args.includes("--json");
const propose = args.includes("--propose-exceptions"), preview = args.includes("--preview-exceptions");
if (propose && packAt !== "head") { console.error("--propose-exceptions keys entries to today's surface: run it at --pack-at head"); process.exit(2); }

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const desk = Desk.parse(JSON.parse(readFileSync(join("data", "desk", "desk.json"), "utf8")));
const ACCESSION = /^[0-9]{10}-[0-9]{2}-[0-9]{6}\.json$/;

interface Pair { ticker: string; accession: string; published: boolean }
function pairs(): Pair[] {
  const out: Pair[] = [];
  for (const t of readdirSync(join("data", "judgment")).sort()) {
    if (named.length && !named.includes(t)) continue;
    const report = join("data", `${t.toLowerCase()}.json`);
    const publishedAcc = existsSync(report) ? (JSON.parse(readFileSync(report, "utf8")).meta?.filing?.accession as string | undefined) : undefined;
    const mine = readdirSync(join("data", "judgment", t)).filter((f) => ACCESSION.test(f)).map((f) => f.replace(/\.json$/, ""))
      .filter((acc) => existsSync(join("data", "facts", t, `${acc}.json`)))
      .map((accession) => ({ ticker: t, accession, published: accession === publishedAcc }));
    out.push(...(all || (named.length && !publishedAcc) ? mine : mine.filter((p) => p.published)));
  }
  return out;
}

/** The pack and judgment at HEAD, or as committed with the report's last commit. */
function load(p: Pair, snapshot: "head" | "report"): { pack: FactPack; judgment: Judgment; judgmentText: string } | string {
  let packText: string, jText: string;
  if (snapshot === "head") {
    packText = readFileSync(join("data", "facts", p.ticker, `${p.accession}.json`), "utf8");
    jText = readFileSync(join("data", "judgment", p.ticker, `${p.accession}.json`), "utf8");
  } else {
    if (!p.published) return "not the published accession";
    const commit = git("log", "-1", "--format=%h", "--", `data/${p.ticker.toLowerCase()}.json`).trim();
    if (!commit) return "no report commit";
    try {
      packText = git("show", `${commit}:data/facts/${p.ticker}/${p.accession}.json`);
      jText = git("show", `${commit}:data/judgment/${p.ticker}/${p.accession}.json`);
    } catch { return `no pack or judgment at report commit ${commit}`; }
  }
  const j = Judgment.safeParse(JSON.parse(jText));
  return j.success ? { pack: FactPack.parse(JSON.parse(packText)), judgment: j.data, judgmentText: jText } : "Judgment.parse failed";
}

function evaluate(s: { pack: FactPack; judgment: Judgment; judgmentText: string }) {
  const { pack, judgment: j } = s;
  const facts = projectReportFacts(pack);
  const surface = groundingSurface(j, facts, pack, desk);
  const g = groundJudgment(j, surface);
  const legacy = legacyCheck(j, buildAllowedIndex(pack, [renderFactsBlock(facts, pack), renderJudgmentBlock(j, pack.quote.price)]));
  const figures = stringLeaves(j).reduce((n, { text }) => n + numericTokens(text).length, 0);
  return { ...g, legacy, figures, surfaceSha256: surfaceSha256(surface), judgmentSha256: judgmentSha256(s.judgmentText) };
}
const missKey = (m: { field: string; value: unknown }) => `${m.field}|${String(m.value)}`;
/** Misses at HEAD beyond those build time already had, counted per field and figure. */
function driftCount(head: { field: string; value: unknown }[], built: { field: string; value: unknown }[]): number {
  const left = new Map<string, number>();
  for (const m of built) left.set(missKey(m), (left.get(missKey(m)) ?? 0) + 1);
  let n = 0;
  for (const m of head) { const k = missKey(m), c = left.get(k) ?? 0; if (c > 0) left.set(k, c - 1); else n++; }
  return n;
}

// Exceptions: synth:build applies the file only when byte-equal to main's and origin/main's copies; --preview-exceptions
// evaluates the working copy. An unreadable working copy is treated as absent, as synth:build treats it.
const workingEntries = (() => {
  let w: Buffer | string | null;
  try { w = gitReaders().readWorking(); } catch { w = null; }
  if (w == null) return [];
  try { return GroundingExceptionsFile.parse(JSON.parse(w.toString())).entries; }
  catch (e) { console.error(`malformed ${EXCEPTIONS_PATH}: ${(e as Error).message}`); process.exit(2); }
})();
const ex = preview
  ? { entries: workingEntries, note: `${workingEntries.length} entries, preview — synth:build ignores this file until it is on main and origin/main` }
  : (() => {
      const l = loadExceptions(gitReaders());
      return { entries: l.entries, note: l.warning ? `${workingEntries.length} entries ignored: ${l.warning}` : `${l.entries.length} entries applied (byte-equal to main and origin/main)` };
    })();

type Row = {
  ticker: string; accession: string; figures: number; legacy: string[]; errors: { field: string; raw: string; reason: string; message: string }[];
  excepted: { field: string; raw: string; why: string }[]; stale: { field: string; raw: string }[];
  assumed: { field: string; raw: string }[]; weak: number; drift: number; silentDrift: boolean;
};
const rows: Row[] = [];
const proposals: Record<string, unknown>[] = [];
const skipped: string[] = [];
for (const p of pairs()) {
  const main = load(p, packAt);
  if (typeof main === "string") { skipped.push(`${p.ticker}/${p.accession}: ${main}`); continue; }
  const r = evaluate(main);
  let drift = 0, silentDrift = false, unchanged = false;
  if (p.published) {
    const other = load(p, packAt === "head" ? "report" : "head");
    if (typeof other !== "string") {
      const o = evaluate(other);
      const [head, built] = packAt === "head" ? [r, o] : [o, r];
      drift = driftCount([...head.errors, ...head.assumed], [...built.errors, ...built.assumed]);
      unchanged = head.surfaceSha256 === built.surfaceSha256 && head.judgmentSha256 === built.judgmentSha256;
      silentDrift = head.surfaceSha256 !== built.surfaceSha256 && drift === 0;
    }
  }
  const waived = applyExceptions(r.errors, { ticker: p.ticker, accession: p.accession, judgmentSha256: r.judgmentSha256, surfaceSha256: r.surfaceSha256 }, ex.entries);
  // An exception may only ever name a surface a reviewer saw: never a report whose surface moved since build time.
  if (waived.matched.length && !unchanged) { console.error(`ASSERTION: an exception applies to ${p.ticker}, whose surface or judgment changed since build time`); process.exit(2); }
  if (propose && unchanged)
    for (const m of waived.errors)
      proposals.push({ ticker: p.ticker, accession: p.accession, judgmentSha256: r.judgmentSha256, surfaceSha256: r.surfaceSha256,
        check: "grounding", field: m.field, raw: m.token.raw, class: "TODO", reason: `${m.reason}: ${m.message}`.slice(0, 300), approvedAt: "TODO" });
  rows.push({
    ticker: p.ticker, accession: p.accession, figures: r.figures, legacy: r.legacy.map((i) => `${i.field}: ${i.value}`),
    errors: waived.errors.map((m: GroundingMiss) => ({ field: m.field, raw: m.token.raw, reason: m.reason, message: m.message })),
    excepted: waived.warnings.map((w) => ({ field: w.field, raw: String(w.value), why: w.message })),
    stale: waived.stale.map((e) => ({ field: e.field, raw: e.raw })),
    assumed: r.assumed.map((w) => ({ field: w.field, raw: String(w.value) })), weak: r.weak.length, drift, silentDrift,
  });
}

const reportsWith = (f: (x: Row) => number) => rows.filter((x) => f(x) > 0).length;
const sum = (f: (x: Row) => number) => rows.reduce((n, x) => n + f(x), 0);
const misses = (x: Row) => x.errors.length + x.excepted.length + x.assumed.length;
const summary = {
  packAt, exceptions: ex.note, reports: rows.length, figures: sum((x) => x.figures),
  legacy: { figures: sum((x) => x.legacy.length), reports: reportsWith((x) => x.legacy.length) },
  new: { figures: sum(misses), reports: reportsWith(misses) },
  errors: { figures: sum((x) => x.errors.length), reports: reportsWith((x) => x.errors.length), failing: rows.filter((x) => x.errors.length).map((x) => x.ticker) },
  assumed: { figures: sum((x) => x.assumed.length), reports: reportsWith((x) => x.assumed.length) },
  excepted: sum((x) => x.excepted.length), stale: sum((x) => x.stale.length), drift: sum((x) => x.drift),
  silentDrift: rows.filter((x) => x.silentDrift).map((x) => x.ticker),
  skipped,
};

if (propose) console.log(JSON.stringify(proposals, null, 2));
else if (asJson) console.log(JSON.stringify({ summary, reports: rows }, null, 1));
else {
  for (const x of rows) {
    console.log(`${x.ticker} ${x.accession}: legacy ${x.legacy.length}; new ${misses(x)} (errors ${x.errors.length}, excepted ${x.excepted.length}, assumed ${x.assumed.length}); weak ${x.weak}`
      + `${x.stale.length ? `; stale ${x.stale.length}` : ""}${x.drift ? `; drift ${x.drift}` : ""}${x.silentDrift ? "; silent surface drift" : ""}`);
    for (const l of x.legacy) console.log(`  legacy   ${l}`);
    for (const e of x.errors) console.log(`  error    ${e.field}: ${e.message.replace(/\s+/g, " ")} [${e.reason}]`);
    for (const e of x.excepted) console.log(`  excepted ${e.field}: "${e.raw}" — ${e.why}`);
    for (const e of x.stale) console.log(`  stale    ${e.field}: "${e.raw}" (the entry no longer matches: judgment, surface or figure changed)`);
    for (const a of x.assumed) console.log(`  assumed  ${a.field}: "${a.raw}" (warning: argue its basis in the sentence)`);
  }
  for (const s of skipped) console.log(`skipped ${s}`);
  const s = summary;
  console.log(`\nexceptions: ${s.exceptions}`);
  console.log(`failing (error-class misses not excepted): ${s.errors.failing.join(" ") || "none"}`);
  console.log(`${s.figures} figures; legacy ${s.legacy.figures} in ${s.legacy.reports}; new ${s.new.figures} in ${s.new.reports} (errors ${s.errors.figures} in ${s.errors.reports}, assumed ${s.assumed.figures} in ${s.assumed.reports}); excepted ${s.excepted}; stale ${s.stale}; drift ${s.drift}; silent surface drift: ${s.silentDrift.join(" ") || "none"}`);
}
process.exitCode = summary.errors.figures > 0 ? 1 : 0;
