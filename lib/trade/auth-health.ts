/**
 * auth-health.ts — proactive Schwab re-auth notices (spec #12). The refresh token dies ~7 days after
 * `trade:auth`; today the only alert is a failed run. This warns ahead of time, deduplicated so the
 * operator hears each level at most once per ET day and immediately when it gets worse.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RefreshHealth, RefreshHealthLevel } from "../broker/schwab-auth";
import { etDateString } from "./clock";

const RANK: Record<RefreshHealthLevel, number> = { ok: 0, unknown: 1, warn: 2, critical: 3 };
interface WarnState { day: string; level: RefreshHealthLevel }

function readState(path: string): WarnState | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as WarnState; } catch { return null; }
}

/** Human line for a non-ok level. */
export function authHealthMessage(h: RefreshHealth, nextRunMs: number): string {
  const et = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  if (h.level === "unknown") return "Schwab refresh token: issue time unknown, so its expiry can't be predicted — set SCHWAB_REFRESH_OBTAINED_AT or re-run `npm run trade:auth`.";
  const left = `${Math.max(0, Math.floor((h.remainingMs ?? 0) / 3_600_000))}h`;
  if (h.level === "critical") return `Schwab refresh token expires ${et(h.expiresAt!)} (${left} left) — BEFORE the next run at ${et(nextRunMs)}. Renew today: \`npm run trade:auth\`.`;
  return `Schwab refresh token expires ${et(h.expiresAt!)} (${left} left). Renew before then: \`npm run trade:auth\`.`;
}

/**
 * Notify for a non-ok level unless this level (or a worse one) was already sent today. Never throws —
 * a warning must not fail a trading run.
 */
export function maybeWarnAuth(h: RefreshHealth, nowMs: number, nextRunMs: number, statePath: string, notify: (msg: string) => void): boolean {
  try {
    if (h.level === "ok") return false;
    const day = etDateString(nowMs);
    const prev = readState(statePath);
    if (prev && prev.day === day && RANK[prev.level] >= RANK[h.level]) return false;
    notify(authHealthMessage(h, nextRunMs));
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ day, level: h.level } satisfies WarnState));
    return true;
  } catch {
    return false;
  }
}
