import { Markdown } from "../Markdown";
import { Section } from "../Section";
import { stepFor } from "../report-steps";
import type { Report } from "@/lib/report.schema";

const STEP = stepFor(6);

export function Section6({ data }: { data: Report["sections"]["management"] }) {
  return (
    <Section title={STEP.title} id={STEP.id}>
      <Markdown text={data.leadership} />
      <Markdown text={data.capitalAllocation} />
      <Markdown text={data.governance} />
      {data.insiderOwnership && <Markdown text={data.insiderOwnership} />}
    </Section>
  );
}
