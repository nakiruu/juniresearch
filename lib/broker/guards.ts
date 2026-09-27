/**
 * guards.ts — the second line of defense (spec §8.3). Every submit re-checks paper-only, the ban,
 * the locks, the run caps and the kill switch, whatever the plan said. The ban refuses BUYS; a sell
 * of a banned symbol is how a prohibited position gets disposed of.
 */
import { isBannedTicker } from "../portfolio/eligibility";
import { isBuyLocked, isSellLocked, type Locks } from "../trade/locks";
import type { TradeConfig } from "../trade/config";
import type { TradingDay } from "../trade/calendar";
import type { BrokerAdapter, BrokerOrder, SubmitOrderRequest } from "./adapter";

export const PAPER_HOST = "paper-api.alpaca.markets";
export const SCHWAB_HOST = "api.schwabapi.com";
export class GuardError extends Error { constructor(msg: string) { super(msg); this.name = "GuardError"; } }
/** A buy the broker's cash can't cover. Not a planning bug (an unfilled IOC sell leaves its proceeds unrealized) — the caller skips the order. */
export class CashBackstopError extends GuardError { constructor(msg: string) { super(msg); this.name = "CashBackstopError"; } }
export interface GuardContext {
  brokerKind: BrokerAdapter["kind"]; configuredBaseUrl: string; locks: Locks; today: TradingDay;
  nav: number; cfg: TradeConfig; env: NodeJS.ProcessEnv;
  /** Broker-reported cash at plan time — the never-leverage backstop is checked against this, not the plan. */
  cashUsd: number;
  /**
   * buyNotionalUsd: cash committed to buys (reserved at qty × limit on submit, trued up to the actual fill
   * by executeOrders); sellProceedsUsd: cash actually raised by FILLED sells (an unfilled IOC sell raises none).
   */
  counters: { orders: number; notionalUsd: number; buyNotionalUsd: number; sellProceedsUsd: number };
}

/** Cash a further buy may use: broker cash + realized sell proceeds − committed buys − the cash floor. */
export function buyCapacityUsd(ctx: GuardContext): number {
  return ctx.cashUsd + ctx.counters.sellProceedsUsd - ctx.counters.buyNotionalUsd - ctx.cfg.cashFloor * ctx.nav;
}

export function assertOrderAllowed(req: SubmitOrderRequest, ctx: GuardContext): void {
  if (ctx.env.TRADE_DISABLED === "1") throw new GuardError("TRADE_DISABLED=1 — kill switch engaged");
  // Broker-aware endpoint guard: Alpaca can never be pointed at a live endpoint; the Schwab kind is
  // live BY SELECTION and must be the real Schwab host (a mis-wired ctx can't silently trade elsewhere).
  if (ctx.brokerKind === "alpaca-paper" && !ctx.configuredBaseUrl.includes(PAPER_HOST)) {
    throw new GuardError(`base URL ${ctx.configuredBaseUrl} is not the paper endpoint (${PAPER_HOST})`);
  }
  if (ctx.brokerKind === "schwab" && !ctx.configuredBaseUrl.includes(SCHWAB_HOST)) {
    throw new GuardError(`base URL ${ctx.configuredBaseUrl} is not the Schwab endpoint (${SCHWAB_HOST})`);
  }
  if (req.side === "buy" && isBannedTicker(req.symbol)) throw new GuardError(`banned: ${req.symbol} (employer holding restriction)`);
  if (req.side === "buy" && isBuyLocked(ctx.locks, req.symbol, ctx.today)) throw new GuardError(`buy-locked: ${req.symbol} until ${ctx.locks.buyLockUntil[req.symbol]}`);
  if (req.side === "sell" && isSellLocked(ctx.locks, req.symbol, ctx.today)) throw new GuardError(`sell-locked: ${req.symbol} until ${ctx.locks.sellLockUntil[req.symbol]}`);
  if (ctx.counters.orders + 1 > ctx.cfg.maxOrdersPerRun) throw new GuardError(`maxOrdersPerRun ${ctx.cfg.maxOrdersPerRun} exceeded`);
  if (ctx.counters.notionalUsd + Math.abs(req.estNotionalUsd) > ctx.cfg.maxNotionalFrac * ctx.nav + 1e-9) {
    throw new GuardError(`maxNotionalFrac ${ctx.cfg.maxNotionalFrac} × NAV exceeded`);
  }
  // Never leverage, checked against BROKER cash: catches a plan built on a wrong book (e.g. a positions
  // response that silently came back empty) and buys planned on sell proceeds that never filled.
  if (req.side === "buy" && Math.abs(req.estNotionalUsd) > buyCapacityUsd(ctx) + 1e-9) {
    throw new CashBackstopError(`cash backstop: buy ${req.symbol} $${Math.abs(req.estNotionalUsd).toFixed(2)} exceeds available cash $${Math.max(0, buyCapacityUsd(ctx)).toFixed(2)} (broker cash + filled sells − committed buys − cash floor)`);
  }
}

export async function guardedSubmit(adapter: BrokerAdapter, req: SubmitOrderRequest, ctx: GuardContext): Promise<BrokerOrder> {
  assertOrderAllowed(req, ctx);
  // req (including optional limitPrice/timeInForce) is forwarded whole — no new guard rules on the cap itself.
  const order = await adapter.submitOrder(req);
  ctx.counters.orders += 1;
  ctx.counters.notionalUsd += Math.abs(req.estNotionalUsd);
  if (req.side === "buy") ctx.counters.buyNotionalUsd += Math.abs(req.estNotionalUsd); // reserved; executeOrders trues it up
  return order;
}
