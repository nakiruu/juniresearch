/** adapter.ts — the one contract every broker implements (spec §8.1). Numbers are numbers here; string→number conversion is the adapter's job. */
export interface BrokerClock { timestamp: string; isOpen: boolean; nextOpen: string; nextClose: string }
export interface BrokerCalendarDay { date: string; open: string; close: string }
export interface BrokerAccount { equity: number; cash: number; buyingPower: number }
export interface BrokerPosition { symbol: string; qty: number; marketValue: number; avgEntryPrice: number }
export type BrokerOrderStatus =
  | "new" | "partially_filled" | "filled" | "done_for_day" | "canceled" | "expired" | "replaced" | "pending_cancel"
  | "pending_replace" | "accepted" | "pending_new" | "accepted_for_bidding" | "stopped" | "rejected" | "suspended" | "calculated" | "held";
export interface BrokerOrder {
  id: string; clientOrderId: string; symbol: string; side: "buy" | "sell"; status: BrokerOrderStatus;
  qty: number | null; notional: number | null; filledQty: number; filledAvgPrice: number | null; filledAt: string | null; submittedAt: string | null;
}
export interface SubmitOrderRequest {
  symbol: string; side: "buy" | "sell"; qty?: number; notional?: number; clientOrderId: string; estNotionalUsd: number;
  /** Optional slippage cap (spec §Phase 2 Task 4). Unset → market order, exactly as today. */
  limitPrice?: number; timeInForce?: "ioc" | "day";
}
export interface BrokerAdapter {
  readonly kind: "alpaca-paper" | "schwab" | "fake";
  getClock(): Promise<BrokerClock>;
  getCalendar(from: string, to: string): Promise<BrokerCalendarDay[]>;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(status: "open" | "closed" | "all", after?: string): Promise<BrokerOrder[]>;
  getLastClose(symbols: string[], tradingDate: string): Promise<Record<string, number>>;
  getLatestTrade(symbol: string): Promise<{ price: number; tsMs: number } | null>;
  getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; tsMs: number } | null>;
  isFractionable(symbols: string[]): Promise<Record<string, boolean>>;
  /**
   * Throws SubmitOutcomeUnknownError (lib/broker/http.ts) when the order MAY have been placed (timeout,
   * network failure, 5xx, no order id in the response). Callers must then use findSubmitted — never resubmit.
   */
  submitOrder(req: SubmitOrderRequest): Promise<BrokerOrder>;
  /**
   * Look up the broker order a timed-out submit may have placed, submitted at/after `sinceIso`. null =
   * not found; throws AmbiguousOrderError when more than one order matches. Read-only.
   */
  findSubmitted(req: SubmitOrderRequest, sinceIso: string): Promise<BrokerOrder | null>;
  cancelOrder(id: string): Promise<void>;
}
export const TERMINAL_STATUSES: ReadonlySet<BrokerOrderStatus> = new Set(["filled", "canceled", "expired", "rejected", "done_for_day", "stopped", "suspended", "replaced"]);
