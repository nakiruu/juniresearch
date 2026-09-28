import { readRawText } from "../raw";
import { htmlToText, extractCoverShares } from "../../edgar/filing-text";
import type { FactPack } from "../schema";

const FILE = "edgar-primary.html";
export const READS = [FILE] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] =
  [{ field: "quote.sharesOutstanding", endpoint: "edgar primary document (cover page)", source: "edgar" }];

/** `primaryText` lets a caller that already converted edgar-primary.html (build.ts) skip a second htmlToText pass. */
export function mapCover(dir: string, primaryText?: string): { sharesOutstanding: number | null } {
  const text = primaryText ?? htmlToText(readRawText(dir, FILE));
  const sharesOutstanding = extractCoverShares(text);
  return { sharesOutstanding };
}
