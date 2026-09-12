import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportIndexList } from "@/components/report/ReportIndexList";
import type { ReportSummary } from "@/lib/reports";

const summaries: ReportSummary[] = [
  {
    ticker: "AVGO", company: "Broadcom Inc.", exchange: "NASDAQ",
    subtitle: "Custom Silicon at the Center of the AI Buildout",
    reportDate: "September 12, 2026",
    rating: { label: "BUY", tone: "bull", targetLow: 440, targetHigh: 525 },
    currentPrice: 361.99,
  },
];

describe("ReportIndexList", () => {
  it("links each report to its route by lowercase ticker", () => {
    render(<ReportIndexList reports={summaries} />);
    expect(screen.getByRole("link", { name: /Broadcom/ })).toHaveAttribute("href", "/research/avgo");
  });

  it("shows the call and the formatted target range", () => {
    render(<ReportIndexList reports={summaries} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("$440.00 – $525.00")).toBeInTheDocument();
  });

  it("explains itself when the archive is empty", () => {
    render(<ReportIndexList reports={[]} />);
    expect(screen.getByText(/no reports yet/i)).toBeInTheDocument();
  });
});
