import { Markdown } from "../Markdown";
import { RatingBlock } from "../RatingBlock";
import { Section } from "../Section";
import { stepFor } from "../report-steps";
import type { Report } from "@/lib/report.schema";

const STEP = stepFor(8);

export function Section8({
  data, rating, current,
}: {
  data: Report["sections"]["finalRecommendation"];
  rating: Report["rating"];
  current: number;
}) {
  return (
    <Section title={STEP.title} id={STEP.id}>
      <RatingBlock rating={rating} current={current} upsideLabel="Upside:" />
      {data.body.map((p, i) => <Markdown key={i} text={p} />)}
    </Section>
  );
}
