import { FACTPACK_SCHEMA_VERSION } from "../schema";

export const excerpt = { text: "x", source: "fmp:profile-symbol", asOf: "2026-09-12T00:00:00Z" };
const row = (key: string) => ({ key, label: key, values: [1, 2, 3, 4, 5] });

export const minimalPack = (): Record<string, any> => ({
  schemaVersion: FACTPACK_SCHEMA_VERSION,
  ticker: "AVGO", cik: 1730168, company: "Broadcom Inc.", exchange: "NASDAQ",
  filing: { form: "10-Q", accession: "0001730168-26-000080", filedDate: "2026-09-10",
            periodEnd: "2026-08-02", url: "https://www.sec.gov/x" },
  capturedAt: "2026-09-12T15:00:00Z",
  quote: { price: 361.99, marketCap: 1.72e12, sharesOutstanding: 4.76e9,
           week52Low: 289.96, week52High: 495, dividendYield: 0.0072, asOf: "2026-09-11" },
  statements: { fiscalYears: ["FY21", "FY22", "FY23", "FY24", "FY25"],
                income: [row("revenue")], balance: [row("totalDebt")], cashflow: [row("freeCashFlow")] },
  latestQuarter: { label: "Q3'26", periodEnd: "2026-08-02", revenue: 2.96e10, operatingMargin: 0.68, revenueYoY: 0.86 },
  ttm: { pe: 44.9, ps: 19.3, evToEbitda: 33.6, grossMargin: 0.68, operatingMargin: 0.6, netMargin: 0.4 },
  estimates: { nextFY: { label: "FY26E", revenue: 1.059e11, eps: 12 }, followingFY: { label: "FY27E", revenue: 1.5e11, eps: 19 } },
  analysts: { count: 60, buy: 54, hold: 6, sell: 0, consensusRating: "Buy", consensusTarget: 509.61,
              medianTarget: 517.5, highTarget: 600, lowTarget: 350, asOf: "2026-09-12" },
  segments: { basis: "FY25", items: [{ name: "Semis", revenue: 3.69e10, share: 0.58 }, { name: "Software", revenue: 2.7e10, share: 0.42 }] },
  geoMix: { basis: "FY25", items: [{ region: "APAC", share: 0.56 }, { region: "Americas", share: 0.3 }, { region: "EMEA", share: 0.14 }] },
  peers: [{ ticker: "NVDA", pe: 40, ps: 24, evToEbitda: 36 }],
  history: [{ date: "2026-09-10", close: 360 }, { date: "2026-09-11", close: 361.99 }],
  context: { description: excerpt, mdaExcerpt: null, riskFactorsExcerpt: null, transcriptHighlights: null, headlines: [] },
  provenance: [{ field: "quote", source: "fmp", endpoint: "quote", capturedAt: "2026-09-12T15:00:00Z" }],
});
