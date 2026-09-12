import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Snapshot } from "@/components/report/Snapshot";
import { RatingBlock } from "@/components/report/RatingBlock";
import { FinTable } from "@/components/report/FinTable";
import { ScenarioTable } from "@/components/report/ScenarioTable";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const report = Report.parse(avgo);

describe("Snapshot", () => {
  it("formats every cell through format.ts", () => {
    render(<Snapshot cells={report.snapshot} />);
    expect(screen.getByText("~$1.72T")).toBeInTheDocument();
    expect(screen.getByText("$509.61 (+40.8%)")).toBeInTheDocument();
    expect(screen.getByText("68% (record)")).toBeInTheDocument();
  });

  it("lays cells out two pairs to a row", () => {
    const { container } = render(<Snapshot cells={report.snapshot} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(
      Math.ceil(report.snapshot.length / 2),
    );
  });
});

describe("RatingBlock", () => {
  it("shows the call, the target line and the derived upside", () => {
    render(<RatingBlock rating={report.rating} current={361.99} upsideLabel="Upside Potential:" />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("Price Target: $440.00 – $525.00")).toBeInTheDocument();
    expect(screen.getByText(/\+21\.6% to \+45\.0%/)).toBeInTheDocument();
  });

  it("colours the badge from the rating tone", () => {
    render(<RatingBlock rating={report.rating} current={361.99} upsideLabel="Upside:" />);
    expect(screen.getByText("BUY").className).toContain("bg-bull");
  });
});

describe("FinTable", () => {
  it("formats numeric cells by the row's format", () => {
    render(<FinTable table={report.sections.financials.income} />);
    expect(screen.getByText("63.9")).toBeInTheDocument();
  });

  it("renders every column header", () => {
    render(<FinTable table={report.sections.financials.income} />);
    for (const c of report.sections.financials.income.columns) {
      expect(screen.getByText(c)).toBeInTheDocument();
    }
  });
});

describe("ScenarioTable", () => {
  it("derives the weighted column and the fair value row", () => {
    render(<ScenarioTable scenarios={report.sections.valuation.scenarios} />);
    expect(screen.getByText("$180.00")).toBeInTheDocument();
    expect(screen.getByText("Probability-Weighted Fair Value")).toBeInTheDocument();
    expect(screen.getByText("$485.00")).toBeInTheDocument();
  });

  it("shows probabilities as whole percentages", () => {
    render(<ScenarioTable scenarios={report.sections.valuation.scenarios} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
