import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProjectionChart } from "@/components/chart/ProjectionChart";
import { buildChartModel } from "@/components/chart/geometry";
import { Report } from "@/lib/report.schema";
import avgo from "@/lib/__fixtures__/avgo-golden.json";

const model = buildChartModel(Report.parse(avgo));
const renderWide = () => render(<ProjectionChart model={model} layout="wide" />);

describe("ProjectionChart", () => {
  it("renders synchronously into markup, with no hydration required", () => {
    const { container } = renderWide();
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 960 480");
    expect(svg!.querySelectorAll("*").length).toBeGreaterThan(30);
  });

  it("takes colour from CSS variables so one SVG serves both themes", () => {
    const { container } = renderWide();
    const markup = container.innerHTML;
    expect(markup).toContain("var(--bull)");
    expect(markup).toContain("var(--bear)");
    expect(markup).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("labels every target and the current price", () => {
    const { container } = renderWide();
    const text = container.textContent ?? "";
    for (const label of ["High target", "Median target", "Consensus target", "Low target", "Current"]) {
      expect(text).toContain(label);
    }
  });

  it("captions the Juniper band with its derived range", () => {
    expect(renderWide().container.textContent).toContain("+21.6% to +45.0%");
  });

  it("draws one dashed ray per target", () => {
    const { container } = renderWide();
    expect(container.querySelectorAll("line[data-role='target-ray']")).toHaveLength(4);
  });

  it("omits the label column in the narrow layout", () => {
    const { container } = render(<ProjectionChart model={model} layout="narrow" />);
    expect(container.querySelectorAll("polyline[data-role='leader']")).toHaveLength(0);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 640 480");
  });

  it("renders the header rows left-aligned to the plot edge", () => {
    const text = renderWide().container.textContent ?? "";
    expect(text).toContain("EQUITY RESEARCH");
    expect(text).toContain("Broadcom Inc. · NASDAQ: AVGO");
    expect(text).toContain("as of Sep 11, 2026");
    expect(text).toContain("current $361.99");
  });

  it("keeps every element inside the canvas in both layouts", () => {
    for (const layout of ["wide", "narrow"] as const) {
      const { container } = render(<ProjectionChart model={model} layout={layout} />);
      const svg = container.querySelector("svg")!;
      const height = Number(svg.getAttribute("viewBox")!.split(" ")[3]);
      const ys = [...svg.querySelectorAll("text, rect")].map((el) => Number(el.getAttribute("y")));
      expect(Math.max(...ys)).toBeLessThanOrEqual(height);
    }
  });
});
