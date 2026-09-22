import type { Report } from "@/lib/report.schema";

// Three minimal reports exercising: a strong BUY, a second BUY that also lands on the
// wMax cap (joint-cap with STRONG, not dust — see pipeline.test.ts), and a HOLD (excluded).
// Only the fields the pipeline reads are populated.
export function fixtureReport(o: {
  ticker: string; label: Report["rating"]["label"]; conviction: number;
  scenarios: [number, number][]; // [impliedPrice, probability] Bull, Base, Bear
}): Report {
  const [bull, base, bear] = o.scenarios;
  return {
    meta: { ticker: o.ticker, company: `${o.ticker} Co`, reportDate: "September 1, 2026",
            filing: { accession: "x" } },
    rating: { label: o.label,
      conviction: { expectedUpside: 0, bearDownside: 0, rewardRisk: 0, derivedLabel: o.label },
      gate: { sector: "industrial", gatedLabel: o.label },
      decision: { conviction: o.conviction, moat: { width: "NARROW", trend: "STABLE" }, composite: { percentile: 50 } } },
    sections: { valuation: { scenarios: [
      { name: "Bull", impliedPrice: bull[0], probability: bull[1] },
      { name: "Base", impliedPrice: base[0], probability: base[1] },
      { name: "Bear", impliedPrice: bear[0], probability: bear[1] },
    ] } },
  } as unknown as Report;
}
