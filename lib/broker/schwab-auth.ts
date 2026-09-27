/**
 * schwab-auth.ts — Schwab OAuth2 token management (spec §5). Access tokens live ~30 min and are
 * refreshed automatically from the stored refresh token; refresh tokens die after ~7 days and can
 * only be renewed by an interactive login (`npm run trade:auth`). A dead refresh token surfaces as a
 * SchwabAuthError carrying the exact remedy — the run alerts, it never silently no-ops. Pure over an
 * injected fetch and a file-backed token store, so it is unit-testable without the network.
 *
 * Two refresh-token sources: an optional env seed (SCHWAB_REFRESH_TOKEN, for hosts with no
 * interactive login, e.g. a cloud container) and the token file. The env token is tried first; the
 * file is the fallback for when the env value is out of date (rotated, or superseded by a newer
 * `trade:auth`). An env token that failed or was rotated away is remembered by fingerprint so it is
 * never retried against Schwab.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_TIMEOUTS, fetchWithTimeout } from "./http";

export const TOKEN_ENDPOINT = "https://api.schwabapi.com/v1/oauth/token";
export const AUTHORIZE_ENDPOINT = "https://api.schwabapi.com/v1/oauth/authorize";
const ACCESS_SKEW_MS = 60_000; // refresh this long before the access token actually expires

export class SchwabAuthError extends Error { constructor(msg: string) { super(msg); this.name = "SchwabAuthError"; } }

export interface SchwabTokens {
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: number;   // epoch ms
  refreshObtainedAt?: number; // epoch ms — the 7-day clock starts here (unknown for an env seed without SCHWAB_REFRESH_OBTAINED_AT)
  accountHash?: string;      // resolved once at auth time and cached here
  staleEnvRefreshFp?: string; // fingerprint of an env refresh token that failed or was rotated away — skip it
}

/** A refresh token supplied outside the token file (env). obtainedAt is optional: the env can't always know it. */
export interface RefreshSeed { refreshToken: string; refreshObtainedAt?: number }

/** Short, non-reversible fingerprint so the token file never stores a second copy of the env secret. */
export const refreshFingerprint = (token: string): string => createHash("sha256").update(token).digest("hex").slice(0, 16);

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(), // seconds (~1800)
  token_type: z.string().optional(),
});

export class SchwabTokenStore {
  constructor(private readonly path: string, readonly envSeed: RefreshSeed | null = null) {}
  read(): SchwabTokens | null {
    if (!existsSync(this.path)) return null;
    try { return JSON.parse(readFileSync(this.path, "utf8")) as SchwabTokens; } catch { return null; }
  }
  write(t: SchwabTokens): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(t, null, 2) + "\n");
  }
}

interface Creds { clientId: string; clientSecret: string }
const basicAuth = (c: Creds) => "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");

async function postToken(body: Record<string, string>, creds: Creds, fetchImpl: typeof fetch): Promise<z.infer<typeof TokenResponse>> {
  const res = await fetchWithTimeout(fetchImpl, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { Authorization: basicAuth(creds), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  }, DEFAULT_TIMEOUTS.tokenMs, "token");
  const text = res.text;
  if (res.status === 400 || res.status === 401) {
    throw new SchwabAuthError(`Schwab token endpoint ${res.status} — the refresh token has expired or was revoked. Run: npm run trade:auth (${text.slice(0, 200)})`);
  }
  if (!res.ok) throw new Error(`Schwab POST ${TOKEN_ENDPOINT} → ${res.status}: ${text.slice(0, 300)}`);
  return TokenResponse.parse(JSON.parse(text));
}

/**
 * A valid access token, refreshing (and persisting) it within the skew window. Throws SchwabAuthError
 * if re-auth is required. Refresh candidates, in order: the env seed (unless it is the file's token
 * or known stale), then the file's refresh token. A candidate rejected by Schwab (400/401) falls
 * through to the next; any other failure (5xx, network) throws immediately — it says nothing about
 * which token is current, so it must not burn the fallback.
 */
export async function ensureAccessToken(store: SchwabTokenStore, creds: Creds, fetchImpl: typeof fetch = fetch, nowMs: number = Date.now()): Promise<string> {
  const file = store.read();
  const env = store.envSeed?.refreshToken ? store.envSeed : null;
  if (!file && !env) throw new SchwabAuthError("No Schwab tokens found — run: npm run trade:auth (or set SCHWAB_REFRESH_TOKEN)");
  if (file?.accessToken && file.accessExpiresAt - ACCESS_SKEW_MS > nowMs) return file.accessToken;

  const envFp = env ? refreshFingerprint(env.refreshToken) : null;
  const candidates: { source: "env" | "file"; refreshToken: string; refreshObtainedAt?: number }[] = [];
  if (env && env.refreshToken !== file?.refreshToken && envFp !== file?.staleEnvRefreshFp) {
    candidates.push({ source: "env", refreshToken: env.refreshToken, refreshObtainedAt: env.refreshObtainedAt });
  }
  if (file?.refreshToken) {
    // When env and file hold the same token, the env may know the issue time the file lacks.
    const obtainedAt = file.refreshObtainedAt ?? (env?.refreshToken === file.refreshToken ? env.refreshObtainedAt : undefined);
    candidates.push({ source: "file", refreshToken: file.refreshToken, refreshObtainedAt: obtainedAt });
  }

  let staleEnvRefreshFp = file?.staleEnvRefreshFp;
  const failures: string[] = [];
  for (const c of candidates) {
    let r: z.infer<typeof TokenResponse>;
    try {
      r = await postToken({ grant_type: "refresh_token", refresh_token: c.refreshToken }, creds, fetchImpl);
    } catch (e) {
      if (!(e instanceof SchwabAuthError)) throw e;
      failures.push(`${c.source}: ${e.message}`);
      if (c.source === "env") staleEnvRefreshFp = envFp!; // out of date — never retry it
      continue;
    }
    const refreshToken = r.refresh_token ?? c.refreshToken; // Schwab may rotate the refresh token
    // An env token that was just rotated away is dead from now on; remember it so it isn't replayed.
    if (c.source === "env" && refreshToken !== c.refreshToken) staleEnvRefreshFp = envFp!;
    const updated: SchwabTokens = {
      ...file,
      refreshToken,
      accessToken: r.access_token,
      accessExpiresAt: nowMs + r.expires_in * 1000,
      refreshObtainedAt: c.refreshObtainedAt,
      ...(staleEnvRefreshFp ? { staleEnvRefreshFp } : {}),
    };
    store.write(updated);
    return updated.accessToken;
  }
  if (file && staleEnvRefreshFp !== file.staleEnvRefreshFp) store.write({ ...file, staleEnvRefreshFp });
  throw new SchwabAuthError(
    candidates.length === 0
      ? "No usable Schwab refresh token (SCHWAB_REFRESH_TOKEN is known stale and there is no token file) — run: npm run trade:auth, then update SCHWAB_REFRESH_TOKEN"
      : `Every Schwab refresh token was rejected — run: npm run trade:auth (and update SCHWAB_REFRESH_TOKEN if you use it). ${failures.join(" | ")}`,
  );
}

/**
 * The env seed from SCHWAB_REFRESH_TOKEN (+ optional SCHWAB_REFRESH_OBTAINED_AT, ISO-8601 or epoch
 * ms). Unset/blank → null, so the file alone is used exactly as before.
 */
export function refreshSeedFromEnv(env: NodeJS.ProcessEnv): RefreshSeed | null {
  const refreshToken = env.SCHWAB_REFRESH_TOKEN?.trim();
  if (!refreshToken) return null;
  const raw = env.SCHWAB_REFRESH_OBTAINED_AT?.trim();
  if (!raw) return { refreshToken };
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`SCHWAB_REFRESH_OBTAINED_AT (${raw}) is not an ISO-8601 date or epoch ms`);
  return { refreshToken, refreshObtainedAt: ms };
}

/** Exchange an authorization code (from the interactive login) for a fresh token set. Used by trade:auth. */
export async function exchangeCode(code: string, creds: Creds, redirectUri: string, fetchImpl: typeof fetch = fetch, nowMs: number = Date.now()): Promise<SchwabTokens> {
  const r = await postToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, creds, fetchImpl);
  if (!r.refresh_token) throw new SchwabAuthError("Schwab authorization_code exchange returned no refresh_token");
  return { refreshToken: r.refresh_token, accessToken: r.access_token, accessExpiresAt: nowMs + r.expires_in * 1000, refreshObtainedAt: nowMs };
}

/** Schwab refresh tokens die this long after the interactive login (a policy — so a default, not a law). */
export const SCHWAB_REFRESH_LIFETIME_MS = 7 * 86_400_000;

export type RefreshHealthLevel = "ok" | "warn" | "critical" | "unknown";
export interface RefreshHealth { level: RefreshHealthLevel; expiresAt: number | null; remainingMs: number | null }

/**
 * Will the refresh token still be alive for the next scheduled run? critical: it dies before the next
 * run (+15 min slack) — renew today; warn: under `warnHours` left (72h covers a weekend); unknown: the
 * issue time isn't known (an env token without SCHWAB_REFRESH_OBTAINED_AT). Pure.
 */
export function refreshTokenHealth(refreshObtainedAt: number | null | undefined, nowMs: number, nextRunMs: number,
  cfg: { lifetimeMs: number; warnHours: number }): RefreshHealth {
  if (refreshObtainedAt == null || !Number.isFinite(refreshObtainedAt)) return { level: "unknown", expiresAt: null, remainingMs: null };
  const expiresAt = refreshObtainedAt + cfg.lifetimeMs;
  const remainingMs = expiresAt - nowMs;
  const level: RefreshHealthLevel = expiresAt <= nextRunMs + 15 * 60_000 ? "critical" : remainingMs < cfg.warnHours * 3_600_000 ? "warn" : "ok";
  return { level, expiresAt, remainingMs };
}

/** The issue time of the refresh token in use: the token file's when there is one (it holds the current lineage), else the env seed's. */
export function currentRefreshObtainedAt(store: SchwabTokenStore): number | undefined {
  const file = store.read();
  return file ? file.refreshObtainedAt : store.envSeed?.refreshObtainedAt;
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string): string {
  return `${AUTHORIZE_ENDPOINT}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code" })}`;
}

/** Pull the ?code= out of the redirect URL the user pastes back after logging in. */
export function parseAuthCode(redirectUrl: string): string {
  const code = new URL(redirectUrl).searchParams.get("code");
  if (!code) throw new SchwabAuthError("No 'code' query parameter in the pasted redirect URL");
  return code;
}
