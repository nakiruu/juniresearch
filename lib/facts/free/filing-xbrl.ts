/**
 * Filing-level inline XBRL (iXBRL) parser + merger.
 *
 * SEC's aggregated `companyfacts` API can lag a just-filed 10-Q/10-K by days or weeks (see
 * docs/superpowers/specs/2026-09-16-sec-yahoo-free-factsource-design.md's free-source design).
 * Every filing `facts:prepare` captures includes the filing's own PRIMARY document
 * (`edgar-primary.html`) — and that document IS inline XBRL: the same facts companyfacts would
 * eventually carry, tagged directly in the filing HTML via `<ix:nonFraction>` elements and
 * `<xbrli:context>` period definitions. This module parses those with targeted regexes (no XML
 * dependency — the file is a few MB of otherwise-irrelevant markup; matches this repo's
 * dependency-light style) and merges the result into a `companyfacts`-shaped object, so
 * `sec.ts`'s existing concept-fallback and period-selection logic (mergeByPriority, YTD
 * reconstruction, latest-filed-wins) can consume it completely unchanged.
 *
 * Scope, deliberately narrow:
 *  - Only `us-gaap:*` concepts (companies' own extension concepts, and `dei:`/`srt:` facts,
 *    are never in sec.ts's concept maps, so there's nothing to gain by keeping them).
 *  - Only plain-USD-unit facts. A unit is "USD" when its `<xbrli:unit>` definition resolves to
 *    a bare `iso4217:USD` measure — not a divide/ratio unit like USD-per-share. EPS therefore
 *    keeps coming from companyfacts; sec.ts reads it as a `USD/shares`-unit series, and this
 *    module never emits one. This is the simplification the design spec explicitly allows,
 *    since a filing that's new enough to be missing from companyfacts for its income-statement
 *    and balance-sheet concepts is missing EPS too, but EPS isn't on the FactPack's critical
 *    path the way current-quarter revenue/margin are.
 *  - Only CONSOLIDATED (non-dimensioned) facts. A context with an `<xbrli:segment>` member (an
 *    FPL-only or NEER-only breakdown, a stock-class split, a VIE breakdown, ...) tags a
 *    dimensioned value, not the consolidated total sec.ts's concept map expects — mixing one in
 *    would silently corrupt a total with a subset.
 */

interface UnitEntry {
  start?: string;
  end: string;
  val: number;
  form: string;
  filed: string;
}

export interface FilingMeta {
  form: string;
  filed: string;
}

interface ContextInfo {
  start?: string;
  end: string;
  dimensioned: boolean;
}

// --- companyfacts JSON shape (loose; only the fields we read/write) --------
// Mirrors sec.ts's own CompanyFactsShape — a real companyfacts fetch, and a minimal test
// fixture, both satisfy this without needing `any`.

interface UsGaapConceptNode {
  units?: Record<string, UnitEntry[]>;
  [key: string]: unknown;
}

export interface CompanyFactsLike {
  facts?: {
    "us-gaap"?: Record<string, UsGaapConceptNode>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// --- context + unit definitions ---------------------------------------------
// Tolerates both the `xbrli:`-prefixed spelling every real filing uses and a bare, unprefixed
// spelling (some XBRL processors/generators normalize namespaces away).

const CONTEXT_RE = /<(?:xbrli:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
const START_DATE_RE = /<(?:xbrli:)?startDate>([^<]+)<\/(?:xbrli:)?startDate>/;
const END_DATE_RE = /<(?:xbrli:)?endDate>([^<]+)<\/(?:xbrli:)?endDate>/;
const INSTANT_RE = /<(?:xbrli:)?instant>([^<]+)<\/(?:xbrli:)?instant>/;
const SEGMENT_RE = /<(?:xbrli:)?segment\b/;

function parseContexts(html: string): Map<string, ContextInfo> {
  const contexts = new Map<string, ContextInfo>();
  for (const m of html.matchAll(CONTEXT_RE)) {
    const [, id, body] = m;
    const instant = body.match(INSTANT_RE)?.[1]?.trim();
    const start = body.match(START_DATE_RE)?.[1]?.trim();
    const end = instant ?? body.match(END_DATE_RE)?.[1]?.trim();
    if (!end) continue; // malformed/unrecognized period — nothing usable to key facts on
    contexts.set(id, {
      start: instant ? undefined : start,
      end,
      dimensioned: SEGMENT_RE.test(body),
    });
  }
  return contexts;
}

const UNIT_RE = /<(?:xbrli:)?unit\s+id="([^"]+)">([\s\S]*?)<\/(?:xbrli:)?unit>/g;
const MEASURE_RE = /<(?:xbrli:)?measure>([^<]+)<\/(?:xbrli:)?measure>/;
const DIVIDE_RE = /<(?:xbrli:)?divide\b/;

/** Unit ids whose definition resolves to plain `iso4217:USD` (not a divide/ratio unit). */
function parseUsdUnitIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(UNIT_RE)) {
    const [, id, body] = m;
    if (DIVIDE_RE.test(body)) continue; // e.g. USD/shares — a ratio, not plain USD
    const measure = body.match(MEASURE_RE)?.[1]?.trim();
    if (measure && /(?:^|:)usd$/i.test(measure)) ids.add(id);
  }
  return ids;
}

// --- facts -------------------------------------------------------------------
// Two alternatives in one pass (matchAll preserves document order across them): a self-closing
// tag (`<ix:nonFraction .../>`, always nil/empty — no text content to parse) and a paired tag
// (`<ix:nonFraction ...>text</ix:nonFraction>`, possibly with nested formatting tags inside the
// text, which are stripped below).
const FACT_RE = /<ix:nonFraction\b([^>]*?)\/>|<ix:nonFraction\b([^>]*?)>([\s\S]*?)<\/ix:nonFraction>/g;

function attr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/**
 * Parses a filing's inline XBRL into a concept → entries map in the exact shape `sec.ts`
 * consumes from `companyfacts.facts["us-gaap"][concept].units.USD`. Returns `{}` (a safe no-op
 * for `mergeFilingFacts`) if the document has no recognizable iXBRL facts at all.
 */
export function parseFilingXbrl(html: string, meta: FilingMeta): Record<string, UnitEntry[]> {
  const contexts = parseContexts(html);
  const usdUnitIds = parseUsdUnitIds(html);
  const out: Record<string, UnitEntry[]> = {};
  const seen = new Set<string>(); // dedup key: "concept|contextRef" — a fact commonly repeats
  // across the statement table, an XBRL-viewer-facing duplicate table, and footnote reconciliations.

  for (const m of html.matchAll(FACT_RE)) {
    const attrs = m[1] ?? m[2];
    const content = m[3]; // undefined for the self-closing alternative
    if (attrs == null || content == null) continue;

    const name = attr(attrs, "name");
    if (!name?.startsWith("us-gaap:")) continue;
    const concept = name.slice("us-gaap:".length);

    const contextRef = attr(attrs, "contextRef");
    const ctx = contextRef ? contexts.get(contextRef) : undefined;
    if (!ctx || ctx.dimensioned) continue; // unresolved context, or a segmented/non-consolidated value

    const unitRef = attr(attrs, "unitRef");
    if (!unitRef || !usdUnitIds.has(unitRef)) continue; // not a plain-USD fact (e.g. USD/shares, shares, MW, ...)

    const dedupeKey = `${concept}|${contextRef}`;
    if (seen.has(dedupeKey)) continue;

    const text = content
      .replace(/<[^>]*>/g, "") // strip nested formatting tags to get at the numeral
      .replace(/,/g, "")
      .trim();
    if (!text || /^nil$/i.test(text)) continue;

    const num = Number(text);
    if (!Number.isFinite(num)) continue;

    const scale = Number(attr(attrs, "scale") ?? "0");
    let val = num * 10 ** scale;
    if (attr(attrs, "sign") === "-") val = -val;

    seen.add(dedupeKey);
    const entry: UnitEntry = ctx.start
      ? { start: ctx.start, end: ctx.end, val, form: meta.form, filed: meta.filed }
      : { end: ctx.end, val, form: meta.form, filed: meta.filed };
    (out[concept] ??= []).push(entry);
  }

  return out;
}

/**
 * Appends each filing-parsed concept's entries onto `companyfacts.facts["us-gaap"][concept]
 * .units.USD`, creating the concept node (and, if the filing has no usable facts at all, doing
 * nothing) when absent. Never mutates the input — returns a new merged object built with
 * shallow copies down to the concept level.
 *
 * Deliberately does not dedup against companyfacts' own entries: sec.ts's per-period selection
 * (keepLatestFiled, keyed by `filed`) already resolves any overlap, and a filing fact's `filed`
 * date is always the actual filing's — later than anything companyfacts could have for the same
 * period — so an appended filing entry always wins ties for periods it covers.
 */
export function mergeFilingFacts(companyfacts: CompanyFactsLike, filingFacts: Record<string, UnitEntry[]>): CompanyFactsLike {
  const concepts = Object.keys(filingFacts);
  if (concepts.length === 0) return companyfacts;

  const prevFacts = companyfacts.facts ?? {};
  const prevGaap = prevFacts["us-gaap"] ?? {};
  const nextGaap: Record<string, UsGaapConceptNode> = { ...prevGaap };

  for (const concept of concepts) {
    const newEntries = filingFacts[concept];
    if (!newEntries.length) continue;
    const prevNode = nextGaap[concept] ?? {};
    const prevUnits = prevNode.units ?? {};
    const prevUsd = prevUnits.USD ?? [];
    nextGaap[concept] = {
      ...prevNode,
      units: { ...prevUnits, USD: [...prevUsd, ...newEntries] },
    };
  }

  return { ...companyfacts, facts: { ...prevFacts, "us-gaap": nextGaap } };
}
