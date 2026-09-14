/**
 * EquityReport.tsx — the whole report, rendered from the JSON contract.
 * -----------------------------------------------------------------------------
 * Synchronous Server Component: no per-report prose or numbers live here. Swap
 * `data` for any ticker the pipeline emits.
 */
import { ProjectionChart } from "@/components/chart/ProjectionChart";
import { buildChartModel } from "@/components/chart/geometry";
import { ReportHeader } from "./ReportHeader";
import { Snapshot } from "./Snapshot";
import { RatingBlock } from "./RatingBlock";
import { Section1 } from "./sections/Section1";
import { Section2 } from "./sections/Section2";
import { Section3 } from "./sections/Section3";
import { Section4 } from "./sections/Section4";
import { Section5 } from "./sections/Section5";
import { Section6 } from "./sections/Section6";
import { Section7 } from "./sections/Section7";
import { Section8 } from "./sections/Section8";
import { AnalystSentiment } from "./sections/AnalystSentiment";
import { ReportStepper } from "./ReportStepper";
import { REPORT_STEPS } from "./report-steps";
import type { Report } from "@/lib/report.schema";

const DEFAULT_DISCLAIMER =
  "DISCLAIMER: This report is for informational/educational purposes only and does not " +
  "constitute investment advice. Technology and AI-infrastructure stocks carry significant risk " +
  "and volatility. Past performance is not indicative of future results. Conduct your own due " +
  "diligence. The author may hold positions in securities discussed.";

export default function EquityReport({ data }: { data: Report }) {
  const { meta: m, quote, rating, sections: s } = data;
  const current = quote.currentPrice;
  const chartModel = buildChartModel(data);

  return (
    <>
    <div className="report-prose mx-auto max-w-[900px] px-7 pt-11 pb-28 min-[1280px]:pb-20">
      <ReportHeader meta={m} />
      <Snapshot cells={data.snapshot} />
      <RatingBlock rating={rating} current={current} upsideLabel="Upside Potential:" />

      <figure className="my-3.5">
        <div className="hidden md:block">
          <ProjectionChart model={chartModel} layout="wide" />
        </div>
        <div className="md:hidden">
          <ProjectionChart model={chartModel} layout="narrow" />
        </div>
        {chartModel.placeholder && (
          <figcaption className="mt-1 text-center font-sans text-[11px] italic text-muted">
            The history line is indicative; live daily closes are not yet wired.
          </figcaption>
        )}
      </figure>

      <div className="my-0.5 text-center font-sans text-xs italic text-muted">
        Report Date: {m.reportDate} | Analyst: {m.analyst}
      </div>
      <div className="my-0.5 text-center font-sans text-xs italic text-muted">
        Fiscal Year End: {m.fiscalYearEnd} | Figures in {m.currency} | Auto-generated from
        Form {m.filing.form} ({m.filing.fiscalPeriod}, filed {m.filing.filedDate})
      </div>

      <Section1 data={s.executiveSummary} />
      <Section2 data={s.financials} />
      <Section3 data={s.valuation} />
      <Section4 data={s.businessMoat} />
      <Section5 data={s.growth} />
      <Section6 data={s.management} />
      <Section7 data={s.risks} />
      <AnalystSentiment data={data.analystSentiment} current={current} asOf={m.asOf} />
      <Section8 data={s.finalRecommendation} rating={rating} current={current} />

      <div className="mt-6 border-t border-hairline pt-3 text-center font-sans text-[11px] italic leading-relaxed text-muted">
        {data.disclaimer ?? DEFAULT_DISCLAIMER}
      </div>
      <div className="mt-1.5 text-center font-sans text-xs italic text-muted">
        Prepared by {m.analyst} | {m.reportDate} | {m.analystName} | Auto-generated from
        Form {m.filing.form} (accession {m.filing.accession})
      </div>
    </div>
    {/* After the column on purpose: the stepper's sections are then already
        parsed when this client island hydrates, even on a streamed, slow load. */}
    <ReportStepper steps={REPORT_STEPS} />
    </>
  );
}
