import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchwabTokenStore, ensureAccessToken, exchangeCode, parseAuthCode, buildAuthorizeUrl, SchwabAuthError, TOKEN_ENDPOINT, refreshFingerprint, refreshSeedFromEnv, type SchwabTokens, type RefreshSeed } from "./schwab-auth";

const creds = { clientId: "cid", clientSecret: "secret" };
const tmpStore = (seed: RefreshSeed | null = null) => new SchwabTokenStore(join(mkdtempSync(join(tmpdir(), "schwab-")), "token.json"), seed);
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

/** A token endpoint that accepts only the listed refresh tokens; records which ones were sent. */
function tokenServer(valid: Record<string, { access: string; rotateTo?: string }>) {
  const sent: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const rt = new URLSearchParams(String(init.body)).get("refresh_token")!;
    sent.push(rt);
    const ok = valid[rt];
    if (!ok) return jsonRes(400, { error: "invalid_grant" });
    return jsonRes(200, { access_token: ok.access, expires_in: 1800, ...(ok.rotateTo ? { refresh_token: ok.rotateTo } : {}) });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

describe("ensureAccessToken with an env refresh token (SCHWAB_REFRESH_TOKEN)", () => {
  const expired = { accessExpiresAt: NOW - 1 };

  it("works with no token file at all, and creates one", async () => {
    const store = tmpStore({ refreshToken: "ENV", refreshObtainedAt: NOW - 86_400_000 });
    const { sent, fetchImpl } = tokenServer({ ENV: { access: "A-env" } });
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A-env");
    expect(sent).toEqual(["ENV"]);
    expect(store.read()).toMatchObject({ refreshToken: "ENV", accessToken: "A-env", refreshObtainedAt: NOW - 86_400_000 });
  });

  it("tries the env token first when it differs from the file", async () => {
    const store = tmpStore({ refreshToken: "ENV" }); store.write(seed({ ...expired, refreshToken: "FILE", accountHash: "H" }));
    const { sent, fetchImpl } = tokenServer({ ENV: { access: "A-env" }, FILE: { access: "A-file" } });
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A-env");
    expect(sent).toEqual(["ENV"]);
    expect(store.read()).toMatchObject({ refreshToken: "ENV", accountHash: "H" }); // file now holds the env lineage
  });

  it("falls back to the file when the env token is out of date, and never retries the stale env token", async () => {
    const store = tmpStore({ refreshToken: "OLD-ENV" }); store.write(seed({ ...expired, refreshToken: "FILE" }));
    const { sent, fetchImpl } = tokenServer({ FILE: { access: "A-file" } });
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A-file");
    expect(sent).toEqual(["OLD-ENV", "FILE"]);
    expect(store.read()!.staleEnvRefreshFp).toBe(refreshFingerprint("OLD-ENV"));
    expect(JSON.stringify(store.read())).not.toContain("OLD-ENV"); // only a fingerprint is persisted

    store.write({ ...store.read()!, accessExpiresAt: NOW - 1 }); // next refresh cycle
    sent.length = 0;
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A-file");
    expect(sent).toEqual(["FILE"]);
  });

  it("marks an env token stale once Schwab rotates it, so the rotated file token is used next time", async () => {
    const store = tmpStore({ refreshToken: "ENV" });
    const { sent, fetchImpl } = tokenServer({ ENV: { access: "A1", rotateTo: "R2" }, R2: { access: "A2" } });
    await ensureAccessToken(store, creds, fetchImpl, NOW);
    expect(store.read()).toMatchObject({ refreshToken: "R2", staleEnvRefreshFp: refreshFingerprint("ENV") });
    store.write({ ...store.read()!, accessExpiresAt: NOW - 1 });
    sent.length = 0;
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A2");
    expect(sent).toEqual(["R2"]);
  });

  it("uses a new env value even after an older one was marked stale", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "schwab-")), "token.json");
    new SchwabTokenStore(path).write(seed({ ...expired, refreshToken: "FILE", staleEnvRefreshFp: refreshFingerprint("OLD-ENV") }));
    const { sent, fetchImpl } = tokenServer({ "NEW-ENV": { access: "A-new" } });
    expect(await ensureAccessToken(new SchwabTokenStore(path, { refreshToken: "NEW-ENV" }), creds, fetchImpl, NOW)).toBe("A-new");
    expect(sent).toEqual(["NEW-ENV"]);
  });

  it("sends the token once when env and file hold the same one", async () => {
    const store = tmpStore({ refreshToken: "R" }); store.write(seed(expired));
    const { sent, fetchImpl } = tokenServer({ R: { access: "A2" } });
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A2");
    expect(sent).toEqual(["R"]);
  });

  it("still returns a valid cached access token without any network call", async () => {
    const store = tmpStore({ refreshToken: "ENV" }); store.write(seed());
    const fetchImpl = (() => { throw new Error("network must not be called"); }) as unknown as typeof fetch;
    expect(await ensureAccessToken(store, creds, fetchImpl, NOW)).toBe("A");
  });

  it("throws SchwabAuthError with the remedy when both env and file are rejected, recording the stale env token", async () => {
    const store = tmpStore({ refreshToken: "ENV" }); store.write(seed({ ...expired, refreshToken: "FILE" }));
    const { fetchImpl } = tokenServer({});
    await expect(ensureAccessToken(store, creds, fetchImpl, NOW)).rejects.toThrow(/trade:auth.*SCHWAB_REFRESH_TOKEN/);
    expect(store.read()!.staleEnvRefreshFp).toBe(refreshFingerprint("ENV"));
  });

  it("does not fall back on a non-auth failure (5xx) — it says nothing about which token is current", async () => {
    const store = tmpStore({ refreshToken: "ENV" }); store.write(seed({ ...expired, refreshToken: "FILE" }));
    const sent: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { sent.push(new URLSearchParams(String(init.body)).get("refresh_token")!); return jsonRes(503, {}); }) as unknown as typeof fetch;
    await expect(ensureAccessToken(store, creds, fetchImpl, NOW)).rejects.toThrow(/503/);
    expect(sent).toEqual(["ENV"]);
    expect(store.read()!.staleEnvRefreshFp).toBeUndefined();
  });
});

describe("refreshSeedFromEnv", () => {
  const e = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("is null when SCHWAB_REFRESH_TOKEN is unset or blank", () => {
    expect(refreshSeedFromEnv(e({}))).toBeNull();
    expect(refreshSeedFromEnv(e({ SCHWAB_REFRESH_TOKEN: "  " }))).toBeNull();
  });
  it("parses the token and an ISO or epoch-ms obtained-at", () => {
    expect(refreshSeedFromEnv(e({ SCHWAB_REFRESH_TOKEN: " R " }))).toEqual({ refreshToken: "R" });
    expect(refreshSeedFromEnv(e({ SCHWAB_REFRESH_TOKEN: "R", SCHWAB_REFRESH_OBTAINED_AT: "2026-09-25T13:00:00Z" }))).toEqual({ refreshToken: "R", refreshObtainedAt: NOW });
    expect(refreshSeedFromEnv(e({ SCHWAB_REFRESH_TOKEN: "R", SCHWAB_REFRESH_OBTAINED_AT: String(NOW) }))).toEqual({ refreshToken: "R", refreshObtainedAt: NOW });
  });
  it("rejects an unparseable obtained-at", () => {
    expect(() => refreshSeedFromEnv(e({ SCHWAB_REFRESH_TOKEN: "R", SCHWAB_REFRESH_OBTAINED_AT: "last tuesday" }))).toThrow(/SCHWAB_REFRESH_OBTAINED_AT/);
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
