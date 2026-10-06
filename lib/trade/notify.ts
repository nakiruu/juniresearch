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
import type { BreachCause } from "./breach";
import { relabelLine } from "./relabel";

export interface DiscordPayload { content?: string; embeds?: unknown[] }
export interface RunSummaryInput {
  today: string; runId: string; broker: string; status: string; // executed | noop | plan
  nav: number; cash: number;
  goal: { ticker: string; weight: number }[];
  orders: { ticker: string; side: string; qty: number; limitPrice: number; type?: "limit" | "market"; reason: string }[];
  fills: { ticker: string; qty: number; price: number }[];
  skipped: { ticker: string; reason: string }[];
  audit?: { ok: boolean; critical: number; warn: number };
  /** Held names past their bear case, one line each (breachLines) — their reports need re-writing. */
  breaches?: string[];
  /** Names the stale-on-bad-news gate kept out (staleEntryLines) — their reports need re-writing before a buy. */
  staleEntries?: string[];
  /** Advisory: names whose label would change on a re-run at today's price, confirmed over consecutive run days (relabelLines). */
  relabels?: string[];
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
  /** Held names past their bear case, one line each (breachLines) — their reports need re-writing. */
  breaches?: string[];
  /** Names the stale-on-bad-news gate kept out (staleEntryLines) — their reports need re-writing before a buy. */
  staleEntries?: string[];
  /** Advisory: names whose label would change on a re-run at today's price, confirmed over consecutive run days (relabelLines). */
  relabels?: string[];
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

const CAUSE: Record<BreachCause, string> = { market: "market-driven", mixed: "mixed", stock: "stock-specific" };

/**
 * One line per HELD name at or below its bear price (R null, D = 0): the cause of the fall (breach.ts) and what
 * this run does about it — "BAC market-driven (32%) — holding". Every one of them is a report the market has
 * passed, so each wants a re-write; "cause unknown" means a missing input left the plain exit. Pure, tolerant
 * of a partial run output (no signals → no lines).
 */
export function breachLines(out: PlanRunOutput): string[] {
  const signals = out.signals ?? [];
  if (!signals.length) return [];
  const cur = weightsOf(out.ledger);
  const info = out.breaches ?? out.record?.breaches ?? {};
  const cls = new Map((out.plan?.classifications ?? []).map((c) => [c.ticker, c]));
  return signals.filter((s) => (cur[s.ticker] ?? 0) > 0 && s.R == null && s.D <= 0).map((s) => {
    const b = info[s.ticker];
    const c = cls.get(s.ticker);
    const what = !c ? "unclassified"
      : c.classification === "HOLD" ? "holding"
      : c.classification === "FREEZE" ? "frozen (re-write report)"
      : c.classification === "DEFER_EXIT" ? `exit deferred (sell-locked)${c.unlockOn ? ` until ${c.unlockOn}` : ""}`
      : c.classification === "EXIT" ? "exiting" : c.classification;
    return `${s.ticker} ${b ? `${CAUSE[b.cause]} (${(b.share * 100).toFixed(0)}%)` : "cause unknown"} — ${what}`;
  });
}

/**
 * One line per name the stale-on-bad-news gate kept out of the book (stale-entry.ts) —
 * "PLOW −9% since report, stock-specific; missed −12.0% (2026-08-05)". Each wants a re-written report before it
 * can be bought. Pure, tolerant of a partial run output.
 */
export function staleEntryLines(out: PlanRunOutput): string[] {
  const info = out.staleEntries ?? out.record?.staleEntries ?? {};
  return (out.plan?.classifications ?? []).filter((c) => c.classification === "STALE_ENTRY").map((c) => {
    const g = info[c.ticker];
    return g ? `${c.ticker} ${(g.fall * 100).toFixed(0)}% since report, stock-specific; missed ${g.surprisePct.toFixed(1)}% (${g.earningsDate})` : c.ticker;
  });
}

/**
 * One line per confirmed re-label candidate (relabel.ts) — "VST HOLD → BUY at $145.00 · E +16.9% · R 0.63× · 3 days".
 * Advisory: the stored label still decides every trade; each line is a report worth re-running. Only cron confirms
 * (it keeps the streaks), so a run without confirmation has none.
 */
export function relabelLines(out: PlanRunOutput): string[] {
  return (out.relabelConfirmed ?? []).map(relabelLine);
}

/**
 * Pure adapter: a pipeline run → the notification summary (used identically by cron and trade:execute).
 * `skippedCutoff`: orders executeOrders did not send because the submit cutoff passed — listed with the
 * other skips so the embed shows exactly which orders never went out.
 */
export function summaryFromRun(out: PlanRunOutput, status: string, fills: Fill[], audit?: AuditResult, skippedCutoff: { ticker: string; detail: string }[] = []): RunSummaryInput {
  const breaches = breachLines(out);
  const staleEntries = staleEntryLines(out);
  const relabels = relabelLines(out);
  return {
    today: out.record.today, runId: out.record.runId, broker: out.record.broker, status,
    nav: out.ledger.nav, cash: out.ledger.cash,
    goal: goalBook(weightsOf(out.ledger), out.plan.trades),
    orders: out.sized.orders.map((o) => ({ ticker: o.ticker, side: o.side, qty: o.qty, limitPrice: o.limitPrice, type: o.type, reason: o.reason })),
    fills: fills.map((f) => ({ ticker: f.ticker, qty: f.qty, price: f.price })),
    skipped: [
      ...out.sized.skippedHalt.map((h) => ({ ticker: h.ticker, reason: h.reason })), ...out.sized.skippedDust.map((d) => ({ ticker: d.ticker, reason: "dust" })),
      ...skippedCutoff.map((c) => ({ ticker: c.ticker, reason: c.detail })),
    ],
    audit: audit ? { ok: audit.ok, critical: audit.critical, warn: audit.warn } : undefined,
    ...(breaches.length ? { breaches } : {}),
    ...(staleEntries.length ? { staleEntries } : {}),
    ...(relabels.length ? { relabels } : {}),
  };
}

const SKIP_ACTION: Record<string, string> = {
  BELOW_BAND: "hold (within band)", DEFER_EXIT: "exit deferred (sell-locked)", DEFER_TRIM: "trim deferred (sell-locked)",
  BARRED_ENTRY: "entry barred (buy-locked)", BARRED_ADD: "add barred (buy-locked)", NO_CAPACITY: "no room under caps",
  NO_SIGNAL: "held, no report — frozen", INELIGIBLE: "ineligible", TURNOVER_CLIP: "deferred (turnover cap)",
  FREEZE: "frozen — bear breach (mixed); re-write the report",
  STALE_ENTRY: "entry barred — stale on bad news; re-write the report",
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
  const orderFor = new Map<string, string>();
  for (const o of out.sized.orders) {
    const leg = `${o.side} ${o.qty} ${o.type === "market" ? "mkt" : `@ $${o.limitPrice}`}`;
    orderFor.set(o.ticker, orderFor.has(o.ticker) ? `${orderFor.get(o.ticker)} + ${leg}` : leg);
  }
  const dust = new Set(out.sized.skippedDust.map((d) => d.ticker));
  const halt = new Map(out.sized.skippedHalt.map((h) => [h.ticker, h.reason]));
  for (const t of out.plan.trades) {
    const note = orderFor.get(t.ticker) ?? (dust.has(t.ticker) ? "not sent: under the $ minimum" : halt.has(t.ticker) ? `not sent: halted (${halt.get(t.ticker)})` : undefined);
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
  // Bear breaches lead the description (the owner's to-do: re-write those reports); the book gives up the room.
  const breach = (a.breaches?.length ? `\nBear breaches: ${a.breaches.join(" · ")}`.slice(0, 600) : "")
    + (a.staleEntries?.length ? `\nNot bought, report stale on bad news: ${a.staleEntries.join(" · ")}`.slice(0, 400) : "")
    + (a.relabels?.length ? `\nRe-label candidates (advisory, re-run these reports): ${a.relabels.join(" · ")}`.slice(0, 600) : "");
  const fields: { name: string; value: string }[] = [];
  let chunk: string[] = [], used = 0, shown = 0;
  const push = () => { if (chunk.length) fields.push({ name: fields.length ? "\u200b" : `Target book (${a.rows.length})`, value: "```\n" + chunk.join("\n") + "\n```" }); chunk = []; };
  for (const l0 of lines) {
    const l = l0.length > 110 ? l0.slice(0, 107) + "…" : l0;
    if (used + l.length > 5000 - breach.length || fields.length >= 20) break;
    if (chunk.join("\n").length + l.length + 9 > 1000) push();
    chunk.push(l); used += l.length + 1; shown++;
  }
  push();
  if (!fields.length) fields.push({ name: "Target book (0)", value: "```\n(none)\n```" });
  if (shown < lines.length) fields.push({ name: "\u200b", value: `… +${lines.length - shown} more (see the console / run record)` });
  const cashPct = a.nav > 0 ? (a.cash / a.nav) * 100 : 0;
  return { embeds: [{
    title: `ALLOCATION · ${a.status} · ${a.broker} · ${a.today}`,
    description: `NAV $${a.nav.toFixed(0)} · cash now ${cashPct.toFixed(1)}% · target cash ${(a.plannedCash * 100).toFixed(1)}%${breach}`,
    color: /submitting|executed/.test(a.status) ? GREEN : BLUE, fields,
  }] };
}

/** Pure adapter: a plan → the allocation notification. */
export function allocationFromRun(out: PlanRunOutput, status: string): AllocationInput {
  const breaches = breachLines(out);
  const staleEntries = staleEntryLines(out);
  const relabels = relabelLines(out);
  return { today: out.record.today, broker: out.record.broker, status, nav: out.ledger.nav, cash: out.ledger.cash, plannedCash: out.plan.plannedCash, rows: allocationRows(out), ...(breaches.length ? { breaches } : {}), ...(staleEntries.length ? { staleEntries } : {}), ...(relabels.length ? { relabels } : {}) };
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
    { name: `Orders (${s.orders.length})`, value: block(s.orders.map((o) => `${o.side} ${o.ticker} ${o.qty} ${o.type === "market" ? "@ mkt" : `@ $${o.limitPrice}`} (${o.reason})`), 15) },
    { name: `Fills (${s.fills.length})`, value: block(s.fills.map((f) => `${f.ticker} ${f.qty} @ $${f.price}`), 15) },
    { name: `Goal book (${s.goal.length})`, value: block(s.goal.map((g) => `${g.ticker} ${(g.weight * 100).toFixed(1)}%`), 15) },
  ];
  if (s.skipped.length) fields.push({ name: `Skipped (${s.skipped.length})`, value: block(s.skipped.map((k) => `${k.ticker} — ${k.reason}`), 10) });
  if (s.breaches?.length) fields.push({ name: `Bear breaches (${s.breaches.length}) — re-write these reports`, value: block(s.breaches, 10) });
  if (s.staleEntries?.length) fields.push({ name: `Not bought, stale on bad news (${s.staleEntries.length}) — re-write these reports`, value: block(s.staleEntries, 10) });
  if (s.relabels?.length) fields.push({ name: `Re-label candidates (${s.relabels.length}) — advisory, re-run these reports`, value: block(s.relabels, 10) });
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
      onLog(`allocation ${a.status} ${a.broker} ${a.today} — ${a.rows.length} name(s)${a.breaches?.length ? ` · bear breaches: ${a.breaches.join(" · ")}` : ""}${a.staleEntries?.length ? ` · stale entries: ${a.staleEntries.join(" · ")}` : ""}${a.relabels?.length ? ` · re-label: ${a.relabels.join(" · ")}` : ""}`);
      enqueue(allocationEmbed(a));
    },
    async flush(): Promise<void> { await Promise.allSettled(pending.splice(0)); },
  };
}
