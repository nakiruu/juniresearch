/**
 * grounding-sweep.ts — read-only: re-runs the grounding check on published judgments, the way synth:build would.
 * Run it before any republish (`synth:build --date`): a report whose prose no longer grounds fails at `validate`.
 *
 *   node --import tsx scripts/grounding-sweep.ts [TICKER ...] [--pack-at head|report] [--all] [--json]
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
 * misses with their reasons (errors, and assumed-figure warnings that do not fail a build), and the weak count.
 * Exits 1 when any error-class miss remains.
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
import { numericTokens, type GroundingMiss, type GroundingSurface } from "../lib/synth/grounding";
import { stringLeaves } from "../lib/synth/walk";
import { buildAllowedIndex, checkGrounding as legacyCheck } from "./lib/grounding-legacy";

const args = process.argv.slice(2);
const at = args.indexOf("--pack-at");
const packAt = at >= 0 ? args[at + 1] : "head";
if (packAt !== "head" && packAt !== "report") { console.error("usage: grounding-sweep [TICKER ...] [--pack-at head|report] [--all] [--json]"); process.exit(2); }
const named = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1)).map((t) => t.toUpperCase());
const all = args.includes("--all"), asJson = args.includes("--json");

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
function load(p: Pair, snapshot: "head" | "report"): { pack: FactPack; judgment: Judgment } | string {
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
  return j.success ? { pack: FactPack.parse(JSON.parse(packText)), judgment: j.data } : "Judgment.parse failed";
}

const surfaceText = (s: GroundingSurface) => [s.factsBlock, s.callsBlock, s.judgmentBlock, s.contextBlock].join("\n");
function evaluate(pack: FactPack, j: Judgment) {
  const facts = projectReportFacts(pack);
  const surface = groundingSurface(j, facts, pack, desk);
  const g = groundJudgment(j, surface);
  const legacy = legacyCheck(j, buildAllowedIndex(pack, [renderFactsBlock(facts, pack), renderJudgmentBlock(j, pack.quote.price)]));
  const figures = stringLeaves(j).reduce((n, { text }) => n + numericTokens(text).length, 0);
  return { ...g, legacy, figures, surface: surfaceText(surface) };
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

const rows: {
  ticker: string; accession: string; figures: number; legacy: string[]; errors: { field: string; raw: string; reason: string; message: string }[];
  assumed: { field: string; raw: string }[]; weak: number; drift: number; silentDrift: boolean;
}[] = [];
const skipped: string[] = [];
for (const p of pairs()) {
  const main = load(p, packAt);
  if (typeof main === "string") { skipped.push(`${p.ticker}/${p.accession}: ${main}`); continue; }
  const r = evaluate(main.pack, main.judgment);
  let drift = 0, silentDrift = false;
  if (p.published) {
    const head = packAt === "head" ? { r } : (() => { const h = load(p, "head"); return typeof h === "string" ? null : { r: evaluate(h.pack, h.judgment) }; })();
    const built = packAt === "report" ? { r } : (() => { const b = load(p, "report"); return typeof b === "string" ? null : { r: evaluate(b.pack, b.judgment) }; })();
    if (head && built) {
      const misses = (x: typeof r) => [...x.errors, ...x.assumed];
      drift = driftCount(misses(head.r), misses(built.r));
      silentDrift = head.r.surface !== built.r.surface && drift === 0;
    }
  }
  rows.push({
    ticker: p.ticker, accession: p.accession, figures: r.figures, legacy: r.legacy.map((i) => `${i.field}: ${i.value}`),
    errors: r.errors.map((m: GroundingMiss) => ({ field: m.field, raw: m.token.raw, reason: m.reason, message: m.message })),
    assumed: r.assumed.map((w) => ({ field: w.field, raw: String(w.value) })), weak: r.weak.length, drift, silentDrift,
  });
}

const reportsWith = (f: (x: (typeof rows)[number]) => number) => rows.filter((x) => f(x) > 0).length;
const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((n, x) => n + f(x), 0);
const summary = {
  packAt, reports: rows.length, figures: sum((x) => x.figures),
  legacy: { figures: sum((x) => x.legacy.length), reports: reportsWith((x) => x.legacy.length) },
  new: { figures: sum((x) => x.errors.length + x.assumed.length), reports: reportsWith((x) => x.errors.length + x.assumed.length) },
  errors: { figures: sum((x) => x.errors.length), reports: reportsWith((x) => x.errors.length) },
  assumed: { figures: sum((x) => x.assumed.length), reports: reportsWith((x) => x.assumed.length) },
  excepted: 0, stale: 0, drift: sum((x) => x.drift),
  silentDrift: rows.filter((x) => x.silentDrift).map((x) => x.ticker),
  skipped,
};

if (asJson) console.log(JSON.stringify({ summary, reports: rows }, null, 1));
else {
  for (const x of rows) {
    console.log(`${x.ticker} ${x.accession}: legacy ${x.legacy.length}; new ${x.errors.length + x.assumed.length} (errors ${x.errors.length}, assumed ${x.assumed.length}); weak ${x.weak}${x.drift ? `; drift ${x.drift}` : ""}${x.silentDrift ? "; silent surface drift" : ""}`);
    for (const l of x.legacy) console.log(`  legacy  ${l}`);
    for (const e of x.errors) console.log(`  error   ${e.field}: ${e.message.replace(/\s+/g, " ")} [${e.reason}]`);
    for (const a of x.assumed) console.log(`  assumed ${a.field}: "${a.raw}" (warning: argue its basis in the sentence)`);
  }
  for (const s of skipped) console.log(`skipped ${s}`);
  const s = summary;
  console.log(`\n${s.figures} figures; legacy ${s.legacy.figures} in ${s.legacy.reports}; new ${s.new.figures} in ${s.new.reports} (errors ${s.errors.figures} in ${s.errors.reports}, assumed ${s.assumed.figures} in ${s.assumed.reports}); excepted ${s.excepted}; stale ${s.stale}; drift ${s.drift}; silent surface drift: ${s.silentDrift.join(" ") || "none"}`);
}
process.exitCode = summary.errors.figures > 0 ? 1 : 0;
