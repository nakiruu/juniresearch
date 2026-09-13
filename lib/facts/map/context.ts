/**
 * context.ts — the prose half of the FactPack: filing excerpts and Bigdata context.
 * -----------------------------------------------------------------------------
 * Excerpts are bounded and sourced; nothing here is a number. The two Bigdata
 * search captures are optional — a pack without them is still valid.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readRawJson, readRawText, section } from "../raw";
import { htmlToText, extractSections, capAtSentence, type CappedSection } from "../../edgar/filing-text";
import type { Excerpt, FactPack } from "../schema";

const EDGAR_PRIMARY_FILE = "edgar-primary.html";
const TRANSCRIPT_FILE = "bigdata-transcript.json";
const HEADLINES_FILE = "bigdata-headlines.json";
export const READS = [EDGAR_PRIMARY_FILE, TRANSCRIPT_FILE, HEADLINES_FILE] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] = [
  { field: "context.mdaExcerpt", endpoint: "edgar primary document", source: "edgar" },
  { field: "context.riskFactorsExcerpt", endpoint: "edgar primary document", source: "edgar" },
  { field: "context.transcriptHighlights", endpoint: "bigdata_search", source: "bigdata" },
  { field: "context.headlines", endpoint: "bigdata_search", source: "bigdata" },
];

export const HEADLINE_LIMIT = 10;

interface SearchResult { headline?: string; timestamp?: string; source?: { name?: string }; chunks?: { cnum?: number; text?: string }[]; url?: string }

/** bigdata_search returns { results: [...] }; an absent file means the capture skipped it. */
function searchResults(dir: string, file: string): SearchResult[] {
  if (!existsSync(join(dir, file))) return [];
  return section<SearchResult[]>(readRawJson(dir, file), ["results"], file);
}

const sourceOf = (r: SearchResult) => `bigdata:${r.source?.name?.trim() || "search"}`;
const dayOf = (r: SearchResult, fallback: string) => (r.timestamp || fallback).slice(0, 10);

function headlinesFrom(results: SearchResult[], fallbackDay: string): Excerpt[] {
  return results
    .filter((r) => typeof r.headline === "string" && r.headline.trim().length > 10)
    .slice(0, HEADLINE_LIMIT)
    .map((r) => ({ text: r.headline!.trim(), source: sourceOf(r), asOf: dayOf(r, fallbackDay), ...(r.url ? { url: r.url } : {}) }));
}

/** Concatenate every chunk of every transcript result, in rank then chunk order, then cap at a sentence. */
function transcriptFrom(results: SearchResult[], fallbackDay: string): Excerpt | null {
  const first = results[0];
  if (!first) return null;
  const text = results
    .flatMap((r) => [...(r.chunks ?? [])].sort((a, b) => (a.cnum ?? 0) - (b.cnum ?? 0)).map((c) => c.text?.trim() ?? ""))
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  const capped = capAtSentence(text);
  return { text: capped.text, source: sourceOf(first), asOf: dayOf(first, fallbackDay), truncated: capped.truncated, ...(first.url ? { url: first.url } : {}) };
}

export function mapContext(
  dir: string,
  filing: { form: "10-Q" | "10-K"; url: string; filedDate: string },
  capturedAt: string,
  description: Excerpt,
): FactPack["context"] {
  const { mda, riskFactors } = extractSections(htmlToText(readRawText(dir, EDGAR_PRIMARY_FILE)), filing.form);
  const edgar = (s: CappedSection | null): Excerpt | null =>
    s ? { text: s.text, source: `edgar:${filing.form}`, url: filing.url, asOf: filing.filedDate, truncated: s.truncated } : null;
  const day = capturedAt.slice(0, 10);
  return {
    description,
    mdaExcerpt: edgar(mda),
    riskFactorsExcerpt: edgar(riskFactors),
    transcriptHighlights: transcriptFrom(searchResults(dir, TRANSCRIPT_FILE), day),
    headlines: headlinesFrom(searchResults(dir, HEADLINES_FILE), day),
  };
}
