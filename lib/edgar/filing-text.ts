/**
 * filing-text.ts — turn an EDGAR primary document into two capped excerpts.
 * -----------------------------------------------------------------------------
 * The filing HTML is simple enough for hand-rolled stripping. Section headings
 * appear twice — once in the table of contents, once in the body — so we take,
 * for each heading, the candidate whose section is longest.
 */
import { edgarText, type FetchLike } from "./client";

export const EXCERPT_CAP = 8000;
// MD&A opens with cautionary language and a 10-Q's substantive discussion routinely starts past 8k; Risk Factors keep EXCERPT_CAP.
export const MDA_CAP = 16000;
// the call's headline metrics routinely sit past 8k of the ranked chunks; Risk Factors keep EXCERPT_CAP.
export const TRANSCRIPT_CAP = 16000;
export const PRESS_CAP = 16000; // an earnings release is ~30k chars; the headline metrics are in the first half

const COVER_RE = [
  /outstanding\s+as\s+of\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}[^0-9]{0,40}?(\d{1,3}(?:,\d{3}){2,3})/i,
  /had\s+(\d{1,3}(?:,\d{3}){2,3})\s+shares[^.]{0,80}?outstanding/i,
  /(\d{1,3}(?:,\d{3}){2,3})\s+shares\s+of[^.]{0,80}?outstanding/i,
];

export function extractCoverShares(text: string): number | null {
  const head = text.slice(0, 30000);
  for (const re of COVER_RE) {
    const m = re.exec(head);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (n >= 1e8) return n;
    }
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|br|td|th)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function capAtSentence(text: string, cap = EXCERPT_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  const slice = text.slice(0, cap);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"), slice.lastIndexOf(".") === slice.length - 1 ? slice.length - 1 : -1);
  const cut = end > cap * 0.5 ? slice.slice(0, end + 1) : slice;
  return { text: cut.trim(), truncated: true };
}

interface SectionSpec { item: string; title: RegExp; until: string[] }

function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a section-title matcher tolerant of spurious spaces inside words.
 * Some filings render headings with letter-spaced inline spans, and
 * htmlToText joins adjacent spans with a space, turning "Risk Factors"
 * into "R isk Factors". A real word gap (the space in the plain-string
 * input) becomes `\s+`; every intra-word gap becomes optional (`\s*`).
 * An apostrophe stays tolerant via `.{0,5}`, matching the historical
 * "management's discussion" behavior (handles missing/curly apostrophes).
 */
function titlePattern(title: string): RegExp {
  const words = title.split(" ");
  const wordPatterns = words.map((word) =>
    word
      .split("'")
      .map((part) => [...part].map(escapeRegExpChar).join("\\s*"))
      .join(".{0,5}"),
  );
  return new RegExp(wordPatterns.join("\\s+"), "i");
}

const SPECS: Record<"10-Q" | "10-K", { mda: SectionSpec; riskFactors: SectionSpec }> = {
  "10-Q": {
    mda: { item: "2", title: titlePattern("management's discussion"), until: ["3", "4"] },
    riskFactors: { item: "1A", title: titlePattern("risk factors"), until: ["2", "3", "4", "5", "6"] },
  },
  "10-K": {
    mda: { item: "7", title: titlePattern("management's discussion"), until: ["7A", "8"] },
    riskFactors: { item: "1A", title: titlePattern("risk factors"), until: ["1B", "1C", "2"] },
  },
};

function headingRegex(item: string): RegExp {
  return new RegExp(`(^|\\n)\\s*item\\s+${item}\\.?\\s`, "gi");
}

/** Longest candidate wins: the TOC entry is short, the body is long. */
function extractItem(text: string, spec: SectionSpec): string | null {
  const heads = [...text.matchAll(headingRegex(spec.item))].map((m) => m.index! + (m[1]?.length ?? 0));
  let best: string | null = null;
  for (const start of heads) {
    const after = text.slice(start, start + 300);
    if (!spec.title.test(after)) continue;
    let end = text.length;
    for (const nxt of spec.until) {
      const m = headingRegex(nxt).exec(text.slice(start + 50));
      if (m) end = Math.min(end, start + 50 + m.index + (m[1]?.length ?? 0));
    }
    const body = text.slice(start, end).trim();
    if (!best || body.length > best.length) best = body;
  }
  return best && best.length > 200 ? best : null;
}

export interface CappedSection { text: string; truncated: boolean }

/** Uncapped longest-candidate bodies — for comparing two documents' sections by their real length before either is truncated. */
export function extractRawSections(text: string, form: "10-Q" | "10-K"): { mda: string | null; riskFactors: string | null } {
  const spec = SPECS[form];
  return { mda: extractItem(text, spec.mda), riskFactors: extractItem(text, spec.riskFactors) };
}

export function extractSections(text: string, form: "10-Q" | "10-K"): { mda: CappedSection | null; riskFactors: CappedSection | null } {
  const { mda, riskFactors } = extractRawSections(text, form);
  return {
    mda: mda ? capAtSentence(mda, MDA_CAP) : null,
    riskFactors: riskFactors ? capAtSentence(riskFactors) : null,
  };
}

export async function fetchPrimaryDocument(url: string, contact: string, fetchImpl: FetchLike = fetch): Promise<string> {
  return edgarText(url, contact, fetchImpl);
}
