import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EquityReport from "@/components/report/EquityReport";
import { Report } from "@/lib/report.schema";
import avgo from "@/lib/__fixtures__/avgo-golden.json";

const report = Report.parse(avgo);

describe("EquityReport", () => {
  it("renders the whole report without throwing", () => {
    expect(() => render(<EquityReport data={report} />)).not.toThrow();
  });

  it("renders all eight numbered sections plus the sentiment summary", () => {
    render(<EquityReport data={report} />);
    for (const title of [
      "1. Executive Summary",
      "2. Financial Performance & Health",
      "3. Valuation",
      "4. Business Model & Competitive Moat",
      "5. Growth Strategy & Future Outlook",
      "6. Management & Governance",
      "7. Risk Analysis",
      "Analyst Sentiment Summary",
      "8. Final Recommendation",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("renders the chart once per layout", () => {
    const { container } = render(<EquityReport data={report} />);
    expect(container.querySelectorAll("svg[role='img']")).toHaveLength(2);
  });

  it("captions the history line while it is the placeholder", () => {
    render(<EquityReport data={{ ...report, quote: { ...report.quote, history: undefined } }} />);
    expect(screen.getByText(/history line is indicative/i)).toBeInTheDocument();
  });
  it("drops the placeholder caption when real history is present", () => {
    const closes = Array.from({ length: 25 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, close: 300 + i }));
    render(<EquityReport data={{ ...report, quote: { ...report.quote, history: closes } }} />);
    expect(screen.queryByText(/history line is indicative/i)).toBeNull();
  });

  it("falls back to the default disclaimer when none is supplied", () => {
    const stripped = { ...report, disclaimer: undefined };
    render(<EquityReport data={stripped} />);
    expect(screen.getByText(/does not constitute investment advice/i)).toBeInTheDocument();
  });

  it("shows the derived implied upside to consensus", () => {
    render(<EquityReport data={report} />);
    expect(screen.getAllByText("+40.8%").length).toBeGreaterThan(0);
  });

  it("colours a negative implied upside as a loss", () => {
    const bearish = {
      ...report,
      analystSentiment: { ...report.analystSentiment, consensusTarget: 300 },
    };
    render(<EquityReport data={bearish} />);
    const el = screen.getByText("-17.1%");
    expect(el.className).toContain("text-bear");
    expect(el.className).not.toContain("text-bull");
  });
});
