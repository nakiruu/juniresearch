export function requireContact(): string {
  const c = process.env.EDGAR_CONTACT;
  if (!c) { console.error("EDGAR_CONTACT is not set. Add it to .env.local (see .env.example)."); process.exit(2); }
  return c;
}

export function requireAlpaca(): { keyId: string; secretKey: string; baseUrl: string } {
  const keyId = process.env.APCA_API_KEY_ID, secretKey = process.env.APCA_API_SECRET_KEY;
  if (!keyId || !secretKey) { console.error("APCA_API_KEY_ID / APCA_API_SECRET_KEY are not set. Add them to .env.local (paper keys only)."); process.exit(2); }
  return { keyId, secretKey, baseUrl: process.env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets" };
}

/** Schwab LIVE-trading OAuth app credentials (see .env.example). The refresh/access tokens live in
 *  the token store (data/trade/schwab-token.json), populated by `npm run trade:auth`. */
export function requireSchwab(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.SCHWAB_CLIENT_ID, clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) { console.error("SCHWAB_CLIENT_ID / SCHWAB_CLIENT_SECRET are not set. Add them to .env.local (see .env.example)."); process.exit(2); }
  return { clientId, clientSecret, redirectUri: process.env.SCHWAB_REDIRECT_URI ?? "https://127.0.0.1" };
}
