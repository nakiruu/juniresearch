/**
 * trade:auth — interactive Schwab OAuth (spec §5). Run once to link the account, then ~weekly when
 * the 7-day refresh token expires. Prints the authorize URL, reads the pasted redirect URL, exchanges
 * the code for tokens, resolves the account hash, and writes the token store (data/trade/schwab-token.json,
 * gitignored). This is the one unavoidable manual touch Schwab's API imposes on unattended trading.
 */
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { buildAuthorizeUrl, exchangeCode, parseAuthCode, SchwabTokenStore } from "../lib/broker/schwab-auth";
import { requireSchwab } from "./_env";
import { SCHWAB_TOKEN_PATH } from "./_trade-common";

const { clientId, clientSecret, redirectUri } = requireSchwab();
console.log("\n1) Open this URL, log in to Schwab, and approve access:\n");
console.log("   " + buildAuthorizeUrl(clientId, redirectUri) + "\n");
console.log(`2) You'll be redirected to ${redirectUri}?code=...  — copy the FULL address bar URL.\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const redirect = (await rl.question("3) Paste the redirect URL here: ")).trim();
rl.close();

const tokens = await exchangeCode(parseAuthCode(redirect), { clientId, clientSecret }, redirectUri);
const res = await fetch("https://api.schwabapi.com/trader/v1/accounts/accountNumbers", { headers: { Authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" } });
if (!res.ok) { console.error(`accountNumbers → ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(2); }
const accounts = z.array(z.object({ accountNumber: z.string(), hashValue: z.string() })).parse(JSON.parse(await res.text()));
if (accounts.length === 0) { console.error("No Schwab accounts returned for these credentials."); process.exit(2); }
const chosen = accounts[0];
if (accounts.length > 1) console.log(`\nMultiple accounts found; using the first (${chosen.accountNumber}). Edit ${SCHWAB_TOKEN_PATH} to choose another.`);

new SchwabTokenStore(SCHWAB_TOKEN_PATH).write({ ...tokens, accountHash: chosen.hashValue });
console.log(`\nLinked Schwab account ${chosen.accountNumber}. Tokens stored at ${SCHWAB_TOKEN_PATH}.`);
console.log("Set BROKER=schwab in .env.local to trade LIVE. Re-run `npm run trade:auth` when the weekly refresh token expires.");
