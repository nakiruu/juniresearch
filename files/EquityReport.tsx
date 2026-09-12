"use client";
/*
 * EquityReport.tsx — Juniper Finance equity report, rendered ENTIRELY from the
 * JSON contract (lib/report.schema.ts). No per-report prose or numbers live here;
 * swap `data` for any ticker the pipeline emits.
 *
 *   <EquityReport data={avgo} />
 *
 * The presentational primitives (Snapshot / RatingBlock / StatTable / Callout)
 * are plain styled elements so this renders standalone. In the live app they map
 * 1:1 onto shadcn/ui — see README.md ("shadcn mapping").
 */
import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import type { Report, FinancialTable } from "../lib/report.schema";
import {
  usd, pct, compactUSD, upside, formatCell, formatSnapshot,
  priceTargetLine, upsideRangeText, computeScenarios,
} from "../lib/format";
import { Markdown, MD } from "./Markdown";
import { ProjectionChart, buildChartModel } from "./ProjectionChart";

/* ---------------------------- theme tokens ---------------------------- */
const FONTS = {
  display: "'Cormorant Garamond','EB Garamond',Georgia,serif",
  sans: "'Inter','Helvetica Neue',Arial,sans-serif",
  mono: "'JetBrains Mono',ui-monospace,monospace",
};
const THEMES: Record<"dark" | "light", any> = {
  dark: {
    primary: "#eae9dc", secondary: "#9ca08b", accent: "#7fb083",
    neutral: "#2f342a", surface: "#191c16", page: "#12140f",
    bull: "#8fc48a", bear: "#d68a5f", ...FONTS,
  },
  light: {
    primary: "#23241d", secondary: "#6b6d5f", accent: "#315438",
    neutral: "#dcdbcb", surface: "#eeece0", page: "#f5f3e9",
    bull: "#4a7a52", bear: "#a24a30", ...FONTS,
  },
};

const DEFAULT_DISCLAIMER =
  "DISCLAIMER: This report is for informational/educational purposes only and does not " +
  "constitute investment advice. Technology and AI-infrastructure stocks carry significant risk " +
  "and volatility. Past performance is not indicative of future results. Conduct your own due " +
  "diligence. The author may hold positions in securities discussed.";

/* --------------------------- presentational bits --------------------------- */
function Snapshot({ pairs }: { pairs: { k: string; v: string }[] }) {
  const rows: ({ k: string; v: string } | undefined)[][] = [];
  for (let i = 0; i < pairs.length; i += 2) rows.push([pairs[i], pairs[i + 1]]);
  return (
    <table className="snap"><tbody>
      {rows.map((row, i) => (
        <tr key={i}>
          <td className="k">{row[0]!.k}</td><td className="v">{row[0]!.v}</td>
          <td className="k">{row[1] ? row[1].k : ""}</td><td className="v">{row[1] ? row[1].v : ""}</td>
        </tr>
      ))}
    </tbody></table>
  );
}

function RatingBlock({
  rating, current, upsideLabel,
}: { rating: Report["rating"]; current: number; upsideLabel: string }) {
  return (
    <div className="ratingwrap">
      <div className="ratingbox" style={{ background: `var(--${rating.tone})` }}>{rating.label}</div>
      <div className="ratingcells">
        <div className="rcell">{priceTargetLine(rating.targetLow, rating.targetHigh)}</div>
        <div className="rcell b">{upsideLabel} {upsideRangeText(rating.targetLow, rating.targetHigh, current)}</div>
      </div>
    </div>
  );
}

function StatTable({
  head, rows, className = "",
}: { head: React.ReactNode[]; rows: React.ReactNode[][]; className?: string }) {
  return (
    <div className="tbl-wrap">
      <table className={`stat ${className}`}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Renders a FinancialTable from the contract, formatting every numeric cell. */
function FinTable({ table }: { table: FinancialTable }) {
  const rows: React.ReactNode[][] = table.rows.map((r) => [
    r.label,
    ...r.values.map((v) => formatCell(v, r.format)),
  ]);
  const emph = table.rows.some((r) => r.emphasize) ? "emph-last" : "";
  return <StatTable head={table.columns} rows={rows} className={emph} />;
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <><h2>{title}</h2>{children}</>
);
const Src = ({ children }: { children: React.ReactNode }) => <div className="src">{children}</div>;

/* ------------------------------ the report ------------------------------ */
export default function EquityReport({ data }: { data: Report }) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const t = THEMES[mode];
  const cur = data.quote.currentPrice;
  const s = data.sections;

  const cssVars = {
    "--primary": t.primary, "--secondary": t.secondary, "--accent": t.accent,
    "--neutral": t.neutral, "--surface": t.surface, "--page": t.page,
    "--bull": t.bull, "--bear": t.bear,
    "--display": FONTS.display, "--sans": FONTS.sans, "--mono": FONTS.mono,
  } as React.CSSProperties;

  const m = data.meta;
  const snapshotPairs = data.snapshot.map((c) => ({ k: c.label, v: formatSnapshot(c) }));
  const footNote1 = `Report Date: ${m.reportDate} | Analyst: ${m.analyst}`;
  const footNote2 =
    `Fiscal Year End: ${m.fiscalYearEnd} | Figures in ${m.currency} | ` +
    `Auto-generated from Form ${m.filing.form} (${m.filing.fiscalPeriod}, filed ${m.filing.filedDate})`;
  const prepared =
    `Prepared by ${m.analyst} | ${m.reportDate} | ${m.analystName} | ` +
    `Auto-generated from Form ${m.filing.form} (accession ${m.filing.accession})`;

  // Scenario table with project-computed weighted values + fair value.
  const sc = computeScenarios(s.valuation.scenarios);
  const scenarioRows: React.ReactNode[][] = [
    ...sc.rows.map((r) => [
      r.name, <MD key={r.name}>{r.driver}</MD>, usd(r.impliedPrice, 0),
      pct(r.probability, { dp: 0 }), usd(r.weighted, 2),
    ]),
    ["Probability-Weighted Fair Value", "", "", "", usd(sc.fairValue, 2)],
  ];

  const a = data.analystSentiment;
  const sentimentRows: React.ReactNode[][] = [
    [`Consensus rating (${a.numAnalysts} analysts)`, a.consensusRating],
    ["Rating distribution", `${a.buy} Buy / ${a.hold} Hold / ${a.sell} Sell`],
    ["Consensus price target", usd(a.consensusTarget)],
    ["Median target", usd(a.medianTarget)],
    ["High / Low target", `${usd(a.highTarget)} / ${usd(a.lowTarget)}`],
    ["Implied upside to consensus",
      <span className="pos" key="u">{pct(upside(a.consensusTarget, cur), { signed: true })}</span>],
  ];

  const bm = s.businessMoat;
  const geoLine =
    `By geography${bm.geographyBasis ? ` (${bm.geographyBasis})` : ""}: ` +
    bm.geoMix.map((g) => `${g.region} ~${pct(g.sharePct, { dp: 0 })}`).join(", ") + ".";

  return (
    <div className="report-page" style={cssVars}>
      <style>{CSS}</style>

      <button className="mode-toggle" onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        aria-label="Toggle color mode">
        {mode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        {mode === "dark" ? "Linen" : "Forest Night"}
      </button>

      <div className="report-wrap">
        <div className="eyebrow">EQUITY RESEARCH</div>
        <h1 className="title">{m.company} ({m.exchange}: {m.ticker})</h1>
        <div className="subtitle">{m.subtitle}</div>
        <hr className="rule" />

        <Snapshot pairs={snapshotPairs} />
        <RatingBlock rating={data.rating} current={cur} upsideLabel="Upside Potential:" />

        <div className="chartcap"><ProjectionChart t={t} chart={buildChartModel(data)} /></div>
        <div className="foot-note">{footNote1}</div>
        <div className="foot-note">{footNote2}</div>

        {/* 1 — Executive Summary */}
        <Section title="1. Executive Summary">
          <h3>Company Overview</h3>
          <Markdown text={s.executiveSummary.companyOverview} />
          <div className="callout">
            <span className="lead">Investment Thesis — {s.executiveSummary.thesis.label}.</span>{" "}
            <MD>{s.executiveSummary.thesis.body}</MD>
          </div>
          <h3>Key Positive Catalysts</h3>
          <ul>{s.executiveSummary.catalysts.map((c, i) => <li key={i}><MD>{c}</MD></li>)}</ul>
          <h3>Major Risks</h3>
          <ul>{s.executiveSummary.risks.map((r, i) => <li key={i}><MD>{r}</MD></li>)}</ul>
        </Section>

        {/* 2 — Financials */}
        <Section title="2. Financial Performance & Health">
          <h3>2.1 Income Statement Analysis</h3>
          <FinTable table={s.financials.income} />
          {s.financials.income.note && <Src><MD>{s.financials.income.note}</MD></Src>}
          <Markdown text={s.financials.incomeCommentary} />

          <h3>2.2 Balance Sheet Analysis</h3>
          <FinTable table={s.financials.balance} />
          {s.financials.balance.note && <Src><MD>{s.financials.balance.note}</MD></Src>}
          <Markdown text={s.financials.balanceCommentary} />

          <h3>2.3 Cash Flow Analysis</h3>
          <FinTable table={s.financials.cashflow} />
          {s.financials.cashflow.note && <Src><MD>{s.financials.cashflow.note}</MD></Src>}
          <Markdown text={s.financials.cashflowCommentary} />
        </Section>

        {/* 3 — Valuation */}
        <Section title="3. Valuation">
          <h3>3.1 Multiples Analysis</h3>
          <FinTable table={s.valuation.multiples} />
          {s.valuation.multiples.note && <Src><MD>{s.valuation.multiples.note}</MD></Src>}
          <Markdown text={s.valuation.multiplesCommentary} />

          <h3>3.2 Scenario Summary</h3>
          <StatTable
            className="emph-last"
            head={["Scenario", "Driver", "Implied Price", "Prob.", "Weighted"]}
            rows={scenarioRows}
          />
          <Markdown text={s.valuation.scenarioCommentary} />
        </Section>

        {/* 4 — Business Model & Moat */}
        <Section title="4. Business Model & Competitive Moat">
          <h3>Business Segments{bm.segmentsBasis ? ` (${bm.segmentsBasis})` : ""}</h3>
          <ul>
            {bm.segments.map((seg, i) => (
              <li key={i}>
                <strong>{seg.name} (~{pct(seg.sharePct, { dp: 0 })}, ${(seg.revenue / 1e9).toFixed(1)}B):</strong>{" "}
                <MD>{seg.body}</MD>
              </li>
            ))}
          </ul>
          <p className="src">{geoLine}</p>
          <h3>Economic Moat: {bm.moatRating}</h3>
          <ul>
            {bm.moatFactors.map((f, i) => (
              <li key={i}><strong>{f.name} ({f.strength}):</strong> <MD>{f.body}</MD></li>
            ))}
          </ul>
          <Markdown text={bm.durability} />
        </Section>

        {/* 5 — Growth & Outlook */}
        <Section title="5. Growth Strategy & Future Outlook">
          <ul>{s.growth.points.map((p, i) => <li key={i}><MD>{p}</MD></li>)}</ul>
        </Section>

        {/* 6 — Management & Governance */}
        <Section title="6. Management & Governance">
          <Markdown text={s.management.leadership} />
          <Markdown text={s.management.capitalAllocation} />
          <Markdown text={s.management.governance} />
          {s.management.insiderOwnership && <Markdown text={s.management.insiderOwnership} />}
        </Section>

        {/* 7 — Risk Analysis */}
        <Section title="7. Risk Analysis">
          <h3>Idiosyncratic Risks</h3>
          {s.risks.idiosyncratic.map((r, i) => <p key={i}><MD>{r}</MD></p>)}
          <h3>Systemic Risks</h3>
          <Markdown text={s.risks.systemic} />
        </Section>

        {/* Analyst Sentiment Summary */}
        <Section title="Analyst Sentiment Summary">
          <StatTable head={["Metric", "Value"]} rows={sentimentRows} />
          <Src>Source: Bigdata.com / FMP aggregated analyst data, as of {m.asOf}.</Src>
          <Markdown text={a.commentary} />
        </Section>

        {/* 8 — Final Recommendation */}
        <Section title="8. Final Recommendation">
          <RatingBlock rating={data.rating} current={cur} upsideLabel="Upside:" />
          {s.finalRecommendation.body.map((p, i) => <Markdown key={i} text={p} />)}
        </Section>

        <div className="disc">{data.disclaimer ?? DEFAULT_DISCLAIMER}</div>
        <div className="prepared">{prepared}</div>
      </div>
    </div>
  );
}

/* -------------------------------- styles -------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,600&family=EB+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap');

.report-page *{ box-sizing:border-box; }
.report-page{
  background:var(--page); color:var(--primary); font-family:var(--sans);
  font-size:15px; line-height:1.6; min-height:100vh;
  transition:background .25s ease, color .25s ease;
}
.report-wrap{ max-width:900px; margin:0 auto; padding:44px 28px 80px; }

.mode-toggle{
  position:fixed; top:16px; right:16px; z-index:50;
  display:flex; align-items:center; gap:7px;
  font-family:var(--sans); font-size:12.5px; font-weight:600; color:var(--secondary);
  background:var(--surface); border:1px solid var(--neutral); border-radius:8px;
  padding:7px 11px; cursor:pointer; transition:color .2s ease, background .2s ease;
}
.mode-toggle:hover{ color:var(--primary); }

.eyebrow{ color:var(--accent); font-weight:700; letter-spacing:2.5px; font-size:12px; }
h1.title{ font-family:var(--display); text-align:center; font-size:42px; font-weight:600; margin:6px 0 2px; color:var(--primary); line-height:1.08; }
.subtitle{ font-family:var(--display); text-align:center; font-size:21px; font-style:italic; color:var(--secondary); margin:0 0 14px; }
hr.rule{ border:none; border-top:1px solid var(--accent); margin:14px 0; }
h2{ font-size:19px; font-weight:700; color:var(--accent); margin:30px 0 10px; padding-bottom:4px; border-bottom:1px solid var(--accent); }
h3{ font-size:15.5px; font-weight:600; color:var(--primary); margin:16px 0 4px; }
h4{ font-size:14px; font-weight:600; color:var(--primary); margin:12px 0 4px; }
p{ margin:0 0 10px; text-align:justify; }
ul{ margin:4px 0 10px; padding-left:18px; } li{ margin-bottom:4px; line-height:1.55; }
.pos{ color:var(--bull); font-weight:700; } .neg{ color:var(--bear); font-weight:700; }

table.snap{ border-collapse:collapse; width:100%; font-family:var(--mono); margin:8px 0; }
table.snap td{ border:none; border-bottom:1px solid var(--neutral); padding:6px 10px 6px 0; font-size:13px; text-align:right; }
table.snap td:first-child{ text-align:left; }
table.snap .k{ color:var(--secondary); font-family:var(--sans); font-size:12.5px; width:22%; }
table.snap .v{ color:var(--primary); font-weight:700; text-align:left; width:28%; }

.ratingwrap{ display:flex; margin:16px 0 6px; }
.ratingbox{ color:var(--page); font-weight:800; font-size:26px; font-family:var(--sans); width:34%; display:flex; align-items:center; justify-content:center; padding:14px; letter-spacing:2px; }
.ratingcells{ width:66%; display:flex; flex-direction:column; }
.rcell{ border:1px solid var(--neutral); border-left:none; background:var(--surface); padding:12px 16px; font-weight:700; font-size:15px; flex:1; display:flex; align-items:center; color:var(--primary); }
.rcell.b{ border-top:none; }

.chartcap{ margin:14px 0 4px; }
.foot-note{ text-align:center; color:var(--secondary); font-style:italic; font-size:12px; margin:3px 0; }

.tbl-wrap{ overflow-x:auto; }
table.stat{ border-collapse:collapse; width:100%; font-family:var(--mono); font-size:12.5px; margin:8px 0 4px; }
table.stat th, table.stat td{ border:1px solid var(--neutral); padding:6px 10px; text-align:right; }
table.stat th{ color:var(--primary); font-weight:700; border-top:none; border-bottom:2px solid var(--primary); font-family:var(--sans); font-size:12px; }
table.stat th:first-child, table.stat td:first-child{ text-align:left; }
table.stat tbody tr:nth-child(even){ background:var(--surface); }
table.stat.emph-last tbody tr:last-child{ font-weight:700; }

.callout{ background:var(--surface); border:1px solid var(--neutral); padding:12px 15px; margin:12px 0; }
.lead{ font-weight:700; }
.src{ color:var(--secondary); font-style:italic; font-size:11px; font-family:var(--sans); margin:2px 0 12px; }
.disc{ color:var(--secondary); font-style:italic; font-size:11px; text-align:center; margin-top:22px; border-top:1px solid var(--neutral); padding-top:12px; font-family:var(--sans); line-height:1.5; }
.prepared{ color:var(--secondary); font-style:italic; font-size:12px; text-align:center; margin-top:6px; font-family:var(--sans); }
`;
