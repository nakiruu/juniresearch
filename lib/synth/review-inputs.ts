/**
 * review-inputs.ts — the inputs a review read, as three hashes the editorial gate compares.
 * -----------------------------------------------------------------------------
 * judgmentSha256 binds a review to the judgment text; this binds it to the data the renderers drew the reviewer's
 * surface from: the Facts block and the report's chart (facts), desk.rating (calls), and the Context excerpts (context).
 * The hashes cover data, never rendered text, so a renderer wording change stales nothing; validate still re-grounds
 * the prose on the re-rendered surface at every build. Unrendered pack fields (beta, sbc, goodwill, shibuiCheck,
 * provenance, capturedAt, …) and the rest of the desk are left out on purpose. Plan: 2026-10-08-review-fingerprint.md.
 *
 * Scheme 1 freezes the field picks and the canonical form, not the projection code beneath them. When a pin in
 * review-inputs.test.ts fails, the commit that moved it decides one of:
 *   - the change was not meant to move what reviewers saw: fix the change;
 *   - accept it: update the pins, run grounding:sweep, and list the reports whose reviews go stale in the message;
 *   - change the picks: add them under scheme 2, keep the scheme-1 functions, and let inputsUnder dispatch on the
 *     scheme each review recorded.
 * A renderer that starts reading a new field fails the completeness test; the fix is a new scheme, never an edit here.
 */
import { createHash } from "node:crypto";
import type { FactPack, Excerpt } from "../facts/schema";
import { projectReportFacts, type ReportFacts } from "../facts/project";
import type { Desk } from "./desk.schema";

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Key-sorted JSON; undefined dropped; -0 → 0; finite numbers rounded to 12 significant digits (re-derivation noise). */
export function canon(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) v = Number(v.toPrecision(12));
  if (v === null || typeof v !== "object") return typeof v === "number" && Object.is(v, -0) ? "0" : JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canon(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}

/** Exactly the data renderFactsBlock reads, plus the closes on the report's price chart. */
export function factsInputs(facts: ReportFacts, pack: FactPack) {
  const bm = facts.sections.businessMoat, a = facts.analystSentiment, e = pack.estimates, t = pack.ttm, lq = pack.latestQuarter, q = pack.quote;
  return {
    snapshot: facts.snapshot,
    tables: [facts.sections.financials.income, facts.sections.financials.balance, facts.sections.financials.cashflow],
    estimates: { nextFY: { label: e.nextFY.label, revenue: e.nextFY.revenue, eps: e.nextFY.eps }, followingFY: { label: e.followingFY.label, revenue: e.followingFY.revenue, eps: e.followingFY.eps } },
    ttm: { grossMargin: t.grossMargin, operatingMargin: t.operatingMargin, netMargin: t.netMargin, netDebtToEbitda: t.netDebtToEbitda, interestCoverage: t.interestCoverage, fcfYield: t.fcfYield, currentRatio: t.currentRatio },
    latestQuarter: { label: lq.label, periodEnd: lq.periodEnd, revenue: lq.revenue, operatingMargin: lq.operatingMargin, revenueYoY: lq.revenueYoY },
    multiples: facts.sections.valuation.multiplesCompanyColumn.map((m) => ({ label: m.label, value: m.value })),
    analysts: { numAnalysts: a.numAnalysts, buy: a.buy, hold: a.hold, sell: a.sell, consensusRating: a.consensusRating, consensusTarget: a.consensusTarget, medianTarget: a.medianTarget, lowTarget: a.lowTarget, highTarget: a.highTarget },
    segments: { basis: bm.segmentsBasis, items: bm.segments.map((s) => ({ name: s.name, sharePct: s.sharePct, revenue: s.revenue })) },
    geography: { basis: bm.geographyBasis, items: bm.geoMix.map((g) => ({ region: g.region, sharePct: g.sharePct })) },
    quote: { price: q.price, asOf: q.asOf, week52Low: q.week52Low, week52High: q.week52High, marketCap: q.marketCap, sharesOutstanding: q.sharesOutstanding, sharesSource: q.sharesSource, dividendYield: q.dividendYield },
    highlightCells: facts.highlightCells,
    history: facts.quote.history,
  };
}

/** Exactly the data renderContextBlock reads. */
export function contextInputs(pack: FactPack) {
  const c = pack.context;
  const ex = (x: Excerpt | null) => (x ? { text: x.text, source: x.source, asOf: x.asOf, truncated: !!x.truncated } : null);
  return {
    description: ex(c.description), mda: ex(c.mdaExcerpt), risk: ex(c.riskFactorsExcerpt), pressRelease: ex(c.pressRelease),
    proxy: ex(c.proxyStatement), transcript: ex(c.transcriptHighlights), headlines: c.headlines.map((h) => ({ asOf: h.asOf, source: h.source, text: h.text })),
  };
}

/** Exactly the data renderCalls reads. */
export const callsInputs = (desk: Pick<Desk, "rating">) => desk.rating;

export const COMPONENTS = ["facts", "calls", "context"] as const;
export type Component = (typeof COMPONENTS)[number];
export interface ReviewInputs { scheme: 1; facts: string; calls: string; context: string }

export function reviewInputs(pack: FactPack, desk: Pick<Desk, "rating">, facts: ReportFacts = projectReportFacts(pack)): ReviewInputs {
  return {
    scheme: 1,
    facts: sha256(canon(factsInputs(facts, pack))),
    calls: sha256(canon(callsInputs(desk))),
    context: sha256(canon(contextInputs(pack))),
  };
}

/** The one-line JSON the reviewer copies: prompt.md's `Inputs fingerprint:` line and the brief's copy block print this. */
export const inputsLine = (i: ReviewInputs) => JSON.stringify({ scheme: i.scheme, facts: i.facts, calls: i.calls, context: i.context });

/** The current inputs under the scheme a review recorded, so an old review keeps comparing on what its reviewer saw. */
export function inputsUnder(scheme: number, pack: FactPack, desk: Pick<Desk, "rating">, facts?: ReportFacts): ReviewInputs {
  if (scheme === 1) return reviewInputs(pack, desk, facts);
  throw new Error(`unknown review inputs scheme ${scheme}`);
}

export const changedComponents = (a: Pick<ReviewInputs, Component>, b: Pick<ReviewInputs, Component>): Component[] =>
  COMPONENTS.filter((k) => a[k] !== b[k]);

/** The calls stamp of a review that read the retired pre-1ea28c5 envelope: never equal to a real hash, so always stale. */
export const LEGACY_ENVELOPE_CALLS = sha256(canon({ legacyEnvelope: "pre-1ea28c5" }));
