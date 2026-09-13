import { describe, it, expect } from "vitest";
import { mapSegments } from "@/lib/facts/map/segments";
const DIR = "data/raw/AVGO/0001730168-26-000080";
describe("mapSegments on the AVGO capture", () => {
  const s = mapSegments(DIR);
  it("takes the latest fiscal year's product mix, shares summing to one", () => {
    expect(s.segments.basis).toBe("FY25");
    expect(s.segments.items.map((i) => i.name).sort()).toEqual(["Infrastructure Software", "Semiconductor Solutions"]);
    const semis = s.segments.items.find((i) => i.name === "Semiconductor Solutions")!;
    expect(semis.revenue).toBe(36858000000);
    expect(semis.share).toBeCloseTo(0.58, 2);
    expect(s.segments.items.reduce((a, i) => a + i.share, 0)).toBeCloseTo(1, 6);
  });
  it("takes the latest fiscal year's geographic mix", () => {
    expect(s.geoMix.basis).toBe("FY25");
    const byRegion = Object.fromEntries(s.geoMix.items.map((g) => [g.region, g.share]));
    expect(byRegion["Asia Pacific"]).toBeCloseTo(0.56, 2);
    expect(byRegion["Americas"]).toBeCloseTo(0.30, 2);
    expect(byRegion["EMEA"]).toBeCloseTo(0.14, 2);
  });
});

describe("mapSegments on an empty capture", () => {
  it("throws naming the tearsheet file", () => {
    expect(() => mapSegments("lib/facts/map/__fixtures__/empty")).toThrow(/bigdata-tearsheet-annual\.json/);
  });
});
