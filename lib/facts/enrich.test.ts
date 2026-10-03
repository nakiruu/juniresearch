import { describe, it, expect } from "vitest";
import { alignAnnualSeries, mergeConceptSeries, fetchSbcSeries, stampSbcProvenance, parsePeerMultiples, enrichPack, secEvToEbitda, evToEbitdaNotMeaningful } from "./enrich";

// Hand-built companyconcept facts. A 10-K reports the current year plus comparatives, all under the
// filing's own `fy` — which is why alignment must key on the period end, not `fy`.
const dur = (start: string, end: string, val: number, accn: string, fy: number, filed: string, form = "10-K", fp = "FY") =>
  ({ start, end, val, accn, fy, fp, form, filed });
const inst = (end: string, val: number, accn: string, fy: number, filed: string, form = "10-K", fp = "FY") =>
  ({ end, val, accn, fy, fp, form, filed });

describe("alignAnnualSeries", () => {
  it("December filer: aligns each annual duration to the label whose fiscal year it ends", () => {
    const e = [
      dur("2022-01-01", "2022-12-31", 22, "k23", 2023, "2023-02-10"), // comparative in the FY23 10-K
      dur("2023-01-01", "2023-12-31", 23, "k23", 2023, "2023-02-10"),
      dur("2022-01-01", "2022-12-31", 22, "k24", 2024, "2024-02-10"),
      dur("2023-01-01", "2023-12-31", 23, "k24", 2024, "2024-02-10"),
      dur("2024-01-01", "2024-12-31", 24, "k24", 2024, "2024-02-10"),
      dur("2023-01-01", "2023-12-31", 23, "k25", 2025, "2025-02-10"),
      dur("2024-01-01", "2024-12-31", 24, "k25", 2025, "2025-02-10"),
      dur("2025-01-01", "2025-12-31", 25, "k25", 2025, "2025-02-10"),
    ];
    // 10-Q pack for Q2 2026: the last label is the year ended 2025-12-31.
    expect(alignAnnualSeries(e, ["FY21", "FY22", "FY23", "FY24", "FY25"], "2026-06-30")).toEqual([null, 22, 23, 24, 25]);
    // 10-K pack for FY24 (anchor = that year end): FY25 is not yet visible.
    expect(alignAnnualSeries(e, ["FY22", "FY23", "FY24"], "2024-12-31")).toEqual([22, 23, 24]);
  });

  it("January-FYE filer whose `fy` lags the period (CRWD/CHWY): keys on the end date, latest year present", () => {
    const e = [
      dur("2022-02-01", "2023-01-31", 527, "k1", 2022, "2023-03-09"), // fy 2022 for the year ending Jan 2023
      dur("2023-02-01", "2024-01-31", 632, "k2", 2023, "2024-03-07"),
      dur("2022-02-01", "2023-01-31", 527, "k2", 2023, "2024-03-07"),
      dur("2024-02-01", "2025-01-31", 865, "k3", 2024, "2025-03-10"),
      dur("2025-02-01", "2026-01-31", 1097, "k4", 2026, "2026-03-05"), // fy jumps 2024 → 2026
      dur("2024-02-01", "2025-01-31", 861, "k4", 2026, "2026-03-05"),
    ];
    // Pack labels FY23..FY26 for a Q2 10-Q ending 2026-07-31.
    expect(alignAnnualSeries(e, ["FY23", "FY24", "FY25", "FY26"], "2026-07-31")).toEqual([527, 632, 861, 1097]);
  });

  it("52/53-week years: end dates drifting a few days still match their year", () => {
    const e = [
      dur("2022-01-30", "2023-01-28", 1, "a", 2022, "2023-03-20"),
      dur("2023-01-29", "2024-02-03", 2, "b", 2023, "2024-03-20"), // 53 weeks
      dur("2024-02-04", "2025-02-01", 3, "c", 2024, "2025-03-20"),
    ];
    expect(alignAnnualSeries(e, ["FY23", "FY24", "FY25"], "2025-08-02")).toEqual([1, 2, 3]);
  });

  it("a restatement: two values for the same period end, the later-filed one wins", () => {
    const e = [
      dur("2024-01-01", "2024-12-31", 100, "k25a", 2025, "2025-02-10", "10-K"),
      dur("2024-01-01", "2024-12-31", 140, "k26", 2026, "2026-02-12", "10-K"),
      dur("2024-01-01", "2024-12-31", 120, "k25b", 2025, "2025-06-01", "10-K/A"),
      dur("2025-01-01", "2025-12-31", 150, "k26", 2026, "2026-02-12", "10-K"),
    ];
    expect(alignAnnualSeries(e, ["FY24", "FY25"], "2026-03-31")).toEqual([140, 150]);
  });

  it("ignores quarterly and year-to-date entries, even inside a 10-K, and non-10-K forms", () => {
    const e = [
      dur("2025-10-01", "2025-12-31", 9, "k", 2025, "2026-02-10"), // Q4 duration in the 10-K
      dur("2025-01-01", "2025-06-30", 8, "q", 2025, "2025-08-01", "10-Q", "Q2"), // YTD in a 10-Q
      dur("2024-07-01", "2025-06-30", 7, "8k", 2025, "2025-08-01", "8-K", "FY"),
      dur("2025-01-01", "2025-12-31", 40, "k", 2025, "2026-02-10"),
    ];
    expect(alignAnnualSeries(e, ["FY24", "FY25"], "2026-06-30")).toEqual([null, 40]);
  });

  it("leaves the newest label null when that year's 10-K is missing, rather than shifting the series", () => {
    const e = [
      dur("2023-01-01", "2023-12-31", 23, "k23", 2023, "2024-02-10"),
      dur("2024-01-01", "2024-12-31", 24, "k24", 2024, "2025-02-10"),
    ];
    expect(alignAnnualSeries(e, ["FY23", "FY24", "FY25"], "2026-06-30")).toEqual([23, 24, null]);
    expect(alignAnnualSeries(e, ["FY23", "FY24", "FY25"], "2025-12-31")).toEqual([23, 24, null]); // 10-K pack
  });

  it("goodwill (instants): takes fiscal-year-end balances, not mid-year instants", () => {
    const e = [
      inst("2022-12-31", 210, "k23", 2023, "2023-02-10"),
      inst("2023-12-31", 300, "k23", 2023, "2023-02-10"),
      inst("2023-05-15", 999, "k23", 2023, "2023-02-10"), // acquisition-date instant in a note
      inst("2023-12-31", 306, "k24", 2024, "2024-02-10"), // recast in the next 10-K
      inst("2024-12-31", 310, "k24", 2024, "2024-02-10"),
      inst("2025-06-30", 777, "q", 2025, "2025-08-01", "10-Q", "Q2"),
    ];
    expect(alignAnnualSeries(e, ["FY22", "FY23", "FY24"], "2025-06-30")).toEqual([210, 306, 310]);
  });

  it("is all null for an empty feed", () => {
    expect(alignAnnualSeries([], ["FY24", "FY25"], "2026-06-30")).toEqual([null, null]);
  });
});

describe("mergeConceptSeries / fetchSbcSeries", () => {
  it("fills years ShareBasedCompensation leaves null from AllocatedShareBasedCompensationExpense", () => {
    expect(mergeConceptSeries({ concept: "A", values: [1, null, 3, null] }, { concept: "B", values: [9, 2, 9, null] }))
      .toEqual({ values: [1, 2, 3, null], concepts: ["A", "B", "A", null] });
  });

  const sbcFetch = (feeds: Record<string, unknown[] | number>) => (async (url: string) => {
    const concept = url.match(/us-gaap\/(\w+)\.json/)![1];
    const f = feeds[concept];
    if (f == null) return new Response("", { status: 404 });
    if (typeof f === "number") return new Response("", { status: f });
    return Response.json({ units: { USD: f } });
  }) as typeof fetch;

  it("uses the fallback concept for missing years and records which concept supplied each", async () => {
    const fetchImpl = sbcFetch({
      ShareBasedCompensation: [dur("2024-01-01", "2024-12-31", 24, "k", 2025, "2026-02-01")],
      AllocatedShareBasedCompensationExpense: [
        dur("2024-01-01", "2024-12-31", 99, "k", 2025, "2026-02-01"),
        dur("2025-01-01", "2025-12-31", 25, "k", 2025, "2026-02-01"),
      ],
    });
    expect(await fetchSbcSeries(1, ["FY24", "FY25"], "2026-06-30", "t@example.com", fetchImpl)).toEqual({
      values: [24, 25], concepts: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
    });
  });

  it("treats an untagged concept (404) as empty but surfaces other failures", async () => {
    const allocatedOnly = sbcFetch({ AllocatedShareBasedCompensationExpense: [dur("2025-01-01", "2025-12-31", 5, "k", 2025, "2026-02-01")] });
    expect((await fetchSbcSeries(1, ["FY25"], "2026-06-30", "t@example.com", allocatedOnly)).values).toEqual([5]);
    await expect(fetchSbcSeries(1, ["FY25"], "2026-06-30", "t@example.com", sbcFetch({ ShareBasedCompensation: 503 }))).rejects.toThrow(/503/);
  });

  it("reads the concept from companyfacts when companyconcept serves a hollow units object (Visa)", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/companyconcept/")) return Response.json({ units: { USD: {} } });
      return Response.json({ facts: { "us-gaap": { ShareBasedCompensation: { units: { USD: [dur("2024-10-01", "2025-09-30", 897, "k", 2025, "2025-11-06")] } } } } });
    }) as typeof fetch;
    expect((await fetchSbcSeries(1, ["FY24", "FY25"], "2026-06-30", "t@example.com", fetchImpl)).values).toEqual([null, 897]);
  });

  it("stampSbcProvenance notes fallback years and replaces a stale entry", () => {
    const pack = { statements: { fiscalYears: ["FY24", "FY25"] }, provenance: [{ field: "sbc", source: "edgar" as const, endpoint: "old", capturedAt: "x" }] };
    stampSbcProvenance(pack, ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], "2026-10-03T00:00:00.000Z");
    expect(pack.provenance).toEqual([{
      field: "sbc", source: "edgar", capturedAt: "2026-10-03T00:00:00.000Z",
      endpoint: "companyconcept us-gaap/AllocatedShareBasedCompensationExpense (FY25); us-gaap/ShareBasedCompensation (FY24)",
    }]);
    stampSbcProvenance(pack, ["ShareBasedCompensation", "ShareBasedCompensation"], "z");
    expect(pack.provenance).toEqual([]);
  });
});

describe("parsePeerMultiples", () => {
  it("reads trailing P/E, P/S and EV/EBITDA from a quoteSummary result", () => {
    const result = {
      summaryDetail: { trailingPE: { raw: 40.02 }, priceToSalesTrailing12Months: { raw: 11.95 } },
      defaultKeyStatistics: { enterpriseToEbitda: { raw: 36.09 } },
    };
    expect(parsePeerMultiples(result)).toEqual({ pe: 40.02, ps: 11.95, evToEbitda: 36.09 });
  });
  it("returns nulls for missing or non-numeric fields", () => {
    expect(parsePeerMultiples({})).toEqual({ pe: null, ps: null, evToEbitda: null });
    expect(parsePeerMultiples({ summaryDetail: { trailingPE: {} } })).toEqual({ pe: null, ps: null, evToEbitda: null });
  });
});

describe("enrichPack", () => {
  it("stamps goodwill, then sbc, then peer multiples (key order is what facts:enrich writes)", async () => {
    const annual = (val: number) => ({ units: { USD: [{ end: "2025-12-31", fy: 2025, val, form: "10-K", fp: "FY", filed: "2026-02-01" }] } });
    const fetchImpl = (async (url: string) => {
      if (url.includes("/Goodwill.json")) return Response.json(annual(7));
      if (url.includes("/ShareBasedCompensation.json")) return Response.json(annual(3));
      if (url === "https://fc.yahoo.com") return new Response("", { headers: { "set-cookie": "A=1; path=/" } });
      if (url.includes("getcrumb")) return new Response("crumb");
      return Response.json({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 20 } } }] } });
    }) as typeof fetch;
    const pack = { cik: 1, filing: { periodEnd: "2026-06-30" }, statements: { fiscalYears: ["FY25"] }, peers: [{ ticker: "PEER", pe: null, ps: null, evToEbitda: null }] };
    const out = await enrichPack(pack, "test@example.com", fetchImpl);
    expect(Object.keys(out)).toEqual(["cik", "filing", "statements", "peers", "goodwill", "sbc"]);
    expect(out).toMatchObject({ goodwill: [7], sbc: [3], peers: [{ ticker: "PEER", pe: 20, ps: null, evToEbitda: null }] });
  });
});

describe("secEvToEbitda", () => {
  const q = (report_date: string, ebitda: number | null, net_debt: number | null = null) => ({ report_date, ebitda, net_debt });
  const quarters = [q("2025-09-30", 50), q("2025-12-31", 60), q("2026-03-31", 70), q("2026-06-30", 80, 300), q("2026-09-30", 999, 999)];
  it("is (capture market cap + latest net debt) / sum of the four quarters ending at the pack's latest quarter", () => {
    expect(secEvToEbitda(quarters, "2026-06-30", 2_300)).toBeCloseTo((2_300 + 300) / (50 + 60 + 70 + 80));
  });
  it("is null when the latest quarter is missing, a quarter's EBITDA or the net debt is missing, or TTM EBITDA is not positive", () => {
    expect(secEvToEbitda(quarters, "2026-05-31", 2_300)).toBeNull();
    expect(secEvToEbitda([q("2025-09-30", 50), q("2025-12-31", null), q("2026-03-31", 70), q("2026-06-30", 80, 300)], "2026-06-30", 2_300)).toBeNull();
    expect(secEvToEbitda([q("2025-09-30", 50), q("2025-12-31", 60), q("2026-03-31", 70), q("2026-06-30", 80)], "2026-06-30", 2_300)).toBeNull();
    expect(secEvToEbitda([q("2025-09-30", -50), q("2025-12-31", -60), q("2026-03-31", 70), q("2026-06-30", 10, 0)], "2026-06-30", 2_300)).toBeNull();
    expect(secEvToEbitda(quarters, "2026-06-30", null)).toBeNull();
  });
});

describe("evToEbitdaNotMeaningful", () => {
  it("is true for banks, lenders and insurers, false for exchanges, asset managers and non-financials", () => {
    for (const sic of [6021, 6022, 6035, 6141, 6199, 6311, 6331, 6411]) expect(evToEbitdaNotMeaningful(sic)).toBe(true);
    for (const sic of [6200, 6211, 6282, 6798, 3674, 7372, null, undefined]) expect(evToEbitdaNotMeaningful(sic)).toBe(false);
  });
});
