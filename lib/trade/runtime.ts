import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { listReportTickers, loadReport } from "../reports";
import { FactPack } from "../facts/schema";
import type { Report } from "../report.schema";
import type { BrokerAdapter } from "../broker/adapter";
import { AlpacaPaperBroker } from "../broker/alpaca";
import { SchwabBroker } from "../broker/schwab";
import { SchwabTokenStore, currentRefreshObtainedAt, refreshSeedFromEnv } from "../broker/schwab-auth";
import { SCHWAB_HOST } from "../broker/guards";
import { readFills } from "./fills";
import { RunRecord } from "./run-record";

export const TRADE_DIR = join("data", "trade");
export const FILLS_PATH = join(TRADE_DIR, "fills.jsonl");
export const LEDGER_PATH = join(TRADE_DIR, "ledger.json");
export const RUNS_DIR = join(TRADE_DIR, "runs");
export const CRON_LOCK_PATH = join(TRADE_DIR, "cron.lock");
export const CRON_LOG_PATH = join(TRADE_DIR, "cron.log");
export const HALT_STATE_PATH = join(TRADE_DIR, "halt-state.json");
export const SCHWAB_TOKEN_PATH = join(TRADE_DIR, "schwab-token.json");
export const AUTH_WARN_PATH = join(TRADE_DIR, "auth-warn.json");

/** Schwab only: the issue time of the refresh token in use, for the proactive re-auth notice. undefined otherwise. */
export function schwabRefreshObtainedAt(env: NodeJS.ProcessEnv = process.env): (() => number | undefined) | undefined {
  if ((env.BROKER ?? "alpaca-paper") !== "schwab") return undefined;
  return () => currentRefreshObtainedAt(new SchwabTokenStore(SCHWAB_TOKEN_PATH, refreshSeedFromEnv(env)));
}

export function makeAlpaca(env: NodeJS.ProcessEnv = process.env): BrokerAdapter {
  const keyId = env.APCA_API_KEY_ID, secretKey = env.APCA_API_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error("APCA_API_KEY_ID / APCA_API_SECRET_KEY are not set. Add them to .env.local (paper keys only).");
  return new AlpacaPaperBroker({ keyId, secretKey, baseUrl: env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets" });
}

/** Live broker chosen by BROKER: "alpaca-paper" (default paper) | "schwab" (LIVE). Throws on missing config. */
export function makeBroker(env: NodeJS.ProcessEnv = process.env): BrokerAdapter {
  const broker = env.BROKER ?? "alpaca-paper";
  if (broker === "alpaca-paper") return makeAlpaca(env);
  if (broker === "schwab") {
    const clientId = env.SCHWAB_CLIENT_ID, clientSecret = env.SCHWAB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("SCHWAB_CLIENT_ID / SCHWAB_CLIENT_SECRET are not set. Add them to .env.local (see .env.example).");
    // SCHWAB_REFRESH_TOKEN / SCHWAB_ACCOUNT_HASH let a host with no interactive login (e.g. a cloud
    // container) run without the token file; when both exist, env is tried first and the file is the fallback.
    const tokenStore = new SchwabTokenStore(SCHWAB_TOKEN_PATH, refreshSeedFromEnv(env));
    const accountHash = env.SCHWAB_ACCOUNT_HASH?.trim() || tokenStore.read()?.accountHash;
    if (!accountHash) throw new Error("Schwab account not linked. Run: npm run trade:auth (or set SCHWAB_ACCOUNT_HASH)");
    if (!tokenStore.envSeed && !tokenStore.read()) throw new Error("No Schwab tokens. Run: npm run trade:auth (or set SCHWAB_REFRESH_TOKEN)");
    return new SchwabBroker({ tokenStore, clientId, clientSecret, accountHash });
  }
  throw new Error(`BROKER=${broker} is not a known broker (expected "alpaca-paper" or "schwab")`);
}

export function brokerBaseUrl(adapter: BrokerAdapter): string {
  if (adapter.kind === "schwab") return `https://${SCHWAB_HOST}`;
  if (adapter.kind === "alpaca-paper") return process.env.APCA_API_BASE_URL ?? "https://paper-api.alpaca.markets";
  return "memory://";
}

export async function loadReportsAndMeta(): Promise<{ reports: Report[]; sics: Record<string, number | null>; marketCapUsd: Record<string, number | null> }> {
  const reports: Report[] = [], sics: Record<string, number | null> = {}, marketCapUsd: Record<string, number | null> = {};
  for (const t of await listReportTickers()) {
    const r = await loadReport(t); if (!r) continue;
    reports.push(r);
    const p = join("data", "facts", r.meta.ticker.toUpperCase(), `${r.meta.filing.accession}.json`);
    sics[r.meta.ticker] = existsSync(p) ? FactPack.parse(JSON.parse(readFileSync(p, "utf8"))).sic ?? null : null;
    const cell = (r as unknown as { snapshot?: { label: string; value: unknown }[] }).snapshot?.find((c) => /market cap/i.test(c.label));
    marketCapUsd[r.meta.ticker] = typeof cell?.value === "number" ? cell.value : null;
  }
  return { reports, sics, marketCapUsd };
}

export function readRunRecord(runId: string): RunRecord {
  return RunRecord.parse(JSON.parse(readFileSync(join(RUNS_DIR, `${runId}.json`), "utf8")));
}
export function latestRunRecord(): RunRecord | null {
  if (!existsSync(RUNS_DIR)) return null;
  const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;
  const latest = files.map((f) => ({ f, m: statSync(join(RUNS_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f;
  return RunRecord.parse(JSON.parse(readFileSync(join(RUNS_DIR, latest), "utf8")));
}
export { readFills };
