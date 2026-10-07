import { describe, it, expect, vi } from "vitest";
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, writeFileSync: vi.fn(real.writeFileSync), renameSync: vi.fn(real.renameSync) };
});
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write";
import { dayTurnoverUsd } from "./trade/breakers";

const dir = () => fs.mkdtempSync(join(tmpdir(), "atomic-"));
const errno = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });

describe("writeFileAtomic", () => {
  it("writes, replaces, creates the parent, and leaves no temp file", () => {
    const d = dir(); const p = join(d, "sub", "state.json");
    writeFileAtomic(p, "one"); writeFileAtomic(p, "two");
    expect(fs.readFileSync(p, "utf8")).toBe("two");
    expect(fs.readdirSync(join(d, "sub"))).toEqual(["state.json"]);
  });
  it("a write that dies midway leaves the previous file intact and removes its temp file", () => {
    const d = dir(); const p = join(d, "halt.json");
    writeFileAtomic(p, '{"consecutive":1}');
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw errno("ENOSPC"); });
    expect(() => writeFileAtomic(p, '{"consecutive":2}')).toThrow(/ENOSPC/);
    expect(fs.readFileSync(p, "utf8")).toBe('{"consecutive":1}');
    expect(fs.readdirSync(d)).toEqual(["halt.json"]);
  });
  it("F-5: a rename refused with EXDEV falls back to a direct write and logs it (any platform)", () => {
    const d = dir(); const p = join(d, "token.json"); const logs: string[] = [];
    writeFileAtomic(p, "old");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw errno("EXDEV"); });
    writeFileAtomic(p, "new", {}, (m) => logs.push(m));
    expect(fs.readFileSync(p, "utf8")).toBe("new");
    expect(logs).toEqual([expect.stringMatching(/EXDEV.*wrote the file directly/)]);
    expect(fs.readdirSync(d)).toEqual(["token.json"]);
  });
  it.skipIf(process.platform !== "linux")("F-5: on Linux any rename failure falls back to a direct write", () => {
    const d = dir(); const p = join(d, "state.json"); const logs: string[] = [];
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw errno("EIO"); });
    writeFileAtomic(p, "x", {}, (m) => logs.push(m));
    expect(fs.readFileSync(p, "utf8")).toBe("x");
    expect(logs).toHaveLength(1);
  });
  it("a crash leftover is never read as a run record (temp names don't end in .json)", () => {
    const d = dir();
    writeFileAtomic(join(d, "r1.json"), JSON.stringify({ today: "2026-10-07", orders: [{ filledQty: 2, filledAvgPrice: 10 }] }));
    fs.writeFileSync(join(d, "r2.json.tmp-123-abcd"), "{ torn");
    expect(dayTurnoverUsd(d, "2026-10-07")).toBe(20);
  });
  it.skipIf(process.platform === "win32")("applies the requested mode exactly (POSIX), also on the fallback path", () => {
    const p = join(dir(), "token.json");
    writeFileAtomic(p, "{}", { mode: 0o600 });
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw errno("EXDEV"); });
    writeFileAtomic(p, "{}", { mode: 0o600 }, () => {});
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });
});
