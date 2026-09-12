/** Shared EDGAR plumbing. SEC requires a descriptive User-Agent and ≤10 req/s. */
export type FetchLike = typeof fetch;

export function edgarHeaders(contact: string): Record<string, string> {
  return { "User-Agent": `juniresearch/0.1 (${contact})`, Accept: "application/json" };
}

export async function edgarJson<T>(url: string, contact: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: edgarHeaders(contact) });
  if (!res.ok) throw new Error(`EDGAR responded ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function edgarText(url: string, contact: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl(url, { headers: { ...edgarHeaders(contact), Accept: "text/html" } });
  if (!res.ok) throw new Error(`EDGAR responded ${res.status} for ${url}`);
  return res.text();
}

export const EDGAR_MIN_INTERVAL_MS = 120; // ≤ 10 requests/second with margin
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
