import { describe, it, expect } from "vitest";
import { parseFilingXbrl, mergeFilingFacts, type CompanyFactsLike } from "./filing-xbrl";

const META = { form: "10-Q", filed: "2026-07-24" };

// A small synthetic iXBRL document: one duration context, one instant context, one dimensioned
// (segmented) duration context, a plain-USD unit, a USD/shares (divide) unit, and a handful of
// `ix:nonFraction` facts exercising scale, sign, dedup, nil, and non-us-gaap/non-USD exclusion.
const HTML = `
<html><body>
<xbrli:context id="c-dur">
  <xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
</xbrli:context>
<xbrli:context id="c-inst">
  <xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period>
</xbrli:context>
<xbrli:context id="c-seg">
  <xbrli:entity>
    <xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier>
    <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">nee:FplMember</xbrldi:explicitMember></xbrli:segment>
  </xbrli:entity>
  <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
</xbrli:context>
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
<xbrli:unit id="usdPerShare">
  <xbrli:divide>
    <xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator>
    <xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator>
  </xbrli:divide>
</xbrli:unit>

<ix:nonFraction unitRef="usd" contextRef="c-dur" decimals="-6" name="us-gaap:NetIncomeLoss" scale="6" id="f-1">3,144</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-dur" decimals="-6" name="us-gaap:NetIncomeLoss" scale="6" id="f-1b">3,144</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-dur" decimals="-6" name="us-gaap:InterestExpense" scale="6" sign="-" id="f-2">487</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-inst" decimals="-6" name="us-gaap:AssetsCurrent" scale="6" id="f-3">12,000</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-seg" decimals="-6" name="us-gaap:NetIncomeLoss" scale="6" id="f-4">1,412</ix:nonFraction>
<ix:nonFraction unitRef="usdPerShare" contextRef="c-dur" decimals="2" name="us-gaap:EarningsPerShareDiluted" scale="0" id="f-5">1.50</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-dur" decimals="-6" name="us-gaap:OperatingIncomeLoss" scale="6" id="f-6" xsi:nil="true"/>
<ix:nonFraction unitRef="usd" contextRef="c-dur" decimals="-6" name="nee:CustomLine" scale="6" id="f-7">999</ix:nonFraction>
</body></html>
`;

describe("parseFilingXbrl", () => {
  const facts = parseFilingXbrl(HTML, META);

  it("applies scale and keeps start+end for a duration context", () => {
    expect(facts.NetIncomeLoss).toEqual([
      { start: "2026-04-01", end: "2026-06-30", val: 3_144_000_000, form: "10-Q", filed: "2026-07-24" },
    ]);
  });

  it("dedups repeated (concept, contextRef) facts across statement tables", () => {
    expect(facts.NetIncomeLoss).toHaveLength(1);
  });

  it("negates the value when sign=\"-\" is present", () => {
    expect(facts.InterestExpense).toEqual([
      { start: "2026-04-01", end: "2026-06-30", val: -487_000_000, form: "10-Q", filed: "2026-07-24" },
    ]);
  });

  it("omits `start` for an instant context", () => {
    expect(facts.AssetsCurrent).toEqual([{ end: "2026-06-30", val: 12_000_000_000, form: "10-Q", filed: "2026-07-24" }]);
    expect(facts.AssetsCurrent[0]).not.toHaveProperty("start");
  });

  it("excludes a fact tagged on a dimensioned (segmented) context", () => {
    // Only the c-dur (consolidated) NetIncomeLoss entry should be present; the c-seg
    // (FPL-segment) one must not appear anywhere in the array.
    expect(facts.NetIncomeLoss).not.toContainEqual(expect.objectContaining({ val: 1_412_000_000 }));
  });

  it("excludes facts on a divide (ratio) unit like USD/shares", () => {
    expect(facts.EarningsPerShareDiluted).toBeUndefined();
  });

  it("excludes a nil (self-closing) fact", () => {
    expect(facts.OperatingIncomeLoss).toBeUndefined();
  });

  it("excludes non-us-gaap concepts", () => {
    expect(facts.CustomLine).toBeUndefined();
    expect((facts as Record<string, unknown>)["nee:CustomLine"]).toBeUndefined();
  });

  it("returns {} for a document with no iXBRL facts", () => {
    expect(parseFilingXbrl("<html><body>no xbrl here</body></html>", META)).toEqual({});
  });
});

describe("mergeFilingFacts", () => {
  it("appends to an existing concept's USD entries without mutating the input", () => {
    const before: CompanyFactsLike = {
      cik: 1,
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: { USD: [{ end: "2026-03-31", val: 1_000, form: "10-Q", filed: "2026-04-23" }] },
          },
        },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(before));
    const filingFacts = { NetIncomeLoss: [{ start: "2026-04-01", end: "2026-06-30", val: 3_144_000_000, form: "10-Q", filed: "2026-07-24" }] };

    const merged = mergeFilingFacts(before, filingFacts);

    expect(merged.facts?.["us-gaap"]?.NetIncomeLoss.units?.USD).toEqual([
      { end: "2026-03-31", val: 1_000, form: "10-Q", filed: "2026-04-23" },
      { start: "2026-04-01", end: "2026-06-30", val: 3_144_000_000, form: "10-Q", filed: "2026-07-24" },
    ]);
    expect(before).toEqual(snapshot); // input untouched
  });

  it("creates a missing concept node", () => {
    const before: CompanyFactsLike = { facts: { "us-gaap": {} } };
    const filingFacts = { AssetsCurrent: [{ end: "2026-06-30", val: 12_000_000_000, form: "10-Q", filed: "2026-07-24" }] };

    const merged = mergeFilingFacts(before, filingFacts);

    expect(merged.facts?.["us-gaap"]?.AssetsCurrent.units?.USD).toEqual(filingFacts.AssetsCurrent);
  });

  it("is a no-op when filingFacts is empty", () => {
    const before: CompanyFactsLike = { facts: { "us-gaap": { Revenues: { units: { USD: [] } } } } };
    expect(mergeFilingFacts(before, {})).toBe(before);
  });

  it("handles a companyfacts object with no facts at all", () => {
    const merged = mergeFilingFacts({}, { NetIncomeLoss: [{ end: "2026-06-30", val: 5, form: "10-Q", filed: "2026-07-24" }] });
    expect(merged.facts?.["us-gaap"]?.NetIncomeLoss.units?.USD).toEqual([{ end: "2026-06-30", val: 5, form: "10-Q", filed: "2026-07-24" }]);
  });
});
