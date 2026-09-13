import { describe, it, expect } from "vitest";
import { mapHistory } from "@/lib/facts/map/history";
const DIR = "data/raw/AVGO/0001730168-26-000080";
describe("mapHistory on the AVGO capture", () => {
  const h = mapHistory(DIR, "2026-09-12T00:00:00Z");
  it("returns thirty ascending trading days ending on or before capture", () => {
    expect(h).toHaveLength(30);
    for (let i = 1; i < h.length; i++) expect(h[i].date > h[i - 1].date).toBe(true);
    expect(h[h.length - 1].date <= "2026-09-12").toBe(true);
  });
  it("ends on the quote's as-of close", () => {
    expect(h[h.length - 1]).toMatchObject({ date: "2026-09-11" });
    expect(h[h.length - 1].close).toBeCloseTo(361.99, 1);
  });
});
