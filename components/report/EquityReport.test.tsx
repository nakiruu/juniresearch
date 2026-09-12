import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EquityReport from "@/components/report/EquityReport";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

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

  it("captions the placeholder history line", () => {
    render(<EquityReport data={report} />);
    expect(screen.getByText(/history line is indicative/i)).toBeInTheDocument();
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
});
