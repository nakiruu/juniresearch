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
export class GuardError extends Error { constructor(msg: string) { super(msg); this.name = "GuardError"; } }
export interface GuardContext {
  brokerKind: BrokerAdapter["kind"]; configuredBaseUrl: string; locks: Locks; today: TradingDay;
  nav: number; cfg: TradeConfig; env: NodeJS.ProcessEnv; counters: { orders: number; notionalUsd: number };
}

export function assertOrderAllowed(req: SubmitOrderRequest, ctx: GuardContext): void {
  if (ctx.env.TRADE_DISABLED === "1") throw new GuardError("TRADE_DISABLED=1 — kill switch engaged");
  if (ctx.brokerKind === "alpaca-paper" && !ctx.configuredBaseUrl.includes(PAPER_HOST)) {
    throw new GuardError(`base URL ${ctx.configuredBaseUrl} is not the paper endpoint (${PAPER_HOST})`);
  }
  if (req.side === "buy" && isBannedTicker(req.symbol)) throw new GuardError(`banned: ${req.symbol} (employer holding restriction)`);
  if (req.side === "buy" && isBuyLocked(ctx.locks, req.symbol, ctx.today)) throw new GuardError(`buy-locked: ${req.symbol} until ${ctx.locks.buyLockUntil[req.symbol]}`);
  if (req.side === "sell" && isSellLocked(ctx.locks, req.symbol, ctx.today)) throw new GuardError(`sell-locked: ${req.symbol} until ${ctx.locks.sellLockUntil[req.symbol]}`);
  if (ctx.counters.orders + 1 > ctx.cfg.maxOrdersPerRun) throw new GuardError(`maxOrdersPerRun ${ctx.cfg.maxOrdersPerRun} exceeded`);
  if (ctx.counters.notionalUsd + Math.abs(req.estNotionalUsd) > ctx.cfg.maxNotionalFrac * ctx.nav + 1e-9) {
    throw new GuardError(`maxNotionalFrac ${ctx.cfg.maxNotionalFrac} × NAV exceeded`);
  }
}

export async function guardedSubmit(adapter: BrokerAdapter, req: SubmitOrderRequest, ctx: GuardContext): Promise<BrokerOrder> {
  assertOrderAllowed(req, ctx);
  const order = await adapter.submitOrder(req);
  ctx.counters.orders += 1;
  ctx.counters.notionalUsd += Math.abs(req.estNotionalUsd);
  return order;
}
