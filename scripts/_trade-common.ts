import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listReportTickers, loadReport } from "../lib/reports";
import { FactPack } from "../lib/facts/schema";
import { fetchDailyCloses } from "../lib/prices/yahoo";
import type { Report } from "../lib/report.schema";
import type { BrokerAdapter, BrokerCalendarDay } from "../lib/broker/adapter";
import { AlpacaPaperBroker } from "../lib/broker/alpaca";
import { FakeBroker } from "../lib/broker/fake";
import { readFills } from "../lib/trade/fills";
import { readLedger } from "../lib/trade/ledger";
import { requireAlpaca } from "./_env";

export const TRADE_DIR = join("data", "trade");
export const FILLS_PATH = join(TRADE_DIR, "fills.jsonl");
export const LEDGER_PATH = join(TRADE_DIR, "ledger.json");
export const RUNS_DIR = join(TRADE_DIR, "runs");

export const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
export const has = (args: string[], name: string) => args.includes(name);

export async function loadReportsAndMeta(): Promise<{ reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null> }> {
  const reports: Report[] = [], sics: Record<string, number | null> = {}, marketCapUsd: Record<string, number | null> = {};
  for (const t of await listReportTickers()) {
    const r = await loadReport(t); if (!r) continue;
    reports.push(r);
    const p = join("data", "facts", r.meta.ticker.toUpperCase(), `${r.meta.filing.accession}.json`);
    sics[r.meta.ticker] = existsSync(p) ? FactPack.parse(JSON.parse(readFileSync(p, "utf8"))).sic ?? null : null;
    const cell = (r as unknown as { snapshot?: { label: string; value: unknown }[] }).snapshot?.find((c) => /market cap/i.test(c.label));
    marketCapUsd[r.meta.ticker] = typeof cell?.value === "number" ? cell.value : null;
  }
  return { reports, sics, marketCapUsd };
}

/** Weekday calendar for Phase 0 when no Alpaca keys are present (holidays are NOT excluded — a documented approximation). */
export function weekdayCalendar(from: string, to: string): BrokerCalendarDay[] {
  const out: BrokerCalendarDay[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86_400_000)) {
    const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), open: "09:30", close: "16:00" });
  }
  return out;
}

async function yahooClose(ticker: string, date: string): Promise<number> {
  const raw = JSON.parse(await fetchDailyCloses(ticker, date, date));
  const closes: (number | null)[] = raw.chart.result[0].indicators.quote[0].close;
  const c = closes.filter((x): x is number => x != null).at(-1);
  if (c == null) throw new Error(`Yahoo: no close for ${ticker} on ${date}`);
  return c;
}

/** The Phase-0 fake: its book comes from the local ledger; marks come from Alpaca (read-only) when keys exist, else Yahoo. */
export async function makeFakeBroker(tickers: string[], today: string, markDate: string): Promise<FakeBroker> {
  const ledger = readLedger(LEDGER_PATH);
  let calendar: BrokerCalendarDay[], closes: Record<string, Record<string, number>> = {};
  if (process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY) {
    const ro = new AlpacaPaperBroker(requireAlpaca());
    calendar = await ro.getCalendar(shift(today, -90), shift(today, 45));
    const last = await ro.getLastClose(tickers, markDate);
    for (const t of tickers) closes[t] = { [markDate]: last[t], [today]: last[t] };
  } else {
    calendar = weekdayCalendar(shift(today, -90), shift(today, 45));
    for (const t of tickers) { const c = await yahooClose(t, markDate); closes[t] = { [markDate]: c, [today]: c }; }
  }
  const b = new FakeBroker({ calendar, closes, equity: ledger?.nav ?? 100_000, cash: ledger?.cash ?? 100_000, isOpen: true, today });
  for (const p of ledger?.positions ?? []) await b.submitOrder({ symbol: p.ticker, side: "buy", qty: p.qty, clientOrderId: `seed-${p.ticker}`, estNotionalUsd: p.marketValue });
  return b;
}
export const shift = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
export function makeAlpaca(): BrokerAdapter { return new AlpacaPaperBroker(requireAlpaca()); }
export { readFills };
