/**
 * merge.ts — facts + judgment + desk → one Report.
 * -----------------------------------------------------------------------------
 * Everything derivable is set here, never taken from the judgment: rating tone,
 * thesis label, snapshot, quote, tables and their notes, identity, disclaimer.
 * Pure; the CLI validates the result before anything is written.
 */
import type { ReportFacts } from "../facts/project";
import type { Judgment, RatingLabel } from "./judgment.schema";
import type { Desk } from "./desk.schema";
import { SCHEMA_VERSION, type Report, type SnapshotCellData } from "../report.schema";
import { computeConviction, deriveLabel } from "./conviction";
import { applyGateCeiling, type GateResult } from "./gates";

export const toneFor = (label: RatingLabel): Report["rating"]["tone"] =>
  label === "HOLD" ? "secondary" : label.endsWith("BUY") ? "bull" : "bear";

const fmt = (ymd: string, month: "long" | "short") =>
  new Date(ymd + "T00:00:00Z").toLocaleDateString("en-US", { month, day: "numeric", year: "numeric", timeZone: "UTC" });
export const longDate = (ymd: string): string => fmt(ymd, "long");
export const shortDate = (ymd: string): string => fmt(ymd, "short");

export function mergeReport(
  facts: ReportFacts, j: Judgment, desk: Desk, buildDate: string, gate?: GateResult, decision?: Report["rating"]["decision"],
): Report {
  const note = `Source: Bigdata.com company tearsheet (FMP); fiscal years ended ${j.meta.fiscalYearEnd}.`;
  const bodies = new Map(j.sections.businessMoat.segments.map((s) => [s.name, s.body]));
  const f = facts.sections;
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      company: facts.meta.company, ticker: facts.meta.ticker, exchange: facts.meta.exchange,
      subtitle: j.meta.subtitle, reportDate: longDate(buildDate), asOf: shortDate(facts.meta.asOf),
      analyst: desk.analyst, analystName: desk.analystName, fiscalYearEnd: j.meta.fiscalYearEnd, currency: "USD",
      filing: facts.meta.filing,
    },
    quote: facts.quote,
    rating: (() => {
      const c = computeConviction(j.sections.valuation.scenarios, facts.quote.currentPrice);
      const derivedLabel = deriveLabel(c, desk.rating);
      const gateBlock = gate
        ? {
            sector: gate.sector, ceiling: gate.ceiling, gatedLabel: applyGateCeiling(derivedLabel, gate.ceiling),
            distress: gate.distress.zone, piotroski: gate.piotroski.score, accruals: gate.accruals.flag,
            confidence: gate.confidence, flags: gate.flags,
          }
        : undefined;
      return { label: j.rating.label, tone: toneFor(j.rating.label), targetLow: j.rating.targetLow, targetHigh: j.rating.targetHigh,
        conviction: { ...c, derivedLabel }, ...(gateBlock ? { gate: gateBlock } : {}), ...(decision ? { decision } : {}) };
    })(),
    // The model's chosen highlight keys (up to four) resolve to fact-built cells, in the order chosen,
    // appended after the sixteen code-owned cells. mergeReport runs before validateJudgment (see
    // scripts/synth-build.ts), so `.filter(Boolean)` here is the merge-time guard against a duplicate or
    // unavailable key; validateJudgment's highlightIssues turns the same condition into a build failure.
    snapshot: [...facts.snapshot, ...(j.highlights ?? []).map((k) => facts.highlightCells[k]).filter((c): c is SnapshotCellData => c != null)],
    analystSentiment: { ...facts.analystSentiment, commentary: j.analystCommentary },
    sections: {
      executiveSummary: {
        companyOverview: j.sections.executiveSummary.companyOverview,
        thesis: { label: j.rating.label, body: j.sections.executiveSummary.thesis.body },
        catalysts: j.sections.executiveSummary.catalysts, risks: j.sections.executiveSummary.risks,
      },
      financials: {
        income: { ...f.financials.income, note }, incomeCommentary: j.sections.financials.incomeCommentary,
        balance: { ...f.financials.balance, note }, balanceCommentary: j.sections.financials.balanceCommentary,
        cashflow: { ...f.financials.cashflow, note }, cashflowCommentary: j.sections.financials.cashflowCommentary,
      },
      valuation: {
        multiples: {
          columns: ["Multiple (TTM)", facts.meta.ticker],
          rows: f.valuation.multiplesCompanyColumn.map((m) => ({ label: m.label, values: [m.value], format: "mult" as const })),
          note: "Peer multiples pending a peer data source.",
        },
        multiplesCommentary: j.sections.valuation.multiplesCommentary,
        scenarios: j.sections.valuation.scenarios,
        scenarioCommentary: j.sections.valuation.scenarioCommentary,
      },
      businessMoat: {
        // Largest segment first — the FactPack keeps the vendor's key order, the page reads by weight.
        segments: [...f.businessMoat.segments].sort((a, b) => b.sharePct - a.sharePct).map((s) => ({ ...s, body: bodies.get(s.name) ?? "" })),
        segmentsBasis: f.businessMoat.segmentsBasis, geographyBasis: f.businessMoat.geographyBasis, geoMix: f.businessMoat.geoMix,
        moatRating: j.sections.businessMoat.moatRating, moatFactors: j.sections.businessMoat.moatFactors, durability: j.sections.businessMoat.durability,
      },
      growth: j.sections.growth,
      management: j.sections.management,
      risks: j.sections.risks,
      finalRecommendation: j.sections.finalRecommendation,
    },
    disclaimer: desk.disclaimer,
  };
}
