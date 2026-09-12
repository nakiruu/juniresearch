import type { Report } from "@/lib/report.schema";

export function ReportHeader({ meta }: { meta: Report["meta"] }) {
  return (
    <header>
      <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">
        EQUITY RESEARCH
      </div>
      <h1 className="mt-1.5 mb-0.5 text-center font-display text-[42px] leading-[1.08] font-semibold text-ink">
        {meta.company} ({meta.exchange}: {meta.ticker})
      </h1>
      <div className="mb-3.5 text-center font-display text-[21px] italic text-muted">
        {meta.subtitle}
      </div>
      <hr className="my-3.5 border-0 border-t border-accent" />
    </header>
  );
}
