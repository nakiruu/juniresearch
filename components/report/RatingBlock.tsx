import { Badge } from "@/components/ui/badge";
import { pct, priceTargetLine, rewardRiskText, upsideRangeText } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

const row = "flex flex-1 items-center border border-l-0 border-hairline bg-surface px-4 py-3 text-[15px] font-bold text-ink";

export function RatingBlock({
  rating, current, upsideLabel,
}: { rating: Report["rating"]; current: number; upsideLabel: string }) {
  const c = rating.conviction;
  // The 5-level scale collapses to two tones (bull / bear); a STRONG call is the
  // extreme of its tone, so give it a ring + tighter tracking so the conviction
  // reads at a glance without inventing a new colour.
  const isStrong = rating.label.startsWith("STRONG");
  return (
    <div className="my-4 flex">
      <Badge
        variant={rating.tone}
        className={`flex h-auto w-[34%] self-stretch flex-col items-center justify-center p-3.5 text-center font-sans text-[26px] font-extrabold leading-none tracking-[2px] ${
          isStrong ? "gap-1 ring-2 ring-inset ring-page/50" : ""
        }`}
      >
        {isStrong ? (
          <>
            <span className="text-[13px] font-bold tracking-[3px]">STRONG</span>
            <span>{rating.label.slice(7)}</span>
          </>
        ) : (
          rating.label
        )}
      </Badge>
      <div className="flex w-[66%] flex-col">
        <div className={row}>{priceTargetLine(rating.targetLow, rating.targetHigh)}</div>
        <div className={`${row} border-t-0`}>
          {upsideLabel} {upsideRangeText(rating.targetLow, rating.targetHigh, current)}
        </div>
        {c && (
          <div className={`${row} border-t-0`}>
            Expected upside {pct(c.expectedUpside, { signed: true })} · Bear case {pct(-c.bearDownside, { signed: true })} · Reward/risk {rewardRiskText(c.rewardRisk)}
          </div>
        )}
      </div>
    </div>
  );
}
