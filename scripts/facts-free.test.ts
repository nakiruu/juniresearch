import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrFetchCompanyFacts } from "../lib/facts/free/companyfacts-cache";
import { COMPANYFACTS_FILE } from "../lib/facts/manifest";

describe("facts:free CLI", () => {
  it("exits 2 with usage when args are missing", () => {
    try {
      execFileSync("node", ["--import", "tsx", "scripts/facts-free.ts"], { stdio: "pipe" });
      throw new Error("should have exited non-zero");
    } catch (e) {
      const err = e as { status?: number; stderr?: unknown };
      expect(err.status).toBe(2);
      expect(String(err.stderr)).toContain("usage: npm run facts:free");
    }
  });
});

// D-9: the companyfacts response is persisted (gzipped) under the capture directory so a rebuild is reproducible
// offline; --refetch bypasses the saved file.
describe("loadOrFetchCompanyFacts (persisted companyfacts, D-9)", () => {
  const facts = { cik: 59478, facts: { "us-gaap": { Revenues: { units: { USD: [] } } } } };
  const stub = () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return facts; };
    return { fetchImpl, calls: () => calls };
  };

  it("fetches and writes the gzip when no file exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-cache-"));
    const s = stub();
    const got = await loadOrFetchCompanyFacts(dir, 59478, "contact", { refetch: false }, s.fetchImpl);
    expect(got).toEqual(facts);
    expect(s.calls()).toBe(1);
    const file = join(dir, COMPANYFACTS_FILE);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"))).toEqual(facts);
  });

  it("reads the saved file without calling fetch when it exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-cache-"));
    const first = stub();
    await loadOrFetchCompanyFacts(dir, 59478, "contact", { refetch: false }, first.fetchImpl);
    const second = stub();
    const got = await loadOrFetchCompanyFacts(dir, 59478, "contact", { refetch: false }, second.fetchImpl);
    expect(got).toEqual(facts);
    expect(second.calls()).toBe(0);
  });

  it("refetches and overwrites when refetch is true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-cache-"));
    const first = stub();
    await loadOrFetchCompanyFacts(dir, 59478, "contact", { refetch: false }, first.fetchImpl);
    const newer = { ...facts, entityName: "newer" };
    let calls = 0;
    const got = await loadOrFetchCompanyFacts(dir, 59478, "contact", { refetch: true }, async () => { calls++; return newer; });
    expect(calls).toBe(1);
    expect(got).toEqual(newer);
    expect(JSON.parse(gunzipSync(readFileSync(join(dir, COMPANYFACTS_FILE))).toString("utf8"))).toEqual(newer);
  });
});
