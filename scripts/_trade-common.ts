import { fetchDailyCloses } from "../lib/prices/yahoo";
import type { BrokerAdapter, BrokerCalendarDay } from "../lib/broker/adapter";
import { AlpacaPaperBroker } from "../lib/broker/alpaca";
import { FakeBroker } from "../lib/broker/fake";
import { readLedger } from "../lib/trade/ledger";
import { requireAlpaca } from "./_env";
export {
  TRADE_DIR, FILLS_PATH, LEDGER_PATH, RUNS_DIR, CRON_LOCK_PATH, CRON_LOG_PATH,
  HALT_STATE_PATH, SCHWAB_TOKEN_PATH, AUTH_WARN_PATH, schwabRefreshObtainedAt, brokerBaseUrl, loadReportsAndMeta,
  readRunRecord, latestRunRecord, readFills,
} from "../lib/trade/runtime";
import * as runtime from "../lib/trade/runtime";

export const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
export const has = (args: string[], name: string) => args.includes(name);

/** CLI wrappers: preserve the clean "message + exit 2" UX (runtime throws instead). */
export function makeAlpaca(): BrokerAdapter {
  try { return runtime.makeAlpaca(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
}
export function makeBroker(): BrokerAdapter {
  try { return runtime.makeBroker(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
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

async function yahooLastClose(ticker: string, from: string, to: string): Promise<number> {
  const raw = JSON.parse(await fetchDailyCloses(ticker, from, to));
  const closes: (number | null)[] = raw.chart.result[0].indicators.quote[0].close;
  const c = closes.filter((x): x is number => x != null).at(-1);
  if (c == null) throw new Error(`Yahoo: no close for ${ticker} in ${from}..${to}`);
  return c;
}

/**
 * The Phase-0 fake: its book comes from the local ledger; marks come from Alpaca (read-only) when
 * keys exist, else Yahoo. planRun computes its own mark date (prevTradingDay of the loaded
 * calendar), which need not equal calendar-yesterday, so we seed the fetched close FLAT across the
 * whole loaded calendar window (Phase-0 uses a flat-price approximation anyway) — whatever date the
 * pipeline requests then resolves. The fetch itself uses a small RANGE, not a single date, so it
 * never targets a non-trading day (weekend/holiday).
 */
export async function makeFakeBroker(tickers: string[], today: string): Promise<FakeBroker> {
  const ledger = readLedger(runtime.LEDGER_PATH);
  const from = shift(today, -90), to = shift(today, 45);
  let calendar: BrokerCalendarDay[];
  const closes: Record<string, Record<string, number>> = {};
  if (process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY) {
    const ro = new AlpacaPaperBroker(requireAlpaca());
    calendar = await ro.getCalendar(from, to);
    const dates = calendar.map((d) => d.date);
    const md = dates.filter((d) => d <= today).at(-1) ?? today; // most recent trading day on/before today
    const last = await ro.getLastClose(tickers, md);
    const seed = [...new Set([...dates, today])];
    for (const t of tickers) closes[t] = Object.fromEntries(seed.map((d) => [d, last[t]]));
  } else {
    calendar = weekdayCalendar(from, to);
    const seed = [...new Set([...calendar.map((d) => d.date), today])];
    for (const t of tickers) { const c = await yahooLastClose(t, shift(today, -10), today); closes[t] = Object.fromEntries(seed.map((d) => [d, c])); }
  }
  const b = new FakeBroker({ calendar, closes, equity: ledger?.nav ?? 100_000, cash: ledger?.cash ?? 100_000, isOpen: true, today });
  for (const p of ledger?.positions ?? []) await b.submitOrder({ symbol: p.ticker, side: "buy", qty: p.qty, clientOrderId: `seed-${p.ticker}`, estNotionalUsd: p.marketValue });
  return b;
}
export const shift = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
