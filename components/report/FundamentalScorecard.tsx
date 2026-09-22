import { ordinal, pct } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

/**
 * FundamentalScorecard — surfaces the fundamental read behind the rating.
 * -----------------------------------------------------------------------------
 * The badge and the RatingBlock carry the CALL (label, targets, E/D/R). This
 * panel carries the EVIDENCE the scoring layers compute on every build but the
 * page never showed: the 0-100 conviction score and tier (decide.ts), the
 * distress / Piotroski gate (gates.ts), the moat width & trend (moat.ts), the
 * intrinsic margin of safety (intrinsic.ts), the cross-sectional composite
 * percentile (composite.ts), and the uncertainty tier (uncertainty.ts).
 *
 * It is purely additive: under the desk's safe defaults these layers annotate
 * but never move the label, so the panel explains a call without changing it.
 * Rendered only when `rating.decision` is present — the reports built before the
 * scoring merge carry no decision block and render exactly as before.
 */

/** "veryHigh" -> "Very High", "STABLE" -> "Stable", "financial" -> "Financial". */
const cap = (s: string): string =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");

const METER_COLOR: Record<Report["rating"]["tone"], string> = {
  bull: "bg-bull",
  bear: "bg-bear",
  accent: "bg-accent",
  secondary: "bg-muted",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1 font-sans text-[12.5px] last:border-b-0 sm:last:border-b sm:[&:nth-last-child(2)]:border-b-0">
      <dt className="whitespace-nowrap text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

export function FundamentalScorecard({ rating }: { rating: Report["rating"] }) {
  const d = rating.decision;
  if (!d) return null;
  const g = rating.gate;

  const conviction = Math.max(0, Math.min(100, d.conviction));

  const gateValue = g
    ? g.sector === "industrial"
      ? `${cap(g.sector)} · ${g.distress === "NA" ? "n/a" : cap(g.distress)} · Piotroski ${g.piotroski}/9`
      : `${cap(g.sector)} · ${g.distress === "NA" ? "n/a" : cap(g.distress)}`
    : "—";

  const moatValue = d.moat
    ? `${cap(d.moat.width)} · ${cap(d.moat.trend)}${d.moat.contingent ? " · contingent" : ""}`
    : "—";

  const intrinsicValue = d.intrinsic ? `MoS ${pct(d.intrinsic.marginOfSafety, { signed: true })}` : "—";

  const compositeValue =
    d.composite && d.composite.percentile != null
      ? `${ordinal(d.composite.percentile)} pct · ${cap(d.composite.confidence)} conf`
      : "—";

  const uncertaintyValue = d.uncertainty ? `${cap(d.uncertainty.tier)} · ${d.uncertainty.points} pts` : "—";

  // Binding constraints beyond the base E/R proposal, plus the non-binding advisories
  // (gate ceiling, author-vs-composed) — the "why" behind the composed read.
  const notes = [...d.reasons.slice(1), ...d.advisories];

  return (
    <section className="my-4 border border-hairline bg-surface">
      <header className="flex items-baseline justify-between border-b border-hairline px-4 py-2">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[1.5px] text-muted">
          Fundamental Read
        </span>
        <span className="font-sans text-[11px] italic text-muted">the evidence behind the call</span>
      </header>
      <div className="px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-sans text-[15px] font-bold text-ink">
            Conviction {conviction}
            <span className="font-normal text-muted">/100</span>
          </span>
          <span className="font-sans text-[12.5px] font-semibold text-ink">{cap(d.tier)} confidence</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full bg-hairline">
          <div
            role="meter"
            aria-label="Conviction score"
            aria-valuenow={conviction}
            aria-valuemin={0}
            aria-valuemax={100}
            className={`h-full ${METER_COLOR[rating.tone]}`}
            style={{ width: `${conviction}%` }}
          />
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <Metric label="E/R call" value={d.proposed} />
          <Metric label="Gate" value={gateValue} />
          <Metric label="Moat" value={moatValue} />
          <Metric label="Intrinsic value" value={intrinsicValue} />
          <Metric label="Composite" value={compositeValue} />
          <Metric label="Uncertainty" value={uncertaintyValue} />
        </dl>

        {notes.length > 0 && (
          <p className="mt-2.5 border-t border-hairline pt-2 font-sans text-[12px] italic leading-snug text-muted">
            {notes.join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}
