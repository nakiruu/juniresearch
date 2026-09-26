/**
 * schwab-auth.ts — Schwab OAuth2 token management (spec §5). Access tokens live ~30 min and are
 * refreshed automatically from the stored refresh token; refresh tokens die after ~7 days and can
 * only be renewed by an interactive login (`npm run trade:auth`). A dead refresh token surfaces as a
 * SchwabAuthError carrying the exact remedy — the run alerts, it never silently no-ops. Pure over an
 * injected fetch and a file-backed token store, so it is unit-testable without the network.
 */
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const TOKEN_ENDPOINT = "https://api.schwabapi.com/v1/oauth/token";
export const AUTHORIZE_ENDPOINT = "https://api.schwabapi.com/v1/oauth/authorize";
const ACCESS_SKEW_MS = 60_000; // refresh this long before the access token actually expires

export class SchwabAuthError extends Error { constructor(msg: string) { super(msg); this.name = "SchwabAuthError"; } }

export interface SchwabTokens {
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: number;   // epoch ms
  refreshObtainedAt: number; // epoch ms — the 7-day clock starts here
  accountHash?: string;      // resolved once at auth time and cached here
}

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(), // seconds (~1800)
  token_type: z.string().optional(),
});

export class SchwabTokenStore {
  constructor(private readonly path: string) {}
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
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { Authorization: basicAuth(creds), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (res.status === 400 || res.status === 401) {
    throw new SchwabAuthError(`Schwab token endpoint ${res.status} — the refresh token has expired or was revoked. Run: npm run trade:auth (${text.slice(0, 200)})`);
  }
  if (!res.ok) throw new Error(`Schwab POST ${TOKEN_ENDPOINT} → ${res.status}: ${text.slice(0, 300)}`);
  return TokenResponse.parse(JSON.parse(text));
}

/** A valid access token, refreshing (and persisting) it within the skew window. Throws SchwabAuthError if re-auth is required. */
export async function ensureAccessToken(store: SchwabTokenStore, creds: Creds, fetchImpl: typeof fetch = fetch, nowMs: number = Date.now()): Promise<string> {
  const t = store.read();
  if (!t) throw new SchwabAuthError("No Schwab tokens found — run: npm run trade:auth");
  if (t.accessToken && t.accessExpiresAt - ACCESS_SKEW_MS > nowMs) return t.accessToken;
  const r = await postToken({ grant_type: "refresh_token", refresh_token: t.refreshToken }, creds, fetchImpl);
  const updated: SchwabTokens = {
    ...t,
    accessToken: r.access_token,
    accessExpiresAt: nowMs + r.expires_in * 1000,
    refreshToken: r.refresh_token ?? t.refreshToken, // Schwab may rotate the refresh token
  };
  store.write(updated);
  return updated.accessToken;
}

/** Exchange an authorization code (from the interactive login) for a fresh token set. Used by trade:auth. */
export async function exchangeCode(code: string, creds: Creds, redirectUri: string, fetchImpl: typeof fetch = fetch, nowMs: number = Date.now()): Promise<SchwabTokens> {
  const r = await postToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, creds, fetchImpl);
  if (!r.refresh_token) throw new SchwabAuthError("Schwab authorization_code exchange returned no refresh_token");
  return { refreshToken: r.refresh_token, accessToken: r.access_token, accessExpiresAt: nowMs + r.expires_in * 1000, refreshObtainedAt: nowMs };
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
