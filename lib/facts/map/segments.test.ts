import { describe, it, expect } from "vitest";
import { mapSegments, tidyName } from "@/lib/facts/map/segments";
const DIR = "data/raw/AVGO/0001730168-26-000080";

describe("tidyName", () => {
  it("collapses letter-spaced labels", () => { expect(tidyName("E M E A")).toBe("EMEA"); });
  it("leaves real multi-word names unchanged", () => { expect(tidyName("Asia Pacific")).toBe("Asia Pacific"); });
  it("trims surrounding whitespace", () => { expect(tidyName(" Americas ")).toBe("Americas"); });
});
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

describe("mapSegments with no geographic split", () => {
  const s = mapSegments("lib/facts/map/__fixtures__/no-geo");
  it("still maps the product mix", () => {
    expect(s.segments.basis).toBe("FY25");
    expect(s.segments.items).toEqual([{ name: "Sale of Inventory", revenue: 66837000, share: 1 }]);
  });
  it("returns an empty geoMix on the product basis instead of throwing", () => {
    expect(s.geoMix).toEqual({ basis: "FY25", items: [] });
  });
});

describe("mapSegments with only a geographic split (no product segmentation)", () => {
  const s = mapSegments("lib/facts/map/__fixtures__/geo-only");
  it("uses the latest year's geographic split as the segments, labelled by geography", () => {
    expect(s.segments.basis).toBe("FY25 by geography");
    expect(s.segments.items.map((i) => i.name).sort()).toEqual(["Non-US", "UNITED STATES"]);
    const us = s.segments.items.find((i) => i.name === "UNITED STATES")!;
    expect(us.revenue).toBe(4801000000);
    expect(us.share).toBeCloseTo(0.9357, 3);
    expect(s.segments.items.reduce((a, i) => a + i.share, 0)).toBeCloseTo(1, 6);
  });
  it("leaves the separate geography line empty so it is not repeated", () => {
    expect(s.geoMix).toEqual({ basis: "FY25", items: [] });
  });
});

describe("mapSegments when the product mix overshoots revenue with an overlapping label", () => {
  const s = mapSegments("lib/facts/map/__fixtures__/overlap-segments");
  it("drops the redundant sub-phrase segment so shares reconcile to revenue", () => {
    expect(s.segments.items.map((i) => i.name)).toEqual(["Data Center", "Client and Gaming", "Embedded"]);
    const dc = s.segments.items.find((i) => i.name === "Data Center")!;
    expect(dc.share).toBeCloseTo(16635000000 / 34639000000, 6);
    expect(s.segments.items.reduce((a, i) => a + i.share, 0)).toBeCloseTo(1, 6);
  });
});

describe("mapSegments with neither a product nor a geographic split (single reportable segment)", () => {
  const s = mapSegments("lib/facts/map/__fixtures__/single-segment");
  it("sizes one consolidated segment from the latest FY revenue", () => {
    expect(s.segments.basis).toBe("FY25 (single reportable segment)");
    expect(s.segments.items).toEqual([{ name: "Consolidated", revenue: 509991000, share: 1 }]);
  });
  it("carries an empty geoMix on the same fiscal-year basis", () => {
    expect(s.geoMix).toEqual({ basis: "FY25", items: [] });
  });
});

describe("mapSegments with an all-zero segment total", () => {
  it("throws naming the tearsheet file rather than dividing by zero", () => {
    expect(() => mapSegments("lib/facts/map/__fixtures__/zero-segments")).toThrow(/bigdata-tearsheet-annual\.json/);
  });
});
