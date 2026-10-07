import { describe, it, expect, vi } from "vitest";
const real = vi.hoisted(() => ({ writeFileSync: null as unknown as typeof import("node:fs").writeFileSync, readFileSync: null as unknown as typeof import("node:fs").readFileSync }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  real.writeFileSync = fs.writeFileSync; real.readFileSync = fs.readFileSync;
  return { ...fs, writeFileSync: vi.fn(fs.writeFileSync), readFileSync: vi.fn(fs.readFileSync) };
});
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdLock } from "./breakers";

const lockPath = () => join(fs.mkdtempSync(join(tmpdir(), "reclaim-")), "cron.lock");
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

describe("holdLock holds the body it wrote, not one read back (review M-1)", () => {
  it("a competitor overwriting right after our wx write: we do not own it and never delete it", () => {
    const p = lockPath();
    const competitor = `77777 ${iso(0)} beef`;
    vi.mocked(fs.writeFileSync).mockImplementationOnce(((path: string, data: string, opts: unknown) => {
      real.writeFileSync(path, data, opts as fs.WriteFileOptions); // our wx create succeeds…
      real.writeFileSync(path, competitor);                       // …then the other reclaimer's write lands
    }) as typeof fs.writeFileSync);
    const h = holdLock(p)!;
    expect(h.body).toMatch(new RegExp(`^${process.pid} `));
    expect(h.stillOurs()).toBe(false);
    h.release();
    expect(fs.readFileSync(p, "utf8")).toBe(competitor);
  });
});

describe("stale-lock reclaim is serialized (review M-1)", () => {
  it("a lock that changed between being judged stale and being reclaimed is left alone", () => {
    const p = lockPath();
    const fresh = `55555 ${iso(0)} cafe`;
    fs.writeFileSync(p, fresh);
    vi.mocked(fs.readFileSync).mockImplementationOnce((() => `11111 ${iso(2 * 60 * 60_000)} dead`) as unknown as typeof fs.readFileSync); // what we judged
    expect(holdLock(p)).toBeNull();
    expect(fs.readFileSync(p, "utf8")).toBe(fresh);
  });
  it("another reclaim in progress (fresh .reclaim mutex) → not ours, stale lock untouched", () => {
    const p = lockPath();
    const stale = `11111 ${iso(2 * 60 * 60_000)} dead`;
    fs.writeFileSync(p, stale);
    fs.writeFileSync(`${p}.reclaim`, "other");
    expect(holdLock(p)).toBeNull();
    expect(fs.readFileSync(p, "utf8")).toBe(stale);
  });
  it("a mutex left by a crashed reclaimer (older than a minute) does not block reclaim forever, and is cleaned up", () => {
    const p = lockPath();
    fs.writeFileSync(p, `11111 ${iso(2 * 60 * 60_000)} dead`);
    fs.writeFileSync(`${p}.reclaim`, "crashed");
    const old = new Date(Date.now() - 2 * 60_000);
    fs.utimesSync(`${p}.reclaim`, old, old);
    const h = holdLock(p)!;
    expect(h).not.toBeNull();
    expect(h.stillOurs()).toBe(true);
    expect(fs.existsSync(`${p}.reclaim`)).toBe(false);
  });
});
