import { MD } from "../Markdown";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section5({ data }: { data: Report["sections"]["growth"] }) {
  return (
    <Section title="5. Growth Strategy & Future Outlook">
      <ul>{data.points.map((p, i) => <li key={i}><MD>{p}</MD></li>)}</ul>
    </Section>
  );
}
