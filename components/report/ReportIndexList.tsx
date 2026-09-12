import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { usd } from "@/lib/format";
import type { ReportSummary } from "@/lib/reports";

export function ReportIndexList({ reports }: { reports: ReportSummary[] }) {
  if (reports.length === 0) {
    return <p className="mt-8 text-muted">No reports yet.</p>;
  }
  return (
    <ul className="mt-6 border-t border-hairline">
      {reports.map((r) => (
        <li key={r.ticker} className="border-b border-hairline">
          <Link href={`/research/${r.ticker.toLowerCase()}`}
            className="flex flex-col gap-2 py-4 md:flex-row md:items-baseline md:gap-4">
            <Badge variant={r.rating.tone} className="w-fit px-2 py-0.5 font-sans text-[11px] font-bold tracking-wider">
              {r.rating.label}
            </Badge>
            <div className="flex-1">
              <div className="font-display text-[22px] font-semibold text-ink">
                {r.company} <span className="font-mono text-[13px] text-muted">
                  {r.exchange}: {r.ticker}
                </span>
              </div>
              <div className="font-sans text-[13px] text-muted">{r.subtitle}</div>
            </div>
            <div className="font-mono text-[12.5px] text-muted md:text-right">
              <div>{usd(r.rating.targetLow)} – {usd(r.rating.targetHigh)}</div>
              <div>{r.reportDate}</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
