/** fake.ts — in-memory broker for tests and Phase 0 dry runs. Fills instantly at today's close. */
import type { BrokerAdapter, BrokerAccount, BrokerCalendarDay, BrokerClock, BrokerOrder, BrokerPosition, SubmitOrderRequest } from "./adapter";

export class FakeBroker implements BrokerAdapter {
  readonly kind = "fake" as const;
  private cash: number;
  private readonly pos = new Map<string, { qty: number; cost: number }>();
  private readonly orders: BrokerOrder[] = [];
  private today: string;
  private isOpen: boolean;
  private readonly trades = new Map<string, { price: number; tsMs: number }>();
  private readonly quotes = new Map<string, { bid: number; ask: number; tsMs: number }>();
  constructor(private readonly opts: {
    calendar: BrokerCalendarDay[]; closes: Record<string, Record<string, number>>; equity: number; cash: number;
    isOpen: boolean; today: string; fractionable?: Record<string, boolean>;
  }) { this.cash = opts.cash; this.today = opts.today; this.isOpen = opts.isOpen; }

  setToday(d: string): void { this.today = d; }
  setClock(isOpen: boolean): void { this.isOpen = isOpen; }
  setTrade(symbol: string, price: number, tsMs: number): void { this.trades.set(symbol, { price, tsMs }); }
  setQuote(symbol: string, bid: number, ask: number, tsMs: number): void { this.quotes.set(symbol, { bid, ask, tsMs }); }
  async getLatestTrade(symbol: string): Promise<{ price: number; tsMs: number } | null> { return this.trades.get(symbol) ?? null; }
  async getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; tsMs: number } | null> { return this.quotes.get(symbol) ?? null; }
  private price(symbol: string, date = this.today): number {
    const p = this.opts.closes[symbol]?.[date];
    if (!(p > 0)) throw new Error(`FakeBroker: no close for ${symbol} on ${date}`);
    return p;
  }
  async getClock(): Promise<BrokerClock> { return { timestamp: `${this.today}T15:00:00Z`, isOpen: this.isOpen, nextOpen: "", nextClose: "" }; }
  async getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]> { return this.opts.calendar.filter((d) => d.date >= from && d.date <= to); }
  async getPositions(): Promise<BrokerPosition[]> {
    return [...this.pos.entries()].filter(([, p]) => p.qty > 0).map(([symbol, p]) => ({ symbol, qty: p.qty, marketValue: p.qty * this.price(symbol), avgEntryPrice: p.cost / p.qty }));
  }
  async getAccount(): Promise<BrokerAccount> {
    const mv = (await this.getPositions()).reduce((a, p) => a + p.marketValue, 0);
    return { equity: this.cash + mv, cash: this.cash, buyingPower: this.cash };
  }
  // `after` is accepted for signature parity but not applied: the fake's fixed submittedAt stamps would
  // make a time filter test the fake, not the code under test.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getOrders(status: "open" | "closed" | "all", _after?: string): Promise<BrokerOrder[]> { return status === "open" ? [] : [...this.orders]; }
  async getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>> {
    return Object.fromEntries(symbols.map((s) => [s, this.price(s, tradingDate)]));
  }
  async isFractionable(symbols: string[]): Promise<Record<string, boolean>> {
    return Object.fromEntries(symbols.map((s) => [s, this.opts.fractionable?.[s] ?? true]));
  }
  async submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder> {
    const price = this.price(req.symbol);
    if (req.limitPrice != null) {
      const marketable = req.side === "buy" ? req.limitPrice >= price : req.limitPrice <= price;
      if (!marketable) {
        // IOC (or any TIF, in the fake) cancels the unfilled remainder immediately — a terminal
        // zero-fill order, never a resting/open one that executeOrders would have to poll for.
        const o: BrokerOrder = {
          id: `fake-${this.orders.length + 1}`, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "canceled",
          qty: req.qty ?? null, notional: req.notional ?? null, filledQty: 0, filledAvgPrice: null,
          filledAt: null, submittedAt: `${this.today}T15:30:00Z`,
        };
        this.orders.push(o);
        return o;
      }
    }
    const cur = this.pos.get(req.symbol) ?? { qty: 0, cost: 0 };
    let qty: number;
    if (req.side === "buy") {
      qty = req.notional != null ? req.notional / price : (req.qty ?? 0);
      if (!(qty > 0)) throw new Error("FakeBroker: buy needs qty or notional");
      if (qty * price > this.cash + 1e-9) throw new Error("FakeBroker: insufficient cash");
      this.cash -= qty * price;
      this.pos.set(req.symbol, { qty: cur.qty + qty, cost: cur.cost + qty * price });
    } else {
      qty = req.qty ?? (req.notional != null ? req.notional / price : 0);
      if (!(qty > 0) || qty > cur.qty + 1e-9) throw new Error(`FakeBroker: insufficient position in ${req.symbol}`);
      this.cash += qty * price;
      const left = cur.qty - qty;
      if (left <= 1e-9) this.pos.delete(req.symbol); else this.pos.set(req.symbol, { qty: left, cost: cur.cost * (left / cur.qty) });
    }
    const o: BrokerOrder = {
      id: `fake-${this.orders.length + 1}`, clientOrderId: req.clientOrderId, symbol: req.symbol, side: req.side, status: "filled",
      qty: req.qty ?? null, notional: req.notional ?? null, filledQty: qty, filledAvgPrice: price,
      filledAt: `${this.today}T15:30:00Z`, submittedAt: `${this.today}T15:30:00Z`,
    };
    this.orders.push(o);
    return o;
  }
  async cancelOrder(): Promise<void> { /* nothing is ever open in the fake */ }
}
