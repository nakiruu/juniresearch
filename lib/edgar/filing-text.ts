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
/** Per-section budgets for the proxy statement excerpt (14k chars in all). */
export const PROXY_CAPS = { board: 3000, compensation: 5000, ownership: 4000, related: 2000 } as const;

const COVER_RE = [
  /outstanding\s+as\s+of\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}[^0-9]{0,40}?(\d{1,3}(?:,\d{3}){2,3})/i,
  /had\s+(\d{1,3}(?:,\d{3}){2,3})\s+shares[^.]{0,80}?outstanding/i,
  /(\d{1,3}(?:,\d{3}){2,3})\s+shares\s+of[^.]{0,80}?outstanding/i,
];

export function extractCoverShares(text: string): number | null {
  const head = text.slice(0, 30000);
  // The strict "outstanding as of <Month> <d>, <yyyy> ... N" pattern is specific enough to run over the
  // whole document: a 10-K's cover sentence can sit well past the head window, behind an XBRL/exhibit
  // preamble a 10-Q does not have. The two looser patterns stay scoped to the head window.
  const candidates = [
    { re: COVER_RE[0], scope: text },
    { re: COVER_RE[1], scope: head },
    { re: COVER_RE[2], scope: head },
  ];
  for (const { re, scope } of candidates) {
    const m = re.exec(scope);
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

// ---------------------------------------------------------------------------
// Proxy statement (DEF 14A). Proxies have no "Item N" skeleton, so sections are
// found by their titles at a line start. A title counts as a heading only when
// a paragraph follows it (contents entries — the document's, or a section's own
// mini contents — are followed by more short lines). Each section runs from its
// heading to the next such heading that does not belong inside it; if a title
// still matches more than once, the longest candidate wins.
// ---------------------------------------------------------------------------
export interface ProxySections { compensation: string | null; board: string | null; ownership: string | null; related: string | null }

interface ProxySpec { start: RegExp[]; keep: RegExp[] }

const PROXY_HEADINGS = {
  independence: titlePattern("director independence"),
  boardAndIndependence: titlePattern("board of directors and director independence"),
  boardIndependence: titlePattern("board independence"),
  independenceOfDirectors: titlePattern("independence of directors"),
  committees: titlePattern("board committees"),
  committeesOfTheBoard: titlePattern("committees of the board"),
  directorCompensation: titlePattern("director compensation"),
  cda: titlePattern("compensation discussion and analysis"),
  committeeReport: titlePattern("compensation committee report"),
  summaryTable: titlePattern("summary compensation table"),
  executiveTables: titlePattern("executive compensation tables"),
  payRatio: titlePattern("pay ratio"),
  ownership: titlePattern("security ownership of certain beneficial owners"),
  relatedTransactions: titlePattern("transactions with related persons"),
  relatedPersonTransactions: titlePattern("related person transactions"),
  relatedPartyTransactions: titlePattern("related party transactions"),
  certainRelationships: titlePattern("certain relationships and related party transactions"),
  meetingInformation: titlePattern("additional meeting information"),
  auditReport: titlePattern("audit committee report"),
  reportOfAudit: titlePattern("report of the audit committee"),
  delinquent: titlePattern("delinquent section 16"),
  section16: titlePattern("section 16(a)"),
  stockholderProposals: titlePattern("stockholder proposals"),
  shareholderProposals: titlePattern("shareholder proposals"),
  otherMatters: titlePattern("other matters"),
  householding: titlePattern("householding"),
};
const H = PROXY_HEADINGS;
const ALL_PROXY_HEADINGS = Object.values(H);

const PROXY_SPECS: Record<keyof ProxySections, ProxySpec> = {
  board: { start: [H.boardAndIndependence, H.independence, H.boardIndependence, H.independenceOfDirectors], keep: [H.committees, H.committeesOfTheBoard] },
  compensation: { start: [H.cda], keep: [] },
  ownership: { start: [H.ownership], keep: [] },
  // Its own budget: the ownership table and its footnotes fill that section, and the
  // related-party disclosure follows it in both proxies captured so far.
  related: { start: [H.relatedTransactions, H.relatedPersonTransactions, H.relatedPartyTransactions, H.certainRelationships], keep: [] },
};

function lineStart(re: RegExp): RegExp {
  return new RegExp(`(^|\\n)[ \\t]*(?:${re.source})`, "gi");
}

/** A title is a section heading only when prose follows it: a contents entry
 *  (the document's, or a section's own mini contents) is followed by a page
 *  number or another title, a real heading by a paragraph. Converted filings
 *  wrap prose at roughly 100 characters, so "prose" is judged by shape — a
 *  line of ten or more words with lowercase letters — not by length alone.
 *  A proxy whose body is set in capitals, or wrapped far narrower, would fail
 *  this test and yield no section (null), never a wrong one. */
function looksLikeProse(line: string): boolean {
  return line.length >= 60 && /[a-z]/.test(line) && line.split(/\s+/).length >= 10;
}
/** A short line with letters and no sentence punctuation: the rest of a title
 *  that was set over several lines ("SECURITY OWNERSHIP OF" / "CERTAIN
 *  BENEFICIAL OWNERS, DIRECTORS" / "AND EXECUTIVE OFFICERS"). */
function looksLikeTitleContinuation(line: string): boolean {
  return line.length <= 60 && /[A-Za-z]/.test(line) && !/[.;:]$/.test(line);
}

/** A short "Label:" line ("When:", "Where:", "Submitted by:") opens a body of
 *  label/value pairs — a contents entry is never followed by one. */
function looksLikeLabelLine(line: string): boolean {
  return /^[A-Za-z][^:]{0,40}:$/.test(line);
}

/** `headingAt` is the end of the matched title, so the first line examined is
 *  the one after the title's last word. Up to two title-continuation lines may
 *  sit between it and the prose; a bare page number means a contents entry. */
function headingFollowedByBody(text: string, headingAt: number): boolean {
  let lineEnd = text.indexOf("\n", headingAt);
  if (lineEnd < 0) return false;
  // A title never ends a sentence: "…related party transactions." at a line
  // start is prose that happens to begin with the words of a heading.
  const lineStartAt = text.lastIndexOf("\n", headingAt) + 1;
  if (/[.;]$/.test(text.slice(lineStartAt, lineEnd).trim())) return false;
  let continuations = 0;
  for (let i = 0; i < 6; i++) {
    const nextEnd = text.indexOf("\n", lineEnd + 1);
    const line = text.slice(lineEnd + 1, nextEnd < 0 ? undefined : nextEnd).trim();
    if (line.length > 0) {
      if (looksLikeProse(line) || looksLikeLabelLine(line)) return true;
      if (/^\d{1,3}$/.test(line)) return false;
      if (looksLikeTitleContinuation(line) && continuations < 2) { continuations++; }
      else return false;
    }
    if (nextEnd < 0) return false;
    lineEnd = nextEnd;
  }
  return false;
}

function extractProxySection(text: string, spec: ProxySpec): string | null {
  const enders = ALL_PROXY_HEADINGS.filter((h) => !spec.start.includes(h) && !spec.keep.includes(h)).map(lineStart);
  let best: string | null = null;
  for (const startRe of spec.start) {
    for (const m of text.matchAll(lineStart(startRe))) {
      const start = m.index! + (m[1]?.length ?? 0);
      // A contents entry (page numbers, short lines) is not where the section starts.
      if (!headingFollowedByBody(text, m.index! + m[0].length - 1)) continue;
      // Scan for the section's end from the line after its heading, so a long
      // title's own words never count as the ending heading.
      const headingEnd = text.indexOf("\n", start);
      const restAt = headingEnd < 0 ? text.length : headingEnd + 1;
      const rest = text.slice(restAt);
      let end = text.length;
      for (const e of enders) {
        e.lastIndex = 0;
        for (const em of rest.matchAll(e)) {
          const at = restAt + em.index! + (em[1]?.length ?? 0);
          if (at >= end) break;
          if (headingFollowedByBody(text, restAt + em.index! + em[0].length - 1)) { end = at; break; }
        }
      }
      const body = text.slice(start, end).trim();
      if (body.length > 200 && (!best || body.length > best.length)) best = body;
    }
  }
  return best;
}

/** Uncapped bodies of the four governance sections a report needs, or null where the proxy lacks one. */
export function extractProxySections(text: string): ProxySections {
  return {
    compensation: extractProxySection(text, PROXY_SPECS.compensation),
    board: extractProxySection(text, PROXY_SPECS.board),
    ownership: extractProxySection(text, PROXY_SPECS.ownership),
    related: extractProxySection(text, PROXY_SPECS.related),
  };
}

/** One labelled, per-section-capped excerpt (board, pay, ownership, related-party); null when nothing was found. */
export function proxyExcerpt(s: ProxySections): CappedSection | null {
  const parts: string[] = [];
  let truncated = false;
  const add = (label: string, body: string | null, cap: number) => {
    if (!body) return;
    const c = capAtSentence(body, cap);
    truncated = truncated || c.truncated;
    parts.push(`${label}:\n${c.text}`);
  };
  add("Board and director independence", s.board, PROXY_CAPS.board);
  add("Compensation discussion and analysis", s.compensation, PROXY_CAPS.compensation);
  add("Security ownership", s.ownership, PROXY_CAPS.ownership);
  add("Related-person transactions", s.related, PROXY_CAPS.related);
  return parts.length ? { text: parts.join("\n\n"), truncated } : null;
}
