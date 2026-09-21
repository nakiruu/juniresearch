import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RatingBlock } from "@/components/report/RatingBlock";
import type { Report } from "@/lib/report.schema";

const base: Report["rating"] = { label: "BUY", tone: "bull", targetLow: 345, targetHigh: 455 };
const conviction = { expectedUpside: 0.105, bearDownside: 0.158, rewardRisk: 0.66, derivedLabel: "BUY" as const };

describe("RatingBlock conviction row", () => {
  it("renders expected upside, bear case and reward/risk when conviction is present", () => {
    render(<RatingBlock rating={{ ...base, conviction }} current={368.29} upsideLabel="Upside Potential:" />);
    expect(screen.getByText(/Expected upside \+10\.5% · Bear case -15\.8% · Reward\/risk 0\.66×/)).toBeInTheDocument();
    expect(screen.getByText(/Upside Potential: -6\.3% to \+23\.5%/)).toBeInTheDocument();
  });
  it("renders an em dash for a null reward/risk", () => {
    render(<RatingBlock rating={{ ...base, conviction: { ...conviction, rewardRisk: null } }} current={368.29} upsideLabel="Upside Potential:" />);
    expect(screen.getByText(/Reward\/risk —/)).toBeInTheDocument();
  });
  it("renders no third row for a report built without conviction", () => {
    render(<RatingBlock rating={base} current={368.29} upsideLabel="Upside Potential:" />);
    expect(screen.queryByText(/Reward\/risk/)).toBeNull();
    expect(screen.getByText(/Price Target: \$345\.00 – \$455\.00/)).toBeInTheDocument();
  });
});
