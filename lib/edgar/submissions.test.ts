import { describe, it, expect } from "vitest";
import {
  parseSubmissions, fetchSubmissions, submissionsUrl, filingUrl, padCik,
  parseRecent, findEarningsRelease, findLatestAnnual, findLatestProxy, exhibit99Url,
} from "@/lib/edgar/submissions";
import fixture from "@/lib/edgar/__fixtures__/avgo-submissions.json";

const fakeFetch = (status: number, body: unknown) =>
  (async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;

describe("URL helpers", () => {
  it("pads the CIK to ten digits", () => {
    expect(padCik(1730168)).toBe("0001730168");
    expect(submissionsUrl(1730168)).toBe("https://data.sec.gov/submissions/CIK0001730168.json");
  });
  it("builds the archive URL without accession dashes", () => {
    expect(filingUrl(1730168, "0001730168-26-000080", "avgo-20260802.htm"))
      .toBe("https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm");
  });
});

describe("parseSubmissions", () => {
  const filings = parseSubmissions(1730168, fixture as never);
  it("keeps only 10-Q and 10-K, newest first", () => {
    expect(filings.length).toBeGreaterThan(0);
    for (const f of filings) expect(["10-Q", "10-K"]).toContain(f.form);
    expect(filings[0].accession).toBe("0001730168-26-000080");
  });
  it("zips the columnar record into a Filing", () => {
    expect(filings[0]).toEqual({
      form: "10-Q", accession: "0001730168-26-000080", filedDate: "2026-09-10",
      periodEnd: "2026-08-02", primaryDocument: "avgo-20260802.htm",
      url: "https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm",
    });
  });
});

describe("fetchSubmissions", () => {
  it("throws naming the URL on a non-200", async () => {
    await expect(fetchSubmissions(1730168, "test@example.com", fakeFetch(403, {})))
      .rejects.toThrow(/403.*CIK0001730168/);
  });
  it("sends the required User-Agent", async () => {
    let seen: Record<string, string> = {};
    const spy = (async (_u: string, init: RequestInit) => { seen = init.headers as Record<string, string>;
      return { ok: true, status: 200, json: async () => fixture }; }) as unknown as typeof fetch;
    await fetchSubmissions(1730168, "test@example.com", spy);
    expect(seen["User-Agent"]).toBe("juniresearch/0.1 (test@example.com)");
  });
});

describe("earnings release and latest annual discovery", () => {
  const recent = [
    { form: "10-Q", accession: "0001-26-000300", filedDate: "2026-09-11", periodEnd: "2026-08-31", primaryDocument: "q.htm", items: [] },
    { form: "8-K", accession: "0001-26-000290", filedDate: "2026-09-10", periodEnd: "2026-09-10", primaryDocument: "k.htm", items: ["2.02", "8.01", "9.01"] },
    { form: "8-K", accession: "0001-26-000280", filedDate: "2026-08-01", periodEnd: "2026-08-01", primaryDocument: "k2.htm", items: ["5.02", "9.01"] },
    { form: "10-K", accession: "0001-26-000200", filedDate: "2026-06-22", periodEnd: "2026-05-31", primaryDocument: "a.htm", items: [] },
    { form: "8-K", accession: "0001-26-000190", filedDate: "2026-06-10", periodEnd: "2026-06-10", primaryDocument: "k3.htm", items: ["2.02", "9.01"] },
  ];
  it("picks the newest item-2.02 8-K filed on or before the filing", () => {
    expect(findEarningsRelease(recent, "2026-09-11")!.accession).toBe("0001-26-000290");
    expect(findEarningsRelease(recent, "2026-06-22")!.accession).toBe("0001-26-000190");
    expect(findEarningsRelease(recent, "2026-06-01")).toBeNull();
  });
  it("picks the newest 10-K filed on or before the filing", () => {
    expect(findLatestAnnual(recent, "2026-09-11")!.accession).toBe("0001-26-000200");
    expect(findLatestAnnual(recent, "2026-06-01")).toBeNull();
  });
  it("is eligible on the filing's own filedDate (the comparison is <=), not the day before", () => {
    const soleEightK = [{ form: "8-K", accession: "0001-26-000500", filedDate: "2026-07-15", periodEnd: "2026-07-15", primaryDocument: "k.htm", items: ["2.02"] }];
    expect(findEarningsRelease(soleEightK, "2026-07-15")!.accession).toBe("0001-26-000500"); // same day: eligible
    expect(findEarningsRelease(soleEightK, "2026-07-14")).toBeNull();                        // day before: not yet filed

    const soleTenK = [{ form: "10-K", accession: "0001-26-000600", filedDate: "2026-07-15", periodEnd: "2026-05-31", primaryDocument: "a.htm", items: [] }];
    expect(findLatestAnnual(soleTenK, "2026-07-15")!.accession).toBe("0001-26-000600"); // same day: eligible
    expect(findLatestAnnual(soleTenK, "2026-07-14")).toBeNull();                        // day before: not yet filed
  });
  it("finds the exhibit 99 file in a filing index", () => {
    const items = [{ name: "orcl-20260910.htm" }, { name: "orcl-ex99_1.htm" }, { name: "R1.htm" }];
    expect(exhibit99Url(1341439, "0001193125-26-387905", items)).toBe("https://www.sec.gov/Archives/edgar/data/1341439/000119312526387905/orcl-ex99_1.htm");
    expect(exhibit99Url(1, "0001-26-000001", [{ name: "k.htm" }])).toBeNull();
  });
  it("parses items from the submissions feed", () => {
    const body = { filings: { recent: { accessionNumber: ["a"], form: ["8-K"], filingDate: ["2026-09-10"], reportDate: ["2026-09-10"], primaryDocument: ["k.htm"], items: ["2.02,9.01"] } } };
    expect(parseRecent(body as never)[0].items).toEqual(["2.02", "9.01"]);
  });
});

describe("latest proxy statement discovery", () => {
  const recent = [
    { form: "10-Q", accession: "0001-26-000300", filedDate: "2026-09-11", periodEnd: "2026-08-31", primaryDocument: "q.htm", items: [] },
    { form: "DEFA14A", accession: "0001-25-000120", filedDate: "2025-10-02", periodEnd: "", primaryDocument: "defa.htm", items: [] },
    { form: "DEF 14A", accession: "0001-25-000110", filedDate: "2025-09-26", periodEnd: "", primaryDocument: "def14a.htm", items: [] },
    { form: "DEF 14A", accession: "0001-24-000110", filedDate: "2024-09-27", periodEnd: "", primaryDocument: "def14a-old.htm", items: [] },
  ];
  it("picks the newest DEF 14A filed on or before the filing, ignoring additional-materials DEFA14A", () => {
    expect(findLatestProxy(recent, "2026-09-11")!.accession).toBe("0001-25-000110");
    expect(findLatestProxy(recent, "2025-09-26")!.accession).toBe("0001-25-000110"); // same day: eligible
    expect(findLatestProxy(recent, "2025-09-25")!.accession).toBe("0001-24-000110");
    expect(findLatestProxy(recent, "2024-01-01")).toBeNull();
  });
});
