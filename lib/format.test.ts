import { describe, it, expect } from "vitest";
import {
  usd, compactUSD, compactNum, mult, pct, ordinal,
  formatCell, formatSnapshot, upside, upsideRangeText, computeScenarios, rewardRiskText,
} from "@/lib/format";
import { Report } from "@/lib/report.schema";
import avgo from "@/lib/__fixtures__/avgo-golden.json";

const report = Report.parse(avgo);
const CURRENT = 361.99;

describe("scalar formatters", () => {
  it("formats small dollar amounts", () => {
    expect(usd(361.99)).toBe("$361.99");
    expect(usd(600, 0)).toBe("$600");
  });

  it("suffixes ordinals, including the 11-13 exception and rounding", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(63.4)).toBe("63rd");
    expect(ordinal(100)).toBe("100th");
  });

  it("scales large dollar amounts and trims redundant zeros", () => {
    expect(compactUSD(1_720_000_000_000, { approx: true })).toBe("~$1.72T");
    expect(compactUSD(63_900_000_000)).toBe("$63.9B");
  });

  it("places the sign before the currency symbol for negative amounts, at every scale", () => {
    expect(compactUSD(-55.7e9)).toBe("-$55.7B");
    expect(compactUSD(-2_500_000)).toBe("-$2.5M");
    expect(compactUSD(-361.99)).toBe("-$361.99");
    expect(compactUSD(-1_720_000_000_000, { approx: true })).toBe("~-$1.72T");
  });

  it("scales bare counts", () => {
    expect(compactNum(4_760_000_000, { approx: true })).toBe("~4.76B");
  });

  it("formats multiples and percentages from ratios", () => {
    expect(mult(44.9)).toBe("44.9x");
    expect(pct(0.408, { signed: true })).toBe("+40.8%");
    expect(pct(0.68, { dp: 0 })).toBe("68%");
    expect(pct(0.0072, { dp: 2 })).toBe("0.72%");
  });
});

describe("table cells", () => {
  it("renders null as an em dash", () => {
    expect(formatCell(null, "usdB")).toBe("—");
  });

  it("passes strings through verbatim as the escape hatch", () => {
    expect(formatCell("~40x", "mult")).toBe("~40x");
  });

  it("scales usdB without a currency symbol", () => {
    expect(formatCell(63_900_000_000, "usdB")).toBe("63.9");
  });
});

describe("snapshot cells", () => {
  it("appends a signed change from a ratio", () => {
    expect(formatSnapshot({
      label: "Consensus Target", value: 509.61, unit: "usd", change: 0.408,
    })).toBe("$509.61 (+40.8%)");
  });

  it("appends a note", () => {
    expect(formatSnapshot({
      label: "Q3'26 Operating Margin", value: 0.68, unit: "pct", dp: 0, note: "record",
    })).toBe("68% (record)");
  });

  it("honours the raw escape hatch", () => {
    expect(formatSnapshot({ label: "52-Week Range", raw: "$289.96 – $495.00" }))
      .toBe("$289.96 – $495.00");
  });

  it("renders a null/undefined value as an em dash, not a formatted zero", () => {
    expect(formatSnapshot({ label: "EV/EBITDA (TTM)", value: undefined, unit: "mult" })).toBe("—");
    expect(formatSnapshot({ label: "P/E (TTM)", value: undefined, unit: "mult" })).toBe("—");
  });
  it("keeps an appended note on an em-dashed cell", () => {
    expect(formatSnapshot({ label: "EV/EBITDA (TTM)", value: undefined, unit: "mult", note: "not meaningful for a bank" }))
      .toBe("— (not meaningful for a bank)");
  });
});

describe("derived values", () => {
  it("computes upside as a ratio", () => {
    expect(pct(upside(509.61, CURRENT), { signed: true })).toBe("+40.8%");
  });

  it("reproduces the upside range quoted in the report prose", () => {
    expect(upsideRangeText(440, 525, CURRENT)).toBe("+21.6% to +45.0%");
  });

  it("derives fair value from the fixture's own scenarios", () => {
    const { rows, fairValue } = computeScenarios(report.sections.valuation.scenarios);
    expect(rows.map((r) => r.weighted)).toEqual([180, 245, 60]);
    expect(usd(fairValue)).toBe("$485.00");
  });
});

describe("rewardRiskText", () => {
  it("renders two decimals with a multiplication sign", () => {
    expect(rewardRiskText(0.66)).toBe("0.66×");
    expect(rewardRiskText(1)).toBe("1.00×");
    expect(rewardRiskText(1.548)).toBe("1.55×");
  });
  it("renders an em dash for a null ratio", () => {
    expect(rewardRiskText(null)).toBe("—");
  });
});

describe("the contract", () => {
  it("parses the reference fixture", () => {
    expect(report.meta.ticker).toBe("AVGO");
    expect(report.schemaVersion).toBe("1.1.0");
  });

  it("still parses a 1.0.0 report that has no quote.history", () => {
    const legacy = { ...avgo, schemaVersion: "1.0.0", quote: { ...avgo.quote, history: undefined } };
    const parsed = Report.parse(legacy);
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.quote.history).toBeUndefined();
  });
});
