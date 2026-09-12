import { describe, it, expect } from "vitest";
import { detectNew, markSeen, flattenFilings } from "@/lib/edgar/detect";
import type { Filing } from "@/lib/edgar/submissions";

const f = (accession: string, filedDate: string): Filing => ({
  form: "10-Q", accession, filedDate, periodEnd: "2026-08-02", primaryDocument: "x.htm", url: "https://x/" + accession,
});
const filings = { AVGO: [f("A-3", "2026-09-10"), f("A-2", "2026-06-09"), f("A-1", "2026-03-11")] };

describe("detectNew", () => {
  it("reports everything up to the limit when nothing is seen", () => {
    expect(detectNew(filings, {}, 2).map((x) => x.accession)).toEqual(["A-3", "A-2"]);
  });
  it("reports only unseen accessions, newest first", () => {
    const out = detectNew(filings, { AVGO: ["A-2", "A-1"] });
    expect(out).toEqual([{ ...f("A-3", "2026-09-10"), ticker: "AVGO" }]);
  });
  it("reports nothing when all are seen", () => {
    expect(detectNew(filings, { AVGO: ["A-3", "A-2", "A-1"] })).toEqual([]);
  });
  it("tolerates a ticker with no seen entry", () => {
    expect(detectNew({ NVDA: [f("N-1", "2026-08-01")] }, { AVGO: ["A-3"] }, 4)).toHaveLength(1);
  });
});

describe("markSeen", () => {
  it("appends without mutating the input", () => {
    const seen = { AVGO: ["A-1"] };
    const next = markSeen(seen, [{ ...f("A-2", "2026-06-09"), ticker: "AVGO" }, { ...f("N-1", "2026-08-01"), ticker: "NVDA" }]);
    expect(next).toEqual({ AVGO: ["A-1", "A-2"], NVDA: ["N-1"] });
    expect(seen).toEqual({ AVGO: ["A-1"] });
  });
});

describe("flattenFilings", () => {
  it("tags every filing with its ticker so all of them can be marked seen", () => {
    const flat = flattenFilings(filings);
    expect(flat).toHaveLength(3);
    expect(flat.every((f) => f.ticker === "AVGO")).toBe(true);
  });
  it("marking all fetched filings seen leaves nothing new on the next run", () => {
    const seen = markSeen({}, flattenFilings(filings));
    expect(detectNew(filings, seen)).toEqual([]);
  });
});
