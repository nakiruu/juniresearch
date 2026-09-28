import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir) };
});

import { listReportTickers, listReports, loadReport, resetReportCache } from "@/lib/reports";

const readFile = vi.mocked(fsPromises.readFile);
const readdir = vi.mocked(fsPromises.readdir);

beforeEach(() => {
  resetReportCache();
  readFile.mockClear();
  readdir.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetReportCache();
});

describe("report loading memo", () => {
  it("reads, parses and validates each report once per build process", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const [a, b] = await Promise.all([loadReport("avgo"), loadReport("AVGO")]);
    const c = await loadReport("avgo");
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("lets the index and the report pages share one load per file", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const tickers = await listReportTickers();
    await listReports();
    await Promise.all(tickers.map((t) => loadReport(t)));
    expect(readdir).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledTimes(tickers.length);
  });

  it("re-reads the disk outside next build so edits show up in dev and to the live scheduler", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await loadReport("avgo");
    await loadReport("avgo");
    await listReportTickers();
    await listReportTickers();
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  it("does not memoize a failed load", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    readFile.mockRejectedValueOnce(Object.assign(new Error("EIO"), { code: "EIO" }));
    await expect(loadReport("avgo")).rejects.toThrow(/EIO/);
    expect((await loadReport("avgo"))?.meta.ticker).toBe("AVGO");
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
