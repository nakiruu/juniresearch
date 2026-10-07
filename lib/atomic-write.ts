/**
 * atomic-write.ts — replace a small state file all-or-nothing: write a sibling temp file, fsync it, rename it over the
 * target, fsync the directory (Linux). A crash mid-write leaves the old file, never a torn one — which for the Schwab
 * token would lose a rotated refresh token, and for halt state would read as "corrupt" and halt.
 *
 * The temp name ends in random hex, never ".json", so a crash leftover is never read as a run record. `mode` applies
 * to the new file (default 0o666 before umask, as writeFileSync; Windows ignores all but the write bit). `dirMode`
 * applies only to directories this call creates.
 *
 * Fallback (F-5): a filesystem that cannot rename here (EXDEV — e.g. an Unraid user share spanning disks — or any
 * rename failure on Linux) gets a direct write to the target instead, logged: losing the update is worse than a torn
 * write. Windows keeps throwing after its retries (dev only).
 */
import { chmodSync, closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** Windows: a target briefly held open (antivirus, the indexer) fails the rename with one of these. */
const RETRYABLE_RENAME = new Set(["EPERM", "EACCES", "EBUSY"]);

export function writeFileAtomic(path: string, data: string, opts: { mode?: number; dirMode?: number } = {}, log: (m: string) => void = (m) => console.warn(m)): void {
  mkdirSync(dirname(path), { recursive: true, ...(opts.dirMode != null ? { mode: opts.dirMode } : {}) });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    const fd = openSync(tmp, "wx", opts.mode ?? 0o666);
    try {
      if (opts.mode != null && process.platform !== "win32") fchmodSync(fd, opts.mode);
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  try {
    renameWithRetry(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code !== "EXDEV" && process.platform !== "linux") throw e;
    log(`[atomic-write] rename onto ${path} failed (${code || (e as Error).message}); wrote the file directly instead`);
    writeFileSync(path, data);
    if (opts.mode != null && process.platform !== "win32") chmodSync(path, opts.mode);
    return;
  }
  fsyncDir(dirname(path));
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !RETRYABLE_RENAME.has(code) || attempt >= 4) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // 25 ms, synchronous
    }
  }
}

/** Make the rename itself durable (Linux). Some filesystems (FUSE) refuse a directory fsync — the rename is done either way. */
function fsyncDir(dir: string): void {
  if (process.platform !== "linux") return;
  try {
    const fd = openSync(dir, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* best effort */ }
}
