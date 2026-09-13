import { describe, it, expect } from "vitest";
import { mapAnalysts } from "@/lib/facts/map/analysts";
const DIR = "data/raw/AVGO/0001730168-26-000080";
describe("mapAnalysts on the AVGO capture", () => {
  const a = mapAnalysts(DIR, 2025);
  it("reads targets and the rating split exactly as the fixture", () => {
    expect(a.analysts).toMatchObject({ consensusTarget: 509.61, medianTarget: 517.5, highTarget: 600, lowTarget: 350,
      buy: 54, hold: 6, sell: 0, count: 60, consensusRating: "Buy" });
    expect(a.analysts.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("labels the next two fiscal years' SALES and EPS means as estimates", () => {
    expect(a.estimates.nextFY.label).toBe("FY26E");
    expect(a.estimates.nextFY.revenue).toBeCloseTo(105.86e9, -9);
    expect(a.estimates.nextFY.eps).toBeCloseTo(11.629, 2);
    expect(a.estimates.followingFY.label).toBe("FY27E");
    expect(a.estimates.followingFY.eps).toBeCloseTo(19.28, 1);
  });
  it("carries up to four peer tickers with null multiples until a peer source exists", () => {
    expect(a.peers.length).toBeGreaterThan(0);
    expect(a.peers.length).toBeLessThanOrEqual(4);
    for (const p of a.peers) { expect(p.ticker).toMatch(/^[A-Z.]+$/); expect(p.pe).toBeNull(); }
  });
});
