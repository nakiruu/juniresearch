import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchwabTokenStore, ensureAccessToken, exchangeCode, parseAuthCode, buildAuthorizeUrl, SchwabAuthError, TOKEN_ENDPOINT, type SchwabTokens } from "./schwab-auth";

const creds = { clientId: "cid", clientSecret: "secret" };
const tmpStore = () => new SchwabTokenStore(join(mkdtempSync(join(tmpdir(), "schwab-")), "token.json"));
const jsonRes = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const NOW = Date.parse("2026-09-25T13:00:00Z");
const seed = (over: Partial<SchwabTokens> = {}): SchwabTokens => ({ refreshToken: "R", accessToken: "A", accessExpiresAt: NOW + 20 * 60_000, refreshObtainedAt: NOW, ...over });

describe("ensureAccessToken", () => {
  it("returns an unexpired token without any network call", async () => {
    const store = tmpStore(); store.write(seed());
    const fetchImpl = (() => { throw new Error("network must not be called"); }) as unknown as typeof fetch;
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A");
  });

  it("refreshes and persists a near-expiry token", async () => {
    const store = tmpStore(); store.write(seed({ accessExpiresAt: NOW + 30_000 })); // inside the 60s skew
    let sentBody = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => { sentBody = String(init.body); return jsonRes(200, { access_token: "A2", expires_in: 1800, token_type: "Bearer" }); }) as unknown as typeof fetch;
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A2");
    expect(sentBody).toContain("grant_type=refresh_token");
    const persisted = store.read()!;
    expect(persisted.accessToken).toBe("A2");
    expect(persisted.accessExpiresAt).toBe(NOW + 1800 * 1000);
    expect(persisted.refreshToken).toBe("R"); // unchanged when the response omits a new one
  });

  it("rotates the refresh token when the response includes one", async () => {
    const store = tmpStore(); store.write(seed({ accessExpiresAt: NOW - 1 }));
    const fetchImpl = (async () => jsonRes(200, { access_token: "A2", refresh_token: "R2", expires_in: 1800 })) as unknown as typeof fetch;
    await ensureAccessToken(store, creds, fetchImpl, NOW);
    expect(store.read()!.refreshToken).toBe("R2");
  });

  it("throws SchwabAuthError with the remedy when the refresh token is dead (401)", async () => {
    const store = tmpStore(); store.write(seed({ accessExpiresAt: NOW - 1 }));
    const fetchImpl = (async () => jsonRes(401, { error: "unsupported_token_type" })) as unknown as typeof fetch;
    await expect(ensureAccessToken(store, creds, fetchImpl, NOW)).rejects.toThrow(SchwabAuthError);
    await expect(ensureAccessToken(store, creds, fetchImpl, NOW)).rejects.toThrow(/npm run trade:auth/);
  });

  it("throws SchwabAuthError when no tokens are stored", async () => {
    await expect(ensureAccessToken(tmpStore(), creds, (() => { throw new Error("x"); }) as unknown as typeof fetch, NOW)).rejects.toThrow(/trade:auth/);
  });
});

describe("exchangeCode / helpers", () => {
  it("exchanges an auth code for a token set", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe(TOKEN_ENDPOINT);
      expect(String(init.body)).toContain("grant_type=authorization_code");
      return jsonRes(200, { access_token: "A", refresh_token: "R", expires_in: 1800 });
    }) as unknown as typeof fetch;
    const t = await exchangeCode("thecode", creds, "https://127.0.0.1", fetchImpl, NOW);
    expect(t).toMatchObject({ refreshToken: "R", accessToken: "A", accessExpiresAt: NOW + 1800 * 1000, refreshObtainedAt: NOW });
  });

  it("parseAuthCode extracts the code; buildAuthorizeUrl includes client_id + redirect_uri", () => {
    expect(parseAuthCode("https://127.0.0.1/?code=abc123&session=x")).toBe("abc123");
    expect(() => parseAuthCode("https://127.0.0.1/?nope=1")).toThrow(SchwabAuthError);
    const u = buildAuthorizeUrl("cid", "https://127.0.0.1");
    expect(u).toContain("client_id=cid");
    expect(u).toContain("redirect_uri=https%3A%2F%2F127.0.0.1");
  });
});
