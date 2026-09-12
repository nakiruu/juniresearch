import { Markdown } from "../Markdown";
import { RatingBlock } from "../RatingBlock";
import { Section } from "../Section";
import type { Report } from "@/lib/report.schema";

export function Section8({
  data, rating, current,
}: {
  data: Report["sections"]["finalRecommendation"];
  rating: Report["rating"];
  current: number;
}) {
  return (
    <Section title="8. Final Recommendation">
      <RatingBlock rating={rating} current={current} upsideLabel="Upside:" />
      {data.body.map((p, i) => <Markdown key={i} text={p} />)}
    </Section>
  );
}
