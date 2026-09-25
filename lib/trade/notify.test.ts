import { describe, it, expect } from "vitest";
import { goalBook, runEmbed, alertEmbed, postDiscord, makeNotifier, summaryFromRun, type RunSummaryInput } from "./notify";

const baseSummary = (over: Partial<RunSummaryInput> = {}): RunSummaryInput => ({
  today: "2026-09-25", runId: "r1", broker: "schwab", status: "executed", nav: 100_000, cash: 41_487,
  goal: [{ ticker: "NEE", weight: 0.08 }], orders: [{ ticker: "NEE", side: "buy", qty: 43, limitPrice: 75.68, reason: "ENTER" }],
  fills: [{ ticker: "NEE", qty: 43, price: 75.56 }], skipped: [], ...over,
});
const jsonRes = (status: number, body: unknown = {}): Response => new Response(JSON.stringify(body), { status });

describe("goalBook", () => {
  it("applies ENTER/ADD (replace) and EXIT (remove), sorted by weight desc", () => {
    const current = { AAA: 0.05, BBB: 0.03, CCC: 0.02 };
    const trades = [
      { ticker: "BBB", reason: "ADD", targetWeight: 0.06 },
      { ticker: "CCC", reason: "EXIT", targetWeight: 0 },
      { ticker: "DDD", reason: "ENTER", targetWeight: 0.04 },
    ];
    expect(goalBook(current, trades)).toEqual([
      { ticker: "BBB", weight: 0.06 }, { ticker: "AAA", weight: 0.05 }, { ticker: "DDD", weight: 0.04 },
    ]);
  });
});

describe("runEmbed", () => {
  it("is green when clean, red on a critical audit, blue for noop", () => {
    expect((runEmbed(baseSummary()).embeds as { color: number }[])[0].color).toBe(0x2ecc71);
    expect((runEmbed(baseSummary({ audit: { ok: false, critical: 1, warn: 0 } })).embeds as { color: number }[])[0].color).toBe(0xe74c3c);
    expect((runEmbed(baseSummary({ status: "noop", orders: [], fills: [] })).embeds as { color: number }[])[0].color).toBe(0x3498db);
  });
  it("truncates a long order list with a '+N more' tail and keeps fields within Discord's 1024 limit", () => {
    const orders = Array.from({ length: 20 }, (_, i) => ({ ticker: `T${i}`, side: "buy", qty: 1, limitPrice: 10, reason: "ENTER" }));
    const embed = (runEmbed(baseSummary({ orders })).embeds as { fields: { name: string; value: string }[] }[])[0];
    const ordersField = embed.fields.find((f) => f.name.startsWith("Orders"))!;
    expect(ordersField.value).toContain("+5 more");
    for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
  it("titles with status/broker/date and shows an audit line", () => {
    const embed = (runEmbed(baseSummary({ audit: { ok: true, critical: 0, warn: 2 } })).embeds as { title: string; fields: { name: string; value: string }[] }[])[0];
    expect(embed.title).toContain("2026-09-25");
    expect(embed.title.toLowerCase()).toContain("schwab");
    expect(embed.fields.some((f) => /audit/i.test(f.name) && /2/.test(f.value))).toBe(true);
  });
});

describe("alertEmbed", () => {
  it("is a red embed carrying the text", () => {
    const e = (alertEmbed("cron halted: turnover").embeds as { color: number; description: string }[])[0];
    expect(e.color).toBe(0xe74c3c);
    expect(e.description).toContain("turnover");
  });
});

describe("postDiscord", () => {
  it("POSTs once on success", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return jsonRes(204); }) as unknown as typeof fetch;
    await postDiscord("https://hook", alertEmbed("hi"), fetchImpl);
    expect(calls).toBe(1);
  });
  it("retries once on 429 using retry_after", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return calls === 1 ? jsonRes(429, { retry_after: 0 }) : jsonRes(204); }) as unknown as typeof fetch;
    await postDiscord("https://hook", alertEmbed("hi"), fetchImpl);
    expect(calls).toBe(2);
  });
  it("never throws on a network error", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(postDiscord("https://hook", alertEmbed("hi"), fetchImpl)).resolves.toBeUndefined();
  });
});

describe("makeNotifier", () => {
  it("no webhook → log-only, zero POSTs, flush resolves", async () => {
    const logs: string[] = [];
    let calls = 0;
    const fetchImpl = (async () => { calls++; return jsonRes(204); }) as unknown as typeof fetch;
    const n = makeNotifier({ onLog: (l) => logs.push(l), fetchImpl });
    n.message("halt!"); n.runSummary(baseSummary());
    await n.flush();
    expect(calls).toBe(0);
    expect(logs.length).toBe(2);
  });
  it("with a webhook → message/runSummary enqueue and flush awaits both", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return jsonRes(204); }) as unknown as typeof fetch;
    const n = makeNotifier({ webhookUrl: "https://hook", onLog: () => {}, fetchImpl });
    n.message("halt!"); n.runSummary(baseSummary());
    await n.flush();
    expect(calls).toBe(2);
  });
});

describe("summaryFromRun", () => {
  it("adapts a plan output into a summary (goal from ledger+trades, orders from sized)", () => {
    const out = {
      record: { today: "2026-09-25", runId: "r1", broker: "alpaca-paper" },
      ledger: { nav: 100_000, cash: 50_000, positions: [{ ticker: "AAA", qty: 10, marketValue: 50_000, avgCost: 5000 }] },
      plan: { trades: [{ ticker: "BBB", reason: "ENTER", targetWeight: 0.1 }] },
      sized: { orders: [{ ticker: "BBB", side: "buy", qty: 5, limitPrice: 20, reason: "ENTER" }], skippedHalt: [{ ticker: "CCC", reason: "gap" }], skippedDust: [] },
    } as unknown as Parameters<typeof summaryFromRun>[0];
    const s = summaryFromRun(out, "executed", [{ ticker: "BBB", side: "buy", qty: 5, price: 19.9, filledAt: "x", tradingDate: "2026-09-25", orderId: "o", runId: "r1" }], { ok: true, critical: 0, warn: 0, discrepancies: [], checked: { expected: 1, brokerMatched: 1, fills: 1 } });
    expect(s.orders).toEqual([{ ticker: "BBB", side: "buy", qty: 5, limitPrice: 20, reason: "ENTER" }]);
    expect(s.goal).toContainEqual({ ticker: "AAA", weight: 0.5 });
    expect(s.goal).toContainEqual({ ticker: "BBB", weight: 0.1 });
    expect(s.skipped).toEqual([{ ticker: "CCC", reason: "gap" }]);
    expect(s.audit).toEqual({ ok: true, critical: 0, warn: 0 });
  });
});
