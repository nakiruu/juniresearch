import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Rec = Record<string, unknown>;

export function readRawText(dir: string, file: string): string {
  try { return readFileSync(join(dir, file), "utf8"); }
  catch { throw new Error(`Missing raw file ${file} in ${dir}`); }
}

export function readRawJson(dir: string, file: string): unknown {
  const text = readRawText(dir, file);
  try { return JSON.parse(text); } catch { throw new Error(`Raw file ${file} in ${dir} is not JSON`); }
}

/** A numeric field, tolerating numeric strings; throws naming file and key unless optional. */
export function num(obj: Rec | undefined, key: string, file: string, opts: { optional?: boolean } = {}): number | null {
  const v = obj?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (opts.optional) return null;
  throw new Error(`Missing numeric "${key}" in ${file}`);
}

export function str(obj: Rec | undefined, key: string, file: string): string {
  const v = obj?.[key];
  if (typeof v === "string" && v.trim()) return v;
  throw new Error(`Missing string "${key}" in ${file}`);
}

export function section<T = Rec>(obj: unknown, path: string[], file: string): T {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object" || !(p in (cur as Rec))) throw new Error(`Missing "${path.join(".")}" in ${file}`);
    cur = (cur as Rec)[p];
  }
  return cur as T;
}
