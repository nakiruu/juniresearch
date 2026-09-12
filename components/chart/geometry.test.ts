import { describe, it, expect } from "vitest";
import {
  buildChartModel, chartDims, niceStep, computeScales,
  buildLabelRows, declutterLabels, historySeries, MIN_LABEL_GAP,
  bandBox, BAND_CAPTION_DAY,
} from "@/components/chart/geometry";
import { Report } from "@/lib/report.schema";
import avgo from "@/data/avgo.json";

const report = Report.parse(avgo);
const model = buildChartModel(report);

describe("buildChartModel", () => {
  it("derives every input from the contract's facts", () => {
    expect(model.current).toBe(361.99);
    expect(model.bandLo).toBe(440);
    expect(model.bandHi).toBe(525);
    expect(model.ticker).toBe("AVGO");
  });

  it("derives the band caption rather than storing it", () => {
    expect(model.bandPctText).toBe("+21.6% to +45.0%");
  });

  it("orders targets high, median, consensus, low with their tones", () => {
    expect(model.targets.map((t) => [t.key, t.value, t.tone])).toEqual([
      ["high", 600, "bull"],
      ["median", 517.5, "accent"],
      ["consensus", 509.61, "secondary"],
      ["low", 350, "bear"],
    ]);
  });
});

describe("niceStep", () => {
  it("snaps to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceStep(12)).toBe(10);
    expect(niceStep(23)).toBe(20);
    expect(niceStep(61)).toBe(50);
    expect(niceStep(88)).toBe(100);
  });
});

describe("chartDims", () => {
  it("gives the wide layout a right-margin label column", () => {
    const d = chartDims("wide");
    expect(d.width).toBe(960);
    expect(d.labelX).toBe(758);
  });

  it("drops the label column in the narrow layout and widens the plot", () => {
    const wide = chartDims("wide");
    const narrow = chartDims("narrow");
    expect(narrow.labelX).toBeNull();
    const wideFrac = (wide.plotRight - wide.plotLeft) / wide.width;
    const narrowFrac = (narrow.plotRight - narrow.plotLeft) / narrow.width;
    expect(narrowFrac).toBeGreaterThan(wideFrac);
  });
});

describe("computeScales", () => {
  const scales = computeScales(model, chartDims("wide"));

  it("maps the current price onto curY", () => {
    expect(scales.y(model.current)).toBeCloseTo(scales.curY, 6);
  });

  it("places Now at day zero", () => {
    expect(scales.x(0)).toBeCloseTo(scales.nowX, 6);
  });

  it("pads the domain beyond the extreme targets", () => {
    expect(scales.yMin).toBeLessThan(350);
    expect(scales.yMax).toBeGreaterThan(600);
  });

  it("puts every gridline inside the domain", () => {
    for (const v of scales.gridValues) {
      expect(v).toBeGreaterThanOrEqual(scales.yMin);
      expect(v).toBeLessThanOrEqual(scales.yMax);
    }
  });

  it("inverts y so higher prices sit higher on the canvas", () => {
    expect(scales.y(600)).toBeLessThan(scales.y(350));
  });
});

describe("declutterLabels", () => {
  const scales = computeScales(model, chartDims("wide"));
  const rows = declutterLabels(buildLabelRows(model, scales), MIN_LABEL_GAP);

  it("enforces the minimum gap between every adjacent pair", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].labelY - rows[i - 1].labelY).toBeGreaterThanOrEqual(MIN_LABEL_GAP - 1e-9);
    }
  });

  it("separates the near-colliding median and consensus pair", () => {
    const median = rows.find((r) => r.key === "median")!;
    const consensus = rows.find((r) => r.key === "consensus")!;
    expect(Math.abs(median.anchorY - consensus.anchorY)).toBeLessThan(MIN_LABEL_GAP);
    expect(Math.abs(median.labelY - consensus.labelY)).toBeGreaterThanOrEqual(MIN_LABEL_GAP - 1e-9);
  });

  it("keeps the anchor at the true price so leaders stay accurate", () => {
    const high = rows.find((r) => r.key === "high")!;
    expect(high.anchorY).toBeCloseTo(scales.y(600), 6);
  });

  it("includes the current price as a muted row", () => {
    const current = rows.find((r) => r.key === "current")!;
    expect(current.tone).toBe("secondary");
    expect(current.value).toBe("$361.99");
  });

  it("formats target values with signed upside", () => {
    expect(rows.find((r) => r.key === "high")!.value).toBe("$600.00  +65.8%");
  });
});

describe("bandBox", () => {
  const scales = computeScales(model, chartDims("wide"));
  const box = bandBox(model, scales);

  it("spans the band between its price edges, top above bottom", () => {
    expect(box.top).toBeCloseTo(scales.y(525), 6);
    expect(box.bottom).toBeCloseTo(scales.y(440), 6);
    expect(box.top).toBeLessThan(box.bottom);
  });

  it("centres the caption vertically at the caption day", () => {
    expect(box.midY).toBeCloseTo((box.top + box.bottom) / 2, 6);
    expect(box.captionX).toBeCloseTo(scales.x(BAND_CAPTION_DAY), 6);
  });
});

describe("historySeries", () => {
  const series = historySeries(361.99, 30);

  it("is marked as a placeholder until real closes are wired", () => {
    expect(series.placeholder).toBe(true);
  });

  it("spans the requested window and lands exactly on the current price", () => {
    expect(series.points).toHaveLength(31);
    expect(series.points[0].day).toBe(-30);
    expect(series.points.at(-1)).toEqual({ day: 0, price: 361.99 });
  });

  it("is deterministic", () => {
    expect(historySeries(361.99, 30)).toEqual(series);
  });
});
