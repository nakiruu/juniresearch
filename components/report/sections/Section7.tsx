import { Markdown, MD } from "../Markdown";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section7({ data }: { data: Report["sections"]["risks"] }) {
  return (
    <Section title="7. Risk Analysis">
      <h3>Idiosyncratic Risks</h3>
      {data.idiosyncratic.map((r, i) => <p key={i}><MD>{r}</MD></p>)}
      <h3>Systemic Risks</h3>
      <Markdown text={data.systemic} />
    </Section>
  );
}
