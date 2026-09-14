import { Markdown, MD } from "../Markdown";
import { Section } from "../Section";
import { stepFor } from "../report-steps";
import { compactUSD, pct } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

const STEP = stepFor(4);

export function Section4({ data }: { data: Report["sections"]["businessMoat"] }) {
  const geoLine =
    `By geography${data.geographyBasis ? ` (${data.geographyBasis})` : ""}: ` +
    data.geoMix.map((g) => `${g.region} ~${pct(g.sharePct, { dp: 0 })}`).join(", ") + ".";
  return (
    <Section title={STEP.title} id={STEP.id}>
      <h3>Business Segments{data.segmentsBasis ? ` (${data.segmentsBasis})` : ""}</h3>
      <ul>
        {data.segments.map((s) => (
          <li key={s.name}>
            <strong>{s.name} (~{pct(s.sharePct, { dp: 0 })}, {compactUSD(s.revenue)}):</strong>{" "}
            <MD>{s.body}</MD>
          </li>
        ))}
      </ul>
      <p className="font-sans text-[11px] italic text-muted">{geoLine}</p>
      <h3>Economic Moat: {data.moatRating}</h3>
      <ul>
        {data.moatFactors.map((f) => (
          <li key={f.name}><strong>{f.name} ({f.strength}):</strong> <MD>{f.body}</MD></li>
        ))}
      </ul>
      <Markdown text={data.durability} />
    </Section>
  );
}
