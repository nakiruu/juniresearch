/**
 * companyfacts-cache.ts — persist the SEC companyfacts response per capture (D-9, 2026-10-07).
 *
 * A re-run of facts:free used to re-download companyfacts, so no capture was reproducible offline and the
 * debt sweep had to work from the filing iXBRL alone. The full response is saved gzipped under the raw
 * directory (COMPANYFACTS_FILE) after a successful fetch and read back on the next run; `refetch` bypasses it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { COMPANYFACTS_FILE } from "../manifest";
import { fetchCompanyFacts } from "./sec";

export type CompanyFactsFetch = (cik: number, contact: string) => Promise<unknown>;

/** The saved companyfacts JSON from `dir` when present (and `refetch` is false); otherwise fetch, save, return. */
export async function loadOrFetchCompanyFacts(
  dir: string,
  cik: number,
  contact: string,
  opts: { refetch: boolean },
  fetchImpl: CompanyFactsFetch = fetchCompanyFacts,
): Promise<unknown> {
  const file = join(dir, COMPANYFACTS_FILE);
  if (!opts.refetch && existsSync(file)) return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as unknown;
  const facts = await fetchImpl(cik, contact);
  writeFileSync(file, gzipSync(JSON.stringify(facts)));
  return facts;
}
