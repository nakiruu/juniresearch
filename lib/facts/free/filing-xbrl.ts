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
 *  - Only two unit kinds: plain USD (a `<xbrli:unit>` definition resolving to a bare
 *    `iso4217:USD` measure) and USD/shares (a divide unit whose numerator measure is USD and
 *    denominator measure is shares — what the two EPS concepts are tagged with). Every other
 *    unit (raw shares, MW, ratios, ...) is dropped; sec.ts never reads them.
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

/** The only two unit kinds sec.ts ever reads a concept series under. */
export type FactUnit = "USD" | "USD/shares";

/**
 * Concept → unit → entries, mirroring companyfacts' own `facts["us-gaap"][concept].units[unit]`
 * nesting one level early, so `mergeFilingFacts` can append each unit's entries straight into
 * the matching bucket instead of guessing which one a bare entry belongs in.
 */
export type FilingFacts = Record<string, Partial<Record<FactUnit, UnitEntry[]>>>;

export interface FilingMeta {
  form: string;
  filed: string;
}

interface ContextInfo {
  start?: string;
  end: string;
  dimensioned: boolean;
  // When the context's SOLE segment dimension is us-gaap:StatementClassOfStockAxis, the member id it
  // pins (e.g. "us-gaap:CommonClassAMember"); undefined otherwise. Multi-share-class filers (Visa,
  // Alphabet) tag per-share concepts only under this axis — never un-dimensioned — so the headline
  // consolidated EPS is carried by the primary class's member and would otherwise be dropped as
  // "dimensioned". Used ONLY to recover EPS for the primary class (see parseFilingXbrl).
  soleClassOfStockMember?: string;
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
const EXPLICIT_MEMBER_RE = /<(?:xbrldi:)?explicitMember\s+dimension="([^"]+)"[^>]*>([^<]+)<\/(?:xbrldi:)?explicitMember>/g;
const CLASS_OF_STOCK_AXIS = "us-gaap:StatementClassOfStockAxis";

/** The member id when `body`'s only explicit dimension is the class-of-stock axis; undefined otherwise. */
function soleClassOfStockMember(body: string): string | undefined {
  const members = [...body.matchAll(EXPLICIT_MEMBER_RE)];
  if (members.length !== 1) return undefined; // no dimension, or more than one → not a pure class split
  const [, dimension, member] = members[0];
  return dimension.trim() === CLASS_OF_STOCK_AXIS ? member.trim() : undefined;
}

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
      soleClassOfStockMember: soleClassOfStockMember(body),
    });
  }
  return contexts;
}

const UNIT_RE = /<(?:xbrli:)?unit\s+id="([^"]+)">([\s\S]*?)<\/(?:xbrli:)?unit>/g;
const MEASURE_RE = /<(?:xbrli:)?measure>([^<]+)<\/(?:xbrli:)?measure>/;
const DIVIDE_RE = /<(?:xbrli:)?divide\b/;
const NUMERATOR_RE = /<(?:xbrli:)?unitNumerator>([\s\S]*?)<\/(?:xbrli:)?unitNumerator>/;
const DENOMINATOR_RE = /<(?:xbrli:)?unitDenominator>([\s\S]*?)<\/(?:xbrli:)?unitDenominator>/;

const isUsdMeasure = (measure: string | undefined) => !!measure && /(?:^|:)usd$/i.test(measure);
const isSharesMeasure = (measure: string | undefined) => !!measure && /(?:^|:)shares$/i.test(measure);

/**
 * Maps each `<xbrli:unit>` id to the `FactUnit` it resolves to: "USD" for a plain
 * `iso4217:USD` measure, "USD/shares" for a divide unit with a USD numerator and a shares
 * denominator (how EPS concepts are always tagged). Every other unit (raw shares, MW, ratios,
 * a divide unit that isn't USD/shares, ...) is absent from the map and its facts are dropped.
 */
function parseUnitKinds(html: string): Map<string, FactUnit> {
  const kinds = new Map<string, FactUnit>();
  for (const m of html.matchAll(UNIT_RE)) {
    const [, id, body] = m;
    if (DIVIDE_RE.test(body)) {
      const numerator = body.match(NUMERATOR_RE)?.[1]?.match(MEASURE_RE)?.[1]?.trim();
      const denominator = body.match(DENOMINATOR_RE)?.[1]?.match(MEASURE_RE)?.[1]?.trim();
      if (isUsdMeasure(numerator) && isSharesMeasure(denominator)) kinds.set(id, "USD/shares");
      continue;
    }
    const measure = body.match(MEASURE_RE)?.[1]?.trim();
    if (isUsdMeasure(measure)) kinds.set(id, "USD");
  }
  return kinds;
}

// --- facts -------------------------------------------------------------------
// Two alternatives in one pass (matchAll preserves document order across them): a self-closing
// tag (`<ix:nonFraction .../>`, always nil/empty — no text content to parse) and a paired tag
// (`<ix:nonFraction ...>text</ix:nonFraction>`, possibly with nested formatting tags inside the
// text, which are stripped below).
const FACT_RE = /<ix:nonFraction\b([^>]*?)\/>|<ix:nonFraction\b([^>]*?)>([\s\S]*?)<\/ix:nonFraction>/g;

// Multi-share-class filers (Visa, Alphabet) never tag a plain consolidated EPS: the headline
// diluted/basic per-share figure sits under the class-of-stock axis on the primary class's member,
// which by us-gaap convention is Class A. We recover that member's value for the EPS concepts ONLY —
// every other concept still requires a non-dimensioned (fully consolidated) context.
const PRIMARY_SHARE_CLASS = "us-gaap:CommonClassAMember";
const CLASS_SCOPED_EPS_CONCEPTS = new Set(["EarningsPerShareDiluted", "EarningsPerShareBasic"]);

function attr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/**
 * Parses a filing's inline XBRL into a concept → unit → entries map (see `FilingFacts`), each
 * unit's entries in the exact shape `sec.ts` consumes from
 * `companyfacts.facts["us-gaap"][concept].units[unit]`. Returns `{}` (a safe no-op for
 * `mergeFilingFacts`) if the document has no recognizable iXBRL facts at all.
 */
export function parseFilingXbrl(html: string, meta: FilingMeta): FilingFacts {
  const contexts = parseContexts(html);
  const unitKinds = parseUnitKinds(html);
  const out: FilingFacts = {};
  const seen = new Set<string>(); // dedup key: "concept|contextRef|unit" — a fact commonly
  // repeats across the statement table, an XBRL-viewer-facing duplicate table, and footnote
  // reconciliations (and, per an EDGAR rendering quirk, as an identical fact literally nested
  // inside another — see the "nested-duplicate" test).

  for (const m of html.matchAll(FACT_RE)) {
    const attrs = m[1] ?? m[2];
    const content = m[3]; // undefined for the self-closing alternative
    if (attrs == null || content == null) continue;

    const name = attr(attrs, "name");
    if (!name?.startsWith("us-gaap:")) continue;
    const concept = name.slice("us-gaap:".length);

    const contextRef = attr(attrs, "contextRef");
    const ctx = contextRef ? contexts.get(contextRef) : undefined;
    if (!ctx) continue; // unresolved context
    // A dimensioned context is a segmented/non-consolidated value, normally dropped. The sole
    // exception: the primary share class's EPS on the class-of-stock axis, which IS the consolidated
    // headline EPS for a multi-share-class filer (see CLASS_SCOPED_EPS_CONCEPTS above).
    const primaryClassEps = ctx.soleClassOfStockMember === PRIMARY_SHARE_CLASS && CLASS_SCOPED_EPS_CONCEPTS.has(concept);
    if (ctx.dimensioned && !primaryClassEps) continue;

    const unitRef = attr(attrs, "unitRef");
    const unit = unitRef ? unitKinds.get(unitRef) : undefined;
    if (!unit) continue; // not a USD or USD/shares fact (e.g. raw shares, MW, a ratio unit, ...)

    const dedupeKey = `${concept}|${contextRef}|${unit}`;
    if (seen.has(dedupeKey)) continue;

    const text = content
      .replace(/<[^>]*>/g, "") // strip nested formatting/nested-fact tags to get at the numeral
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
    const conceptBuckets = (out[concept] ??= {});
    (conceptBuckets[unit] ??= []).push(entry);
  }

  return out;
}

/**
 * Appends each filing-parsed concept's entries onto `companyfacts.facts["us-gaap"][concept]
 * .units[<unit>]` — "USD" for dollar facts, "USD/shares" for the two EPS concepts (never mixed:
 * EPS entries always land under "USD/shares", never "USD") — creating the concept node and/or
 * unit bucket (and, if the filing has no usable facts at all, doing nothing) when absent. Never
 * mutates the input — returns a new merged object built with shallow copies down to the unit
 * bucket level.
 *
 * Deliberately does not dedup against companyfacts' own entries: sec.ts's per-period selection
 * (keepLatestFiled, keyed by `filed`) already resolves any overlap, and a filing fact's `filed`
 * date is always the actual filing's — later than anything companyfacts could have for the same
 * period — so an appended filing entry always wins ties for periods it covers.
 */
export function mergeFilingFacts(companyfacts: CompanyFactsLike, filingFacts: FilingFacts): CompanyFactsLike {
  const concepts = Object.keys(filingFacts);
  if (concepts.length === 0) return companyfacts;

  const prevFacts = companyfacts.facts ?? {};
  const prevGaap = prevFacts["us-gaap"] ?? {};
  const nextGaap: Record<string, UsGaapConceptNode> = { ...prevGaap };

  for (const concept of concepts) {
    const byUnit = filingFacts[concept];
    const units = Object.keys(byUnit) as FactUnit[];
    if (units.length === 0) continue;

    const prevNode = nextGaap[concept] ?? {};
    const prevUnits = prevNode.units ?? {};
    const nextUnits: Record<string, UnitEntry[]> = { ...prevUnits };

    for (const unit of units) {
      const newEntries = byUnit[unit];
      if (!newEntries?.length) continue;
      const prevBucket = prevUnits[unit] ?? [];
      nextUnits[unit] = [...prevBucket, ...newEntries];
    }

    nextGaap[concept] = { ...prevNode, units: nextUnits };
  }

  return { ...companyfacts, facts: { ...prevFacts, "us-gaap": nextGaap } };
}
