/**
 * alpaca.ts — Alpaca Paper Trading REST client (spec §8.2). Thin: native fetch, tolerant zod on every
 * response (only the fields we use), numeric strings converted here and nowhere else. Constructing
 * it against anything but the paper endpoint is an error — there is no live mode in this code.
 */
import { z } from "zod";
import type { BrokerAdapter, BrokerAccount, BrokerCalendarDay, BrokerClock, BrokerOrder, BrokerOrderStatus, BrokerPosition, LatestSnapshot, SubmitOrderRequest } from "./adapter";
import { PAPER_HOST } from "./guards";
import { DEFAULT_TIMEOUTS, BrokerTimeoutError, OrderRejectedError, SubmitOutcomeUnknownError, fetchWithTimeout, withReadRetry } from "./http";

export interface AlpacaOptions {
  keyId: string; secretKey: string; baseUrl: string; dataBaseUrl?: string; feed?: "iex" | "sip"; fetchImpl?: typeof fetch;
  timeouts?: { readMs?: number; submitMs?: number }; retryDelaysMs?: readonly number[];
}

const num = z.union([z.number(), z.string()]).transform((v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; });
const numOrNull = z.union([num, z.null(), z.undefined()]).transform((v) => (v == null ? null : v));
// Unlike `num`/`numOrNull`, never throws: a non-numeric value degrades to null instead of aborting the parse.
// Used for the latest-trade/quote price fields, which must tolerate garbage data and return null (spec: "missing/zero/unparseable → null").
const numOrNullSoft = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
});
const Account = z.object({ equity: num, cash: num, buying_power: num });
const Position = z.object({ symbol: z.string(), qty: num, market_value: num, avg_entry_price: num });
const Clock = z.object({ timestamp: z.string(), is_open: z.boolean(), next_open: z.string(), next_close: z.string() });
const CalendarDay = z.object({ date: z.string(), open: z.string(), close: z.string() });
const Order = z.object({
  id: z.string(), client_order_id: z.string(), symbol: z.string(), side: z.enum(["buy", "sell"]), status: z.string(),
  qty: numOrNull, notional: numOrNull, filled_qty: numOrNull, filled_avg_price: numOrNull, filled_at: z.string().nullable().optional(), submitted_at: z.string().nullable().optional(),
});
const Bars = z.object({ bars: z.record(z.string(), z.array(z.object({ t: z.string(), c: num }))).default({}), next_page_token: z.string().nullable().optional() });
const Asset = z.object({ symbol: z.string(), fractionable: z.boolean() });
const LatestTrade = z.object({ trade: z.object({ p: numOrNullSoft.optional(), t: z.string().optional() }).optional() });
const LatestQuote = z.object({ quote: z.object({ bp: numOrNullSoft.optional(), ap: numOrNullSoft.optional(), t: z.string().optional() }).optional() });
/** /v2/stocks/snapshots: a map symbol → snapshot (null for a symbol with no data); only the latest trade and quote are read. */
const Snapshots = z.record(z.string(), z.object({
  latestTrade: z.object({ p: numOrNullSoft.optional(), t: z.string().optional() }).nullable().optional(),
  latestQuote: z.object({ bp: numOrNullSoft.optional(), ap: numOrNullSoft.optional(), t: z.string().optional() }).nullable().optional(),
}).nullable());
/** Symbols per snapshots request (getLatestSnapshots). */
const SNAPSHOT_BATCH = 200;

/** A latest trade as the adapter reports it: positive price and a parseable timestamp, else null. */
function tradeOf(t: { p?: number | null; t?: string } | null | undefined): LatestSnapshot["lastTrade"] {
  const price = t?.p ?? null;
  const tsMs = t?.t ? Date.parse(t.t) : NaN;
  return price == null || !(price > 0) || !Number.isFinite(tsMs) ? null : { price, tsMs };
}
/** A latest quote: positive bid and ask and a parseable timestamp, else null. */
function quoteOf(q: { bp?: number | null; ap?: number | null; t?: string } | null | undefined): LatestSnapshot["quote"] {
  const bid = q?.bp ?? null, ask = q?.ap ?? null;
  const tsMs = q?.t ? Date.parse(q.t) : NaN;
  return bid == null || !(bid > 0) || ask == null || !(ask > 0) || !Number.isFinite(tsMs) ? null : { bid, ask, tsMs };
}

export class AlpacaPaperBroker implements BrokerAdapter {
  readonly kind = "alpaca-paper" as const;
  private readonly base: string; private readonly data: string; private readonly feed: string; private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly readMs: number; private readonly submitMs: number; private readonly retryDelaysMs?: readonly number[];
  constructor(opts: AlpacaOptions) {
    if (!opts.baseUrl.includes(PAPER_HOST)) throw new Error(`AlpacaPaperBroker: baseUrl must be the paper endpoint (${PAPER_HOST}); got ${opts.baseUrl}`);
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.data = (opts.dataBaseUrl ?? "https://data.alpaca.markets").replace(/\/$/, "");
    this.feed = opts.feed ?? "iex";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.headers = { "APCA-API-KEY-ID": opts.keyId, "APCA-API-SECRET-KEY": opts.secretKey, accept: "application/json" };
    this.readMs = opts.timeouts?.readMs ?? DEFAULT_TIMEOUTS.readMs;
    this.submitMs = opts.timeouts?.submitMs ?? DEFAULT_TIMEOUTS.submitMs;
    this.retryDelaysMs = opts.retryDelaysMs;
  }
  /** An idempotent GET: bounded, retried on transient failure. */
  private async call<T>(schema: z.ZodType<T>, url: string): Promise<T> {
    const res = await withReadRetry(() => fetchWithTimeout(this.fetchImpl, url, { headers: this.headers }, this.readMs, "read"), this.retryDelaysMs);
    if (!res.ok) throw new Error(`Alpaca GET ${url} → ${res.status}: ${res.text.slice(0, 300)}`);
    return schema.parse(JSON.parse(res.text));
  }
  private toOrder(o: z.infer<typeof Order>): BrokerOrder {
    return { id: o.id, clientOrderId: o.client_order_id, symbol: o.symbol, side: o.side, status: o.status as BrokerOrderStatus,
      qty: o.qty, notional: o.notional, filledQty: o.filled_qty ?? 0, filledAvgPrice: o.filled_avg_price, filledAt: o.filled_at ?? null, submittedAt: o.submitted_at ?? null };
  }
  async getClock(): Promise<BrokerClock> {
    const c = await this.call(Clock, `${this.base}/v2/clock`);
    return { timestamp: c.timestamp, isOpen: c.is_open, nextOpen: c.next_open, nextClose: c.next_close };
  }
  async getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]> {
    return this.call(z.array(CalendarDay), `${this.base}/v2/calendar?start=${from}&end=${to}`);
  }
  async getAccount(): Promise<BrokerAccount> {
    const a = await this.call(Account, `${this.base}/v2/account`);
    return { equity: a.equity, cash: a.cash, buyingPower: a.buying_power };
  }
  async getPositions(): Promise<BrokerPosition[]> {
    return (await this.call(z.array(Position), `${this.base}/v2/positions`)).map((p) => ({ symbol: p.symbol, qty: p.qty, marketValue: p.market_value, avgEntryPrice: p.avg_entry_price }));
  }
  async getOrders(status: "open" | "closed" | "all", after?: string): Promise<BrokerOrder[]> {
    // Newest first: with `limit`, an ascending listing past 500 orders would return only the OLDEST
    // page and a fresh order would never be seen by the fill poll or the audit.
    const q = new URLSearchParams({ status, limit: "500", direction: "desc" }); if (after) q.set("after", after);
    return (await this.call(z.array(Order), `${this.base}/v2/orders?${q}`)).map((o) => this.toOrder(o));
  }
  /**
   * The last daily close on or before tradingDate, from a 10-calendar-day window (as SchwabBroker.getLastClose):
   * a trading day gets its own bar, exactly as before; a weekend or holiday (a report's price date) gets the
   * prior session's. The multi-symbol endpoint caps bars per page across ALL symbols, and a window holds ~7
   * bars per symbol, so pages are followed to the end — a symbol cut off mid-window would read a stale close.
   */
  async getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>> {
    const start = new Date(Date.parse(tradingDate + "T00:00:00Z") - 10 * 86_400_000).toISOString().slice(0, 10);
    const bySymbol: Record<string, { t: string; c: number }[]> = {};
    let pageToken: string | null | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error(`Alpaca: daily bars for ${symbols.length} symbols ending ${tradingDate} still paging after ${page} pages`);
      const q = new URLSearchParams({ symbols: symbols.join(","), timeframe: "1Day", start, end: tradingDate, limit: "1000", adjustment: "raw", feed: this.feed });
      if (pageToken) q.set("page_token", pageToken);
      const body = await this.call(Bars, `${this.data}/v2/stocks/bars?${q}`);
      for (const [s, b] of Object.entries(body.bars)) (bySymbol[s] ??= []).push(...b);
      pageToken = body.next_page_token;
      if (!pageToken) break;
    }
    const out: Record<string, number> = {};
    for (const s of symbols) {
      // Daily bars are stamped at midnight ET ("2026-09-24T04:00:00Z"), so the UTC date is the session date.
      const b = (bySymbol[s] ?? []).filter((x) => x.t.slice(0, 10) <= tradingDate).sort((x, y) => x.t.localeCompare(y.t)).at(-1);
      if (!b) throw new Error(`Alpaca: no bar for ${s} on/before ${tradingDate}`);
      out[s] = b.c;
    }
    return out;
  }
  async getLatestTrade(symbol: string): Promise<{ price: number; tsMs: number } | null> {
    const body = await this.call(LatestTrade, `${this.data}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=${this.feed}`);
    return tradeOf(body.trade);
  }
  async getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; tsMs: number } | null> {
    const body = await this.call(LatestQuote, `${this.data}/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=${this.feed}`);
    return quoteOf(body.quote);
  }
  /** One /v2/stocks/snapshots request per SNAPSHOT_BATCH symbols, read with the same rules as getLatestTrade/getLatestQuote. */
  async getLatestSnapshots(symbols: string[]): Promise<Record<string, LatestSnapshot>> {
    const out: Record<string, LatestSnapshot> = {};
    const list = [...new Set(symbols)];
    for (let i = 0; i < list.length; i += SNAPSHOT_BATCH) {
      const chunk = list.slice(i, i + SNAPSHOT_BATCH);
      const body = await this.call(Snapshots, `${this.data}/v2/stocks/snapshots?symbols=${chunk.map(encodeURIComponent).join(",")}&feed=${this.feed}`);
      for (const s of chunk) { const snap = body[s]; out[s] = { lastTrade: tradeOf(snap?.latestTrade), quote: quoteOf(snap?.latestQuote) }; }
    }
    return out;
  }
  async isFractionable(symbols: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const s of symbols) out[s] = (await this.call(Asset, `${this.base}/v2/assets/${encodeURIComponent(s)}`)).fractionable;
    return out;
  }
  async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
    if ((req.qty == null) === (req.notional == null)) throw new Error("submitOrder: exactly one of qty or notional");
    const body = { symbol: req.symbol, side: req.side, client_order_id: req.clientOrderId,
      ...(req.limitPrice != null
        ? { type: "limit", limit_price: String(req.limitPrice), time_in_force: req.timeInForce ?? "day" }
        : { type: "market", time_in_force: "day" }),
      ...(req.notional != null ? { notional: String(req.notional) } : { qty: String(req.qty) }) };
    const url = `${this.base}/v2/orders`;
    const startAt = new Date().toISOString();
    let res;
    try {
      // Never retried: a resend could double the order. An unknown outcome is resolved by findSubmitted.
      res = await fetchWithTimeout(this.fetchImpl, url, { method: "POST", headers: { ...this.headers, "content-type": "application/json" }, body: JSON.stringify(body) }, this.submitMs, "submit");
    } catch (e) {
      if (e instanceof BrokerTimeoutError || e instanceof TypeError) throw new SubmitOutcomeUnknownError(req.clientOrderId, req.symbol, startAt, e.message);
      throw e;
    }
    if (res.status >= 500) throw new SubmitOutcomeUnknownError(req.clientOrderId, req.symbol, startAt, `Alpaca POST → ${res.status}`);
    if (!res.ok) throw new OrderRejectedError(req.symbol, `Alpaca POST ${url} → ${res.status}: ${res.text.slice(0, 300)}`); // 4xx: definitively not accepted
    return this.toOrder(Order.parse(JSON.parse(res.text)));
  }
  /** Alpaca keeps our client_order_id, so a timed-out submit is found by exact id. */
  async findSubmitted(req: SubmitOrderRequest): Promise<BrokerOrder | null> {
    const url = `${this.base}/v2/orders:by_client_order_id?${new URLSearchParams({ client_order_id: req.clientOrderId })}`;
    const res = await withReadRetry(() => fetchWithTimeout(this.fetchImpl, url, { headers: this.headers }, this.readMs, "read"), this.retryDelaysMs);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Alpaca GET ${url} → ${res.status}: ${res.text.slice(0, 300)}`);
    return this.toOrder(Order.parse(JSON.parse(res.text)));
  }
  async cancelOrder(id: string): Promise<void> {
    const res = await fetchWithTimeout(this.fetchImpl, `${this.base}/v2/orders/${id}`, { method: "DELETE", headers: this.headers }, this.readMs, "read");
    if (!res.ok && res.status !== 404) throw new Error(`Alpaca DELETE order ${id} → ${res.status}`);
  }
}
