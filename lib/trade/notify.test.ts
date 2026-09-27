import { describe, it, expect } from "vitest";
import { goalBook, runEmbed, alertEmbed, postDiscord, makeNotifier, summaryFromRun, allocationRows, allocationEmbed, allocationFromRun, type RunSummaryInput } from "./notify";

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

describe("allocation (every trade:execute)", () => {
  // NAV $1,000: AAA held 50% (a DEFER_TRIM under a sell lock), BBB held 20% inside the band, CCC a new
  // ENTER that was sized, DDD an ENTER too small for one share, ZZZ held with no report, XXX ineligible and not held.
  const out = {
    record: { today: "2026-09-28", runId: "r1", broker: "schwab" },
    ledger: { nav: 1_000, cash: 300, positions: [
      { ticker: "AAA", qty: 5, marketValue: 500, avgCost: 100 }, { ticker: "BBB", qty: 2, marketValue: 200, avgCost: 100 }, { ticker: "ZZZ", qty: 1, marketValue: 0.001, avgCost: 1 },
    ] },
    plan: {
      plannedCash: 0.2,
      trades: [{ ticker: "CCC", reason: "ENTER", targetWeight: 0.1, currentWeight: 0 }, { ticker: "DDD", reason: "ENTER", targetWeight: 0.03, currentWeight: 0 }],
      skipped: [
        { ticker: "AAA", code: "DEFER_TRIM", reasons: ["sell-locked"], unlockOn: "2026-10-02", currentWeight: 0.5, targetWeight: 0.1 },
        { ticker: "BBB", code: "BELOW_BAND", reasons: [], currentWeight: 0.2, targetWeight: 0.21 },
        { ticker: "ZZZ", code: "NO_SIGNAL", reasons: [], currentWeight: 0.000001, targetWeight: null },
        { ticker: "XXX", code: "INELIGIBLE", reasons: [], currentWeight: 0, targetWeight: null },
      ],
    },
    sized: { orders: [{ ticker: "CCC", side: "buy", qty: 4, limitPrice: 24.5, reason: "ENTER" }], skippedHalt: [], skippedDust: [{ ticker: "DDD", deltaUsd: 30 }] },
  } as unknown as Parameters<typeof allocationRows>[0];

  it("lists every name in the book with current → target, $ target, action and order", () => {
    const rows = allocationRows(out);
    expect(rows.map((r) => r.ticker)).toEqual(["BBB", "AAA", "CCC", "DDD", "ZZZ"]); // by target; XXX (not held, not sized) left out
    expect(rows.find((r) => r.ticker === "AAA")).toMatchObject({ currentWeight: 0.5, targetWeight: 0.1, targetUsd: 100, action: "trim deferred (sell-locked) until 2026-10-02" });
    expect(rows.find((r) => r.ticker === "CCC")).toMatchObject({ action: "ENTER", order: "buy 4 @ $24.5", targetUsd: 100 });
    expect(rows.find((r) => r.ticker === "DDD")?.order).toMatch(/under the \$ minimum or < 1 share/);
    expect(rows.find((r) => r.ticker === "BBB")?.action).toBe("hold (within band)");
    expect(rows.find((r) => r.ticker === "ZZZ")).toMatchObject({ targetWeight: null, action: "held, no report — frozen" });
  });
  it("renders a Discord embed titled with the status, within Discord's limits", () => {
    const e = allocationEmbed(allocationFromRun(out, "preview — nothing submitted")).embeds![0] as { title: string; description: string; fields: { value: string }[] };
    expect(e.title).toBe("ALLOCATION · preview — nothing submitted · schwab · 2026-09-28");
    expect(e.description).toBe("NAV $1000 · cash now 30.0% · target cash 20.0%");
    expect(e.fields.every((f) => f.value.length <= 1024)).toBe(true);
    expect(e.fields[0].value).toMatch(/AAA\s+50\.0% →\s+10\.0%\s+\$\s+100/);
  });
  it("splits a large book across fields and caps the total size", () => {
    const many = { ...out, plan: { ...(out as unknown as { plan: object }).plan, trades: Array.from({ length: 200 }, (_, i) => ({ ticker: `T${i}`, reason: "ENTER", targetWeight: 0.005, currentWeight: 0 })) } } as unknown as Parameters<typeof allocationRows>[0];
    const e = allocationEmbed(allocationFromRun(many, "preview")).embeds![0] as { fields: { value: string }[] };
    expect(e.fields.length).toBeGreaterThan(1);
    expect(e.fields.every((f) => f.value.length <= 1024)).toBe(true);
    expect(e.fields.reduce((a, f) => a + f.value.length, 0)).toBeLessThan(6000);
    expect(e.fields.at(-1)!.value).toMatch(/\+\d+ more/);
  });
  it("makeNotifier.allocation posts it", async () => {
    const calls: string[] = [];
    const n = makeNotifier({ webhookUrl: "https://discord/x", onLog: () => {}, fetchImpl: (async (_u: string, init: RequestInit) => { calls.push(String(init.body)); return jsonRes(204); }) as unknown as typeof fetch });
    n.allocation(allocationFromRun(out, "declined — nothing submitted"));
    await n.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("ALLOCATION · declined");
  });
});
