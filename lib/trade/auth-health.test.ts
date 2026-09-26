import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeWarnAuth, authHealthMessage } from "./auth-health";
import type { RefreshHealth } from "../broker/schwab-auth";

const MON = Date.parse("2026-09-28T13:45:00Z"); // 09:45 ET
const H = 3_600_000;
const warn: RefreshHealth = { level: "warn", expiresAt: MON + 40 * H, remainingMs: 40 * H };
const crit: RefreshHealth = { level: "critical", expiresAt: MON + 5 * H, remainingMs: 5 * H };
const path = () => join(mkdtempSync(join(tmpdir(), "authwarn-")), "auth-warn.json");

describe("maybeWarnAuth", () => {
  it("is silent when ok", () => {
    const sent: string[] = [];
    expect(maybeWarnAuth({ level: "ok", expiresAt: 1, remainingMs: 1 }, MON, MON + 24 * H, path(), (m) => sent.push(m))).toBe(false);
    expect(sent).toEqual([]);
  });
  it("notifies once per ET day per level, and again the next day", () => {
    const p = path(); const sent: string[] = [];
    maybeWarnAuth(warn, MON, MON + 24 * H, p, (m) => sent.push(m));
    maybeWarnAuth(warn, MON + 2 * H, MON + 24 * H, p, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    maybeWarnAuth(warn, MON + 24 * H, MON + 48 * H, p, (m) => sent.push(m));
    expect(sent).toHaveLength(2);
  });
  it("escalates immediately (warn → critical the same day), never de-escalates the same day", () => {
    const p = path(); const sent: string[] = [];
    maybeWarnAuth(warn, MON, MON + 24 * H, p, (m) => sent.push(m));
    maybeWarnAuth(crit, MON + H, MON + 24 * H, p, (m) => sent.push(m));
    maybeWarnAuth(warn, MON + 2 * H, MON + 24 * H, p, (m) => sent.push(m));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/BEFORE the next run.*trade:auth/);
  });
  it("never throws, even if notify does", () => {
    expect(maybeWarnAuth(warn, MON, MON + H, path(), () => { throw new Error("discord down"); })).toBe(false);
  });
});

describe("authHealthMessage", () => {
  it("names the expiry in ET and the remedy", () => {
    expect(authHealthMessage(warn, MON + 24 * H)).toMatch(/expires Wed, Sep 30.* ET \(40h left\).*npm run trade:auth/);
    expect(authHealthMessage({ level: "unknown", expiresAt: null, remainingMs: null }, 0)).toMatch(/SCHWAB_REFRESH_OBTAINED_AT/);
  });
});
