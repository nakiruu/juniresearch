import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { Report } from "@/lib/report.schema";
import avgo from "@/lib/__fixtures__/avgo-golden.json";

describe("Report.rating.conviction is optional", () => {
  it("parses the golden report, which carries no conviction", () => {
    const r = Report.parse(avgo);
    expect(r.rating.conviction).toBeUndefined();
  });
  it("parses every published report in data/ unchanged", () => {
    for (const f of readdirSync("data").filter((f) => /^[a-z]+\.json$/.test(f)))
      expect(() => Report.parse(JSON.parse(readFileSync(`data/${f}`, "utf8"))), f).not.toThrow();
  });
  it("accepts a full conviction block, with a nullable reward/risk", () => {
    const base = { ...avgo, rating: { ...avgo.rating, conviction: { expectedUpside: 0.105, bearDownside: 0.158, rewardRisk: 0.66, derivedLabel: "BUY" } } };
    expect(Report.parse(base).rating.conviction?.rewardRisk).toBe(0.66);
    const nul = { ...avgo, rating: { ...avgo.rating, conviction: { expectedUpside: 0.1, bearDownside: 0, rewardRisk: null, derivedLabel: "HOLD" } } };
    expect(Report.parse(nul).rating.conviction?.rewardRisk).toBeNull();
  });
  it("rejects a derived label outside the enum", () => {
    const bad = { ...avgo, rating: { ...avgo.rating, conviction: { expectedUpside: 0.1, bearDownside: 0.2, rewardRisk: 0.5, derivedLabel: "ACCUMULATE" } } };
    expect(() => Report.parse(bad)).toThrow();
  });
});
