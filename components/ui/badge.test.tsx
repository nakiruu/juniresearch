import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("carries the call through the variant", () => {
    render(<Badge variant="bull">BUY</Badge>);
    expect(screen.getByText("BUY").className).toContain("bg-bull");
  });

  it("supports the bear variant", () => {
    render(<Badge variant="bear">SELL</Badge>);
    expect(screen.getByText("SELL").className).toContain("bg-bear");
  });

  it("never rounds its corners", () => {
    render(<Badge variant="accent">HOLD</Badge>);
    expect(screen.getByText("HOLD").className).not.toMatch(/rounded-(?!none)/);
  });
});
