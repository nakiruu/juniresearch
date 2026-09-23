import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listReportTickers, loadReport } from "../lib/reports";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import { FactPack } from "../lib/facts/schema";
import { resolveConfig, type PortfolioConfig } from "../lib/portfolio/config";
import { buildSignal, type Signal } from "../lib/portfolio/signal";
import { sizePortfolio } from "../lib/portfolio/sizing";
import { activeWeights } from "../lib/portfolio/benchmark";
import { assembleSnapshot, toCSV } from "../lib/portfolio/snapshot";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const asOf = flag("--date") ?? new Date().toISOString().slice(0, 10);
const overrides: Partial<PortfolioConfig> = {};
for (const k of ["wMax", "sectorMax", "cashCeiling", "muExp", "convExp", "rExp"] as const) {
  const v = flag(`--${k}`);
  if (v != null) {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      console.error(`Invalid --${k} value: ${JSON.stringify(v)} (expected a finite number)`);
      process.exit(1);
    }
    overrides[k] = n;
  }
}
const config = resolveConfig(overrides);
const today = new Date(asOf + "T00:00:00Z");

// Latest close from Yahoo over a short trailing window == the live mark.
// fetchDailyCloses returns the raw Yahoo v8 chart JSON as text (see lib/prices/yahoo.ts);
// parse it and pull the last non-null close out of indicators.quote[0].close.
async function livePrice(ticker: string): Promise<number> {
  const from = new Date(today.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
  const raw = JSON.parse(await fetchDailyCloses(ticker, from, asOf));
  const closes: number[] = raw.chart.result[0].indicators.quote[0].close.filter((c: number | null) => c != null);
  return closes[closes.length - 1];
}

function sicFor(ticker: string, accession: string): number | null {
  const p = join("data", "facts", ticker.toUpperCase(), `${accession}.json`);
  if (!existsSync(p)) return null;
  return FactPack.parse(JSON.parse(readFileSync(p, "utf8"))).sic ?? null;
}

const tickers = await listReportTickers();
const spyPrice = await livePrice("SPY"); // benchmark — a failure here should abort the run
const signals: Signal[] = [];
const failed: { ticker: string; error: string }[] = [];
for (const t of tickers) {
  try {
    const report = await loadReport(t);
    if (!report) continue;
    const price = await livePrice(report.meta.ticker);
    const sic = sicFor(report.meta.ticker, report.meta.filing.accession);
    signals.push(buildSignal(report, price, sic, today, config));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failed.push({ ticker: t, error: message });
    console.warn(`Skipping ${t}: ${message}`);
  }
}
if (failed.length) {
  console.warn(`Skipped ${failed.length} ticker(s): ${failed.map((f) => f.ticker).join(", ")}`);
}

const sized = sizePortfolio(signals, config);
const active = activeWeights(signals.map((s) => s.ticker), sized.holdings);
const snap = assembleSnapshot({ asOf, signals, sized, active, spyPrice, config });

const outDir = join("data", "portfolio");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `snapshot-${asOf}.json`), JSON.stringify(snap, null, 2) + "\n");
writeFileSync(join(outDir, `snapshot-${asOf}.csv`), toCSV(snap));

console.log(`Portfolio ${asOf} — ${snap.holdings.length} holdings, cash ${(snap.cash * 100).toFixed(1)}%, N_eff ${snap.meta.nEff.toFixed(1)}`);
for (const h of snap.holdings) console.log(`  ${h.ticker.padEnd(6)} ${(h.weight * 100).toFixed(1).padStart(5)}%  ${h.label}`);
