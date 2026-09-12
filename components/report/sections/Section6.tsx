import { Markdown } from "../Markdown";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section6({ data }: { data: Report["sections"]["management"] }) {
  return (
    <Section title="6. Management & Governance">
      <Markdown text={data.leadership} />
      <Markdown text={data.capitalAllocation} />
      <Markdown text={data.governance} />
      {data.insiderOwnership && <Markdown text={data.insiderOwnership} />}
    </Section>
  );
}
