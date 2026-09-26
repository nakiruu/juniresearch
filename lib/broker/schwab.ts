/**
 * schwab.ts — Charles Schwab Trader API client (spec §3). LIVE trading: constructing and using this
 * places real orders on a funded account. Thin, like alpaca.ts: injected fetch, tolerant zod on every
 * response (only the fields we use), OAuth bearer from schwab-auth. Field names follow the community
 * docs and are confirmed against the live account in the first smoke run (the same posture Alpaca's
 * unverified endpoints used).
 *
 * Schwab has no client-order-id, so this adapter absorbs the impedance mismatch: it keeps a
 * brokerId→clientOrderId map (populated at submit from the POST Location header) and stamps
 * clientOrderId back onto every order it returns, so the poll loop and the broker-truth audit — which
 * join on clientOrderId — keep working unchanged. Whole-share only (Schwab API has no fractional).
 */
import { z } from "zod";
import type { BrokerAdapter, BrokerAccount, BrokerCalendarDay, BrokerClock, BrokerOrder, BrokerOrderStatus, BrokerPosition, SubmitOrderRequest } from "./adapter";
import { SCHWAB_HOST } from "./guards";
import { nyseTradingDays } from "../trade/nyse-calendar";
import { etMinutesOfDay, etWallToUtc, hhmmToMinutes, todayET } from "../trade/clock";
import { ensureAccessToken, type SchwabTokenStore } from "./schwab-auth";

export interface SchwabOptions {
  tokenStore: SchwabTokenStore; clientId: string; clientSecret: string; accountHash: string;
  traderBase?: string; dataBase?: string; fetchImpl?: typeof fetch; nowMs?: () => number;
}

const num = z.union([z.number(), z.string()]).transform((v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; });
const numOrNull = z.union([num, z.null(), z.undefined()]).transform((v) => (v == null ? null : v));
const numSoft = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; });

const Balances = z.object({ liquidationValue: num, cashBalance: num, buyingPower: numOrNull.optional(), availableFunds: numOrNull.optional() });
const AccountResp = z.object({ securitiesAccount: z.object({ currentBalances: Balances, positions: z.array(z.object({
  instrument: z.object({ symbol: z.string() }), longQuantity: numOrNull.optional(), marketValue: numOrNull.optional(), averagePrice: numOrNull.optional(),
})).default([]) }) });
const ExecLeg = z.object({ quantity: numSoft.optional(), price: numSoft.optional(), time: z.string().optional() });
const OrderResp = z.object({
  orderId: z.union([z.number(), z.string()]).transform(String), status: z.string(),
  quantity: numOrNull.optional(), filledQuantity: numOrNull.optional(), enteredTime: z.string().optional(),
  orderLegCollection: z.array(z.object({ instruction: z.string(), instrument: z.object({ symbol: z.string() }), quantity: numOrNull.optional() })).default([]),
  orderActivityCollection: z.array(z.object({ executionLegs: z.array(ExecLeg).default([]) })).default([]),
});
const Quote = z.object({ quote: z.object({ lastPrice: numSoft.optional(), bidPrice: numSoft.optional(), askPrice: numSoft.optional(), tradeTime: numSoft.optional(), quoteTime: numSoft.optional() }).optional() });
const QuotesResp = z.record(z.string(), Quote);
const PriceHistory = z.object({ candles: z.array(z.object({ close: num, datetime: z.number() })).default([]) });
const Session = z.object({ start: z.string(), end: z.string() });
/** /markets: `isOpen` is a DATE-level flag ("equities trade on this date"), true all day and night on a
 *  trading day — verified against live responses (__fixtures__/schwab-markets-*.json). The session
 *  window comes from sessionHours.regularMarket. The inner key varies ("EQ" on a trading day, "equity"
 *  on a closed one), so the first entry is read. */
const Markets = z.object({ equity: z.record(z.string(), z.object({
  isOpen: z.boolean().optional(),
  sessionHours: z.object({ regularMarket: z.array(Session).optional() }).optional(),
})).optional() });

/** Schwab order status → the adapter's BrokerOrderStatus (unmapped/working states collapse to the non-terminal "new"). */
const STATUS: Record<string, BrokerOrderStatus> = {
  FILLED: "filled", CANCELED: "canceled", REJECTED: "rejected", EXPIRED: "expired", REPLACED: "replaced",
  PENDING_CANCEL: "pending_cancel", PENDING_REPLACE: "pending_replace", ACCEPTED: "accepted", PENDING_ACTIVATION: "pending_new",
};
const mapStatus = (s: string): BrokerOrderStatus => STATUS[s.toUpperCase()] ?? "new";

export class SchwabBroker implements BrokerAdapter {
  readonly kind = "schwab" as const;
  private readonly trader: string; private readonly data: string; private readonly fetchImpl: typeof fetch; private readonly now: () => number;
  private readonly cidByBrokerId = new Map<string, string>();
  constructor(private readonly opts: SchwabOptions) {
    this.trader = (opts.traderBase ?? `https://${SCHWAB_HOST}/trader/v1`).replace(/\/$/, "");
    this.data = (opts.dataBase ?? `https://${SCHWAB_HOST}/marketdata/v1`).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.nowMs ?? Date.now;
  }
  /** The live base the guard checks against — always the Schwab host. */
  get baseUrl(): string { return this.trader; }

  private async authHeader(): Promise<string> {
    return `Bearer ${await ensureAccessToken(this.opts.tokenStore, { clientId: this.opts.clientId, clientSecret: this.opts.clientSecret }, this.fetchImpl, this.now())}`;
  }
  private async get<T>(schema: z.ZodType<T>, url: string): Promise<T> {
    const res = await this.fetchImpl(url, { headers: { Authorization: await this.authHeader(), accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Schwab GET ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return schema.parse(JSON.parse(text));
  }
  private stamp(o: BrokerOrder): BrokerOrder { return { ...o, clientOrderId: this.cidByBrokerId.get(o.id) ?? o.clientOrderId }; }

  /**
   * Open only inside today's regular session. Schwab's `isOpen` alone would report "open" at 07:00 or
   * 23:00 on any trading day, so it is necessary but never sufficient. Without sessionHours, fall back
   * to the NYSE calendar + 09:30–16:00 ET (fails closed outside calendar coverage).
   */
  async getClock(): Promise<BrokerClock> {
    const now = this.now();
    const today = todayET(now);
    const m = await this.get(Markets, `${this.data}/markets?${new URLSearchParams({ markets: "equity", date: today })}`);
    const entry = Object.values(m.equity ?? {})[0];
    const regular = entry?.sessionHours?.regularMarket ?? [];
    const timestamp = new Date(now).toISOString();
    if (!entry?.isOpen) return { timestamp, isOpen: false, nextOpen: "", nextClose: "" };
    if (regular.length) {
      const inSession = regular.some((s) => Date.parse(s.start) <= now && now < Date.parse(s.end));
      return { timestamp, isOpen: inSession, nextOpen: regular[0].start, nextClose: regular[regular.length - 1].end };
    }
    let day: BrokerCalendarDay | undefined;
    try { day = nyseTradingDays(today, today)[0]; } catch { day = undefined; }
    if (!day) return { timestamp, isOpen: false, nextOpen: "", nextClose: "" };
    const mins = etMinutesOfDay(now);
    return { timestamp, isOpen: hhmmToMinutes(day.open) <= mins && mins < hhmmToMinutes(day.close), nextOpen: "", nextClose: "" };
  }
  async getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]> { return nyseTradingDays(from, to); }

  async getAccount(): Promise<BrokerAccount> {
    const a = await this.get(AccountResp, `${this.trader}/accounts/${this.opts.accountHash}`);
    const b = a.securitiesAccount.currentBalances;
    return { equity: b.liquidationValue, cash: b.cashBalance, buyingPower: b.buyingPower ?? b.availableFunds ?? b.cashBalance };
  }
  async getPositions(): Promise<BrokerPosition[]> {
    const a = await this.get(AccountResp, `${this.trader}/accounts/${this.opts.accountHash}?fields=positions`);
    return a.securitiesAccount.positions
      .filter((p) => (p.longQuantity ?? 0) > 0)
      .map((p) => ({ symbol: p.instrument.symbol, qty: p.longQuantity ?? 0, marketValue: p.marketValue ?? 0, avgEntryPrice: p.averagePrice ?? 0 }));
  }
  async getOrders(_status: "open" | "closed" | "all", after?: string): Promise<BrokerOrder[]> {
    // Default window starts at ET midnight today (a UTC-midnight default would skip the whole ET day after 20:00 EDT).
    const [y, mo, d] = todayET(this.now()).split("-").map(Number);
    const from = new Date(after ?? etWallToUtc(y, mo, d, 0, 0)).toISOString();
    const to = new Date(this.now() + 86_400_000).toISOString();
    const q = new URLSearchParams({ fromEnteredTime: from, toEnteredTime: to, maxResults: "500" });
    const orders = await this.get(z.array(OrderResp), `${this.trader}/accounts/${this.opts.accountHash}/orders?${q}`);
    return orders.map((o) => this.toOrder(o)).map((o) => this.stamp(o));
  }
  private toOrder(o: z.infer<typeof OrderResp>): BrokerOrder {
    const leg = o.orderLegCollection[0];
    const execs = o.orderActivityCollection.flatMap((a) => a.executionLegs);
    const qtySum = execs.reduce((s, e) => s + (e.quantity ?? 0), 0);
    const notional = execs.reduce((s, e) => s + (e.quantity ?? 0) * (e.price ?? 0), 0);
    const lastTime = execs.map((e) => e.time).filter((t): t is string => !!t).sort().at(-1) ?? null;
    return {
      id: o.orderId, clientOrderId: "", symbol: leg?.instrument.symbol ?? "", side: (leg?.instruction ?? "BUY").toUpperCase() === "SELL" ? "sell" : "buy",
      status: mapStatus(o.status), qty: o.quantity ?? null, notional: null,
      filledQty: o.filledQuantity ?? 0, filledAvgPrice: qtySum > 0 ? notional / qtySum : null,
      filledAt: lastTime, submittedAt: o.enteredTime ?? null,
    };
  }
  async getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>> {
    const end = Date.parse(tradingDate + "T23:59:59Z"); const start = end - 10 * 86_400_000;
    const out: Record<string, number> = {};
    for (const s of symbols) {
      const q = new URLSearchParams({ symbol: s, periodType: "month", frequencyType: "daily", frequency: "1", startDate: String(start), endDate: String(end), needExtendedHoursData: "false" });
      const h = await this.get(PriceHistory, `${this.data}/pricehistory?${q}`);
      const candle = h.candles.filter((c) => c.datetime <= end).at(-1);
      if (!candle) throw new Error(`Schwab: no daily candle for ${s} on/before ${tradingDate}`);
      out[s] = candle.close;
    }
    return out;
  }
  async getLatestTrade(symbol: string): Promise<{ price: number; tsMs: number } | null> {
    const q = (await this.get(QuotesResp, `${this.data}/quotes?symbols=${encodeURIComponent(symbol)}`))[symbol]?.quote;
    return q?.lastPrice != null ? { price: q.lastPrice, tsMs: q.tradeTime ?? this.now() } : null;
  }
  async getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; tsMs: number } | null> {
    const q = (await this.get(QuotesResp, `${this.data}/quotes?symbols=${encodeURIComponent(symbol)}`))[symbol]?.quote;
    return q?.bidPrice != null && q?.askPrice != null ? { bid: q.bidPrice, ask: q.askPrice, tsMs: q.quoteTime ?? this.now() } : null;
  }
  async isFractionable(symbols: string[]): Promise<Record<string, boolean>> {
    return Object.fromEntries(symbols.map((s) => [s, false])); // Schwab Trader API has no fractional orders
  }

  async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
    if (req.notional != null) throw new Error(`SchwabBroker: notional/fractional orders are not supported (whole-share only); got notional for ${req.symbol}`);
    if (req.qty == null || !Number.isInteger(req.qty) || req.qty <= 0) throw new Error(`SchwabBroker: whole-share qty required for ${req.symbol}; got ${req.qty}`);
    const body = {
      orderType: req.limitPrice != null ? "LIMIT" : "MARKET", session: "NORMAL",
      duration: req.timeInForce === "ioc" ? "IMMEDIATE_OR_CANCEL" : "DAY", orderStrategyType: "SINGLE",
      ...(req.limitPrice != null ? { price: req.limitPrice } : {}),
      orderLegCollection: [{ instruction: req.side === "buy" ? "BUY" : "SELL", quantity: req.qty, instrument: { symbol: req.symbol, assetType: "EQUITY" } }],
    };
    const res = await this.fetchImpl(`${this.trader}/accounts/${this.opts.accountHash}/orders`, {
      method: "POST", headers: { Authorization: await this.authHeader(), "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Schwab POST order ${req.symbol} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const loc = res.headers.get("location");
    const orderId = loc?.split("/").filter(Boolean).at(-1);
    if (!orderId) throw new Error(`Schwab POST order ${req.symbol}: no order id in Location header (${loc})`);
    this.cidByBrokerId.set(orderId, req.clientOrderId);
    // Return a non-terminal order; executeOrders polls getOrders (which stamps clientOrderId) for the fill.
    return { id: orderId, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "new", qty: req.qty, notional: null, filledQty: 0, filledAvgPrice: null, filledAt: null, submittedAt: new Date(this.now()).toISOString() };
  }
  async cancelOrder(id: string): Promise<void> {
    const res = await this.fetchImpl(`${this.trader}/accounts/${this.opts.accountHash}/orders/${id}`, { method: "DELETE", headers: { Authorization: await this.authHeader() } });
    if (!res.ok && res.status !== 404) throw new Error(`Schwab DELETE order ${id} → ${res.status}`);
  }
}
