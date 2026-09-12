import { describe, it, expect } from "vitest";
import { resolveCik } from "@/lib/edgar/tickers";
import slice from "@/lib/edgar/__fixtures__/company-tickers-slice.json";

const fakeFetch = (body: unknown) =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

describe("resolveCik", () => {
  it("resolves a ticker case-insensitively", async () => {
    expect(await resolveCik("avgo", "t@example.com", fakeFetch(slice))).toEqual({ cik: 1730168, title: "Broadcom Inc." });
  });
  it("throws naming the ticker when absent", async () => {
    await expect(resolveCik("ZZZZ", "t@example.com", fakeFetch(slice))).rejects.toThrow(/ZZZZ/);
  });
});
