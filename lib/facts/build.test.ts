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

describe("buildFactPack on the ORCL Q1 FY27 10-Q capture", () => {
  const pack = buildFactPack("data/raw/ORCL/0001193125-26-389274");
  it("produces a pack that parses and validates", () => { expect(() => FactPack.parse(pack)).not.toThrow(); });
  it("uses the cover-page share count, with sharesSource recording it", () => {
    expect(pack.quote.sharesSource).toBe("cover");
    expect(pack.quote.sharesOutstanding).toBe(3023736000);
  });
});

describe("buildFactPack on the ORCL FY26 10-K capture", () => {
  const pack = buildFactPack("data/raw/ORCL/0001193125-26-277521");
  it("produces a pack that parses and validates", () => { expect(() => FactPack.parse(pack)).not.toThrow(); });
});
