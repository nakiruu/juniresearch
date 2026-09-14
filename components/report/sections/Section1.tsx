import { Markdown, MD } from "../Markdown";
import { Callout } from "../Callout";
import { Section } from "../Section";
import { stepFor } from "../report-steps";
import type { Report } from "@/lib/report.schema";

const STEP = stepFor(1);

export function Section1({ data }: { data: Report["sections"]["executiveSummary"] }) {
  return (
    <Section title={STEP.title} id={STEP.id}>
      <h3>Company Overview</h3>
      <Markdown text={data.companyOverview} />
      <Callout label={data.thesis.label} body={data.thesis.body} />
      <h3>Key Positive Catalysts</h3>
      <ul>{data.catalysts.map((c, i) => <li key={i}><MD>{c}</MD></li>)}</ul>
      <h3>Major Risks</h3>
      <ul>{data.risks.map((r, i) => <li key={i}><MD>{r}</MD></li>)}</ul>
    </Section>
  );
}
