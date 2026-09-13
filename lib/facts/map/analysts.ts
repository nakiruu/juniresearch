import { readRawJson, num, str, section, type Rec } from "../raw";
import { PEER_LIMIT } from "../manifest";
import type { FactPack } from "../schema";
const FILE = "bigdata-tearsheet-annual.json";
export const PROVENANCE = [
  { field: "analysts", endpoint: "bigdata_company_tearsheet.analyst_data" },
  { field: "estimates", endpoint: "bigdata_company_tearsheet.estimates" },
  { field: "peers", endpoint: "fmp company/peers (tickers only)" },
];

export function mapAnalysts(dir: string, latestFY: number): { analysts: FactPack["analysts"]; estimates: FactPack["estimates"]; peers: FactPack["peers"] } {
  const ts = readRawJson(dir, FILE);
  const ad = section<Rec>(ts, ["analyst_data"], FILE);
  const pt = section<Rec>(ad, ["price_targets"], FILE), rt = section<Rec>(ad, ["ratings"], FILE);
  const g = (k: string) => num(rt, k, FILE, { optional: true }) ?? 0;
  const buy = g("strong_buy") + g("buy"), hold = g("hold"), sell = g("sell") + g("strong_sell");
  const analysts: FactPack["analysts"] = {
    count: buy + hold + sell, buy, hold, sell,
    consensusRating: str(rt, "consensus", FILE),
    consensusTarget: num(pt, "target_consensus", FILE)!, medianTarget: num(pt, "target_median", FILE)!,
    highTarget: num(pt, "target_high", FILE)!, lowTarget: num(pt, "target_low", FILE)!,
    asOf: str(ad, "as_of_utc_timestamp", FILE).slice(0, 10),
  };

  const records = section<Rec[]>(ts, ["estimates", "records"], FILE);
  const mean = (metric: string, fy: number) => {
    const r = records.find((x) => x.metric === metric && x.fiscal_year === fy && x.fiscal_period === "FY");
    return r ? num(r, "estimate_mean", FILE, { optional: true }) : null;
  };
  const est = (fy: number) => ({ label: `FY${String(fy).slice(2)}E`, revenue: mean("SALES", fy), eps: mean("EPS", fy) });
  const estimates: FactPack["estimates"] = { nextFY: est(latestFY + 1), followingFY: est(latestFY + 2) };

  const peersRaw = readRawJson(dir, "fmp-peers.json") as Rec | Rec[];
  const list: unknown[] = Array.isArray(peersRaw) ? peersRaw : ((peersRaw.data ?? peersRaw.peersList ?? []) as unknown[]);
  const peers: FactPack["peers"] = list
    .map((p) => (typeof p === "string" ? p : (p as Rec).symbol as string))
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, PEER_LIMIT)
    .map((ticker) => ({ ticker, pe: null, ps: null, evToEbitda: null }));
  return { analysts, estimates, peers };
}
