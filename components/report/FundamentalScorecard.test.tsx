import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FundamentalScorecard } from "@/components/report/FundamentalScorecard";
import type { Report } from "@/lib/report.schema";

const gate: NonNullable<Report["rating"]["gate"]> = {
  sector: "industrial",
  ceiling: "STRONG BUY",
  gatedLabel: "BUY",
  distress: "SAFE",
  piotroski: 7,
  accruals: "NEUTRAL",
  confidence: "high",
  flags: [],
};

const decision: NonNullable<Report["rating"]["decision"]> = {
  conviction: 72,
  tier: "high",
  proposed: "BUY",
  reasons: ["E/R proposed BUY"],
  advisories: [],
  moat: { width: "WIDE", trend: "STABLE", contingent: false, bearFloor: 0.25 },
  intrinsic: { marginOfSafety: 0.18, impliedGrowth: 0.08, achievableGrowth: 0.12 },
  composite: { percentile: 63.4, confidence: "high" },
  uncertainty: { tier: "medium", points: 3, drivers: ["target dispersion (+1)"] },
};

const base: Report["rating"] = { label: "BUY", tone: "bull", targetLow: 200, targetHigh: 260, gate, decision };

describe("FundamentalScorecard", () => {
  it("renders the header and the composed conviction score and tier", () => {
    render(<FundamentalScorecard rating={base} />);
    expect(screen.getByText(/Fundamental Read/i)).toBeInTheDocument();
    const meter = screen.getByRole("meter", { name: /conviction/i });
    expect(meter).toHaveAttribute("aria-valuenow", "72");
    expect(screen.getByText(/High confidence/i)).toBeInTheDocument();
  });

  it("summarises the gate — sector, distress and the Piotroski score for an industrial", () => {
    render(<FundamentalScorecard rating={base} />);
    expect(screen.getByText(/Industrial · Safe · Piotroski 7\/9/)).toBeInTheDocument();
  });

  it("renders the moat, intrinsic margin of safety, composite percentile and uncertainty tier", () => {
    render(<FundamentalScorecard rating={base} />);
    expect(screen.getByText(/Wide · Stable/)).toBeInTheDocument();
    expect(screen.getByText(/MoS \+18\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/63rd pct/)).toBeInTheDocument();
    expect(screen.getByText(/^Medium/)).toBeInTheDocument();
  });

  it("shows an em dash for an abstained layer (null moat / intrinsic / composite)", () => {
    const stripped: Report["rating"] = {
      ...base,
      decision: { ...decision, moat: null, intrinsic: null, composite: null },
    };
    render(<FundamentalScorecard rating={stripped} />);
    // Moat, Intrinsic and Composite rows each collapse to an em dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("surfaces advisories as a footnote when the layers annotate the call", () => {
    const annotated: Report["rating"] = {
      ...base,
      decision: {
        ...decision,
        advisories: ["author's published label HOLD differs from the composed BUY"],
      },
    };
    render(<FundamentalScorecard rating={annotated} />);
    expect(screen.getByText(/differs from the composed BUY/)).toBeInTheDocument();
  });

  it("renders nothing for a legacy report built without the decision block", () => {
    const legacy: Report["rating"] = { label: "BUY", tone: "bull", targetLow: 200, targetHigh: 260 };
    const { container } = render(<FundamentalScorecard rating={legacy} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides Piotroski for a non-industrial sector where it is not meaningful", () => {
    const bank: Report["rating"] = {
      ...base,
      gate: { ...gate, sector: "financial", distress: "NA", ceiling: "STRONG BUY" },
    };
    render(<FundamentalScorecard rating={bank} />);
    expect(screen.queryByText(/Piotroski/)).toBeNull();
    expect(screen.getByText(/^Financial/)).toBeInTheDocument();
  });
});
