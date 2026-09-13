import { readRawText } from "../raw";
import { htmlToText, extractCoverShares } from "@/lib/edgar/filing-text";
import type { FactPack } from "../schema";

const FILE = "edgar-primary.html";
export const READS = [FILE] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] =
  [{ field: "quote.sharesOutstanding", endpoint: "edgar primary document (cover page)", source: "edgar" }];

export function mapCover(dir: string): { sharesOutstanding: number | null } {
  const html = readRawText(dir, FILE);
  const text = htmlToText(html);
  const sharesOutstanding = extractCoverShares(text);
  return { sharesOutstanding };
}
