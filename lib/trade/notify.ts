/**
 * notify.ts — the trade layer's outbound notifications (spec 2026-09-25-discord-notifier). Two shapes:
 * a plain alert (halt / auth / error) and a rich run summary (orders, fills, the goal/target book,
 * cash, broker-truth audit). Formatting is pure; the transport is a thin, BEST-EFFORT Discord webhook
 * POST that NEVER throws — a Discord outage is logged, never allowed to fail a trade run. With no
 * webhook configured the notifier is log-only, exactly as before.
 */
import { weightsOf } from "./ledger";
import type { PlanRunOutput } from "./pipeline";
import type { Fill } from "./fills";
import type { AuditResult } from "./audit";

export interface DiscordPayload { content?: string; embeds?: unknown[] }
export interface RunSummaryInput {
  today: string; runId: string; broker: string; status: string; // executed | noop | plan
  nav: number; cash: number;
  goal: { ticker: string; weight: number }[];
  orders: { ticker: string; side: string; qty: number; limitPrice: number; reason: string }[];
  fills: { ticker: string; qty: number; price: number }[];
  skipped: { ticker: string; reason: string }[];
  audit?: { ok: boolean; critical: number; warn: number };
}
/** One name in the target book: where it is, where the plan wants it, and what this run does about it. */
export interface AllocationRow {
  ticker: string; currentWeight: number; targetWeight: number | null; targetUsd: number | null;
  action: string; // ENTER / ADD / TRIM / EXIT / hold / a skip code with its reason
  order?: string; // "buy 5 @ $181.44" when an order was sized
}
export interface AllocationInput {
  today: string; broker: string; status: string; // e.g. "preview", "declined", "market closed", "submitting 4 orders"
  nav: number; cash: number; plannedCash: number; rows: AllocationRow[];
}
export interface TradeNotifier {
  message(text: string): void; runSummary(s: RunSummaryInput): void; allocation(a: AllocationInput): void; flush(): Promise<void>;
}

const GREEN = 0x2ecc71, YELLOW = 0xf1c40f, RED = 0xe74c3c, BLUE = 0x3498db;

/** The intended book after a run: current weights with each trade applied (ENTER/ADD/TRIM → target, EXIT → drop), sorted desc. */
export function goalBook(currentWeights: Record<string, number>, trades: { ticker: string; reason: string; targetWeight: number }[]): { ticker: string; weight: number }[] {
  const g: Record<string, number> = { ...currentWeights };
  for (const t of trades) { if (t.reason === "EXIT") delete g[t.ticker]; else g[t.ticker] = t.targetWeight; }
  return Object.entries(g).filter(([, w]) => w > 0).map(([ticker, weight]) => ({ ticker, weight })).sort((a, b) => b.weight - a.weight);
}

/** Pure adapter: a pipeline run → the notification summary (used identically by cron and trade:execute). */
export function summaryFromRun(out: PlanRunOutput, status: string, fills: Fill[], audit?: AuditResult): RunSummaryInput {
  return {
    today: out.record.today, runId: out.record.runId, broker: out.record.broker, status,
    nav: out.ledger.nav, cash: out.ledger.cash,
    goal: goalBook(weightsOf(out.ledger), out.plan.trades),
    orders: out.sized.orders.map((o) => ({ ticker: o.ticker, side: o.side, qty: o.qty, limitPrice: o.limitPrice, reason: o.reason })),
    fills: fills.map((f) => ({ ticker: f.ticker, qty: f.qty, price: f.price })),
    skipped: [...out.sized.skippedHalt.map((h) => ({ ticker: h.ticker, reason: h.reason })), ...out.sized.skippedDust.map((d) => ({ ticker: d.ticker, reason: "dust" }))],
    audit: audit ? { ok: audit.ok, critical: audit.critical, warn: audit.warn } : undefined,
  };
}

const SKIP_ACTION: Record<string, string> = {
  BELOW_BAND: "hold (within band)", DEFER_EXIT: "exit deferred (sell-locked)", DEFER_TRIM: "trim deferred (sell-locked)",
  BARRED_ENTRY: "entry barred (buy-locked)", BARRED_ADD: "add barred (buy-locked)", NO_CAPACITY: "no room under caps",
  NO_SIGNAL: "held, no report — frozen", INELIGIBLE: "ineligible", TURNOVER_CLIP: "deferred (turnover cap)",
};

/**
 * The whole target book of a plan (pure): every name the plan sizes or holds — traded, held inside the
 * band, deferred by a lock, or frozen — with current vs target weight, the target in dollars, and the
 * order if one was sized (or why none was: below the $ minimum / under one share, or a price halt).
 * Ineligible names the account doesn't hold are left out. Sorted by target weight, then current.
 */
export function allocationRows(out: PlanRunOutput): AllocationRow[] {
  const nav = out.ledger.nav;
  const cur = weightsOf(out.ledger);
  const rows = new Map<string, AllocationRow>();
  const orderFor = new Map(out.sized.orders.map((o) => [o.ticker, `${o.side} ${o.qty} @ $${o.limitPrice}`]));
  const dust = new Set(out.sized.skippedDust.map((d) => d.ticker));
  const halt = new Map(out.sized.skippedHalt.map((h) => [h.ticker, h.reason]));
  for (const t of out.plan.trades) {
    const note = orderFor.get(t.ticker) ?? (dust.has(t.ticker) ? "not sent: under the $ minimum or < 1 share" : halt.has(t.ticker) ? `not sent: halted (${halt.get(t.ticker)})` : undefined);
    rows.set(t.ticker, { ticker: t.ticker, currentWeight: cur[t.ticker] ?? 0, targetWeight: t.targetWeight, targetUsd: t.targetWeight * nav, action: t.reason + (t.note ? ` (${t.note})` : ""), order: note });
  }
  for (const k of out.plan.skipped) {
    if (rows.has(k.ticker)) continue;
    const held = (cur[k.ticker] ?? 0) > 0;
    if (k.targetWeight == null && !held) continue; // not held and not sized — not part of the book
    const action = (SKIP_ACTION[k.code] ?? k.code) + (k.unlockOn ? ` until ${k.unlockOn}` : "");
    rows.set(k.ticker, { ticker: k.ticker, currentWeight: cur[k.ticker] ?? 0, targetWeight: k.targetWeight, targetUsd: k.targetWeight == null ? null : k.targetWeight * nav, action });
  }
  for (const [ticker, w] of Object.entries(cur)) if (!rows.has(ticker)) rows.set(ticker, { ticker, currentWeight: w, targetWeight: w, targetUsd: w * nav, action: "hold" });
  return [...rows.values()].sort((a, b) => (b.targetWeight ?? -1) - (a.targetWeight ?? -1) || b.currentWeight - a.currentWeight);
}

const pct1 = (x: number | null) => (x == null ? "   —  " : `${(x * 100).toFixed(1).padStart(5)}%`);
const usd0 = (x: number | null) => (x == null ? "      —" : `$${Math.round(x).toLocaleString("en-US").padStart(6)}`);

/** One fixed-width line per name: ticker, current → target, target $, action, order. */
export function allocationLines(rows: AllocationRow[]): string[] {
  return rows.map((r) => `${r.ticker.padEnd(6)} ${pct1(r.currentWeight)} → ${pct1(r.targetWeight)} ${usd0(r.targetUsd)}  ${r.action}${r.order ? ` · ${r.order}` : ""}`);
}

/** The allocation as a Discord embed: header line + the book split across fields (each ≤1024 chars, ≤5.5k total). */
export function allocationEmbed(a: AllocationInput): DiscordPayload {
  const lines = allocationLines(a.rows);
  const fields: { name: string; value: string }[] = [];
  let chunk: string[] = [], used = 0, shown = 0;
  const push = () => { if (chunk.length) fields.push({ name: fields.length ? "\u200b" : `Target book (${a.rows.length})`, value: "```\n" + chunk.join("\n") + "\n```" }); chunk = []; };
  for (const l0 of lines) {
    const l = l0.length > 110 ? l0.slice(0, 107) + "…" : l0;
    if (used + l.length > 5000 || fields.length >= 20) break;
    if (chunk.join("\n").length + l.length + 9 > 1000) push();
    chunk.push(l); used += l.length + 1; shown++;
  }
  push();
  if (!fields.length) fields.push({ name: "Target book (0)", value: "```\n(none)\n```" });
  if (shown < lines.length) fields.push({ name: "\u200b", value: `… +${lines.length - shown} more (see the console / run record)` });
  const cashPct = a.nav > 0 ? (a.cash / a.nav) * 100 : 0;
  return { embeds: [{
    title: `ALLOCATION · ${a.status} · ${a.broker} · ${a.today}`,
    description: `NAV $${a.nav.toFixed(0)} · cash now ${cashPct.toFixed(1)}% · target cash ${(a.plannedCash * 100).toFixed(1)}%`,
    color: /submitting|executed/.test(a.status) ? GREEN : BLUE, fields,
  }] };
}

/** Pure adapter: a plan → the allocation notification. */
export function allocationFromRun(out: PlanRunOutput, status: string): AllocationInput {
  return { today: out.record.today, broker: out.record.broker, status, nav: out.ledger.nav, cash: out.ledger.cash, plannedCash: out.plan.plannedCash, rows: allocationRows(out) };
}

/** A ```-fenced field value from the first `max` lines, with a "+N more" tail, kept under Discord's 1024-char limit. */
function block(lines: string[], max: number): string {
  if (lines.length === 0) return "```\n(none)\n```";
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`… +${lines.length - max} more`);
  let body = shown.join("\n");
  if (body.length > 1010) body = body.slice(0, 1000) + "\n…";
  return "```\n" + body + "\n```";
}

function statusColor(s: RunSummaryInput): number {
  if (s.audit && s.audit.critical > 0) return RED;
  if (s.status === "noop") return BLUE;
  if ((s.audit && s.audit.warn > 0) || s.skipped.length > 0) return YELLOW;
  return GREEN;
}

export function runEmbed(s: RunSummaryInput): DiscordPayload {
  const cashPct = s.nav > 0 ? (s.cash / s.nav) * 100 : 0;
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Account", value: `NAV $${s.nav.toFixed(0)} · cash $${s.cash.toFixed(0)} (${cashPct.toFixed(1)}%)` },
    { name: `Orders (${s.orders.length})`, value: block(s.orders.map((o) => `${o.side} ${o.ticker} ${o.qty} @ $${o.limitPrice} (${o.reason})`), 15) },
    { name: `Fills (${s.fills.length})`, value: block(s.fills.map((f) => `${f.ticker} ${f.qty} @ $${f.price}`), 15) },
    { name: `Goal book (${s.goal.length})`, value: block(s.goal.map((g) => `${g.ticker} ${(g.weight * 100).toFixed(1)}%`), 15) },
  ];
  if (s.skipped.length) fields.push({ name: `Skipped (${s.skipped.length})`, value: block(s.skipped.map((k) => `${k.ticker} — ${k.reason}`), 10) });
  if (s.audit) fields.push({ name: "Broker-truth audit", value: s.audit.ok ? (s.audit.warn ? `OK · ${s.audit.warn} warning(s)` : "OK — matches broker") : `FAIL — ${s.audit.critical} critical` });
  return { embeds: [{ title: `${s.status.toUpperCase()} · ${s.broker} · ${s.today}`, color: statusColor(s), fields }] };
}

export function alertEmbed(text: string): DiscordPayload {
  return { embeds: [{ title: "⚠ Trade alert", description: text.slice(0, 4000), color: RED }] };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST to a Discord webhook. Retries once on 429; swallows every error (never throws) — a broken webhook must never fail a run. */
export async function postDiscord(url: string, payload: DiscordPayload, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (res.status === 429) {
      const retry = Number((await res.json().catch(() => ({})))?.retry_after ?? 1);
      await wait(Math.min(Math.max(retry, 0), 5) * 1000);
      await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    }
  } catch (e) {
    console.error(`Discord notify failed: ${(e as Error).message}`);
  }
}

export function makeNotifier(opts: { webhookUrl?: string; onLog?: (line: string) => void; fetchImpl?: typeof fetch }): TradeNotifier {
  const onLog = opts.onLog ?? ((l: string) => console.error(l));
  const pending: Promise<void>[] = [];
  const enqueue = (p: DiscordPayload) => { if (opts.webhookUrl) pending.push(postDiscord(opts.webhookUrl, p, opts.fetchImpl)); };
  return {
    message(text: string): void { onLog(text); enqueue(alertEmbed(text)); },
    runSummary(s: RunSummaryInput): void {
      const cashPct = s.nav > 0 ? (s.cash / s.nav) * 100 : 0;
      onLog(`${s.status} ${s.broker} ${s.today} — ${s.orders.length} order(s), ${s.fills.length} fill(s), cash ${cashPct.toFixed(0)}%`);
      enqueue(runEmbed(s));
    },
    allocation(a: AllocationInput): void {
      onLog(`allocation ${a.status} ${a.broker} ${a.today} — ${a.rows.length} name(s)`);
      enqueue(allocationEmbed(a));
    },
    async flush(): Promise<void> { await Promise.allSettled(pending.splice(0)); },
  };
}
