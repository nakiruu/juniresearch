import { notFound } from "next/navigation";
import type { Metadata } from "next";
import EquityReport from "@/components/report/EquityReport";
import { ThemeToggle } from "@/components/theme-toggle";
import { listReportTickers, loadReport } from "@/lib/reports";

export const dynamicParams = false;

export async function generateStaticParams() {
  const tickers = await listReportTickers();
  return tickers.map((ticker) => ({ ticker }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Metadata> {
  const { ticker } = await params;
  const report = await loadReport(ticker);
  if (!report) return { title: "Report not found — Juniper Finance" };
  return {
    title: `${report.meta.company} (${report.meta.ticker}) — Juniper Finance`,
    description: report.meta.subtitle,
  };
}

export default async function ReportPage(
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const report = await loadReport(ticker);
  if (!report) notFound();
  return (
    <>
      <ThemeToggle />
      <EquityReport data={report} />
    </>
  );
}
