/**
 * ProjectionChart.tsx — the page-1 "Editorial Hairline" 1-year projection.
 * -----------------------------------------------------------------------------
 * The chart is DERIVED, not authored: its inputs are built from quote + rating +
 * analystSentiment by `buildChartModel(report)`. There is no `chart` blob in the
 * JSON contract. Drawing logic is unchanged from the original port.
 */
"use client";
import { useRef, useEffect } from "react";
import * as d3 from "d3";
import type { Report } from "../lib/report.schema";
import { pct, upside } from "../lib/format";

type Tone = "bull" | "accent" | "secondary" | "bear";
export interface ChartModel {
  company: string;
  exchange: string;
  ticker: string;
  asOf: string;
  current: number;
  bandLo: number;
  bandHi: number;
  bandPctText: string;
  targets: { name: string; value: number; tone: Tone }[];
}

/** Build the chart's numeric model straight from the contract's facts. */
export function buildChartModel(r: Report): ChartModel {
  const cur = r.quote.currentPrice;
  const s = r.analystSentiment;
  return {
    company: r.meta.company,
    exchange: r.meta.exchange,
    ticker: r.meta.ticker,
    asOf: r.meta.asOf,
    current: cur,
    bandLo: r.rating.targetLow,
    bandHi: r.rating.targetHigh,
    bandPctText: `${pct(upside(r.rating.targetLow, cur), { signed: true })} to ${pct(
      upside(r.rating.targetHigh, cur),
      { signed: true }
    )}`,
    targets: [
      { name: "High target", value: s.highTarget, tone: "bull" },
      { name: "Median target", value: s.medianTarget, tone: "accent" },
      { name: "Consensus target", value: s.consensusTarget, tone: "secondary" },
      { name: "Low target", value: s.lowTarget, tone: "bear" },
    ],
  };
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return s * pow;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ProjectionChart({ t, chart }: { t: any; chart: ChartModel }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const svg: any = d3.select(node);
    svg.selectAll("*").remove();

    const W = 960, H = 480, PL = 66, PR = 752, PT = 132, PB = 440, LX = 760;
    const { current: cur, targets, bandLo, bandHi, bandPctText, asOf, company, exchange, ticker } = chart;
    const DISP = t.display, MONO = t.mono, SANS = t.sans;

    const vals = [cur, bandLo, bandHi, ...targets.map((d) => d.value)];
    let ymin = Math.min(...vals), ymax = Math.max(...vals);
    const pad = (ymax - ymin) * 0.12 || 10;
    ymin -= pad; ymax += pad;

    const X = d3.scaleLinear().domain([-30, 365]).range([PL, PR]);
    const Y = d3.scaleLinear().domain([ymin, ymax]).range([PB, PT]);
    const nowX = X(0), curY = Y(cur);

    const step = niceStep((ymax - ymin) / 5);
    const grid: number[] = [];
    for (let v = Math.ceil(ymin / step) * step; v <= ymax; v += step) grid.push(v);

    const grad = svg.append("defs").append("linearGradient")
      .attr("id", "jbBand").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    grad.append("stop").attr("offset", 0).attr("stop-color", t.bull).attr("stop-opacity", 0.1);
    grad.append("stop").attr("offset", 1).attr("stop-color", t.bull).attr("stop-opacity", 0.06);

    svg.append("rect").attr("x", 0.5).attr("y", 0.5).attr("width", W - 1).attr("height", H - 1)
      .attr("fill", t.surface).attr("stroke", t.neutral).attr("stroke-width", 1);

    svg.append("text").attr("x", 66).attr("y", 40).attr("fill", t.accent)
      .attr("font-family", SANS).attr("font-size", 15).attr("font-weight", 600)
      .attr("letter-spacing", 3).text("EQUITY RESEARCH");
    svg.append("text").attr("x", 66).attr("y", 83).attr("fill", t.primary)
      .attr("font-family", DISP).attr("font-size", 40).attr("font-weight", 600)
      .text(`${company} · ${exchange}: ${ticker}`);
    svg.append("text").attr("x", 66).attr("y", 109).attr("fill", t.secondary)
      .attr("font-family", MONO).attr("font-size", 14.5)
      .text(`1-Year price projection · as of ${asOf} · current $${cur.toFixed(2)}`);

    grid.forEach((v) => {
      const y = Y(v);
      svg.append("line").attr("x1", PL).attr("x2", PR).attr("y1", y).attr("y2", y)
        .attr("stroke", t.neutral).attr("stroke-width", 1).attr("stroke-dasharray", "1 4");
      svg.append("text").attr("x", PL - 8).attr("y", y + 4).attr("text-anchor", "end")
        .attr("fill", t.secondary).attr("font-family", MONO).attr("font-size", 13).text(v);
    });

    const ybh = Y(bandHi), ybl = Y(bandLo);
    svg.append("rect").attr("x", nowX).attr("y", ybh).attr("width", PR - nowX).attr("height", ybl - ybh)
      .attr("fill", "url(#jbBand)");
    [ybh, ybl].forEach((yy) =>
      svg.append("line").attr("x1", nowX).attr("x2", PR).attr("y1", yy).attr("y2", yy)
        .attr("stroke", t.bull).attr("stroke-width", 1).attr("stroke-dasharray", "2 3").attr("opacity", 0.7)
    );

    const hist: [number, number][] = [];
    for (let i = 0; i < 31; i++) {
      const d = -30 + i;
      const v = cur + 6 * Math.sin(i / 4.3) + 3 * Math.cos(i / 2.0) - 0.1 * (30 - i);
      hist.push([X(d), Y(v)]);
    }
    hist[hist.length - 1] = [nowX, curY];
    svg.append("polyline").attr("points", hist.map((p) => `${p[0]},${p[1]}`).join(" "))
      .attr("fill", "none").attr("stroke", t.primary).attr("stroke-width", 1.3);

    svg.append("line").attr("x1", nowX).attr("x2", nowX).attr("y1", PT).attr("y2", PB)
      .attr("stroke", t.secondary).attr("stroke-width", 1).attr("stroke-dasharray", "2 4").attr("opacity", 0.5);
    svg.append("line").attr("x1", PL).attr("x2", PR).attr("y1", PB).attr("y2", PB)
      .attr("stroke", t.primary).attr("stroke-width", 1).attr("opacity", 0.55);
    ([[-30, "−1M"], [0, "Now"], [91, "+3M"], [182, "+6M"], [273, "+9M"], [365, "+1Y"]] as [number, string][])
      .forEach(([d, lab]) => {
        const x = X(d);
        svg.append("line").attr("x1", x).attr("x2", x).attr("y1", PB).attr("y2", PB + 5)
          .attr("stroke", t.secondary).attr("stroke-width", 1);
        svg.append("text").attr("x", x).attr("y", PB + 21).attr("text-anchor", "middle")
          .attr("fill", t.secondary).attr("font-family", MONO).attr("font-size", 13).text(lab);
      });

    targets.forEach((tg) =>
      svg.append("line").attr("x1", nowX).attr("y1", curY).attr("x2", PR).attr("y2", Y(tg.value))
        .attr("stroke", t[tg.tone]).attr("stroke-width", 1.4).attr("stroke-dasharray", "5 5")
    );

    svg.append("circle").attr("cx", nowX).attr("cy", curY).attr("r", 5).attr("fill", t.surface);
    svg.append("circle").attr("cx", nowX).attr("cy", curY).attr("r", 3).attr("fill", t.primary);

    const bcx = X(66), bmy = (ybh + ybl) / 2;
    svg.append("rect").attr("x", bcx - 94).attr("y", bmy - 21).attr("width", 188).attr("height", 34)
      .attr("fill", t.page).attr("stroke", t.bull).attr("stroke-width", 1);
    svg.append("text").attr("x", bcx).attr("y", bmy - 4).attr("text-anchor", "middle")
      .attr("fill", t.bull).attr("font-family", SANS).attr("font-size", 13).attr("font-weight", 700)
      .text(`Juniper target ${bandLo}–${bandHi}`);
    svg.append("text").attr("x", bcx).attr("y", bmy + 11).attr("text-anchor", "middle")
      .attr("fill", t.bull).attr("font-family", MONO).attr("font-size", 10).text(bandPctText);

    const rows = targets.map((tg) => {
      const pc = (tg.value / cur - 1) * 100;
      return {
        ly: Y(tg.value), ty: Y(tg.value), name: tg.name,
        val: `$${tg.value.toFixed(2)}  ${pc >= 0 ? "+" : ""}${pc.toFixed(1)}%`, c: t[tg.tone],
      };
    });
    rows.push({ ly: curY, ty: curY, name: "Current", val: `$${cur.toFixed(2)}`, c: t.secondary });
    rows.sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < rows.length; i++)
      if (rows[i].ly - rows[i - 1].ly < 30) rows[i].ly = rows[i - 1].ly + 30;
    rows.forEach((r) => {
      svg.append("polyline")
        .attr("points", `${PR},${r.ty} ${PR + 6},${r.ty} ${LX - 4},${r.ly} ${LX},${r.ly}`)
        .attr("fill", "none").attr("stroke", r.c).attr("stroke-width", 1).attr("opacity", 0.65);
      svg.append("rect").attr("x", LX).attr("y", r.ly - 16).attr("width", 9).attr("height", 9).attr("fill", r.c);
      svg.append("text").attr("x", LX + 15).attr("y", r.ly - 7).attr("fill", t.primary)
        .attr("font-family", SANS).attr("font-size", 14.5).attr("font-weight", 600).text(r.name);
      svg.append("text").attr("x", LX + 15).attr("y", r.ly + 9).attr("fill", r.c)
        .attr("font-family", MONO).attr("font-size", 12.5).text(r.val);
    });
  }, [t, chart]);

  return (
    <svg ref={ref} viewBox="0 0 960 480" xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }} />
  );
}
