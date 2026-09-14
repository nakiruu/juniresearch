import { MD } from "../Markdown";
import { Section } from "../Section";
import { stepFor } from "../report-steps";
import type { Report } from "@/lib/report.schema";

const STEP = stepFor(5);

export function Section5({ data }: { data: Report["sections"]["growth"] }) {
  return (
    <Section title={STEP.title} id={STEP.id}>
      <ul>{data.points.map((p, i) => <li key={i}><MD>{p}</MD></li>)}</ul>
    </Section>
  );
}
