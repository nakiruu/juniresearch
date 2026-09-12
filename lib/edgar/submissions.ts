import { edgarJson, type FetchLike } from "./client";

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
