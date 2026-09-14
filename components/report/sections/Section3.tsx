import { Markdown, MD } from "../Markdown";
import { FinTable } from "../FinTable";
import { ScenarioTable } from "../ScenarioTable";
import { Section } from "../Section";
import { stepFor } from "../report-steps";
import { Src } from "../Src";
import type { Report } from "@/lib/report.schema";

const STEP = stepFor(3);

export function Section3({ data }: { data: Report["sections"]["valuation"] }) {
  return (
    <Section title={STEP.title} id={STEP.id}>
      <h3>3.1 Multiples Analysis</h3>
      <FinTable table={data.multiples} />
      {data.multiples.note && <Src><MD>{data.multiples.note}</MD></Src>}
      <Markdown text={data.multiplesCommentary} />
      <h3>3.2 Scenario Summary</h3>
      <ScenarioTable scenarios={data.scenarios} />
      <Markdown text={data.scenarioCommentary} />
    </Section>
  );
}
