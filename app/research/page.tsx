import type { Metadata } from "next";
import { ReportIndexList } from "@/components/report/ReportIndexList";
import { ThemeToggle } from "@/components/theme-toggle";
import { listReports } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Equity Research — Juniper Finance",
  description: "Automated equity research reports.",
};

export default async function ResearchIndex() {
  const reports = await listReports();
  return (
    <>
      <ThemeToggle />
      <main className="mx-auto max-w-[900px] px-7 pt-11 pb-20">
        <div className="font-sans text-xs font-bold tracking-[2.5px] text-accent">
          EQUITY RESEARCH
        </div>
        <h1 className="mt-1.5 font-display text-[42px] leading-[1.08] font-semibold text-ink">
          Juniper Finance
        </h1>
        <p className="font-display text-[21px] italic text-muted">
          Automated equity research, generated from filings.
        </p>
        <hr className="my-3.5 border-0 border-t border-accent" />
        <ReportIndexList reports={reports} />
      </main>
    </>
  );
}
