/**
 * context.ts — the prose half of the FactPack: filing excerpts and Bigdata context.
 * -----------------------------------------------------------------------------
 * Excerpts are bounded and sourced; nothing here is a number. The two Bigdata
 * search captures are optional — a pack without them is still valid.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readRawJson, readRawText, section } from "../raw";
import { htmlToText, extractRawSections, capAtSentence, TRANSCRIPT_CAP, PRESS_CAP, MDA_CAP } from "../../edgar/filing-text";
import { PRESS_RELEASE_FILE, ANNUAL_PRIMARY_FILE } from "../manifest";
import type { Excerpt, FactPack } from "../schema";

const EDGAR_PRIMARY_FILE = "edgar-primary.html";
const TRANSCRIPT_FILE = "bigdata-transcript.json";
const HEADLINES_FILE = "bigdata-headlines.json";
export const READS = [EDGAR_PRIMARY_FILE, TRANSCRIPT_FILE, HEADLINES_FILE, PRESS_RELEASE_FILE, ANNUAL_PRIMARY_FILE] as const;
export const PROVENANCE: { field: string; endpoint: string; source: FactPack["provenance"][number]["source"] }[] = [
  { field: "context.mdaExcerpt", endpoint: "edgar primary document", source: "edgar" },
  { field: "context.riskFactorsExcerpt", endpoint: "edgar primary document (10-K wins for a 10-Q when it is the longer candidate)", source: "edgar" },
  { field: "context.pressRelease", endpoint: "edgar 8-K exhibit 99.1", source: "edgar" },
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
  const capped = capAtSentence(text, TRANSCRIPT_CAP);
  return { text: capped.text, source: sourceOf(first), asOf: dayOf(first, fallbackDay), truncated: capped.truncated, ...(first.url ? { url: first.url } : {}) };
}

/** Wrap an already-capped { text, truncated } as a sourced, dated Excerpt. */
function toExcerpt(capped: { text: string; truncated: boolean }, source: string, url: string | undefined, asOf: string): Excerpt {
  return { text: capped.text, source, url, asOf, truncated: capped.truncated };
}

export function mapContext(
  dir: string,
  filing: {
    form: "10-Q" | "10-K"; url: string; filedDate: string;
    pressRelease?: { url: string; filedDate: string } | null;
    annualReport?: { url: string; filedDate: string } | null;
  },
  capturedAt: string,
  description: Excerpt,
): FactPack["context"] {
  const own = extractRawSections(htmlToText(readRawText(dir, EDGAR_PRIMARY_FILE)), filing.form);
  const mdaExcerpt: Excerpt | null = own.mda
    ? toExcerpt(capAtSentence(own.mda, MDA_CAP), `edgar:${filing.form}`, filing.url, filing.filedDate)
    : null;

  // A 10-Q's own Item 1A is often a thin cross-reference to the prior 10-K; when a 10-K was also
  // captured, compare the RAW (uncapped) candidate lengths. Comparing already-capped text would let
  // the sentence-boundary cut point decide the winner instead of which document actually says more
  // (both candidates commonly exceed the cap, collapsing their capped lengths to near-identical values).
  let winnerRaw = own.riskFactors;
  let riskFactorsSource: FactPack["context"]["riskFactorsSource"] = own.riskFactors ? filing.form : null;
  let winnerSource = `edgar:${filing.form}`, winnerUrl: string | undefined = filing.url, winnerAsOf = filing.filedDate;
  if (filing.form === "10-Q" && existsSync(join(dir, ANNUAL_PRIMARY_FILE))) {
    const tenKRaw = extractRawSections(htmlToText(readRawText(dir, ANNUAL_PRIMARY_FILE)), "10-K").riskFactors;
    if (tenKRaw && (!winnerRaw || tenKRaw.length > winnerRaw.length)) {
      winnerRaw = tenKRaw;
      riskFactorsSource = "10-K";
      winnerSource = "edgar:10-K";
      winnerUrl = filing.annualReport?.url;
      winnerAsOf = filing.annualReport?.filedDate ?? filing.filedDate;
    }
  }
  const riskFactorsExcerpt: Excerpt | null = winnerRaw ? toExcerpt(capAtSentence(winnerRaw), winnerSource, winnerUrl, winnerAsOf) : null;

  const pressRelease: Excerpt | null = existsSync(join(dir, PRESS_RELEASE_FILE))
    ? toExcerpt(
        capAtSentence(htmlToText(readRawText(dir, PRESS_RELEASE_FILE)), PRESS_CAP),
        "edgar:8-K ex-99.1", filing.pressRelease?.url, filing.pressRelease?.filedDate ?? filing.filedDate,
      )
    : null;

  const day = capturedAt.slice(0, 10);
  return {
    description,
    mdaExcerpt,
    riskFactorsExcerpt,
    riskFactorsSource,
    pressRelease,
    transcriptHighlights: transcriptFrom(searchResults(dir, TRANSCRIPT_FILE), day),
    headlines: headlinesFrom(searchResults(dir, HEADLINES_FILE), day),
  };
}
