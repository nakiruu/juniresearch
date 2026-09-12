import { describe, it, expect } from "vitest";
import { listReportTickers, loadReport, listReports } from "@/lib/reports";

describe("listReportTickers", () => {
  it("finds the reference fixture", async () => {
    expect(await listReportTickers()).toContain("avgo");
  });
});

describe("loadReport", () => {
  it("loads and validates a report", async () => {
    const r = await loadReport("avgo");
    expect(r?.meta.ticker).toBe("AVGO");
  });

  it("is case-insensitive", async () => {
    expect((await loadReport("AVGO"))?.meta.ticker).toBe("AVGO");
  });

  it("returns null for an unknown ticker", async () => {
    expect(await loadReport("nosuchticker")).toBeNull();
  });

  it("refuses a path-traversal ticker", async () => {
    expect(await loadReport("../../etc/passwd")).toBeNull();
  });
});

describe("listReports", () => {
  it("summarises each report for the index", async () => {
    const summaries = await listReports();
    const avgo = summaries.find((s) => s.ticker === "AVGO");
    expect(avgo).toMatchObject({
      ticker: "AVGO",
      company: "Broadcom Inc.",
      exchange: "NASDAQ",
      currentPrice: 361.99,
    });
    expect(avgo?.rating.label).toBe("BUY");
  });
});
