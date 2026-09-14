import { edgarJson, edgarText, type FetchLike } from "./client";

export interface Filing {
  form: "10-Q" | "10-K";
  accession: string;
  filedDate: string;
  periodEnd: string;
  primaryDocument: string;
  url: string;
}

interface SubmissionsBody {
  filings: { recent: {
    accessionNumber: string[]; form: string[]; filingDate: string[];
    reportDate: string[]; primaryDocument: string[];
  } };
}

export const padCik = (cik: number) => String(cik).padStart(10, "0");
export const submissionsUrl = (cik: number) => `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
export const filingUrl = (cik: number, accession: string, primaryDocument: string) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${primaryDocument}`;

const WANTED = new Set(["10-Q", "10-K"]);

export function parseSubmissions(cik: number, body: SubmissionsBody): Filing[] {
  const r = body.filings.recent;
  const out: Filing[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!WANTED.has(r.form[i])) continue;
    out.push({
      form: r.form[i] as Filing["form"],
      accession: r.accessionNumber[i],
      filedDate: r.filingDate[i],
      periodEnd: r.reportDate[i],
      primaryDocument: r.primaryDocument[i],
      url: filingUrl(cik, r.accessionNumber[i], r.primaryDocument[i]),
    });
  }
  return out; // EDGAR lists newest first; order preserved
}

export async function fetchSubmissions(cik: number, contact: string, fetchImpl: FetchLike = fetch): Promise<Filing[]> {
  return parseSubmissions(cik, await edgarJson<SubmissionsBody>(submissionsUrl(cik), contact, fetchImpl));
}

export interface RecentFiling { form: string; accession: string; filedDate: string; periodEnd: string; primaryDocument: string; items: string[] }
export interface RecentBody { filings: { recent: SubmissionsBody["filings"]["recent"] & { items?: string[] } } }

export function parseRecent(body: RecentBody): RecentFiling[] {
  const r = body.filings.recent;
  return r.form.map((form, i) => ({
    form, accession: r.accessionNumber[i], filedDate: r.filingDate[i], periodEnd: r.reportDate[i],
    primaryDocument: r.primaryDocument[i], items: (r.items?.[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }));
}
export const findEarningsRelease = (recent: RecentFiling[], filedOnOrBefore: string) =>
  recent.find((f) => f.form === "8-K" && f.items.includes("2.02") && f.filedDate <= filedOnOrBefore) ?? null;
export const findLatestAnnual = (recent: RecentFiling[], filedOnOrBefore: string) =>
  recent.find((f) => f.form === "10-K" && f.filedDate <= filedOnOrBefore) ?? null;
/** The definitive proxy statement (DEF 14A) — additional materials (DEFA14A) are not the governance source. */
export const findLatestProxy = (recent: RecentFiling[], filedOnOrBefore: string) =>
  recent.find((f) => f.form === "DEF 14A" && f.filedDate <= filedOnOrBefore) ?? null;

const indexUrl = (cik: number, accession: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/index.json`;
export async function fetchFilingIndex(cik: number, accession: string, contact: string, fetchImpl: FetchLike = fetch): Promise<{ name: string }[]> {
  const j = await edgarJson<{ directory: { item: { name: string }[] } }>(indexUrl(cik, accession), contact, fetchImpl);
  return j.directory.item;
}
/** The earnings-release exhibit: "ex99_1", "ex-99.1", or AT&T's "exhibit991"; the .1 exhibit wins when several 99s are filed. */
export function exhibit99Url(cik: number, accession: string, items: { name: string }[]): string | null {
  const htm = items.filter((i) => /\.htm/i.test(i.name) && /ex(?:hibit)?[-_.]?99/i.test(i.name));
  const first = htm.find((i) => /ex(?:hibit)?[-_.]?99[-_.]?1(?!\d)/i.test(i.name)) ?? htm[0];
  return first ? filingUrl(cik, accession, first.name) : null;
}
export const fetchEdgarDocument = edgarText;
