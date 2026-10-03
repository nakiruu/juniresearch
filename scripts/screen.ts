/**
 * screen.ts — the pre-synthesis screen (lib/screen/screen.ts): order the /synthesize queue by Street upside.
 *
 *   npm run screen -- --query [TICKER ...]          # print the Shibui call(s); default = data/edgar/watchlist.json
 *   npm run screen -- --query --pending             # only tickers with a captured filing newer than their report
 *   npm run screen -- --query --published           # the calibration universe: every published report
 *   npm run screen -- --rank <saved.json> [more.json ...]  # ranked table + data/screen/<YYYY-MM-DD>.json
 *   npm run screen -- --calibrate <saved-response.json>   # likely-HOLD flag vs the published ratings
 *   (any mode) --as-of YYYY-MM-DD                   # bounds the query's date pre-filters (default today)
 *
 * Shibui Finance is a Claude connector, not an HTTP API: --query prints the `stock_data_query` call(s);
 * the capturer runs each and saves the response verbatim (several batches → a JSON array of responses);
 * --rank / --calibrate parse it. The screen ORDERS the queue — it never skips a filing.
 *
 * "Pending" is local and cheap: a filing captured by facts:prepare (data/raw/<T>/<ACC>/edgar-filing.json)
 * that is newer than the ticker's published report. `npm run detect` does not persist what it found, so a
 * detected-but-uncaptured filing is not visible here — run the screen over the detected tickers by name.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CALIBRATION_THRESHOLDS, LEGEND, LIKELY_HOLD_UPSIDE, SCREEN_USER_PROMPT, calibrate, isBuyLabel, median,
  parseScreenResponse, pendingFilings, rankCandidates, screenQueries, streetUpside,
  type CalibrationRow, type CalibrationSample, type CapturedFiling, type PublishedFiling,
} from "../lib/screen/screen";

interface PublishedReport {
  ticker: string; label: string; reportDate: string; accession: string; filedDate: string | null;
  price: number | null; consensusTarget: number | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const ymd = (s: string | undefined) => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s); // "Sep 10, 2026" → local midnight; read it back in local time
  return Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : null;
};

function publishedReports(): Map<string, PublishedReport> {
  const out = new Map<string, PublishedReport>();
  for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) {
    let d: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { d = JSON.parse(readFileSync(join("data", f), "utf8")); } catch { continue; }
    if (!d?.rating?.label || !d?.meta?.ticker) continue;
    out.set(String(d.meta.ticker).toUpperCase(), {
      ticker: String(d.meta.ticker).toUpperCase(), label: d.rating.label, reportDate: d.meta.reportDate,
      accession: d.meta.filing?.accession ?? "", filedDate: ymd(d.meta.filing?.filedDate),
      price: typeof d.quote?.currentPrice === "number" ? d.quote.currentPrice : null,
      consensusTarget: typeof d.analystSentiment?.consensusTarget === "number" ? d.analystSentiment.consensusTarget : null,
    });
  }
  return out;
}

function capturedFilings(): CapturedFiling[] {
  const out: CapturedFiling[] = [];
  for (const t of readdirSync(join("data", "raw"))) {
    if (t.startsWith("_") || !/^[A-Z0-9.\-]+$/.test(t)) continue;
    for (const acc of readdirSync(join("data", "raw", t))) {
      const p = join("data", "raw", t, acc, "edgar-filing.json");
      if (!existsSync(p)) continue;
      try {
        const f = JSON.parse(readFileSync(p, "utf8"));
        if (typeof f.filedDate === "string") out.push({ ticker: t, accession: acc, filedDate: f.filedDate, form: f.form });
      } catch { /* unreadable capture — skip */ }
    }
  }
  return out;
}

const pending = (reports: Map<string, PublishedReport>) =>
  pendingFilings(capturedFilings(), [...reports.values()].map((r): PublishedFiling => ({ ticker: r.ticker, accession: r.accession, filedDate: r.filedDate })));

const args = process.argv.slice(2);
const asOfIdx = args.indexOf("--as-of");
const asOf = asOfIdx >= 0 ? args.splice(asOfIdx, 2)[1] : today();
const [mode, ...rest] = args;

const pctCell = (x: number | null, w = 7) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`).padStart(w);
const numCell = (x: number | null, w = 9) => (x == null ? "—" : x.toFixed(2)).padStart(w);

if (mode === "--query") {
  const reports = publishedReports();
  let tickers: string[];
  if (rest.includes("--pending")) {
    const p = pending(reports);
    for (const f of p) console.error(`pending: ${f.ticker} ${f.form ?? ""} ${f.accession} filed ${f.filedDate}`);
    tickers = p.map((f) => f.ticker);
  } else if (rest.includes("--published")) {
    tickers = [...reports.keys()].sort();
  } else if (rest.length) {
    tickers = rest.map((t) => t.toUpperCase());
  } else {
    tickers = (JSON.parse(readFileSync("data/edgar/watchlist.json", "utf8")) as { ticker: string }[]).map((w) => w.ticker);
  }
  if (!tickers.length) { console.error("No tickers to screen."); process.exit(0); }
  const queries = screenQueries(tickers, asOf);
  console.error(`${tickers.length} ticker(s) → ${queries.length} Shibui call(s). Save the response(s) verbatim` +
    (queries.length > 1 ? " as a JSON array, one element per call," : "") + " then run --rank <file>.");
  console.log(JSON.stringify(queries.map((query) => ({ server: "shibui", tool: "stock_data_query", params: { query, user_prompt: SCREEN_USER_PROMPT } })), null, 2));
} else if (mode === "--rank" && rest[0]) {
  const files = rest; // several saved responses (e.g. one per batch) are merged; the first row per ticker wins
  const reports = publishedReports();
  const pend = new Map(pending(reports).map((p) => [p.ticker, p]));
  const ranked = rankCandidates(parseScreenResponse(files.map((f) => JSON.parse(readFileSync(f, "utf8")))));
  console.log(`Pre-synthesis screen — ${ranked.length} ticker(s), Shibui response(s) ${files.join(", ")}\n`);
  console.log("rank  ticker      close     target   upside  likely-HOLD  report (rating, date)              pending filing / note");
  for (const r of ranked) {
    const rep = reports.get(r.ticker);
    const p = pend.get(r.ticker);
    const repCell = rep ? `${rep.label} ${rep.reportDate}` : "no report";
    const note = [p ? `${p.form ?? "filing"} ${p.accession} filed ${p.filedDate}` : "", r.streetUpside == null ? r.reason : ""].filter(Boolean).join("; ");
    console.log(`${String(r.rank).padStart(4)}  ${r.ticker.padEnd(7)} ${numCell(r.close)} ${numCell(r.streetTarget, 10)} ${pctCell(r.streetUpside, 8)}  ${(r.likelyHold ? "HOLD?" : "").padEnd(11)}  ${repCell.padEnd(33)}  ${note}`);
  }
  const flagged = ranked.filter((r) => r.likelyHold).length;
  const noTarget = ranked.filter((r) => r.streetUpside == null).length;
  console.log(`\n${flagged} likely-HOLD (upside < ${LIKELY_HOLD_UPSIDE * 100}%), ${noTarget} without a Street target (ranked last).`);
  console.log(`Legend: ${LEGEND}`);
  const out = join("data", "screen", `${today()}.json`);
  mkdirSync(join("data", "screen"), { recursive: true });
  writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(), asOf, source: files, holdThreshold: LIKELY_HOLD_UPSIDE, legend: LEGEND,
    candidates: ranked.map((r) => {
      const rep = reports.get(r.ticker);
      const p = pend.get(r.ticker);
      return {
        rank: r.rank, ticker: r.ticker, close: r.close, priceDate: r.priceDate, streetTarget: r.streetTarget,
        streetUpside: r.streetUpside, priority: r.priority, likelyHold: r.likelyHold, reason: r.reason,
        report: rep ? { label: rep.label, reportDate: rep.reportDate, accession: rep.accession } : null,
        pendingFiling: p ?? null,
        context: { forwardPe: r.forwardPe, forwardPeg: r.forwardPeg, marketCap: r.marketCap, fcfYield: r.fcfYield, earningsQualityFlags: r.earningsQualityFlags, piotroski: r.piotroski },
      };
    }),
  }, null, 2) + "\n");
  console.log(`Wrote ${out}`);
} else if (mode === "--calibrate" && rest[0]) {
  const reports = publishedReports();
  const rows = new Map(parseScreenResponse(readFileSync(rest[0], "utf8")).map((r) => [r.ticker, r]));
  const snap: CalibrationSample[] = [], pit: CalibrationSample[] = [];
  for (const rep of reports.values()) {
    const row = rows.get(rep.ticker);
    snap.push({ ticker: rep.ticker, label: rep.label, upside: streetUpside(row?.streetTarget ?? null, row?.close ?? null) });
    pit.push({ ticker: rep.ticker, label: rep.label, upside: streetUpside(rep.consensusTarget, rep.price) });
  }
  const labels = [...reports.values()].reduce<Record<string, number>>((m, r) => ((m[r.label] = (m[r.label] ?? 0) + 1), m), {});
  console.log(`Calibration over ${reports.size} published reports: ${Object.entries(labels).map(([k, v]) => `${v} ${k}`).join(", ")}\n`);
  const show = (title: string, samples: CalibrationSample[]) => {
    const missing = samples.filter((s) => s.upside == null);
    const med = (pred: (l: string) => boolean) => median(samples.filter((s) => s.upside != null && pred(s.label)).map((s) => s.upside!));
    console.log(`${title}  (no upside: ${missing.length ? missing.map((s) => `${s.ticker} ${s.label}`).join(", ") : "none"})`);
    console.log("  threshold   HOLD flagged    BUY flagged    runs deferred   buys deferred");
    for (const c of calibrate(samples, CALIBRATION_THRESHOLDS) as CalibrationRow[]) {
      const share = (n: number, d: number) => `${n}/${d} ${d ? Math.round((100 * n) / d) : 0}%`.padEnd(13);
      console.log(`  ${`${c.threshold * 100}%`.padStart(6)}      ${share(c.holdFlagged, c.holds)}  ${share(c.buyFlagged, c.buys)}  ${String(c.deferred).padStart(8)}        ${String(c.buysDeferred).padStart(8)}`);
    }
    const mb = med(isBuyLabel), mh = med((l) => l === "HOLD");
    console.log(`  median Street upside: BUY ${mb == null ? "—" : (mb * 100).toFixed(1) + "%"}, HOLD ${mh == null ? "—" : (mh * 100).toFixed(1) + "%"}\n`);
  };
  show("Today's Shibui snapshot (target / latest close)", snap);
  show("Point-in-time (report's own analystSentiment.consensusTarget / quote.currentPrice)", pit);
  console.log("Caveat: Shibui targets are today's snapshot; each report was written on its own date. The screen orders the queue, it never skips.");
} else {
  console.error("usage: screen.ts --query [TICKER ...|--pending|--published] | --rank <file> [file ...] | --calibrate <file>  [--as-of YYYY-MM-DD]");
  process.exit(2);
}
