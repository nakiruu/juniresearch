/**
 * backfill-peers.ts — one-off: populate peers[].{pe, ps, evToEbitda} (long the
 * recurring "peerless peer" gap — tickers-only, all multiples null) from Yahoo
 * quoteSummary via the crumb flow, so the cross-sectional valuation layer (5.md)
 * and report peer columns have data. Unique peers are fetched once and cached.
 *
 *   node --import tsx scripts/backfill-peers.ts
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FACTS = "data/facts";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) juniper-research peer-backfill";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rawVal = (x: { raw?: number } | undefined): number | null => (x && typeof x.raw === "number" && Number.isFinite(x.raw) ? x.raw : null);

interface Multiples { pe: number | null; ps: number | null; evToEbitda: number | null }

async function getCrumb(): Promise<{ cookie: string; crumb: string }> {
  const ck = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const cookie = (ck.headers.get("set-cookie") || "").split(";")[0];
  const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Yahoo crumb step failed");
  return { cookie, crumb };
}

const cache = new Map<string, Multiples>();
async function fetchMultiples(ticker: string, auth: { cookie: string; crumb: string }): Promise<Multiples> {
  if (cache.has(ticker)) return cache.get(ticker)!;
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`;
  let m: Multiples = { pe: null, ps: null, evToEbitda: null };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: auth.cookie } });
    const r = (await res.json())?.quoteSummary?.result?.[0];
    m = { pe: rawVal(r?.summaryDetail?.trailingPE), ps: rawVal(r?.summaryDetail?.priceToSalesTrailing12Months), evToEbitda: rawVal(r?.defaultKeyStatistics?.enterpriseToEbitda) };
  } catch {
    /* leave nulls */
  }
  cache.set(ticker, m);
  await sleep(300);
  return m;
}

const auth = await getCrumb();
let updated = 0;

for (const t of readdirSync(FACTS).filter((d) => statSync(join(FACTS, d)).isDirectory())) {
  for (const file of readdirSync(join(FACTS, t)).filter((f) => f.endsWith(".json"))) {
    const path = join(FACTS, t, file);
    const pack = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(pack.peers) || !pack.peers.length) continue;
    let filled = 0;
    for (const p of pack.peers) {
      const m = await fetchMultiples(p.ticker, auth);
      p.pe = m.pe;
      p.ps = m.ps;
      p.evToEbitda = m.evToEbitda;
      if (m.pe != null || m.ps != null || m.evToEbitda != null) filled++;
    }
    writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
    updated++;
    console.log(`  ${t}/${file}: ${filled}/${pack.peers.length} peers populated`);
  }
}

console.log(`\nBackfilled peer multiples on ${updated} FactPack(s); ${cache.size} unique peers fetched.`);
