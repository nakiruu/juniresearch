/**
 * calibration-log.ts — log every report's predicted upside (E) against the realized return (audit S3).
 *
 *   node --import tsx scripts/calibration-log.ts --query [--batch 100]       # print the Shibui call(s)
 *   node --import tsx scripts/calibration-log.ts --apply <file> [<file>...]  # → data/calibration/<today>.json
 *   (either mode also takes --today YYYY-MM-DD; default: the local date)
 *
 * Prediction points are the current data/<t>.json files plus every earlier git revision of them
 * (read-only `git log` / `git show`), one per distinct (ticker, quote date). The capture step runs each
 * printed query through the Shibui Finance connector (mcp__Shibui_Finance__stock_data_query) and saves
 * the response verbatim under data/raw/_shibui/; --apply parses those files and does the arithmetic in
 * lib/calibration/realized.ts. Nothing here feeds sizing — it is an evidence log.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CALIBRATION_USER_PROMPT, HORIZON_KEYS, LABEL_GROUPS, MIN_N, outcomeBatches, outcomeQuery, parseOutcomeResponse,
  predictionPoints, scorePoints, type Cell, type ReportRevision,
} from "../lib/calibration/realized";

const DATA = "data";
const OUT = "data/calibration";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const localYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const today = opt("--today") ?? localYmd();

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

/** The working-tree report files and every committed revision of each. */
function collectRevisions(): { revisions: ReportRevision[]; files: number } {
  const isReport = (f: string) => /^[a-z0-9.\-]+\.json$/.test(f);
  const present = new Set(readdirSync(DATA).filter(isReport));
  // Reports deleted since (e.g. withdrawn coverage) are predictions too — leaving them out would be survivorship bias.
  const everCommitted = git("log", "--format=", "--name-only", "--", `${DATA}/*.json`)
    .split("\n").filter((p) => p.startsWith(`${DATA}/`) && isReport(p.slice(DATA.length + 1))).map((p) => p.slice(DATA.length + 1));
  const files = [...new Set([...present, ...everCommitted])].sort();
  const revisions: ReportRevision[] = [];
  for (const f of files) {
    const path = `${DATA}/${f}`;
    if (present.has(f)) {
      try {
        revisions.push({ sha: null, committedAt: null, report: JSON.parse(readFileSync(path, "utf8")) });
      } catch { /* unparseable working file: skipped like a bad revision */ }
    }
    for (const line of git("log", "--format=%H %cI", "--", path).split("\n").filter(Boolean)) {
      const [sha, committedAt] = line.split(" ");
      let text: string;
      try {
        text = git("show", `${sha}:${path}`);
      } catch {
        continue; // the commit that deleted the file: not a revision
      }
      let report: unknown = null; // not JSON → predictionPoints counts it as skipped
      try {
        report = JSON.parse(text);
      } catch { /* keep null */ }
      revisions.push({ sha, committedAt, report });
    }
  }
  return { revisions, files: files.length };
}

const pct = (c: Cell, dp = 1) => (c.value == null ? "—" : `${(c.value * 100).toFixed(dp)}%`);
const raw = (c: Cell) => (c.value == null ? "—" : c.value.toFixed(2));

const flag = args[0];
if (flag === "--query") {
  const { points } = predictionPoints(collectRevisions().revisions);
  const size = Number(opt("--batch") ?? 100);
  const batches = outcomeBatches(points, size);
  console.log(JSON.stringify(batches.map((b) => ({
    tool: "mcp__Shibui_Finance__stock_data_query",
    points: b.length,
    params: { query: outcomeQuery(b, today), user_prompt: CALIBRATION_USER_PROMPT },
  })), null, 2));
} else if (flag === "--apply" && args.length > 1) {
  const inputs = args.slice(1).filter((a, i, all) => a !== "--today" && all[i - 1] !== "--today");
  const { revisions, files } = collectRevisions();
  const { points, skipped } = predictionPoints(revisions);
  const rows = inputs.flatMap((f) => parseOutcomeResponse(readFileSync(f, "utf8")));
  const { points: scored, summary } = scorePoints(points, rows, today);
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const outFile = join(OUT, `${today}.json`);
  const asOfs = scored.map((p) => p.asOf).sort();
  writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    today,
    source: { reports: files, revisions: revisions.length, skippedRevisions: skipped.length, shibuiResponses: inputs },
    summary,
    points: scored,
  }, null, 2) + "\n");

  const current = scored.filter((p) => p.source === "current").length;
  console.log(`Prediction points: ${scored.length} (${current} current, ${scored.length - current} from git history only) over ${summary.names} names`);
  console.log(`  quote dates ${asOfs[0]} … ${asOfs[asOfs.length - 1]}; ${revisions.length} revisions read, ${skipped.length} skipped (unparseable)`);
  console.log(`  excluded from aggregates: ${summary.excluded.length}${summary.excluded.length ? " — " + summary.excluded.map((e) => `${e.ticker}@${e.asOf} ${e.reason}`).join(", ") : ""}`);
  const reached = HORIZON_KEYS.map((k) => `${k} ${scored.filter((p) => p.horizons[k]).length}`).join(", ");
  console.log(`  points with a realized return: ${reached}`);
  console.log(`\nMIN_N = ${MIN_N} distinct names per cell; "—" = insufficient data (or undefined).`);
  console.log("group      horizon   n  names  days  meanE   meanRet  medRet  meanExc  medExc  hit    rho(E,exc)  real/E  real/E(pro-rata)");
  for (const g of LABEL_GROUPS) {
    for (const k of HORIZON_KEYS) {
      const s = summary.groups[g][k];
      if (!s.meanRet.n) {
        console.log(`${g.padEnd(10)} ${k.padEnd(7)}    0      0  insufficient data (0 points have reached this horizon)`);
        continue;
      }
      console.log([
        g.padEnd(10), k.padEnd(7), String(s.meanRet.n).padStart(4), String(s.meanRet.nNames).padStart(6), String(s.medianDays ?? "—").padStart(5),
        pct(s.meanE).padStart(7), pct(s.meanRet).padStart(8), pct(s.medianRet).padStart(7),
        pct(s.meanExcess).padStart(8), pct(s.medianExcess).padStart(7), pct(s.hitRate, 0).padStart(5),
        raw(s.spearmanEvsExcess).padStart(11), raw(s.calibrationRatio).padStart(7), raw(s.calibrationRatioProRata).padStart(17),
      ].join(" "));
    }
  }
  console.log(`\nWrote ${outFile}`);
} else {
  console.error("usage: calibration-log.ts --query [--batch N] [--today YYYY-MM-DD] | --apply <saved-response.json> [...] [--today YYYY-MM-DD]");
  process.exit(2);
}
