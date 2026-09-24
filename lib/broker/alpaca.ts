/**
 * alpaca.ts — Alpaca Paper Trading REST client (spec §8.2). Thin: native fetch, tolerant zod on every
 * response (only the fields we use), numeric strings converted here and nowhere else. Constructing
 * it against anything but the paper endpoint is an error — there is no live mode in this code.
 */
import { z } from "zod";
import type { BrokerAdapter, BrokerAccount, BrokerCalendarDay, BrokerClock, BrokerOrder, BrokerOrderStatus, BrokerPosition, SubmitOrderRequest } from "./adapter";
import { PAPER_HOST } from "./guards";

export interface AlpacaOptions { keyId: string; secretKey: string; baseUrl: string; dataBaseUrl?: string; feed?: "iex" | "sip"; fetchImpl?: typeof fetch }

const num = z.union([z.number(), z.string()]).transform((v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; });
const numOrNull = z.union([num, z.null(), z.undefined()]).transform((v) => (v == null ? null : v));
const Account = z.object({ equity: num, cash: num, buying_power: num });
const Position = z.object({ symbol: z.string(), qty: num, market_value: num, avg_entry_price: num });
const Clock = z.object({ timestamp: z.string(), is_open: z.boolean(), next_open: z.string(), next_close: z.string() });
const CalendarDay = z.object({ date: z.string(), open: z.string(), close: z.string() });
const Order = z.object({
  id: z.string(), client_order_id: z.string(), symbol: z.string(), side: z.enum(["buy", "sell"]), status: z.string(),
  qty: numOrNull, notional: numOrNull, filled_qty: numOrNull, filled_avg_price: numOrNull, filled_at: z.string().nullable().optional(), submitted_at: z.string().nullable().optional(),
});
const Bars = z.object({ bars: z.record(z.string(), z.array(z.object({ t: z.string(), c: num }))).default({}) });
const Asset = z.object({ symbol: z.string(), fractionable: z.boolean() });

export class AlpacaPaperBroker implements BrokerAdapter {
  readonly kind = "alpaca-paper" as const;
  private readonly base: string; private readonly data: string; private readonly feed: string; private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  constructor(opts: AlpacaOptions) {
    if (!opts.baseUrl.includes(PAPER_HOST)) throw new Error(`AlpacaPaperBroker: baseUrl must be the paper endpoint (${PAPER_HOST}); got ${opts.baseUrl}`);
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.data = (opts.dataBaseUrl ?? "https://data.alpaca.markets").replace(/\/$/, "");
    this.feed = opts.feed ?? "iex";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.headers = { "APCA-API-KEY-ID": opts.keyId, "APCA-API-SECRET-KEY": opts.secretKey, accept: "application/json" };
  }
  private async call<T>(schema: z.ZodType<T>, url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(url, { ...init, headers: { ...this.headers, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Alpaca ${init.method ?? "GET"} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return schema.parse(JSON.parse(text));
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
    const q = new URLSearchParams({ status, limit: "500", direction: "asc" }); if (after) q.set("after", after);
    return (await this.call(z.array(Order), `${this.base}/v2/orders?${q}`)).map((o) => this.toOrder(o));
  }
  async getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>> {
    const q = new URLSearchParams({ symbols: symbols.join(","), timeframe: "1Day", start: tradingDate, end: tradingDate, limit: "1000", adjustment: "raw", feed: this.feed });
    const { bars } = await this.call(Bars, `${this.data}/v2/stocks/bars?${q}`);
    const out: Record<string, number> = {};
    for (const s of symbols) { const b = bars[s]; if (!b?.length) throw new Error(`Alpaca: no bar for ${s} on ${tradingDate}`); out[s] = b[b.length - 1].c; }
    return out;
  }
  async isFractionable(symbols: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const s of symbols) out[s] = (await this.call(Asset, `${this.base}/v2/assets/${encodeURIComponent(s)}`)).fractionable;
    return out;
  }
  async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
    if ((req.qty == null) === (req.notional == null)) throw new Error("submitOrder: exactly one of qty or notional");
    const body = { symbol: req.symbol, side: req.side, type: "market", time_in_force: "day", client_order_id: req.clientOrderId,
      ...(req.notional != null ? { notional: String(req.notional) } : { qty: String(req.qty) }) };
    return this.toOrder(await this.call(Order, `${this.base}/v2/orders`, { method: "POST", body: JSON.stringify(body) }));
  }
  async cancelOrder(id: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/v2/orders/${id}`, { method: "DELETE", headers: this.headers });
    if (!res.ok && res.status !== 404) throw new Error(`Alpaca DELETE order ${id} → ${res.status}`);
  }
}
