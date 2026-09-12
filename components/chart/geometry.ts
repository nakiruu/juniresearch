/**
 * geometry.ts — all chart math, as pure functions.
 * -----------------------------------------------------------------------------
 * These take numbers and return numbers. Nothing here touches React, the DOM,
 * or colour: ProjectionChart maps this output to JSX and computes nothing.
 *
 * That split is what lets the chart render server-side, which the PDF subsystem
 * depends on, and what makes the declutter algorithm directly testable.
 */
import { scaleLinear } from "d3-scale";
import type { Report } from "@/lib/report.schema";
import { pct, upside, upsideRangeText, usd } from "@/lib/format";
import type {
  ChartDims, ChartLayout, ChartModel, ChartScales, HistorySeries, LabelRow,
} from "./types";

/** Minimum vertical gap between label rows, per editorial-hairline-design.md. */
export const MIN_LABEL_GAP = 28;

const HISTORY_DAYS = 30;
const HORIZON_DAYS = 365;

export function buildChartModel(r: Report): ChartModel {
  const current = r.quote.currentPrice;
  const s = r.analystSentiment;
  return {
    company: r.meta.company,
    exchange: r.meta.exchange,
    ticker: r.meta.ticker,
    asOf: r.meta.asOf,
    current,
    bandLo: r.rating.targetLow,
    bandHi: r.rating.targetHigh,
    bandPctText: upsideRangeText(r.rating.targetLow, r.rating.targetHigh, current),
    targets: [
      { key: "high", name: "High target", value: s.highTarget, tone: "bull" },
      { key: "median", name: "Median target", value: s.medianTarget, tone: "accent" },
      { key: "consensus", name: "Consensus target", value: s.consensusTarget, tone: "secondary" },
      { key: "low", name: "Low target", value: s.lowTarget, tone: "bear" },
    ],
  };
}

/**
 * Wide-layout plot edges follow the prototype's proven values rather than
 * editorial-hairline-design.md's stated margins (top 100 / bottom 46 →
 * plotTop 100 / plotBottom 434): the header type is larger than the doc's
 * mock-up assumed, so plotTop 132 clears the meta line, and plotBottom 440
 * keeps the x-tick labels inside the 480px canvas at that header height.
 */
export function chartDims(layout: ChartLayout): ChartDims {
  if (layout === "narrow") {
    return {
      width: 640, height: 420,
      plotLeft: 52, plotRight: 620, plotTop: 120, plotBottom: 360,
      labelX: null,
    };
  }
  return {
    width: 960, height: 480,
    plotLeft: 66, plotRight: 750, plotTop: 132, plotBottom: 440,
    labelX: 758,
  };
}

export function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return s * pow;
}

export function computeScales(model: ChartModel, dims: ChartDims): ChartScales {
  const values = [
    model.current, model.bandLo, model.bandHi,
    ...model.targets.map((t) => t.value),
  ];
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const pad = (yMax - yMin) * 0.12 || 10;
  yMin -= pad;
  yMax += pad;

  const x = scaleLinear()
    .domain([-HISTORY_DAYS, HORIZON_DAYS])
    .range([dims.plotLeft, dims.plotRight]);
  const y = scaleLinear()
    .domain([yMin, yMax])
    .range([dims.plotBottom, dims.plotTop]);

  const step = niceStep((yMax - yMin) / 5);
  const gridValues: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    gridValues.push(v);
  }

  return {
    x: (day) => x(day), y: (price) => y(price),
    gridValues, nowX: x(0), curY: y(model.current), yMin, yMax,
  };
}

export function buildLabelRows(model: ChartModel, scales: ChartScales): LabelRow[] {
  const rows: LabelRow[] = model.targets.map((t) => ({
    key: t.key,
    name: t.name,
    value: `${usd(t.value)}  ${pct(upside(t.value, model.current), { signed: true })}`,
    tone: t.tone,
    anchorY: scales.y(t.value),
    labelY: scales.y(t.value),
  }));
  rows.push({
    key: "current",
    name: "Current",
    value: usd(model.current),
    tone: "secondary",
    anchorY: scales.curY,
    labelY: scales.curY,
  });
  return rows;
}

/**
 * Desired y is each row's true price. Sort top to bottom, then push any row that
 * sits closer than minGap down to exactly minGap below its predecessor. anchorY
 * is never moved, so the leader line still points at the real price.
 */
export function declutterLabels(rows: LabelRow[], minGap: number): LabelRow[] {
  const sorted = [...rows].sort((a, b) => a.anchorY - b.anchorY);
  const out: LabelRow[] = [];
  for (const row of sorted) {
    const previous = out[out.length - 1];
    const labelY = previous && row.labelY - previous.labelY < minGap
      ? previous.labelY + minGap
      : row.labelY;
    out.push({ ...row, labelY });
  }
  return out;
}

/**
 * PLACEHOLDER. A deterministic wave that terminates exactly on the current
 * price. Swap the body for real daily closes (FMP historical-price-eod-light,
 * trailing ~30 days) and set placeholder to false — no caller changes.
 */
export function historySeries(current: number, days = HISTORY_DAYS): HistorySeries {
  const points = Array.from({ length: days + 1 }, (_, i) => ({
    day: -days + i,
    price: current + 6 * Math.sin(i / 4.3) + 3 * Math.cos(i / 2) - 0.1 * (days - i),
  }));
  points[points.length - 1] = { day: 0, price: current };
  return { points, placeholder: true };
}
