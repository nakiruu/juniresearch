import { Badge } from "@/components/ui/badge";
import { priceTargetLine, upsideRangeText } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

export function RatingBlock({
  rating, current, upsideLabel,
}: { rating: Report["rating"]; current: number; upsideLabel: string }) {
  return (
    <div className="my-4 flex">
      <Badge
        variant={rating.tone}
        className="flex h-auto w-[34%] self-stretch items-center justify-center p-3.5 font-sans text-[26px] font-extrabold tracking-[2px]"
      >
        {rating.label}
      </Badge>
      <div className="flex w-[66%] flex-col">
        <div className="flex flex-1 items-center border border-l-0 border-hairline bg-surface px-4 py-3 text-[15px] font-bold text-ink">
          {priceTargetLine(rating.targetLow, rating.targetHigh)}
        </div>
        <div className="flex flex-1 items-center border border-t-0 border-l-0 border-hairline bg-surface px-4 py-3 text-[15px] font-bold text-ink">
          {upsideLabel} {upsideRangeText(rating.targetLow, rating.targetHigh, current)}
        </div>
      </div>
    </div>
  );
}
