import { describe, it, expect } from "vitest";
import {
  MANIFEST, renderManifest, requiredRawFiles, missingRawFiles, CODE_FETCHED_FILES, OPTIONAL_FILES, PHASE_INPUT_FILES,
  PRESS_RELEASE_FILE, PRESS_RELEASE_MISSING_FILE, isoMinusDays,
} from "@/lib/facts/manifest";

const ctx = { ticker: "AVGO", company: "Broadcom Inc.", periodEnd: "2026-08-02", today: "2026-09-12" };

describe("MANIFEST", () => {
  it("has unique names and files", () => {
    const names = MANIFEST.map((m) => m.name), files = MANIFEST.map((m) => m.file);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(files).size).toBe(files.length);
  });
  it("lists exactly the seven vendor captures of the revised design", () => {
    expect(MANIFEST.map((m) => m.file).sort()).toEqual([
      "bigdata-entity.json", "bigdata-headlines.json", "bigdata-statements-annual.json", "bigdata-statements-quarter.json",
      "bigdata-tearsheet-annual.json", "bigdata-transcript.json", "fmp-peers.json",
    ]);
  });
  it("uses only FMP endpoints the connector plan allows", () => {
    const fmpEndpoints = MANIFEST.filter((m) => m.server === "fmp").map((m) => (m.params(ctx) as { endpoint: string }).endpoint);
    expect(fmpEndpoints.sort()).toEqual(["peers"]);
    expect(MANIFEST.filter((m) => m.server === "fmp").every((m) => m.tool === "company")).toBe(true);
  });
});

describe("renderManifest", () => {
  it("renders only phase 1 until the Bigdata entity is known", () => {
    const calls = renderManifest(ctx);
    expect(calls.map((c) => c.name).sort()).toEqual(["entity", "headlines", "peers", "transcript"]);
  });
  it("renders the three tearsheets once the entity is known", () => {
    const calls = renderManifest({ ...ctx, rpEntityId: "09DE1F", companyType: "Public" });
    const sheets = calls.filter((c) => c.tool === "bigdata_company_tearsheet");
    expect(sheets).toHaveLength(3);
    expect(sheets.find((c) => c.file === "bigdata-statements-quarter.json")!.params)
      .toMatchObject({ rp_entity_id: "09DE1F", company_type: "Public", interval: "quarter", sections: ["financial_statements"] });
    expect(sheets.find((c) => c.file === "bigdata-tearsheet-annual.json")!.params)
      .toMatchObject({ interval: "annual", sections: expect.arrayContaining(["company_overview", "analyst_ratings", "analyst_estimates", "key_metrics", "financial_ratios", "revenue_segmentation"]) });
  });
  it("renders bigdata_search calls in the tool's request envelope", () => {
    for (const name of ["transcript", "headlines"]) {
      const c = renderManifest(ctx).find((x) => x.name === name)!;
      expect(c.params).toMatchObject({ request: { search_mode: "smart", query: { text: expect.stringContaining("Broadcom Inc."), max_chunks: 20 } } });
    }
  });
});

describe("requiredRawFiles", () => {
  it("includes capture.json and every code-fetched file", () => {
    const files = requiredRawFiles({ ...ctx, rpEntityId: "X", companyType: "Public" });
    expect(files).toContain("capture.json");
    for (const f of CODE_FETCHED_FILES) expect(files).toContain(f);
    expect(files).toHaveLength(1 + CODE_FETCHED_FILES.length + 7);
  });
});

describe("missingRawFiles", () => {
  const full = { ...ctx, rpEntityId: "X", companyType: "Public" as const };
  const allOtherFiles = requiredRawFiles(full).filter((f) => f !== PRESS_RELEASE_FILE);

  it("reports nothing missing when the press-release html is present", () => {
    expect(missingRawFiles([...allOtherFiles, PRESS_RELEASE_FILE], full)).toEqual([]);
  });
  it("accepts the .missing marker in the html's place", () => {
    expect(missingRawFiles([...allOtherFiles, PRESS_RELEASE_MISSING_FILE], full)).toEqual([]);
  });
  it("reports the press release missing when neither the html nor the marker is present", () => {
    expect(missingRawFiles(allOtherFiles, full)).toEqual([PRESS_RELEASE_FILE]);
  });
});

describe("isoMinusDays", () => {
  it("subtracts calendar days in UTC", () => {
    expect(isoMinusDays("2026-08-02", 45)).toBe("2026-06-18");
  });
});

describe("manifest / mapper closure", () => {
  it("every captured (or optional) file is read by a mapper, and every file a mapper reads is captured or optional", async () => {
    const mods = await Promise.all(["quote", "statements", "segments", "analysts", "history", "context", "cover"].map((m) => import(`@/lib/facts/map/${m}`)));
    const { READS: buildReads } = await import("@/lib/facts/build");
    const read = new Set<string>([...mods.flatMap((m) => m.READS as readonly string[]), ...buildReads]);
    const captured = new Set<string>([
      ...requiredRawFiles({ ...ctx, rpEntityId: "X", companyType: "Public" }).filter((f) => !(PHASE_INPUT_FILES as readonly string[]).includes(f)),
      ...OPTIONAL_FILES,
    ]);
    expect([...read].sort()).toEqual([...captured].sort());
  });
});
