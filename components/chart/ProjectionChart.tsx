/**
 * ProjectionChart.tsx — the Editorial Hairline 1-year projection.
 * -----------------------------------------------------------------------------
 * A synchronous Server Component. It maps geometry.ts output to JSX and computes
 * nothing itself. Colour is emitted as var(--token), so one rendered SVG serves
 * both themes and the browser resolves the values.
 */
import { line, curveMonotoneX } from "d3-shape";
import {
  chartDims, computeScales, buildLabelRows, declutterLabels, historySeries,
  MIN_LABEL_GAP, bandBox,
} from "./geometry";
import type { ChartLayout, ChartModel, Tone } from "./types";

const v = (tone: Tone) => `var(--${tone === "secondary" ? "muted" : tone})`;

const X_TICKS: [number, string][] = [
  [-30, "−1M"], [0, "Now"], [91, "+3M"], [182, "+6M"], [273, "+9M"], [365, "+1Y"],
];

export function ProjectionChart({
  model, layout = "wide",
}: { model: ChartModel; layout?: ChartLayout }) {
  const dims = chartDims(layout);
  const scales = computeScales(model, dims);
  const { plotLeft: PL, plotRight: PR, plotTop: PT, plotBottom: PB, labelX } = dims;
  const { nowX, curY } = scales;

  const band = bandBox(model, scales);
  const history = historySeries(model.current);
  const gradientId = `band-${model.ticker.toLowerCase()}-${layout}`;

  const path = line<{ day: number; price: number }>()
    .x((p) => scales.x(p.day))
    .y((p) => scales.y(p.price))
    .curve(curveMonotoneX)(history.points) ?? "";

  const rows = declutterLabels(buildLabelRows(model, scales), MIN_LABEL_GAP);

  return (
    <svg
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`One-year price projection for ${model.company}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--bull)" stopOpacity={0.1} />
          <stop offset="1" stopColor="var(--bull)" stopOpacity={0.06} />
        </linearGradient>
      </defs>

      <rect x={0.5} y={0.5} width={dims.width - 1} height={dims.height - 1}
        fill="var(--surface)" stroke="var(--hairline)" strokeWidth={1} />

      <text x={PL} y={40} fill="var(--accent)" fontFamily="var(--font-sans)"
        fontSize={15} fontWeight={600} letterSpacing={3}>EQUITY RESEARCH</text>
      <text x={PL} y={83} fill="var(--ink)" fontFamily="var(--font-display)"
        fontSize={40} fontWeight={600}>
        {model.company} · {model.exchange}: {model.ticker}
      </text>
      <text x={PL} y={109} fill="var(--muted)" fontFamily="var(--font-mono)" fontSize={14.5}>
        1-Year price projection · as of {model.asOf} · current ${model.current.toFixed(2)}
      </text>

      {scales.gridValues.map((value) => (
        <g key={value}>
          <line x1={PL} x2={PR} y1={scales.y(value)} y2={scales.y(value)}
            stroke="var(--hairline)" strokeWidth={1} strokeDasharray="1 4" />
          <text x={PL - 8} y={scales.y(value) + 4} textAnchor="end" fill="var(--muted)"
            fontFamily="var(--font-mono)" fontSize={13}>{value}</text>
        </g>
      ))}

      <rect x={nowX} y={band.top} width={PR - nowX} height={band.bottom - band.top}
        fill={`url(#${gradientId})`} />
      {[band.top, band.bottom].map((y) => (
        <line key={y} x1={nowX} x2={PR} y1={y} y2={y} stroke="var(--bull)"
          strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
      ))}

      <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1.3} />

      <line x1={nowX} x2={nowX} y1={PT} y2={PB} stroke="var(--muted)"
        strokeWidth={1} strokeDasharray="2 4" opacity={0.5} />
      <line x1={PL} x2={PR} y1={PB} y2={PB} stroke="var(--ink)" strokeWidth={1} opacity={0.55} />
      {X_TICKS.map(([day, label]) => (
        <g key={label}>
          <line x1={scales.x(day)} x2={scales.x(day)} y1={PB} y2={PB + 5}
            stroke="var(--muted)" strokeWidth={1} />
          <text x={scales.x(day)} y={PB + 21} textAnchor="middle" fill="var(--muted)"
            fontFamily="var(--font-mono)" fontSize={13}>{label}</text>
        </g>
      ))}

      {model.targets.map((t) => (
        <line key={t.key} data-role="target-ray"
          x1={nowX} y1={curY} x2={PR} y2={scales.y(t.value)}
          stroke={v(t.tone)} strokeWidth={1.4} strokeDasharray="5 5" />
      ))}

      <circle cx={nowX} cy={curY} r={5} fill="var(--surface)" />
      <circle cx={nowX} cy={curY} r={3} fill="var(--ink)" />

      <g>
        <rect x={band.captionX - 94} y={band.midY - 21} width={188} height={34}
          fill="var(--page)" stroke="var(--bull)" strokeWidth={1} />
        <text x={band.captionX} y={band.midY - 4} textAnchor="middle" fill="var(--bull)"
          fontFamily="var(--font-sans)" fontSize={13} fontWeight={700}>
          Juniper target {model.bandLo}–{model.bandHi}
        </text>
        <text x={band.captionX} y={band.midY + 11} textAnchor="middle" fill="var(--bull)"
          fontFamily="var(--font-mono)" fontSize={10}>{model.bandPctText}</text>
      </g>

      {labelX !== null && rows.map((r) => (
        <g key={r.key}>
          <polyline data-role="leader"
            points={`${PR},${r.anchorY} ${PR + 6},${r.anchorY} ${labelX - 4},${r.labelY} ${labelX},${r.labelY}`}
            fill="none" stroke={v(r.tone)} strokeWidth={1} opacity={0.65} />
          <rect x={labelX} y={r.labelY - 16} width={9} height={9} fill={v(r.tone)} />
          <text x={labelX + 15} y={r.labelY - 7} fill="var(--ink)"
            fontFamily="var(--font-sans)" fontSize={14.5} fontWeight={600}>{r.name}</text>
          <text x={labelX + 15} y={r.labelY + 9} fill={v(r.tone)}
            fontFamily="var(--font-mono)" fontSize={12.5}>{r.value}</text>
        </g>
      ))}

      {labelX === null && rows.map((r, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const lx = PL + col * ((PR - PL) / 2), ly = PB + 44 + row * 20;
        return (
          <g key={r.key}>
            <rect x={lx} y={ly - 9} width={9} height={9} fill={v(r.tone)} />
            <text x={lx + 14} y={ly} fill="var(--ink)" fontFamily="var(--font-sans)"
              fontSize={11} fontWeight={600}>{r.name}</text>
            <text x={lx + 14} y={ly + 13} fill={v(r.tone)} fontFamily="var(--font-mono)"
              fontSize={10}>{r.value}</text>
          </g>
        );
      })}
    </svg>
  );
}
