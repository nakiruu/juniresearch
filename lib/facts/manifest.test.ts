import { describe, it, expect } from "vitest";
import { MANIFEST, renderManifest, requiredRawFiles, PEER_LIMIT } from "@/lib/facts/manifest";

const ctx = { ticker: "AVGO", company: "Broadcom Inc.", periodEnd: "2026-08-02", today: "2026-09-12" };

describe("MANIFEST", () => {
  it("has unique names and files", () => {
    const names = MANIFEST.map((m) => m.name), files = MANIFEST.map((m) => m.file);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(files).size).toBe(files.length);
  });
  it("covers every raw file the spec lists", () => {
    for (const f of ["fmp-profile.json", "fmp-quote.json", "fmp-income-annual.json", "fmp-balance-annual.json",
      "fmp-cashflow-annual.json", "fmp-income-quarter.json", "fmp-key-metrics-ttm.json", "fmp-ratios-ttm.json",
      "fmp-segments-product.json", "fmp-segments-geo.json", "fmp-target-consensus.json", "fmp-target-summary.json",
      "fmp-grades-summary.json", "fmp-estimates.json", "fmp-history.json", "fmp-peers.json",
      "bigdata-entity.json", "bigdata-tearsheet.md", "bigdata-transcript.md", "bigdata-headlines.md"]) {
      expect(MANIFEST.map((m) => m.file)).toContain(f);
    }
  });
});

describe("renderManifest", () => {
  it("renders phase 1 with the history window from periodEnd − 45 days to today", () => {
    const calls = renderManifest({ ...ctx });
    const hist = calls.find((c) => c.file === "fmp-history.json")!;
    expect(hist.params).toMatchObject({ endpoint: "historical-price-eod-light", symbol: "AVGO", from_date: "2026-06-18", to_date: "2026-09-12" });
    expect(calls.some((c) => c.file.startsWith("fmp-peer-"))).toBe(false);
  });
  it("renders per-peer calls and the tearsheet once peers and entity are known", () => {
    const calls = renderManifest({ ...ctx, peers: ["NVDA", "AMD", "QCOM", "MRVL", "INTC"], rpEntityId: "ABC123", companyType: "Public" });
    const peerCalls = calls.filter((c) => c.file.startsWith("fmp-peer-"));
    expect(peerCalls.map((c) => c.file)).toEqual(["fmp-peer-NVDA-ttm.json", "fmp-peer-AMD-ttm.json", "fmp-peer-QCOM-ttm.json", "fmp-peer-MRVL-ttm.json"]);
    expect(peerCalls).toHaveLength(PEER_LIMIT);
    expect(calls.find((c) => c.file === "bigdata-tearsheet.md")!.params).toMatchObject({ rp_entity_id: "ABC123", company_type: "Public" });
  });
});

describe("requiredRawFiles", () => {
  it("lists capture.json, every phase-1 file, and phase-2 files when peers are known", () => {
    const files = requiredRawFiles({ ...ctx, peers: ["NVDA"], rpEntityId: "X", companyType: "Public" });
    expect(files).toContain("capture.json");
    expect(files).toContain("fmp-quote.json");
    expect(files).toContain("fmp-peer-NVDA-ttm.json");
  });
});
