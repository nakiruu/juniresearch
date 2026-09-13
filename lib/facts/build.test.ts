import { describe, it, expect } from "vitest";
import { buildFactPack } from "@/lib/facts/build";
import { FactPack } from "@/lib/facts/schema";
const DIR = "data/raw/AVGO/0001730168-26-000080";

describe("buildFactPack on the AVGO capture", () => {
  const pack = buildFactPack(DIR);
  it("produces a pack that parses and validates", () => { expect(() => FactPack.parse(pack)).not.toThrow(); });
  it("stamps the filing and capture identity", () => {
    expect(pack.ticker).toBe("AVGO");
    expect(pack.filing.accession).toBe("0001730168-26-000080");
    expect(pack.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("records provenance for every fact section, with yahoo for history", () => {
    const fields = new Set(pack.provenance.map((p) => p.field.split(".")[0]));
    for (const f of ["quote", "statements", "latestQuarter", "ttm", "analysts", "estimates", "segments", "geoMix", "peers", "history", "context"]) expect(fields).toContain(f);
    expect(pack.provenance.find((p) => p.field === "history")?.source).toBe("yahoo");
  });
  it("fails naming a missing raw file", () => {
    expect(() => buildFactPack("lib/facts/map/__fixtures__/empty")).toThrow(/Missing raw file|Missing "company_overview"/);
  });
});
